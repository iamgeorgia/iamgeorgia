import { toDateOnly } from '../lib/time.js';
import { canViewMargin, isStaff } from '../middleware/auth.js';
import { localise } from './localise.js';
import { toImageAsset } from './media.js';
import { PACKAGE_TRANSLATABLE_FIELDS } from '../services/package/package.service.js';
import { toOffer, toPoint } from './transfer.js';
import { toTourSearchResult } from './tour.js';

/**
 * Package responses.
 *
 * The order-level net and margin are admin-only. A partner who supplies one
 * hotel inside a package sees its own hotel's net through the child booking
 * serializer once the order exists, and nothing else — a package quote is
 * the platform's price, not any one supplier's.
 */

const money = (amountCents, currency) => (amountCents === null || amountCents === undefined ? null : { amountCents, currency });

const coverOf = (pkg) => {
    const cover = (pkg.images ?? []).find((image) => image.isCover) ?? (pkg.images ?? [])[0];

    return cover ? toImageAsset(cover.fileAsset) : null;
};

const destinationOf = (destination, locale) => {
    if (!destination) return null;

    const text = localise(destination, destination.translations, locale, ['name']);

    return { id: destination.id, slug: destination.slug, name: text.name, type: destination.type, path: destination.path };
};

const dateOrNull = (value) => (value ? toDateOnly(value) : null);

export const toPackageImage = (image) => ({
    ...toImageAsset(image.fileAsset),
    packageImageId: image.id,
    caption: image.caption ?? null,
    sortOrder: image.sortOrder,
    isCover: image.isCover
});

/** The public face of the kosher profile: what the package promises. */
export const toKosherProfile = (profile) =>
    profile
        ? {
              minServiceLevel: profile.minServiceLevel,
              certifiedRequired: profile.certifiedRequired,
              certificationScopes: profile.certificationScopes,
              requireCertValidThroughStay: profile.requireCertValidThroughStay,
              requiredMealPlanCodes: profile.requiredMealPlanCodes,
              hotelRequestCodes: profile.hotelRequestCodes,
              shabbatMode: profile.shabbatMode,
              shabbatFixedStart: profile.shabbatFixedStart ?? null,
              shabbatFixedEnd: profile.shabbatFixedEnd ?? null,
              candleLightingOffsetMin: profile.candleLightingOffsetMin,
              havdalahOffsetMin: profile.havdalahOffsetMin,
              noTransfersInShabbat: profile.noTransfersInShabbat,
              noToursOnShabbat: profile.noToursOnShabbat,
              extraRestDays: profile.extraRestDays ?? [],
              supervisionAuthority: profile.supervisionAuthority ?? null,
              notes: profile.notes ?? null
          }
        : null;

export const toTourKosherProfile = (profile) =>
    profile
        ? { kosherMealsAvailable: profile.kosherMealsAvailable, operatesOnShabbat: profile.operatesOnShabbat, notes: profile.notes ?? null }
        : null;

export const toPackageSummary = (pkg, locale, viewer) => {
    const text = localise(pkg, pkg.translations, locale, PACKAGE_TRANSLATABLE_FIELDS);

    const summary = {
        id: pkg.id,
        slug: pkg.slug,
        name: text.name,
        summary: text.summary,
        nights: pkg.nights,
        currency: pkg.currency,
        timezone: pkg.timezone,
        image: pkg.image || null,
        coverImage: coverOf(pkg),
        featured: pkg.featured,
        kosher: pkg.kosher ? { minServiceLevel: pkg.kosher.minServiceLevel, certifiedRequired: pkg.kosher.certifiedRequired } : null,
        // Indicative and un-dated: a cached cheapest sample, never a quote.
        priceFrom: pkg.priceFromCents > 0 ? money(pkg.priceFromCents, pkg.currency) : null,
        party: { minAdults: pkg.minAdults, maxAdults: pkg.maxAdults, maxChildren: pkg.maxChildren, maxPax: pkg.maxPax },
        validFrom: dateOrNull(pkg.validFrom),
        validUntil: dateOrNull(pkg.validUntil),
        componentCount: pkg._count?.components ?? (pkg.components ?? []).length,
        destination: destinationOf(pkg.destination, locale),
        updatedAt: pkg.updatedAt
    };

    if (isStaff(viewer)) {
        summary.status = pkg.status;
        summary.b2cEnabled = pkg.b2cEnabled;
        summary.sortOrder = pkg.sortOrder;
        summary.sellableFrom = dateOrNull(pkg.sellableFrom);
        summary.sellableUntil = dateOrNull(pkg.sellableUntil);
        summary.adjustment = { kind: pkg.adjustmentKind, value: pkg.adjustmentValue, appliesTo: pkg.adjustmentAppliesTo };
        summary.kosherOverrideUntil = dateOrNull(pkg.kosherOverrideUntil);
    }

    return summary;
};

