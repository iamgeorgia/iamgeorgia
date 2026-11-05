import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from '../../config.js';
import { BadRequestError, GoneError } from '../errors.js';

/**
 * Signed tour offers.
 *
 * The same mechanism as `lib/hotel/offerToken.js` and `lib/transfer/quoteToken.js`,
 * for the same reason: availability hands back a token naming an offer,
 * checkout hands it back, and the signature is what stops a client editing
 * the price on the way. It is only half the protection and the smaller half —
 * **the backend re-quotes regardless**. A token whose price no longer matches
 * is a 409 the traveller re-confirms, not an error.
 *
 * Its own secret rather than the hotel one, so a compromised tour offer can be
 * rotated without invalidating every hotel offer in flight.
 */

const sign = (payload) =>
    createHmac('sha256', config.tour.offerTokenSecret).update(payload).digest('base64url');

export const issueTourOfferToken = (offer) => {
    const payload = Buffer.from(
        JSON.stringify({
            t: offer.tourId,
            o: offer.tourOptionId,
            d: offer.date,
            a: offer.adults,
            c: offer.childAges ?? [],
            // The quoted total travels so revalidation can say what changed,
            // not so it can be trusted.
            q: offer.quotedSellCents,
            cur: offer.currency,
            iat: Date.now()
        })
    ).toString('base64url');

    return `${payload}.${sign(payload)}`;
};

export const readTourOfferToken = (token) => {
    if (typeof token !== 'string' || !token.includes('.')) {
        throw new BadRequestError('That offer reference is not valid');
    }

    const [payload, signature] = token.split('.');
    const expected = Buffer.from(sign(payload));
    const provided = Buffer.from(signature ?? '');

    // Constant time, and length-checked first because timingSafeEqual throws on
    // a length mismatch rather than returning false.
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        throw new BadRequestError('That offer reference is not valid');
    }

    let decoded;

    try {
        decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        throw new BadRequestError('That offer reference is not valid');
    }

    if (Date.now() - decoded.iat > config.tour.offerTokenTtlMs) {
        throw new GoneError('That offer has expired. Search again for current prices.', { reason: 'OFFER_EXPIRED' });
    }

    return {
        tourId: decoded.t,
        tourOptionId: decoded.o,
        date: decoded.d,
        adults: decoded.a,
        childAges: decoded.c ?? [],
        quotedSellCents: decoded.q,
        currency: decoded.cur,
        issuedAt: new Date(decoded.iat)
    };
};
