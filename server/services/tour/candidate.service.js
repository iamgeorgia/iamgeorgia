import { prisma } from '../../db/index.js';
import { dateOnlyToUtc, weekdayOf } from '../../lib/time.js';

/**
 * Candidate departures: every option that can actually be sold on a date.
 *
 * The same two-stage split as hotel search, and for the same reason. Dated
 * search used to hydrate the whole catalogue — five hundred tours with their
 * galleries and translations, every option with every season and every tier —
 * price all of it, and then show twenty-four cards. This query does the
 * choosing instead: it touches only the tables that decide whether something
 * is sellable, returns ids and a total, and lets the caller hydrate the page
 * and nothing else.
 *
 * It replaced a `pageSize: 500` read that also silently truncated the
 * catalogue: an eight-hundredth tour could not be found by a dated search at
 * all, whatever its price.
 *
 * Everything here mirrors a rule that `pricing.service.js` states in
 * JavaScript, because both have to agree on which departures exist and what
 * they cost:
 *
 *   * the party is categorised against *this tour's* own age bands, so the
 *     same child is a child on one tour and an adult on another;
 *   * the season is the highest-priority active sheet covering the date whose
 *     weekday mask matches, most recent first among equals — `resolveSeason`;
 *   * the tier is the highest `min_pax` the party still reaches — `resolveTier`;
 *   * the total is the sell price, rounded per line then multiplied, so it is
 *     the same integer `quoteTour` arrives at rather than an approximation the
 *     page order would have to be forgiven for.
 *
 * What it deliberately does *not* decide is notice, horizon and past-date —
 * those depend on the current instant rather than on stored data, and the
 * caller applies them to these rows before paginating. They are cheap on ids.
 */

const listOf = (value) => (value === undefined || value === null ? null : Array.isArray(value) ? value : [value]);

