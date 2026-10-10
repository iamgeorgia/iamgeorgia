import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { requireCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import {
    attachRoomImageSchema,
    childPolicySchema,
    createRoomTypeSchema,
    hotelScopedParamSchema,
    reorderRoomImagesSchema,
    roomTypeAmenitiesSchema,
    roomTypeImageParamSchema,
    roomTypeLocaleParamSchema,
    roomTypeParamSchema,
    roomTypeQuerySchema,
    roomTypeTranslationSchema,
    setBedsSchema,
    updateRoomImageSchema,
    updateRoomTypeSchema
} from '../validation/roomType.js';
import {
    archiveRoomType,
    createRoomType,
    findRoomTypeOr404,
    listRoomTypes,
    setBeds,
    setRoomTypeAmenities,
    updateRoomType,
    upsertRoomTypeTranslation
} from '../services/hotel/roomType.service.js';
import { findChildPolicy, upsertChildPolicy } from '../services/hotel/childPolicy.service.js';
import { roomTypeGallery } from '../services/hotel/gallery.service.js';
import { adminRatePlanRoutes } from './admin.ratePlans.routes.js';
import { adminInventoryRoutes } from './admin.inventory.routes.js';
import { toChildPolicy, toRoomTypeDetail, toRoomTypeSummary, toRoomTypeTranslation } from '../serializers/roomType.js';

/**
 * Room types, mounted beneath a hotel.
 *
 * `mergeParams` is what makes `:hotelId` visible here, and every service call
 * passes it through — a room type is only ever addressable via the hotel that
 * owns it, so an id from one property cannot be reached through another's URL.
 *
 * Authentication comes from the parent router. Nothing here re-applies it,
 * because a guard that can be forgotten on one sub-router is a guard that will
 * eventually be forgotten.
 */
export const adminRoomTypeRoutes = Router({ mergeParams: true });

// Rate plans belong to a room type the way room types belong to a hotel, and
// are mounted the same way so the whole chain of ownership is checked.
adminRoomTypeRoutes.use('/:roomTypeId/rate-plans', adminRatePlanRoutes);
// Inventory is counted on the room type; price is quoted on the rate plan.
adminRoomTypeRoutes.use('/:roomTypeId/inventory', adminInventoryRoutes);

const reload = async (req, locale = 'en') =>
    findRoomTypeOr404(req.valid.params.hotelId, req.valid.params.roomTypeId, { locale });

adminRoomTypeRoutes.get(
    '/',
    validate({ params: hotelScopedParamSchema, query: roomTypeQuerySchema }),
    async (req, res) => {
        const { locale } = req.valid.query;
        const { roomTypes } = await listRoomTypes(req.valid.params.hotelId, req.valid.query);

        res.json({ data: roomTypes.map((roomType) => toRoomTypeSummary(roomType, locale)) });
    }
);

adminRoomTypeRoutes.post(
    '/',
    validate({ params: hotelScopedParamSchema, body: createRoomTypeSchema }),
    async (req, res) => {
        const created = await createRoomType(req.valid.params.hotelId, req.valid.body, req.user, req);
        const roomType = await findRoomTypeOr404(req.valid.params.hotelId, created.id);

        res.status(201).json(toRoomTypeDetail(roomType));
    }
);

adminRoomTypeRoutes.get(
    '/:roomTypeId',
    validate({ params: roomTypeParamSchema, query: roomTypeQuerySchema }),
    async (req, res) => {
        const roomType = await reload(req, req.valid.query.locale);

        res.json(toRoomTypeDetail(roomType, req.valid.query.locale));
    }
);

adminRoomTypeRoutes.patch(
    '/:roomTypeId',
    validate({ params: roomTypeParamSchema, body: updateRoomTypeSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId } = req.valid.params;
        await updateRoomType(hotelId, roomTypeId, req.valid.body, req.user, req);

        res.json(toRoomTypeDetail(await reload(req)));
    }
);

// Archive, not delete: once bookings exist they have to keep resolving to the
// room they were made against.
adminRoomTypeRoutes.post(
    '/:roomTypeId/archive',
    validate({ params: roomTypeParamSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId } = req.valid.params;
        await archiveRoomType(hotelId, roomTypeId, req.user, req);

        res.json(toRoomTypeDetail(await reload(req)));
    }
);

adminRoomTypeRoutes.put(
    '/:roomTypeId/beds',
    validate({ params: roomTypeParamSchema, body: setBedsSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId } = req.valid.params;
        await setBeds(hotelId, roomTypeId, req.valid.body.beds, req.user, req);

        res.json(toRoomTypeDetail(await reload(req)));
    }
);

adminRoomTypeRoutes.put(
    '/:roomTypeId/amenities',
    validate({ params: roomTypeParamSchema, body: roomTypeAmenitiesSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId } = req.valid.params;
        await setRoomTypeAmenities(hotelId, roomTypeId, req.valid.body.amenities, req.user, req);

        res.json(toRoomTypeDetail(await reload(req)));
    }
);

// --- gallery ---------------------------------------------------------------

adminRoomTypeRoutes.post(
    '/:roomTypeId/images',
    validate({ params: roomTypeParamSchema, body: attachRoomImageSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId } = req.valid.params;
        // Reading through the hotel first is the ownership check: it 404s if
        // this room type belongs to a different property.
        await findRoomTypeOr404(hotelId, roomTypeId);
        await roomTypeGallery.attach(roomTypeId, req.valid.body, req.user, req);

        res.status(201).json(toRoomTypeDetail(await reload(req)));
    }
);

adminRoomTypeRoutes.patch(
    '/:roomTypeId/images/:imageId',
    validate({ params: roomTypeImageParamSchema, body: updateRoomImageSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId, imageId } = req.valid.params;
        await findRoomTypeOr404(hotelId, roomTypeId);
        await roomTypeGallery.update(roomTypeId, imageId, req.valid.body, req.user, req);

        res.json(toRoomTypeDetail(await reload(req)));
    }
);

adminRoomTypeRoutes.delete(
    '/:roomTypeId/images/:imageId',
    validate({ params: roomTypeImageParamSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId, imageId } = req.valid.params;
        await findRoomTypeOr404(hotelId, roomTypeId);
        await roomTypeGallery.detach(roomTypeId, imageId, req.user, req);

        res.status(204).end();
    }
);

adminRoomTypeRoutes.put(
    '/:roomTypeId/images/order',
    validate({ params: roomTypeParamSchema, body: reorderRoomImagesSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId } = req.valid.params;
        await findRoomTypeOr404(hotelId, roomTypeId);
        await roomTypeGallery.reorder(roomTypeId, req.valid.body.order, req.user, req);

        res.json(toRoomTypeDetail(await reload(req)));
    }
);

adminRoomTypeRoutes.put(
    '/:roomTypeId/translations/:locale',
    validate({ params: roomTypeLocaleParamSchema, body: roomTypeTranslationSchema }),
    async (req, res) => {
        const { hotelId, roomTypeId, locale } = req.valid.params;
        const translation = await upsertRoomTypeTranslation(
            hotelId,
            roomTypeId,
            locale,
            req.valid.body,
            req.user,
            req
        );

        res.json(toRoomTypeTranslation(translation));
    }
);

/**
 * The child policy, mounted beside room types because it is what makes their
 * occupancy numbers mean anything.
 */
export const adminChildPolicyRoutes = Router({ mergeParams: true });

adminChildPolicyRoutes.get('/', validate({ params: hotelScopedParamSchema }), async (req, res) => {
    const policy = await findChildPolicy(req.valid.params.hotelId);

    // Null rather than the platform default: a client that needs to know
    // whether this hotel has *chosen* a policy can tell, and one that just
    // wants the effective rules reads the defaults from its own config.
    res.json(toChildPolicy(policy));
});

adminChildPolicyRoutes.put(
    '/',
    // Age bands carry charges: `pricing.write`, over and above the catalogue capability.
    requireCapability(CAPABILITIES.PRICING_WRITE),
    validate({ params: hotelScopedParamSchema, body: childPolicySchema }),
    async (req, res) => {
        const policy = await upsertChildPolicy(req.valid.params.hotelId, req.valid.body, req.user, req);

        res.json(toChildPolicy(policy));
    }
);
