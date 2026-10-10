import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { eachNight, nightsBetween, todayInTimezone } from '../../lib/time.js';
import { issueOfferToken } from '../../lib/hotel/offerToken.js';
import { isTrade } from '../../middleware/auth.js';
import { assertAllowed, deniedIds, restrictIds } from '../partner/access.service.js';
import { defaultProvider } from './providers/index.js';
import { DEFAULT_CHILD_POLICY, categorise, resolveOccupancy } from './occupancy.service.js';
import { quoteStay } from './pricing.service.js';
import { resolveMarkup } from './pricingRule.service.js';
import { buildCancellationSchedule } from './policy.service.js';

/**
 * Hotel search.
 *
 * Two stages, and the split is what keeps this from becoming an N+1 disaster:
 *
 *   1. **One SQL query** finds every rate plan that can actually be sold for
 *      these dates and this party, and the cheapest per hotel. It touches only
 *      the two big tables and returns ids and totals — no content.
 *   2. **A fixed number of queries** hydrate the page: the hotels with their
 *      images and amenities, the rate plans with their terms, and every rate
 *      row for every candidate at once.
 *
 * The total is a handful of queries whether the search returns three hotels or
 * three hundred. Pricing then runs in memory, because `quoteStay` is pure.
 *
 * The important guarantee: nothing reaches a result page unless every night of
 * the stay is both priced and in stock. "Starting from" is always a real,
 * bookable offer — never `hotel.priceFromCents`, which is an un-dated cache.
 */

const MAX_NIGHTS = () => config.hotel.maxStayNights;

/**
 * Checks the stay itself before any query runs.
 *
 * "Today" is read in the property's time zone where one is known, and in the
 * platform default otherwise — a guest in Tel Aviv searching at 01:00 must
 * still be able to book tonight in Bakuriani.
 */
export const validateStay = ({ checkIn, checkOut, timezone = 'Asia/Tbilisi' }) => {
    const nights = nightsBetween(checkIn, checkOut);

    if (nights < 1) {
        throw new BadRequestError('Check-out must be after check-in', { checkIn, checkOut });
    }

    if (nights > MAX_NIGHTS()) {
        throw new BadRequestError(`A stay may be at most ${MAX_NIGHTS()} nights`, {
            nights,
            limit: MAX_NIGHTS()
        });
    }

    const today = todayInTimezone(timezone);

    if (checkIn < today) {
        throw new BadRequestError('Check-in is in the past', { checkIn, today });
    }

    if (nightsBetween(today, checkIn) > config.hotel.bookingHorizonDays) {
        throw new BadRequestError('That date is further ahead than we currently sell', {
            limitDays: config.hotel.bookingHorizonDays
        });
    }

    return { nights, today };
};

/** Everything the pricing pass needs, fetched once for the whole page. */
const loadOfferContext = async (candidates, locale) => {
    const ratePlanIds = [...new Set(candidates.map((c) => c.ratePlanId))];
    const hotelIds = [...new Set(candidates.map((c) => c.hotelId))];

    const [ratePlans, hotels] = await Promise.all([
        prisma.ratePlan.findMany({
            where: { id: { in: ratePlanIds } },
            include: {
                mealPlan: true,
                cancellationPolicy: { include: { rules: true } },
                paymentPolicy: true,
                roomType: {
                    include: {
                        beds: { include: { bedType: true } },
                        images: {
                            where: { isCover: true },
                            take: 1,
                            include: { fileAsset: { include: { variants: true } } }
                        },
                        translations: locale && locale !== 'en' ? { where: { locale }, take: 1 } : false
                    }
                }
            }
        }),
        prisma.hotel.findMany({
            where: { id: { in: hotelIds } },
            include: {
                destination: {
                    include: { translations: locale && locale !== 'en' ? { where: { locale }, take: 1 } : false }
                },
                images: {
                    where: { isCover: true },
                    take: 1,
                    include: { fileAsset: { include: { variants: true } } }
                },
                featuredImage: { include: { variants: true } },
                amenities: { include: { amenity: true } },
                childPolicy: { include: { bands: { orderBy: { minAge: 'asc' } } } },
                // For the card's kosher line. Archived certificates are dropped
                // here rather than in the serializer, so a property with years
                // of history still costs a handful of rows on a search page.
                kosher: { include: { certifications: { where: { archivedAt: null } } } },
                taxFees: true,
                translations: locale && locale !== 'en' ? { where: { locale }, take: 1 } : false
            }
        })
    ]);

    return {
        ratePlansById: new Map(ratePlans.map((plan) => [plan.id, plan])),
        hotelsById: new Map(hotels.map((hotel) => [hotel.id, hotel]))
    };
};

