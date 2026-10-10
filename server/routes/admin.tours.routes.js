import { Router } from 'express';

import { prisma } from '../db/index.js';
import { authenticate, requireCapabilityByMethod } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { validate } from '../middleware/validate.js';
import {
    archiveTourSchema,
    attachTourImageSchema,
    createTourOptionSchema,
    createTourSchema,
    reorderTourImagesSchema,
    tourCalendarQuerySchema,
    tourImageParamSchema,
    tourInventoryRangeSchema,
    tourLocaleParamSchema,
    tourOptionParamSchema,
    tourOptionQuerySchema,
    tourParamSchema,
    tourQuerySchema,
    tourSeasonParamSchema,
    tourSeasonSchema,
    tourTranslationSchema,
    updateTourImageSchema,
    updateTourOptionSchema,
    updateTourSchema
} from '../validation/tour.js';
import {
    archiveTour,
    buildTourPublishChecklist,
    createTour,
    deleteTour,
    findTourOr404,
    listTours,
    publishTour,
    tourGallery,
    unpublishTour,
    updateTour,
    listTourTranslations,
    upsertTourTranslation
} from '../services/tour/tour.service.js';
import {
    archiveTourOption,
    createTourOption,
    deleteTourSeason,
    findTourOptionOr404,
    listTourOptions,
    updateTourOption,
    upsertTourSeason
} from '../services/tour/option.service.js';
import { readTourCalendar, setTourInventoryRange } from '../services/tour/inventory.service.js';
import {
    toTourCalendar,
    toTourDetail,
    toTourImage,
    toTourOption,
    toTourSeason,
    toTourSummary,
    toTourTranslation
} from '../serializers/tour.js';
import { toCancellationPolicy } from '../serializers/ratePlan.js';
import { tourKosherProfileSchema } from '../validation/package.js';
import { upsertTourKosherProfile } from '../services/package/package.service.js';
import { toTourKosherProfile } from '../serializers/package.js';

/**
 * Tour administration.
 *
 * The same shape as the hotel wizard's back end: a DRAFT from the first form,
 * every later screen a PATCH or a sub-resource, lifecycle on its own
 * endpoints so an ordinary update can never publish. Options, price sheets
 * and departures hang off the tour and are only ever addressable through it.
 */
export const adminTourRoutes = Router();

// Tours are the one product with a door of their own: the tour operator
// edits them with `tours.write` and holds no `catalogue.write`, so the
// hotels, transfers and services stay closed to it.
adminTourRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.CATALOGUE_READ], write: [CAPABILITIES.CATALOGUE_WRITE, CAPABILITIES.TOURS_WRITE] }));

const reload = (req, locale = 'en') => findTourOr404(req.valid.params.tourId, { locale });

const withChecklist = (tour, viewer) => ({
    ...toTourDetail(tour, 'en', viewer),
    publishChecklist: buildTourPublishChecklist(tour)
});

/**
 * The cancellation templates a tour option may use: platform-owned, active,
 * and priced against the whole total rather than a first night. Listed here
 * because the hotel policy endpoints are scoped to a property.
 */
adminTourRoutes.get('/policies/cancellation', async (req, res) => {
    const policies = await prisma.cancellationPolicy.findMany({
        where: { hotelId: null, isActive: true },
        include: { rules: { orderBy: { hoursBeforeCheckIn: 'desc' } } },
        orderBy: { name: 'asc' }
    });

    res.json({
        data: policies
            .filter((policy) => policy.rules.every((rule) => ['PERCENT_OF_TOTAL', 'FIXED_AMOUNT'].includes(rule.chargeBasis)))
            .map(toCancellationPolicy)
    });
});

