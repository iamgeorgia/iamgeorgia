import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { AUDIT_ENTITY, recordAudit } from '../../lib/audit.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { decidedByFor } from '../../lib/booking/approval.js';
import { dateOnlyToUtc, toDateOnly } from '../../lib/time.js';
import { assertCreditInTx } from '../finance/credit.service.js';
import { bookingInclude as hotelBookingInclude, approvePendingHotelBookingInTx, rejectPendingHotelBookingInTx } from '../hotel/booking.service.js';
import {
    transferBookingInclude,
    approvePendingTransferBookingInTx,
    rejectPendingTransferBookingInTx,
    offerPreferredDriver
} from '../transfer/booking.service.js';
import { tourBookingInclude, approvePendingTourBookingInTx, rejectPendingTourBookingInTx } from '../tour/booking.service.js';
import { serviceBookingInclude, approvePendingServiceBookingInTx, rejectPendingServiceBookingInTx } from '../service/booking.service.js';
import { orderInclude, childOf, cancelOrderInTx, rollUpOrderStatus } from '../order/order.service.js';

/**
 * Platform approval of bookings (owner decision OD1, 2026-10-20).
 *
 * A booking made without an online payment — every booking — is written
 * PENDING_APPROVAL with its inventory claimed, and waits here for an
 * operator's yes or no. Yes is the moment the platform used to confirm at:
 * the supplier is told, the ledger opens what is owed, the proforma issues,
 * the buyer gets the confirmation they would have had. No gives the
 * inventory back at no charge. An order is decided as one.
 *
 * Why not the finance `ApprovalRequest`: that is a two-person, payload-
 * executing workflow for money actions. This is one operator's decision
 * about a booking, and its state belongs on the booking row, beside the
 * on-request stamps tours already carry.
 */

const PRODUCTS = {
    HOTEL: {
        model: 'hotelBooking',
        include: hotelBookingInclude,
        entity: AUDIT_ENTITY.booking,
        childKey: 'hotelBookingId',
        approve: approvePendingHotelBookingInTx,
        reject: rejectPendingHotelBookingInTx,
        buyerTotal: (b) => b.sellTotalCents + (b.taxTotalCents ?? 0),
        /** The day the service starts: past it, nobody can approve any more. */
        starts: (b) => b.checkIn,
        startsField: 'checkIn',
        title: (b) => b.hotelSnapshot?.name ?? 'Hotel',
        lead: (b) => ({ name: b.leadGuestName, email: b.leadGuestEmail }),
        when: (b) => ({ from: toDateOnly(b.checkIn), to: toDateOnly(b.checkOut) })
    },
    TRANSFER: {
        model: 'transferBooking',
        include: transferBookingInclude,
        entity: AUDIT_ENTITY.transferBooking,
        childKey: 'transferBookingId',
        approve: approvePendingTransferBookingInTx,
        reject: rejectPendingTransferBookingInTx,
        buyerTotal: (b) => b.sellTotalCents,
        starts: (b) => b.pickupAt,
        startsField: 'pickupAt',
        title: (b) => `${b.routeSnapshot?.fromName ?? 'Transfer'} → ${b.routeSnapshot?.toName ?? ''}`.trim(),
        lead: (b) => ({ name: b.leadPassengerName, email: b.leadPassengerEmail }),
        when: (b) => ({ from: b.pickupAt, to: b.returnPickupAt ?? b.pickupAt })
    },
    TOUR: {
        model: 'tourBooking',
        include: tourBookingInclude,
        entity: AUDIT_ENTITY.tourBooking,
        childKey: 'tourBookingId',
        approve: approvePendingTourBookingInTx,
        reject: rejectPendingTourBookingInTx,
        buyerTotal: (b) => b.sellTotalCents,
        starts: (b) => b.date,
        startsField: 'date',
        title: (b) => `${b.tourSnapshot?.title ?? 'Tour'}${b.tourSnapshot?.option?.name ? ` · ${b.tourSnapshot.option.name}` : ''}`,
        lead: (b) => ({ name: b.leadTravellerName, email: b.leadTravellerEmail }),
        when: (b) => ({ from: toDateOnly(b.date), to: toDateOnly(b.endDate) })
    },
    SERVICE: {
        model: 'serviceBooking',
        include: serviceBookingInclude,
        entity: AUDIT_ENTITY.serviceBooking,
        childKey: 'serviceBookingId',
        approve: approvePendingServiceBookingInTx,
        reject: rejectPendingServiceBookingInTx,
        buyerTotal: (b) => b.sellTotalCents,
        starts: (b) => b.date,
        startsField: 'date',
        title: (b) => b.serviceSnapshot?.name ?? 'Service',
        lead: (b) => ({ name: b.leadName, email: b.leadEmail }),
        when: (b) => ({ from: toDateOnly(b.date), to: toDateOnly(b.endDate) })
    },
    ORDER: {
        model: 'order',
        include: orderInclude,
        entity: AUDIT_ENTITY.order,
        childKey: null,
        buyerTotal: (b) => b.sellTotalCents,
        starts: (b) => b.startDate,
        startsField: 'startDate',
        title: (b) => b.packageSnapshot?.name ?? (b.kind === 'CUSTOM' ? 'Custom order' : 'Package'),
        lead: (b) => ({ name: b.leadName, email: b.leadEmail }),
        when: (b) => ({ from: toDateOnly(b.startDate), to: toDateOnly(b.endDate) })
    }
};

