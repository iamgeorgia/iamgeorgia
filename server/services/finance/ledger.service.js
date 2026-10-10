import { config } from '../../config.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { upsertPenaltyInTx } from './penalty.service.js';
import { addDays, todayInTimezone, toDateOnly, zonedTimeToInstant } from '../../lib/time.js';

/**
 * The finance ledger: what we owe suppliers and what buyers owe us.
 *
 * Built as *sync* functions rather than as increments. Each one reads a
 * booking (or an order) as it stands, works out what should be owed from its
 * status and its frozen money, and brings the payable or receivable into line.
 * Calling one twice changes nothing; calling it after any change of status is
 * all a booking service has to do. The backfill script calls the same
 * functions, so a booking confirmed before this module existed ends up exactly
 * where one confirmed after it would.
 *
 * Everything runs inside the caller's transaction: a booking that commits has
 * its finance rows, and one that rolls back takes them with it.
 *
 * Money is integer minor units in the booking's own currency. Nothing here
 * converts or adds currencies (D8).
 */

/** Statuses in which the full amount is owed: delivered, about to be, or forfeited by a no-show. */
const OWED = new Set(['CONFIRMED', 'COMPLETED', 'NO_SHOW']);

// --- Products -----------------------------------------------------------------

/**
 * Where each product keeps what the ledger needs. One table, so the four
 * booking types are handled by one code path and differ only here.
 */
const PRODUCTS = {
    HOTEL: {
        model: 'hotelBooking',
        foreignKey: 'hotelBookingId',
        include: { hotel: { select: { id: true, supplierId: true, timezone: true } } },
        supplierId: (b) => b.hotel?.supplierId ?? null,
        termsWhere: (b) => ({ hotelId: b.hotelId }),
        timezone: (b) => b.hotel?.timezone,
        arrival: (b) => toDateOnly(b.checkIn),
        departure: (b) => toDateOnly(b.checkOut),
        // The guest pays the room and the tax included in it; the cancellation
        // schedule charges against the same total.
        buyerTotal: (b) => b.sellTotalCents + (b.taxTotalCents ?? 0),
        lead: (b) => ({ name: b.leadGuestName, email: b.leadGuestEmail })
    },
    TRANSFER: {
        model: 'transferBooking',
        foreignKey: 'transferBookingId',
        include: {
            vehicle: { select: { partnerId: true, providerId: true, provider: { select: { partnerId: true } } } }
        },
        supplierId: (b) => b.vehicle?.partnerId ?? b.vehicle?.provider?.partnerId ?? null,
        termsWhere: (b) => (b.vehicle?.providerId ? { transferProviderId: b.vehicle.providerId } : null),
        timezone: () => null,
        arrival: (b, tz) => todayInTimezone(tz, b.pickupAt),
        departure: (b, tz) => todayInTimezone(tz, b.returnPickupAt ?? b.pickupAt),
        buyerTotal: (b) => b.sellTotalCents,
        lead: (b) => ({ name: b.leadPassengerName, email: b.leadPassengerEmail })
    },
    TOUR: {
        model: 'tourBooking',
        foreignKey: 'tourBookingId',
        include: { tour: { select: { id: true, supplierId: true, timezone: true } } },
        supplierId: (b) => b.tour?.supplierId ?? null,
        termsWhere: (b) => ({ tourId: b.tourId }),
        timezone: (b) => b.tour?.timezone,
        arrival: (b) => toDateOnly(b.date),
        departure: (b) => toDateOnly(b.endDate),
        buyerTotal: (b) => b.sellTotalCents,
        lead: (b) => ({ name: b.leadTravellerName, email: b.leadTravellerEmail })
    },
    SERVICE: {
        model: 'serviceBooking',
        foreignKey: 'serviceBookingId',
        include: { service: { select: { id: true, supplierId: true, timezone: true } } },
        supplierId: (b) => b.service?.supplierId ?? null,
        termsWhere: (b) => ({ serviceId: b.serviceId }),
        timezone: (b) => b.service?.timezone,
        arrival: (b) => toDateOnly(b.date),
        departure: (b) => toDateOnly(b.endDate),
        buyerTotal: (b) => b.sellTotalCents,
        lead: (b) => ({ name: b.leadName, email: b.leadEmail })
    }
};