adminTourRoutes.get('/', validate({ query: tourQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const { tours, ...page } = await listTours(req.valid.query);

    res.json({ data: tours.map((tour) => toTourSummary(tour, locale, req.user)), ...page });
});

adminTourRoutes.post('/', validate({ body: createTourSchema }), async (req, res) => {
    const created = await createTour(req.valid.body, req.user, req);
    const tour = await findTourOr404(created.id);

    res.status(201).json(withChecklist(tour, req.user));
});

adminTourRoutes.get('/:tourId', validate({ params: tourParamSchema }), async (req, res) => {
    res.json(withChecklist(await reload(req), req.user));
});

adminTourRoutes.patch('/:tourId', validate({ params: tourParamSchema, body: updateTourSchema }), async (req, res) => {
    await updateTour(req.valid.params.tourId, req.valid.body, req.user, req);

    res.json(withChecklist(await reload(req), req.user));
});

adminTourRoutes.post('/:tourId/publish', validate({ params: tourParamSchema }), async (req, res) => {
    await publishTour(req.valid.params.tourId, req.user, req);

    res.json(withChecklist(await reload(req), req.user));
});

adminTourRoutes.post('/:tourId/unpublish', validate({ params: tourParamSchema }), async (req, res) => {
    await unpublishTour(req.valid.params.tourId, req.user, req);

    res.json(withChecklist(await reload(req), req.user));
});

adminTourRoutes.post(
    '/:tourId/archive',
    validate({ params: tourParamSchema, body: archiveTourSchema }),
    async (req, res) => {
        await archiveTour(req.valid.params.tourId, req.valid.body, req.user, req);

        res.json(withChecklist(await reload(req), req.user));
    }
);

adminTourRoutes.delete('/:tourId', validate({ params: tourParamSchema }), async (req, res) => {
    await deleteTour(req.valid.params.tourId, req.user, req);

    res.status(204).end();
});

/** What a kosher package needs to know about this tour. */
adminTourRoutes.put('/:tourId/kosher', validate({ params: tourParamSchema, body: tourKosherProfileSchema }), async (req, res) => {
    res.json(toTourKosherProfile(await upsertTourKosherProfile(req.valid.params.tourId, req.valid.body, req.user, req)));
});

adminTourRoutes.get('/:tourId/translations', validate({ params: tourParamSchema }), async (req, res) => {
    const translations = await listTourTranslations(req.valid.params.tourId);

    res.json({ data: translations.map(toTourTranslation) });
});

adminTourRoutes.put(
    '/:tourId/translations/:locale',
    validate({ params: tourLocaleParamSchema, body: tourTranslationSchema }),
    async (req, res) => {
        const { tourId, locale } = req.valid.params;
        const translation = await upsertTourTranslation(tourId, locale, req.valid.body, req.user, req);

        res.json(toTourTranslation(translation));
    }
);

// --- gallery -----------------------------------------------------------------

adminTourRoutes.post(
    '/:tourId/images',
    validate({ params: tourParamSchema, body: attachTourImageSchema }),
    async (req, res) => {
        const image = await tourGallery.attach(req.valid.params.tourId, req.valid.body, req.user, req);

        res.status(201).json(toTourImage(image));
    }
);

adminTourRoutes.put(
    '/:tourId/images/order',
    validate({ params: tourParamSchema, body: reorderTourImagesSchema }),
    async (req, res) => {
        await tourGallery.reorder(req.valid.params.tourId, req.valid.body.order, req.user, req);

        res.json(withChecklist(await reload(req), req.user));
    }
);

adminTourRoutes.patch(
    '/:tourId/images/:imageId',
    validate({ params: tourImageParamSchema, body: updateTourImageSchema }),
    async (req, res) => {
        const { tourId, imageId } = req.valid.params;
        const image = await tourGallery.update(tourId, imageId, req.valid.body, req.user, req);

        res.json(toTourImage(image));
    }
);

adminTourRoutes.delete('/:tourId/images/:imageId', validate({ params: tourImageParamSchema }), async (req, res) => {
    const { tourId, imageId } = req.valid.params;
    await tourGallery.detach(tourId, imageId, req.user, req);

    res.status(204).end();
});

// --- options -----------------------------------------------------------------

adminTourRoutes.get(
    '/:tourId/options',
    validate({ params: tourParamSchema, query: tourOptionQuerySchema }),
    async (req, res) => {
        const tour = await reload(req);
        const options = await listTourOptions(req.valid.params.tourId, {
            status: req.valid.query.status,
            includePartnerOnly: true
        });

        res.json({ data: options.map((option) => toTourOption(option, req.user, tour)) });
    }
);

adminTourRoutes.post(
    '/:tourId/options',
    validate({ params: tourParamSchema, body: createTourOptionSchema }),
    async (req, res) => {
        const tour = await reload(req);
        const option = await createTourOption(req.valid.params.tourId, req.valid.body, req.user, req);

        res.status(201).json(toTourOption(option, req.user, tour));
    }
);

adminTourRoutes.get('/:tourId/options/:optionId', validate({ params: tourOptionParamSchema }), async (req, res) => {
    const { tourId, optionId } = req.valid.params;
    const tour = await reload(req);
    const option = await findTourOptionOr404(tourId, optionId);

    res.json(toTourOption(option, req.user, tour));
});

adminTourRoutes.patch(
    '/:tourId/options/:optionId',
    validate({ params: tourOptionParamSchema, body: updateTourOptionSchema }),
    async (req, res) => {
        const { tourId, optionId } = req.valid.params;
        const tour = await reload(req);
        const option = await updateTourOption(tourId, optionId, req.valid.body, req.user, req);

        res.json(toTourOption(option, req.user, tour));
    }
);

adminTourRoutes.post(
    '/:tourId/options/:optionId/archive',
    validate({ params: tourOptionParamSchema }),
    async (req, res) => {
        const { tourId, optionId } = req.valid.params;
        const tour = await reload(req);
        const option = await archiveTourOption(tourId, optionId, req.user, req);

        res.json(toTourOption(option, req.user, tour));
    }
);

// --- price sheets ------------------------------------------------------------

adminTourRoutes.post(
    '/:tourId/options/:optionId/seasons',
    validate({ params: tourOptionParamSchema, body: tourSeasonSchema }),
    async (req, res) => {
        const { tourId, optionId } = req.valid.params;
        const tour = await reload(req);
        const season = await upsertTourSeason(tourId, optionId, null, req.valid.body, req.user, req);

        res.status(201).json(toTourSeason(season, req.user, tour));
    }
);

adminTourRoutes.put(
    '/:tourId/options/:optionId/seasons/:seasonId',
    validate({ params: tourSeasonParamSchema, body: tourSeasonSchema }),
    async (req, res) => {
        const { tourId, optionId, seasonId } = req.valid.params;
        const tour = await reload(req);
        const season = await upsertTourSeason(tourId, optionId, seasonId, req.valid.body, req.user, req);

        res.json(toTourSeason(season, req.user, tour));
    }
);

adminTourRoutes.delete(
    '/:tourId/options/:optionId/seasons/:seasonId',
    validate({ params: tourSeasonParamSchema }),
    async (req, res) => {
        const { tourId, optionId, seasonId } = req.valid.params;
        await deleteTourSeason(tourId, optionId, seasonId, req.user, req);

        res.status(204).end();
    }
);

// --- departures --------------------------------------------------------------

adminTourRoutes.get(
    '/:tourId/options/:optionId/inventory/calendar',
    validate({ params: tourOptionParamSchema, query: tourCalendarQuerySchema }),
    async (req, res) => {
        const { tourId, optionId } = req.valid.params;
        const calendar = await readTourCalendar(tourId, optionId, req.valid.query);

        res.json(toTourCalendar(calendar));
    }
);

adminTourRoutes.put(
    '/:tourId/options/:optionId/inventory',
    validate({ params: tourOptionParamSchema, body: tourInventoryRangeSchema }),
    async (req, res) => {
        const { tourId, optionId } = req.valid.params;
        const result = await setTourInventoryRange(tourId, optionId, req.valid.body, req.user, req);

        res.json(result);
    }
);
