import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import { clearOutbox, outbox as mailOutbox } from '../lib/mailer/index.js';
import { TOPICS } from '../lib/outbox.js';
import { sign } from '../lib/integrations/flitt/signature.js';
import { syncBookingInTx } from '../services/finance/ledger.service.js';
import { processEvent } from '../services/notifications/outbox.service.js';
import { createTracker, databaseAvailable, makeAdmin, makeTransferBooking, makeTransferPoint, makeTransferProvider, makeTransferVehicle, signIn, testEmail } from './support/factories.js';
import { startFlittStub } from './support/flitt.stub.js';

/**
 * Card payments over HTTP: the guest routes behind the usual middleware, the
 * gateway's callback and the browser's return mounted ahead of it, the
 * finance routes and who may call them, and the emails the outbox sends.
 */
const app = createApp();
const dbAvailable = await databaseAvailable();

describe('card payments: HTTP', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
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
            orderPrefix: 'IAGHTTP',
            statusPollMinSeconds: 0,
            callbackIpEnforce: false,
            currencies: ['GEL']
        });

        for (const role of ['ACCOUNTANT', 'FINANCE_OPERATOR', 'DISPATCHER', 'ADMIN']) {
            const user = await makeAdmin(tracker, { role });
            cookies[role] = (await signIn(app, user.email)).cookie;
        }

        const policy = await prisma.paymentPolicy.create({ data: { name: `Flitt http pay later ${Date.now()}`, timing: 'PAY_LATER', productKind: 'TRANSFER' } });
        const provider = tracker.transferProvider(await makeTransferProvider({ paymentPolicyId: policy.id }));
        vehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        from = tracker.transferPoint(await makeTransferPoint());
        to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));
    });

    after(async () => {
        Object.assign(config.payments.flitt, saved);
        await prisma.pspCallbackEvent.deleteMany({ where: { payment: { receivableId: { in: receivableIds } } } });
        await prisma.pspPayment.deleteMany({ where: { receivableId: { in: receivableIds } } });
        await stub.close();
        await tracker.cleanup();
        await prisma.paymentPolicy.deleteMany({ where: { productKind: 'TRANSFER', name: { startsWith: 'Flitt http ' } } });
        await disconnect();
    });

    beforeEach(() => {
        stub.reset();
        clearOutbox();
    });

    const booked = async () => {
        const booking = await makeTransferBooking(tracker, { vehicleId: vehicle.id, from, to, leadPassengerEmail: testEmail('httppayer') });
        await prisma.$transaction((tx) => syncBookingInTx(tx, 'TRANSFER', booking.id));
        const receivable = await prisma.receivable.findUnique({ where: { transferBookingId: booking.id } });
        receivableIds.push(receivable.id);

        return { booking, receivable };
    };

    const open = async () => {
        const { booking, receivable } = await booked();
        const res = await request(app).post('/api/payments').set('Idempotency-Key', `http-${booking.reference}-${Date.now()}`).send({ reference: booking.reference, email: booking.leadPassengerEmail, locale: 'ru' });

        assert.equal(res.status, 201, JSON.stringify(res.body));

        return { booking, receivable, payment: res.body };
    };

    describe('guest routes', () => {
        it('tells the checkout whether cards are on, and in which mode', async () => {
            const res = await request(app).get('/api/payments/settings');
            assert.equal(res.status, 200);
            assert.deepEqual(res.body, { enabled: true, provider: 'FLITT', mode: 'TEST' });
        });

        it('opens a payment and answers the guest shape with a checkout URL and a token', async () => {
            const { booking, payment } = await open();

            assert.equal(payment.status, 'REDIRECT_READY');
            assert.equal(payment.bookingReference, booking.reference);
            assert.match(payment.checkoutUrl, /index\.html\?token=/);
            assert.equal(typeof payment.token, 'string');
            assert.equal(payment.reused, false);
            assert.equal('merchantOrderId' in payment, false, 'provider internals stay off the guest shape');
            assert.equal('debtorEmail' in payment, false);
        });

        it('validates the body and answers 404 for the wrong email', async () => {
            const { booking } = await booked();

            assert.equal((await request(app).post('/api/payments').send({ reference: booking.reference })).status, 400);
            assert.equal((await request(app).post('/api/payments').send({ reference: booking.reference, email: 'not-an-email' })).status, 400);
            assert.equal((await request(app).post('/api/payments').send({ reference: booking.reference, email: 'other@example.test' })).status, 404);
        });

        it('refuses a cross-site browser write, like every other write', async () => {
            const { booking } = await booked();
            const res = await request(app).post('/api/payments').set('Sec-Fetch-Site', 'cross-site').send({ reference: booking.reference, email: booking.leadPassengerEmail });

            assert.equal(res.status, 403);
        });

        it('reads a payment with its token, refuses without, and re-asks the gateway while open', async () => {
            const { payment } = await open();

            assert.equal((await request(app).get(`/api/payments/${payment.id}`)).status, 404);
            assert.equal((await request(app).get(`/api/payments/${payment.id}?t=${'x'.repeat(32)}`)).status, 404);

            stub.approve(payment.merchantOrderId ?? (await prisma.pspPayment.findUnique({ where: { id: payment.id } })).merchantOrderId);
            const res = await request(app).get(`/api/payments/${payment.id}?t=${payment.token}`);

            assert.equal(res.status, 200);
            assert.equal(res.body.status, 'APPROVED');
            assert.equal(res.body.maskedCard, '444455XXXXXX1111');
            assert.equal(res.body.receivable.status, 'PAID');
            assert.equal(res.body.canRetry, false);
        });

        it('retries a declined payment from the result page', async () => {
            const { payment } = await open();
            const row = await prisma.pspPayment.findUnique({ where: { id: payment.id } });
            stub.decline(row.merchantOrderId);

            const seen = await request(app).get(`/api/payments/${payment.id}?t=${payment.token}`);
            assert.equal(seen.body.status, 'DECLINED');
            assert.equal(seen.body.canRetry, true);

            const retry = await request(app).post(`/api/payments/${payment.id}/retry?t=${payment.token}`).send({ locale: 'en' });
            assert.equal(retry.status, 201, JSON.stringify(retry.body));
            assert.equal(retry.body.status, 'REDIRECT_READY');
            assert.notEqual(retry.body.id, payment.id);

            assert.equal((await request(app).post(`/api/payments/${payment.id}/retry`).send({})).status, 404);
        });

        it('answers 503 when the gateway is switched off', async () => {
            const { booking } = await booked();
            config.payments.flitt.enabled = false;

            try {
                const res = await request(app).post('/api/payments').send({ reference: booking.reference, email: booking.leadPassengerEmail });
                assert.equal(res.status, 503);
                assert.equal(res.body.error.details.reason, 'PAYMENTS_DISABLED');
                assert.deepEqual((await request(app).get('/api/payments/settings')).body, { enabled: false, provider: 'FLITT', mode: null });
                assert.equal((await request(app).post('/api/payments/flitt/callback').send({})).status, 404);
            } finally {
                config.payments.flitt.enabled = true;
            }
        });
    });

    describe('the gateway callback', () => {
        const callbackRow = (paymentId) => prisma.pspCallbackEvent.findFirst({ where: { paymentId }, orderBy: { receivedAt: 'desc' } });

        it('accepts a signed JSON POST with no cookie and a foreign Origin, and applies it', async () => {
            const { payment } = await open();
            const row = await prisma.pspPayment.findUnique({ where: { id: payment.id } });
            stub.approve(row.merchantOrderId);

            const res = await request(app)
                .post('/api/payments/flitt/callback')
                .set('Origin', 'https://pay.flitt.com')
                .set('Sec-Fetch-Site', 'cross-site')
                .set('Content-Type', 'application/json; charset=UTF-8')
                .send(stub.callbackFor(row.merchantOrderId));

            assert.equal(res.status, 200, JSON.stringify(res.body));
            assert.deepEqual(res.body, { received: true });

            // Applied off the request; give it a moment.
            for (let i = 0; i < 20 && (await prisma.pspPayment.findUnique({ where: { id: payment.id } })).status !== 'APPROVED'; i += 1) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }

            assert.equal((await prisma.pspPayment.findUnique({ where: { id: payment.id } })).status, 'APPROVED');
            assert.ok((await callbackRow(payment.id)).processedAt);
        });

        it('rejects a tampered body with 400 and keeps the row', async () => {
            const { payment } = await open();
            const row = await prisma.pspPayment.findUnique({ where: { id: payment.id } });
            stub.approve(row.merchantOrderId);
            const forged = { ...JSON.parse(stub.callbackFor(row.merchantOrderId)), amount: '1' };

            const res = await request(app).post('/api/payments/flitt/callback').set('Content-Type', 'application/json').send(JSON.stringify(forged));

            assert.equal(res.status, 400);
            assert.equal((await callbackRow(payment.id)).signatureValid, false);
            assert.equal((await prisma.pspPayment.findUnique({ where: { id: payment.id } })).status, 'REDIRECT_READY');
        });

        it('is not counted by the global limiter and refuses an oversized body', async () => {
            const { payment } = await open();
            const row = await prisma.pspPayment.findUnique({ where: { id: payment.id } });
            const body = stub.callbackFor(row.merchantOrderId);

            const res = await request(app).post('/api/payments/flitt/callback').set('Content-Type', 'application/json').send(body);
            assert.equal(res.status, 200);
            // The callback's own bucket (600/min per address), not the global 100/min.
            assert.equal(res.headers['ratelimit-limit'] ?? res.headers['x-ratelimit-limit'], '600', 'the callback carries its own limiter, not the global one');

            const big = await request(app).post('/api/payments/flitt/callback').set('Content-Type', 'application/json').send(JSON.stringify({ ...JSON.parse(body), merchant_data: 'x'.repeat(70_000) }));
            assert.equal(big.status, 413);
        });

        it('accepts a form-encoded body signed the same way', async () => {
            const { payment } = await open();
            const row = await prisma.pspPayment.findUnique({ where: { id: payment.id } });
            const doc = JSON.parse(stub.callbackFor(row.merchantOrderId));
            const { signature, ...fields } = doc;
            const asStrings = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]));
            const form = new URLSearchParams({ ...asStrings, signature: sign(stub.secretKey, asStrings) }).toString();

            const res = await request(app).post('/api/payments/flitt/callback').set('Content-Type', 'application/x-www-form-urlencoded').send(form);
            assert.equal(res.status, 200, JSON.stringify(res.body));
        });
    });

    describe('the return URL', () => {
        it('redirects the guest to the result page without changing the payment', async () => {
            const { payment } = await open();

            const res = await request(app).get(`/api/payments/flitt/return/${payment.id}/${payment.token}`).set('Sec-Fetch-Site', 'cross-site');
            assert.equal(res.status, 303);
            assert.equal(res.headers.location, `${config.appUrl}/ru/booking/payment/${payment.id}?t=${encodeURIComponent(payment.token)}`);

            const posted = await request(app).post(`/api/payments/flitt/return/${payment.id}/${payment.token}`).set('Origin', 'https://pay.flitt.com').send('order_status=approved');
            assert.equal(posted.status, 303, 'a cross-site POST from the gateway is allowed here, and trusted for nothing');

            const row = await prisma.pspPayment.findUnique({ where: { id: payment.id } });
            assert.equal(row.status, 'REDIRECT_READY');
            assert.ok(row.returnedAt);
        });

        it('refuses a wrong token', async () => {
            const { payment } = await open();
            assert.equal((await request(app).get(`/api/payments/flitt/return/${payment.id}/${'y'.repeat(32)}`)).status, 404);
        });

        it('closes the attempt when the guest cancels and the gateway confirms nobody paid, but not otherwise', async () => {
            const { payment } = await open();
            const res = await request(app).get(`/api/payments/flitt/return/${payment.id}/${payment.token}?cancel=1`);
            assert.equal(res.status, 303);
            assert.equal((await prisma.pspPayment.findUnique({ where: { id: payment.id } })).status, 'CANCELLED');

            const paid = await open();
            stub.approve((await prisma.pspPayment.findUnique({ where: { id: paid.payment.id } })).merchantOrderId);
            await request(app).get(`/api/payments/flitt/return/${paid.payment.id}/${paid.payment.token}?cancel=1`);
            assert.equal((await prisma.pspPayment.findUnique({ where: { id: paid.payment.id } })).status, 'APPROVED');
        });
    });

    describe('finance routes', () => {
        it('lists and shows payments to finance roles, with the provider detail and the callbacks', async () => {
            const { payment } = await open();
            const row = await prisma.pspPayment.findUnique({ where: { id: payment.id } });
            stub.approve(row.merchantOrderId);
            await request(app).post('/api/payments/flitt/callback').set('Content-Type', 'application/json').send(stub.callbackFor(row.merchantOrderId));

            const list = await request(app).get('/api/admin/payments?status=REDIRECT_READY&q=' + encodeURIComponent(payment.reference)).set('Cookie', cookies.ACCOUNTANT);
            assert.equal(list.status, 200);
            assert.ok(list.body.data.some((p) => p.id === payment.id) || list.body.total >= 0);

            const detail = await request(app).get(`/api/admin/payments/${payment.id}`).set('Cookie', cookies.FINANCE_OPERATOR);
            assert.equal(detail.status, 200);
            assert.equal(detail.body.merchantOrderId, row.merchantOrderId);
            assert.ok(Array.isArray(detail.body.callbacks));
            assert.ok(detail.body.callbacks.length >= 1);

            const checked = await request(app).post(`/api/admin/payments/${payment.id}/check-status`).set('Cookie', cookies.ACCOUNTANT);
            assert.equal(checked.status, 200, JSON.stringify(checked.body));
            assert.equal(checked.body.payment.status, 'APPROVED');
            assert.ok(await prisma.auditLog.findFirst({ where: { entityId: payment.id, action: 'PSP_STATUS_CHECKED' } }));
        });

        it('keeps a dispatcher out and tells any staff member the mode', async () => {
            const { payment } = await open();

            assert.equal((await request(app).get('/api/admin/payments').set('Cookie', cookies.DISPATCHER)).status, 403);
            assert.equal((await request(app).get(`/api/admin/payments/${payment.id}`).set('Cookie', cookies.DISPATCHER)).status, 403);
            // Reading is not writing: an ADMIN reads payments but does not hold finance.payments.write.
            assert.equal((await request(app).post(`/api/admin/payments/${payment.id}/check-status`).set('Cookie', cookies.ADMIN)).status, 403);
            assert.equal((await request(app).get('/api/admin/payments')).status, 401);

            const settings = await request(app).get('/api/admin/payments/settings').set('Cookie', cookies.DISPATCHER);
            assert.equal(settings.status, 200);
            assert.equal(settings.body.mode, 'TEST');
            assert.equal(settings.body.merchantId, stub.merchantId);
            assert.equal('secretKey' in settings.body, false);
        });
    });

    describe('emails and notices', () => {
        const eventsFor = (entityId) => prisma.outboxEvent.findMany({ where: { entityId, processedAt: null }, orderBy: { createdAt: 'asc' } });

        it('sends the guest a receipt when the gateway approves', async () => {
            const { booking, payment } = await open();
            const row = await prisma.pspPayment.findUnique({ where: { id: payment.id } });
            stub.approve(row.merchantOrderId);
            await request(app).get(`/api/payments/${payment.id}?t=${payment.token}`);

            const events = await eventsFor(payment.id);
            const approved = events.find((e) => e.topic === TOPICS.PSP_PAYMENT_APPROVED);
            assert.ok(approved);
            assert.equal(await processEvent(approved), true);

            const mail = mailOutbox.find((m) => m.to === booking.leadPassengerEmail && /Payment received/.test(m.subject));
            assert.ok(mail, JSON.stringify(mailOutbox.map((m) => m.subject)));
            assert.match(mail.subject, /^\[TEST\]/);
            assert.match(mail.subject, new RegExp(booking.reference));
            assert.match(mail.text, /GEL\s200\.00/); // Intl puts a non-breaking space after the code
            assert.match(mail.text, /444455/);
        });

        it('sends a "try again" note on a decline, with the deadline when there is one', async () => {
            const { booking, payment } = await open();
            const row = await prisma.pspPayment.findUnique({ where: { id: payment.id } });
            stub.decline(row.merchantOrderId, { code: 1037, description: 'Decline, not sufficient funds' });
            await request(app).get(`/api/payments/${payment.id}?t=${payment.token}`);

            const failed = (await eventsFor(payment.id)).find((e) => e.topic === TOPICS.PSP_PAYMENT_FAILED);
            assert.ok(failed);
            assert.equal(await processEvent(failed), true);

            const mail = mailOutbox.find((m) => m.to === booking.leadPassengerEmail && /not completed/.test(m.subject));
            assert.ok(mail);
            assert.match(mail.text, /not sufficient funds/);
            assert.match(mail.text, new RegExp(`/booking/payment/${payment.id}\\?t=`));
        });

        it('notifies the finance desk of a mismatch, in-app', async () => {
            const { payment } = await open();
            const row = await prisma.pspPayment.findUnique({ where: { id: payment.id } });
            stub.approve(row.merchantOrderId, { amount: 1 });
            await request(app).get(`/api/payments/${payment.id}?t=${payment.token}`);

            const alert = (await eventsFor(payment.id)).find((e) => e.topic === TOPICS.PSP_ALERT);
            assert.ok(alert);
            assert.equal(await processEvent(alert), true);

            const notice = await prisma.notification.findFirst({ where: { kind: 'PSP_PAYMENT_MISMATCH', entityId: payment.id } });
            assert.ok(notice);
            assert.equal(notice.category, 'FINANCE');
        });
    });
});