export const FINANCE_PRODUCTS = Object.keys(PRODUCTS);

const productOf = (product) => {
    const spec = PRODUCTS[product];

    if (!spec) {
        throw new Error(`Unknown finance product: ${product}`);
    }

    return spec;
};

const partnerSelect = { select: { id: true, name: true, email: true, paymentDueDays: true, paymentDueAnchor: true } };

// --- Pure arithmetic (unit-tested on its own) ----------------------------------------

/**
 * Where a settlement stands, from what is owed and what has moved.
 *
 * WAIVED is a decision, so it sticks; everything else is a reading of the two
 * numbers. Paid beyond what is owed (a cancellation after payment) reads as
 * PAID, and the difference is a refund due, which the serializer shows.
 */
export const deriveStatus = ({ amountCents, paidCents, current }) => {
    if (current === 'WAIVED') return 'WAIVED';
    if (amountCents === 0 && paidCents === 0) return 'VOID';
    if (paidCents >= amountCents) return 'PAID';
    if (paidCents > 0) return 'PARTIAL';
    return 'OPEN';
};

/** `voidedAt` follows VOID (the CHECK insists): stamped on the way in, cleared on the way out. */
const voidedAtFor = (status, previous, now) => (status === 'VOID' ? previous ?? now : null);

/**
 * The instalments a payable is split into, from the supplier's milestones.
 *
 * The deposit is a percentage (rounded half up) or a fixed sum (never more
 * than the whole); the balance is the remainder, so the parts always add up
 * to the total exactly. A deposit that rounds to nothing is left out, and so
 * is a balance the deposit has already covered. No milestones — a supplier
 * without terms — is one undated balance.
 */
export const buildInstalments = ({ milestones = [], amountCents, anchors, timezone, cutoffTime }) => {
    const deposit = milestones.find((m) => m.kind === 'DEPOSIT');
    const balance = milestones.find((m) => m.kind === 'BALANCE');

    const dueAt = (milestone) =>
        milestone ? zonedTimeToInstant(addDays(anchors[milestone.anchor], milestone.offsetDays), cutoffTime, timezone) : null;

    const depositCents = deposit
        ? deposit.basis === 'PERCENT'
            ? Math.round((amountCents * deposit.value) / 10_000)
            : Math.min(deposit.value, amountCents)
        : 0;

    const rows = [];

    if (depositCents > 0) {
        rows.push({ kind: 'DEPOSIT', amountCents: depositCents, dueAt: dueAt(deposit) });
    }

    // A deposit that took everything leaves no balance to schedule; a total of
    // nothing still gets its one (empty) row, so a payable always has one.
    if (amountCents - depositCents > 0 || rows.length === 0) {
        rows.push({ kind: 'BALANCE', amountCents: amountCents - depositCents, dueAt: dueAt(balance) });
    }

    return rows.map((row, index) => ({ sequence: index + 1, ...row }));
};

/**
 * Spreads a target total over instalments in order, each up to what it was
 * scheduled at. Reducing the total takes from the last instalment first —
 * a cancellation cancels the balance before the deposit already sent.
 */
export const distribute = (instalments, targetCents) => {
    let remaining = targetCents;

    return [...instalments]
        .sort((a, b) => a.sequence - b.sequence)
        .map((instalment) => {
            const amountCents = Math.min(instalment.originalAmountCents, remaining);
            remaining -= amountCents;
            return { ...instalment, amountCents };
        });
};

/**
 * What a supplier is owed once a booking is cancelled (owner decision D6),
 * given the charge the buyer bore, the buyer's total and the supplier's net.
 *
 *   PROPORTIONAL                — the same share of the net as was charged
 *   NONE_UNLESS_NON_REFUNDABLE  — the whole net if charged in full, else nothing
 *   MANUAL                      — what was already paid; Finance decides the rest
 */