/** A slot as the template describes it, with the fixed products named. */
export const toPackageComponent = (component, viewer) => ({
    slotIndex: component.slotIndex,
    componentType: component.componentType,
    label: component.label,
    required: component.required,
    dayOffset: component.dayOffset,
    nights: component.nights ?? null,
    timeOfDay: component.timeOfDay ?? null,
    quantityRule: component.quantityRule,
    hotel: component.hotel ? { id: component.hotel.id, slug: component.hotel.slug, name: component.hotel.name } : null,
    allowedRoomTypeIds: component.allowedRoomTypeIds,
    allowedRatePlanIds: component.allowedRatePlanIds,
    allowedMealPlanCodes: component.allowedMealPlanCodes,
    fromPoint: component.fromPoint ? { id: component.fromPoint.id, slug: component.fromPoint.slug, name: component.fromPoint.name } : null,
    toPoint: component.toPoint ? { id: component.toPoint.id, slug: component.toPoint.slug, name: component.toPoint.name } : null,
    route: component.route ? { id: component.route.id, slug: component.route.slug, title: component.route.title } : null,
    allowedVehicleClasses: component.allowedVehicleClasses,
    tripType: component.tripType ?? null,
    tour: component.tour ? { id: component.tour.id, slug: component.tour.slug, title: component.tour.title, kosher: toTourKosherProfile(component.tour.kosher) } : null,
    allowedTourOptionIds: component.allowedTourOptionIds,
    service: component.service ? { id: component.service.id, slug: component.service.slug, name: component.service.name, basis: component.service.basis, confirmationMode: component.service.confirmationMode } : null,
    kosher:
        component.kosherMinServiceLevel || component.kosherCertifiedRequired !== null || component.kosherCertificationScopes.length > 0
            ? {
                  minServiceLevel: component.kosherMinServiceLevel ?? null,
                  certifiedRequired: component.kosherCertifiedRequired ?? null,
                  certificationScopes: component.kosherCertificationScopes
              }
            : null,
    ...(isStaff(viewer) ? { constraints: component.constraints ?? {} } : {})
});

export const toPackageDetail = (pkg, locale, viewer) => {
    const text = localise(pkg, pkg.translations, locale, PACKAGE_TRANSLATABLE_FIELDS);

    return {
        ...toPackageSummary(pkg, locale, viewer),
        description: text.description ?? [],
        gallery: pkg.gallery ?? [],
        images: (pkg.images ?? []).map(toPackageImage),
        components: (pkg.components ?? []).map((component) => toPackageComponent(component, viewer)),
        kosherProfile: toKosherProfile(pkg.kosher),
        createdAt: pkg.createdAt,
        updatedAt: pkg.updatedAt
    };
};

export const toPackageTranslation = (translation) => ({
    locale: translation.locale,
    name: translation.name ?? null,
    summary: translation.summary ?? null,
    description: translation.description ?? []
});

// --- quotes ------------------------------------------------------------------

