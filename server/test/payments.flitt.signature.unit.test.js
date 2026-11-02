import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { canonicalString, sign, verify, withSignature } from '../lib/integrations/flitt/signature.js';
import { parseJsonPreservingNumbers } from '../lib/integrations/flitt/parse.js';

/**
 * Flitt's signature, pinned to a real exchange with the public test merchant
 * (test/support/fixtures/flitt-live-exchange.json, captured 2026-11-03): the
 * request the gateway accepted and the signed status it answered with. No
 * database, no network.
 */

const fixture = JSON.parse(readFileSync(new URL('./support/fixtures/flitt-live-exchange.json', import.meta.url), 'utf8'));
const SECRET = 'test';

describe('flitt signature: canonical string', () => {
    it('sorts by key, joins with | and puts the secret first', () => {
        assert.equal(
            canonicalString(SECRET, { order_id: 'TestOrder2', amount: 1000, currency: 'GEL', merchant_id: 1549901, order_desc: 'Test payment', server_callback_url: 'http://myshop/callback/' }),
            'test|1000|GEL|1549901|Test payment|TestOrder2|http://myshop/callback/'
        );
    });

    it('drops absent, null and empty values without leaving a separator, but keeps zeros', () => {
        assert.equal(canonicalString(SECRET, { b: '', a: 'x', c: null, d: undefined, e: 0, f: '0' }), 'test|x|0|0');
    });

    it('never includes signature or response_signature_string', () => {
        assert.equal(canonicalString(SECRET, { a: '1', signature: 'deadbeef', response_signature_string: '***|1' }), 'test|1');
    });

    it('uses the text of numbers as given', () => {
        assert.equal(canonicalString(SECRET, { a: '1.0', b: 2 }), 'test|1.0|2');
    });
});

describe('flitt signature: against the live gateway exchange', () => {
    it('reproduces the request signature Flitt accepted', () => {
        const { signature, ...request } = fixture.createRequest;

        assert.equal(sign(SECRET, request), signature);
        assert.equal(JSON.parse(fixture.createResponse).response.response_status, 'success');
    });

    it('verifies the status answer Flitt signed, numbers kept as text', () => {
        const { response } = parseJsonPreservingNumbers(fixture.statusResponse);

        assert.equal(response.order_status, 'created');
        assert.equal(typeof response.merchant_id, 'string');
        assert.equal(verify(SECRET, response), true);
    });

    it('rejects the same answer once any signed field changes', () => {
        const { response } = parseJsonPreservingNumbers(fixture.statusResponse);

        assert.equal(verify(SECRET, { ...response, amount: '12346' }), false);
        assert.equal(verify(SECRET, { ...response, order_status: 'approved' }), false);
        assert.equal(verify('wrong-key', response), false);
    });
});

describe('flitt signature: verify', () => {
    const params = { order_id: 'x', amount: '100', currency: 'GEL', merchant_id: '1549901' };

    it('accepts its own signature, in either case', () => {
        const signed = withSignature(SECRET, params);

        assert.equal(verify(SECRET, signed), true);
        assert.equal(verify(SECRET, { ...signed, signature: signed.signature.toUpperCase() }), true);
    });

    it('is false for a missing, short or non-hex signature rather than throwing', () => {
        assert.equal(verify(SECRET, params), false);
        assert.equal(verify(SECRET, { ...params, signature: 'abc' }), false);
        assert.equal(verify(SECRET, { ...params, signature: 'z'.repeat(40) }), false);
        assert.equal(verify(SECRET, { ...params, signature: 12345 }), false);
        assert.equal(verify(SECRET, null), false);
    });

    it('is lowercase hex, 40 characters', () => {
        assert.match(sign(SECRET, params), /^[0-9a-f]{40}$/);
    });
});