export const cancellationTarget = ({ liability = 'PROPORTIONAL', chargeCents = 0, buyerTotalCents, netCents, paidCents = 0 }) => {
    const charge = Math.max(0, chargeCents ?? 0);

    switch (liability) {
        case 'NONE_UNLESS_NON_REFUNDABLE':
            return buyerTotalCents > 0 && charge >= buyerTotalCents ? netCents : 0;
        case 'MANUAL':
            return Math.min(paidCents, netCents);
        case 'PROPORTIONAL':
        default:
            if (buyerTotalCents <= 0 || charge === 0) return 0;
            return Math.min(netCents, Math.round((netCents * Math.min(charge, buyerTotalCents)) / buyerTotalCents));
    }
};

// --- Payables --------------------------------------------------------------------------

const loadBooking = (tx, product, bookingId) => {
    const spec = productOf(product);

    return tx[spec.model].findUnique({
        where: { id: bookingId },
        include: { ...spec.include, payable: { include: { instalments: true } } }
    });
};

const termsFor = async (tx, spec, booking) => {
    const where = spec.termsWhere(booking);
    return where ? tx.supplierPaymentTerms.findFirst({ where }) : null;
};

/** Never confirmed — a request the supplier declined — so nothing was ever owed. */
const neverConfirmed = (booking) => Boolean(booking.declinedAt) || !booking.confirmedAt;

const anchorsFor = (spec, booking, timezone) => ({
    CONFIRMATION: todayInTimezone(timezone, booking.confirmedAt ?? new Date()),
    ARRIVAL: spec.arrival(booking, timezone),
    DEPARTURE: spec.departure(booking, timezone)
});

const createPayable = async (tx, product, spec, booking, terms, { source }, actor, req) => {
    const timezone = spec.timezone(booking) ?? config.finance.defaultTimezone;
    const milestones = Array.isArray(terms?.milestones) ? terms.milestones : [];
    const rows = buildInstalments({
        milestones,
        amountCents: booking.netTotalCents,
        anchors: anchorsFor(spec, booking, timezone),
        timezone,
        cutoffTime: terms?.cutoffTime ?? config.finance.cutoffTime
    });

    const payable = await tx.supplierPayable.create({
        data: {
            product,
            [spec.foreignKey]: booking.id,
            supplierPartnerId: spec.supplierId(booking),
            bookingReference: booking.reference,
            timezone,
            currency: booking.currency,
            originalAmountCents: booking.netTotalCents,
            amountCents: booking.netTotalCents,
            status: booking.netTotalCents === 0 ? 'VOID' : 'OPEN',
            voidedAt: booking.netTotalCents === 0 ? new Date() : null,
            nextDueAt: rows.map((row) => row.dueAt).filter(Boolean).sort((a, b) => a - b)[0] ?? null,
            // A supplier with no terms has no due dates; Finance should know.
            needsReview: milestones.length === 0 && booking.netTotalCents > 0,
            reviewReason: milestones.length === 0 && booking.netTotalCents > 0 ? 'NO_TERMS' : null,
            source,
            instalments: {
                create: rows.map((row) => ({
                    sequence: row.sequence,
                    kind: row.kind,
                    originalAmountCents: row.amountCents,
                    amountCents: row.amountCents,
                    dueAt: row.dueAt,
                    status: row.amountCents === 0 ? 'VOID' : 'OPEN',
                    voidedAt: row.amountCents === 0 ? new Date() : null
                }))
            }
        },
        include: { instalments: true }
    });

    await recordAudit(tx, {
        action: 'PAYABLE_CREATED',
        actor,
        entityType: AUDIT_ENTITY.supplierPayable,
        entityId: payable.id,
        summary: `Owe ${(booking.netTotalCents / 100).toFixed(2)} ${booking.currency} to the supplier for ${booking.reference}`,
        metadata: { product, bookingId: booking.id, reference: booking.reference, instalments: rows.length, source },
        req
    });

    return payable;
};

/**
 * Brings a payable to a target total: instalments re-spread from their
 * scheduled amounts, statuses re-read, the parent recomputed. Returns the
 * updated payable; writes nothing when nothing moved.
 */
