import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { syncBookingInTx } from '../services/finance/ledger.service.js';
import { todayInTimezone, addDays, zonedTimeToInstant } from '../lib/time.js';
import {
    createTracker,
    databaseAvailable,
    futureDate,
    makeDestination,
    makeAdmin,
    makePartner,
    makePartnerUser,
    makeService,
    makeTransferBooking,
    makeTransferPoint,
    makeTransferProvider,
    makeTransferVehicle,
    signIn
} from './support/factories.js';

/**
 * The finance ledger against real rows: what is owed to the supplier and by
 * the buyer when a booking is confirmed, and what is left of each once it is
 * cancelled under each of the three supplier liabilities (D6).
 *
 * Transfer bookings are written by the factory and synced by hand, so each
 * case controls its own status and charge; one service booking goes through
 * the real API to prove the booking services call the ledger themselves.
 */
const app = createApp();
const dbAvailable = await databaseAvailable();
const sync = (id) => prisma.$transaction((tx) => syncBookingInTx(tx, 'TRANSFER', id));
const read = (id) =>
    prisma.transferBooking.findUnique({
        where: { id },
        include: { payable: { include: { instalments: { orderBy: { sequence: 'asc' } } } }, receivable: true }
    });

describe('finance records', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let supplier;
    let agency;
    let provider;
    let vehicle;
    let from;
    let to;

    before(async () => {
        supplier = await makePartner(tracker, { kind: 'TRANSPORT' });
        agency = await makePartner(tracker, { kind: 'TOUR_OPERATOR', paymentDueDays: 7 });
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

    const setTerms = (data) =>
        prisma.supplierPaymentTerms.upsert({
            where: { transferProviderId: provider.id },
            update: data,
            create: { transferProviderId: provider.id, ...data }
        });

    const booking = (overrides = {}) =>
        makeTransferBooking(tracker, {
            vehicleId: vehicle.id,
            from,
            to,
            partnerId: agency.id,
            pickupAt: new Date(`${futureDate(30)}T08:00:00Z`),
            ...overrides
        });

    it("records what we owe the supplier and what the agency owes us, on each one's terms", async () => {
        await setTerms({
            milestones: [
                { kind: 'DEPOSIT', basis: 'PERCENT', value: 3000, anchor: 'CONFIRMATION', offsetDays: 3 },
                { kind: 'BALANCE', anchor: 'ARRIVAL', offsetDays: -1 }
            ],
            cancellationLiability: 'PROPORTIONAL'
        });
        const made = await booking();
        await sync(made.id);
        const row = await read(made.id);

        assert.equal(row.payable.supplierPartnerId, supplier.id);
        assert.equal(row.payable.originalAmountCents, 17_000);
        assert.equal(row.payable.amountCents, 17_000);
        assert.equal(row.payable.status, 'OPEN');
        assert.equal(row.payable.needsReview, false);
        assert.deepEqual(
            row.payable.instalments.map((i) => [i.kind, i.amountCents]),
            [
                ['DEPOSIT', 5_100],
                ['BALANCE', 11_900]
            ]
        );

        const today = todayInTimezone('Asia/Tbilisi', made.confirmedAt);
        assert.equal(row.payable.instalments[0].dueAt.toISOString(), zonedTimeToInstant(addDays(today, 3), '10:00', 'Asia/Tbilisi').toISOString());
        assert.equal(row.payable.nextDueAt.toISOString(), row.payable.instalments[0].dueAt.toISOString());

        assert.equal(row.receivable.debtorPartnerId, agency.id);
        assert.equal(row.receivable.amountCents, 20_000);
        assert.equal(row.receivable.reference, made.reference);
        // The agency's own seven days (D5), to the end of the last one.
        assert.equal(row.receivable.dueAt.toISOString(), zonedTimeToInstant(addDays(today, 7), '23:59', 'Asia/Tbilisi').toISOString());
    });

    it('changes nothing when synced again', async () => {
        const made = await booking();
        await sync(made.id);
        const first = await read(made.id);
        const trail = () => prisma.auditLog.count({ where: { entityId: { in: [first.payable.id, first.receivable.id] } } });
        const written = await trail();

        await sync(made.id);
        await sync(made.id);

        const again = await read(made.id);
        assert.equal(again.payable.id, first.payable.id);
        assert.equal(again.payable.updatedAt.getTime(), first.payable.updatedAt.getTime());
        assert.equal(await trail(), written, 'no second audit row for a sync that moved nothing');
    });

    it('owes the supplier the same share of the net as the agency was charged, when PROPORTIONAL', async () => {
        await setTerms({ cancellationLiability: 'PROPORTIONAL' });
        const made = await booking();
        await sync(made.id);

        await prisma.transferBooking.update({ where: { id: made.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationChargeCents: 10_000 } });
        await sync(made.id);
        const row = await read(made.id);

        // Half of the 200.00 charged → half of the 170.00 net.
        assert.equal(row.receivable.amountCents, 10_000);
        assert.equal(row.payable.amountCents, 8_500);
        assert.equal(row.payable.cancellationLiability, 'PROPORTIONAL');
        assert.deepEqual(
            row.payable.instalments.map((i) => i.amountCents),
            [5_100, 3_400],
            'the reduction comes off the balance first'
        );
    });

    it('owes the supplier nothing unless the charge was the whole price, when NONE_UNLESS_NON_REFUNDABLE', async () => {
        await setTerms({ cancellationLiability: 'NONE_UNLESS_NON_REFUNDABLE' });

        const partial = await booking();
        await sync(partial.id);
        await prisma.transferBooking.update({ where: { id: partial.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationChargeCents: 10_000 } });
        await sync(partial.id);
        const voided = await read(partial.id);

        assert.equal(voided.payable.amountCents, 0);
        assert.equal(voided.payable.status, 'VOID');
        assert.ok(voided.payable.voidedAt);
        assert.ok(voided.payable.instalments.every((i) => i.status === 'VOID'));

        const full = await booking();
        await sync(full.id);
        await prisma.transferBooking.update({ where: { id: full.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationChargeCents: 20_000 } });
        await sync(full.id);
        assert.equal((await read(full.id)).payable.amountCents, 17_000);
    });

    it('stops at what was paid and asks Finance, when MANUAL', async () => {
        await setTerms({ cancellationLiability: 'MANUAL' });
        const made = await booking();
        await sync(made.id);
        await prisma.transferBooking.update({ where: { id: made.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationChargeCents: 10_000 } });
        await sync(made.id);
        const row = await read(made.id);

        assert.equal(row.payable.amountCents, 0);
        assert.equal(row.payable.needsReview, true);
        assert.equal(row.payable.reviewReason, 'CANCELLATION_MANUAL');
    });

    it("keeps Finance's own figure through every later sync", async () => {
        await setTerms({ cancellationLiability: 'PROPORTIONAL' });
        const made = await booking();
        await sync(made.id);
        const { payable } = await read(made.id);

        await prisma.supplierPayable.update({ where: { id: payable.id }, data: { amountOverrideCents: 12_000, overrideReason: 'Agreed with the supplier' } });
        await prisma.transferBooking.update({ where: { id: made.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationChargeCents: 10_000 } });
        await sync(made.id);

        assert.equal((await read(made.id)).payable.amountCents, 12_000);
    });

    it('owes nothing for a booking still waiting for an answer, or one that was declined', async () => {
        const pending = await booking({ status: 'PENDING', confirmedAt: null });
        await sync(pending.id);
        const declined = await booking({ status: 'CANCELLED', confirmedAt: null, cancellationChargeCents: 0 });
        await sync(declined.id);

        for (const id of [pending.id, declined.id]) {
            const row = await read(id);
            assert.equal(row.payable, null);
            assert.equal(row.receivable, null);
        }
    });

    it('flags a supplier with no terms, and schedules one undated balance', async () => {
        await prisma.supplierPaymentTerms.deleteMany({ where: { transferProviderId: provider.id } });
        const made = await booking({ partnerId: null });
        await sync(made.id);
        const row = await read(made.id);

        assert.equal(row.payable.needsReview, true);
        assert.equal(row.payable.reviewReason, 'NO_TERMS');
        assert.deepEqual(row.payable.instalments.map((i) => [i.kind, i.amountCents, i.dueAt]), [['BALANCE', 17_000, null]]);

        // A guest without an account: owed by the lead passenger, at once.
        assert.equal(row.receivable.debtorPartnerId, null);
        assert.equal(row.receivable.debtorEmail, made.leadPassengerEmail);
        assert.equal(row.receivable.debtorName, 'Test Passenger');
    });

    it('refuses rows the database rules out', async () => {
        const made = await booking();
        await sync(made.id);
        const { payable, receivable } = await read(made.id);

        await assert.rejects(prisma.supplierPayable.update({ where: { id: payable.id }, data: { amountCents: 99_999 } }), 'more than was booked');
        await assert.rejects(prisma.receivable.update({ where: { id: receivable.id }, data: { status: 'VOID' } }), 'VOID without a date');
        await assert.rejects(
            prisma.paymentRecord.create({
                data: { direction: 'IN', method: 'CASH', currency: 'GEL', amountCents: 0, paidAt: new Date(), counterpartyName: 'x' }
            }),
            'a payment of nothing'
        );
        await assert.rejects(
            prisma.paymentRecord.create({
                data: { direction: 'IN', kind: 'REFUND', method: 'CASH', currency: 'GEL', amountCents: 100, paidAt: new Date(), counterpartyName: 'x' }
            }),
            'a refund without a reason'
        );
    });
});

describe('finance records — written by the booking services themselves', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let partnerCookie;
    let adminCookie;
    let supplier;
    let destination;

    before(async () => {
        const agency = await makePartner(tracker);
        partnerCookie = (await signIn(app, (await makePartnerUser(tracker, agency)).email)).cookie;
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;
        supplier = await makePartner(tracker, { kind: 'EXPERIENCE' });
        destination = await makeDestination(tracker);
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('writes both sides when a service is booked, and clears them on a free cancellation', async () => {
        const service = await makeService(tracker, { destination, supplierId: supplier.id });
        const created = await request(app)
            .post('/api/service-bookings')
            .set('Cookie', partnerCookie)
            .set('Idempotency-Key', `fin-svc-${Date.now()}`)
            .send({
                serviceId: service.id,
                date: futureDate(40),
                days: 1,
                quantity: 1,
                pax: 3,
                lead: { firstName: 'Nino', lastName: 'Beridze', email: 'agency@example.test' }
            });
        assert.equal(created.status, 201, JSON.stringify(created.body));

        const row = await prisma.serviceBooking.findUnique({
            where: { reference: created.body.reference },
            include: { payable: true, receivable: true }
        });

        assert.equal(row.payable.supplierPartnerId, supplier.id);
        assert.equal(row.payable.amountCents, row.netTotalCents);
        assert.equal(row.receivable.amountCents, row.sellTotalCents);

        const cancelled = await request(app)
            .post(`/api/service-bookings/${created.body.reference}/cancel`)
            .set('Cookie', partnerCookie)
            .send({ reason: 'Plans changed' });
        assert.equal(cancelled.status, 200);

        const after = await prisma.serviceBooking.findUnique({ where: { id: row.id }, include: { payable: true, receivable: true } });
        assert.equal(after.receivable.status, 'VOID', 'a free cancellation owes nothing');
        assert.equal(after.payable.status, 'VOID');

        // Finance rows are on the trail like everything else.
        const audit = await request(app).get(`/api/admin/audit?entityType=SupplierPayable&entityId=${row.payable.id}`).set('Cookie', adminCookie);
        assert.deepEqual(
            audit.body.data.map((entry) => entry.action).sort(),
            ['PAYABLE_CREATED', 'PAYABLE_VOIDED']
        );
    });
});
