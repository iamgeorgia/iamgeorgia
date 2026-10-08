import { toDateOnly } from '../lib/time.js';
import { canViewBuyer, canViewMargin, canViewNetRates, isStaff } from '../middleware/auth.js';
import { localise } from './localise.js';
import { toCancellationPolicy } from './ratePlan.js';
import { freeCancellationUntil } from '../services/hotel/policy.service.js';
import { SERVICE_TRANSLATABLE_FIELDS } from '../services/service/service.service.js';
import { applyBps } from '../services/service/pricing.service.js';

/**
 * Service responses. Allow-list only; the supplier's net is absent for a
 * viewer who may not see it, which means an admin or the supplier itself —
 * `canViewNetRates` compares `supplierId` to the viewer's partner, and a
 * service carries one exactly as a hotel and a tour do.
 */

const destinationOf = (destination, locale) => {
    if (!destination) {
        return null;
    }

    const text = localise(destination, destination.translations, locale, ['name']);

    return { id: destination.id, slug: destination.slug, name: text.name, type: destination.type, path: destination.path };
};

/**
 * The indicative selling price of one unit for this viewer. A fixed sell
 * wins; otherwise the net marked up by the buyer's rate, which the route
 * resolves and passes in.
 */
const unitSellCents = (service, markupBps) =>
    service.sellCents ?? applyBps(service.netCents, 10_000 + (markupBps ?? 1500));

export const toServiceSummary = (service, locale, viewer, { markupBps } = {}) => {
    const text = localise(service, service.translations, locale, SERVICE_TRANSLATABLE_FIELDS);

    const summary = {
        id: service.id,
        slug: service.slug,
        name: text.name,
        category: service.category,
        basis: service.basis,
        summary: text.summary,
        isKosher: service.isKosher,
        kosherAuthority: service.kosherAuthority ?? null,
        confirmationMode: service.confirmationMode,
        noticeHours: service.noticeHours,
        minQuantity: service.minQuantity,
        maxQuantity: service.maxQuantity ?? null,
        currency: service.currency,
        unitPrice: { amountCents: unitSellCents(service, markupBps), currency: service.currency },
        destination: destinationOf(service.destination, locale)
    };

    if (canViewNetRates(viewer, service)) {
        summary.netCents = service.netCents;
        summary.sellCents = service.sellCents ?? null;
    }

    if (isStaff(viewer)) {
        summary.status = service.status;
        summary.b2cEnabled = service.b2cEnabled;
        summary.supplier = service.supplier ?? null;
        summary.supplierId = service.supplierId ?? null;
        summary.sortOrder = service.sortOrder;
    }

    return summary;
};

export const toServiceDetail = (service, locale, viewer, options = {}) => {
    const text = localise(service, service.translations, locale, SERVICE_TRANSLATABLE_FIELDS);

    return {
        ...toServiceSummary(service, locale, viewer, options),
        description: text.description ?? [],
        included: text.included ?? [],
        timezone: service.timezone,
        cancellation: toCancellationPolicy(service.cancellationPolicy),
        createdAt: service.createdAt,
        updatedAt: service.updatedAt
    };
};

export const toServiceTranslation = (translation) => ({
    locale: translation.locale,
    name: translation.name ?? null,
    summary: translation.summary ?? null,
    description: translation.description ?? [],
    included: translation.included ?? []
});

export const toServiceQuote = (quote, viewer, service) => {
    const net = canViewNetRates(viewer, service);

    return {
        currency: quote.currency,
        basis: quote.basis,
        quantity: quote.quantity,
        pax: quote.pax,
        days: quote.days,
        units: quote.units,
        unitSellCents: quote.unitSellCents,
        ...(net ? { unitNetCents: quote.unitNetCents } : {}),
        totals: {
            totalCents: quote.totals.totalCents,
            ...(net ? { netCents: quote.totals.netCents } : {}),
            ...(canViewMargin(viewer) ? { markupBps: quote.totals.markupBps, marginCents: quote.totals.marginCents } : {})
        }
    };
};

export const toServiceBookingSummary = (booking, viewer) => {
    const snapshot = booking.serviceSnapshot ?? {};

    const summary = {
        reference: booking.reference,
        status: booking.status,
        service: {
            id: snapshot.id ?? booking.serviceId,
            slug: snapshot.slug ?? booking.service?.slug ?? null,
            name: snapshot.name ?? booking.service?.name ?? null,
            category: snapshot.category ?? null
        },
        date: toDateOnly(booking.date),
        endDate: toDateOnly(booking.endDate),
        startAt: booking.startAt,
        quantity: booking.quantity,
        pax: booking.pax,
        days: booking.days,
        leadName: booking.leadName,
        currency: booking.currency,
        totalCents: booking.sellTotalCents,
        confirmationMode: booking.confirmationMode,
        requestDeadlineAt: booking.requestDeadlineAt ?? null,
        createdAt: booking.createdAt,
        confirmedAt: booking.confirmedAt ?? null,
        cancelledAt: booking.cancelledAt ?? null,
        declinedAt: booking.declinedAt ?? null
    };

    if (canViewNetRates(viewer, booking.service)) {
        summary.netTotalCents = booking.netTotalCents;
    }

    if (canViewMargin(viewer)) {
        summary.markupBps = booking.markupBps;
        summary.marginCents = booking.sellTotalCents - booking.netTotalCents;
    }

    if (canViewBuyer(viewer)) {
        summary.partner = booking.partner ?? null;
    } else if (canViewNetRates(viewer, booking.service)) {
        summary.bookedVia = booking.partnerId ? 'AGENCY' : 'DIRECT';
    }

    return summary;
};

export const toServiceBookingDetail = (booking, viewer) => ({
    ...toServiceBookingSummary(booking, viewer),
    serviceSnapshot: booking.serviceSnapshot,
    leadEmail: booking.leadEmail,
    leadPhone: booking.leadPhone ?? null,
    notes: booking.notes ?? null,
    cancellation: {
        freeUntil: freeCancellationUntil(booking.cancellationSchedule),
        windows: (booking.cancellationSchedule?.windows ?? []).map((window) => ({
            fromAt: window.fromAt,
            toAt: window.toAt,
            chargeCents: window.chargeCents
        })),
        cancelledAt: booking.cancelledAt ?? null,
        chargeCents: booking.cancellationChargeCents ?? null,
        reason: booking.cancellationReason ?? null
    },
    declineReason: booking.declineReason ?? null,
    source: booking.source
});

export const toServiceCancellationQuote = (quote) => ({
    chargeCents: quote.chargeCents,
    refundCents: quote.refundCents,
    currency: quote.currency,
    refundable: quote.refundCents > 0
});
