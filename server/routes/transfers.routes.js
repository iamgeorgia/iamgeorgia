import { Router } from 'express';

import { optionalAuthenticate } from '../middleware/auth.js';
import { actAsPartner } from '../lib/booking/onBehalf.js';
import { validate } from '../middleware/validate.js';
import {
    localeQuerySchema,
    pointQuerySchema,
    quoteQuerySchema,
    quoteTokenSchema,
    routeQuerySchema,
    slugParamSchema,
    vehicleQuerySchema
} from '../validation/transfer.js';
import { listPoints } from '../services/transfer/point.service.js';
import { findRouteOr404, listRoutes } from '../services/transfer/route.service.js';
import { findVehicleOr404, listVehicles } from '../services/transfer/vehicle.service.js';
import { quotesForJourney, revalidateQuote } from '../services/transfer/quote.service.js';
import { listExtras } from '../services/transfer/extra.service.js';
import { toExtra, toOffer, toPoint, toQuoteResult, toRoute, toVehicle } from '../serializers/transfer.js';
import { submitGuestRating } from '../services/transfer/rating.service.js';
import { guestRatingSchema } from '../validation/rating.js';
import { toRatingPublic } from '../serializers/rating.js';

/**
 * The public transfer catalogue and its quote engine.
 *
 * `optionalAuthenticate` throughout, for the same reason the hotel routes use
 * it: the same endpoints serve a traveller on the website and a partner booking
 * through the API. What differs is which vehicle classes are visible, what
 * markup is applied and how much of each figure comes back — and all three are
 * decided by the session rather than by anything in the request.
 */
export const transferRoutes = Router();

transferRoutes.use(optionalAuthenticate, actAsPartner);

/** The location picker. Searches base names and every translation of them. */
transferRoutes.get('/points', validate({ query: pointQuerySchema }), async (req, res) => {
    const points = await listPoints(req.valid.query);

    res.json({ data: points.map(toPoint) });
});

transferRoutes.get('/routes', validate({ query: routeQuerySchema }), async (req, res) => {
    const { routes, ...page } = await listRoutes(req.valid.query);

    res.json({ data: routes.map((route) => toRoute(route, req.user)), ...page });
});

transferRoutes.get(
    '/routes/:slug',
    validate({ params: slugParamSchema, query: localeQuerySchema }),
    async (req, res) => {
        const route = await findRouteOr404(req.valid.params.slug, { locale: req.valid.query.locale });

        res.json(toRoute(route, req.user));
    }
);

transferRoutes.get('/vehicles', validate({ query: vehicleQuerySchema }), async (req, res) => {
    const vehicles = await listVehicles({ ...req.valid.query, viewer: req.user });

    res.json({ data: vehicles.map((vehicle) => toVehicle(vehicle, req.user)) });
});

transferRoutes.get(
    '/vehicles/:slug',
    validate({ params: slugParamSchema, query: localeQuerySchema }),
    async (req, res) => {
        const vehicle = await findVehicleOr404(req.valid.params.slug, {
            locale: req.valid.query.locale,
            viewer: req.user
        });

        res.json(toVehicle(vehicle, req.user));
    }
);

transferRoutes.get('/extras', async (_req, res) => {
    const extras = await listExtras();

    res.json({ data: extras.map(toExtra) });
});

/**
 * The search itself: every vehicle that can carry the party, priced for the
 * journey, each with its own signed token.
 */
transferRoutes.get('/quotes', validate({ query: quoteQuerySchema }), async (req, res) => {
    const result = await quotesForJourney(req.valid.query, req.user);

    res.json(toQuoteResult(result, req.user));
});

/**
 * Re-prices a token.
 *
 * Not strict: this is the preview call a results page makes when a token has
 * been sitting in a tab, and it should show the new number rather than refuse.
 * Booking calls the same function with `strict` and gets a 409 instead.
 */
transferRoutes.post('/quotes/revalidate', validate({ body: quoteTokenSchema }), async (req, res) => {
    const offer = await revalidateQuote(req.valid.body.token, req.user, { strict: false });

    res.json(toOffer(offer, req.user));
});

export default transferRoutes;

/**
 * A passenger rates their driver, from the link emailed after the transfer.
 * The token names the leg and the address it was sent to; one rating per
 * leg, first submission wins.
 */
transferRoutes.post('/ratings', validate({ body: guestRatingSchema }), async (req, res) => {
    const { token, ...body } = req.valid.body;
    const rating = await submitGuestRating(token, body, req);

    res.status(201).json(toRatingPublic(rating));
});
