import { Router } from 'express';
import { z } from 'zod';

import { authenticate, requireCapabilityByMethod } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { validate } from '../middleware/validate.js';
import { textField } from '../validation/normalize.js';
import { dateOnlyField } from '../validation/ratePlan.js';
import {
    deletePricingRule,
    explainMarkup,
    listPricingRules,
    upsertPricingRule
} from '../services/hotel/pricingRule.service.js';

/**
 * Who pays what markup.
 *
 * Admin-only, and deliberately so: a supplier may set its own rates, but what
 * the platform adds on top is a commercial decision between us and the buyer.
 */
export const adminPricingRuleRoutes = Router();

adminPricingRuleRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.FINANCE_MARGIN_READ], write: [CAPABILITIES.PRICING_WRITE] }));

const ruleSchema = z
    .object({
        // Every dimension is optional. A rule that sets none applies to every
        // buyer at every property, which is how a platform default is written.
        partnerId: z.string().min(1).nullish(),
        hotelId: z.string().min(1).nullish(),
        // At most one named product; the service refuses two with a 422.
        tourId: z.string().min(1).nullish(),
        serviceId: z.string().min(1).nullish(),
        packageId: z.string().min(1).nullish(),
        // Or a whole product type — "every tour" — on its own.
        productType: z.enum(['HOTEL', 'TRANSFER', 'TOUR', 'SERVICE', 'PACKAGE']).nullish(),
        destinationId: z.string().min(1).nullish(),
        markupBps: z.number().int().min(0).max(100_000),
        label: textField(120).nullish(),
        priority: z.number().int().min(0).max(1000).optional(),
        isActive: z.boolean().optional(),
        validFrom: dateOnlyField.nullish(),
        validUntil: dateOnlyField.nullish()
    })
    .strict()
    .refine((value) => !value.validFrom || !value.validUntil || value.validUntil >= value.validFrom, {
        message: 'The window ends before it begins',
        path: ['validUntil']
    });

const querySchema = z.object({
    partnerId: z.string().min(1).optional(),
    hotelId: z.string().min(1).optional(),
    tourId: z.string().min(1).optional(),
    serviceId: z.string().min(1).optional(),
    packageId: z.string().min(1).optional(),
    productType: z.enum(['HOTEL', 'TRANSFER', 'TOUR', 'SERVICE', 'PACKAGE']).optional(),
    includeInactive: z.stringbool().default(false)
});

const idParamSchema = z.object({ id: z.string().min(1) });

const toRule = (rule) => ({
    id: rule.id,
    markupBps: rule.markupBps,
    label: rule.label ?? null,
    priority: rule.priority,
    isActive: rule.isActive,
    partner: rule.partner ?? null,
    hotel: rule.hotel ?? null,
    tour: rule.tour ?? null,
    service: rule.service ?? null,
    package: rule.package ?? null,
    productType: rule.productType ?? null,
    destination: rule.destination ?? null,
    validFrom: rule.validFrom ? rule.validFrom.toISOString().slice(0, 10) : null,
    validUntil: rule.validUntil ? rule.validUntil.toISOString().slice(0, 10) : null,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt
});

adminPricingRuleRoutes.get('/', validate({ query: querySchema }), async (req, res) => {
    const rules = await listPricingRules(req.valid.query);

    res.json({ data: rules.map(toRule) });
});

/**
 * Which markup a given buyer would get at a given hotel, and where it came
 * from.
 *
 * "Why is this partner seeing that price" is the commonest question about a B2B
 * platform, and answering it by reading code is a poor use of an afternoon.
 */
adminPricingRuleRoutes.get(
    '/explain',
    validate({
        query: z.object({
            partnerId: z.string().min(1).optional(),
            hotelId: z.string().min(1).optional(),
            tourId: z.string().min(1).optional(),
            serviceId: z.string().min(1).optional(),
            packageId: z.string().min(1).optional(),
            productType: z.enum(['HOTEL', 'TRANSFER', 'TOUR', 'SERVICE', 'PACKAGE']).optional(),
            date: dateOnlyField.optional()
        })
    }),
    async (req, res) => {
        res.json(await explainMarkup(req.valid.query));
    }
);

adminPricingRuleRoutes.post('/', validate({ body: ruleSchema }), async (req, res) => {
    const rule = await upsertPricingRule(null, req.valid.body, req.user, req);

    res.status(201).json(toRule(rule));
});

adminPricingRuleRoutes.put(
    '/:id',
    validate({ params: idParamSchema, body: ruleSchema }),
    async (req, res) => {
        const rule = await upsertPricingRule(req.valid.params.id, req.valid.body, req.user, req);

        res.json(toRule(rule));
    }
);

adminPricingRuleRoutes.delete('/:id', validate({ params: idParamSchema }), async (req, res) => {
    await deletePricingRule(req.valid.params.id, req.user, req);

    res.status(204).end();
});
