import { Router } from 'express';

import { optionalAuthenticate } from '../middleware/auth.js';
import { actAsPartner } from '../lib/booking/onBehalf.js';
import { searchLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { availabilityQuerySchema, offerQuoteSchema, searchQuerySchema } from '../validation/search.js';
import { slugParamSchema } from '../validation/hotel.js';
import { hotelAvailability, revalidateOffer, searchHotels } from '../services/hotel/search.service.js';
import { readOfferToken } from '../lib/hotel/offerToken.js';
import { toOffer, toRoomAvailability, toSearchResult } from '../serializers/search.js';

/**
 * Dated search.
 *
 * Distinct from `/api/hotels`, which browses the catalogue. This answers "what
 * can I actually book, on these dates, for these people" and every result is a
 * real offer with a real total. Conflating the two is how a site advertises
 * rooms it cannot sell.
 *
 * `optionalAuthenticate` because a signed-in partner sees partner-only rates
 * and their own commission, while an anonymous visitor sees public rates at the
 * platform markup — the same endpoint, two answers, decided by the session
 * rather than by anything in the request.
 */
export const hotelSearchRoutes = Router();

hotelSearchRoutes.use(optionalAuthenticate, actAsPartner);

hotelSearchRoutes.get('/', searchLimiter, validate({ query: searchQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const { hotels, ...page } = await searchHotels(req.valid.query, req.user);

    res.json({
        data: hotels.map((result) => toSearchResult(result, locale, req.user)),
        ...page
    });
});

hotelSearchRoutes.get(
    '/hotels/:slug',
    searchLimiter,
    validate({ params: slugParamSchema, query: availabilityQuerySchema }),
    async (req, res) => {
        const { locale } = req.valid.query;
        const availability = await hotelAvailability(req.valid.params.slug, req.valid.query, req.user);

        res.json({
            hotelId: availability.hotelId,
            nights: availability.nights,
            roomTypes: availability.roomTypes.map((entry) => toRoomAvailability(entry, locale, req.user))
        });
    }
);

/**
 * Re-quote an offer before checkout.
 *
 * The client sends the token it was given; the server prices it again from live
 * data. A price that has moved comes back as 409 carrying both figures, so the
 * interface can say "this went from X to Y" rather than failing blankly.
 */
hotelSearchRoutes.post('/offers/quote', searchLimiter, validate({ body: offerQuoteSchema }), async (req, res) => {
    const offer = readOfferToken(req.valid.body.token);
    const priced = await revalidateOffer(offer, req.user);

    res.json(toOffer(priced, req.user));
});
