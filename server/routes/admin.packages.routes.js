import { Router } from 'express';

import { authenticate, requireCapabilityByMethod } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { validate } from '../middleware/validate.js';
import {
    archivePackageSchema,
    attachPackageImageSchema,
    createPackageSchema,
    kosherOverrideSchema,
    kosherProfileSchema,
    packageImageParamSchema,
    packageLocaleParamSchema,
    packageParamSchema,
    packageQuerySchema,
    packageQuoteQuerySchema,
    packageTranslationSchema,
    reorderPackageImagesSchema,
    updatePackageImageSchema,
    updatePackageSchema
} from '../validation/package.js';
import {
    archivePackage,
    buildPackagePublishChecklist,
    createPackage,
    deletePackage,
    findPackageOr404,
    listPackageTranslations,
    listPackages,
    overrideKosher,
    packageGallery,
    publishPackage,
    removeKosherProfile,
    unpublishPackage,
    updatePackage,
    upsertKosherProfile,
    upsertPackageTranslation
} from '../services/package/package.service.js';
import { quotePackage } from '../services/package/quote.service.js';
import { validateKosherTemplate } from '../services/package/kosherEligibility.service.js';
import { todayInTimezone } from '../lib/time.js';
import { prisma } from '../db/index.js';
import {
    toKosherProfile,
    toPackageDetail,
    toPackageImage,
    toPackageQuote,
    toPackageSummary,
    toPackageTranslation
} from '../serializers/package.js';

/** The package builder. Admin only. */
export const adminPackageRoutes = Router();

adminPackageRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.CATALOGUE_READ], write: [CAPABILITIES.CATALOGUE_WRITE] }));

const reload = (req) => findPackageOr404(req.valid.params.packageId);

const withChecklist = async (pkg, viewer) => {
    const detail = toPackageDetail(pkg, 'en', viewer);
    const kosher = pkg.kosher
        ? await validateKosherTemplate(prisma, pkg, pkg.kosher, { today: todayInTimezone(pkg.timezone) })
        : null;

    return { ...detail, publishChecklist: buildPackagePublishChecklist(pkg), kosherEligibility: kosher };
};

adminPackageRoutes.get('/', validate({ query: packageQuerySchema }), async (req, res) => {
    const { packages, ...page } = await listPackages(req.valid.query);

    res.json({ data: packages.map((pkg) => toPackageSummary(pkg, req.valid.query.locale, req.user)), ...page });
});

adminPackageRoutes.post('/', validate({ body: createPackageSchema }), async (req, res) => {
    res.status(201).json(await withChecklist(await createPackage(req.valid.body, req.user, req), req.user));
});

adminPackageRoutes.get('/:packageId', validate({ params: packageParamSchema }), async (req, res) => {
    res.json(await withChecklist(await reload(req), req.user));
});

adminPackageRoutes.patch('/:packageId', validate({ params: packageParamSchema, body: updatePackageSchema }), async (req, res) => {
    res.json(await withChecklist(await updatePackage(req.valid.params.packageId, req.valid.body, req.user, req), req.user));
});

adminPackageRoutes.post('/:packageId/publish', validate({ params: packageParamSchema }), async (req, res) => {
    res.json(await withChecklist(await publishPackage(req.valid.params.packageId, req.user, req), req.user));
});

adminPackageRoutes.post('/:packageId/unpublish', validate({ params: packageParamSchema }), async (req, res) => {
    res.json(await withChecklist(await unpublishPackage(req.valid.params.packageId, req.user, req), req.user));
});

adminPackageRoutes.post(
    '/:packageId/archive',
    validate({ params: packageParamSchema, body: archivePackageSchema }),
    async (req, res) => {
        res.json(await withChecklist(await archivePackage(req.valid.params.packageId, req.user, req, req.valid.body), req.user));
    }
);

adminPackageRoutes.delete('/:packageId', validate({ params: packageParamSchema }), async (req, res) => {
    await deletePackage(req.valid.params.packageId, req.user, req);

    res.status(204).end();
});

/**
 * What a partner would see: the real quote engine, run as staff, so an admin
 * building a template sees every slot resolve (or fail) with the net beside
 * the sell. Works on a DRAFT.
 */
adminPackageRoutes.get(
    '/:packageId/preview-quote',
    validate({ params: packageParamSchema, query: packageQuoteQuerySchema }),
    async (req, res) => {
        const { startDate, adults, childAges = [], rooms, choices, exclude = [], locale } = req.valid.query;
        const quote = await quotePackage(
            { slugOrId: req.valid.params.packageId, startDate, adults, childAges, rooms, choices, excluded: exclude, locale },
            req.user,
            { anyStatus: true, mode: 'availability' }
        );

        res.json(toPackageQuote(quote, locale, req.user));
    }
);

// --- kosher ------------------------------------------------------------------

adminPackageRoutes.put('/:packageId/kosher', validate({ params: packageParamSchema, body: kosherProfileSchema }), async (req, res) => {
    const { profile, warnings } = await upsertKosherProfile(req.valid.params.packageId, req.valid.body, req.user, req);

    res.json({ ...toKosherProfile(profile), warnings });
});

adminPackageRoutes.delete('/:packageId/kosher', validate({ params: packageParamSchema }), async (req, res) => {
    await removeKosherProfile(req.valid.params.packageId, req.user, req);

    res.status(204).end();
});

adminPackageRoutes.put(
    '/:packageId/kosher/override',
    validate({ params: packageParamSchema, body: kosherOverrideSchema }),
    async (req, res) => {
        res.json(await withChecklist(await overrideKosher(req.valid.params.packageId, req.valid.body, req.user, req), req.user));
    }
);

// --- translations and gallery ------------------------------------------------

adminPackageRoutes.get('/:packageId/translations', validate({ params: packageParamSchema }), async (req, res) => {
    res.json({ data: (await listPackageTranslations(req.valid.params.packageId)).map(toPackageTranslation) });
});

adminPackageRoutes.put(
    '/:packageId/translations/:locale',
    validate({ params: packageLocaleParamSchema, body: packageTranslationSchema }),
    async (req, res) => {
        const { packageId, locale } = req.valid.params;

        res.json(toPackageTranslation(await upsertPackageTranslation(packageId, locale, req.valid.body, req.user, req)));
    }
);

adminPackageRoutes.post('/:packageId/images', validate({ params: packageParamSchema, body: attachPackageImageSchema }), async (req, res) => {
    res.status(201).json(toPackageImage(await packageGallery.attach(req.valid.params.packageId, req.valid.body, req.user, req)));
});

adminPackageRoutes.put('/:packageId/images/order', validate({ params: packageParamSchema, body: reorderPackageImagesSchema }), async (req, res) => {
    await packageGallery.reorder(req.valid.params.packageId, req.valid.body.order, req.user, req);

    res.json(await withChecklist(await reload(req), req.user));
});

adminPackageRoutes.patch('/:packageId/images/:imageId', validate({ params: packageImageParamSchema, body: updatePackageImageSchema }), async (req, res) => {
    const { packageId, imageId } = req.valid.params;

    res.json(toPackageImage(await packageGallery.update(packageId, imageId, req.valid.body, req.user, req)));
});

adminPackageRoutes.delete('/:packageId/images/:imageId', validate({ params: packageImageParamSchema }), async (req, res) => {
    const { packageId, imageId } = req.valid.params;
    await packageGallery.detach(packageId, imageId, req.user, req);

    res.status(204).end();
});
