import { prisma } from '../../../db/index.js';
import { dateOnlyToUtc, eachNight, nightsBetween, toDateOnly, todayInTimezone } from '../../../lib/time.js';

/**
 * Availability from our own tables.
 *
 * The one provider that exists today. Everything below is deliberately behind
 * the same interface an external channel manager will implement, so adding one
 * later is a new file rather than a change to search or booking.
 *
 * The search query is raw SQL, not Prisma. It is a windowed aggregate over a
 * date range with a HAVING clause, and expressing it through the fluent API
 * would mean several round trips and a lot of work in JavaScript that Postgres
 * does better.
 */

/**
 * Candidate offers: every rate plan that can actually be sold for these dates.
 *
 * The load-bearing clause is `HAVING count(*) = nights`. A rate plan only
 * survives if **every** night has both a price and stock — so a stay from the
 * 20th to the 23rd where the 22nd is sold out returns nothing at all, rather
 * than an offer that fails at checkout.
 *
 * Restrictions that close a single night are enforced by the joins rather than
 * by a filter: excluding the row drops the count below `nights` and the whole
 * offer falls out. Restrictions about the stay as a whole — minimum stay,
 * advance booking, closed to arrival or departure — are NOT EXISTS clauses,
 * because they are properties of the booking rather than of a night.
 *
 * The kosher filters are two clauses and one LEFT JOIN, and that is all they
 * needed to be: every *facility* an observant traveller searches for — a kosher
 * restaurant, a Shabbat elevator, a synagogue, a mikveh — is an amenity, so it
 * goes through the amenity block below and adds nothing here.
 */
