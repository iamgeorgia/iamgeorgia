import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from '../../config.js';
import { BadRequestError, GoneError } from '../errors.js';

/**
 * Signed transfer quotes.
 *
 * The same mechanism as `lib/hotel/offerToken.js`, and for the same reason: the
 * search result carries a fare into checkout, and the signature is what stops a
 * client editing it on the way. It is only half the protection and the smaller
 * half — **the backend re-quotes regardless**. The token prevents tampering,
 * revalidation catches genuine change, and a fare that has moved is a 409 the
 * traveller re-confirms rather than an error.
 *
 * Kept as its own module with its own secret rather than generalising the hotel
 * one. The payloads have nothing in common beyond being signed blobs, and a
 * shared key would mean rotating it for a compromised transfer quote
 * invalidated every hotel offer in flight.
 */

const sign = (payload) =>
    createHmac('sha256', config.transfer.quoteTokenSecret).update(payload).digest('base64url');

/**
 * Single letters because the token travels in a URL on the search results page,
 * where a hundred of them at forty characters each is a page a browser refuses
 * to cache.
 */
export const issueQuoteToken = (quote) => {
    const payload = Buffer.from(
        JSON.stringify({
            v: quote.vehicleId,
            r: quote.routeId ?? null,
            f: quote.fromPointId,
            t: quote.toPointId,
            d: quote.date,
            tm: quote.time,
            tt: quote.tripType,
            rd: quote.returnDate ?? null,
            rt: quote.returnTime ?? null,
            a: quote.adults,
            c: quote.children,
            ca: quote.childAges ?? [],
            l: quote.luggage,
            cb: quote.cabinBags,
            e: quote.extras ?? [],
            // The quoted total travels so revalidation can say what changed,
            // not so it can be trusted.
            q: quote.quotedSellCents,
            cur: quote.currency,
            iat: Date.now()
        })
    ).toString('base64url');

    return `${payload}.${sign(payload)}`;
};

export const readQuoteToken = (token) => {
    if (typeof token !== 'string' || !token.includes('.')) {
        throw new BadRequestError('That quote reference is not valid');
    }

    const [payload, signature] = token.split('.');
    const expected = Buffer.from(sign(payload));
    const provided = Buffer.from(signature ?? '');

    // Constant time, and length-checked first because timingSafeEqual throws on
    // a length mismatch rather than returning false.
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        throw new BadRequestError('That quote reference is not valid');
    }

    let decoded;

    try {
        decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        throw new BadRequestError('That quote reference is not valid');
    }

    // Quotes go stale because fares and road closures move underneath them. An
    // expired token is 410 rather than 400: it was real, and it is now spent.
    if (Date.now() - decoded.iat > config.transfer.quoteTokenTtlMs) {
        throw new GoneError('That quote has expired. Search again for current fares.', { reason: 'OFFER_EXPIRED' });
    }

    return {
        vehicleId: decoded.v,
        routeId: decoded.r,
        fromPointId: decoded.f,
        toPointId: decoded.t,
        date: decoded.d,
        time: decoded.tm,
        tripType: decoded.tt,
        returnDate: decoded.rd,
        returnTime: decoded.rt,
        adults: decoded.a,
        children: decoded.c,
        childAges: decoded.ca,
        luggage: decoded.l,
        cabinBags: decoded.cb,
        extras: decoded.e,
        quotedSellCents: decoded.q,
        currency: decoded.cur,
        issuedAt: new Date(decoded.iat)
    };
};