export const APPROVAL_PRODUCTS = Object.freeze(Object.keys(PRODUCTS));

const productOf = (product) => {
    const spec = PRODUCTS[product];

    if (!spec) {
        throw new NotFoundError('Unknown product');
    }

    return spec;
};

/** The component type an order item carries, by the child it points at. */
const CHILD_PRODUCT = { HOTEL_STAY: 'HOTEL', TRANSFER: 'TRANSFER', TOUR: 'TOUR', SERVICE: 'SERVICE' };

const loadForDecision = async (tx, product, reference) => {
    const spec = productOf(product);
    const row = await tx[spec.model].findFirst({ where: { OR: [{ id: reference }, { reference }] }, include: spec.include });

    if (!row) {
        throw new NotFoundError('Booking not found');
    }

    if (row.status !== 'PENDING_APPROVAL') {
        throw new ConflictError('That booking is not waiting for approval', { reason: 'NOT_PENDING_APPROVAL', status: row.status });
    }

    // A child of an order is decided with its order, never on its own: the
    // order's roll-up, its receivable and its one email must not be bypassed.
    if (spec.childKey) {
        const item = await tx.orderItem.findUnique({ where: { [spec.childKey]: row.id }, include: { order: { select: { reference: true } } } });

        if (item) {
            throw new ConflictError('This booking is part of an order; decide the order instead', {
                reason: 'PART_OF_ORDER',
                orderReference: item.order.reference,
                slotIndex: item.slotIndex
            });
        }
    }

    return { spec, row };
};

const enqueueDecision = (tx, topic, spec, product, row, extra = {}) =>
    enqueueEvent(tx, {
        topic,
        payload: { product, bookingId: row.id, ...extra },
        entityType: spec.entity,
        entityId: row.id
    });

// --- approve -----------------------------------------------------------------

const approveOrderInTx = async (tx, order, actor, req) => {
    const by = decidedByFor(actor);
    const now = new Date();

    for (const item of order.items.filter((candidate) => candidate.status === 'AWAITING_APPROVAL')) {
        const product = CHILD_PRODUCT[item.componentType];
        const child = await PRODUCTS[product].approve(tx, childOf(item), actor, req);
        const requested = child.status === 'PENDING';

        await tx.orderItem.update({
            where: { id: item.id },
            data: { status: requested ? 'REQUESTED' : 'CONFIRMED', fulfilment: requested ? 'ON_REQUEST' : 'INTERNAL' }
        });
    }

    await tx.order.update({
        where: { id: order.id },
        data: { approvedAt: now, approvedByUserId: by.userId, approvedByName: by.name }
    });

    await recordAudit(tx, {
        action: 'BOOKING_APPROVED',
        actor,
        entityType: AUDIT_ENTITY.order,
        entityId: order.id,
        summary: `Approved order ${order.reference}`,
        metadata: { reference: order.reference, totalCents: order.sellTotalCents, currency: order.currency, items: order.items.length },
        req
    });

    // The status the items now imply, the receivable once confirmed, and the
    // "confirmed"/"requested" audit row the roll-up writes itself. Re-read
    // afterwards: the roll-up returns the row from before its receivable.
    await rollUpOrderStatus(tx, order.id, actor, req);

    return tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
};