/**
 * Turns one candidate into a priced, bookable offer.
 *
 * Returns null when the party does not actually fit the room. The SQL narrows
 * on the room's own limits, but occupancy also depends on the hotel's child
 * policy — whether infants take a place, where the child band ends — and that
 * is resolver work rather than something to duplicate in the query.
 */
const buildOffer = ({ candidate, ratePlan, hotel, rates, stay, party, markupBps }) => {
    const childPolicy = hotel.childPolicy
        ? {
              infantMaxAge: hotel.childPolicy.infantMaxAge,
              childMaxAge: hotel.childPolicy.childMaxAge,
              childrenCountTowardOccupancy: hotel.childPolicy.childrenCountTowardOccupancy,
              maxChildrenFreePerRoom: hotel.childPolicy.maxChildrenFreePerRoom
          }
        : DEFAULT_CHILD_POLICY;

    const occupancy = resolveOccupancy({
        roomType: ratePlan.roomType,
        childPolicy,
        adults: stay.adults,
        childAges: stay.childAges
    });

    if (!occupancy.fits) {
        return null;
    }

    const nights = eachNight(stay.checkIn, stay.checkOut).map((date) => ({ date, rate: rates.get(date) }));

    // Belt and braces: the SQL already guarantees a rate for every night, and
    // an offer priced from a partial set would be quietly wrong rather than
    // obviously broken.
    if (nights.some((night) => !night.rate)) {
        return null;
    }

    const quote = quoteStay({
        nights,
        ratePlan,
        childPolicy,
        bands: hotel.childPolicy?.bands ?? [],
        adults: stay.adults,
        childAges: stay.childAges,
        taxFees: hotel.taxFees ?? [],
        markupBps,
        rooms: stay.rooms,
        currency: ratePlan.currency
    });

    const schedule = buildCancellationSchedule({
        rules: ratePlan.cancellationPolicy?.rules ?? [],
        checkInDate: stay.checkIn,
        checkInTime: hotel.checkInFrom ?? '14:00',
        timezone: hotel.timezone,
        nightlyCents: quote.nights.map((night) => night.sellCents),
        // Per room, as the booking will freeze it.
        includedTaxCents: Math.floor(quote.totals.taxIncludedCents / stay.rooms),
        currency: quote.currency
    });

    return {
        hotel,
        ratePlan,
        roomType: ratePlan.roomType,
        occupancy,
        quote,
        schedule,
        availableUnits: candidate.availableUnits,
        token: issueOfferToken({
            hotelId: hotel.id,
            roomTypeId: ratePlan.roomTypeId,
            ratePlanId: ratePlan.id,
            checkIn: stay.checkIn,
            checkOut: stay.checkOut,
            adults: stay.adults,
            childAges: stay.childAges,
            rooms: stay.rooms,
            quotedSellCents: quote.totals.totalCents,
            currency: quote.currency
        })
    };
};

/**
 * Search: hotels with at least one bookable offer, cheapest first.
 *
 * A hotel appears only if something can actually be sold. Returning a property
 * because it exists — and letting the guest discover at checkout that it
 * cannot be booked — is the specific failure this is built to avoid.
 */
