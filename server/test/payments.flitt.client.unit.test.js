import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { BadGatewayError, UnprocessableEntityError } from '../lib/errors.js';
import { createFlittClient } from '../lib/integrations/flitt/client.js';
import { verify } from '../lib/integrations/flitt/signature.js';
import { startFlittStub } from './support/flitt.stub.js';

/**
 * The Flitt client against a stub of the gateway: what it sends, how it signs,
 * which answers it verifies, which failures it retries and which it maps to
 * which error. No database.
 */

let stub;
let settings;
const client = createFlittClient(() => settings);

const orderId = () => `IAGT-UNIT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const checkout = (overrides = {}) =>
    client.createCheckoutUrl({
        orderId: orderId(),
        orderDesc: 'Unit test order',
        amountCents: 12_345,
        currency: 'GEL',
        responseUrl: 'http://localhost:5000/api/payments/flitt/return/x/y',
        serverCallbackUrl: 'http://localhost:5000/api/payments/flitt/callback',
        lifetimeSeconds: 600,
        merchantData: '{"paymentId":"p1"}',
        lang: 'en',
        ...overrides
    });

before(async () => {
    stub = await startFlittStub();
    settings = { merchantId: stub.merchantId, secretKey: stub.secretKey, apiBaseUrl: stub.url, requestTimeoutMs: 2000 };
});

after(async () => {
    await stub.close();
});

beforeEach(() => {
    stub.reset();
});

describe('flitt client: create order', () => {
    it('posts a signed request in Flitt\'s envelope and returns the checkout url', async () => {
        const response = await checkout();

        assert.equal(response.response_status, 'success');
        assert.match(response.checkout_url, /^http:\/\/127\.0\.0\.1:\d+\/merchants\/stub\//);
        assert.match(response.payment_id, /^\d+$/);

        const sent = stub.requests.at(-1);
        assert.equal(sent.path, '/api/checkout/url');
        assert.equal(sent.request.merchant_id, stub.merchantId);
        assert.equal(sent.request.amount, 12_345);
        assert.equal(sent.request.delayed, 'N');
        assert.equal(sent.request.version, '1.0.1');
        assert.equal('cancel_url' in sent.request, false, 'optional parameters left out are not sent as null');
        assert.equal(verify(stub.secretKey, sent.request), true);
    });

    it('refuses to build a request with a non-integer amount or a bad currency before touching the network', async () => {
        await assert.rejects(() => checkout({ amountCents: 12.5 }), TypeError);
        await assert.rejects(() => checkout({ amountCents: 0 }), TypeError);
        await assert.rejects(() => checkout({ currency: 'gel' }), TypeError);
        assert.equal(stub.requests.length, 0);
    });

    it('maps a duplicate order to a 422 carrying Flitt\'s code and request id', async () => {
        const id = orderId();
        await checkout({ orderId: id });

        await assert.rejects(
            () => checkout({ orderId: id }),
            (err) => err instanceof UnprocessableEntityError && err.details.errorCode === 1013 && err.details.reason === 'PROVIDER_REJECTED' && typeof err.details.requestId === 'string'
        );
    });

    it('maps a currency the merchant lacks to a 422', async () => {
        await assert.rejects(() => checkout({ currency: 'JPY' }), (err) => err instanceof UnprocessableEntityError && err.details.errorCode === 1012);
    });

    it('treats a rejected signature as a configuration failure, not a decline', async () => {
        settings = { ...settings, secretKey: 'wrong' };

        try {
            await assert.rejects(() => checkout(), (err) => err instanceof BadGatewayError && err.details.reason === 'PROVIDER_AUTH' && err.details.errorCode === 1014);
        } finally {
            settings = { ...settings, secretKey: stub.secretKey };
        }
    });

    it('does not retry a create after a 503: the service decides', async () => {
        stub.failNext(503);

        await assert.rejects(() => checkout(), (err) => err instanceof BadGatewayError && err.details.reason === 'PROVIDER_UNAVAILABLE' && err.details.status === 503);
        assert.equal(stub.requests.length, 1);
    });

    it('reports a timeout distinctly, so the caller can probe before retrying', async () => {
        stub.delayMs = 400;
        settings = { ...settings, requestTimeoutMs: 100 };

        try {
            await assert.rejects(() => checkout(), (err) => err instanceof BadGatewayError && err.details.reason === 'PROVIDER_TIMEOUT');
        } finally {
            settings = { ...settings, requestTimeoutMs: 2000 };
            stub.delayMs = 0;
        }
    });

    it('fails loudly when not configured', async () => {
        const unconfigured = createFlittClient(() => ({ merchantId: null, secretKey: null }));

        await assert.rejects(() => unconfigured.getOrderStatus({ orderId: 'x' }), (err) => err.details.reason === 'PROVIDER_NOT_CONFIGURED');
    });
});

describe('flitt client: order status', () => {
    it('returns the signed document with numbers as text', async () => {
        const id = orderId();
        await checkout({ orderId: id });
        stub.approve(id);

        const status = await client.getOrderStatus({ orderId: id });

        assert.equal(status.order_status, 'approved');
        assert.equal(status.amount, '12345');
        assert.equal(status.actual_amount, '12345');
        assert.equal(typeof status.payment_id, 'string');
        assert.equal(typeof status.merchant_id, 'string');
        assert.equal(status.masked_card, '444455XXXXXX1111');
        assert.equal(typeof status.additional_info, 'string');
    });

    it('refuses an answer whose signature does not verify', async () => {
        const id = orderId();
        await checkout({ orderId: id });
        const doc = stub.documentFor(id);
        stub.failNext(200, { body: { response: { ...doc, amount: '99999' } }, path: '/api/status/order_id' });

        await assert.rejects(() => client.getOrderStatus({ orderId: id }), (err) => err instanceof BadGatewayError && err.details.reason === 'PROVIDER_SIGNATURE');
    });

    it('refuses an unsigned answer on the status endpoint', async () => {
        const id = orderId();
        await checkout({ orderId: id });
        const { signature, ...unsigned } = stub.documentFor(id);
        stub.failNext(200, { body: { response: unsigned }, path: '/api/status/order_id' });

        await assert.rejects(() => client.getOrderStatus({ orderId: id }), (err) => err.details.reason === 'PROVIDER_SIGNATURE');
    });

    it('retries a 503 and a dropped connection, then succeeds', async () => {
        const id = orderId();
        await checkout({ orderId: id });
        stub.failNext(503, { times: 2, path: '/api/status/order_id' });

        const status = await client.getOrderStatus({ orderId: id });

        assert.equal(status.order_status, 'created');
        assert.equal(stub.requests.filter((r) => r.path === '/api/status/order_id').length, 3);
    });

    it('gives up after three attempts', async () => {
        const id = orderId();
        await checkout({ orderId: id });
        stub.failNext(502, { times: 3, path: '/api/status/order_id' });

        await assert.rejects(() => client.getOrderStatus({ orderId: id }), (err) => err.details.reason === 'PROVIDER_UNAVAILABLE');
    });

    it('maps an unknown order to a 422 with code 1018', async () => {
        await assert.rejects(() => client.getOrderStatus({ orderId: 'IAGT-NOPE' }), (err) => err instanceof UnprocessableEntityError && err.details.errorCode === 1018);
    });

    it('refuses an answer that is not JSON or lacks the envelope', async () => {
        const id = orderId();
        await checkout({ orderId: id });
        stub.failNext(200, { body: 'not json', path: '/api/status/order_id' });
        await assert.rejects(() => client.getOrderStatus({ orderId: id }), (err) => err.details.reason === 'PROVIDER_MALFORMED');

        stub.failNext(200, { body: { nothing: true }, path: '/api/status/order_id' });
        await assert.rejects(() => client.getOrderStatus({ orderId: id }), (err) => err.details.reason === 'PROVIDER_MALFORMED');
    });
});

describe('flitt client: reverse and capture', () => {
    it('reverses with an idempotent key and verifies the signed answer', async () => {
        const id = orderId();
        await checkout({ orderId: id });
        stub.approve(id);

        const first = await client.reverse({ orderId: id, amountCents: 2_345, currency: 'GEL', reverseId: 'r-1', comment: 'partial', email: 'finance@example.test' });
        assert.equal(first.reverse_status, 'approved');
        assert.equal(first.reversal_amount, '2345');

        const again = await client.reverse({ orderId: id, amountCents: 2_345, currency: 'GEL', reverseId: 'r-1' });
        assert.equal(again.reversal_amount, '2345', 'the same reverse_id does not reverse twice');

        const status = await client.getOrderStatus({ orderId: id });
        assert.equal(status.reversal_amount, '2345');
        assert.equal(status.order_status, 'approved');

        const rest = await client.reverse({ orderId: id, amountCents: 10_000, currency: 'GEL', reverseId: 'r-2' });
        assert.equal(rest.reversal_amount, '12345');
        assert.equal((await client.getOrderStatus({ orderId: id })).order_status, 'reversed');
    });

    it('refuses to reverse more than was charged', async () => {
        const id = orderId();
        await checkout({ orderId: id });
        stub.approve(id);

        await assert.rejects(() => client.reverse({ orderId: id, amountCents: 99_999, currency: 'GEL', reverseId: 'r-x' }), (err) => err instanceof UnprocessableEntityError && err.details.errorCode === 1023);
    });

    it('captures', async () => {
        const id = orderId();
        await checkout({ orderId: id });
        stub.approve(id);

        const captured = await client.capture({ orderId: id, amountCents: 12_345, currency: 'GEL' });
        assert.equal(captured.capture_status, 'captured');
    });
});
