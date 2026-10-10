import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { requireCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import {
    cancellationPolicySchema,
    createRatePlanSchema,
    hotelMealPlanSchema,
    hotelScopedParamSchema,
    paymentPolicySchema,
    policyParamSchema,
    policyQuerySchema,
    ratePlanParamSchema,
    ratePlanQuerySchema,
    ratePlanRestrictionSchema,
    restrictionParamSchema,
    roomTypeScopedParamSchema,
    updateRatePlanSchema
} from '../validation/ratePlan.js';
import {
    archiveRatePlan,
    createRatePlan,
    deleteRestriction,
    findRatePlanOr404,
    listHotelMealPlans,
    listRatePlans,
    setHotelMealPlan,
    updateRatePlan,
    upsertRestriction
} from '../services/hotel/ratePlan.service.js';
import {
    findCancellationPolicyOr404,
    listCancellationPolicies,
    listPaymentPolicies,
    upsertCancellationPolicy,
    upsertPaymentPolicy
} from '../services/hotel/policyCatalog.service.js';
import { adminRateRoutes } from './admin.inventory.routes.js';
import {
    toCancellationPolicy,
    toHotelMealPlan,
    toPaymentPolicy,
    toRatePlan,
    toRestriction
} from '../serializers/ratePlan.js';

/**
 * Rate plans, mounted beneath a room type.
 *
 * The nesting is the authorization: hotel -> room type -> rate plan, checked at
 * every level, so an id belonging to one property cannot be reached through
 * another's URL. Guards come from the hotel router above.
 */
export const adminRatePlanRoutes = Router({ mergeParams: true });

adminRatePlanRoutes.use('/:ratePlanId/rates', adminRateRoutes);

const reload = (req) =>
    findRatePlanOr404(req.valid.params.hotelId, req.valid.params.roomTypeId, req.valid.params.ratePlanId);

adminRatePlanRoutes.get(
    '/',
    validate({ params: roomTypeScopedParamSchema, query: ratePlanQuerySchema }),
    async (req, res) => {
        const { hotelId, roomTypeId } = req.valid.params;
        const ratePlans = await listRatePlans(hotelId, roomTypeId, req.valid.query);

        res.json({ data: ratePlans.map(toRatePlan) });
    }
);

// A rate plan is terms and a currency, a policy is money: `pricing.write`,
// over and above the catalogue capability the router inherits.
const pricing = requireCapability(CAPABILITIES.PRICING_WRITE);

adminRatePlanRoutes.post(
    '/',
    pricing,
    validate({ params: roomTypeScopedParamSchema, body: createRatePlanSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId } = req.valid.params;
        const created = await createRatePlan(hotelId, roomTypeId, req.valid.body, req.user, req);

        res.status(201).json(toRatePlan(await findRatePlanOr404(hotelId, roomTypeId, created.id)));
    }
);

adminRatePlanRoutes.get('/:ratePlanId', validate({ params: ratePlanParamSchema }), async (req, res) => {
    res.json(toRatePlan(await reload(req)));
});

adminRatePlanRoutes.patch(
    '/:ratePlanId',
    pricing,
    validate({ params: ratePlanParamSchema, body: updateRatePlanSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId, ratePlanId } = req.valid.params;
        await updateRatePlan(hotelId, roomTypeId, ratePlanId, req.valid.body, req.user, req);

        res.json(toRatePlan(await reload(req)));
    }
);

adminRatePlanRoutes.post(
    '/:ratePlanId/archive',
    validate({ params: ratePlanParamSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId, ratePlanId } = req.valid.params;
        await archiveRatePlan(hotelId, roomTypeId, ratePlanId, req.user, req);

        res.json(toRatePlan(await reload(req)));
    }
);

// --- date-ranged restrictions ---------------------------------------------

adminRatePlanRoutes.post(
    '/:ratePlanId/restrictions',
    validate({ params: ratePlanParamSchema, body: ratePlanRestrictionSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId, ratePlanId } = req.valid.params;
        const restriction = await upsertRestriction(
            hotelId,
            roomTypeId,
            ratePlanId,
            null,
            req.valid.body,
            req.user,
            req
        );

        res.status(201).json(toRestriction(restriction));
    }
);

adminRatePlanRoutes.put(
    '/:ratePlanId/restrictions/:restrictionId',
    validate({ params: restrictionParamSchema, body: ratePlanRestrictionSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId, ratePlanId, restrictionId } = req.valid.params;
        const restriction = await upsertRestriction(
            hotelId,
            roomTypeId,
            ratePlanId,
            restrictionId,
            req.valid.body,
            req.user,
            req
        );

        res.json(toRestriction(restriction));
    }
);

adminRatePlanRoutes.delete(
    '/:ratePlanId/restrictions/:restrictionId',
    validate({ params: restrictionParamSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId, ratePlanId, restrictionId } = req.valid.params;
        await deleteRestriction(hotelId, roomTypeId, ratePlanId, restrictionId, req.user, req);

        res.status(204).end();
    }
);

/**
 * Cancellation and payment policies, and the hotel's account of each board
 * code. All hotel-scoped, and all things a rate plan points at.
 */
export const adminPolicyRoutes = Router({ mergeParams: true });

adminPolicyRoutes.get(
    '/cancellation',
    validate({ params: hotelScopedParamSchema, query: policyQuerySchema }),
    async (req, res) => {
        const policies = await listCancellationPolicies(req.valid.params.hotelId, req.valid.query);

        res.json({ data: policies.map(toCancellationPolicy) });
    }
);

adminPolicyRoutes.post(
    '/cancellation',
    pricing,
    validate({ params: hotelScopedParamSchema, body: cancellationPolicySchema }),
    async (req, res) => {
        const policy = await upsertCancellationPolicy(
            req.valid.params.hotelId,
            null,
            req.valid.body,
            req.user,
            req
        );

        res.status(201).json(toCancellationPolicy(policy));
    }
);

adminPolicyRoutes.get('/cancellation/:policyId', validate({ params: policyParamSchema }), async (req, res) => {
    const { hotelId, policyId } = req.valid.params;

    res.json(toCancellationPolicy(await findCancellationPolicyOr404(hotelId, policyId)));
});

adminPolicyRoutes.put(
    '/cancellation/:policyId',
    pricing,
    validate({ params: policyParamSchema, body: cancellationPolicySchema }),
    async (req, res) => {
        const { hotelId, policyId } = req.valid.params;
        const policy = await upsertCancellationPolicy(hotelId, policyId, req.valid.body, req.user, req);

        res.json(toCancellationPolicy(policy));
    }
);

adminPolicyRoutes.get(
    '/payment',
    validate({ params: hotelScopedParamSchema, query: policyQuerySchema }),
    async (req, res) => {
        const policies = await listPaymentPolicies(req.valid.params.hotelId, req.valid.query);

        res.json({ data: policies.map(toPaymentPolicy) });
    }
);

adminPolicyRoutes.post(
    '/payment',
    pricing,
    validate({ params: hotelScopedParamSchema, body: paymentPolicySchema }),
    async (req, res) => {
        const policy = await upsertPaymentPolicy(req.valid.params.hotelId, null, req.valid.body, req.user, req);

        res.status(201).json(toPaymentPolicy(policy));
    }
);

adminPolicyRoutes.put(
    '/payment/:policyId',
    pricing,
    validate({ params: policyParamSchema, body: paymentPolicySchema }),
    async (req, res) => {
        const { hotelId, policyId } = req.valid.params;
        const policy = await upsertPaymentPolicy(hotelId, policyId, req.valid.body, req.user, req);

        res.json(toPaymentPolicy(policy));
    }
);

export const adminHotelMealPlanRoutes = Router({ mergeParams: true });

adminHotelMealPlanRoutes.get('/', validate({ params: hotelScopedParamSchema }), async (req, res) => {
    const mealPlans = await listHotelMealPlans(req.valid.params.hotelId);

    res.json({ data: mealPlans.map(toHotelMealPlan) });
});

adminHotelMealPlanRoutes.put(
    '/',
    validate({ params: hotelScopedParamSchema, body: hotelMealPlanSchema }),
    async (req, res) => {
        const hotelMealPlan = await setHotelMealPlan(req.valid.params.hotelId, req.valid.body, req.user, req);

        res.json(toHotelMealPlan(hotelMealPlan));
    }
);
