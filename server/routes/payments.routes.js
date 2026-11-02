import { Router } from 'express';

import { config } from '../config.js';
import { idempotencyKeyFrom } from '../lib/idempotency.js';
import { CAPABILITIES, can } from '../lib/permissions.js';
import { optionalAuthenticate } from '../middleware/auth.js';
import { paymentCreateLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { resolveCheckoutRule } from '../services/payments/payment-rules.service.js';
import { createPayment, getPayment, retryPayment, toGuestPayment, toStaffPayment } from '../services/payments/psp-payment.service.js';
import { checkoutRulesQuerySchema, createPaymentSchema, paymentIdParamSchema, paymentReadQuerySchema, retryPaymentSchema } from '../validation/payments.js';

/**
 * Card payments, as a guest sees them.
 *
 * No amount ever travels here: the server charges the balance of the
 * receivable the booking opened. A guest is known by the booking's email
 * (to open a payment) and afterwards by the token that came back with the
 * checkout URL (to read it). Staff with the finance capability may read any
 * payment through the same door, in their fuller shape.
 *
 * Behind the global limiter, the origin check and the JSON parser like every
 * other route; the provider's callback and the browser's return live in
 * payments.flitt.routes.js, which is mounted before those.
 */
export const paymentRoutes = Router();

const flitt = () => config.payments.flitt;

/** What the checkout needs to decide whether to offer a card: on or off, test or live. */
paymentRoutes.get('/settings', (req, res) => {
    res.json({ enabled: flitt().enabled, provider: 'FLITT', mode: flitt().enabled ? (flitt().mode === 'live' ? 'LIVE' : 'TEST') : null });
});

/**
 * The rule a checkout will book under, from the holds and items it carries:
 * `?hotelHold=…&tourHold=…&vehicleId=…&packageSlug=…`, repeated for a cart.
 * Answers the strictest rule and what may be offered to this buyer.
 */
paymentRoutes.get('/rules', optionalAuthenticate, validate({ query: checkoutRulesQuerySchema }), async (req, res) => {
    const { hotelHold = [], tourHold = [], vehicleId = [], packageSlug = [] } = req.valid.query;

    res.json(await resolveCheckoutRule({ hotelHolds: hotelHold, tourHolds: tourHold, vehicleIds: vehicleId, packageSlugs: packageSlug }, req.user ?? null));
});

paymentRoutes.post('/', paymentCreateLimiter, optionalAuthenticate, validate({ body: createPaymentSchema }), async (req, res) => {
    const { reference, email, locale } = req.valid.body;
    const { payment, token, reused } = await createPayment({ reference, email, idempotencyKey: idempotencyKeyFrom(req), locale, ip: req.ip }, req.user ?? null, req);

    res.status(reused ? 200 : 201).json({ ...toGuestPayment(payment, { token }), reused });
});

paymentRoutes.get('/:id', optionalAuthenticate, validate({ params: paymentIdParamSchema, query: paymentReadQuerySchema }), async (req, res) => {
    const viewer = req.user ?? null;
    const payment = await getPayment(req.valid.params.id, { token: req.valid.query.t ?? null }, viewer, req);

    res.json(can(viewer, CAPABILITIES.FINANCE_PAYMENTS_READ) ? toStaffPayment(payment) : toGuestPayment(payment));
});

paymentRoutes.post(
    '/:id/retry',
    paymentCreateLimiter,
    optionalAuthenticate,
    validate({ params: paymentIdParamSchema, query: paymentReadQuerySchema, body: retryPaymentSchema }),
    async (req, res) => {
        const { payment, token, reused } = await retryPayment(
            req.valid.params.id,
            { idempotencyKey: idempotencyKeyFrom(req), locale: req.valid.body.locale, ip: req.ip, token: req.valid.query.t ?? null },
            req.user ?? null,
            req
        );

        res.status(reused ? 200 : 201).json({ ...toGuestPayment(payment, { token }), reused });
    }
);
