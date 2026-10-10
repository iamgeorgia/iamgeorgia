import { Router } from 'express';

import { prisma } from '../db/index.js';
import { validate } from '../middleware/validate.js';
import { isTrade, optionalAuthenticate } from '../middleware/auth.js';
import { accessWhere } from '../services/partner/access.service.js';
import { publicHotelQuerySchema, slugParamSchema } from '../validation/hotel.js';
import { findHotelOr404, listHotels } from '../services/hotel/hotel.service.js';
import { resolveMarkup } from '../services/hotel/pricingRule.service.js';
import { toHotelDetail, toHotelSummary } from '../serializers/hotel.js';

/**
 * The public hotel catalogue.
 *
 * Browsing, not searching: this answers "what properties are there in
 * Bakuriani" from catalogue content alone. It deliberately does not check
 * availability — that is the dated search endpoint, and conflating the two is
 * how a site ends up advertising rooms it cannot sell.
 *
 * `PUBLIC_STATUSES` is passed to the service rather than being expressible in
 * the query, so there is no combination of parameters that reaches a DRAFT.
 *
 * `optionalAuthenticate`, because "from" prices are viewer-relative: the
 * cached figure is a **net** rate and never leaves the building raw — it is
 * marked up here for whoever is asking, a partner at their commission and an
 * anonymous visitor at the platform default. Indicative either way; only the
 * dated search quotes something bookable.
 */
const PUBLIC_STATUSES = ['ACTIVE'];

const applyBps = (amountCents, bps) => Math.round((amountCents * (10_000 + bps)) / 10_000);

/** Rounds a marked-up indicative price to whole currency units. */
const indicative = (netCents, bps) => Math.round(applyBps(netCents, bps) / 100) * 100;

export const hotelRoutes = Router();

hotelRoutes.use(optionalAuthenticate);

hotelRoutes.get('/', validate({ query: publicHotelQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const { hotels, ...page } = await listHotels({
        ...req.valid.query,
        status: PUBLIC_STATUSES,
        b2cOnly: !isTrade(req.user),
        access: accessWhere(req.user, 'HOTEL')
    });

    // One resolution for the page: the buyer is the same on every row.
    const { markupBps } = await resolveMarkup({ partner: req.user?.partner });

    res.json({
        // No viewer is passed to the serializer: a catalogue card must not
        // carry status, supplier or the inventory source even for a partner —
        // those belong to the extranet, not the shop window.
        data: hotels.map((hotel) => {
            const summary = toHotelSummary(hotel, locale);

            if (summary.priceFrom) {
                summary.priceFrom = {
                    ...summary.priceFrom,
                    amountCents: indicative(summary.priceFrom.amountCents, markupBps)
                };
            }

            return summary;
        }),
        ...page
    });
});

hotelRoutes.get(
    '/:slug',
    validate({ params: slugParamSchema, query: publicHotelQuerySchema }),
    async (req, res) => {
        const { locale } = req.valid.query;
        const hotel = await findHotelOr404(req.valid.params.slug, {
            locale,
            statuses: PUBLIC_STATUSES,
            b2cOnly: !isTrade(req.user),
            access: accessWhere(req.user, 'HOTEL')
        });
        const { markupBps } = await resolveMarkup({ partner: req.user?.partner, hotel });

        /*
         * An indicative nightly "from" per room: the cheapest net rate over the
         * next 120 days, marked up for this viewer. One grouped query for the
         * whole property, not one per room — and clearly labelled indicative,
         * because a price without dates is not an offer.
         */
        //
        // Only rates this viewer could actually buy: a public visitor must not
        // see a "from" built on a trade rate they cannot reach, and nobody
        // should see one built on a night with no room left to sell. The
        // channel and inventory predicates are the same ones dated search
        // applies in `providers/manual.js`.
        const trade = isTrade(req.user);
        const cheapest = await prisma.$queryRaw`
            SELECT rt.id AS "roomTypeId", min(r.net_cents)::int AS "netCents"
              FROM room_types rt
              JOIN rate_plans rp ON rp.room_type_id = rt.id AND rp.status = 'ACTIVE'
              JOIN rates r ON r.rate_plan_id = rp.id AND r.closed = false
              JOIN room_inventory inv
                   ON inv.room_type_id = rt.id
                  AND inv.date = r.date
                  AND inv.stop_sell = false
                  AND inv.total_units - inv.blocked_units - inv.booked_units - inv.held_units > 0
             WHERE rt.hotel_id = ${hotel.id}
               AND rt.status = 'ACTIVE'
               AND (${trade}::boolean OR rp.visibility = 'PUBLIC')
               AND r.date BETWEEN CURRENT_DATE AND CURRENT_DATE + 120
             GROUP BY rt.id
        `;
        const fromByRoom = new Map(cheapest.map((row) => [row.roomTypeId, row.netCents]));

        const detail = toHotelDetail(hotel, locale);

        detail.roomTypes = detail.roomTypes.map((roomType) => ({
            ...roomType,
            priceFrom: fromByRoom.has(roomType.id)
                ? {
                      amountCents: indicative(fromByRoom.get(roomType.id), markupBps),
                      currency: detail.currency
                  }
                : null
        }));

        // The hotel-level figure follows the cheapest room, so the header and
        // the room list can never disagree about "from".
        const nightly = [...fromByRoom.values()];
        detail.priceFrom =
            nightly.length > 0
                ? { amountCents: indicative(Math.min(...nightly), markupBps), currency: detail.currency }
                : detail.priceFrom;

        res.json(detail);
    }
);
