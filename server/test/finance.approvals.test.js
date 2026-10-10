import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { syncBookingInTx } from '../services/finance/ledger.service.js';
import { drainOutbox } from '../services/notifications/outbox.service.js';
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

const app = createApp();
const dbAvailable = await databaseAvailable();

/**
 * Refunds and adjustments need a second person: one asks, another approves,
 * and approving does the thing in the approver's name. Nobody approves their
 * own; nobody is seeded to skip the step.
 */
describe('approval requests', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const cookies = {};
    const users = {};
    let agency;
    let vehicle;
    let from;
    let to;

    before(async () => {
        for (const role of ['SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_OPERATOR', 'MANAGEMENT']) {
            users[role] = await makeAdmin(tracker, { role });
            cookies[role] = (await signIn(app, users[role].email)).cookie;
        }

        // A second super admin, so a request by one can be decided by the other.
        users.SECOND = await makeAdmin(tracker, { role: 'SUPER_ADMIN' });
        cookies.SECOND = (await signIn(app, users.SECOND.email)).cookie;

        const supplier = await makePartner(tracker, { kind: 'TRANSPORT' });
        agency = await makePartner(tracker, { kind: 'TOUR_OPERATOR' });
        cookies.AGENCY = (await signIn(app, (await makePartnerUser(tracker, agency)).email)).cookie;

        const provider = tracker.transferProvider(await makeTransferProvider({ partnerId: supplier.id }));
        vehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        from = tracker.transferPoint(await makeTransferPoint());
        to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));
    });

    after(async () => {
        await prisma.approvalRequest.deleteMany({ where: { requestedBy: { email: { endsWith: '@example.test' } } } });
        await tracker.cleanup();
        await disconnect();
    });

    const booked = async () => {
        const booking = await makeTransferBooking(tracker, {
            vehicleId: vehicle.id,
            from,
            to,
            partnerId: agency.id,
            pickupAt: new Date(`${futureDate(30)}T08:00:00Z`)
        });
        await prisma.$transaction((tx) => syncBookingInTx(tx, 'TRANSFER', booking.id));
        return prisma.transferBooking.findUnique({ where: { id: booking.id }, include: { receivable: true, payable: true } });
    };

    const pay = (body, cookie = cookies.ACCOUNTANT) =>
        request(app).post('/api/admin/finance/payments').set('Cookie', cookie).set('Idempotency-Key', unique('pay')).send({
            method: 'BANK_TRANSFER',
            currency: 'GEL',
            paidAt: new Date().toISOString(),
            ...body
        });

    const ask = (body, cookie = cookies.ACCOUNTANT) => request(app).post('/api/admin/approvals').set('Cookie', cookie).send(body);
    const decide = (id, verb, cookie, body = {}) => request(app).post(`/api/admin/approvals/${id}/${verb}`).set('Cookie', cookie).send(body);

    it('refuses a refund and a write-off done alone, by anyone, and names the request to open instead', async () => {
        const one = await booked();
        await pay({ direction: 'IN', amountCents: 20_000, allocations: [{ receivableId: one.receivable.id, amountCents: 20_000 }] });

        const refund = { direction: 'OUT', kind: 'REFUND', amountCents: 5_000, reason: 'Goodwill', allocations: [{ receivableId: one.receivable.id, amountCents: 5_000 }] };

        for (const role of ['ACCOUNTANT', 'FINANCE_OPERATOR', 'SUPER_ADMIN']) {
            const res = await pay(refund, cookies[role]);
            assert.equal(res.status, 403, role);
            assert.equal(res.body.error.details.reason, 'APPROVAL_REQUIRED', role);
            assert.equal(res.body.error.details.kind, 'REFUND', role);
        }

        const waive = await request(app).patch(`/api/admin/finance/receivables/${one.receivable.id}`).set('Cookie', cookies.SUPER_ADMIN).send({ waive: true, reason: 'No' });
        assert.equal(waive.status, 403);
        assert.equal(waive.body.error.details.kind, 'RECEIVABLE_WAIVE');

        // Notes are their own capability and need no second person; the edit is on the trail.
        const notes = await request(app).patch(`/api/admin/finance/receivables/${one.receivable.id}`).set('Cookie', cookies.FINANCE_OPERATOR).send({ notes: 'Chased on the phone', reason: 'Call' });
        assert.equal(notes.status, 200, JSON.stringify(notes.body));
        assert.ok(await prisma.auditLog.findFirst({ where: { action: 'RECEIVABLE_NOTES_CHANGED', entityId: one.receivable.id } }));
    });

    it('lets one person ask for a refund and another approve it, which records the refund in the approver\'s name', async () => {
        const one = await booked();
        await pay({ direction: 'IN', amountCents: 20_000, allocations: [{ receivableId: one.receivable.id, amountCents: 20_000 }] });

        const payload = { direction: 'OUT', kind: 'REFUND', method: 'BANK_TRANSFER', currency: 'GEL', amountCents: 5_000, paidAt: new Date().toISOString(), reason: 'Goodwill', allocations: [{ receivableId: one.receivable.id, amountCents: 5_000 }] };

        const notARefund = await ask({ kind: 'REFUND', payload: { ...payload, kind: 'PAYMENT' } });
        assert.equal(notARefund.status, 400);

        const asked = await ask({ kind: 'REFUND', payload, note: 'Agreed with the agency' });
        assert.equal(asked.status, 201, JSON.stringify(asked.body));
        assert.match(asked.body.reference, /^APR-\d{6}$/);
        assert.equal(asked.body.status, 'PENDING');
        assert.equal(asked.body.amountCents, 5_000);
        assert.equal(asked.body.subjectId, one.receivable.id);

        // The requester sees it; a desk with no part in approvals is refused at
        // the door; a desk that asks but did not ask this is answered as a
        // stranger; a partner is refused like any /admin route.
        assert.equal((await request(app).get(`/api/admin/approvals/${asked.body.id}`).set('Cookie', cookies.ACCOUNTANT)).status, 200);
        assert.equal((await request(app).get(`/api/admin/approvals/${asked.body.id}`).set('Cookie', cookies.MANAGEMENT)).status, 403);
        assert.equal((await request(app).get(`/api/admin/approvals/${asked.body.id}`).set('Cookie', cookies.FINANCE_OPERATOR)).status, 404);
        assert.equal((await request(app).get(`/api/admin/approvals/${asked.body.id}`).set('Cookie', cookies.AGENCY)).status, 403);

        // Not by the requester (403: theirs to see, not to decide), and not by
        // a role that only asks and has no part in this one (404: not theirs to see).
        assert.equal((await decide(asked.body.id, 'approve', cookies.ACCOUNTANT)).status, 403);
        assert.equal((await decide(asked.body.id, 'approve', cookies.FINANCE_OPERATOR)).status, 404);

        const approved = await decide(asked.body.id, 'approve', cookies.SUPER_ADMIN, { note: 'Fine' });
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        assert.equal(approved.body.status, 'APPROVED');
        assert.equal(approved.body.executedEntityType, 'PaymentRecord');

        const payment = await prisma.paymentRecord.findUnique({ where: { id: approved.body.executedEntityId }, include: { recordedByUser: true } });
        assert.equal(payment.kind, 'REFUND');
        assert.equal(payment.amountCents, 5_000);
        assert.equal(payment.idempotencyKey, `approval:${asked.body.id}`);
        assert.equal((await prisma.receivable.findUnique({ where: { id: one.receivable.id } })).paidCents, 15_000);

        const trail = await prisma.auditLog.findFirst({ where: { action: 'REFUND_RECORDED', entityId: payment.id } });
        assert.equal(trail.metadata.approvalId, asked.body.id);
        assert.ok(trail.metadata.requestedByUserId);

        // Decided is decided.
        assert.equal((await decide(asked.body.id, 'approve', cookies.SECOND)).status, 409);
        assert.equal((await decide(asked.body.id, 'reject', cookies.SECOND)).status, 409);
    });

    it('never lets a super admin approve what they asked for; a second one can', async () => {
        const one = await booked();
        const asked = await ask({ kind: 'RECEIVABLE_WAIVE', subjectId: one.receivable.id, payload: { waive: true, reason: 'Uncollectable' } }, cookies.SUPER_ADMIN);
        assert.equal(asked.status, 201, JSON.stringify(asked.body));
        assert.equal(asked.body.amountCents, 20_000);

        const own = await decide(asked.body.id, 'approve', cookies.SUPER_ADMIN);
        assert.equal(own.status, 403);
        assert.equal(own.body.error.details.reason, 'SELF_APPROVAL');

        const approved = await decide(asked.body.id, 'approve', cookies.SECOND);
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        assert.equal((await prisma.receivable.findUnique({ where: { id: one.receivable.id } })).status, 'WAIVED');

        const waived = await prisma.auditLog.findFirst({ where: { action: 'RECEIVABLE_WAIVED', entityId: one.receivable.id } });
        assert.equal(waived.metadata.approvalId, asked.body.id);
    });

    it('rejects with a note, withdraws by the requester only, and leaves a request pending when approving fails', async () => {
        const one = await booked();

        const rejected = await ask({ kind: 'PAYABLE_OVERRIDE', subjectId: one.payable.id, payload: { amountOverrideCents: 10_000, reason: 'Agreed' } });
        assert.equal(rejected.status, 201, JSON.stringify(rejected.body));
        assert.equal((await decide(rejected.body.id, 'reject', cookies.FINANCE_OPERATOR)).status, 404, 'not theirs to see, let alone reject');
        assert.equal((await decide(rejected.body.id, 'reject', cookies.ACCOUNTANT)).status, 403, 'the requester withdraws, never rejects');
        const no = await decide(rejected.body.id, 'reject', cookies.SUPER_ADMIN, { note: 'Not agreed with me' });
        assert.equal(no.status, 200);
        assert.equal(no.body.status, 'REJECTED');
        assert.equal(no.body.decisionNote, 'Not agreed with me');
        assert.equal((await prisma.supplierPayable.findUnique({ where: { id: one.payable.id } })).amountOverrideCents, null);

        const withdrawn = await ask({ kind: 'PAYABLE_WAIVE', subjectId: one.payable.id, payload: { waive: true, reason: 'Supplier waived it' } });
        assert.equal((await decide(withdrawn.body.id, 'cancel', cookies.SUPER_ADMIN)).status, 403);
        assert.equal((await decide(withdrawn.body.id, 'cancel', cookies.ACCOUNTANT)).body.status, 'CANCELLED');

        // Asked while open, written off in the meantime: approving cannot run, and says so on the request.
        const stale = await ask({ kind: 'PAYABLE_OVERRIDE', subjectId: one.payable.id, payload: { amountOverrideCents: 5_000, reason: 'Late' } });
        assert.equal(stale.status, 201);
        const gone = await ask({ kind: 'PAYABLE_WAIVE', subjectId: one.payable.id, payload: { waive: true, reason: 'Gone' } });
        assert.equal((await decide(gone.body.id, 'approve', cookies.SUPER_ADMIN)).status, 200);

        const failed = await decide(stale.body.id, 'approve', cookies.SUPER_ADMIN);
        assert.equal(failed.status, 409);
        const still = await request(app).get(`/api/admin/approvals/${stale.body.id}`).set('Cookie', cookies.SUPER_ADMIN);
        assert.equal(still.body.status, 'PENDING');
        assert.match(still.body.lastError, /waived/i);
    });

    it('lists what each may see, counts the queue for approvers, and tells them', async () => {
        const one = await booked();
        const asked = await ask({ kind: 'RECEIVABLE_DUE_DATE', subjectId: one.receivable.id, payload: { dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), reason: 'Agreed' } }, cookies.FINANCE_OPERATOR);
        assert.equal(asked.status, 201, JSON.stringify(asked.body));

        const forApprover = await request(app).get('/api/admin/approvals?status=PENDING').set('Cookie', cookies.SUPER_ADMIN);
        assert.ok(forApprover.body.data.some((row) => row.id === asked.body.id));

        const forOther = await request(app).get('/api/admin/approvals?status=PENDING').set('Cookie', cookies.ACCOUNTANT);
        assert.ok(!forOther.body.data.some((row) => row.id === asked.body.id), 'a requester sees only their own');

        const badges = await request(app).get('/api/admin/badges').set('Cookie', cookies.SUPER_ADMIN);
        assert.ok(badges.body.pendingApprovals >= 1);
        assert.equal((await request(app).get('/api/admin/badges').set('Cookie', cookies.ACCOUNTANT)).body.pendingApprovals, null);

        // The approvers are told in-app; the requester is not told about their own asking.
        await drainOutbox({ limit: 100 });
        const told = await prisma.notification.findMany({ where: { kind: 'APPROVAL_REQUESTED', entityId: asked.body.id }, select: { recipientUserId: true } });
        const recipients = told.map((row) => row.recipientUserId);
        assert.ok(recipients.includes(users.SUPER_ADMIN.id) && recipients.includes(users.SECOND.id));
        assert.ok(!recipients.includes(users.FINANCE_OPERATOR.id) && !recipients.includes(users.ACCOUNTANT.id));

        const approved = await decide(asked.body.id, 'approve', cookies.SUPER_ADMIN);
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        assert.equal((await prisma.receivable.findUnique({ where: { id: one.receivable.id } })).dueAt.toISOString().slice(0, 10), asked.body.payload.dueAt.slice(0, 10));

        // And the requester hears how it went.
        await drainOutbox({ limit: 100 });
        // The rows, not this process's mail outbox: with the whole suite
        // running, another file's drain may have taken the event first, and
        // its mail then went out from there. The template itself is covered
        // by mailer.test.js.
        const decided = await prisma.notification.findMany({ where: { kind: 'APPROVAL_DECIDED', entityId: asked.body.id }, select: { recipientUserId: true } });
        assert.deepEqual(decided.map((row) => row.recipientUserId), [users.FINANCE_OPERATOR.id]);
    });
});