/**
 * The platform says yes.
 *
 * The credit check runs again here: a booking waiting for approval holds no
 * receivable, so it did not count toward the partner's limit while it
 * waited, and the limit is read against what is open at the moment the
 * money becomes owed.
 */
export const approveBooking = async (product, reference, { note = null } = {}, actor, req) => {
    const decided = await prisma.$transaction(
        async (tx) => {
            const { spec, row } = await loadForDecision(tx, product, reference);

            await assertCreditInTx(tx, row.partnerId, { addCents: spec.buyerTotal(row), currency: row.currency }, actor, req);

            const approved = product === 'ORDER' ? await approveOrderInTx(tx, row, actor, req) : await spec.approve(tx, row, actor, req);

            // One event for the people to be told: the partner's in-app
            // notice, and the confirmation the buyer would have had.
            await enqueueDecision(tx, TOPICS.BOOKING_APPROVED, spec, product, approved, { note });

            return approved;
        },
        { timeout: config.order.txTimeoutMs }
    );

    // After the commit, in its own transaction: a driver taken meanwhile
    // must not undo an approval that has already been written.
    if (product === 'TRANSFER' && decided.preferredDriverId) {
        await offerPreferredDriver(decided.id, actor, req);
    }

    return decided;
};

// --- reject ------------------------------------------------------------------

const rejectOrderInTx = async (tx, order, { reason, expired }, actor, req) => {
    const by = decidedByFor(actor);
    const now = new Date();
    const stamps = {
        rejectedAt: now,
        rejectedByUserId: by.userId,
        rejectedByName: by.name,
        rejectionReason: reason
    };

    // The children carry the same signature as the order, so each reads
    // REJECTED rather than WITHDRAWN when looked at on its own.
    for (const item of order.items.filter((candidate) => candidate.status === 'AWAITING_APPROVAL')) {
        const product = CHILD_PRODUCT[item.componentType];
        await tx[PRODUCTS[product].model].update({ where: { id: childOf(item).id }, data: stamps });
    }

    await tx.order.update({ where: { id: order.id }, data: stamps });

    await recordAudit(tx, {
        action: expired ? 'BOOKING_APPROVAL_EXPIRED' : 'BOOKING_REJECTED',
        actor,
        entityType: AUDIT_ENTITY.order,
        entityId: order.id,
        summary: `${expired ? 'Expired' : 'Rejected'} order ${order.reference}`,
        metadata: { reference: order.reference, reason },
        req
    });

    // Every live item is cancelled at no charge and the order with it;
    // the order's own cancellation email is suppressed in favour of the
    // rejection one, which `cancelOrderInTx` does not know about — so the
    // ORDER_CANCELLED event it writes is answered by a handler that skips
    // orders carrying a rejection.
    const { order: cancelled } = await cancelOrderInTx(tx, order, { reason, waiveCharges: true }, actor, req);

    return cancelled;
};

/** The platform says no. The inventory goes back and nothing is charged. */
export const rejectBooking = async (product, reference, { reason, expired = false }, actor, req) =>
    prisma.$transaction(
        async (tx) => {
            const { spec, row } = await loadForDecision(tx, product, reference);

            const rejected =
                product === 'ORDER'
                    ? await rejectOrderInTx(tx, row, { reason, expired }, actor, req)
                    : await spec.reject(tx, row, { reason, expired }, actor, req);

            await enqueueDecision(tx, TOPICS.BOOKING_REJECTED, spec, product, rejected, { reason, expired });

            return rejected;
        },
        { timeout: config.order.txTimeoutMs }
    );

// --- the queue ---------------------------------------------------------------

/** One row of the queue, the same shape whichever table it came from. */
const toQueueRow = (product, spec, row, now) => {
    const lead = spec.lead(row);

    return {
        product,
        id: row.id,
        reference: row.reference,
        status: row.status,
        title: spec.title(row),
        when: spec.when(row),
        leadName: lead.name,
        leadEmail: lead.email,
        partner: row.partner ? { id: row.partner.id, reference: row.partner.reference, name: row.partner.name } : null,
        currency: row.currency,
        totalCents: spec.buyerTotal(row),
        source: row.source,
        requestedAt: row.approvalRequestedAt,
        deadlineAt: row.approvalDeadlineAt,
        overdue: Boolean(row.approvalDeadlineAt) && row.approvalDeadlineAt < now,
        createdAt: row.createdAt
    };
};

