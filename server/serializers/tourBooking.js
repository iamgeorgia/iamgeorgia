import { toDateOnly } from '../lib/time.js';
import { approvalOf } from '../lib/booking/approval.js';
import { paymentBlock } from './booking.js';
import { toDesk } from '../lib/booking/desk.js';
import { canViewBuyer, canViewMargin, canViewNetRates } from '../middleware/auth.js';
import { freeCancellationUntil } from '../services/hotel/policy.service.js';

/**
 * Tour booking responses.
 *
 * Everything a traveller sees comes from the snapshot rather than the live
 * tour, and the net side is present only for an admin or the operator that
 * runs the tour — the booking's `tour` carries `supplierId` for exactly that
 * check.
 */

const toTraveller = (traveller, net) => ({
    id: traveller.id,
    type: traveller.type,
    title: traveller.title ?? null,
    firstName: traveller.firstName,
    lastName: traveller.lastName,
    age: traveller.age ?? null,
    isLead: traveller.isLead,
    unitSellCents: traveller.unitSellCents,
    ...(net ? { unitNetCents: traveller.unitNetCents } : {}),
    passportNumber: traveller.passportNumber ?? null,
    nationality: traveller.nationality ?? null,
    dietary: traveller.dietary ?? null
});

export const toTourBookingSummary = (booking, viewer) => {
    const snapshot = booking.tourSnapshot ?? {};

    const summary = {
        reference: booking.reference,
        status: booking.status,
        tour: {
            id: snapshot.id ?? booking.tourId,
            slug: snapshot.slug ?? booking.tour?.slug ?? null,
            title: snapshot.title ?? booking.tour?.title ?? null
        },
        option: snapshot.option
            ? { id: snapshot.option.id, code: snapshot.option.code, name: snapshot.option.name, kind: snapshot.option.kind }
            : null,
        date: toDateOnly(booking.date),
        endDate: toDateOnly(booking.endDate),
        startAt: booking.startAt,
        adults: booking.adults,
        childAges: booking.childAges ?? [],
        units: booking.units,
        travellerCount: (booking.travellers ?? []).length,
        leadTravellerName: booking.leadTravellerName,
        currency: booking.currency,
        totalCents: booking.sellTotalCents + (booking.priceAdjustmentCents ?? 0),
        confirmationMode: booking.confirmationMode,
        requestDeadlineAt: booking.requestDeadlineAt ?? null,
        createdAt: booking.createdAt,
        confirmedAt: booking.confirmedAt ?? null,
        cancelledAt: booking.cancelledAt ?? null,
        declinedAt: booking.declinedAt ?? null,
        approval: approvalOf(booking),
        payment: paymentBlock(booking)
    };

    if (canViewNetRates(viewer, booking.tour)) {
        summary.netTotalCents = booking.netTotalCents;
    }

    if (canViewMargin(viewer)) {
        summary.markupBps = booking.markupBps;
        summary.marginCents = booking.sellTotalCents - booking.netTotalCents;
    }

    if (canViewBuyer(viewer)) {
        summary.partner = booking.partner ?? null;
        summary.desk = toDesk(booking);
    } else if (canViewNetRates(viewer, booking.tour)) {
        summary.bookedVia = booking.partnerId ? 'AGENCY' : 'DIRECT';
    }

    return summary;
};

export const toTourBookingDetail = (booking, viewer) => {
    const net = canViewNetRates(viewer, booking.tour);

    return {
        ...toTourBookingSummary(booking, viewer),
        tourSnapshot: booking.tourSnapshot,
        leadTravellerEmail: booking.leadTravellerEmail,
        leadTravellerPhone: booking.leadTravellerPhone ?? null,
        specialRequests: booking.specialRequests ?? null,
        pickupNote: booking.pickupNote ?? null,
        priceLines: (booking.priceLines ?? []).map((line) => ({
            travellerType: line.travellerType,
            count: line.count,
            unitSellCents: line.unitSellCents,
            sellCents: line.sellCents,
            ...(net ? { unitNetCents: line.unitNetCents, netCents: line.netCents } : {})
        })),
        cancellation: {
            summary: booking.cancellationSummary ?? null,
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
        source: booking.source,
        travellers: (booking.travellers ?? []).map((traveller) => toTraveller(traveller, net))
    };
};

export const toTourHold = (hold, priced) => ({
    token: hold.token,
    expiresAt: hold.expiresAt,
    date: toDateOnly(hold.date),
    units: hold.quantity,
    adults: hold.adults,
    childAges: hold.childAges ?? [],
    currency: hold.currency,
    totalCents: hold.quotedSellCents,
    ...(priced
        ? {
              tour: { id: priced.tour.id, slug: priced.tour.slug, title: priced.tour.title },
              optionName: priced.option?.name ?? null,
              confirmationMode: priced.option?.confirmationMode ?? 'INSTANT'
          }
        : {})
});

export const toTourCancellationQuote = (quote) => ({
    chargeCents: quote.chargeCents,
    refundCents: quote.refundCents,
    currency: quote.currency,
    refundable: quote.refundCents > 0
});
