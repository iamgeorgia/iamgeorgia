import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from '../../config.js';
import { BadRequestError, GoneError } from '../errors.js';

/**
 * Signed offers.
 *
 * Search hands back a token describing an offer; checkout hands it back. The
 * signature is what stops a client editing the price on the way — but it is
 * only half the protection, and the smaller half. The backend **re-quotes
 * regardless**: the token prevents tampering, revalidation catches genuine
 * change. A token whose price no longer matches is a 409 the user re-confirms,
 * not an error.
 *
 * Compact rather than a JWT: there is no third party to interoperate with, the
 * payload is ours, and a bespoke short string beats a dependency here.
 */

const sign = (payload) =>
    createHmac('sha256', config.hotel.offerTokenSecret).update(payload).digest('base64url');

export const issueOfferToken = (offer) => {
    const payload = Buffer.from(
        JSON.stringify({
            h: offer.hotelId,
            rt: offer.roomTypeId,
            rp: offer.ratePlanId,
            ci: offer.checkIn,
            co: offer.checkOut,
            a: offer.adults,
            c: offer.childAges ?? [],
            r: offer.rooms,
            // The quoted total travels so revalidation can say what changed,
            // not so it can be trusted.
            q: offer.quotedSellCents,
            cur: offer.currency,
            iat: Date.now()
        })
    ).toString('base64url');

    return `${payload}.${sign(payload)}`;
};

export const readOfferToken = (token) => {
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

    // Offers go stale because rates and availability move underneath them. An
    // expired token is 410 rather than 400: it was real, and it is now spent.
    if (Date.now() - decoded.iat > config.hotel.offerTokenTtlMs) {
        throw new GoneError('That offer has expired. Search again for current prices.', { reason: 'OFFER_EXPIRED' });
    }

    return {
        hotelId: decoded.h,
        roomTypeId: decoded.rt,
        ratePlanId: decoded.rp,
        checkIn: decoded.ci,
        checkOut: decoded.co,
        adults: decoded.a,
        childAges: decoded.c,
        rooms: decoded.r,
        quotedSellCents: decoded.q,
        currency: decoded.cur,
        issuedAt: new Date(decoded.iat)
    };
};
