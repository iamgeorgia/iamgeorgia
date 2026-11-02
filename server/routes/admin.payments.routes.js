import { Router } from 'express';

import { config } from '../config.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { checkStatusByStaff, findPaymentOr404, listPayments, toStaffPayment } from '../services/payments/psp-payment.service.js';
import { adminPaymentsListSchema, paymentIdParamSchema } from '../validation/payments.js';

/**
 * Card payments for the finance desk: the list, one attempt with its callbacks
 * and refunds, a status check by hand, and the settings that drive the
 * test-mode banner. Refunds open through the approvals module (Phase 5).
 */
export const adminPaymentRoutes = Router();

adminPaymentRoutes.use(authenticate);

const flitt = () => config.payments.flitt;

/** Never the key. Read by every panel page for the banner, so any staff member may ask. */
adminPaymentRoutes.get('/settings', requireCapability(CAPABILITIES.FINANCE_PAYMENTS_READ, CAPABILITIES.BOOKINGS_READ, CAPABILITIES.CATALOGUE_READ), (req, res) => {
    const settings = flitt();

    res.json({
        enabled: settings.enabled,
        provider: 'FLITT',
        mode: settings.enabled ? (settings.mode === 'live' ? 'LIVE' : 'TEST') : null,
        merchantId: settings.enabled ? settings.merchantId : null,
        apiBaseUrl: settings.enabled ? settings.apiBaseUrl : null,
        callbackUrl: settings.enabled ? settings.callbackUrl : null,
        currencies: settings.currencies,
        orderLifetimeSeconds: settings.orderLifetimeSeconds
    });
});

adminPaymentRoutes.get('/', requireCapability(CAPABILITIES.FINANCE_PAYMENTS_READ), validate({ query: adminPaymentsListSchema }), async (req, res) => {
    res.json(await listPayments(req.valid.query));
});

adminPaymentRoutes.get('/:id', requireCapability(CAPABILITIES.FINANCE_PAYMENTS_READ), validate({ params: paymentIdParamSchema }), async (req, res) => {
    res.json(toStaffPayment(await findPaymentOr404(req.valid.params.id, { detail: true })));
});

adminPaymentRoutes.post('/:id/check-status', requireCapability(CAPABILITIES.FINANCE_PAYMENTS_WRITE), validate({ params: paymentIdParamSchema }), async (req, res) => {
    const { payment, ...result } = await checkStatusByStaff(req.valid.params.id, req.user, req);

    res.json({ ...result, payment: toStaffPayment(payment) });
});
