import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import { clearOutbox } from '../lib/mailer/index.js';
import { TOPICS } from '../lib/outbox.js';
import { syncBookingInTx } from '../services/finance/ledger.service.js';
import { processEvent } from '../services/notifications/outbox.service.js';
import { refreshFromProvider } from '../services/payments/psp-payment.service.js';
import { createTracker, databaseAvailable, makeAdmin, makeTransferBooking, makeTransferPoint, makeTransferProvider, makeTransferVehicle, signIn, testEmail } from './support/factories.js';
import { startFlittStub } from './support/flitt.stub.js';

/**
 * Money back to the card: one person asks, another approves, the outbox
 * sends the reversal to the gateway with the refund's own idempotent key,
 * and the ledger follows the gateway's answer — never the other way round.
 */
const app = createApp();
const dbAvailable = await databaseAvailable();

describe('card payments: refunds', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const saved = { ...config.payments.flitt };
    const cookies = {};
    let stub;
    let vehicle;
    let from;
    let to;
    const receivableIds = [];

    before(async () => {
        stub = await startFlittStub();
        Object.assign(config.payments.flitt, {
            enabled: true,
            mode: 'test',
            merchantId: stub.merchantId,
            secretKey: stub.secretKey,
            apiBaseUrl: stub.url,
            callbackUrl: 'http://localhost:5000/api/payments/flitt/callback',
            returnUrl: 'http://localhost:5000/api/payments/flitt/return',
            returnTokenSecret: 'test-return-secret-of-at-least-32-characters',
            orderPrefix: 'IAGREF',
            statusPollMinSeconds: 0,
            callbackIpEnforce: false,
            currencies: ['GEL']
        });

        // ACCOUNTANT asks; SUPER_ADMIN (someone else) approves. FINANCE_OPERATOR may not ask.
        for (const role of ['ACCOUNTANT', 'SUPER_ADMIN', 'FINANCE_OPERATOR', 'DISPATCHER']) {
            const user = await makeAdmin(tracker, { role });
            cookies[role] = (await signIn(app, user.email)).cookie;
        }

        const policy = await prisma.paymentPolicy.create({ data: { name: `Flitt refund pay later ${Date.now()}`, timing: 'PAY_LATER', productKind: 'TRANSFER' } });
        const provider = tracker.transferProvider(await makeTransferProvider({ paymentPolicyId: policy.id }));
        vehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        from = tracker.transferPoint(await makeTransferPoint());
        to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));
    });

    after(async () => {
        Object.assign(config.payments.flitt, saved);
        await prisma.pspCallbackEvent.deleteMany({ where: { payment: { receivableId: { in: receivableIds } } } });
        await prisma.pspRefund.deleteMany({ where: { payment: { receivableId: { in: receivableIds } } } });
        await prisma.pspPayment.deleteMany({ where: { receivableId: { in: receivableIds } } });
        await stub.close();
        await tracker.cleanup();
        await prisma.paymentPolicy.deleteMany({ where: { productKind: 'TRANSFER', name: { startsWith: 'Flitt refund ' } } });
        await disconnect();
    });

    beforeEach(() => {
        stub.reset();
        clearOutbox();
    });

    /** A guest transfer paid by card: APPROVED payment, PAID receivable. */
    const paid = async () => {
        const booking = await makeTransferBooking(tracker, { vehicleId: vehicle.id, from, to, leadPassengerEmail: testEmail('refundee') });
        await prisma.$transaction((tx) => syncBookingInTx(tx, 'TRANSFER', booking.id));
        const receivable = await prisma.receivable.findUnique({ where: { transferBookingId: booking.id } });
        receivableIds.push(receivable.id);

        const opened = await request(app).post('/api/payments').send({ reference: booking.reference, email: booking.leadPassengerEmail });
        assert.equal(opened.status, 201, JSON.stringify(opened.body));
        const row = await prisma.pspPayment.findUnique({ where: { id: opened.body.id } });
        stub.approve(row.merchantOrderId);
        await refreshFromProvider(row.id);

        return { booking, receivable, payment: await prisma.pspPayment.findUnique({ where: { id: row.id } }) };
    };

    const ask = (paymentId, body, cookie = cookies.ACCOUNTANT) => request(app).post(`/api/admin/payments/${paymentId}/refunds`).set('Cookie', cookie).send(body);
    const approve = (approvalId, cookie = cookies.SUPER_ADMIN) => request(app).post(`/api/admin/approvals/${approvalId}/approve`).set('Cookie', cookie).send({ note: 'Fine' });
    const refundEvent = async (refundId) => prisma.outboxEvent.findFirst({ where: { topic: TOPICS.PSP_REFUND_REQUESTED, entityId: refundId } });
    const refundOf = (approvalId) => prisma.pspRefund.findFirst({ where: { approvalRequestId: approvalId } });

    it('asks, approves, reverses at the gateway with an idempotent key, then writes the ledger refund', async () => {
        const { payment, receivable } = await paid();

        const asked = await ask(payment.id, { amountCents: 5_000, reason: 'Late pickup, goodwill' });
        assert.equal(asked.status, 201, JSON.stringify(asked.body));
        assert.equal(asked.body.kind, 'REFUND');
        assert.equal(asked.body.amountCents, 5_000);

        // Nothing moved yet.
        assert.equal(await prisma.pspRefund.count({ where: { paymentId: payment.id } }), 0);

        const approved = await approve(asked.body.id);
        assert.equal(approved.status, 200, JSON.stringify(approved.body));

        const refund = await refundOf(asked.body.id);
        assert.ok(refund);
        assert.equal(refund.status, 'REQUESTED');
        assert.equal(refund.reverseId, refund.id);
        assert.equal(refund.paymentRecordId, null, 'the ledger waits for the gateway');
        assert.equal(stub.requests.filter((r) => r.path === '/api/reverse/order_id').length, 0, 'the gateway is never called inside the approval transaction');

        const event = await refundEvent(refund.id);
        assert.ok(event);
        assert.equal(await processEvent(event), true);

        const sent = stub.requests.find((r) => r.path === '/api/reverse/order_id').request;
        assert.equal(sent.amount, 5_000);
        assert.equal(sent.reverse_id, refund.id);

        const done = await prisma.pspRefund.findUnique({ where: { id: refund.id }, include: { paymentRecord: { include: { allocations: true } } } });
        assert.equal(done.status, 'APPROVED');
        assert.ok(done.providerTransactionId);
        assert.equal(done.paymentRecord.kind, 'REFUND');
        assert.equal(done.paymentRecord.direction, 'OUT');
        assert.equal(done.paymentRecord.method, 'CARD');
        assert.equal(done.paymentRecord.amountCents, 5_000);
        assert.equal(done.paymentRecord.idempotencyKey, `flitt:refund:${refund.id}`);
        assert.deepEqual(done.paymentRecord.allocations.map((a) => [a.receivableId, a.amountCents]), [[receivable.id, -5_000]]);

        const after = await prisma.receivable.findUnique({ where: { id: receivable.id } });
        assert.equal(after.paidCents, 15_000);
        assert.equal(after.status, 'PARTIAL');

        const row = await prisma.pspPayment.findUnique({ where: { id: payment.id } });
        assert.equal(row.reversedCents, 5_000);
        assert.equal(row.status, 'APPROVED');

        // Idempotent: the same event again does nothing.
        assert.equal(await processEvent(event), true);
        assert.equal(await prisma.paymentRecord.count({ where: { pspRefund: { id: refund.id } } }), 1);
        assert.equal(stub.requests.filter((r) => r.path === '/api/reverse/order_id').length, 1);

        const detail = await request(app).get(`/api/admin/payments/${payment.id}`).set('Cookie', cookies.ACCOUNTANT);
        assert.equal(detail.body.refundableCents, 15_000);
        assert.equal(detail.body.refunds[0].status, 'APPROVED');
    });

    it('marks the payment REVERSED when the rest goes back too, and refuses more than was charged', async () => {
        const { payment } = await paid();

        assert.equal((await ask(payment.id, { amountCents: 20_001, reason: 'Too much' })).status, 422);

        const asked = await ask(payment.id, { amountCents: 20_000, reason: 'Cancelled by the operator' });
        await approve(asked.body.id);
        const refund = await refundOf(asked.body.id);
        await processEvent(await refundEvent(refund.id));

        const row = await prisma.pspPayment.findUnique({ where: { id: payment.id } });
        assert.equal(row.status, 'REVERSED');
        assert.equal(row.reversedCents, 20_000);
        assert.equal((await ask(payment.id, { amountCents: 1, reason: 'Nothing left' })).status, 409);
    });

    it('counts refunds in flight against what can still be asked for', async () => {
        const { payment } = await paid();

        const first = await ask(payment.id, { amountCents: 15_000, reason: 'Part one' });
        await approve(first.body.id);
        assert.equal((await ask(payment.id, { amountCents: 10_000, reason: 'Part two' })).status, 422, 'only 5,000 is left while part one is in flight');
        assert.equal((await ask(payment.id, { amountCents: 5_000, reason: 'Part two' })).status, 201);
    });

    it('retries a dropped connection with the same key, and declines what the gateway refuses', async () => {
        const { payment } = await paid();
        const asked = await ask(payment.id, { amountCents: 3_000, reason: 'Retry me' });
        await approve(asked.body.id);
        const refund = await refundOf(asked.body.id);
        const event = await refundEvent(refund.id);

        stub.failNext(503, { path: '/api/reverse/order_id' });
        assert.equal(await processEvent(event), false, 'a dropped connection is a failed attempt, retried by the drain');
        let row = await prisma.pspRefund.findUnique({ where: { id: refund.id } });
        assert.equal(row.status, 'FAILED');
        assert.ok(row.lastError);

        const again = await prisma.outboxEvent.findUnique({ where: { id: event.id } });
        assert.equal(await processEvent(again), true);
        row = await prisma.pspRefund.findUnique({ where: { id: refund.id } });
        assert.equal(row.status, 'APPROVED');
        assert.equal(stub.requests.filter((r) => r.path === '/api/reverse/order_id').map((r) => r.request.reverse_id).every((id) => id === refund.id), true);

        // A refusal the gateway means: declined, finance told, nothing in the ledger.
        const second = await ask(payment.id, { amountCents: 2_000, reason: 'Will be refused' });
        await approve(second.body.id);
        const declined = await refundOf(second.body.id);
        stub.reverseOutcome = 'declined';
        assert.equal(await processEvent(await refundEvent(declined.id)), true);

        const refused = await prisma.pspRefund.findUnique({ where: { id: declined.id } });
        assert.equal(refused.status, 'DECLINED');
        assert.equal(refused.responseCode, 1069);
        assert.equal(refused.paymentRecordId, null);
        assert.ok(await prisma.outboxEvent.findFirst({ where: { topic: TOPICS.PSP_ALERT, entityId: payment.id, payload: { path: ['kind'], equals: 'REFUND_FAILED' } } }));
        assert.equal((await prisma.pspPayment.findUnique({ where: { id: payment.id } })).reversedCents, 3_000);
    });

    it('keeps the maker-checker: the asker cannot approve, a dispatcher cannot ask', async () => {
        const { payment } = await paid();

        assert.equal((await ask(payment.id, { amountCents: 100, reason: 'x' }, cookies.DISPATCHER)).status, 403);
        // A finance operator may ask (finance.refunds.request) but never decide.
        const byOperator = await ask(payment.id, { amountCents: 100, reason: 'Operator asks' }, cookies.FINANCE_OPERATOR);
        assert.equal(byOperator.status, 201);
        assert.ok([403, 404].includes((await approve(byOperator.body.id, cookies.FINANCE_OPERATOR)).status));

        const asked = await ask(payment.id, { amountCents: 100, reason: 'Self' }, cookies.SUPER_ADMIN);
        assert.equal(asked.status, 201);
        assert.ok([403, 409].includes((await approve(asked.body.id, cookies.SUPER_ADMIN)).status), 'never one\'s own request');
        assert.equal((await approve(asked.body.id, cookies.ACCOUNTANT)).status, 403);
    });
});
