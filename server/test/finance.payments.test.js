import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { syncBookingInTx } from '../services/finance/ledger.service.js';
import {
    createTracker,
    databaseAvailable,
    futureDate,
    makeAdmin,
    makePartner,
    makePartnerUser,
    makeTransferBooking,
    makeTransferPoint,
    makeTransferProvider,
    makeTransferVehicle,
    signIn,
    unique
} from './support/factories.js';

/**
 * Payments, Finance's adjustments, terms, reports and who may touch them.
 * Bookings are factory transfers synced into the ledger: net 170.00, sold for
 * 200.00, owed by the agency and to the transfer company.
 */
const app = createApp();
const dbAvailable = await databaseAvailable();

describe('finance payments', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const cookies = {};
    let supplier;
    let agency;
    let otherAgency;
    let provider;
    let vehicle;
    let from;
    let to;

    before(async () => {
        for (const role of ['FINANCE', 'MANAGEMENT', 'RESERVATIONS']) {
            cookies[role] = (await signIn(app, (await makeAdmin(tracker, { role })).email)).cookie;
        }

        supplier = await makePartner(tracker, { kind: 'TRANSPORT' });
        agency = await makePartner(tracker, { kind: 'TOUR_OPERATOR', paymentDueDays: 10 });
        otherAgency = await makePartner(tracker, { kind: 'TOUR_OPERATOR' });
        cookies.AGENCY = (await signIn(app, (await makePartnerUser(tracker, agency)).email)).cookie;
        cookies.OTHER = (await signIn(app, (await makePartnerUser(tracker, otherAgency)).email)).cookie;
        cookies.SUPPLIER = (await signIn(app, (await makePartnerUser(tracker, supplier)).email)).cookie;

        provider = tracker.transferProvider(await makeTransferProvider({ partnerId: supplier.id }));
        vehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        from = tracker.transferPoint(await makeTransferPoint());
        to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));
    });

    after(async () => {
        await prisma.supplierPaymentTerms.deleteMany({ where: { transferProviderId: provider.id } });
        await tracker.cleanup();
        await disconnect();
    });

    /** A confirmed transfer with both finance rows. */
    const booked = async (overrides = {}) => {
        const booking = await makeTransferBooking(tracker, {
            vehicleId: vehicle.id,
            from,
            to,
            partnerId: agency.id,
            pickupAt: new Date(`${futureDate(30)}T08:00:00Z`),
            ...overrides
        });
        await prisma.$transaction((tx) => syncBookingInTx(tx, 'TRANSFER', booking.id));
        return prisma.transferBooking.findUnique({
            where: { id: booking.id },
            include: { receivable: true, payable: { include: { instalments: { orderBy: { sequence: 'asc' } } } } }
        });
    };

    const pay = (body, cookie = cookies.FINANCE, key = unique('pay')) =>
        request(app).post('/api/admin/finance/payments').set('Cookie', cookie).set('Idempotency-Key', key).send({
            method: 'BANK_TRANSFER',
            currency: 'GEL',
            paidAt: new Date().toISOString(),
            ...body
        });

    it('records an agency payment against two bookings and settles both', async () => {
        const one = await booked();
        const two = await booked();

        const res = await pay({
            direction: 'IN',
            amountCents: 30_000,
            reference: 'TBC-88213',
            allocations: [
                { receivableId: one.receivable.id, amountCents: 20_000 },
                { receivableId: two.receivable.id, amountCents: 10_000 }
            ]
        });

        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(res.body.payment.allocatedCents, 30_000);
        assert.equal(res.body.payment.unallocatedCents, 0);
        assert.equal(res.body.payment.counterparty.partner.id, agency.id, 'the payer is taken from what it settles');

        const [a, b] = await Promise.all([
            prisma.receivable.findUnique({ where: { id: one.receivable.id } }),
            prisma.receivable.findUnique({ where: { id: two.receivable.id } })
        ]);
        assert.equal(a.status, 'PAID');
        assert.equal(b.status, 'PARTIAL');
        assert.equal(b.paidCents, 10_000);
    });

    it('settles the oldest due first when asked, and leaves the rest unallocated', async () => {
        const fresh = await makePartner(tracker, { kind: 'TOUR_OPERATOR' });
        const first = await booked({ partnerId: fresh.id });
        const second = await booked({ partnerId: fresh.id });
        await prisma.receivable.update({ where: { id: first.receivable.id }, data: { dueAt: new Date(Date.now() - 86_400_000) } });

        const res = await pay({ direction: 'IN', amountCents: 50_000, allocate: { mode: 'OLDEST_DUE', partnerId: fresh.id } });

        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.deepEqual(
            res.body.payment.allocations.map((a) => [a.receivable.id, a.amountCents]),
            [
                [first.receivable.id, 20_000],
                [second.receivable.id, 20_000]
            ]
        );
        assert.equal(res.body.payment.unallocatedCents, 10_000);
    });

    it('refuses an allocation beyond what is owed, a mixed currency, and the wrong kind of target', async () => {
        const one = await booked();

        const over = await pay({ direction: 'IN', amountCents: 25_000, allocations: [{ receivableId: one.receivable.id, amountCents: 25_000 }] });
        assert.equal(over.status, 422);
        assert.equal(over.body.error.details.reason, 'ALLOCATION_EXCEEDS_OUTSTANDING');

        const currency = await pay({ direction: 'IN', currency: 'USD', amountCents: 100, allocations: [{ receivableId: one.receivable.id, amountCents: 100 }] });
        assert.equal(currency.status, 422);
        assert.equal(currency.body.error.details.reason, 'CURRENCY_MISMATCH');

        const wrong = await pay({ direction: 'OUT', amountCents: 100, allocations: [{ receivableId: one.receivable.id, amountCents: 100 }] });
        assert.equal(wrong.status, 422);
        assert.equal(wrong.body.error.details.reason, 'WRONG_TARGET');

        assert.equal((await prisma.receivable.findUnique({ where: { id: one.receivable.id } })).paidCents, 0, 'nothing moved');
    });

    it('answers a retried payment with the original, and refuses the key for a different one', async () => {
        const one = await booked();
        const key = unique('retry-key');
        const body = { direction: 'IN', amountCents: 5_000, allocations: [{ receivableId: one.receivable.id, amountCents: 5_000 }] };

        const first = await pay(body, cookies.FINANCE, key);
        const again = await pay(body, cookies.FINANCE, key);
        assert.equal(first.status, 201);
        assert.equal(again.status, 200);
        assert.equal(again.body.replayed, true);
        assert.equal(again.body.payment.id, first.body.payment.id);
        assert.equal((await prisma.receivable.findUnique({ where: { id: one.receivable.id } })).paidCents, 5_000, 'paid once');

        const different = await pay({ ...body, amountCents: 6_000, allocations: [{ receivableId: one.receivable.id, amountCents: 6_000 }] }, cookies.FINANCE, key);
        assert.equal(different.status, 409);
        assert.equal(different.body.error.details.reason, 'IDEMPOTENCY_KEY_REUSED');
    });

    it('lets two payments race for the last of a receivable and settles exactly once', async () => {
        const one = await booked();
        const body = { direction: 'IN', amountCents: 15_000, allocations: [{ receivableId: one.receivable.id, amountCents: 15_000 }] };

        const results = await Promise.all([pay(body), pay(body)]);
        const statuses = results.map((r) => r.status).sort();

        assert.deepEqual(statuses, [201, 422], 'one settles, the other finds only 50.00 left');
        assert.equal((await prisma.receivable.findUnique({ where: { id: one.receivable.id } })).paidCents, 15_000);
    });

    it('refunds an agency after a cancellation, with a reason', async () => {
        const one = await booked();
        await pay({ direction: 'IN', amountCents: 20_000, allocations: [{ receivableId: one.receivable.id, amountCents: 20_000 }] });

        await prisma.transferBooking.update({ where: { id: one.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationChargeCents: 5_000 } });
        await prisma.$transaction((tx) => syncBookingInTx(tx, 'TRANSFER', one.id));

        const owed = await request(app).get(`/api/admin/finance/receivables/${one.receivable.id}`).set('Cookie', cookies.FINANCE);
        assert.equal(owed.body.refundDueCents, 15_000);

        const noReason = await pay({ direction: 'OUT', kind: 'REFUND', amountCents: 15_000, allocations: [{ receivableId: one.receivable.id, amountCents: 15_000 }] });
        assert.equal(noReason.status, 400);

        const refund = await pay({
            direction: 'OUT',
            kind: 'REFUND',
            reason: 'Cancelled inside the 25% window',
            amountCents: 15_000,
            allocations: [{ receivableId: one.receivable.id, amountCents: 15_000 }]
        });
        assert.equal(refund.status, 201, JSON.stringify(refund.body));
        assert.equal(refund.body.payment.allocations[0].amountCents, -15_000);

        const settled = await prisma.receivable.findUnique({ where: { id: one.receivable.id } });
        assert.equal(settled.paidCents, 5_000);
        assert.equal(settled.status, 'PAID');
    });

    it('pays a supplier instalment, and the payable follows', async () => {
        await prisma.supplierPaymentTerms.upsert({
            where: { transferProviderId: provider.id },
            update: { milestones: [{ kind: 'DEPOSIT', basis: 'PERCENT', value: 3000, anchor: 'CONFIRMATION', offsetDays: 3 }, { kind: 'BALANCE', anchor: 'ARRIVAL', offsetDays: -1 }] },
            create: { transferProviderId: provider.id, milestones: [{ kind: 'DEPOSIT', basis: 'PERCENT', value: 3000, anchor: 'CONFIRMATION', offsetDays: 3 }, { kind: 'BALANCE', anchor: 'ARRIVAL', offsetDays: -1 }] }
        });
        const one = await booked();

        const res = await request(app)
            .post(`/api/admin/finance/payables/${one.payable.id}/instalments/1/pay`)
            .set('Cookie', cookies.FINANCE)
            .send({ method: 'BANK_TRANSFER', paidAt: new Date().toISOString(), reference: 'OUT-1' });

        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(res.body.payment.direction, 'OUT');
        assert.equal(res.body.payment.amountCents, 5_100);

        const payable = await request(app).get(`/api/admin/finance/payables/${one.payable.id}`).set('Cookie', cookies.FINANCE);
        assert.equal(payable.body.status, 'PARTIAL');
        assert.equal(payable.body.paidCents, 5_100);
        assert.deepEqual(payable.body.instalments.map((i) => i.status), ['PAID', 'OPEN']);
        assert.equal(payable.body.nextDueAt, payable.body.instalments[1].dueAt);
    });

    it("sets a supplier's amount by hand, and writes off what is left, both with a reason", async () => {
        const one = await booked();

        const noReason = await request(app).patch(`/api/admin/finance/payables/${one.payable.id}`).set('Cookie', cookies.FINANCE).send({ amountOverrideCents: 9_000 });
        assert.equal(noReason.status, 400);

        const above = await request(app)
            .patch(`/api/admin/finance/payables/${one.payable.id}`)
            .set('Cookie', cookies.FINANCE)
            .send({ amountOverrideCents: 99_000, reason: 'Typo' });
        assert.equal(above.status, 422);

        const set = await request(app)
            .patch(`/api/admin/finance/payables/${one.payable.id}`)
            .set('Cookie', cookies.FINANCE)
            .send({ amountOverrideCents: 9_000, reason: 'Agreed a discount with the supplier' });
        assert.equal(set.status, 200, JSON.stringify(set.body));
        assert.equal(set.body.amountCents, 9_000);
        assert.equal(set.body.amountOverrideCents, 9_000);
        assert.equal(set.body.needsReview, false);

        const waived = await request(app)
            .patch(`/api/admin/finance/payables/${one.payable.id}`)
            .set('Cookie', cookies.FINANCE)
            .send({ waive: true, reason: 'Supplier closed down' });
        assert.equal(waived.body.status, 'WAIVED');
        assert.ok(waived.body.instalments.every((i) => i.status === 'WAIVED'));
    });

    it("moves an agency's due date (D5) and records who moved it", async () => {
        const one = await booked();
        const dueAt = new Date(Date.now() + 45 * 86_400_000).toISOString();

        const res = await request(app)
            .patch(`/api/admin/finance/receivables/${one.receivable.id}`)
            .set('Cookie', cookies.FINANCE)
            .send({ dueAt, reason: 'Agreed longer terms for this group' });

        assert.equal(res.status, 200);
        assert.equal(res.body.dueAt, dueAt);

        const [row] = await prisma.auditLog.findMany({ where: { entityId: one.receivable.id, action: 'RECEIVABLE_DUE_DATE_CHANGED' } });
        assert.equal(row.metadata.reason, 'Agreed longer terms for this group');
    });

    it('saves supplier terms and partner terms, and refuses terms that do not add up', async () => {
        const bad = await request(app)
            .put(`/api/admin/finance/terms/transfer-providers/${provider.id}`)
            .set('Cookie', cookies.FINANCE)
            .send({ milestones: [{ kind: 'DEPOSIT', basis: 'PERCENT', value: 3000, anchor: 'CONFIRMATION', offsetDays: 3 }] });
        assert.equal(bad.status, 400, 'a deposit without a balance');

        const ok = await request(app)
            .put(`/api/admin/finance/terms/transfer-providers/${provider.id}`)
            .set('Cookie', cookies.FINANCE)
            .send({ milestones: [{ kind: 'BALANCE', anchor: 'ARRIVAL', offsetDays: -7 }], cancellationLiability: 'MANUAL', cutoffTime: '12:00' });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal(ok.body.cancellationLiability, 'MANUAL');

        const read = await request(app).get(`/api/admin/finance/terms/transfer-providers/${provider.id}`).set('Cookie', cookies.MANAGEMENT);
        assert.equal(read.status, 200);
        assert.equal(read.body.cutoffTime, '12:00');

        assert.equal((await request(app).get(`/api/admin/finance/terms/boats/${provider.id}`).set('Cookie', cookies.FINANCE)).status, 404);

        const partnerTerms = await request(app)
            .patch(`/api/admin/finance/partners/${otherAgency.id}/terms`)
            .set('Cookie', cookies.FINANCE)
            .send({ paymentDueDays: 30, paymentDueAnchor: 'ARRIVAL' });
        assert.equal(partnerTerms.status, 200);
        assert.equal(partnerTerms.body.paymentDueDays, 30);
    });

    it('reports per currency, and exports CSV only with the export permission', async () => {
        await booked();

        const summary = await request(app).get('/api/admin/finance/reports/summary').set('Cookie', cookies.MANAGEMENT);
        assert.equal(summary.status, 200);
        const gel = summary.body.currencies.find((row) => row.currency === 'GEL');
        assert.ok(gel.receivables.openCents > 0);
        assert.ok(gel.payables.openCents > 0);

        const margin = await request(app).get('/api/admin/finance/reports/margin?groupBy=product').set('Cookie', cookies.FINANCE);
        assert.equal(margin.status, 200);
        const transfers = margin.body.rows.find((row) => row.key === 'TRANSFER' && row.currency === 'GEL');
        assert.ok(transfers.bookings > 0);

        const ageing = await request(app).get('/api/admin/finance/reports/ageing?side=payables').set('Cookie', cookies.FINANCE);
        assert.equal(ageing.status, 200);
        assert.deepEqual(ageing.body.buckets, ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']);

        const csv = await request(app).get('/api/admin/finance/reports/margin?format=csv').set('Cookie', cookies.FINANCE);
        assert.equal(csv.status, 200);
        assert.match(csv.headers['content-type'], /text\/csv/);
        assert.match(csv.text.split('\r\n')[0], /^Product,Currency,Bookings,Revenue,Cost,Margin,Margin %$/);
    });

    it('keeps money changes to finance; management reads, reservations is kept out', async () => {
        const one = await booked();

        assert.equal((await request(app).get('/api/admin/finance/payables').set('Cookie', cookies.MANAGEMENT)).status, 200);
        assert.equal(
            (await pay({ direction: 'IN', amountCents: 100, allocations: [{ receivableId: one.receivable.id, amountCents: 100 }] }, cookies.MANAGEMENT)).status,
            403
        );
        assert.equal((await request(app).get('/api/admin/finance/receivables').set('Cookie', cookies.RESERVATIONS)).status, 403);
        assert.equal((await request(app).get('/api/admin/finance/payables').set('Cookie', cookies.AGENCY)).status, 403);
    });

    it("shows an agency its own statement only, and a supplier what it is owed, net only", async () => {
        const mine = await booked();

        const statement = await request(app).get('/api/partner/finance/statement?pageSize=100').set('Cookie', cookies.AGENCY);
        assert.equal(statement.status, 200);
        assert.ok(statement.body.data.some((row) => row.id === mine.receivable.id));
        assert.ok(statement.body.data.every((row) => !('debtor' in row) && !('notes' in row)));
        assert.ok(statement.body.balances.find((row) => row.currency === 'GEL').outstandingCents > 0);

        const other = await request(app).get('/api/partner/finance/statement?pageSize=100').set('Cookie', cookies.OTHER);
        assert.ok(!other.body.data.some((row) => row.id === mine.receivable.id), 'another agency never sees it');

        const owed = await request(app).get('/api/partner/finance/payables?pageSize=100').set('Cookie', cookies.SUPPLIER);
        assert.equal(owed.status, 200);
        const row = owed.body.data.find((p) => p.id === mine.payable.id);
        assert.equal(row.amountCents, 17_000);
        for (const field of ['supplier', 'needsReview', 'amountOverrideCents', 'notes', 'cancellationLiability']) {
            assert.ok(!(field in row), `supplier sees ${field}`);
        }
    });
});
