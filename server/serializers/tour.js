import { toDateOnly } from '../lib/time.js';
import { canViewMargin, canViewNetRates, isStaff } from '../middleware/auth.js';
import { localise } from './localise.js';
import { toImageAsset } from './media.js';
import { toCancellationPolicy } from './ratePlan.js';
import { freeCancellationUntil } from '../services/hotel/policy.service.js';
import { TOUR_TRANSLATABLE_FIELDS } from '../services/tour/tour.service.js';

/**
 * Tour responses.
 *
 * Allow-list only, as everywhere: built by listing what goes out. Anything on
 * the supplier side of the money — net prices on a season, net lines on a
 * quote — is absent rather than null for a viewer without permission, and
 * permission means an admin or the operator that runs this tour.
 */

const money = (amountCents, currency) =>
    amountCents === null || amountCents === undefined ? null : { amountCents, currency };

const coverOf = (tour) => {
    const cover = (tour.images ?? []).find((image) => image.isCover) ?? (tour.images ?? [])[0];

    return cover ? toImageAsset(cover.fileAsset) : null;
};

const destinationOf = (destination, locale) => {
    if (!destination) {
        return null;
    }

    const localised = localise(destination, destination.translations, locale, ['name']);

    return {
        id: destination.id,
        slug: destination.slug,
        name: localised.name,
        type: destination.type,
        path: destination.path
    };
};

export const toTourImage = (image) => ({
    ...toImageAsset(image.fileAsset),
    tourImageId: image.id,
    caption: image.caption ?? null,
    sortOrder: image.sortOrder,
    isCover: image.isCover
});

export const toItineraryDay = (day) => ({
    day: day.day,
    title: day.title,
    description: day.description,
    meals: day.meals ?? [],
    accommodation: day.accommodation || null
});

export const toTourSummary = (tour, locale, viewer) => {
    const text = localise(tour, tour.translations, locale, TOUR_TRANSLATABLE_FIELDS);

    const summary = {
        id: tour.id,
        slug: tour.slug,
        title: text.title,
        location: text.location,
        category: tour.category,
        difficulty: tour.difficulty,
        durationDays: tour.durationDays,
        durationLabel: text.durationLabel,
        groupSize: text.groupSize,
        summary: text.summary,
        image: tour.image || null,
        coverImage: coverOf(tour),
        // Indicative and un-dated. Only availability quotes something bookable.
        priceFrom: tour.priceFromCents > 0 ? money(tour.priceFromCents, tour.currency) : null,
        currency: tour.currency,
        timezone: tour.timezone,
        rating: tour.rating,
        reviewCount: tour.reviewCount,
        featured: tour.featured,
        // Public so the client's sitemap can carry a real `lastModified` per
        // URL rather than a hand-set date that goes stale in a week.
        updatedAt: tour.updatedAt,
        destination: destinationOf(tour.destination, locale)
    };

    // Lifecycle, channel and operator belong to the back office, never to the
    // shop window — even for a partner.
    if (isStaff(viewer)) {
        summary.status = tour.status;
        summary.b2cEnabled = tour.b2cEnabled;
        summary.supplier = tour.supplier ?? null;
        summary.supplierId = tour.supplierId ?? null;
    }

    return summary;
};

export const toTourSeason = (season, viewer, tour) => ({
    id: season.id,
    name: season.name,
    validFrom: toDateOnly(season.validFrom),
    validUntil: toDateOnly(season.validUntil),
    weekdays: season.weekdays ?? [],
    priority: season.priority,
    currency: season.currency,
    isActive: season.isActive,
    tiers: (season.tiers ?? []).map((tier) => ({
        id: tier.id,
        minPax: tier.minPax,
        maxPax: tier.maxPax ?? null,
        adultSellCents: tier.adultSellCents ?? null,
        childSellCents: tier.childSellCents ?? null,
        groupSellCents: tier.groupSellCents ?? null,
        ...(canViewNetRates(viewer, tour)
            ? {
                  adultNetCents: tier.adultNetCents ?? null,
                  childNetCents: tier.childNetCents ?? null,
                  infantNetCents: tier.infantNetCents,
                  groupNetCents: tier.groupNetCents ?? null
              }
            : {})
    }))
});

/**
 * An option. The price sheets are part of it only for whoever may see the
 * supplier side; everyone else gets prices through availability, where they
 * are quoted for a date and a party.
 */
export const toTourOption = (option, viewer, tour) => ({
    id: option.id,
    code: option.code,
    name: option.name,
    status: option.status,
    kind: option.kind,
    pricingBasis: option.pricingBasis,
    unitKind: option.unitKind,
    scheduleKind: option.scheduleKind,
    confirmationMode: option.confirmationMode,
    visibility: option.visibility,
    minPax: option.minPax,
    maxPax: option.maxPax,
    startTime: option.startTime ?? null,
    durationMinutes: option.durationMinutes ?? null,
    languages: option.languages ?? [],
    operatesOnWeekdays: option.operatesOnWeekdays ?? [],
    noticeHours: option.noticeHours,
    horizonDays: option.horizonDays,
    sortOrder: option.sortOrder,
    cancellation: toCancellationPolicy(option.cancellationPolicy),
    ...(canViewNetRates(viewer, tour)
        ? { seasons: (option.seasons ?? []).map((season) => toTourSeason(season, viewer, tour)) }
        : {})
});

