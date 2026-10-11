import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Set before the limiter module (and config) is loaded: the token is read once at import.
process.env.API_CLIENT_TOKEN = 'unit-test-relay-token';
const { visitorKey } = await import('../middleware/rateLimit.js');

const req = (ip, headers = {}) => ({
    ip,
    get: (name) => headers[name.toLowerCase()]
});

describe('visitorKey — whom a relayed request counts against', () => {
    it('counts the visitor a trusted relay names', () => {
        const key = visitorKey(req('10.0.0.1', { 'x-client-token': 'unit-test-relay-token', 'x-visitor-address': '203.0.113.9' }));
        assert.equal(key, visitorKey(req('203.0.113.9')));
        assert.notEqual(key, visitorKey(req('10.0.0.1')));
    });

    it('falls back to the request address when the token is wrong, missing or only a prefix', () => {
        const own = visitorKey(req('10.0.0.1'));
        assert.equal(visitorKey(req('10.0.0.1', { 'x-client-token': 'wrong', 'x-visitor-address': '203.0.113.9' })), own);
        assert.equal(visitorKey(req('10.0.0.1', { 'x-visitor-address': '203.0.113.9' })), own);
        assert.equal(visitorKey(req('10.0.0.1', { 'x-client-token': 'unit-test-relay-token-and-more', 'x-visitor-address': '203.0.113.9' })), own);
    });

    it('ignores a visitor header that is not a bare IP address', () => {
        const own = visitorKey(req('10.0.0.1'));
        for (const bad of ['203.0.113.9, 10.0.0.2', 'example.com', '', '::1 ', 'not an ip']) {
            const key = visitorKey(req('10.0.0.1', { 'x-client-token': 'unit-test-relay-token', 'x-visitor-address': bad }));
            assert.equal(key, bad.trim() === '::1' ? visitorKey(req('::1')) : own, JSON.stringify(bad));
        }
    });

    it('normalises IPv6 visitors the same way as direct callers', () => {
        const direct = visitorKey(req('2001:db8:1234:5678::1'));
        const relayed = visitorKey(req('10.0.0.1', { 'x-client-token': 'unit-test-relay-token', 'x-visitor-address': '2001:db8:1234:5678::1' }));
        assert.equal(relayed, direct);
    });
});
