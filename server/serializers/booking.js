import { toDateOnly } from '../lib/time.js';
import { canViewBuyer, canViewMargin, canViewNetRates } from '../middleware/auth.js';
import { toBookingRequest } from './kosher.js';
import { freeCancellationUntil } from '../services/hotel/policy.service.js';
import { approvalOf } from '../lib/booking/approval.js';
import { receivableFor, toPaymentSummary } from '../lib/finance/paymentStatus.js';
import { toDesk } from '../lib/booking/desk.js';

/** Where the money stands, for whoever may read the booking: it is their own bill. */
export const paymentBlock = (booking) => {
    const { receivable, via } = receivableFor(booking);

    return toPaymentSummary(receivable, { via });
};

/**
 * Booking responses.
 *
 * Everything a guest sees comes from the snapshot rather than from the live
 * hotel record, which is the whole point of taking one: a voucher printed six
 * months after the hotel renamed the room still describes what was sold.
 *
 * Net figures go to admins and to the property's own supplier; markup,
 * margin and the buying agency to admins only.
 */

const toNight = (night, viewer, hotel) => ({
    date: toDateOnly(night.date),
    sellCents: night.sellCents,
    ...(canViewNetRates(viewer, hotel) ? { netCents: night.netCents } : {})
});

const toGuest = (guest) => ({
    type: guest.type,
    title: guest.title ?? null,
    firstName: guest.firstName,
    lastName: guest.lastName,
    age: guest.age ?? null,
    isLead: guest.isLead
});

export const toBookingRoom = (room, viewer, hotel) => ({
    id: room.id,
    status: room.status,
    // The names as they were sold, not as they are now.
    roomTypeName: room.roomTypeName,
    ratePlanName: room.ratePlanName,
    mealPlan: { code: room.mealPlanCode, name: room.mealPlanName },
    bedConfiguration: room.bedConfigurationText ?? null,
    adults: room.adults,
    childAges: room.childAges ?? [],
    cancellation: {
        summary: room.cancellationSummary ?? null,
        freeUntil: freeCancellationUntil(room.cancellationSchedule),
        // The frozen tiers, so a guest can see exactly what cancelling costs
        // and when that changes.
        windows: (room.cancellationSchedule?.windows ?? []).map((window) => ({
            fromAt: window.fromAt,
            toAt: window.toAt,
            chargeCents: window.chargeCents
        }))
    },
    sellSubtotalCents: room.sellSubtotalCents,
    ...(canViewNetRates(viewer, hotel)
        ? { netSubtotalCents: room.netSubtotalCents, roomTypeId: room.roomTypeId }
        : {}),
    nights: (room.nights ?? []).map((night) => toNight(night, viewer, hotel)),
    guests: (room.guests ?? []).map(toGuest)
});

export const toBookingSummary = (booking, viewer) => {
    const summary = {
        reference: booking.reference,
        status: booking.status,
        hotel: {
            id: booking.hotelSnapshot?.id ?? booking.hotelId,
            name: booking.hotelSnapshot?.name ?? booking.hotel?.name,
            slug: booking.hotelSnapshot?.slug ?? booking.hotel?.slug
        },
        checkIn: toDateOnly(booking.checkIn),
        checkOut: toDateOnly(booking.checkOut),
        nights: booking.nights,
        rooms: booking.rooms?.length ?? 0,
        leadGuestName: booking.leadGuestName,
        currency: booking.currency,
        // What the guest pays: the rooms plus the tax already included in the
        // rate — the figure checkout quoted, the hold froze and the voucher
        // prints. `sellTotalCents` alone is the room price before that tax,
        // and a booking page showing it read short of what was charged.
        totalCents: booking.sellTotalCents + (booking.taxTotalCents ?? 0) + (booking.priceAdjustmentCents ?? 0),
        payableAtPropertyCents: booking.payableAtPropertyCents,
        createdAt: booking.createdAt,
        confirmedAt: booking.confirmedAt ?? null,
        cancelledAt: booking.cancelledAt ?? null,
        completedAt: booking.completedAt ?? null,
        // The platform's yes (OD1), or null for a booking that never waited for one.
        approval: approvalOf(booking),
        payment: paymentBlock(booking),
        // A count, not the rows: a register needs to show which reservations
        // are still waiting on the property without a detail page's worth of
        // data per line. Zero when the booking carries no requirements at all,
        // which is every booking made before this existed.
        requestsPending: (booking.requests ?? []).filter(
            (request) => request.status === 'REQUESTED'
        ).length
    };

    // The hotel record carries `supplierId`, so the property's own owner sees
    // the cost side of its own reservations: its net, never our markup on it
    // or the agency that bought it.
    if (canViewNetRates(viewer, booking.hotel)) {
        summary.netTotalCents = booking.netTotalCents;
    }

    if (canViewMargin(viewer)) {
        summary.markupBps = booking.markupBps;
        summary.marginCents = booking.sellTotalCents - booking.netTotalCents;
    }

    if (canViewBuyer(viewer)) {
        summary.partner = booking.partner ?? null;
        summary.desk = toDesk(booking);
    } else if (canViewNetRates(viewer, booking.hotel)) {
        summary.bookedVia = booking.partnerId ? 'AGENCY' : 'DIRECT';
    }

    return summary;
};

export const toBookingDetail = (booking, viewer) => ({
    ...toBookingSummary(booking, viewer),
    // The property as it was at the moment of booking. A voucher reads this.
    hotelSnapshot: booking.hotelSnapshot,
    leadGuestEmail: booking.leadGuestEmail,
    leadGuestPhone: booking.leadGuestPhone ?? null,
    specialRequests: booking.specialRequests ?? null,
    taxIncludedCents: booking.taxTotalCents,
    cancellationChargeCents: booking.cancellationChargeCents ?? null,
    cancellationReason: booking.cancellationReason ?? null,
    source: booking.source,
    /**
     * The structured requirements and their answers.
     *
     * Alongside `specialRequests`, not instead of it. These carry a code the
     * client renders from its own dictionary and a status the property set, so
     * an agency can see at a glance what has been agreed and what has not —
     * which a paragraph of prose never could.
     */
    requests: (booking.requests ?? []).map(toBookingRequest),
    bookingRooms: (booking.rooms ?? []).map((room) => toBookingRoom(room, viewer, booking.hotel))
});

export const toHold = (hold, priced) => ({
    token: hold.token,
    expiresAt: hold.expiresAt,
    checkIn: toDateOnly(hold.checkIn),
    checkOut: toDateOnly(hold.checkOut),
    rooms: hold.quantity,
    currency: hold.currency,
    totalCents: hold.quotedSellCents,
    ...(priced
        ? {
              hotel: { id: priced.hotel.id, name: priced.hotel.name, slug: priced.hotel.slug },
              roomTypeName: priced.roomType?.name ?? null,
              ratePlanName: priced.ratePlan?.name ?? null
          }
        : {})
});

export const toCancellationQuote = (quote) => ({
    chargeCents: quote.chargeCents,
    refundCents: quote.refundCents,
    currency: quote.currency,
    refundable: quote.refundCents > 0
});