export const findTourCandidates = async ({
    date,
    adults,
    childAges = [],
    markupBps = 0,
    search = null,
    destinationId = null,
    destinationSlug = null,
    destinationPath = null,
    category = null,
    difficulty = null,
    minDays = null,
    maxDays = null,
    featured = null,
    b2cOnly = false,
    includePartnerOnly = false,
    // A partner's allow list (null: any) and deny list (null: none).
    tourIds = null,
    excludeTourIds = null
}) => {
    const departureDate = dateOnlyToUtc(date);
    const weekday = weekdayOf(date);
    const categories = listOf(category);
    const difficulties = listOf(difficulty);

    return prisma.$queryRaw`
        WITH ages(age) AS (SELECT unnest(${childAges}::int[]))
        SELECT t.id                       AS "tourId",
               o.id                       AS "tourOptionId",
               total.sell_cents::int      AS "sellTotalCents",
               -- Only what the caller reads: the price it ranks on, the order
               -- it breaks ties with, and the four scalars dateRefusal needs.
               -- Availability and the pax limits are settled below and never
               -- looked at again, so they do not travel.
               t.featured                 AS "featured",
               t.title                    AS "title",
               o.notice_hours             AS "noticeHours",
               o.horizon_days             AS "horizonDays",
               o.start_time               AS "startTime",
               inv.departure_time         AS "departureTime",
               t.timezone                 AS "timezone"
          FROM tours t
          JOIN destinations d  ON d.id = t.destination_id
          JOIN tour_options o  ON o.tour_id = t.id AND o.status = 'ACTIVE'
          -- The party as this tour counts it. An age band is a property of the
          -- tour, so the same child can be a child here and an adult next door.
          CROSS JOIN LATERAL (
              SELECT ${adults}::int
                         + (SELECT count(*) FROM ages WHERE ages.age > t.child_max_age)::int AS adults,
                     (SELECT count(*) FROM ages
                       WHERE ages.age > t.infant_max_age AND ages.age <= t.child_max_age)::int AS children,
                     (SELECT count(*) FROM ages WHERE ages.age <= t.infant_max_age)::int AS infants
          ) p
          CROSS JOIN LATERAL (SELECT p.adults + p.children AS pax) px
          -- A departure that exists and is not blacked out. Availability is
          -- derived, never stored, exactly as the editor writes it.
          JOIN tour_inventory inv
               ON inv.tour_option_id = o.id
              AND inv.date = ${departureDate}::date
              AND inv.stop_sell = false
          -- An infant is carried: a group takes one unit, a seat takes one per
          -- paying traveller.
          CROSS JOIN LATERAL (
              SELECT CASE WHEN o.unit_kind = 'GROUP' THEN 1 ELSE px.pax END AS units
          ) u
          -- resolveSeason, in SQL. No sheet covering the date means the date is
          -- not for sale, so this is an inner join rather than a filter.
          JOIN LATERAL (
              SELECT s.id
                FROM tour_seasons s
               WHERE s.tour_option_id = o.id
                 AND s.is_active
                 AND s.valid_from  <= ${departureDate}::date
                 AND s.valid_until >= ${departureDate}::date
                 AND (s.weekdays IS NULL
                      OR cardinality(s.weekdays) = 0
                      OR ${weekday}::int = ANY(s.weekdays))
               ORDER BY s.priority DESC, s.created_at DESC
               LIMIT 1
          ) season ON true
          -- resolveTier: "from N travellers", so a sheet of {1, 3, 6} prices a
          -- party of four on the 3-tier.
          JOIN LATERAL (
              SELECT tr.adult_net_cents, tr.child_net_cents, tr.infant_net_cents, tr.group_net_cents,
                     tr.adult_sell_cents, tr.child_sell_cents, tr.group_sell_cents
                FROM tour_season_tiers tr
               WHERE tr.season_id = season.id
                 AND tr.min_pax <= px.pax
                 AND (tr.max_pax IS NULL OR px.pax <= tr.max_pax)
               ORDER BY tr.min_pax DESC
               LIMIT 1
          ) tier ON true
          -- quoteTour's arithmetic: a fixed sell price on a tier overrides the
          -- markup, an unpriced child pays the adult rate, and each unit price
          -- is rounded before it is multiplied so the lines sum to the total.
          CROSS JOIN LATERAL (
              SELECT CASE
                       WHEN o.pricing_basis = 'PER_GROUP' THEN
                           COALESCE(tier.group_sell_cents,
                                    round(tier.group_net_cents::bigint * (10000 + ${markupBps}::int) / 10000.0))
                       ELSE
                           COALESCE(tier.adult_sell_cents,
                                    round(tier.adult_net_cents::bigint * (10000 + ${markupBps}::int) / 10000.0)) * p.adults
                         + CASE
                               WHEN tier.child_net_cents IS NOT NULL THEN
                                   COALESCE(tier.child_sell_cents,
                                            round(tier.child_net_cents::bigint * (10000 + ${markupBps}::int) / 10000.0))
                               ELSE
                                   COALESCE(tier.adult_sell_cents,
                                            round(tier.adult_net_cents::bigint * (10000 + ${markupBps}::int) / 10000.0))
                           END * p.children
                         + CASE
                               WHEN tier.infant_net_cents = 0 THEN 0
                               ELSE round(tier.infant_net_cents::bigint * (10000 + ${markupBps}::int) / 10000.0)
                           END * p.infants
                     END AS sell_cents
          ) total
         WHERE t.status = 'ACTIVE'
           -- The sales channel, as everywhere else: an anonymous buyer sees
           -- only what is switched on for B2C, and only PUBLIC options.
           AND (${!b2cOnly}::boolean OR t.b2c_enabled)
           AND (${includePartnerOnly}::boolean OR o.visibility = 'PUBLIC')
           AND (${tourIds}::text[] IS NULL OR t.id = ANY(${tourIds}::text[]))
           AND (${excludeTourIds}::text[] IS NULL OR NOT (t.id = ANY(${excludeTourIds}::text[])))
           AND px.pax BETWEEN o.min_pax AND o.max_pax
           AND inv.total_units - inv.blocked_units - inv.booked_units - inv.held_units >= u.units
           -- An option with no net price on its tier is not for sale, and a
           -- fixed sell price alone does not make it so — the same refusal
           -- quoteTour makes by returning null.
           AND (CASE WHEN o.pricing_basis = 'PER_GROUP' THEN tier.group_net_cents ELSE tier.adult_net_cents END)
                IS NOT NULL
           AND (${search}::text IS NULL
                OR t.title    ILIKE '%' || ${search}::text || '%'
                OR t.location ILIKE '%' || ${search}::text || '%'
                OR t.slug     ILIKE '%' || ${search}::text || '%')
           AND (${destinationId}::text IS NULL OR t.destination_id = ${destinationId}::text)
           AND (${destinationSlug}::text IS NULL OR d.slug = ${destinationSlug}::text)
           AND (${destinationPath}::text IS NULL OR d.path LIKE ${destinationPath}::text || '%')
           AND (${categories}::text[] IS NULL OR t.category::text = ANY(${categories}::text[]))
           AND (${difficulties}::text[] IS NULL OR t.difficulty::text = ANY(${difficulties}::text[]))
           AND (${minDays}::int IS NULL OR t.duration_days >= ${minDays}::int)
           AND (${maxDays}::int IS NULL OR t.duration_days <= ${maxDays}::int)
           AND (${featured}::boolean IS NULL OR t.featured = ${featured}::boolean)
    `;
};
