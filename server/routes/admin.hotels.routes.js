import { Router } from 'express';

import { authenticate, requireCapability, requireCapabilityByMethod, requireFieldsCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { validate } from '../middleware/validate.js';
import {
    archiveHotelSchema,
    createHotelSchema,
    hotelAmenitiesSchema,
    hotelLocaleParamSchema,
    hotelQuerySchema,
    hotelTranslationSchema,
    idParamSchema,
    updateHotelSchema
} from '../validation/hotel.js';
import {
    archiveHotel,
    buildPublishChecklist,
    createHotel,
    deleteHotel,
    findHotelOr404,
    listHotels,
    publishHotel,
    replaceHotelAmenities,
    unpublishHotel,
    updateHotel,
    upsertHotelTranslation
} from '../services/hotel/hotel.service.js';
import { toHotelDetail, toHotelSummary, toHotelTranslation } from '../serializers/hotel.js';
import { toHotelImage } from '../serializers/media.js';
import {
    attachHotelImageSchema,
    hotelImageParamSchema,
    reorderHotelImagesSchema,
    updateHotelImageSchema
} from '../validation/media.js';
import { hotelGallery } from '../services/hotel/gallery.service.js';
import { adminChildPolicyRoutes, adminRoomTypeRoutes } from './admin.roomTypes.routes.js';
import { adminHotelMealPlanRoutes, adminPolicyRoutes } from './admin.ratePlans.routes.js';
import { listHotelRatePlans } from '../services/hotel/ratePlan.service.js';
import { hotelScopedParamSchema } from '../validation/ratePlan.js';
import { toRatePlan } from '../serializers/ratePlan.js';
import { adminTaxFeeRoutes } from './admin.inventory.routes.js';
import { adminKosherRoutes } from './admin.hotels.kosher.routes.js';
import { adminHotelDocumentRoutes } from './admin.hotels.documents.routes.js';

/**
 * Hotel administration — the eleven-step wizard's back end.
 *
 * Step 1 POSTs a DRAFT; every later step PATCHes a field or a sub-resource, so
 * an interrupted wizard is a resumable record rather than lost form state. The
 * guards are on the router: a new endpoint here cannot be added without them.
 */
export const adminHotelRoutes = Router();

adminHotelRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.CATALOGUE_READ], write: [CAPABILITIES.CATALOGUE_WRITE] }));

// Room types and the child policy hang off a hotel and are only ever
// addressable through it. Mounted here rather than at the top level so they
// inherit the guards above — a sub-router that re-applies its own is a
// sub-router someone will eventually add without them.
adminHotelRoutes.use('/:hotelId/room-types', adminRoomTypeRoutes);
adminHotelRoutes.use('/:hotelId/child-policy', adminChildPolicyRoutes);
adminHotelRoutes.use('/:hotelId/policies', adminPolicyRoutes);
adminHotelRoutes.use('/:hotelId/meal-plans', adminHotelMealPlanRoutes);
adminHotelRoutes.use('/:hotelId/tax-fees', adminTaxFeeRoutes);
// Kosher and the document library hang off a hotel the same way. Kosher lives
// behind its own router rather than as fields on `PATCH /:id` so that
// verification cannot be reached by an ordinary hotel update — the same
// treatment `status` gets, and for the same reason.
adminHotelRoutes.use('/:hotelId/kosher', adminKosherRoutes);
// A property's contracts are partner business, not catalogue: a dispatcher
// reads the hotel to run transfers to it, never its paperwork.
adminHotelRoutes.use('/:hotelId/documents', requireCapability(CAPABILITIES.PARTNERS_READ), adminHotelDocumentRoutes);

/**
 * Every rate plan in the property, flat.
 *
 * The nested `/:hotelId/room-types/:roomTypeId/rate-plans` listing stays the
 * one that manages plans; this one exists for the pickers that constrain a
 * package slot, which choose across a hotel rather than within one room. Each
 * row names its room type, because "Refundable" on its own identifies nothing.
 */
adminHotelRoutes.get('/:hotelId/rate-plans', validate({ params: hotelScopedParamSchema }), async (req, res) => {
    const ratePlans = await listHotelRatePlans(req.valid.params.hotelId);

    res.json({
        data: ratePlans.map((ratePlan) => ({
            ...toRatePlan(ratePlan),
            roomType: { id: ratePlan.roomType.id, code: ratePlan.roomType.code, name: ratePlan.roomType.name }
        }))
    });
});

