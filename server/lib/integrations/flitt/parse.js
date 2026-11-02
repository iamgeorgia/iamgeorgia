import { createHash } from 'node:crypto';

import { BadRequestError } from '../../errors.js';

/**
 * Reading what Flitt sends — callbacks and API responses — without losing the
 * one thing the signature depends on: the text of every value.
 *
 * `JSON.parse` turns `"amount": 1000` into the number 1000, and `1.0` into 1.
 * Flitt signed the characters it wrote, so the parser keeps them: the reviver
 * is handed the source text of each primitive (V8 "JSON.parse source text
 * access", Node 21+; the server runs Node 24) and keeps that for numbers.
 * Booleans become their lexical `true`/`false`; null stays null and is then
 * dropped from the signature string like any absent parameter.
 *
 * A callback is a flat object: every value a string, number, boolean or null.
 * `additional_info` is a JSON *string* and must stay one — re-serialising it
 * would change its bytes and break the signature.
 */

export const MAX_CALLBACK_BYTES = 64 * 1024;

const reviver = (key, value, context) => {
    if (typeof value === 'number') {
        // `context.source` is the exact token; fall back to String() where the
        // runtime does not provide it (never on Node ≥ 21).
        return typeof context?.source === 'string' ? context.source : String(value);
    }

    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }

    return value;
};

/** JSON text → object whose numbers and booleans are their source text. */
export const parseJsonPreservingNumbers = (text) => JSON.parse(text, reviver);

const isScalar = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

/** Plain object, scalar values only; anything else is not a Flitt callback. */
const assertFlat = (fields) => {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        throw new BadRequestError('Callback body is not an object', { reason: 'CALLBACK_MALFORMED' });
    }

    for (const [key, value] of Object.entries(fields)) {
        if (!isScalar(value)) {
            throw new BadRequestError(`Callback field "${key}" is not a scalar`, { reason: 'CALLBACK_MALFORMED' });
        }
    }

    return fields;
};

/** sha256 of the raw bytes: identical retries from Flitt collapse onto one inbox row. */
export const hashBody = (raw) => createHash('sha256').update(raw).digest('hex');

/**
 * A callback body (Buffer, as `express.raw` delivers it) → `{ fields, bodyHash }`.
 *
 * JSON by default; `application/x-www-form-urlencoded` is accepted too,
 * because Flitt's browser-facing endpoints are form-based and the callback
 * documentation shows JSON only. Both end as flat string-valued objects.
 */
export const parseCallbackBody = (raw, contentType = '') => {
    if (!Buffer.isBuffer(raw)) {
        throw new BadRequestError('Callback body was not received as raw bytes', { reason: 'CALLBACK_MALFORMED' });
    }

    if (raw.length === 0) {
        throw new BadRequestError('Callback body is empty', { reason: 'CALLBACK_MALFORMED' });
    }

    if (raw.length > MAX_CALLBACK_BYTES) {
        throw new BadRequestError('Callback body is too large', { reason: 'CALLBACK_TOO_LARGE' });
    }

    const text = raw.toString('utf8');
    const type = String(contentType).toLowerCase();
    let fields;

    if (type.includes('application/x-www-form-urlencoded')) {
        fields = Object.fromEntries(new URLSearchParams(text));
    } else {
        try {
            fields = parseJsonPreservingNumbers(text);
        } catch {
            throw new BadRequestError('Callback body is not valid JSON', { reason: 'CALLBACK_MALFORMED' });
        }

        // Tolerate the API envelope should Flitt ever wrap a callback the way it
        // wraps a response; the documented callback is the bare object.
        if (fields && typeof fields === 'object' && !Array.isArray(fields) && fields.response && typeof fields.response === 'object' && Object.keys(fields).length === 1) {
            fields = fields.response;
        }
    }

    return { fields: assertFlat(fields), bodyHash: hashBody(raw) };
};

/** The JSON string Flitt puts in `additional_info` → object, or `{}` when absent or unreadable. */
export const parseAdditionalInfo = (value) => {
    if (typeof value !== 'string' || value.trim() === '') {
        return {};
    }

    try {
        const parsed = JSON.parse(value);

        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};
