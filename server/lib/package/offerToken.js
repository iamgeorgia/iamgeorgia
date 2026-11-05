import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from '../../config.js';
import { BadRequestError, GoneError } from '../errors.js';

/**
 * Signed package offers.
 *
 * A package quote is a set of resolved slots, each carrying its own product
 * token (a hotel offer, a transfer quote, a tour offer) or, for a service, the
 * plain fields the service was priced from. The composite is signed as a
 * whole so that revalidation can recurse: read the package token, then read
 * and re-price each child exactly as the standalone checkouts do.
 *
 * Stateless, like the others. Nothing on the platform persists a quote and a
 * table of them would need a sweeper; the price of that is a token a few
 * kilobytes long, which is fine in a POST body.
 */

const sign = (payload) =>
    createHmac('sha256', config.package.offerTokenSecret).update(payload).digest('base64url');

export const issuePackageOfferToken = (offer) => {
    const payload = Buffer.from(
        JSON.stringify({
            p: offer.packageId,
            s: offer.startDate,
            a: offer.adults,
            c: offer.childAges ?? [],
            r: offer.rooms ?? 1,
            slots: offer.slots.map((slot) => ({
                i: slot.slotIndex,
                k: slot.componentType,
                inc: slot.included ? 1 : 0,
                t: slot.token ?? null,
                q: slot.sellCents,
                ...(slot.service ? { svc: slot.service } : {})
            })),
            adj: offer.adjustmentCents,
            q: offer.totalCents,
            cur: offer.currency,
            iat: Date.now()
        })
    ).toString('base64url');

    return `${payload}.${sign(payload)}`;
};

export const readPackageOfferToken = (token) => {
    if (typeof token !== 'string' || !token.includes('.')) {
        throw new BadRequestError('That package offer is not valid');
    }

    const [payload, signature] = token.split('.');
    const expected = Buffer.from(sign(payload));
    const provided = Buffer.from(signature ?? '');

    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        throw new BadRequestError('That package offer is not valid');
    }

    let decoded;

    try {
        decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        throw new BadRequestError('That package offer is not valid');
    }

    if (Date.now() - decoded.iat > config.package.offerTokenTtlMs) {
        throw new GoneError('That package offer has expired. Quote it again for current prices.', { reason: 'OFFER_EXPIRED' });
    }

    return {
        packageId: decoded.p,
        startDate: decoded.s,
        adults: decoded.a,
        childAges: decoded.c ?? [],
        rooms: decoded.r ?? 1,
        slots: (decoded.slots ?? []).map((slot) => ({
            slotIndex: slot.i,
            componentType: slot.k,
            included: slot.inc === 1,
            token: slot.t ?? null,
            sellCents: slot.q,
            service: slot.svc ?? null
        })),
        adjustmentCents: decoded.adj,
        quotedTotalCents: decoded.q,
        currency: decoded.cur,
        issuedAt: new Date(decoded.iat)
    };
};