export const searchHotels = async (criteria, viewer) => {
    const { checkIn, checkOut, adults, childAges = [], rooms = 1, locale, page, pageSize } = criteria;
    const { nights, today } = validateStay({ checkIn, checkOut });

    const party = categorise(adults, childAges, DEFAULT_CHILD_POLICY);
    const provider = defaultProvider();

    const candidates = await provider.searchCandidates({
        checkIn,
        checkOut,
        rooms,
        adults: party.adults,
        children: party.children.length + party.infants.length,
        // The room's own maximum is checked against the widest reading of the
        // party; the hotel's child policy narrows it afterwards in the resolver.
        guests: party.adults + party.children.length,
        destinationPath: criteria.destinationPath ?? null,
        destinationSlug: criteria.destinationSlug ?? null,
        // Narrowed to what this partner may sell, if it has an allow list,
        // and never any property on its deny list.
        hotelIds: restrictIds(criteria.hotelIds ?? null, viewer, 'HOTEL'),
        excludeHotelIds: deniedIds(viewer, 'HOTEL'),
        countryCode: criteria.countryCode ?? null,
        propertyTypes: criteria.propertyType
            ? Array.isArray(criteria.propertyType)
                ? criteria.propertyType
                : [criteria.propertyType]
            : null,
        minStars: criteria.minStars ?? null,
        amenityCodes: criteria.amenity
            ? Array.isArray(criteria.amenity)
                ? criteria.amenity
                : [criteria.amenity]
            : null,
        mealPlanCodes: criteria.mealPlan
            ? Array.isArray(criteria.mealPlan)
                ? criteria.mealPlan
                : [criteria.mealPlan]
            : null,
        refundableOnly: criteria.refundableOnly ?? false,
        // Two clauses in the candidate query, and nothing else. Every kosher
        // *facility* filter — restaurant, Shabbat elevator, synagogue, mikveh —
        // travels on `amenity` above, because they are amenities.
        kosherMinLevel: criteria.kosher ?? null,
        kosherCertified: criteria.kosherCertified ?? false,
        includePartnerOnly: isTrade(viewer),
        b2cOnly: !isTrade(viewer),
        today
    });

    if (candidates.length === 0) {
        return { hotels: [], total: 0, page, pageSize, totalPages: 1, nights };
    }

    /*
     * Decide which hotels are on this page *before* hydrating anything.
     *
     * The candidate query returns every sellable offer — for two hundred hotels
     * with four room types and two rate plans that is sixteen hundred rows —
     * but a page shows twenty-four cards. Hydrating and pricing all sixteen
     * hundred to display twenty-four was costing more than the query that found
     * them.
     *
     * Ordering here uses the net total, which is what the candidate query
     * already returns. Markup is uniform for a given buyer so it cannot change
     * the order; a per-hotel tax rate could, in principle, reorder two hotels
     * that are within a percent of each other. Everything on the page is then
     * priced exactly and sorted again on the real total, so what the user sees
     * is always correctly ordered — the approximation only affects which hotels
     * sit either side of a page boundary.
     */
    const cheapestByHotel = new Map();

    for (const candidate of candidates) {
        const best = cheapestByHotel.get(candidate.hotelId);

        if (!best || candidate.netTotalCents < best.netTotalCents) {
            cheapestByHotel.set(candidate.hotelId, candidate);
        }
    }

    const orderedHotelIds = [...cheapestByHotel.values()]
        .sort((a, b) => a.netTotalCents - b.netTotalCents)
        .map((candidate) => candidate.hotelId);

    const total = orderedHotelIds.length;
    const pageHotelIds = new Set(orderedHotelIds.slice((page - 1) * pageSize, page * pageSize));

    // Every offer belonging to the hotels on this page, and nothing else. The
    // card needs all of them for its board and refundability badges.
    const pageCandidates = candidates.filter((candidate) => pageHotelIds.has(candidate.hotelId));

    const { ratePlansById, hotelsById } = await loadOfferContext(pageCandidates, locale);
    // One resolution for the whole page: the rules that matter are the buyer's,
    // and a per-hotel rule is applied per offer below.
    const { markupBps } = await resolveMarkup({ partner: viewer?.partner });
    const ratesByPlan = await provider.loadRates(
        [...new Set(pageCandidates.map((c) => c.ratePlanId))],
        checkIn,
        checkOut
    );

    const stay = { checkIn, checkOut, adults, childAges, rooms };
    const byHotel = new Map();

    for (const candidate of pageCandidates) {
        const ratePlan = ratePlansById.get(candidate.ratePlanId);
        const hotel = hotelsById.get(candidate.hotelId);
        const rates = ratesByPlan.get(candidate.ratePlanId);

        if (!ratePlan || !hotel || !rates) {
            continue;
        }

        const offer = buildOffer({ candidate, ratePlan, hotel, rates, stay, party, markupBps });

        if (!offer) {
            continue;
        }

        if (!byHotel.has(hotel.id)) {
            byHotel.set(hotel.id, { hotel, offers: [] });
        }

        byHotel.get(hotel.id).offers.push(offer);
    }

    const results = [...byHotel.values()]
        .map((entry) => ({
            ...entry,
            offers: entry.offers.sort((a, b) => a.quote.totals.totalCents - b.quote.totals.totalCents)
        }))
        // "Starting from" is the cheapest offer that can actually be booked for
        // these dates, which is the only figure worth showing on a card. Sorted
        // on the real total, after tax, so the page itself is exactly ordered.
        .sort((a, b) => a.offers[0].quote.totals.totalCents - b.offers[0].quote.totals.totalCents);

    return {
        hotels: results,
        // Counted from the candidates rather than from the page, so a client
        // knows how many hotels matched and not merely how many it received.
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        nights
    };
};

