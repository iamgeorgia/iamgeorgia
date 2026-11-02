/**
 * Where a booking's money stands, as a list or a detail page shows it.
 *
 * The ledger keeps the truth on the `Receivable` (`status` OPEN, PARTIAL,
 * PAID, VOID, WAIVED and a `dueAt`); this reads one into the words a booking
 * desk uses, and adds the two states the ledger does not store: OVERDUE,
 * which is a reading of the clock, and NONE, for a booking that owes nothing
 * yet — one still waiting for approval, or rejected, or a child of an order
 * whose receivable is the order's.
 */
export const PAYMENT_STATUSES = Object.freeze(['NONE', 'UNPAID', 'PARTIAL', 'OVERDUE', 'PAID', 'WAIVED', 'VOID']);

import { config } from '../../config.js';
import { cardAllowedFor } from '../payments/policy.js';

/** What a booking include selects of its receivable: enough for the payment block, nothing a guest should not see. */
export const RECEIVABLE_SUMMARY_SELECT = Object.freeze({
    select: {
        id: true,
        status: true,
        dueAt: true,
        amountCents: true,
        paidCents: true,
        currency: true,
        debtorPartnerId: true,
        // The card rule frozen at confirmation (docs/plans/FLITT_INTEGRATION_PLAN.md §4.4).
        paymentTiming: true,
        unpaidCancelHours: true,
        autoCancelAt: true,
        autoCancelledAt: true
    }
});

/** The order a child booking belongs to, with the order's receivable — the one the buyer actually pays. */
export const ORDER_LINK_SELECT = Object.freeze({
    select: { slotIndex: true, order: { select: { id: true, reference: true, status: true, receivable: RECEIVABLE_SUMMARY_SELECT } } }
});

/** The receivable a booking is paid through: its own, or its order's. */
export const receivableFor = (booking) =>
    booking.receivable
        ? { receivable: booking.receivable, via: 'BOOKING' }
        : booking.orderItem?.order?.receivable
          ? { receivable: booking.orderItem.order.receivable, via: 'ORDER' }
          : { receivable: null, via: booking.orderItem ? 'ORDER' : 'BOOKING' };

export const paymentStatusOf = (receivable, now = new Date()) => {
    if (!receivable) return 'NONE';
    if (receivable.status === 'PAID') return 'PAID';
    if (receivable.status === 'WAIVED' || receivable.status === 'VOID') return receivable.status;
    if (receivable.dueAt && receivable.dueAt < now) return 'OVERDUE';

    return receivable.status === 'PARTIAL' ? 'PARTIAL' : 'UNPAID';
};

/**
 * Whether "pay by card" can be offered on this receivable right now: the
 * gateway is on, the buyer is a guest, the frozen rule allows a card, there
 * is something left to pay and the booking was not cancelled for not paying.
 */
export const cardAvailabilityOf = (receivable) => {
    if (!receivable) return { available: false, reason: 'NO_RECEIVABLE' };
    if (!config.payments.flitt.enabled) return { available: false, reason: 'PAYMENTS_DISABLED' };
    if (receivable.debtorPartnerId) return { available: false, reason: 'PARTNER_RECEIVABLE' };
    if (receivable.autoCancelledAt) return { available: false, reason: 'BOOKING_CANCELLED' };
    if (!['OPEN', 'PARTIAL'].includes(receivable.status) || receivable.amountCents - receivable.paidCents <= 0) return { available: false, reason: 'NOTHING_TO_PAY' };
    if (!cardAllowedFor(receivable.paymentTiming)) return { available: false, reason: 'CARD_NOT_OFFERED' };
    if (!config.payments.flitt.currencies.includes(receivable.currency)) return { available: false, reason: 'CURRENCY_NOT_SUPPORTED' };

    return { available: true, reason: null };
};

/** The block a booking serializer carries for staff and for the buyer. */
export const toPaymentSummary = (receivable, { via = 'BOOKING', now = new Date() } = {}) => ({
    status: paymentStatusOf(receivable, now),
    via,
    receivableId: receivable?.id ?? null,
    dueAt: receivable?.dueAt ?? null,
    amountCents: receivable?.amountCents ?? null,
    paidCents: receivable?.paidCents ?? null,
    outstandingCents: receivable ? Math.max(0, receivable.amountCents - receivable.paidCents) : null,
    // The card rule the buyer agreed to, and whether a card can be used now.
    timing: receivable?.paymentTiming ?? null,
    autoCancelAt: receivable?.autoCancelAt ?? null,
    autoCancelledAt: receivable?.autoCancelledAt ?? null,
    card: cardAvailabilityOf(receivable)
});
