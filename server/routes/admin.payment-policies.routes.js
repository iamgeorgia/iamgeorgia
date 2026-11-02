import { Router } from 'express';

import { CAPABILITIES } from '../lib/permissions.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { toPaymentPolicy } from '../serializers/ratePlan.js';
import { createPaymentPolicyTemplate, findPaymentPolicyTemplateOr404, listPaymentPolicyTemplates, updatePaymentPolicyTemplate } from '../services/payments/payment-policies.service.js';
import { paymentIdParamSchema, paymentPolicyTemplateSchema, paymentPolicyTemplateUpdateSchema, paymentPolicyTemplatesQuerySchema } from '../validation/payments.js';

/**
 * Payment policy templates for tours, transfers and packages: the catalogue
 * screen in the panel. Hotel policies stay under /api/admin/hotels/:id/…
 * where they always were.
 */
export const adminPaymentPolicyRoutes = Router();

adminPaymentPolicyRoutes.use(authenticate);

adminPaymentPolicyRoutes.get('/', requireCapability(CAPABILITIES.CATALOGUE_READ), validate({ query: paymentPolicyTemplatesQuerySchema }), async (req, res) => {
    const policies = await listPaymentPolicyTemplates(req.valid.query);

    res.json({ data: policies.map(toPaymentPolicy) });
});

adminPaymentPolicyRoutes.get('/:id', requireCapability(CAPABILITIES.CATALOGUE_READ), validate({ params: paymentIdParamSchema }), async (req, res) => {
    res.json(toPaymentPolicy(await findPaymentPolicyTemplateOr404(req.valid.params.id)));
});

adminPaymentPolicyRoutes.post('/', requireCapability(CAPABILITIES.CATALOGUE_WRITE), validate({ body: paymentPolicyTemplateSchema }), async (req, res) => {
    const policy = await createPaymentPolicyTemplate(req.valid.body, req.user, req);

    res.status(201).json(toPaymentPolicy(policy));
});

adminPaymentPolicyRoutes.patch('/:id', requireCapability(CAPABILITIES.CATALOGUE_WRITE), validate({ params: paymentIdParamSchema, body: paymentPolicyTemplateUpdateSchema }), async (req, res) => {
    const policy = await updatePaymentPolicyTemplate(req.valid.params.id, req.valid.body, req.user, req);

    res.json(toPaymentPolicy(policy));
});
