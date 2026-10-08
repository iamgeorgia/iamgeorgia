import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { issueQuoteToken, readQuoteToken } from '../../lib/transfer/quoteToken.js';
import { addDays, dateOnlyToUtc, todayInTimezone, toDateOnly } from '../../lib/time.js';
import { resolveMarkup } from '../hotel/pricingRule.service.js';
import { findBlackouts, findCuratedRoute } from './route.service.js';
import { resolveEndpoints } from './point.service.js';
import { listSellableVehicles } from './vehicle.service.js';
import {
    isBlackedOut,
    isNightPickup,
    noticeMinutes,
    pickupInstant,
    quoteJourney,
    routeMetrics
} from './pricing.service.js';

/**
 * Turning a search into a list of priced, signed offers.
 *
 * This is the only place the catalogue, the pricing rules and the pure fare
 * maths meet. Search calls it to fill a results page; booking calls it again
 * with the token it handed out, and the two have to produce the same number —
 * which is why the second path re-enters through exactly the same function
 * rather than trusting anything the client sends back.
 */

const MINUTES_PER_HOUR = 60;

/** Extras resolved from their codes, with the quantities the traveller asked for. */
const resolveExtras = async (requested = []) => {
    if (requested.length === 0) {
        return [];
    }

    const codes = requested.map((entry) => entry.code);
    const rows = await prisma.transferExtra.findMany({ where: { code: { in: codes }, isActive: true } });
    const byCode = new Map(rows.map((row) => [row.code, row]));

    return requested.map((entry) => {
        const extra = byCode.get(entry.code);

        if (!extra) {
            throw new NotFoundError(`That extra is not available: ${entry.code}`);
        }

        return { extra, quantity: Math.max(1, entry.quantity ?? 1) };
    });
};

/** Extras that make sense for this class. A ski rack on a sedan is not a product. */
const extrasForVehicle = (extras, vehicle) =>
    extras.filter(
        (entry) =>
            entry.extra.appliesToClasses.length === 0 ||
            entry.extra.appliesToClasses.includes(vehicle.vehicleClass)
    );

/**
 * Checks the journey is one we can actually run before pricing anything.
 *
 * Notice and horizon are refused rather than quoted: a fare for a car that
 * cannot be dispatched in time is worse than no fare, because the traveller
 * only finds out after paying attention to it.
 */
const assertBookable = ({ pickupAt, dateOnly, timezone }) => {
    const notice = noticeMinutes(pickupAt);

    if (notice < config.transfer.minimumNoticeMinutes) {
        throw new UnprocessableEntityError('That pick-up is too soon for us to arrange a car', {
            reason: 'TOO_SOON',
            minimumNoticeMinutes: config.transfer.minimumNoticeMinutes
        });
    }

    const horizon = addDays(todayInTimezone(timezone), config.transfer.bookingHorizonDays);

    if (dateOnly > horizon) {
        throw new UnprocessableEntityError('That pick-up is too far ahead to book yet', {
            reason: 'BEYOND_HORIZON',
            bookableUntil: horizon
        });
    }
};

/**
 * The legs of a journey.
 *
 * A one-way is one leg; a return is two, the second running the other way at
 * the return time. Modelled as a list from the start rather than as a boolean,
 * because a multi-stop route is the same idea with more entries and a schema
 * that only knows about "there and back" would have to be rewritten for it.
 */