/**
 * One hotel, with every offer it can sell for these dates, grouped by room.
 *
 * Grouped rather than flat because three rate plans on one room are three
 * *offers for the same room*, and presenting them as three unrelated rooms is
 * both confusing and how a guest ends up booking the wrong thing.
 */
export const hotelAvailability = async (slugOrId, criteria, viewer) => {
    const { checkIn, checkOut, adults, childAges = [], rooms = 1, locale } = criteria;

    const hotel = await prisma.hotel.findFirst({
        where: { OR: [{ id: slugOrId }, { slug: slugOrId }], status: 'ACTIVE' },
        select: { id: true, timezone: true }
    });

    if (!hotel) {
        throw new NotFoundError('Hotel not found');
    }

    assertAllowed(viewer, 'HOTEL', hotel.id, 'Hotel not found');

    const { nights, today } = validateStay({ checkIn, checkOut, timezone: hotel.timezone });
    const party = categorise(adults, childAges, DEFAULT_CHILD_POLICY);
    const provider = defaultProvider();

    const candidates = await provider.searchCandidates({
        checkIn,
        checkOut,
        rooms,
        adults: party.adults,
        children: party.children.length + party.infants.length,
        guests: party.adults + party.children.length,
        hotelIds: [hotel.id],
        includePartnerOnly: isTrade(viewer),
        b2cOnly: !isTrade(viewer),
        today
    });

    const { ratePlansById, hotelsById } = await loadOfferContext(
        candidates.length > 0 ? candidates : [{ hotelId: hotel.id, ratePlanId: '', roomTypeId: '' }],
        locale
    );
    const { markupBps } = await resolveMarkup({ partner: viewer?.partner, hotel });
    const ratesByPlan = await provider.loadRates(
        [...new Set(candidates.map((c) => c.ratePlanId))],
        checkIn,
        checkOut
    );

    const stay = { checkIn, checkOut, adults, childAges, rooms };
    const byRoomType = new Map();

    for (const candidate of candidates) {
        const ratePlan = ratePlansById.get(candidate.ratePlanId);
        const rates = ratesByPlan.get(candidate.ratePlanId);
        const full = hotelsById.get(candidate.hotelId);

        if (!ratePlan || !rates || !full) {
            continue;
        }

        const offer = buildOffer({ candidate, ratePlan, hotel: full, rates, stay, party, markupBps });

        if (!offer) {
            continue;
        }

        if (!byRoomType.has(ratePlan.roomTypeId)) {
            byRoomType.set(ratePlan.roomTypeId, { roomType: ratePlan.roomType, offers: [] });
        }

        byRoomType.get(ratePlan.roomTypeId).offers.push(offer);
    }

    return {
        hotelId: hotel.id,
        nights,
        roomTypes: [...byRoomType.values()].map((entry) => ({
            ...entry,
            offers: entry.offers.sort((a, b) => a.quote.totals.totalCents - b.quote.totals.totalCents)
        }))
    };
};

/**
 * Re-quotes an offer token against live data.
 *
 * This is the revalidation step, and it runs whether or not the token verified:
 * the signature proves nobody edited the price, this proves the price is still
 * real. A difference is a 409 carrying both figures, so the client can show
 * "the price changed from X to Y" rather than a bare failure.
 *
 * `requireAvailability` is false when a hold is being confirmed, and that is
 * not a shortcut. The hold has *already* claimed the rooms, so the availability
 * query would see the stock it is itself holding and report none — refusing the
 * exact booking the hold exists to guarantee. With a hold, the rooms are
 * settled and only the price is still in question.
 */
