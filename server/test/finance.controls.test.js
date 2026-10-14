import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { assertCreditInTx } from '../services/finance/credit.service.js';
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
    signIn
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

/**
 * Credit limits, cancellation penalties and the commission report.
 * Factory transfers: net 170.00, sold for 200.00, owed by the agency.
 */
describe('credit, penalties and commission', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const cookies = {};
    let agency;
    let vehicle;
    let from;
    let to;

    before(async () => {
        for (const role of ['SUPER_ADMIN', 'ACCOUNTANT', 'MANAGEMENT', 'TOUR_OPERATOR']) {
            cookies[role] = (await signIn(app, (await makeAdmin(tracker, { role })).email)).cookie;
        }
        cookies.SECOND = (await signIn(app, (await makeAdmin(tracker, { role: 'SUPER_ADMIN' })).email)).cookie;

        const supplier = await makePartner(tracker, { kind: 'TRANSPORT' });
        agency = await makePartner(tracker, { kind: 'TOUR_OPERATOR' });
        cookies.AGENCY = (await signIn(app, (await makePartnerUser(tracker, agency)).email)).cookie;

        const provider = tracker.transferProvider(await makeTransferProvider({ partnerId: supplier.id }));
        vehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        from = tracker.transferPoint(await makeTransferPoint());
        to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));
    });

    // Only this file's requests: another suite's are in flight at the same time.
    const approvalIds = [];

    after(async () => {
        await prisma.approvalRequest.deleteMany({ where: { id: { in: approvalIds } } });
        await prisma.penaltyEntry.deleteMany({ where: { partnerId: agency.id } });
        await tracker.cleanup();
        await disconnect();
    });

    const ask = async (body, cookie = cookies.ACCOUNTANT) => {
        const res = await request(app).post('/api/admin/approvals').set('Cookie', cookie).send(body);

        if (res.body?.id) approvalIds.push(res.body.id);

        return res;
    };

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
        return prisma.transferBooking.findUnique({ where: { id: booking.id }, include: { receivable: true } });
    };

    const credit = (body, cookie = cookies.ACCOUNTANT) => request(app).patch(`/api/admin/finance/partners/${agency.id}/credit`).set('Cookie', cookie).send(body);

    it('sets a limit (finance or an admin, never management), and refuses a booking that would pass it', async () => {
        assert.equal((await credit({ creditLimitCents: 50_000, creditLimitCurrency: 'GEL' }, cookies.MANAGEMENT)).status, 403);
        assert.equal((await credit({ creditLimitCents: 50_000 })).status, 400, 'a limit names its currency');

        const set = await credit({ creditLimitCents: 50_000, creditLimitCurrency: 'GEL' });
        assert.equal(set.status, 200, JSON.stringify(set.body));
        assert.equal(set.body.limitCents, 50_000);
        assert.equal(set.body.mode, 'BLOCK');

        await booked();
        await booked();
        const position = await request(app).get('/api/partner/finance/credit').set('Cookie', cookies.AGENCY);
        assert.equal(position.body.outstandingCents, 40_000);
        assert.equal(position.body.availableCents, 10_000);

        // The check the confirm transactions run: 10.00 fits, 200.00 does not.
        await prisma.$transaction((tx) => assertCreditInTx(tx, agency.id, { addCents: 1_000, currency: 'GEL' }));
        await assert.rejects(
            prisma.$transaction((tx) => assertCreditInTx(tx, agency.id, { addCents: 20_000, currency: 'GEL' })),
            (err) => err.status === 422 && err.details.reason === 'CREDIT_LIMIT_EXCEEDED' && err.details.outstandingCents === 40_000
        );
        // Another currency is not counted against a GEL limit.
        await prisma.$transaction((tx) => assertCreditInTx(tx, agency.id, { addCents: 1_000_000, currency: 'USD' }));

        // WARN lets it through and tells finance, on the trail.
        assert.equal((await credit({ creditLimitCents: 50_000, creditLimitCurrency: 'GEL', creditLimitMode: 'WARN' })).body.mode, 'WARN');
        const warned = await prisma.$transaction((tx) => assertCreditInTx(tx, agency.id, { addCents: 20_000, currency: 'GEL' }));
        assert.equal(warned.warning.reason, 'CREDIT_LIMIT_EXCEEDED');
        assert.ok(await prisma.auditLog.findFirst({ where: { action: 'PARTNER_CREDIT_WARNING', entityId: agency.id } }));

        // The earliest of the two so far: the one that set the limit, not the one that switched the mode.
        const audit = await prisma.auditLog.findFirst({ where: { action: 'PARTNER_CREDIT_LIMIT_CHANGED', entityId: agency.id }, orderBy: { createdAt: 'asc' } });
        assert.equal(audit.metadata.changes.creditLimitCents.to, 50_000);

        assert.equal((await credit({ creditLimitCents: null })).body.limitCents, null);
    });

    it('writes a penalty row for every cancellation, and chases the figure a second person approved instead', async () => {
        const one = await booked({ status: 'CANCELLED', cancellationChargeCents: 8_000, confirmedAt: new Date(), cancelledAt: new Date() });
        await prisma.$transaction((tx) => syncBookingInTx(tx, 'TRANSFER', one.id));

        const penalty = await prisma.penaltyEntry.findUnique({ where: { bookingType_bookingId: { bookingType: 'TRANSFER', bookingId: one.id } } });
        assert.ok(penalty, 'a cancelled booking has its penalty row');
        assert.equal(penalty.chargeCents, 8_000);
        assert.equal((await prisma.receivable.findUnique({ where: { id: one.receivable.id } })).amountCents, 8_000);

        const listed = await request(app).get(`/api/admin/finance/penalties?partnerId=${agency.id}`).set('Cookie', cookies.ACCOUNTANT);
        assert.equal(listed.status, 200);
        assert.ok(listed.body.data.some((row) => row.id === penalty.id && row.effectiveCents === 8_000));

        // Too high is refused at the door; the rest goes to a second person.
        const tooHigh = await ask({ kind: 'PENALTY_OVERRIDE', subjectId: penalty.id, payload: { overrideCents: 9_000, reason: 'More' } });
        assert.equal(tooHigh.status, 201, 'the door checks shape; the ceiling is checked when it runs');

        const asked = await ask({
            kind: 'PENALTY_OVERRIDE',
            subjectId: penalty.id,
            payload: { overrideCents: 3_000, reason: 'Goodwill: the flight was cancelled' }
        });
        assert.equal(asked.status, 201, JSON.stringify(asked.body));

        const refused = await request(app).post(`/api/admin/approvals/${tooHigh.body.id}/approve`).set('Cookie', cookies.SUPER_ADMIN).send({});
        assert.equal(refused.status, 422);

        const approved = await request(app).post(`/api/admin/approvals/${asked.body.id}/approve`).set('Cookie', cookies.SUPER_ADMIN).send({});
        assert.equal(approved.status, 200, JSON.stringify(approved.body));

        const after = await prisma.penaltyEntry.findUnique({ where: { id: penalty.id } });
        assert.equal(after.overrideCents, 3_000);
        assert.equal(after.approvalId, asked.body.id);
        assert.equal((await prisma.receivable.findUnique({ where: { id: one.receivable.id } })).amountCents, 3_000, 'the ledger chases the approved figure');

        const trail = await prisma.auditLog.findFirst({ where: { action: 'PENALTY_OVERRIDDEN', entityId: penalty.id } });
        assert.equal(trail.metadata.approvalId, asked.body.id);
    });

    it('reports commission per agency from the frozen rate, to finance readers and to the agency itself', async () => {
        await booked({ confirmedAt: new Date() });

        const report = await request(app).get(`/api/admin/finance/reports/commission?groupBy=partner&partnerId=${agency.id}`).set('Cookie', cookies.MANAGEMENT);
        assert.equal(report.status, 200, JSON.stringify(report.body));
        const row = report.body.rows.find((entry) => entry.key === agency.id && entry.currency === 'GEL');
        assert.ok(row, 'the agency is on the report');
        assert.ok(row.bookings >= 1);
        assert.equal(row.commissionCents, row.sellCents - row.netCents);

        assert.equal((await request(app).get('/api/admin/finance/reports/commission').set('Cookie', cookies.TOUR_OPERATOR)).status, 403);

        const csv = await request(app).get('/api/admin/finance/reports/commission?format=csv').set('Cookie', cookies.ACCOUNTANT);
        assert.equal(csv.status, 200);
        assert.match(csv.headers['content-type'], /text\/csv/);

        const own = await request(app).get('/api/partner/finance/commission').set('Cookie', cookies.AGENCY);
        assert.equal(own.status, 200, JSON.stringify(own.body));
        assert.ok(own.body.rows.every((entry) => entry.key === 'TRANSFER' || entry.key === 'HOTEL' || entry.key === 'TOUR' || entry.key === 'SERVICE' || entry.key === 'ORDER'));
    });
});