const applyPayableTarget = async (tx, payable, targetCents, extra, actor, req, why) => {
    const now = new Date();
    const spread = distribute(payable.instalments, targetCents);

    for (const instalment of spread) {
        const status = deriveStatus({ amountCents: instalment.amountCents, paidCents: instalment.paidCents, current: instalment.status });
        const voidedAt = voidedAtFor(status, instalment.voidedAt, now);

        if (instalment.amountCents !== payable.instalments.find((i) => i.id === instalment.id).amountCents || status !== instalment.status) {
            await tx.payableInstalment.update({
                where: { id: instalment.id },
                data: { amountCents: instalment.amountCents, status, voidedAt }
            });
        }

        instalment.status = status;
    }

    const paidCents = spread.reduce((sum, i) => sum + i.paidCents, 0);
    const status = deriveStatus({ amountCents: targetCents, paidCents, current: payable.status });
    const open = spread.filter((i) => (i.status === 'OPEN' || i.status === 'PARTIAL') && i.dueAt);
    const nextDueAt = open.map((i) => i.dueAt).sort((a, b) => a - b)[0] ?? null;

    const changed =
        payable.amountCents !== targetCents ||
        payable.paidCents !== paidCents ||
        payable.status !== status ||
        String(payable.nextDueAt) !== String(nextDueAt) ||
        Object.entries(extra).some(([key, value]) => payable[key] !== value);

    if (!changed) {
        return payable;
    }

    const updated = await tx.supplierPayable.update({
        where: { id: payable.id },
        data: { amountCents: targetCents, paidCents, status, nextDueAt, voidedAt: voidedAtFor(status, payable.voidedAt, now), ...extra },
        include: { instalments: true }
    });

    if (payable.amountCents !== targetCents) {
        await recordAudit(tx, {
            action: status === 'VOID' ? 'PAYABLE_VOIDED' : 'PAYABLE_AMOUNT_CHANGED',
            actor,
            entityType: AUDIT_ENTITY.supplierPayable,
            entityId: payable.id,
            summary: `Supplier payable for ${payable.bookingReference}: ${(payable.amountCents / 100).toFixed(2)} → ${(targetCents / 100).toFixed(2)} ${payable.currency}`,
            metadata: { from: payable.amountCents, to: targetCents, why },
            req
        });
    }

    return updated;
};

/**
 * Brings the supplier side of one booking into line with its status.
 *
 * Pending (awaiting the supplier's answer) and declined bookings owe nothing
 * and get no row. A confirmed one owes its net, on the supplier's schedule. A
 * cancelled one owes what the supplier's cancellation liability says — or
 * Finance's own figure, once Finance has set one.
 */
export const syncPayableInTx = async (tx, product, bookingId, actor = null, req = null, { source = 'CONFIRM' } = {}) => {
    const spec = productOf(product);
    const booking = await loadBooking(tx, product, bookingId);

    if (!booking) {
        return null;
    }

    const owed = OWED.has(booking.status);
    const cancelled = booking.status === 'CANCELLED';

    if (!owed && !cancelled) {
        return booking.payable ?? null;
    }

    if (!booking.payable && cancelled && neverConfirmed(booking)) {
        return null;
    }

    const terms = await termsFor(tx, spec, booking);
    const payable = booking.payable ?? (await createPayable(tx, product, spec, booking, terms, { source }, actor, req));

    if (payable.amountOverrideCents !== null && payable.amountOverrideCents !== undefined) {
        return applyPayableTarget(tx, payable, payable.amountOverrideCents, {}, actor, req, 'OVERRIDE');
    }

    if (owed) {
        return applyPayableTarget(tx, payable, payable.originalAmountCents, {}, actor, req, 'CONFIRMED');
    }

    const liability = payable.cancellationLiability ?? terms?.cancellationLiability ?? 'PROPORTIONAL';
    const paidCents = payable.instalments.reduce((sum, i) => sum + i.paidCents, 0);
    const target = cancellationTarget({
        liability,
        chargeCents: booking.cancellationChargeCents,
        buyerTotalCents: spec.buyerTotal(booking),
        netCents: payable.originalAmountCents,
        paidCents
    });

    const extra = {
        cancellationLiability: liability,
        ...(liability === 'MANUAL' && !payable.needsReview ? { needsReview: true, reviewReason: 'CANCELLATION_MANUAL' } : {})
    };

    return applyPayableTarget(tx, payable, target, extra, actor, req, `CANCELLED_${liability}`);
};

