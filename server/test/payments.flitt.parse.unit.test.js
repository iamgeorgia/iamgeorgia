import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BadRequestError } from '../lib/errors.js';
import { MAX_CALLBACK_BYTES, hashBody, parseAdditionalInfo, parseCallbackBody, parseJsonPreservingNumbers } from '../lib/integrations/flitt/parse.js';
import { mapOrderStatus, isFinal, isOpen, parseFlittTime, rank, toCents, toResponseCode } from '../lib/integrations/flitt/status.js';
import { BadGatewayError } from '../lib/errors.js';

/** Reading Flitt's bodies without changing what was signed; the status vocabulary. No database. */

describe('flitt parse: numbers keep their source text', () => {
    it('keeps integers, decimals and trailing zeros as written', () => {
        const parsed = parseJsonPreservingNumbers('{"a":1549901,"b":0.0,"c":1.0,"d":-5,"e":"x: 1.0","f":true,"g":null}');

        assert.deepEqual(parsed, { a: '1549901', b: '0.0', c: '1.0', d: '-5', e: 'x: 1.0', f: 'true', g: null });
    });

    it('leaves nested strings such as additional_info untouched', () => {
        const info = '{"capture_status": null, "client_fee": 0.0, "is_test": true}';
        const parsed = parseJsonPreservingNumbers(JSON.stringify({ additional_info: info }));

        assert.equal(parsed.additional_info, info);
    });
});

describe('flitt parse: callback body', () => {
    const body = (fields) => Buffer.from(JSON.stringify(fields));

    it('returns flat fields and a stable hash of the raw bytes', () => {
        const raw = body({ order_id: 'A', merchant_id: 1549901, amount: 200, order_status: 'approved', signature: 'f'.repeat(40) });
        const one = parseCallbackBody(raw, 'application/json; charset=UTF-8');
        const two = parseCallbackBody(Buffer.from(raw), 'application/json');

        assert.equal(one.fields.merchant_id, '1549901');
        assert.equal(one.fields.amount, '200');
        assert.equal(one.bodyHash, two.bodyHash);
        assert.equal(one.bodyHash, hashBody(raw));
        assert.notEqual(one.bodyHash, parseCallbackBody(body({ order_id: 'B' })).bodyHash);
    });

    it('unwraps a response envelope but refuses nested values otherwise', () => {
        assert.equal(parseCallbackBody(body({ response: { order_id: 'A' } })).fields.order_id, 'A');
        assert.throws(() => parseCallbackBody(body({ order_id: 'A', extra: { nested: 1 } })), (err) => err instanceof BadRequestError && err.details.reason === 'CALLBACK_MALFORMED');
        assert.throws(() => parseCallbackBody(body([1, 2])), BadRequestError);
    });

    it('reads a form-encoded body too', () => {
        const { fields } = parseCallbackBody(Buffer.from('order_id=A&amount=200&masked_card=4444XXXXXXXX1111'), 'application/x-www-form-urlencoded');

        assert.deepEqual(fields, { order_id: 'A', amount: '200', masked_card: '4444XXXXXXXX1111' });
    });

    it('refuses what is not a buffer, is empty, is too large or is not JSON', () => {
        assert.throws(() => parseCallbackBody('{"a":1}'), BadRequestError);
        assert.throws(() => parseCallbackBody(Buffer.alloc(0)), BadRequestError);
        assert.throws(() => parseCallbackBody(Buffer.from('{not json')), (err) => err.details.reason === 'CALLBACK_MALFORMED');
        assert.throws(() => parseCallbackBody(Buffer.alloc(MAX_CALLBACK_BYTES + 1, 0x20)), (err) => err.details.reason === 'CALLBACK_TOO_LARGE');
    });

    it('reads additional_info leniently', () => {
        assert.deepEqual(parseAdditionalInfo('{"is_test": true, "transaction_id": 1}'), { is_test: true, transaction_id: 1 });
        assert.deepEqual(parseAdditionalInfo(''), {});
        assert.deepEqual(parseAdditionalInfo('not json'), {});
        assert.deepEqual(parseAdditionalInfo(null), {});
        assert.deepEqual(parseAdditionalInfo('[1]'), {});
    });
});

describe('flitt status vocabulary', () => {
    it('maps every documented order_status and refuses the rest', () => {
        assert.equal(mapOrderStatus('created'), 'REDIRECT_READY');
        assert.equal(mapOrderStatus('processing'), 'PROCESSING');
        assert.equal(mapOrderStatus('approved'), 'APPROVED');
        assert.equal(mapOrderStatus(' Declined '), 'DECLINED');
        assert.equal(mapOrderStatus('expired'), 'EXPIRED');
        assert.equal(mapOrderStatus('reversed'), 'REVERSED');
        assert.throws(() => mapOrderStatus('paid'), BadGatewayError);
        assert.throws(() => mapOrderStatus(undefined), BadGatewayError);
    });

    it('ranks states so a stale report never moves a payment backwards', () => {
        assert.ok(rank('APPROVED') > rank('PROCESSING'));
        assert.ok(rank('PROCESSING') > rank('REDIRECT_READY'));
        assert.ok(rank('REVERSED') > rank('APPROVED'));
        assert.ok(rank('DECLINED') > rank('PROCESSING'));
        assert.equal(rank('MISMATCH'), rank('APPROVED'));
        assert.throws(() => rank('NOPE'));
    });

    it('knows which states are over and which are still payable', () => {
        for (const s of ['APPROVED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'REVERSED', 'MISMATCH', 'FAILED']) assert.equal(isFinal(s), true, s);
        for (const s of ['CREATED', 'REDIRECT_READY', 'PROCESSING']) {
            assert.equal(isFinal(s), false, s);
            assert.equal(isOpen(s), true, s);
        }
        assert.equal(isOpen('APPROVED'), false);
    });

    it('reads amounts as whole minor units only', () => {
        assert.equal(toCents('1000'), 1000);
        assert.equal(toCents(1000), 1000);
        assert.equal(toCents('0'), 0);
        assert.equal(toCents(''), null);
        assert.equal(toCents(null), null);
        assert.throws(() => toCents('10.00'), BadGatewayError);
        assert.throws(() => toCents('-1'), BadGatewayError);
        assert.throws(() => toCents('1e3'), BadGatewayError);
    });

    it('reads response codes and Flitt timestamps', () => {
        assert.equal(toResponseCode('1000'), 1000);
        assert.equal(toResponseCode(''), null);
        assert.equal(toResponseCode('x'), null);
        assert.equal(parseFlittTime('13.07.2024 01:23:59')?.toISOString(), '2024-07-13T01:23:59.000Z');
        assert.equal(parseFlittTime(''), null);
        assert.equal(parseFlittTime('2024-07-13'), null);
    });
});
