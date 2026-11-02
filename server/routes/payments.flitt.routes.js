import express, { Router } from 'express';

import { config } from '../config.js';
import { NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { verifyReturnToken } from '../lib/payments/returnToken.js';
import { pspCallbackLimiter, pspReturnLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { applyCallbackEvents, ingestCallback } from '../services/payments/flitt-callback.service.js';
import { closeAttempt, findPaymentOr404, markReturned, refreshFromProvider } from '../services/payments/psp-payment.service.js';
import { returnParamSchema, returnQuerySchema } from '../validation/payments.js';

/**
 * The two doors Flitt comes through. Mounted in app.js *before* the global
 * limiter, the origin check and the JSON parser:
 *
 *   - the callback is a server-to-server POST with no cookie and no Origin,
 *     whose body must reach the signature check byte for byte — so it is
 *     read raw here, never by express.json;
 *   - the return is the guest's browser arriving from pay.flitt.com, which
 *     the origin check would (rightly) call cross-site if it were a POST.
 *
 * Neither changes a payment's state on its own say-so. The callback is
 * stored and then re-read from the gateway; the return only redirects.
 */
export const paymentsFlittRoutes = Router();

const flitt = () => config.payments.flitt;

const requireEnabled = (req, res, next) => {
    if (!flitt().enabled) {
        throw new NotFoundError('Not found');
    }

    next();
};

paymentsFlittRoutes.post(
    '/callback',
    requireEnabled,
    pspCallbackLimiter,
    express.raw({ type: () => true, limit: '64kb' }),
    async (req, res) => {
        const result = await ingestCallback({ raw: req.body, contentType: req.get('content-type') ?? '', ip: req.ip });

        res.status(result.status).json(result.body);

        // The gateway has its answer; the work happens now, off the request,
        // and again on the sweeper if this does not finish.
        if (result.status === 200 && !result.duplicate && result.paymentId) {
            setImmediate(() => {
                applyCallbackEvents().catch((err) => logger.error({ err: err?.message }, 'Applying a Flitt callback failed'));
            });
        }
    }
);

/** `${APP_URL}/<locale>/booking/payment/<id>?t=<token>`; English is unprefixed. */
const resultPageUrl = (payment, token) => {
    const base = config.appUrl.replace(/\/+$/, '');
    const locale = payment.lang && payment.lang !== 'en' ? `/${payment.lang}` : '';

    return `${base}${locale}/booking/payment/${encodeURIComponent(payment.id)}?t=${encodeURIComponent(token)}`;
};

/**
 * The guest comes back. GET or POST (the gateway's method is not documented;
 * both are accepted and neither is trusted), any parameters ignored. With
 * `?cancel=1` — the cancel link on the payment page — the attempt is closed
 * as the guest's choice, but only after the gateway confirms nobody paid.
 */
const handleReturn = async (req, res) => {
    const { id, token } = req.valid.params;
    const payment = await findPaymentOr404(id);

    if (!verifyReturnToken(payment.id, token)) {
        throw new NotFoundError('Payment not found');
    }

    await markReturned(payment.id);

    if (req.valid.query.cancel && ['REDIRECT_READY', 'PROCESSING'].includes(payment.status)) {
        try {
            const result = await refreshFromProvider(payment.id, { source: 'poll' });

            if (result.status === 'REDIRECT_READY') {
                await closeAttempt(payment.id, 'CANCELLED', 'GUEST', { reason: 'Cancelled on the payment page' });
            }
        } catch (err) {
            logger.warn({ paymentId: payment.id, err: err?.message }, 'Could not confirm a cancelled payment with the gateway; left open for the sweeper');
        }
    }

    res.redirect(303, resultPageUrl(payment, token));
};

paymentsFlittRoutes.get('/return/:id/:token', requireEnabled, pspReturnLimiter, validate({ params: returnParamSchema, query: returnQuerySchema }), handleReturn);
paymentsFlittRoutes.post('/return/:id/:token', requireEnabled, pspReturnLimiter, express.raw({ type: () => true, limit: '64kb' }), validate({ params: returnParamSchema, query: returnQuerySchema }), handleReturn);
