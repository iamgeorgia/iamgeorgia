import { Router } from 'express';

import { authenticate, requireCapabilityByMethod } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { validate } from '../middleware/validate.js';
import {
    amenityLocaleParamSchema,
    amenityQuerySchema,
    amenityTranslationSchema,
    createAmenitySchema,
    idParamSchema,
    updateAmenitySchema
} from '../validation/amenity.js';
import {
    createAmenity,
    findAmenityOr404,
    listAmenities,
    updateAmenity,
    upsertAmenityTranslation
} from '../services/hotel/amenity.service.js';
import { toAmenity, toAmenityTranslation } from '../serializers/amenity.js';

/**
 * The amenity vocabulary, read publicly and written by admins.
 *
 * Two routers from one file because they serve the same small resource and
 * splitting them would mean two files that import the same five things. The
 * guards are on the admin router, not on individual handlers.
 */

export const amenityRoutes = Router();

// Public reads never see deactivated amenities: `includeInactive` is dropped
// before the service sees it, rather than trusted from the query string.
amenityRoutes.get('/', validate({ query: amenityQuerySchema }), async (req, res) => {
    const { locale, category, scope } = req.valid.query;
    const amenities = await listAmenities({ category, scope, locale, includeInactive: false });

    res.json({ data: amenities.map((amenity) => toAmenity(amenity, locale)) });
});

export const adminAmenityRoutes = Router();

adminAmenityRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.CATALOGUE_READ], write: [CAPABILITIES.CATALOGUE_WRITE] }));

adminAmenityRoutes.get('/', validate({ query: amenityQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const amenities = await listAmenities(req.valid.query);

    res.json({ data: amenities.map((amenity) => toAmenity(amenity, locale)) });
});

adminAmenityRoutes.get(
    '/:id',
    validate({ params: idParamSchema, query: amenityQuerySchema }),
    async (req, res) => {
        const amenity = await findAmenityOr404(req.valid.params.id, { locale: req.valid.query.locale });

        res.json(toAmenity(amenity, req.valid.query.locale));
    }
);

adminAmenityRoutes.post('/', validate({ body: createAmenitySchema }), async (req, res) => {
    const amenity = await createAmenity(req.valid.body, req.user, req);

    res.status(201).json(toAmenity(amenity));
});

adminAmenityRoutes.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateAmenitySchema }),
    async (req, res) => {
        const amenity = await updateAmenity(req.valid.params.id, req.valid.body, req.user, req);

        res.json(toAmenity(amenity));
    }
);

adminAmenityRoutes.put(
    '/:id/translations/:locale',
    validate({ params: amenityLocaleParamSchema, body: amenityTranslationSchema }),
    async (req, res) => {
        const { id, locale } = req.valid.params;
        const translation = await upsertAmenityTranslation(id, locale, req.valid.body, req.user, req);

        res.json(toAmenityTranslation(translation));
    }
);
