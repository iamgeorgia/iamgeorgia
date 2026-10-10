import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { requireCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import {
    calendarQuerySchema,
    inventoryRangeSchema,
    rateRangeSchema,
    taxFeeParamSchema,
    taxFeeSchema
} from '../validation/inventory.js';
import { hotelScopedParamSchema, ratePlanParamSchema, roomTypeScopedParamSchema } from '../validation/ratePlan.js';
import {
    deleteTaxFee,
    listTaxFees,
    readCalendar,
    setInventoryRange,
    setRateRange,
    upsertTaxFee
} from '../services/hotel/inventory.service.js';
import { toCalendar, toTaxFee } from '../serializers/inventory.js';

/**
 * Inventory and rates, edited as ranges.
 *
 * `PUT` rather than `POST` because these are idempotent: sending the same range
 * twice leaves the same state. The body carries only what is being set, and
 * anything omitted keeps whatever the night already had — so "close December to
 * arrivals" does not have to restate the room counts to avoid wiping them.
 */
export const adminInventoryRoutes = Router({ mergeParams: true });

adminInventoryRoutes.get(
    '/calendar',
    validate({ params: roomTypeScopedParamSchema, query: calendarQuerySchema }),
    async (req, res) => {
        const { hotelId, roomTypeId } = req.valid.params;
        const calendar = await readCalendar(hotelId, roomTypeId, req.valid.query);

        res.json(toCalendar(calendar, req.user, calendar.roomType.hotel));
    }
);

adminInventoryRoutes.put(
    '/',
    validate({ params: roomTypeScopedParamSchema, body: inventoryRangeSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId } = req.valid.params;
        const result = await setInventoryRange(hotelId, roomTypeId, req.valid.body, req.user, req);

        res.json(result);
    }
);

/** Rates hang off a rate plan, because a price only means anything with terms. */
export const adminRateRoutes = Router({ mergeParams: true });

// What a hotel costs and sells for is `pricing.write`, over and above the
// catalogue capability the router inherits: a role that edits the catalogue
// does not thereby set its prices.
const pricing = requireCapability(CAPABILITIES.PRICING_WRITE);

adminRateRoutes.put(
    '/',
    pricing,
    validate({ params: ratePlanParamSchema, body: rateRangeSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId, ratePlanId } = req.valid.params;
        const result = await setRateRange(hotelId, roomTypeId, ratePlanId, req.valid.body, req.user, req);

        res.json(result);
    }
);

/** Taxes and fees are a property of the hotel, not of any one rate. */
export const adminTaxFeeRoutes = Router({ mergeParams: true });

adminTaxFeeRoutes.get('/', validate({ params: hotelScopedParamSchema }), async (req, res) => {
    const taxFees = await listTaxFees(req.valid.params.hotelId);

    res.json({ data: taxFees.map(toTaxFee) });
});

adminTaxFeeRoutes.post('/', pricing, validate({ params: hotelScopedParamSchema, body: taxFeeSchema }), async (req, res) => {
    const taxFee = await upsertTaxFee(req.valid.params.hotelId, null, req.valid.body, req.user, req);

    res.status(201).json(toTaxFee(taxFee));
});

adminTaxFeeRoutes.put(
    '/:taxFeeId',
    pricing,
    validate({ params: taxFeeParamSchema, body: taxFeeSchema }),
    async (req, res) => {
        const { hotelId, taxFeeId } = req.valid.params;
        const taxFee = await upsertTaxFee(hotelId, taxFeeId, req.valid.body, req.user, req);

        res.json(toTaxFee(taxFee));
    }
);

adminTaxFeeRoutes.delete('/:taxFeeId', pricing, validate({ params: taxFeeParamSchema }), async (req, res) => {
    const { hotelId, taxFeeId } = req.valid.params;
    await deleteTaxFee(hotelId, taxFeeId, req.user, req);

    res.status(204).end();
});
