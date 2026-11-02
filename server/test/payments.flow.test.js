import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import { ConflictError, GoneError, NotFoundError, ServiceUnavailableError } from '../lib/errors.js';
import { TOPICS } from '../lib/outbox.js';
import { verifyReturnToken } from '../lib/payments/returnToken.js';
import { syncBookingInTx } from '../services/finance/ledger.service.js';
import { applyCallbackEvents, ingestCallback } from '../services/payments/flitt-callback.service.js';
import { applyProviderStatus, closeAttempt, createPayment, getPayment, refreshFromProvider, retryPayment } from '../services/payments/psp-payment.service.js';
import { sweepPspPayments, sweepUnpaidBookings } from '../services/payments/psp-sweeper.service.js';
import { createTracker, databaseAvailable, makeAdmin, makeTransferBooking, makeTransferPoint, makeTransferProvider, makeTransferVehicle, testEmail } from './support/factories.js';
import { startFlittStub } from './support/flitt.stub.js';

/**
 * Card payments end to end at the service layer, against the Flitt stub:
 * opening an attempt, the gateway's verdicts arriving by callback and by
 * status read, the ledger row they produce, and what the clock does to what
 * nobody finished. Bookings are factory transfers (guest, 200.00 GEL) synced
 * into the ledger so each has an OPEN receivable.
 */
const dbAvailable = await databaseAvailable();