export const searchCandidates = async ({
    checkIn,
    checkOut,
    rooms = 1,
    adults,
    children = 0,
    guests,
    destinationPath = null,
    destinationSlug = null,
    hotelIds = null,
    // Properties this buyer may not see at all (a partner's deny list).
    excludeHotelIds = null,
    countryCode = null,
    propertyTypes = null,
    minStars = null,
    amenityCodes = null,
    mealPlanCodes = null,
    refundableOnly = false,
    kosherMinLevel = null,
    kosherCertified = false,
    includePartnerOnly = false,
    b2cOnly = false,
    today
}) => {
    const nightList = eachNight(checkIn, checkOut);
    const nights = nightList.length;
    const lastNight = nightList.at(-1);
    const advanceDays = nightsBetween(today, checkIn);

    /*
     * The nights, as an array rather than a generate_series.
     *
     * This one change is worth more than every index on these tables. With
     * generate_series the planner has no row estimate for the night list, so it
     * assumes a thousand and picks hash joins that read every rate row and
     * sequentially scan all of room_inventory. Given an array it knows there
     * are three, and does three index lookups per rate plan instead.
     *
     * Measured on 200 hotels, 320,000 rate rows and 160,000 inventory rows:
     * 262 ms with generate_series, 17 ms with this. Adding explicit BETWEEN
     * bounds to help the planner along made it worse again (698 ms), which is
     * why they are not here.
     */
    const nightDates = nightList.map(dateOnlyToUtc);
    // Approximate, and deliberately so: it only decides whether a free window
    // is still open, and the exact hour of check-in cannot shift that answer
    // except within a few hours of a deadline.
    const hoursUntilCheckIn = advanceDays * 24;

    return prisma.$queryRaw`
        WITH nights(night) AS (
            SELECT unnest(${nightDates}::date[])
        )
        SELECT rt.hotel_id                     AS "hotelId",
               rt.id                           AS "roomTypeId",
               rp.id                           AS "ratePlanId",
               sum(r.net_cents)::int           AS "netTotalCents",
               min(inv.total_units - inv.blocked_units - inv.booked_units - inv.held_units)::int
                                               AS "availableUnits"
          FROM rate_plans rp
          JOIN room_types rt ON rt.id = rp.room_type_id AND rt.status = 'ACTIVE'
          JOIN hotels     h  ON h.id = rt.hotel_id AND h.status = 'ACTIVE'
          JOIN destinations d ON d.id = h.destination_id
          -- Optional by construction: almost no property has a kosher profile,
          -- and a LEFT JOIN onto a unique foreign key is one index probe per
          -- hotel that survived destination, stars, dates and availability. The
          -- join is unconditional and the predicates below are not, which is
          -- the same shape every other filter in this query already has.
          LEFT JOIN hotel_kosher_profiles kp ON kp.hotel_id = h.id
          CROSS JOIN nights n
          -- A night with no rate, or a closed one, simply does not join, and
          -- the HAVING below turns that into "this offer is unavailable".
          JOIN rates r ON r.rate_plan_id = rp.id AND r.date = n.night AND r.closed = false
          JOIN room_inventory inv
               ON inv.room_type_id = rt.id
              AND inv.date = n.night
              AND inv.stop_sell = false
              -- Closed to arrival applies only to the first night.
              AND NOT (inv.closed_to_arrival AND n.night = ${dateOnlyToUtc(checkIn)}::date)
         WHERE rp.status = 'ACTIVE'
           -- The sales channel: an anonymous buyer only ever sees hotels that
           -- have been switched on for B2C. Trade buyers see everything.
           AND (${!b2cOnly}::boolean OR h.b2c_enabled)
           AND (${includePartnerOnly}::boolean OR rp.visibility = 'PUBLIC')
           AND rt.max_occupancy >= ${guests}
           AND rt.max_adults    >= ${adults}
           AND rt.max_children  >= ${children}
           AND rt.min_adults    <= ${adults}
           AND (rp.max_adults   IS NULL OR rp.max_adults >= ${adults})
           AND (rp.min_adults   IS NULL OR rp.min_adults <= ${adults})
           AND (rp.max_children IS NULL OR rp.max_children >= ${children})
           AND (rp.sellable_from  IS NULL OR rp.sellable_from  <= ${dateOnlyToUtc(today)}::date)
           AND (rp.sellable_until IS NULL OR rp.sellable_until >= ${dateOnlyToUtc(checkIn)}::date)
           AND (${destinationPath}::text IS NULL OR d.path LIKE ${destinationPath}::text || '%')
           AND (${destinationSlug}::text IS NULL OR d.slug = ${destinationSlug}::text)
           AND (${countryCode}::char(2) IS NULL OR h.country_code = ${countryCode}::char(2))
           AND (${hotelIds}::text[] IS NULL OR h.id = ANY(${hotelIds}::text[]))
           AND (${excludeHotelIds}::text[] IS NULL OR NOT (h.id = ANY(${excludeHotelIds}::text[])))
           AND (${minStars}::int IS NULL OR h.star_rating >= ${minStars}::int)
           AND (${propertyTypes}::text[] IS NULL OR h.property_type::text = ANY(${propertyTypes}::text[]))
           AND (${mealPlanCodes}::text[] IS NULL
                OR EXISTS (SELECT 1 FROM meal_plans mp
                            WHERE mp.id = rp.meal_plan_id AND mp.code::text = ANY(${mealPlanCodes}::text[])))
           -- Refundable means there is still a way to cancel for free, which
           -- is a fact about *when* rather than about the policy alone: a
           -- flexible rate booked the day before arrival is not refundable.
           --
           -- So the test is whether the widest *charging* deadline has yet to
           -- be reached. A non-refundable policy expresses itself as a deadline
           -- so wide it has already passed, and falls out here. Looking for a
           -- rule that charges zero would not work: a flexible policy is free
           -- because no rule covers the period before its first deadline, not
           -- because it has a zero-charge tier.
           AND (${refundableOnly}::boolean = false
                OR COALESCE(
                       (SELECT max(cr.hours_before_check_in)
                          FROM cancellation_rules cr
                         WHERE cr.policy_id = rp.cancellation_policy_id
                           AND cr.charge_value > 0),
                       0
                   ) < ${hoursUntilCheckIn})
           -- A minimum level of kosher *service*. Ordered by position in the
           -- enum's own declaration, which is why the type is declared
           -- weakest-first: atLeastServiceLevel() on the Prisma side reads
           -- its ordering from the same place, so there is one definition of
           -- what "at least PARTIAL" means.
           --
           -- NONE never matches: it records "we checked, and the answer is no".
           AND (${kosherMinLevel}::text IS NULL
                OR (kp.id IS NOT NULL
                    AND kp.service_level <> 'NONE'
                    AND array_position(
                            enum_range(NULL::kosher_service_level), kp.service_level)
                        >= array_position(
                            enum_range(NULL::kosher_service_level),
                            ${kosherMinLevel}::kosher_service_level)))
           -- "Certified" means a certificate that is verified, still valid
           -- today, not archived, and about the property rather than only its
           -- restaurant.
           --
           -- Deliberately not a cached boolean on the hotel: a cache would go
           -- stale silently at midnight, which is the exact failure this filter
           -- exists to prevent. CURRENT_DATE here is the database's, and a
           -- certificate expiring today is still valid today.
           AND (${kosherCertified}::boolean = false
                OR EXISTS (SELECT 1
                             FROM hotel_kosher_certifications c
                            WHERE c.profile_id = kp.id
                              AND c.verification = 'VERIFIED'
                              AND c.archived_at IS NULL
                              AND c.scope IN ('PROPERTY', 'KITCHEN')
                              AND (c.expires_on IS NULL OR c.expires_on >= CURRENT_DATE)))
           -- Every requested amenity must be present, so this is an AND of
           -- EXISTS rather than one IN: asking for pool and parking must not
           -- match a hotel that only has parking.
           AND (${amenityCodes}::text[] IS NULL
                OR NOT EXISTS (
                    SELECT 1 FROM unnest(${amenityCodes}::text[]) AS wanted(code)
                     WHERE NOT EXISTS (
                        SELECT 1 FROM hotel_amenities ha
                          JOIN amenities a ON a.id = ha.amenity_id
                         WHERE ha.hotel_id = h.id AND a.code = wanted.code
                     )
                ))
           -- Stay-level restrictions. These are properties of the booking, not
           -- of any one night, so they cannot be expressed as a missing join.
           AND NOT EXISTS (
                SELECT 1 FROM rate_plan_restrictions x
                 WHERE x.rate_plan_id = rp.id
                   AND x.start_date <= ${dateOnlyToUtc(lastNight)}::date
                   AND x.end_date   >= ${dateOnlyToUtc(checkIn)}::date
                   AND (x.stop_sell
                        OR (x.min_stay IS NOT NULL AND x.min_stay > ${nights})
                        OR (x.max_stay IS NOT NULL AND x.max_stay < ${nights})
                        OR (x.min_advance_days IS NOT NULL AND ${advanceDays} < x.min_advance_days)
                        OR (x.max_advance_days IS NOT NULL AND ${advanceDays} > x.max_advance_days))
           )
           AND NOT EXISTS (
                SELECT 1 FROM rate_plan_restrictions x
                 WHERE x.rate_plan_id = rp.id AND x.closed_to_arrival
                   AND x.start_date <= ${dateOnlyToUtc(checkIn)}::date
                   AND x.end_date   >= ${dateOnlyToUtc(checkIn)}::date
           )
           -- Departure day is not a night we occupy, so it can only be checked
           -- against its own inventory row rather than through the join above.
           AND NOT EXISTS (
                SELECT 1 FROM rate_plan_restrictions x
                 WHERE x.rate_plan_id = rp.id AND x.closed_to_departure
                   AND x.start_date <= ${dateOnlyToUtc(checkOut)}::date
                   AND x.end_date   >= ${dateOnlyToUtc(checkOut)}::date
           )
           AND NOT EXISTS (
                SELECT 1 FROM room_inventory i2
                 WHERE i2.room_type_id = rt.id
                   AND i2.date = ${dateOnlyToUtc(checkOut)}::date
                   AND i2.closed_to_departure
           )
         GROUP BY rt.hotel_id, rt.id, rp.id
        HAVING count(*) = ${nights}
           AND min(inv.total_units - inv.blocked_units - inv.booked_units - inv.held_units) >= ${rooms}
           -- A per-night minimum stay set on the calendar rather than on the
           -- rate plan. The strictest night wins.
           AND max(COALESCE(inv.min_stay, 1)) <= ${nights}
    `;
};

