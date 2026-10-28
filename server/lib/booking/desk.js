import { recordAudit } from '../audit.js';

/**
 * The desk's fields on a booking: what a manual booking carries beyond what
 * a public one does, and how they travel from the request into the row.
 *
 *   customerId              the buyer, when there is no partner account
 *   assignedManagerUserId   who at the desk is looking after it
 *   internalNotes           what the desk wrote down; never shown outside
 *   priceAdjustmentCents    a signed, audited change to the catalogue price
 *                           (owner decision OD3): the booking still carries
 *                           the catalogue sell, so rooms, nights and the
 *                           cancellation schedule keep adding up, and the
 *                           buyer's total is sell (+ tax) + adjustment.
 */

const EMPTY = Object.freeze({
    customerId: null,
    assignedManagerUserId: null,
    internalNotes: null,
    priceAdjustmentCents: 0,
    priceAdjustmentReason: null
});

/** What `prepareX` keeps of a manual booking's input; nothing, for a public one. */
export const deskFrom = (input) =>
    input?.manual
        ? {
              customerId: input.customerId ?? null,
              assignedManagerUserId: input.assignedManagerUserId ?? null,
              internalNotes: input.internalNotes ?? null,
              priceAdjustmentCents: input.priceAdjustment?.cents ?? 0,
              priceAdjustmentReason: input.priceAdjustment?.reason ?? null
          }
        : EMPTY;

/** The columns `confirmXInTx` writes from a prepared booking. */
export const deskColumns = (prepared, { adjustment = true } = {}) => {
    const desk = prepared?.desk ?? EMPTY;

    return {
        customerId: desk.customerId,
        assignedManagerUserId: desk.assignedManagerUserId,
        internalNotes: desk.internalNotes,
        ...(adjustment ? { priceAdjustmentCents: desk.priceAdjustmentCents, priceAdjustmentReason: desk.priceAdjustmentReason } : {})
    };
};

/** An adjustment is a figure somebody chose: it gets its own audit row beside the booking's. */
export const auditPriceAdjustment = async (tx, { entityType, booking, prepared, catalogueCents }, actor, req) => {
    const desk = prepared?.desk ?? EMPTY;

    if (!desk.priceAdjustmentCents) return;

    await recordAudit(tx, {
        action: 'BOOKING_PRICE_ADJUSTED',
        actor,
        entityType,
        entityId: booking.id,
        summary: `${booking.reference} sold at ${desk.priceAdjustmentCents > 0 ? '+' : ''}${(desk.priceAdjustmentCents / 100).toFixed(2)} ${booking.currency} on the catalogue price`,
        metadata: { reference: booking.reference, catalogueCents, adjustmentCents: desk.priceAdjustmentCents, reason: desk.priceAdjustmentReason },
        req
    });
};

/** What a booking include selects for the desk block. */
export const DESK_INCLUDE = Object.freeze({
    customer: { select: { id: true, kind: true, name: true, contactName: true, email: true, phone: true } },
    assignedManager: { select: { id: true, firstName: true, lastName: true, email: true } }
});

const personName = (user) => (user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : null);

/** The desk block a staff serializer carries; never a partner's or a guest's business. */
export const toDesk = (booking, { adjustment = true } = {}) => ({
    source: booking.source,
    customer: booking.customer
        ? { id: booking.customer.id, kind: booking.customer.kind, name: booking.customer.name, contactName: booking.customer.contactName ?? null, email: booking.customer.email, phone: booking.customer.phone ?? null }
        : null,
    assignedManager: booking.assignedManager ? { id: booking.assignedManager.id, name: personName(booking.assignedManager) } : null,
    internalNotes: booking.internalNotes ?? null,
    ...(adjustment
        ? {
              priceAdjustment: booking.priceAdjustmentCents ? { cents: booking.priceAdjustmentCents, reason: booking.priceAdjustmentReason ?? null } : null
          }
        : {})
});

/** The buyer's total: the catalogue sell, the tax folded into it, and the desk's adjustment. */
export const buyerTotalOf = (booking, { tax = false } = {}) =>
    booking.sellTotalCents + (tax ? (booking.taxTotalCents ?? 0) : 0) + (booking.priceAdjustmentCents ?? 0);

/**
 * A cancellation quote against the buyer's total rather than the catalogue
 * sell, when the two differ. The schedule's charge stands; the refund is
 * what is left of what was actually paid for.
 */
export const applyAdjustmentToQuote = (quote, booking, { tax = false } = {}) => {
    if (!booking.priceAdjustmentCents) return quote;

    const total = buyerTotalOf(booking, { tax });
    const chargeCents = Math.min(quote.chargeCents, total);

    return { ...quote, chargeCents, refundCents: total - chargeCents };
};
