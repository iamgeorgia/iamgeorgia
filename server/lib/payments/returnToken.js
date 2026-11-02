import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from '../../config.js';

/**
 * The token in a payment's return URL.
 *
 * The provider sends the guest back to `/api/payments/flitt/return/:id/:token`
 * and the result page then reads `/api/payments/:id?t=<token>`. The token
 * proves the caller was handed this payment's URL at creation; it carries no
 * email and no session, so a guest page works after a cross-site redirect
 * that drops the SameSite=Strict cookie, and a payment id alone (a cuid, but
 * still just an id) is not enough to read someone's payment.
 *
 * HMAC-SHA256 over the payment id under FLITT_RETURN_TOKEN_SECRET, base64url,
 * 32 characters. Not a bearer for anything but reading that one payment.
 */
const secret = () => config.payments.flitt.returnTokenSecret;

export const issueReturnToken = (paymentId, key = secret()) => {
    if (!key) {
        throw new Error('FLITT_RETURN_TOKEN_SECRET is not set');
    }

    return createHmac('sha256', key).update(String(paymentId), 'utf8').digest('base64url').slice(0, 32);
};

export const verifyReturnToken = (paymentId, token, key = secret()) => {
    if (typeof token !== 'string' || token.length !== 32 || !key) {
        return false;
    }

    const expected = issueReturnToken(paymentId, key);

    return timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(expected, 'utf8'));
};
