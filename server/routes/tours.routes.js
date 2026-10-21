import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { isTrade, optionalAuthenticate } from '../middleware/auth.js';
import { actAsPartner } from '../lib/booking/onBehalf.js';
import { accessWhere } from '../services/partner/access.service.js';
import {
    publicTourQuerySchema,
    tourAvailabilityQuerySchema,
    tourOfferQuoteSchema,
    tourSearchQuerySchema,
    tourSlugParamSchema
} from '../validation/tour.js';
import { findTourOr404, listTours } from '../services/tour/tour.service.js';
import { revalidateTourOffer, searchTours, tourAvailability } from '../services/tour/search.service.js';
import { readTourOfferToken } from '../lib/tour/offerToken.js';
import {
    toTourAvailability,
    toTourDetail,
    toTourOffer,
    toTourSearchResult,
    toTourSummary
} from '../serializers/tour.js';

/**
 * The public tour catalogue.
 *
 * Browsing, not searching: this answers "what tours run in Kakheti" from
 * catalogue content alone and never checks a departure. The dated search
 * router below is what quotes something bookable.
 *
 * Everything is B2B by default; an anonymous visitor sees only tours switched
 * on for B2C, and only PUBLIC options. A signed-in partner or member of staff
 * sees the whole ACTIVE catalogue.
 */
const PUBLIC_STATUSES = ['ACTIVE'];

export const tourRoutes = Router();

tourRoutes.use(optionalAuthenticate, actAsPartner);

tourRoutes.get('/', validate({ query: publicTourQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const { tours, ...page } = await listTours({
        ...req.valid.query,
        status: PUBLIC_STATUSES,
        b2cOnly: !isTrade(req.user),
        access: accessWhere(req.user, 'TOUR')
    });

    // No viewer: a catalogue card must not carry status or the operator even
    // for a partner. Those belong to the back office.
    res.json({ data: tours.map((tour) => toTourSummary(tour, locale)), ...page });
});

tourRoutes.get('/:slug', validate({ params: tourSlugParamSchema, query: publicTourQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const tour = await findTourOr404(req.valid.params.slug, {
        locale,
        statuses: PUBLIC_STATUSES,
        b2cOnly: !isTrade(req.user),
        includePartnerOnly: isTrade(req.user),
        access: accessWhere(req.user, 'TOUR')
    });

    res.json(toTourDetail(tour, locale));
});

/**
 * Dated search: departures that can actually be booked.
 *
 * `GET /` answers "which tours run on this date for this party", `GET /:slug`
 * answers "which departures of this tour, over this window", and the quote
 * endpoint re-prices a token so a checkout page can show a fresh figure.
 */
export const tourSearchRoutes = Router();

tourSearchRoutes.use(optionalAuthenticate, actAsPartner);

tourSearchRoutes.get('/', validate({ query: tourSearchQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const { results, ...page } = await searchTours(req.valid.query, req.user);

    res.json({ data: results.map((result) => toTourSearchResult(result, locale, req.user)), ...page });
});

tourSearchRoutes.get(
    '/:slug',
    validate({ params: tourSlugParamSchema, query: tourAvailabilityQuerySchema }),
    async (req, res) => {
        const { locale } = req.valid.query;
        const availability = await tourAvailability(req.valid.params.slug, req.valid.query, req.user);

        res.json(toTourAvailability(availability, locale, req.user));
    }
);

/** Re-prices an offer without booking it; a moved price is reported, not refused. */
tourSearchRoutes.post('/offers/quote', validate({ body: tourOfferQuoteSchema }), async (req, res) => {
    const offer = readTourOfferToken(req.valid.body.token);
    const priced = await revalidateTourOffer(offer, req.user, { strict: false });

    res.json(toTourOffer({ available: true, ...priced, token: req.valid.body.token }, req.user));
});