const buildLegs = ({ query, from, to, outboundMetrics, curated, reverseCurated }) => {
    const outboundAt = pickupInstant(query.date, query.time, from.timezone);
    const legs = [
        {
            direction: 'OUTBOUND',
            fromPointId: from.id,
            toPointId: to.id,
            fromPointName: from.name,
            toPointName: to.name,
            pickupAt: outboundAt,
            distanceKm: outboundMetrics.distanceKm,
            durationMinutes: outboundMetrics.durationMinutes,
            touchesAirport: outboundMetrics.touchesAirport,
            isNight: isNightPickup(outboundAt, from.timezone),
            travelDate: query.date,
            curatedRoute: curated,
            tripType: query.tripType
        }
    ];

    if (query.tripType === 'RETURN') {
        const returnAt = pickupInstant(query.returnDate, query.returnTime, to.timezone);

        legs.push({
            direction: 'RETURN',
            fromPointId: to.id,
            toPointId: from.id,
            fromPointName: to.name,
            toPointName: from.name,
            pickupAt: returnAt,
            distanceKm: outboundMetrics.distanceKm,
            durationMinutes: outboundMetrics.durationMinutes,
            touchesAirport: outboundMetrics.touchesAirport,
            isNight: isNightPickup(returnAt, to.timezone),
            travelDate: query.returnDate,
            // The way back may be its own catalogue route with its own price.
            // Falling back to the outbound price would quietly invent one.
            curatedRoute: reverseCurated,
            tripType: query.tripType
        });
    }

    return legs;
};

/**
 * Every offer for one journey.
 *
 * Returns the shape a results page renders: the journey itself, then one entry
 * per vehicle that can carry the party, each carrying its own signed token.
 */
export const quotesForJourney = async (query, viewer) => {
    const { from, to } = await resolveEndpoints(query.from, query.to, { locale: query.locale });

    const outboundAt = pickupInstant(query.date, query.time, from.timezone);
    assertBookable({ pickupAt: outboundAt, dateOnly: query.date, timezone: from.timezone });

    if (query.tripType === 'RETURN') {
        const returnAt = pickupInstant(query.returnDate, query.returnTime, to.timezone);

        if (returnAt <= outboundAt) {
            throw new UnprocessableEntityError('The return pick-up is before the outbound one', {
                reason: 'RETURN_BEFORE_OUTBOUND'
            });
        }
    }

    const passengers = query.adults + query.children;

    if (passengers > config.transfer.maxPassengers) {
        throw new UnprocessableEntityError('That party is larger than we quote online', {
            reason: 'PARTY_TOO_LARGE',
            maxPassengers: config.transfer.maxPassengers
        });
    }

    const [curated, reverseCurated, vehicles, extras] = await Promise.all([
        findCuratedRoute(from.id, to.id),
        query.tripType === 'RETURN' ? findCuratedRoute(to.id, from.id) : Promise.resolve(null),
        listSellableVehicles({
            passengers,
            luggage: query.luggage,
            viewer,
            locale: query.locale
        }),
        resolveExtras(query.extras)
    ]);

    if (vehicles.length === 0) {
        // Not an error: a party of twelve with fourteen bags is a real query
        // with no answer, and an empty result set says so better than a 404.
        return { from, to, route: null, offers: [] };
    }

    // A curated route carries a distance an admin may have corrected; without
    // one the coordinates are all there is.
    const outboundMetrics = curated
        ? {
              distanceKm: curated.distanceKm,
              durationMinutes: curated.durationMinutes,
              touchesAirport: from.kind === 'AIRPORT' || to.kind === 'AIRPORT'
          }
        : routeMetrics(from, to);

    const legs = buildLegs({ query, from, to, outboundMetrics, curated, reverseCurated });

    const travelDates = legs.map((leg) => leg.travelDate).sort();
    const blackouts = await findBlackouts({
        routeId: curated?.id ?? null,
        vehicleIds: vehicles.map((vehicle) => vehicle.id),
        from: dateOnlyToUtc(travelDates[0]),
        to: dateOnlyToUtc(travelDates[travelDates.length - 1])
    });

    // Prisma hands back Date objects for a date column; the comparison is on
    // calendar days, so both sides are normalised to YYYY-MM-DD first.
    const windows = blackouts.map((window) => ({
        routeId: window.routeId,
        vehicleId: window.vehicleId,
        from: toDateOnly(window.from),
        to: toDateOnly(window.to),
        reason: window.reason
    }));

    const routeClosed = windows.some(
        (window) => window.routeId && travelDates.some((date) => isBlackedOut(date, [window]))
    );

    if (routeClosed) {
        return { from, to, route: curated, offers: [], closed: true };
    }

    // `productType` is what lets a rule written for "every transfer" match;
    // without it only rules that name no product type at all could apply.
    const { markupBps } = await resolveMarkup({
        partner: viewer?.partner ?? (viewer?.partnerId ? { id: viewer.partnerId } : null),
        productType: 'TRANSFER',
        destinationId: from.destinationId,
        timezone: from.timezone,
        date: travelDates[0]
    });

    const offers = vehicles
        .filter(
            (vehicle) =>
                !windows.some(
                    (window) =>
                        window.vehicleId === vehicle.id &&
                        travelDates.some((date) => isBlackedOut(date, [window]))
                )
        )
        .map((vehicle) => {
            const priced = quoteJourney({
                vehicle,
                legs: legs.map((leg) => ({
                    ...leg,
                    // Each leg reads the price row for its own direction.
                    curated:
                        (leg.curatedRoute?.prices ?? []).find((price) => price.vehicleId === vehicle.id) ?? null
                })),
                passengers,
                extras: extrasForVehicle(extras, vehicle),
                markupBps,
                currency: vehicle.currency
            });

            return {
                vehicle,
                quote: priced,
                token: issueQuoteToken({
                    vehicleId: vehicle.id,
                    routeId: curated?.id ?? null,
                    fromPointId: from.id,
                    toPointId: to.id,
                    date: query.date,
                    time: query.time,
                    tripType: query.tripType,
                    returnDate: query.returnDate ?? null,
                    returnTime: query.returnTime ?? null,
                    adults: query.adults,
                    children: query.children,
                    childAges: query.childAges ?? [],
                    luggage: query.luggage,
                    cabinBags: query.cabinBags,
                    extras: query.extras ?? [],
                    quotedSellCents: priced.totals.sellCents,
                    currency: priced.currency
                })
            };
        });

    return { from, to, route: curated, offers };
};

