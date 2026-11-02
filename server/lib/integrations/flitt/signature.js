import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Flitt's request and response signature (docs.flitt.com/api/building-signature).
 *
 * SHA-1, lowercase hex, over the merchant's payment key followed by the value
 * of every parameter, sorted by parameter name and joined with `|`. Two things
 * the page says that are easy to get wrong:
 *
 *   - a parameter that is absent, null or the empty string contributes nothing,
 *     not even its separator — but `0` and `"0"` are values and stay in;
 *   - `signature` itself and the test-mode hint `response_signature_string`
 *     are never part of the string.
 *
 * Values go in as text exactly as they appeared on the wire: Flitt signs
 * `1549901`, not the number it parses to, so the callback parser keeps the
 * lexical form of every number (see parse.js) and this file only ever calls
 * `String()` on what it is given.
 *
 * The worked examples printed on the documentation page do not hash to the
 * signatures beside them; the live gateway does accept this algorithm and
 * signs its answers with it (the unit test pins a real exchange). Pure: no
 * config, no I/O, so it can be tested without a database.
 */

const EXCLUDED = new Set(['signature', 'response_signature_string']);

const isPresent = (value) => value !== undefined && value !== null && value !== '';

/** The `|`-joined string Flitt hashes, secret first. Exposed for diagnostics and tests. */
export const canonicalString = (secret, params) => {
    const keys = Object.keys(params)
        .filter((key) => !EXCLUDED.has(key) && isPresent(params[key]))
        .sort();

    return [secret, ...keys.map((key) => String(params[key]))].join('|');
};

export const sign = (secret, params) => createHash('sha1').update(canonicalString(secret, params), 'utf8').digest('hex');

/**
 * True when `params.signature` is the signature of the other fields under
 * `secret`. Constant-time on the comparison; a missing or malformed
 * signature is simply false.
 */
export const verify = (secret, params) => {
    const presented = typeof params?.signature === 'string' ? params.signature.trim().toLowerCase() : '';

    if (!/^[0-9a-f]{40}$/.test(presented)) {
        return false;
    }

    const expected = sign(secret, params);

    return timingSafeEqual(Buffer.from(presented, 'utf8'), Buffer.from(expected, 'utf8'));
};

/** `params` plus its signature, as a new object. */
export const withSignature = (secret, params) => ({ ...params, signature: sign(secret, params) });