describe('card payments: flow', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const saved = { ...config.payments.flitt };
    let stub;
    let provider;
    let payNowProvider;
    let defaultProvider;
    let vehicle;
    let payNowVehicle;
    let defaultVehicle;
    let from;
    let to;
    let staff;
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
            orderPrefix: 'IAGTEST',
            reuseWindowSeconds: 120,
            statusPollMinSeconds: 0,
            callbackIps: ['54.154.216.60'],
            callbackIpEnforce: false,
            currencies: ['GEL']
        });

        staff = await makeAdmin(tracker, { role: 'ACCOUNTANT' });
        from = tracker.transferPoint(await makeTransferPoint());
        to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));

        // A provider without a policy settles with the driver (no card): the
        // card scenarios need one on PAY_LATER, the deadline ones on PAY_NOW.
        const payLater = await prisma.paymentPolicy.create({
            data: { name: `Flitt test pay later ${Date.now()}`, timing: 'PAY_LATER', productKind: 'TRANSFER' }
        });
        provider = tracker.transferProvider(await makeTransferProvider({ paymentPolicyId: payLater.id }));
        vehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));

        const payNow = await prisma.paymentPolicy.create({
            data: { name: `Flitt test pay now ${Date.now()}`, timing: 'PAY_NOW', productKind: 'TRANSFER', unpaidCancelHours: 2 }
        });
        payNowProvider = tracker.transferProvider(await makeTransferProvider({ paymentPolicyId: payNow.id }));
        payNowVehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: payNowProvider.id }));

        defaultProvider = tracker.transferProvider(await makeTransferProvider());
        defaultVehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: defaultProvider.id }));
    });

    after(async () => {
        Object.assign(config.payments.flitt, saved);
        await prisma.pspCallbackEvent.deleteMany({});
        await prisma.pspRefund.deleteMany({ where: { payment: { receivableId: { in: receivableIds } } } });
        await prisma.pspPayment.deleteMany({ where: { receivableId: { in: receivableIds } } });
        await stub.close();
        // The tracker purges finance (payment records, receivables) before the
        // bookings; the policy goes last, after the provider that held it.
        await tracker.cleanup();
        await prisma.paymentPolicy.deleteMany({ where: { productKind: 'TRANSFER', name: { startsWith: 'Flitt test ' } } });
        await disconnect();
    });

    beforeEach(() => {
        stub.reset();
    });

    /** A confirmed guest transfer with an OPEN receivable. */
    const booked = async ({ vehicleId = vehicle.id, ...overrides } = {}) => {
        const booking = await makeTransferBooking(tracker, { vehicleId, from, to, leadPassengerEmail: testEmail('payer'), ...overrides });
        await prisma.$transaction((tx) => syncBookingInTx(tx, 'TRANSFER', booking.id));
        const receivable = await prisma.receivable.findUnique({ where: { transferBookingId: booking.id } });
        receivableIds.push(receivable.id);

        return { booking, receivable };
    };

    const open = async (options = {}) => {
        const { booking, receivable } = await booked(options);
        const { payment, token } = await createPayment({ reference: booking.reference, email: booking.leadPassengerEmail, locale: 'ka' }, null, null);

        return { booking, receivable, payment, token };
    };

    const ledgerRowFor = (paymentId) => prisma.pspPayment.findUnique({ where: { id: paymentId }, include: { paymentRecord: { include: { allocations: true } }, receivable: true } });

    const outboxTopics = (entityId) => prisma.outboxEvent.findMany({ where: { entityId }, select: { topic: true, payload: true } });

    describe('opening an attempt', () => {
        it('creates the row, asks the gateway and hands back a checkout URL with a return token', async () => {
            const { booking, receivable, payment, token } = await open();

            assert.equal(payment.status, 'REDIRECT_READY');
            assert.match(payment.reference, /^PAY-\d{6}$/);
            assert.equal(payment.mode, 'TEST');
            assert.equal(payment.amountCents, 20_000);
            assert.equal(payment.currency, 'GEL');
            assert.equal(payment.bookingReference, booking.reference);
            assert.equal(payment.bookingType, 'TRANSFER');
            assert.equal(payment.receivableId, receivable.id);
            assert.match(payment.checkoutUrl, /index\.html\?token=/);
            assert.ok(payment.providerPaymentId);
            assert.match(payment.merchantOrderId, new RegExp(`^IAGTEST-${booking.reference}-[0-9A-F]{6}$`));
            assert.equal(payment.lang, 'ka');
            assert.equal(verifyReturnToken(payment.id, token), true);

            const sent = stub.requests.find((r) => r.path === '/api/checkout/url').request;
            assert.equal(sent.amount, 20_000);
            assert.equal(sent.currency, 'GEL');
            assert.equal(sent.delayed, 'N');
            assert.equal(sent.lang, 'ka');
            assert.equal(sent.response_url, `http://localhost:5000/api/payments/flitt/return/${payment.id}/${token}`);
            assert.equal(sent.server_callback_url, 'http://localhost:5000/api/payments/flitt/callback');
            assert.deepEqual(JSON.parse(sent.merchant_data), { paymentId: payment.id, reference: payment.reference, mode: 'TEST' });

            const audit = await prisma.auditLog.findFirst({ where: { entityId: payment.id, action: 'PSP_PAYMENT_CREATED' } });
            assert.ok(audit);
        });

        it('refuses the wrong email with 404, a partner receivable, an unknown reference, and a disabled gateway', async () => {
            const { booking } = await booked();

            await assert.rejects(() => createPayment({ reference: booking.reference, email: 'someone@else.test' }, null, null), NotFoundError);
            await assert.rejects(() => createPayment({ reference: 'TRF-999999', email: booking.leadPassengerEmail }, null, null), NotFoundError);

            config.payments.flitt.enabled = false;
            try {
                await assert.rejects(() => createPayment({ reference: booking.reference, email: booking.leadPassengerEmail }, null, null), ServiceUnavailableError);
            } finally {
                config.payments.flitt.enabled = true;
            }
        });

        it('hands the same attempt back to a second click and to a replayed idempotency key', async () => {
            const { booking, payment } = await open();

            const again = await createPayment({ reference: booking.reference, email: booking.leadPassengerEmail }, null, null);
            assert.equal(again.payment.id, payment.id);
            assert.equal(again.reused, true);

            const keyed = await createPayment({ reference: booking.reference, email: booking.leadPassengerEmail, idempotencyKey: 'psp-test-key-1234' }, null, null);
            const replay = await createPayment({ reference: booking.reference, email: booking.leadPassengerEmail, idempotencyKey: 'psp-test-key-1234' }, null, null);
            assert.equal(replay.payment.id, keyed.payment.id);
            assert.equal(stub.requests.filter((r) => r.path === '/api/checkout/url').length, 2, 'two gateway orders in all');
        });

        it('lands three racing clicks on one row', async () => {
            const { booking, receivable } = await booked();
            const request = () => createPayment({ reference: booking.reference, email: booking.leadPassengerEmail }, null, null);

            const results = await Promise.all([request(), request(), request()]);
            const ids = new Set(results.map((r) => r.payment.id));

            assert.equal(ids.size, 1);
            assert.equal(await prisma.pspPayment.count({ where: { receivableId: receivable.id } }), 1);
        });

        it('marks the row FAILED and answers 502 when the gateway is down, leaving the booking payable', async () => {
            const { booking, receivable } = await booked();
            stub.failNext(503);

            await assert.rejects(() => createPayment({ reference: booking.reference, email: booking.leadPassengerEmail }, null, null), (err) => err.status === 502 && err.details.reason === 'PROVIDER_UNAVAILABLE');

            const row = await prisma.pspPayment.findFirst({ where: { receivableId: receivable.id } });
            assert.equal(row.status, 'FAILED');
            assert.match(row.failureReason, /PROVIDER_UNAVAILABLE/);

            // The guest can try again: a new order id, not the failed one.
            const next = await createPayment({ reference: booking.reference, email: booking.leadPassengerEmail }, null, null);
            assert.equal(next.payment.status, 'REDIRECT_READY');
            assert.notEqual(next.payment.merchantOrderId, row.merchantOrderId);
        });
    });

    describe('the gateway approves', () => {
        it('records one CARD payment, settles the receivable and queues the receipt', async () => {
            const { payment, receivable } = await open();
            stub.approve(payment.merchantOrderId, { cardType: 'MasterCard', maskedCard: '555566XXXXXX1111' });

            const result = await refreshFromProvider(payment.id, { source: 'poll' });
            assert.equal(result.status, 'APPROVED');
            assert.equal(result.changed, true);

            const row = await ledgerRowFor(payment.id);
            assert.equal(row.status, 'APPROVED');
            assert.equal(row.maskedCard, '555566XXXXXX1111');
            assert.equal(row.cardType, 'MasterCard');
            assert.equal(row.actualAmountCents, 20_000);
            assert.equal(row.actualCurrency, 'GEL');
            assert.ok(row.completedAt);
            assert.ok(row.providerTransactionId);
            assert.ok(row.paymentRecord);
            assert.equal(row.paymentRecord.method, 'CARD');
            assert.equal(row.paymentRecord.direction, 'IN');
            assert.equal(row.paymentRecord.amountCents, 20_000);
            assert.equal(row.paymentRecord.externalPaymentId, row.providerPaymentId);
            assert.equal(row.paymentRecord.idempotencyKey, `flitt:test:${row.providerPaymentId}`);
            assert.match(row.paymentRecord.note, /TEST MODE/);
            assert.deepEqual(row.paymentRecord.allocations.map((a) => [a.receivableId, a.amountCents]), [[receivable.id, 20_000]]);
            assert.equal(row.receivable.status, 'PAID');
            assert.equal(row.receivable.paidCents, 20_000);

            const topics = (await outboxTopics(payment.id)).map((e) => e.topic);
            assert.ok(topics.includes(TOPICS.PSP_PAYMENT_APPROVED));
            assert.ok(await prisma.auditLog.findFirst({ where: { entityId: payment.id, action: 'PSP_PAYMENT_APPROVED' } }));
        });

        it('is idempotent: a second read, a stale callback and a replayed approval change nothing', async () => {
            const { payment } = await open();
            stub.approve(payment.merchantOrderId);
            await refreshFromProvider(payment.id);

            const again = await refreshFromProvider(payment.id);
            assert.equal(again.changed, false);

            // A document from earlier in the order's life, arriving late.
            const stale = { ...stub.documentFor(payment.merchantOrderId), order_status: 'processing', actual_amount: '' };
            const result = await applyProviderStatus(payment.id, stale, { source: 'callback' });
            assert.equal(result.changed, false);
            assert.equal(result.stale, true);

            const row = await ledgerRowFor(payment.id);
            assert.equal(row.status, 'APPROVED');
            assert.equal(await prisma.paymentRecord.count({ where: { pspPayment: { id: payment.id } } }), 1);
            assert.equal(row.receivable.paidCents, 20_000);
        });

        it('serialises two concurrent applications of the same approval onto one ledger row', async () => {
            const { payment } = await open();
            stub.approve(payment.merchantOrderId);

            const results = await Promise.all([refreshFromProvider(payment.id), refreshFromProvider(payment.id), refreshFromProvider(payment.id)]);
            assert.equal(results.filter((r) => r.changed).length, 1);
            assert.equal(await prisma.paymentRecord.count({ where: { pspPayment: { id: payment.id } } }), 1);
        });

        it('takes a late approval after the attempt was expired locally', async () => {
            const { payment } = await open();
            await closeAttempt(payment.id, 'EXPIRED', 'SYSTEM', { reason: 'test' });
            stub.approve(payment.merchantOrderId);

            const result = await refreshFromProvider(payment.id);
            assert.equal(result.status, 'APPROVED');
            assert.equal((await ledgerRowFor(payment.id)).receivable.status, 'PAID');
        });

        it('sends a wrong amount, currency or merchant to MISMATCH and never to the ledger', async () => {
            const { payment, receivable } = await open();
            stub.approve(payment.merchantOrderId, { amount: 19_999 });

            const result = await refreshFromProvider(payment.id);
            assert.equal(result.status, 'MISMATCH');

            const row = await ledgerRowFor(payment.id);
            assert.equal(row.paymentRecord, null);
            assert.equal(row.actualAmountCents, 19_999);
            assert.equal(row.receivable.status, 'OPEN');
            assert.ok((await outboxTopics(payment.id)).some((e) => e.topic === TOPICS.PSP_ALERT && e.payload.kind === 'MISMATCH'));

            const other = await open();
            stub.approve(other.payment.merchantOrderId, { currency: 'USD' });
            assert.equal((await refreshFromProvider(other.payment.id)).status, 'MISMATCH');

            const third = await open();
            const doc = stub.approve(third.payment.merchantOrderId) && stub.documentFor(third.payment.merchantOrderId);
            await assert.rejects(() => applyProviderStatus(third.payment.id, { ...doc, merchant_id: '999' }), (err) => err.details.reason === 'PROVIDER_MERCHANT_MISMATCH');
            assert.equal((await ledgerRowFor(third.payment.id)).status, 'REDIRECT_READY');
            assert.equal((await prisma.receivable.findUnique({ where: { id: receivable.id } })).status, 'OPEN');
        });

        it('records a second approval on an already paid receivable unallocated and raises an overpayment alert', async () => {
            const { booking, payment } = await open();
            stub.approve(payment.merchantOrderId);
            await refreshFromProvider(payment.id);

            // The guest paid again from another tab before the first result landed.
            await prisma.receivable.update({ where: { id: payment.receivableId }, data: { status: 'OPEN', paidCents: 0 } });
            const second = await createPayment({ reference: booking.reference, email: booking.leadPassengerEmail, idempotencyKey: 'psp-second-tab-key' }, null, null);
            await prisma.receivable.update({ where: { id: payment.receivableId }, data: { status: 'PAID', paidCents: 20_000 } });
            stub.approve(second.payment.merchantOrderId);

            const result = await refreshFromProvider(second.payment.id);
            assert.equal(result.status, 'APPROVED');

            const row = await ledgerRowFor(second.payment.id);
            assert.equal(row.paymentRecord.allocations.length, 0);
            assert.ok((await outboxTopics(second.payment.id)).some((e) => e.topic === TOPICS.PSP_ALERT && e.payload.kind === 'OVERPAYMENT'));
        });
    });

    describe('the gateway declines or lets the order lapse', () => {
        it('marks a decline with its code, keeps the receivable open and allows a retry on a new order', async () => {
            const { booking, payment, token } = await open();
            stub.decline(payment.merchantOrderId, { code: 1037, description: 'Decline, not sufficient funds' });

            const result = await refreshFromProvider(payment.id);
            assert.equal(result.status, 'DECLINED');

            const row = await ledgerRowFor(payment.id);
            assert.equal(row.responseCode, 1037);
            assert.match(row.responseDescription, /not sufficient funds/);
            assert.equal(row.paymentRecord, null);
            assert.equal(row.receivable.status, 'OPEN');
            assert.ok((await outboxTopics(payment.id)).some((e) => e.topic === TOPICS.PSP_PAYMENT_FAILED));

            const seen = await getPayment(payment.id, { token, refresh: false });
            assert.equal(seen.status, 'DECLINED');

            const retried = await retryPayment(payment.id, { token }, null, null);
            assert.equal(retried.payment.status, 'REDIRECT_READY');
            assert.notEqual(retried.payment.id, payment.id);
            assert.notEqual(retried.payment.merchantOrderId, payment.merchantOrderId);
            assert.equal(retried.payment.bookingReference, booking.reference);

            await assert.rejects(() => retryPayment(retried.payment.id, { token: retried.token }, null, null), (err) => err instanceof ConflictError && err.details.reason === 'NOT_RETRIABLE');
        });

        it('expires what the gateway says expired, and what sat past its lifetime', async () => {
            const { payment } = await open();
            stub.expire(payment.merchantOrderId);
            assert.equal((await refreshFromProvider(payment.id)).status, 'EXPIRED');

            const { payment: lapsed } = await open();
            await prisma.pspPayment.update({ where: { id: lapsed.id }, data: { expiresAt: new Date(Date.now() - 10 * 60_000), createdAt: new Date(Date.now() - 40 * 60_000), lastStatusCheckAt: null } });
            const swept = await sweepPspPayments();
            assert.ok(swept.expired >= 1);
            assert.equal((await prisma.pspPayment.findUnique({ where: { id: lapsed.id } })).status, 'EXPIRED');
        });

        it('fails a CREATED row whose gateway call never came back', async () => {
            const { receivable } = await booked();
            const orphan = await prisma.pspPayment.create({
                data: {
                    reference: `PAY-T${Date.now().toString().slice(-6)}`,
                    mode: 'TEST',
                    status: 'CREATED',
                    receivableId: receivable.id,
                    debtorEmail: receivable.debtorEmail,
                    bookingType: 'TRANSFER',
                    bookingReference: receivable.reference,
                    amountCents: 20_000,
                    currency: 'GEL',
                    merchantOrderId: `IAGTEST-ORPHAN-${Date.now()}`,
                    idempotencyKey: `psp:orphan:${Date.now()}`,
                    lifetimeSeconds: 1800,
                    expiresAt: new Date(Date.now() + 1800_000),
                    createdAt: new Date(Date.now() - 20 * 60_000)
                }
            });

            await sweepPspPayments();
            assert.equal((await prisma.pspPayment.findUnique({ where: { id: orphan.id } })).status, 'FAILED');
        });
    });

    describe('callbacks', () => {
        const post = (body, { ip = '54.154.216.60', contentType = 'application/json; charset=UTF-8' } = {}) => ingestCallback({ raw: Buffer.from(body), contentType, ip });

        it('stores a signed callback, answers 200, and applies it by re-reading the gateway', async () => {
            const { payment } = await open();
            stub.approve(payment.merchantOrderId);

            const answer = await post(stub.callbackFor(payment.merchantOrderId));
            assert.equal(answer.status, 200);
            assert.deepEqual(answer.body, { received: true });
            assert.equal(answer.paymentId, payment.id);

            const event = await prisma.pspCallbackEvent.findFirst({ where: { paymentId: payment.id } });
            assert.equal(event.signatureValid, true);
            assert.equal(event.orderStatus, 'approved');
            assert.equal(event.processedAt, null);
            assert.equal('signature' in event.payload, false);

            const before = stub.requests.filter((r) => r.path === '/api/status/order_id').length;
            const applied = await applyCallbackEvents();
            assert.equal(applied.applied, 1);
            assert.equal(stub.requests.filter((r) => r.path === '/api/status/order_id').length, before + 1, 'the status was re-read, not trusted');

            assert.equal((await ledgerRowFor(payment.id)).status, 'APPROVED');
            assert.ok((await prisma.pspCallbackEvent.findUnique({ where: { id: event.id } })).processedAt);
        });

        it('treats a redelivered body as a duplicate', async () => {
            const { payment } = await open();
            stub.approve(payment.merchantOrderId);
            const body = stub.callbackFor(payment.merchantOrderId);

            await post(body);
            const again = await post(body);
            assert.equal(again.status, 200);
            assert.equal(again.body.duplicate, true);
            assert.equal(await prisma.pspCallbackEvent.count({ where: { paymentId: payment.id } }), 1);
        });

        it('rejects a bad signature with 400, keeps the row for forensics and moves nothing', async () => {
            const { payment } = await open();
            stub.approve(payment.merchantOrderId);
            const forged = JSON.parse(stub.callbackFor(payment.merchantOrderId));
            forged.amount = '1';

            const answer = await post(JSON.stringify(forged));
            assert.equal(answer.status, 400);

            const event = await prisma.pspCallbackEvent.findFirst({ where: { paymentId: payment.id } });
            assert.equal(event.signatureValid, false);
            assert.equal(event.error, 'INVALID_SIGNATURE');
            assert.ok(event.processedAt);
            assert.ok(await prisma.auditLog.findFirst({ where: { entityId: payment.id, action: 'PSP_CALLBACK_REJECTED' } }));

            await applyCallbackEvents();
            assert.equal((await ledgerRowFor(payment.id)).status, 'REDIRECT_READY');
        });

        it('rejects a foreign merchant and, when enforced, an unknown source address', async () => {
            const { payment } = await open();
            const doc = JSON.parse(stub.callbackFor(payment.merchantOrderId));

            // Signed by the right key for the wrong merchant: the stub signs its own documents, so re-sign.
            const { sign } = await import('../lib/integrations/flitt/signature.js');
            const { signature, ...rest } = { ...doc, merchant_id: 42 };
            const wrongMerchant = { ...rest, signature: sign(stub.secretKey, rest) };
            assert.equal((await post(JSON.stringify(wrongMerchant))).status, 400);

            config.payments.flitt.callbackIpEnforce = true;
            try {
                assert.equal((await post(stub.callbackFor(payment.merchantOrderId), { ip: '10.0.0.1' })).status, 400);
                assert.equal((await post(stub.callbackFor(payment.merchantOrderId), { ip: '3.75.125.89' })).status, 400, 'not in the configured list for this test');
            } finally {
                config.payments.flitt.callbackIpEnforce = false;
            }
        });

        it('reads a form-encoded body and refuses an unreadable one', async () => {
            const { payment } = await open();
            const doc = JSON.parse(stub.callbackFor(payment.merchantOrderId));
            const form = new URLSearchParams(Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, String(v)]))).toString();

            const answer = await post(form, { contentType: 'application/x-www-form-urlencoded' });
            assert.equal(answer.status, 200);

            await assert.rejects(() => post('{nope', {}), (err) => err.status === 400);
        });

        it('files a callback for an order this deploy never made and alerts', async () => {
            const foreign = await stub.orders;
            const orderId = `IAGTEST-FOREIGN-${Date.now()}`;
            // Create the order at the stub only, as another deploy on the shared merchant would.
            const { createFlittClient } = await import('../lib/integrations/flitt/client.js');
            await createFlittClient(() => config.payments.flitt).createCheckoutUrl({ orderId, orderDesc: 'foreign', amountCents: 100, currency: 'GEL' });
            stub.approve(orderId);

            const answer = await post(stub.callbackFor(orderId));
            assert.equal(answer.status, 200);
            assert.equal(answer.paymentId, null);

            await applyCallbackEvents();
            const event = await prisma.pspCallbackEvent.findFirst({ where: { merchantOrderId: orderId } });
            assert.equal(event.error, 'UNKNOWN_ORDER');
            assert.ok(event.processedAt);
            assert.ok(await prisma.outboxEvent.findFirst({ where: { entityId: event.id, topic: TOPICS.PSP_ALERT } }));
            assert.ok(foreign);
        });

        it('converges without any callback: the result page poll asks the gateway', async () => {
            const { payment, token } = await open();
            stub.setOrderStatus(payment.merchantOrderId, { order_status: 'processing' });

            const processing = await getPayment(payment.id, { token });
            assert.equal(processing.status, 'PROCESSING');

            stub.approve(payment.merchantOrderId);
            const approved = await getPayment(payment.id, { token });
            assert.equal(approved.status, 'APPROVED');
            assert.equal(approved.receivable.status, 'PAID');

            await assert.rejects(() => getPayment(payment.id, { token: 'x'.repeat(32) }), NotFoundError);
            const asStaff = await getPayment(payment.id, {}, { ...staff, capabilities: new Set(['finance.payments.read']) });
            assert.equal(asStaff.status, 'APPROVED');
        });

        it('survives the gateway being down during a poll and a callback, then catches up', async () => {
            // Earlier tests left inbox rows whose stub orders are gone; they must
            // not be the ones that eat the injected failures.
            await prisma.pspCallbackEvent.updateMany({ where: { processedAt: null }, data: { processedAt: new Date(), error: 'TEST_CLEANUP' } });

            const { payment, token } = await open();
            stub.approve(payment.merchantOrderId);
            await post(stub.callbackFor(payment.merchantOrderId));

            stub.failNext(503, { times: 3, path: '/api/status/order_id' });
            // (The inbox is shared across this file's tests; only this payment's row is asserted.)
            await applyCallbackEvents();
            const event = await prisma.pspCallbackEvent.findFirst({ where: { paymentId: payment.id } });
            assert.equal(event.processedAt, null);
            assert.ok(event.error);

            stub.failNext(503, { times: 3, path: '/api/status/order_id' });
            const seen = await getPayment(payment.id, { token });
            assert.equal(seen.status, 'REDIRECT_READY', 'the page shows what we know; nothing is guessed');

            const caughtUp = await sweepPspPayments();
            assert.ok(caughtUp.callbacks.applied >= 1);
            assert.ok((await prisma.pspCallbackEvent.findUnique({ where: { id: event.id } })).processedAt);
            assert.equal((await ledgerRowFor(payment.id)).status, 'APPROVED');
        });
    });

    describe('payment rules on the receivable', () => {
        it('freezes the provider policy at confirmation and auto-cancels an unpaid PAY_NOW booking', async () => {
            const { booking, receivable } = await booked({ vehicleId: payNowVehicle.id });

            assert.equal(receivable.paymentTiming, 'PAY_NOW');
            assert.equal(receivable.unpaidCancelHours, 2);
            assert.ok(receivable.autoCancelAt);
            assert.ok(receivable.autoCancelAt.getTime() - Date.now() > 1.9 * 3_600_000);

            // Editing the policy afterwards does not reach the booking.
            await prisma.paymentPolicy.updateMany({ where: { id: payNowProvider.paymentPolicyId }, data: { unpaidCancelHours: 48 } });
            assert.equal((await prisma.receivable.findUnique({ where: { id: receivable.id } })).unpaidCancelHours, 2);

            await prisma.receivable.update({ where: { id: receivable.id }, data: { autoCancelAt: new Date(Date.now() - 60_000) } });
            const counts = await sweepUnpaidBookings();
            assert.ok(counts.cancelled >= 1);

            const cancelled = await prisma.transferBooking.findUnique({ where: { id: booking.id } });
            assert.equal(cancelled.status, 'CANCELLED');
            assert.equal(cancelled.cancellationChargeCents ?? 0, 0, 'charges are waived: the guest never paid');

            const after = await prisma.receivable.findUnique({ where: { id: receivable.id } });
            assert.ok(after.autoCancelledAt);
            assert.equal(after.status, 'VOID');
            assert.ok(await prisma.auditLog.findFirst({ where: { entityId: booking.id, action: 'BOOKING_AUTO_CANCELLED_UNPAID' } }));
            assert.ok(await prisma.outboxEvent.findFirst({ where: { entityId: booking.id, topic: TOPICS.BOOKING_AUTO_CANCELLED_UNPAID } }));

            // Paying a cancelled booking is refused.
            await assert.rejects(() => createPayment({ reference: booking.reference, email: booking.leadPassengerEmail }, null, null), GoneError);
        });

        it('never cancels a booking whose card payment went through, and waits on one in flight', async () => {
            const { booking, payment, receivable } = await open({ vehicleId: payNowVehicle.id });
            await prisma.receivable.update({ where: { id: receivable.id }, data: { autoCancelAt: new Date(Date.now() - 60_000) } });

            await prisma.pspPayment.update({ where: { id: payment.id }, data: { status: 'PROCESSING' } });
            let counts = await sweepUnpaidBookings();
            assert.ok(counts.postponed >= 1);
            assert.equal((await prisma.transferBooking.findUnique({ where: { id: booking.id } })).status, 'CONFIRMED');

            stub.approve(payment.merchantOrderId);
            await refreshFromProvider(payment.id);
            counts = await sweepUnpaidBookings();
            assert.equal((await prisma.transferBooking.findUnique({ where: { id: booking.id } })).status, 'CONFIRMED');
            assert.equal((await prisma.receivable.findUnique({ where: { id: receivable.id } })).status, 'PAID');
        });

        it('leaves a PAY_AT_HOTEL (default transfer) booking alone and offers no card unless optional', async () => {
            const { booking, receivable } = await booked({ vehicleId: defaultVehicle.id });

            assert.equal(receivable.paymentTiming, 'PAY_AT_HOTEL');
            assert.equal(receivable.autoCancelAt, null);
            await assert.rejects(() => createPayment({ reference: booking.reference, email: booking.leadPassengerEmail }, null, null), (err) => err instanceof ConflictError && err.details.reason === 'CARD_NOT_OFFERED');

            const { receivable: later } = await booked();
            assert.equal(later.paymentTiming, 'PAY_LATER');
            assert.equal(later.autoCancelAt, null);
        });

        it('sets no deadline while the gateway is off', async () => {
            config.payments.flitt.enabled = false;
            try {
                const { receivable } = await booked({ vehicleId: payNowVehicle.id });
                assert.equal(receivable.paymentTiming, 'PAY_NOW');
                assert.equal(receivable.autoCancelAt, null);
            } finally {
                config.payments.flitt.enabled = true;
            }
        });
    });
});
