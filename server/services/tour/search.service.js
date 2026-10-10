import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { BadRequestError, ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { addDays, dateOnlyToUtc, nightsBetween, todayInTimezone, toDateOnly, zonedTimeToInstant } from '../../lib/time.js';
import { issueTourOfferToken } from '../../lib/tour/offerToken.js';
import { resolveMarkup } from '../hotel/pricingRule.service.js';
import { buildCancellationSchedule } from '../hotel/policy.service.js';
import { findTourOr404, listTours, summaryInclude } from './tour.service.js';
import { findTourCandidates } from './candidate.service.js';
import { optionInclude } from './option.service.js';
import { availableUnits, readTourInventoryMap } from './inventory.service.js';
import { fitsOption, partyFor, quoteTour, resolveSeason, resolveTier, unitsFor } from './pricing.service.js';
import { isTrade } from '../../middleware/auth.js';
import { accessWhere, deniedIds, restrictIds } from '../partner/access.service.js';

/**
 * Tour availability and search.
 *
 * The same guarantee as hotel search: nothing reaches a result unless it can
 * actually be booked — a departure exists, has seats, is priced for the party
 * and the date, and is inside the notice and horizon windows. "From" prices
 * on a browse card are indicative; only this file quotes an offer.
 */

/** A departure window a calendar may ask for in one call. */
const MAX_WINDOW_DAYS = 62;

/** The wall-clock start of a departure, resolved to an instant. */
export const departureInstant = (date, time, timezone) => zonedTimeToInstant(date, time ?? '09:00', timezone);

/**
 * Why a date cannot be sold, or null when it can. Notice and horizon are the
 * option's own; the platform horizon caps both.
 */
export const dateRefusal = ({ date, departureTime, option, tour, now = new Date() }) => {
    const today = todayInTimezone(tour.timezone, now);

    if (date < today) {
        return { reason: 'PAST' };
    }

    const horizonDays = Math.min(option.horizonDays, config.tour.bookingHorizonDays);

    if (nightsBetween(today, date) > horizonDays) {
        return { reason: 'BEYOND_HORIZON', bookableUntil: addDays(today, horizonDays) };
    }

    const startsAt = departureInstant(date, departureTime ?? option.startTime, tour.timezone);
    const noticeMs = option.noticeHours * 60 * 60 * 1000;

    if (startsAt.getTime() - now.getTime() < noticeMs) {
        return { reason: 'TOO_SOON', noticeHours: option.noticeHours };
    }

    return null;
};

/** Every calendar date from `from` to `to`, inclusive. */
const eachDate = (from, to) => {
    const dates = [];

    for (let date = from; date <= to; date = addDays(date, 1)) {
        dates.push(date);
    }

    return dates;
};

/**
 * Prices one option on one departure for one party, or says why it cannot.
 *
 * Pure apart from the inputs it is handed; the callers below fetch the tour,
 * the inventory row and the markup once and call this per date.
 */
export const buildTourOffer = ({ tour, option, date, row, party, adults, childAges = [], markupBps, now }) => {
    if (!fitsOption(option, party)) {
        return { available: false, reason: 'PARTY_SIZE', minPax: option.minPax, maxPax: option.maxPax };
    }

    if (!row) {
        return null;
    }

    const departureTime = row.departureTime ?? option.startTime ?? null;
    const refusal = dateRefusal({ date, departureTime, option, tour, now });

    if (refusal) {
        return { available: false, ...refusal };
    }

    const units = unitsFor(option, party);
    const left = availableUnits(row);

    if (row.stopSell || left < units) {
        return { available: false, reason: 'SOLD_OUT', availableUnits: row.stopSell ? 0 : left };
    }

    const season = resolveSeason(option.seasons, date);
    const tier = resolveTier(season, party.pax);
    const quote = quoteTour({ option, tier, party, markupBps, currency: tour.currency });

    if (!quote) {
        return { available: false, reason: 'UNPRICED' };
    }

    const schedule = buildCancellationSchedule({
        rules: option.cancellationPolicy?.rules ?? [],
        checkInDate: date,
        checkInTime: departureTime ?? '09:00',
        timezone: tour.timezone,
        // One "night": a tour is charged whole, so the tiers are proportions
        // of the total rather than of a nightly rate.
        nightlyCents: [quote.totals.sellCents],
        currency: quote.currency
    });

    return {
        available: true,
        tour,
        option,
        date,
        departureTime,
        startAt: departureInstant(date, departureTime, tour.timezone),
        endDate: addDays(date, Math.max(0, (tour.durationDays ?? 1) - 1)),
        units,
        party,
        availableUnits: left,
        season,
        tier,
        quote,
        schedule,
        token: issueTourOfferToken({
            tourId: tour.id,
            tourOptionId: option.id,
            date,
            // The party as it was asked for, so the token re-categorises the
            // same ages against the same bands.
            adults,
            childAges,
            quotedSellCents: quote.totals.totalCents,
            currency: quote.currency
        })
    };
};

const windowFor = ({ date, from, to }) => {
    if (date) {
        return { from: date, to: date };
    }

    if (!from || !to) {
        throw new BadRequestError('Give a date, or a from and to window');
    }

    if (to < from) {
        throw new BadRequestError('The window ends before it begins', { from, to });
    }

    if (nightsBetween(from, to) + 1 > MAX_WINDOW_DAYS) {
        throw new BadRequestError(`A window may cover at most ${MAX_WINDOW_DAYS} days`, { limit: MAX_WINDOW_DAYS });
    }

    return { from, to };
};

/**
 * Every option of one tour, priced for every departure in the window.
 *
 * A date with no inventory row is simply absent; a date that exists but cannot
 * be sold is returned with `available: false` and the reason, because a
 * calendar that shows a sold-out Saturday is more useful than one with a gap.
 */
export const tourAvailability = async (slugOrId, criteria, viewer) => {
    const { adults, childAges = [], locale } = criteria;
    const { from, to } = windowFor(criteria);
    const trade = isTrade(viewer);

    const tour = await findTourOr404(slugOrId, {
        locale,
        statuses: ['ACTIVE'],
        b2cOnly: !trade,
        includePartnerOnly: trade,
        access: accessWhere(viewer, 'TOUR')
    });

    const options = tour.options.filter((option) => option.status === 'ACTIVE');
    const party = partyFor(tour, adults, childAges);
    const inventory = await readTourInventoryMap(
        options.map((option) => option.id),
        from,
        to
    );
    const { markupBps } = await resolveMarkup({
        partner: viewer?.partner ?? (viewer?.partnerId ? { id: viewer.partnerId } : null),
        destinationId: tour.destinationId,
        timezone: tour.timezone,
        date: from
    });

    const now = new Date();
    const dates = eachDate(from, to);

    return {
        tour,
        party,
        window: { from, to },
        options: options.map((option) => ({
            option,
            dates: dates
                .map((date) =>
                    buildTourOffer({
                        tour,
                        option,
                        date,
                        row: inventory.get(`${option.id}:${date}`) ?? null,
                        party,
                        adults,
                        childAges,
                        markupBps,
                        now
                    })
                )
                .map((offer, index) => (offer ? { date: dates[index], ...offer } : null))
                .filter(Boolean)
        }))
    };
};

/**
 * Tours with at least one bookable offer on a date, cheapest first.
 *
 * Two stages, and the split is what keeps a growing catalogue from costing a
 * growing search. `findTourCandidates` decides in one query which departures
 * can be sold and what each costs; only the tours that reach the page are then
 * hydrated and priced exactly.
 *
 * The previous shape read the first five hundred tours whole — galleries,
 * translations, every option with every season and every tier — priced all of
 * them and showed twenty-four. It also stopped at five hundred, so a larger
 * catalogue had a tail no dated search could reach.
 */
export const searchTours = async (criteria, viewer) => {
    const { date, adults, childAges = [], locale, page, pageSize } = criteria;
    const trade = isTrade(viewer);

    // Undated browse is catalogue work, not availability work: there is nothing
    // to price, so the database paginates it.
    if (!date) {
        const { tours, ...paging } = await listTours({
            ...criteria,
            status: ['ACTIVE'],
            b2cOnly: !trade,
            access: accessWhere(viewer, 'TOUR'),
            locale,
            page,
            pageSize
        });

        return { results: tours.map((tour) => ({ tour, cheapest: null })), ...paging };
    }

    // Resolved before the candidate query rather than after it, because the
    // query prices with it. One resolution for the whole page: the rules that
    // matter are the buyer's.
    const { markupBps } = await resolveMarkup({
        partner: viewer?.partner ?? (viewer?.partnerId ? { id: viewer.partnerId } : null),
        date
    });

    const candidates = await findTourCandidates({
        ...criteria,
        date,
        adults,
        childAges,
        markupBps,
        b2cOnly: !trade,
        includePartnerOnly: trade,
        tourIds: restrictIds(null, viewer, 'TOUR'),
        excludeTourIds: deniedIds(viewer, 'TOUR')
    });

    const now = new Date();

    /*
     * Notice, horizon and past-date, applied here rather than in SQL: they are
     * measured from the current instant in the tour's own zone, which is
     * resolver work. `dateRefusal` is cheap on a row of ids, and a departure
     * that cannot be sold must fall out *before* the page is cut — otherwise a
     * tour nobody can book still occupies a card.
     */
    const sellable = candidates.filter(
        (candidate) =>
            !dateRefusal({
                date,
                departureTime: candidate.departureTime ?? candidate.startTime,
                option: { noticeHours: candidate.noticeHours, horizonDays: candidate.horizonDays },
                tour: { timezone: candidate.timezone },
                now
            })
    );

    // The cheapest departure per tour decides where the tour sits; the option
    // that won is the only one worth hydrating for its card.
    const cheapestByTour = new Map();

    for (const candidate of sellable) {
        const best = cheapestByTour.get(candidate.tourId);

        if (!best || candidate.sellTotalCents < best.sellTotalCents) {
            cheapestByTour.set(candidate.tourId, candidate);
        }
    }

    /*
     * A total order, not merely a cheap-first one. Ties on price are the normal
     * case rather than the exotic one — a catalogue prices many day trips
     * identically — and an order that leaves them unspecified makes page
     * boundaries arbitrary: the same tour can appear on page one and page two
     * of the same search, and another can fall between the two and be seen on
     * neither. Price, then the catalogue's own order, then the id so that no
     * two rows can ever compare equal.
     */
    const byPrice = (a, b) =>
        a.sellTotalCents - b.sellTotalCents ||
        Number(b.featured) - Number(a.featured) ||
        a.title.localeCompare(b.title) ||
        a.tourId.localeCompare(b.tourId);

    const ordered = [...cheapestByTour.values()].sort(byPrice);
    const total = ordered.length;
    const pageCandidates = ordered.slice((page - 1) * pageSize, page * pageSize);

    if (pageCandidates.length === 0) {
        return { results: [], total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
    }

    const [tours, options, inventory] = await Promise.all([
        prisma.tour.findMany({
            where: { id: { in: pageCandidates.map((candidate) => candidate.tourId) } },
            include: summaryInclude(locale)
        }),
        prisma.tourOption.findMany({
            where: { id: { in: pageCandidates.map((candidate) => candidate.tourOptionId) } },
            include: optionInclude
        }),
        readTourInventoryMap(
            pageCandidates.map((candidate) => candidate.tourOptionId),
            date,
            date
        )
    ]);

    const toursById = new Map(tours.map((tour) => [tour.id, tour]));
    const optionsById = new Map(options.map((option) => [option.id, option]));
    const results = [];

    /*
     * Priced again, in full, from the same `buildTourOffer` the calendar and
     * the tour page use. The query ranked these rows on the identical
     * arithmetic, so this is not expected to change an order — it is what
     * produces the quote, the cancellation schedule and the signed token, none
     * of which belong in SQL.
     */
    for (const candidate of pageCandidates) {
        const tour = toursById.get(candidate.tourId);
        const option = optionsById.get(candidate.tourOptionId);

        if (!tour || !option) {
            continue;
        }

        const offer = buildTourOffer({
            tour,
            option,
            date,
            row: inventory.get(`${option.id}:${date}`) ?? null,
            party: partyFor(tour, adults, childAges),
            adults,
            childAges,
            markupBps,
            now
        });

        if (offer?.available) {
            results.push({ tour, cheapest: offer });
        }
    }

    // The page keeps the order the candidate rows were cut on. Re-sorting it on
    // price alone would scramble exactly the ties the ordering above settled.
    results.sort(
        (a, b) =>
            a.cheapest.quote.totals.totalCents - b.cheapest.quote.totals.totalCents ||
            Number(b.tour.featured) - Number(a.tour.featured) ||
            a.tour.title.localeCompare(b.tour.title) ||
            a.tour.id.localeCompare(b.tour.id)
    );

    return {
        results,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
};

/**
 * Re-prices an offer against live data.
 *
 * The token names the tour, the option, the date and the party; nothing else
 * is believed. `requireAvailability` is false when a hold is being confirmed —
 * the hold already owns the seats, so the counter would report the stock it
 * is itself holding.
 */
export const revalidateTourOffer = async (offer, viewer, { strict = true, requireAvailability = true } = {}) => {
    // The token proves the offer was quoted, not that it was quoted for this
    // caller: a partner's token for a trade-only tour or a PARTNER_ONLY option
    // must not become a public booking in someone else's hands. The channel is
    // checked here as availability checked it when the token was issued.
    const trade = isTrade(viewer);
    const tour = await prisma.tour.findFirst({
        where: { id: offer.tourId, status: 'ACTIVE', ...(trade ? {} : { b2cEnabled: true }), ...accessWhere(viewer, 'TOUR') },
        include: {
            destination: true,
            supplier: { select: { id: true, reference: true, name: true } },
            meetingPointRef: { select: { id: true, slug: true, name: true, kind: true } },
            itinerary: { orderBy: { day: 'asc' } },
            options: { where: { id: offer.tourOptionId }, include: optionInclude }
        }
    });

    if (!tour) {
        throw new NotFoundError('That tour is no longer available');
    }

    const option = tour.options[0];

    if (!option || option.status !== 'ACTIVE' || (!trade && option.visibility !== 'PUBLIC')) {
        throw new ConflictError('That option is no longer available', { reason: 'UNAVAILABLE' });
    }

    const party = partyFor(tour, offer.adults, offer.childAges ?? []);

    if (!fitsOption(option, party)) {
        throw new UnprocessableEntityError('That option is not offered for a party this size', {
            reason: 'PARTY_SIZE',
            minPax: option.minPax,
            maxPax: option.maxPax
        });
    }

    const row = await prisma.tourInventory.findUnique({
        where: { tourOptionId_date: { tourOptionId: option.id, date: dateOnlyToUtc(offer.date) } }
    });

    if (!row) {
        throw new ConflictError('That departure is no longer available', { reason: 'UNAVAILABLE' });
    }

    const departureTime = row.departureTime ?? option.startTime ?? null;
    const refusal = dateRefusal({ date: offer.date, departureTime, option, tour });

    if (refusal) {
        throw new UnprocessableEntityError('That departure can no longer be booked', refusal);
    }

    const units = unitsFor(option, party);

    if (requireAvailability && (row.stopSell || availableUnits(row) < units)) {
        throw new ConflictError('That departure is no longer available', {
            reason: 'UNAVAILABLE',
            availableUnits: row.stopSell ? 0 : availableUnits(row)
        });
    }

    const { markupBps } = await resolveMarkup({
        partner: viewer?.partner ?? (viewer?.partnerId ? { id: viewer.partnerId } : null),
        destinationId: tour.destinationId,
        timezone: tour.timezone,
        date: offer.date
    });

    const season = resolveSeason(option.seasons, offer.date);
    const tier = resolveTier(season, party.pax);
    const quote = quoteTour({ option, tier, party, markupBps, currency: tour.currency });

    if (!quote) {
        throw new ConflictError('That departure is no longer priced', { reason: 'UNAVAILABLE' });
    }

    const schedule = buildCancellationSchedule({
        rules: option.cancellationPolicy?.rules ?? [],
        checkInDate: offer.date,
        checkInTime: departureTime ?? '09:00',
        timezone: tour.timezone,
        nightlyCents: [quote.totals.sellCents],
        currency: quote.currency,
        bookedAt: new Date()
    });

    const currentCents = quote.totals.totalCents;

    if (strict && currentCents !== offer.quotedSellCents) {
        throw new ConflictError('The price for this tour has changed', {
            reason: 'PRICE_CHANGED',
            quotedCents: offer.quotedSellCents,
            currentCents,
            currency: quote.currency
        });
    }

    return {
        tour,
        option,
        date: offer.date,
        departureTime,
        startAt: departureInstant(offer.date, departureTime, tour.timezone),
        endDate: addDays(offer.date, Math.max(0, (tour.durationDays ?? 1) - 1)),
        party,
        units,
        inventory: row,
        availableUnits: availableUnits(row),
        quote,
        schedule,
        priceChanged: currentCents !== offer.quotedSellCents
    };
};

export { toDateOnly };