const toResolved = (resolved, net) => {
    if (!resolved) return null;

    const base = {
        sellCents: resolved.sellCents,
        ...(net ? { netCents: resolved.netCents } : {})
    };

    switch (resolved.componentType) {
        case 'HOTEL_STAY':
            return {
                ...base,
                hotel: resolved.hotelSummary,
                roomType: resolved.roomType,
                ratePlan: resolved.ratePlan,
                checkIn: resolved.checkIn,
                checkOut: resolved.checkOut,
                nights: resolved.nights,
                rooms: resolved.rooms,
                payableAtPropertyCents: resolved.payableAtPropertyCents,
                freeCancellationUntil: resolved.offer?.freeCancellationUntil ?? null,
                token: resolved.token
            };
        case 'TRANSFER':
            return {
                ...base,
                vehicle: resolved.vehicle,
                from: resolved.from,
                to: resolved.to,
                tripType: resolved.tripType,
                legs: resolved.legs,
                token: resolved.token
            };
        case 'TOUR':
            return {
                ...base,
                tour: resolved.tour,
                option: resolved.option,
                date: resolved.date,
                endDate: resolved.endDate,
                departureTime: resolved.departureTime,
                token: resolved.token
            };
        case 'SERVICE':
            return {
                ...base,
                service: resolved.service,
                date: resolved.date,
                endDate: resolved.endDate,
                quantity: resolved.quantity,
                pax: resolved.pax,
                days: resolved.days
            };
        default:
            return base;
    }
};

export const toPackageQuote = (quote, locale, viewer) => {
    const net = canViewMargin(viewer);

    return {
        package: toPackageSummary(quote.package, locale, viewer),
        startDate: quote.startDate,
        endDate: quote.endDate,
        party: quote.party,
        rooms: quote.rooms,
        currency: quote.currency,
        available: quote.available,
        unavailableReason: quote.unavailableReason,
        components: quote.slots.map((slot) => ({
            slotIndex: slot.component.slotIndex,
            componentType: slot.component.componentType,
            label: slot.component.label,
            required: slot.component.required,
            included: slot.included,
            reason: slot.resolved ? null : slot.reason,
            resolved: toResolved(slot.resolved, net),
            adjustmentCents: slot.adjustmentCents ?? 0,
            lineTotalCents: slot.lineTotalCents ?? 0,
            alternatives: slot.alternatives ?? []
        })),
        adjustment: quote.adjustment,
        totals: {
            componentsSellCents: quote.totals.componentsSellCents,
            adjustmentCents: quote.totals.adjustmentCents,
            sellTotalCents: quote.totals.sellTotalCents,
            totalCents: quote.totals.totalCents,
            ...(net ? { componentsNetCents: quote.totals.componentsNetCents, marginCents: quote.totals.marginCents } : {})
        },
        kosher: quote.kosher
            ? { blockers: quote.kosher.blockers, warnings: quote.kosher.warnings, overridden: quote.kosher.overridden ?? false }
            : null,
        token: quote.token,
        ...(quote.priceChanged === undefined ? {} : { priceChanged: quote.priceChanged, quotedTotalCents: quote.quotedTotalCents })
    };
};

// --- recommendations -------------------------------------------------------------

const toRecommendedTransfer = (leg, viewer) =>
    leg
        ? {
              date: leg.date,
              from: toPoint(leg.from),
              to: toPoint(leg.to),
              offer: toOffer(leg.offer, viewer)
          }
        : null;

/** The "complete your trip" rail: each card carries enough to render and a way into its own product. */
export const toRecommendations = (recommendations, locale, viewer) => ({
    anchor: recommendations.anchor,
    stay: recommendations.stay,
    transfers: {
        arrival: toRecommendedTransfer(recommendations.transfers.arrival, viewer),
        departure: toRecommendedTransfer(recommendations.transfers.departure, viewer)
    },
    tours: recommendations.tours.map((result) => toTourSearchResult(result, locale, viewer)),
    packages: recommendations.packages.map(({ package: pkg, quote }) => ({
        ...toPackageSummary(pkg, locale, viewer),
        quote: {
            startDate: quote.startDate,
            endDate: quote.endDate,
            currency: quote.currency,
            totalCents: quote.totals.totalCents,
            adjustmentCents: quote.totals.adjustmentCents,
            ...(canViewMargin(viewer) ? { marginCents: quote.totals.marginCents } : {})
        }
    }))
});