adminHotelRoutes.get('/', validate({ query: hotelQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const { hotels, ...page } = await listHotels(req.valid.query);

    res.json({ data: hotels.map((hotel) => toHotelSummary(hotel, locale, req.user)), ...page });
});

adminHotelRoutes.get('/:id', validate({ params: idParamSchema, query: hotelQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const hotel = await findHotelOr404(req.valid.params.id, { locale });

    res.json({
        ...toHotelDetail(hotel, locale, req.user),
        // The review step needs to know what is outstanding before it lets an
        // admin press publish, so the checklist travels with the record rather
        // than only appearing in the 422 from a failed attempt.
        publishChecklist: buildPublishChecklist(hotel)
    });
});

// Who supplies a hotel and in what currency it sells are its prices by
// another road — the supplier sets the rates on the extranet — so the two
// fields need `pricing.write` on top of the catalogue capability.
const pricingFields = requireFieldsCapability(['supplierId', 'currency'], CAPABILITIES.PRICING_WRITE);

adminHotelRoutes.post('/', pricingFields, validate({ body: createHotelSchema }), async (req, res) => {
    const created = await createHotel(req.valid.body, req.user, req);
    const hotel = await findHotelOr404(created.id);

    res.status(201).json({ ...toHotelDetail(hotel, 'en', req.user), publishChecklist: buildPublishChecklist(hotel) });
});

adminHotelRoutes.patch(
    '/:id',
    pricingFields,
    validate({ params: idParamSchema, body: updateHotelSchema }),
    async (req, res) => {
        await updateHotel(req.valid.params.id, req.valid.body, req.user, req);
        const hotel = await findHotelOr404(req.valid.params.id);

        res.json({ ...toHotelDetail(hotel, 'en', req.user), publishChecklist: buildPublishChecklist(hotel) });
    }
);

adminHotelRoutes.put(
    '/:id/amenities',
    validate({ params: idParamSchema, body: hotelAmenitiesSchema }),
    async (req, res) => {
        await replaceHotelAmenities(req.valid.params.id, req.valid.body.amenities, req.user, req);
        const hotel = await findHotelOr404(req.valid.params.id);

        res.json(toHotelDetail(hotel, 'en', req.user));
    }
);

// Transitions, each with its own rules — deliberately not a PATCH of `status`.
const transition = (handler) => [
    validate({ params: idParamSchema }),
    async (req, res) => {
        await handler(req.valid.params.id, req.user, req);
        const hotel = await findHotelOr404(req.valid.params.id);

        res.json(toHotelDetail(hotel, 'en', req.user));
    }
];

// Open only while the property has no booking history; 409 otherwise, with
// archiving as the answer. The service also removes gallery images that
// nothing else references, bytes included.
adminHotelRoutes.delete('/:id', validate({ params: idParamSchema }), async (req, res) => {
    await deleteHotel(req.valid.params.id, req.user, req);

    res.status(204).end();
});

adminHotelRoutes.post('/:id/publish', ...transition(publishHotel));
adminHotelRoutes.post('/:id/unpublish', ...transition(unpublishHotel));

adminHotelRoutes.post(
    '/:id/archive',
    validate({ params: idParamSchema, body: archiveHotelSchema }),
    async (req, res) => {
        await archiveHotel(req.valid.params.id, req.valid.body, req.user, req);
        const hotel = await findHotelOr404(req.valid.params.id);

        res.json(toHotelDetail(hotel, 'en', req.user));
    }
);

// --- gallery ---------------------------------------------------------------
// Attaching is separate from uploading: an asset is uploaded once to the media
// library and may then be attached, detached and re-attached without the bytes
// moving or its key changing.

adminHotelRoutes.post(
    '/:id/images',
    validate({ params: idParamSchema, body: attachHotelImageSchema }),
    async (req, res) => {
        const image = await hotelGallery.attach(req.valid.params.id, req.valid.body, req.user, req);

        res.status(201).json(toHotelImage(image));
    }
);

adminHotelRoutes.patch(
    '/:id/images/:imageId',
    validate({ params: hotelImageParamSchema, body: updateHotelImageSchema }),
    async (req, res) => {
        const { id, imageId } = req.valid.params;
        const image = await hotelGallery.update(id, imageId, req.valid.body, req.user, req);

        res.json(toHotelImage(image));
    }
);

adminHotelRoutes.delete(
    '/:id/images/:imageId',
    validate({ params: hotelImageParamSchema }),
    async (req, res) => {
        const { id, imageId } = req.valid.params;
        await hotelGallery.detach(id, imageId, req.user, req);

        res.status(204).end();
    }
);

adminHotelRoutes.put(
    '/:id/images/order',
    validate({ params: idParamSchema, body: reorderHotelImagesSchema }),
    async (req, res) => {
        await hotelGallery.reorder(req.valid.params.id, req.valid.body.order, req.user, req);
        const hotel = await findHotelOr404(req.valid.params.id);

        res.json({ data: hotel.images.map(toHotelImage) });
    }
);

adminHotelRoutes.put(
    '/:id/translations/:locale',
    validate({ params: hotelLocaleParamSchema, body: hotelTranslationSchema }),
    async (req, res) => {
        const { id, locale } = req.valid.params;
        const translation = await upsertHotelTranslation(id, locale, req.valid.body, req.user, req);

        res.json(toHotelTranslation(translation));
    }
);