/**
 * Every rate row for a set of rate plans over a set of nights, in one query.
 *
 * The obvious implementation — fetch rates per offer — is where N+1 gets into
 * search. Returned as a lookup so the pricing pass is pure array work.
 */
export const loadRates = async (ratePlanIds, checkIn, checkOut) => {
    if (ratePlanIds.length === 0) {
        return new Map();
    }

    const lastNight = eachNight(checkIn, checkOut).at(-1);

    const rows = await prisma.rate.findMany({
        where: {
            ratePlanId: { in: ratePlanIds },
            date: { gte: dateOnlyToUtc(checkIn), lte: dateOnlyToUtc(lastNight) }
        }
    });

    const byPlan = new Map();

    for (const row of rows) {
        if (!byPlan.has(row.ratePlanId)) {
            byPlan.set(row.ratePlanId, new Map());
        }

        byPlan.get(row.ratePlanId).set(toDateOnly(row.date), row);
    }

    return byPlan;
};

/** Live availability for one room type over a stay, as the minimum night. */
export const availabilityFor = async (roomTypeId, checkIn, checkOut) => {
    const nights = eachNight(checkIn, checkOut);

    const rows = await prisma.roomInventory.findMany({
        where: {
            roomTypeId,
            date: { gte: dateOnlyToUtc(checkIn), lte: dateOnlyToUtc(nights.at(-1)) }
        }
    });

    if (rows.length !== nights.length) {
        return { availableUnits: 0, missingNights: nights.length - rows.length };
    }

    return {
        availableUnits: Math.min(
            ...rows.map((row) => row.totalUnits - row.blockedUnits - row.bookedUnits - row.heldUnits)
        ),
        stopSell: rows.some((row) => row.stopSell),
        missingNights: 0
    };
};

export const manualProvider = {
    code: 'MANUAL',
    searchCandidates,
    loadRates,
    availabilityFor,
    /** Today at the property, which is what "advance booking" is measured from. */
    todayAt: (timezone) => todayInTimezone(timezone)
};