export const revalidateOffer = async (
    token,
    viewer,
    { strict = true, requireAvailability = true } = {}
) => {
    const offer = token;

    // The token proves the offer was quoted, not that it was quoted for this
    // caller. A partner's token for a trade-only hotel or a PARTNER_ONLY rate
    // must not become a public booking in someone else's hands, so the sales
    // channel is checked here exactly as search checked it when the token was
    // issued — the price comparison below is not an access check.
    const trade = isTrade(viewer);
    const hotel = await prisma.hotel.findFirst({
        where: { id: offer.hotelId, status: 'ACTIVE', ...(trade ? {} : { b2cEnabled: true }) },
        include: {
            childPolicy: { include: { bands: { orderBy: { minAge: 'asc' } } } },
            taxFees: true,
            destination: true,
            images: { where: { isCover: true }, take: 1, include: { fileAsset: { include: { variants: true } } } },
            featuredImage: { include: { variants: true } }
        }
    });

    if (!hotel) {
        throw new NotFoundError('That hotel is no longer available');
    }

    // Checked at booking as at search: a token quoted before a partner was
    // denied a property, or by someone else, must not book it.
    assertAllowed(viewer, 'HOTEL', hotel.id, 'That hotel is no longer available');

    const { today } = validateStay({
        checkIn: offer.checkIn,
        checkOut: offer.checkOut,
        timezone: hotel.timezone
    });

    const provider = defaultProvider();
    const party = categorise(offer.adults, offer.childAges, DEFAULT_CHILD_POLICY);

    let candidate;

    if (requireAvailability) {
        const candidates = await provider.searchCandidates({
            checkIn: offer.checkIn,
            checkOut: offer.checkOut,
            rooms: offer.rooms,
            adults: party.adults,
            children: party.children.length + party.infants.length,
            guests: party.adults + party.children.length,
            hotelIds: [hotel.id],
            includePartnerOnly: trade,
            b2cOnly: !trade,
            today
        });

        candidate = candidates.find((row) => row.ratePlanId === offer.ratePlanId);

        if (!candidate) {
            throw new ConflictError('That offer is no longer available for these dates', {
                reason: 'UNAVAILABLE'
            });
        }
    } else {
        // The hold already owns these rooms, so the only figure still open is
        // the price. `availableUnits` reports what the hold itself secured.
        candidate = { availableUnits: offer.rooms };
    }

    const ratePlan = await prisma.ratePlan.findUnique({
        where: { id: offer.ratePlanId },
        include: {
            mealPlan: true,
            cancellationPolicy: { include: { rules: true } },
            paymentPolicy: true,
            roomType: { include: { beds: { include: { bedType: true } } } }
        }
    });

    // Reached without the candidate query when a hold is being confirmed, so
    // the rate plan's own channel is checked here rather than trusted.
    if (!ratePlan || ratePlan.status !== 'ACTIVE' || (!trade && ratePlan.visibility !== 'PUBLIC')) {
        throw new ConflictError('That offer is no longer available for these dates', {
            reason: 'UNAVAILABLE'
        });
    }

    const ratesByPlan = await provider.loadRates([offer.ratePlanId], offer.checkIn, offer.checkOut);
    const { markupBps } = await resolveMarkup({ partner: viewer?.partner, hotel });

    const priced = buildOffer({
        candidate,
        ratePlan,
        hotel,
        rates: ratesByPlan.get(offer.ratePlanId) ?? new Map(),
        stay: {
            checkIn: offer.checkIn,
            checkOut: offer.checkOut,
            adults: offer.adults,
            childAges: offer.childAges,
            rooms: offer.rooms
        },
        party,
        markupBps
    });

    if (!priced) {
        throw new ConflictError('That offer is no longer available for these dates', {
            reason: 'UNAVAILABLE'
        });
    }

    const currentCents = priced.quote.totals.totalCents;

    if (strict && currentCents !== offer.quotedSellCents) {
        throw new ConflictError('The price for this offer has changed', {
            reason: 'PRICE_CHANGED',
            quotedCents: offer.quotedSellCents,
            currentCents,
            currency: priced.quote.currency
        });
    }

    return { ...priced, priceChanged: currentCents !== offer.quotedSellCents };
};