/**
 * Re-prices a token and says whether it still stands.
 *
 * The token is never the source of the price. It names a journey and a vehicle;
 * everything else is looked up and computed again from scratch, and the figure
 * it carries is used for exactly one thing — telling the traveller what changed
 * when it no longer matches.
 *
 * `strict` is what separates the two callers. Search revalidating for a preview
 * wants to show the new number; booking wants to refuse and ask.
 */
export const revalidateQuote = async (token, viewer, { strict = true } = {}) => {
    const decoded = readQuoteToken(token);

    const result = await quotesForJourney(
        {
            from: decoded.fromPointId,
            to: decoded.toPointId,
            date: decoded.date,
            time: decoded.time,
            tripType: decoded.tripType,
            returnDate: decoded.returnDate,
            returnTime: decoded.returnTime,
            adults: decoded.adults,
            children: decoded.children,
            childAges: decoded.childAges,
            luggage: decoded.luggage,
            cabinBags: decoded.cabinBags,
            extras: decoded.extras
        },
        viewer
    );

    const offer = result.offers.find((candidate) => candidate.vehicle.id === decoded.vehicleId);

    if (!offer) {
        throw new ConflictError('That vehicle is no longer available for this journey', {
            reason: 'UNAVAILABLE'
        });
    }

    if (strict && offer.quote.totals.sellCents !== decoded.quotedSellCents) {
        throw new ConflictError('The fare for this transfer has changed', {
            reason: 'PRICE_CHANGED',
            quotedCents: decoded.quotedSellCents,
            currentCents: offer.quote.totals.sellCents,
            currency: offer.quote.currency
        });
    }

    return { ...offer, from: result.from, to: result.to, route: result.route, decoded };
};

export { MINUTES_PER_HOUR };