export const toTourDetail = (tour, locale, viewer) => {
    const text = localise(tour, tour.translations, locale, TOUR_TRANSLATABLE_FIELDS);

    return {
        ...toTourSummary(tour, locale, viewer),
        description: text.description ?? [],
        highlights: text.highlights ?? [],
        included: text.included ?? [],
        excluded: text.excluded ?? [],
        importantInfo: text.importantInfo ?? [],
        meetingPoint: text.meetingPoint,
        meetingTime: tour.meetingTime ?? null,
        meetingPointRef: tour.meetingPointRef
            ? {
                  id: tour.meetingPointRef.id,
                  slug: tour.meetingPointRef.slug,
                  name: tour.meetingPointRef.name,
                  kind: tour.meetingPointRef.kind
              }
            : null,
        minAge: tour.minAge ?? null,
        ages: { infantMaxAge: tour.infantMaxAge, childMaxAge: tour.childMaxAge },
        gallery: tour.gallery ?? [],
        itinerary: (tour.itinerary ?? []).map(toItineraryDay),
        images: (tour.images ?? []).map(toTourImage),
        options: (tour.options ?? []).map((option) => toTourOption(option, viewer, tour)),
        createdAt: tour.createdAt,
        updatedAt: tour.updatedAt
    };
};

export const toTourTranslation = (translation) => ({
    locale: translation.locale,
    title: translation.title ?? null,
    location: translation.location ?? null,
    summary: translation.summary ?? null,
    description: translation.description ?? [],
    highlights: translation.highlights ?? [],
    included: translation.included ?? [],
    excluded: translation.excluded ?? [],
    importantInfo: translation.importantInfo ?? [],
    meetingPoint: translation.meetingPoint ?? null,
    durationLabel: translation.durationLabel ?? null,
    groupSize: translation.groupSize ?? null
});

/** The admin calendar: one row per departure. `availableUnits` is derived, never stored. */
export const toTourCalendar = ({ option, inventory }) => ({
    option: { id: option.id, code: option.code, name: option.name, unitKind: option.unitKind },
    departures: inventory.map((row) => ({
        date: toDateOnly(row.date),
        totalUnits: row.totalUnits,
        blockedUnits: row.blockedUnits,
        bookedUnits: row.bookedUnits,
        heldUnits: row.heldUnits,
        availableUnits: Math.max(0, row.totalUnits - row.blockedUnits - row.bookedUnits - row.heldUnits),
        stopSell: row.stopSell,
        departureTime: row.departureTime ?? null,
        note: row.note ?? null
    }))
});

/** A quote for one departure. Net lines and margin only for whoever may see them. */
export const toTourQuote = (quote, viewer, tour) => {
    const net = canViewNetRates(viewer, tour);

    return {
        currency: quote.currency,
        pricingBasis: quote.pricingBasis,
        party: quote.party,
        units: quote.units,
        lines: quote.lines.map((line) => ({
            travellerType: line.travellerType,
            count: line.count,
            unitSellCents: line.unitSellCents,
            sellCents: line.sellCents,
            ...(net ? { unitNetCents: line.unitNetCents, netCents: line.netCents } : {})
        })),
        totals: {
            totalCents: quote.totals.totalCents,
            ...(net ? { netCents: quote.totals.netCents } : {}),
            ...(canViewMargin(viewer) ? { markupBps: quote.totals.markupBps, marginCents: quote.totals.marginCents } : {})
        }
    };
};

/**
 * One departure as it can (or cannot) be sold to this party. An unavailable
 * date keeps its reason so a calendar can say "sold out" rather than vanish.
 */
export const toTourOffer = (offer, viewer) => {
    if (!offer.available) {
        const { available, date, reason, ...detail } = offer;

        return { available: false, date, reason, ...detail };
    }

    return {
        available: true,
        date: offer.date,
        departureTime: offer.departureTime ?? null,
        startAt: offer.startAt,
        endDate: offer.endDate,
        availableUnits: offer.availableUnits,
        units: offer.units,
        token: offer.token,
        quote: toTourQuote(offer.quote, viewer, offer.tour),
        cancellation: {
            freeUntil: freeCancellationUntil(offer.schedule),
            windows: (offer.schedule?.windows ?? []).map((window) => ({
                fromAt: window.fromAt,
                toAt: window.toAt,
                chargeCents: window.chargeCents
            }))
        },
        ...(offer.priceChanged === undefined ? {} : { priceChanged: offer.priceChanged })
    };
};

export const toTourAvailability = ({ tour, party, window, options }, locale, viewer) => ({
    tour: toTourSummary(tour, locale, viewer),
    party: { adults: party.adults, children: party.children.length, infants: party.infants.length, pax: party.pax },
    window,
    options: options.map(({ option, dates }) => ({
        option: toTourOption(option, viewer, tour),
        dates: dates.map((offer) => toTourOffer(offer, viewer))
    }))
});

/** A dated search card: the tour plus its cheapest bookable departure that day. */
export const toTourSearchResult = ({ tour, cheapest }, locale, viewer) => ({
    ...toTourSummary(tour, locale, viewer),
    cheapestOffer: cheapest
        ? {
              ...toTourOffer(cheapest, viewer),
              option: { id: cheapest.option.id, code: cheapest.option.code, name: cheapest.option.name, kind: cheapest.option.kind }
          }
        : null
});
