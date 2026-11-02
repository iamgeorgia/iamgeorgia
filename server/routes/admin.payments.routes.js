import { Router } from 'express';

import { config } from '../config.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { toApproval } from '../serializers/approval.js';
import { checkStatusByStaff, findPaymentOr404, listPayments, toStaffPayment } from '../services/payments/psp-payment.service.js';
import { requestCardRefund } from '../services/payments/psp-refund.service.js';
import { paymentsHealth } from '../services/payments/psp-sweeper.service.js';
import { adminPaymentsListSchema, paymentIdParamSchema, refundPaymentSchema } from '../validation/payments.js';

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

/** Backlogs and stuck rows: what to look at when a guest says they paid and the panel disagrees. */
adminPaymentRoutes.get('/health', requireCapability(CAPABILITIES.FINANCE_PAYMENTS_READ), async (req, res) => {
    res.json(await paymentsHealth());
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

/**
 * Money back to the card: opens a REFUND approval naming the payment. A
 * second person approves it (`/api/admin/approvals/:id/approve`), the
 * outbox sends the reversal to the gateway, and the ledger follows.
 */
adminPaymentRoutes.post('/:id/refunds', requireCapability(CAPABILITIES.FINANCE_REFUNDS_REQUEST), validate({ params: paymentIdParamSchema, body: refundPaymentSchema }), async (req, res) => {
    const request = await requestCardRefund(req.valid.params.id, req.valid.body, req.user, req);

    res.status(201).json(toApproval(request));
});