const pendingWhere = (spec, { partnerId, overdue, now }) => ({
    status: 'PENDING_APPROVAL',
    ...(spec.childKey ? { orderItem: null } : {}),
    ...(partnerId ? { partnerId } : {}),
    ...(overdue ? { approvalDeadlineAt: { lt: now } } : {})
});

/**
 * Everything waiting for a decision, oldest deadline first.
 *
 * Five tables read and merged in memory: the queue is operations' in-tray,
 * tens of rows on a busy day, and a cross-product index is a later
 * phase's job. Order children are left out — their order is in the list.
 */
export const listPendingApprovals = async ({ product = null, partnerId = null, overdue = false, search = null, page = 1, pageSize = 25 } = {}) => {
    const now = new Date();
    const products = product ? [product] : APPROVAL_PRODUCTS;

    const rows = (
        await Promise.all(
            products.map(async (key) => {
                const spec = productOf(key);
                const found = await prisma[spec.model].findMany({
                    where: pendingWhere(spec, { partnerId, overdue, now }),
                    include: spec.include,
                    orderBy: { approvalDeadlineAt: 'asc' }
                });

                return found.map((row) => toQueueRow(key, spec, row, now));
            })
        )
    ).flat();

    const needle = search?.trim().toLowerCase();
    const filtered = needle
        ? rows.filter((row) => [row.reference, row.leadName, row.leadEmail, row.title, row.partner?.name].some((value) => value?.toLowerCase().includes(needle)))
        : rows;

    filtered.sort((a, b) => (a.deadlineAt?.getTime() ?? 0) - (b.deadlineAt?.getTime() ?? 0));

    const total = filtered.length;
    const start = (page - 1) * pageSize;

    return {
        rows: filtered.slice(start, start + pageSize),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
};

/** The sidebar badge: how many decisions wait, order children excluded. */
export const countPendingApprovals = async () => {
    const counts = await Promise.all(
        APPROVAL_PRODUCTS.map((key) => {
            const spec = productOf(key);

            return prisma[spec.model].count({ where: pendingWhere(spec, { now: new Date() }) });
        })
    );

    return counts.reduce((sum, count) => sum + count, 0);
};

// --- the sweeper -------------------------------------------------------------

/**
 * Two things on the clock.
 *
 * Past the answer deadline: operations are told once, stamped in the same
 * statement that enqueues the alert so a second sweeper finds nothing to do.
 * Nothing is rejected at the deadline — a late yes is still a yes.
 *
 * Past the service date: a booking nobody answered before the stay began
 * or the car was due cannot be approved any more, and holding its rooms
 * helps nobody. The sweeper rejects it as the system, at no charge.
 */
export const sweepBookingApprovals = async ({ now = new Date(), limit = 100 } = {}) => {
    let alerted = 0;
    let expired = 0;

    for (const key of APPROVAL_PRODUCTS) {
        const spec = productOf(key);

        const overdue = await prisma[spec.model].findMany({
            where: { ...pendingWhere(spec, { now }), approvalDeadlineAt: { lt: now }, approvalOverdueAlertAt: null },
            select: { id: true },
            take: limit
        });

        for (const row of overdue) {
            await prisma.$transaction(async (tx) => {
                const { count } = await tx[spec.model].updateMany({
                    where: { id: row.id, status: 'PENDING_APPROVAL', approvalOverdueAlertAt: null },
                    data: { approvalOverdueAlertAt: now }
                });

                if (count === 0) return;

                await enqueueDecision(tx, TOPICS.BOOKING_APPROVAL_OVERDUE, spec, key, row);
                alerted += 1;
            });
        }

        // Date-only columns compare against today's date; instants against now.
        const startedBefore = spec.startsField === 'pickupAt' ? now : dateOnlyToUtc(toDateOnly(now));
        const stale = await prisma[spec.model].findMany({
            where: { ...pendingWhere(spec, { now }), [spec.startsField]: { lt: startedBefore } },
            select: { id: true },
            take: limit
        });

        for (const row of stale) {
            try {
                await rejectBooking(key, row.id, { reason: 'The service date passed before the booking was approved', expired: true }, null, null);
                expired += 1;
            } catch (err) {
                // Decided by a person between the read and the write: fine.
                if (!(err instanceof ConflictError)) throw err;
            }
        }
    }

    return { alerted, expired };
};