// --- Receivables --------------------------------------------------------------------------

const ORDER_CHILD_KEY = {
    HOTEL: 'hotelBookingId',
    TRANSFER: 'transferBookingId',
    TOUR: 'tourBookingId',
    SERVICE: 'serviceBookingId'
};

/** When a buyer must pay: the partner's own terms (D5), or at once for a guest. */
const receivableDueAt = (partner, { confirmationDate, arrivalDate, timezone }) => {
    const days = partner ? partner.paymentDueDays : config.finance.guestDueDays;
    const anchor = partner?.paymentDueAnchor === 'ARRIVAL' ? arrivalDate : confirmationDate;

    return zonedTimeToInstant(addDays(anchor, days), config.finance.receivableCutoffTime, timezone);
};

const applyReceivableTarget = async (tx, receivable, targetCents, actor, req, why) => {
    const now = new Date();
    const amountCents = Math.min(targetCents, receivable.originalAmountCents);
    const status = deriveStatus({ amountCents, paidCents: receivable.paidCents, current: receivable.status });

    if (receivable.amountCents === amountCents && receivable.status === status) {
        return receivable;
    }

    const updated = await tx.receivable.update({
        where: { id: receivable.id },
        data: { amountCents, status, voidedAt: voidedAtFor(status, receivable.voidedAt, now) }
    });

    if (receivable.amountCents !== amountCents) {
        await recordAudit(tx, {
            action: status === 'VOID' ? 'RECEIVABLE_VOIDED' : 'RECEIVABLE_AMOUNT_CHANGED',
            actor,
            entityType: AUDIT_ENTITY.receivable,
            entityId: receivable.id,
            summary: `Receivable ${receivable.reference}: ${(receivable.amountCents / 100).toFixed(2)} → ${(amountCents / 100).toFixed(2)} ${receivable.currency}`,
            metadata: { from: receivable.amountCents, to: amountCents, why },
            req
        });
    }

    return updated;
};

const createReceivable = async (tx, subject, { reference, partner, lead, currency, amountCents, dueAt, source }, actor, req) => {
    const receivable = await tx.receivable.create({
        data: {
            ...subject,
            reference,
            debtorPartnerId: partner?.id ?? null,
            debtorName: partner?.name ?? lead.name,
            debtorEmail: partner?.email ?? lead.email,
            currency,
            originalAmountCents: amountCents,
            amountCents,
            status: amountCents === 0 ? 'VOID' : 'OPEN',
            voidedAt: amountCents === 0 ? new Date() : null,
            dueAt,
            source
        }
    });

    await recordAudit(tx, {
        action: 'RECEIVABLE_CREATED',
        actor,
        entityType: AUDIT_ENTITY.receivable,
        entityId: receivable.id,
        summary: `${receivable.debtorName} owes ${(amountCents / 100).toFixed(2)} ${currency} for ${reference}`,
        metadata: { ...subject, reference, source },
        req
    });

    return receivable;
};

/**
 * Brings the buyer side of a standalone booking into line with its status.
 *
 * A booking inside an order is skipped: the order is what the buyer pays,
 * and `syncOrderReceivableInTx` keeps that one. Called by the booking facades
 * and by the cancel and on-request paths — never from inside `confirm…InTx`,
 * where an order's child has no order item yet and would look standalone.
 */
