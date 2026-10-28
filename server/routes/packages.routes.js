import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { isTrade, optionalAuthenticate } from '../middleware/auth.js';
import { actAsPartner } from '../lib/booking/onBehalf.js';
import { accessWhere } from '../services/partner/access.service.js';
import {
    packageOfferTokenSchema,
    packageQuoteQuerySchema,
    packageSlugParamSchema,
    publicPackageQuerySchema
} from '../validation/package.js';
import { findPackageOr404, listPackages } from '../services/package/package.service.js';
import { quotePackage, revalidatePackageOffer } from '../services/package/quote.service.js';
import { toPackageDetail, toPackageQuote, toPackageSummary } from '../serializers/package.js';

/**
 * The public package catalogue and its quotes.
 *
 * Browsing is undated; a quote is for one start date and one party and is
 * the only thing that carries a price anyone could be charged. Anonymous
 * callers see B2C packages only, exactly as for every other product.
 */
export const packageRoutes = Router();

packageRoutes.use(optionalAuthenticate, actAsPartner);
const PUBLIC_STATUSES = ['ACTIVE'];

packageRoutes.get('/', validate({ query: publicPackageQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const { packages, ...page } = await listPackages({
        ...req.valid.query,
        status: PUBLIC_STATUSES,
        b2cOnly: !isTrade(req.user),
        access: accessWhere(req.user, 'PACKAGE')
    });

    res.json({ data: packages.map((pkg) => toPackageSummary(pkg, locale)), ...page });
});

/** Re-prices a package offer. A moved price answers 200 with `priceChanged`. */
packageRoutes.post('/quotes/revalidate', validate({ body: packageOfferTokenSchema }), async (req, res) => {
    const quote = await revalidatePackageOffer(req.valid.body.token, req.user, { strict: false });

    res.json(toPackageQuote(quote, 'en', req.user));
});

packageRoutes.get('/:slug', validate({ params: packageSlugParamSchema, query: publicPackageQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const pkg = await findPackageOr404(req.valid.params.slug, {
        locale,
        statuses: PUBLIC_STATUSES,
        b2cOnly: !isTrade(req.user),
        access: accessWhere(req.user, 'PACKAGE')
    });

    res.json(toPackageDetail(pkg, locale, null));
});

packageRoutes.get('/:slug/quote', validate({ params: packageSlugParamSchema, query: packageQuoteQuerySchema }), async (req, res) => {
    const { startDate, adults, childAges = [], rooms, choices, exclude = [], locale } = req.valid.query;
    const quote = await quotePackage(
        { slugOrId: req.valid.params.slug, startDate, adults, childAges, rooms, choices, excluded: exclude, locale },
        req.user
    );

    res.json(toPackageQuote(quote, locale, req.user));
});
