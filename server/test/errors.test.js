import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { errorHandler } from '../middleware/errors.js';
import { NotFoundError, UnprocessableEntityError, BadGatewayError } from '../lib/errors.js';

// Minimal res double: the handler only uses status(), json() and set().
const mockRes = () => {
    const res = { statusCode: null, body: null, log: null, headers: {} };
    res.set = (name, value) => {
        res.headers[name.toLowerCase()] = value;
        return res;
    };
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (body) => {
        res.body = body;
        return res;
    };
    return res;
};

const mockReq = () => ({ log: { error() {}, warn() {} } });

describe('error handler', () => {
    it('uses the status and message of a deliberate HttpError', () => {
        const res = mockRes();
        errorHandler(new NotFoundError('Hotel not found'), mockReq(), res, () => {});

        assert.equal(res.statusCode, 404);
        assert.equal(res.body.error.message, 'Hotel not found');
    });

    it('maps a Prisma unique violation to 409', () => {
        const res = mockRes();
        errorHandler({ code: 'P2002', message: 'unique failed' }, mockReq(), res, () => {});

        assert.equal(res.statusCode, 409);
        assert.match(res.body.error.message, /already exists/);
    });

    it('maps a Prisma missing record to 404', () => {
        const res = mockRes();
        errorHandler({ code: 'P2025', message: 'not found' }, mockReq(), res, () => {});

        assert.equal(res.statusCode, 404);
    });

    // The room_inventory no-oversell CHECK raises 23514, and it is reached
    // through $executeRaw, so Postgres' own SQLSTATE arrives unwrapped rather
    // than as a Prisma P-code. Losing a race for the last room is a normal
    // outcome and has to read as a conflict, not as a server fault.
    it('maps a Postgres check violation to 409 rather than 500', () => {
        const res = mockRes();
        errorHandler({ code: '23514', message: 'room_inventory_no_oversell' }, mockReq(), res, () => {});

        assert.equal(res.statusCode, 409);
        assert.match(res.body.error.message, /availability/);
        assert.doesNotMatch(res.body.error.message, /room_inventory_no_oversell/);
    });

    // An interactive transaction that could not get a connection in time (or
    // ran out of it) wrote nothing and can be retried: busy, not broken (TI-02).
    it('maps a Prisma transaction timeout to 503 with Retry-After rather than 500', () => {
        const res = mockRes();
        errorHandler({ code: 'P2028', message: 'Transaction API error: Unable to start a transaction in the given time.' }, mockReq(), res, () => {});

        assert.equal(res.statusCode, 503);
        assert.equal(res.headers['retry-after'], '2');
        assert.match(res.body.error.message, /busy/);
        assert.doesNotMatch(res.body.error.message, /Transaction API/);
    });

    it('maps a raw Postgres unique violation to 409', () => {
        const res = mockRes();
        errorHandler({ code: '23505', message: 'duplicate key' }, mockReq(), res, () => {});

        assert.equal(res.statusCode, 409);
    });

    it('carries the status of the new hotel-module error classes', () => {
        const unprocessable = mockRes();
        errorHandler(
            new UnprocessableEntityError('Hotel is not ready to publish', { missing: ['roomTypes'] }),
            mockReq(),
            unprocessable,
            () => {}
        );

        assert.equal(unprocessable.statusCode, 422);
        assert.equal(unprocessable.body.error.message, 'Hotel is not ready to publish');
        assert.deepEqual(unprocessable.body.error.details, { missing: ['roomTypes'] });

        const badGateway = mockRes();
        errorHandler(new BadGatewayError('Channel manager did not respond'), mockReq(), badGateway, () => {});

        // 502 is >= 500, so it is logged as an error, but the message is still
        // ours and must survive: an upstream outage is not an internal fault.
        assert.equal(badGateway.statusCode, 502);
        assert.equal(badGateway.body.error.message, 'Channel manager did not respond');
    });

    it('never leaks the message of an unexpected error', () => {
        const res = mockRes();
        errorHandler(new Error('connection string is postgres://user:hunter2@db'), mockReq(), res, () => {});

        assert.equal(res.statusCode, 500);
        assert.equal(res.body.error.message, 'Internal server error');
        assert.doesNotMatch(JSON.stringify(res.body.error.message), /hunter2/);
    });
});