export const syncBookingReceivableInTx = async (tx, product, bookingId, actor = null, req = null, { source = 'CONFIRM' } = {}) => {
    const spec = productOf(product);
    const inOrder = await tx.orderItem.findUnique({ where: { [ORDER_CHILD_KEY[product]]: bookingId }, select: { id: true } });

    if (inOrder) {
        return null;
    }

    const booking = await tx[spec.model].findUnique({
        where: { id: bookingId },
        include: { ...spec.include, partner: partnerSelect, receivable: true }
    });

    if (!booking) {
        return null;
    }

    const owed = OWED.has(booking.status);
    const cancelled = booking.status === 'CANCELLED';

    if (!owed && !cancelled) {
        return booking.receivable ?? null;
    }

    // What a cancelled booking still owes is the penalty row's word: the
    // charge as calculated, unless a second person approved another figure.
    const penalty = cancelled ? await upsertPenaltyInTx(tx, product, booking) : null;
    const target = owed ? spec.buyerTotal(booking) : Math.max(0, penalty.overrideCents ?? penalty.chargeCents);

    if (!booking.receivable) {
        if (cancelled && (neverConfirmed(booking) || target === 0)) {
            return null;
        }

        const timezone = spec.timezone(booking) ?? config.finance.defaultTimezone;

        return createReceivable(
            tx,
            { [spec.foreignKey]: booking.id },
            {
                reference: booking.reference,
                partner: booking.partner,
                lead: spec.lead(booking),
                currency: booking.currency,
                amountCents: owed ? target : spec.buyerTotal(booking),
                dueAt: receivableDueAt(booking.partner, {
                    confirmationDate: todayInTimezone(timezone, booking.confirmedAt ?? new Date()),
                    arrivalDate: spec.arrival(booking, timezone),
                    timezone
                }),
                source
            },
            actor,
            req
        ).then((created) => (owed ? created : applyReceivableTarget(tx, created, target, actor, req, 'CANCELLED')));
    }

    return applyReceivableTarget(tx, booking.receivable, target, actor, req, owed ? 'CONFIRMED' : 'CANCELLED');
};

/** What a line on an order is worth to the buyer now, by its status. */
const orderItemOwed = (item) => {
    if (item.status === 'DECLINED') return 0;
    if (item.status === 'CANCELLED') return Math.max(0, item.cancellationChargeCents ?? 0);
    return item.lineTotalCents;
};

const ORDER_OWED = new Set(['CONFIRMED', 'PARTIALLY_CANCELLED', 'COMPLETED']);

/**
 * Brings an order's receivable into line: created when the order first
 * stands confirmed (every request answered), then following each line —
 * a cancelled line owes its charge, a declined one nothing.
 */
export const syncOrderReceivableInTx = async (tx, orderId, actor = null, req = null, { source = 'CONFIRM' } = {}) => {
    const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, partner: partnerSelect, receivable: true }
    });

    if (!order) {
        return null;
    }

    const target = order.items.reduce((sum, item) => sum + orderItemOwed(item), 0);

    if (order.receivable) {
        return applyReceivableTarget(tx, order.receivable, target, actor, req, order.status);
    }

    const confirmedOnce = ORDER_OWED.has(order.status) || (order.status === 'CANCELLED' && order.confirmedAt);

    if (!confirmedOnce || (order.status === 'CANCELLED' && target === 0)) {
        return null;
    }

    const timezone = config.finance.defaultTimezone;
    const originalCents = order.status === 'CANCELLED' ? order.items.reduce((sum, item) => sum + item.lineTotalCents, 0) : target;

    const created = await createReceivable(
        tx,
        { orderId: order.id },
        {
            reference: order.reference,
            partner: order.partner,
            lead: { name: order.leadName, email: order.leadEmail },
            currency: order.currency,
            amountCents: Math.max(originalCents, target),
            dueAt: receivableDueAt(order.partner, {
                confirmationDate: todayInTimezone(timezone, order.confirmedAt ?? new Date()),
                arrivalDate: toDateOnly(order.startDate),
                timezone
            }),
            source
        },
        actor,
        req
    );

    return created.amountCents === target ? created : applyReceivableTarget(tx, created, target, actor, req, order.status);
};

/** Both sides of one standalone-or-child booking, after any change of status. */
export const syncBookingInTx = async (tx, product, bookingId, actor = null, req = null, options = {}) => {
    const payable = await syncPayableInTx(tx, product, bookingId, actor, req, options);
    const receivable = await syncBookingReceivableInTx(tx, product, bookingId, actor, req, options);

    return { payable, receivable };
};

