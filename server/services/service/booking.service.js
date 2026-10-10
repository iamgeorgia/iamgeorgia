import { createHash } from 'node:crypto';

import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { assertReplayOwner } from '../../lib/idempotency.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { syncBookingInTx, syncBookingReceivableInTx, syncPayableInTx } from '../finance/ledger.service.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { nextServiceBookingReference } from '../../lib/reference.js';
import { addDays, dateOnlyToUtc, nightsBetween, todayInTimezone, zonedTimeToInstant } from '../../lib/time.js';
import { isTrade, readsAllBookings } from '../../middleware/auth.js';
import { CAPABILITIES, can } from '../../lib/permissions.js';
import { buildCancellationSchedule, calculateRefund } from '../hotel/policy.service.js';
import { resolveMarkup } from '../hotel/pricingRule.service.js';
import { quoteService } from './pricing.service.js';
import { serviceInclude } from './service.service.js';

/**
 * Service bookings.
 *
 * The transfer shape — no inventory, no hold — written the way every product
 * is written now: `prepare` outside a transaction, `confirmInTx` inside one,
 * so an order can commit a service beside a hotel and a tour in a single
 * transaction. A standalone service booking is a staff or partner action
 * (the public site sells services only inside packages), which is why there
 * is no offer token: the request names the service and the party, and the
 * price is computed here, twice.
 */

const CANCELLABLE_STATUSES = ['PENDING', 'CONFIRMED'];
const START_TIME = '09:00';

export const serviceBookingInclude = {
    service: { select: { id: true, slug: true, name: true, supplierId: true, timezone: true } },
    partner: { select: { id: true, reference: true, name: true } }
};

const deriveIdempotencyKey = (input) =>
    input.idempotencyKey ??
    createHash('sha256')
        .update([input.serviceId, input.date, input.quantity ?? 1, input.pax ?? 1, input.lead.email.toLowerCase()].join('|'))
        .digest('base64url');

const snapshotService = (service, quote) => ({
    id: service.id,
    slug: service.slug,
    name: service.name,
    category: service.category,
    basis: service.basis,
    isKosher: service.isKosher,
    kosherAuthority: service.kosherAuthority ?? null,
    included: service.included ?? [],
    supplierName: service.supplier?.name ?? null,
    destinationName: service.destination?.name ?? null,
    quote: {
        quantity: quote.quantity,
        pax: quote.pax,
        days: quote.days,
        units: quote.units,
        unitSellCents: quote.unitSellCents,
        unitNetCents: quote.unitNetCents
    }
});

/**
 * Prices a service for a date and a party, and says whether it may be sold.
 *
 * `quotedSellCents` is what a package quote promised; a moved price is a
 * 409 under `strict`, exactly as for a hotel or a tour.
 */
export const prepareServiceBooking = async (input, actor, { strict = true, now = new Date() } = {}) => {
    const service = await prisma.service.findFirst({
        where: { OR: [{ id: input.serviceId }, { slug: input.serviceId }], status: 'ACTIVE' },
        include: serviceInclude()
    });

    if (!service) {
        throw new NotFoundError('That service is no longer available');
    }

    const trade = isTrade(actor);

    if (!trade && !service.b2cEnabled) {
        throw new NotFoundError('That service is no longer available');
    }

    const days = input.days ?? 1;
    const quantity = input.quantity ?? 1;
    const pax = input.pax ?? 1;
    const today = todayInTimezone(service.timezone, now);

    if (input.date < today) {
        throw new UnprocessableEntityError('That date has passed', { reason: 'PAST', today });
    }

    if (nightsBetween(today, input.date) > config.service.bookingHorizonDays) {
        throw new UnprocessableEntityError('That date is beyond the booking horizon', {
            reason: 'BEYOND_HORIZON',
            limitDays: config.service.bookingHorizonDays
        });
    }

    const startAt = zonedTimeToInstant(input.date, input.time ?? START_TIME, service.timezone);

    if (startAt.getTime() - now.getTime() < service.noticeHours * 3_600_000) {
        throw new ConflictError('That service needs more notice', {
            reason: 'TOO_SOON',
            noticeHours: service.noticeHours
        });
    }

    if (quantity < service.minQuantity || (service.maxQuantity !== null && quantity > service.maxQuantity)) {
        throw new UnprocessableEntityError('That quantity is not offered', {
            reason: 'QUANTITY',
            minQuantity: service.minQuantity,
            maxQuantity: service.maxQuantity
        });
    }

    const { markupBps } = await resolveMarkup({
        partner: actor?.partner ?? (actor?.partnerId ? { id: actor.partnerId } : null),
        service,
        date: input.date
    });

    const quote = quoteService({ service, quantity, pax, days, markupBps });
    const quotedCents = input.quotedSellCents ?? quote.totals.totalCents;
    const currentCents = quote.totals.totalCents;
    const priceChanged = currentCents !== quotedCents;

    if (strict && priceChanged) {
        throw new ConflictError('The price for this service has changed', {
            reason: 'PRICE_CHANGED',
            quotedCents,
            currentCents,
            currency: quote.currency
        });
    }

    const schedule = buildCancellationSchedule({
        rules: service.cancellationPolicy?.rules ?? [],
        checkInDate: input.date,
        checkInTime: input.time ?? START_TIME,
        timezone: service.timezone,
        nightlyCents: [quote.totals.sellCents],
        currency: quote.currency,
        bookedAt: now
    });

    return {
        kind: 'SERVICE',
        service,
        date: input.date,
        endDate: addDays(input.date, days - 1),
        startAt,
        quantity,
        pax,
        days,
        quote,
        schedule,
        lead: input.lead,
        notes: input.notes ?? null,
        source: input.source ?? 'web',
        priceChanged,
        quotedCents,
        currentCents,
        currency: quote.currency,
        // No inventory, nothing to order locks on.
        lockKey: null
    };
};

export const confirmServiceBookingInTx = async (tx, prepared, { idempotencyKey } = {}, actor, req) => {
    const { service, quote, schedule } = prepared;
    const onRequest = service.confirmationMode === 'ON_REQUEST';
    const now = new Date();
    const reference = await nextServiceBookingReference(tx);

    const created = await tx.serviceBooking.create({
        data: {
            reference,
            status: onRequest ? 'PENDING' : 'CONFIRMED',
            idempotencyKey: idempotencyKey ?? null,
            partnerId: actor?.partnerId ?? null,
            bookedByUserId: actor?.id ?? null,
            serviceId: service.id,
            date: dateOnlyToUtc(prepared.date),
            endDate: dateOnlyToUtc(prepared.endDate),
            startAt: prepared.startAt,
            quantity: prepared.quantity,
            pax: prepared.pax,
            days: prepared.days,
            currency: quote.currency,
            netTotalCents: quote.totals.netCents,
            sellTotalCents: quote.totals.sellCents,
            markupBps: quote.totals.markupBps,
            leadName: `${prepared.lead.firstName} ${prepared.lead.lastName}`,
            leadEmail: prepared.lead.email,
            leadPhone: prepared.lead.phone ?? null,
            notes: prepared.notes,
            serviceSnapshot: snapshotService(service, quote),
            cancellationSchedule: schedule,
            confirmationMode: service.confirmationMode,
            ...(onRequest
                ? {
                      requestedAt: now,
                      requestDeadlineAt: new Date(now.getTime() + config.service.onRequestSlaHours * 3_600_000)
                  }
                : { confirmedAt: now }),
            source: prepared.source
        },
        include: serviceBookingInclude
    });

    await recordAudit(tx, {
        action: 'SERVICE_BOOKING_CREATED',
        actor,
        entityType: AUDIT_ENTITY.serviceBooking,
        entityId: created.id,
        summary: `${onRequest ? 'Requested' : 'Booked'} ${service.name} for ${prepared.date}`,
        metadata: {
            reference,
            serviceId: service.id,
            quantity: prepared.quantity,
            pax: prepared.pax,
            days: prepared.days,
            totalCents: created.sellTotalCents,
            currency: created.currency,
            onRequest
        },
        req
    });

    // The provider hears about every booking of its service, however it was
    // sold; the buyer's own email is the facade's business.
    await enqueueEvent(tx, {
        topic: TOPICS.SUPPLIER_BOOKING_RECEIVED,
        payload: { product: 'service', bookingId: created.id, requested: onRequest },
        entityType: AUDIT_ENTITY.serviceBooking,
        entityId: created.id
    });

    // Owed to the provider once confirmed; an on-request booking owes nothing yet.
    await syncPayableInTx(tx, 'SERVICE', created.id, actor, req);

    return created;
};

/** The buyer's side of a standalone booking; orders describe their own parts. */
const enqueueBuyerEvent = (tx, booking, topic, payload = {}) =>
    enqueueEvent(tx, {
        topic,
        payload: { bookingId: booking.id, ...payload },
        entityType: AUDIT_ENTITY.serviceBooking,
        entityId: booking.id
    });

export const confirmServiceBooking = async (input, actor, req) => {
    const idempotencyKey = deriveIdempotencyKey(input);

    const existing = await prisma.serviceBooking.findUnique({ where: { idempotencyKey }, include: serviceBookingInclude });

    // A replay is a read of the original, and is gated like one: the key
    // alone does not prove the caller made the request it names.
    const replayOf = (booking) => {
        assertReplayOwner(() => assertMayRead(booking, actor, { email: input.lead?.email }));

        return { booking, replayed: true };
    };

    if (existing) {
        return replayOf(existing);
    }

    const prepared = await prepareServiceBooking(input, actor);

    try {
        const booking = await prisma.$transaction(async (tx) => {
            const created = await confirmServiceBookingInTx(tx, prepared, { idempotencyKey }, actor, req);

            await syncBookingReceivableInTx(tx, 'SERVICE', created.id, actor, req);

            await enqueueBuyerEvent(
                tx,
                created,
                created.status === 'PENDING' ? TOPICS.SERVICE_BOOKING_REQUESTED : TOPICS.SERVICE_BOOKING_CONFIRMED
            );

            return created;
        });

        return { booking, replayed: false };
    } catch (err) {
        if (err?.code === 'P2002') {
            const winner = await prisma.serviceBooking.findUnique({ where: { idempotencyKey }, include: serviceBookingInclude });

            if (winner) {
                return replayOf(winner);
            }
        }

        throw err;
    }
};

const assertMayRead = (booking, viewer, { email } = {}) => {
    if (readsAllBookings(viewer)) {
        return;
    }

    if (viewer?.partnerId) {
        if (booking.partnerId !== viewer.partnerId) {
            throw new NotFoundError('Booking not found');
        }

        return;
    }

    if (booking.partnerId === null && email && booking.leadEmail.toLowerCase() === email.toLowerCase()) {
        return;
    }

    // A 404, not a 403, like every other booking module: the references come
    // from a sequence, and a different answer for "exists but not yours"
    // would let anyone enumerate them.
    throw new NotFoundError('Booking not found');
};

/**
 * Who may change a booking. Narrower than reading: of the platform side only
 * holders of the capability pass; staff who read but may not change get the
 * stranger's 404.
 */
const assertMayMutate = (booking, viewer, { capability, ...options }) => {
    if (can(viewer, capability)) {
        return;
    }

    if (readsAllBookings(viewer)) {
        throw new NotFoundError('Booking not found');
    }

    assertMayRead(booking, viewer, options);
};

export const findServiceBookingOr404 = async (reference, viewer, options = {}) => {
    const booking = await prisma.serviceBooking.findUnique({ where: { reference }, include: serviceBookingInclude });

    if (!booking) {
        throw new NotFoundError('Booking not found');
    }

    assertMayRead(booking, viewer, options);

    return booking;
};

export const listServiceBookings = async (query, viewer) => {
    const { page, pageSize, status, serviceId, partnerId, from, to, search } = query;

    const where = {
        ...(readsAllBookings(viewer) ? { ...(partnerId ? { partnerId } : {}) } : { partnerId: viewer?.partnerId ?? '__none__' }),
        ...(status ? { status: { in: Array.isArray(status) ? status : [status] } } : {}),
        ...(serviceId ? { serviceId } : {}),
        ...(from || to
            ? { date: { ...(from ? { gte: dateOnlyToUtc(from) } : {}), ...(to ? { lte: dateOnlyToUtc(to) } : {}) } }
            : {}),
        ...(search
            ? {
                  OR: [
                      { reference: { contains: search, mode: 'insensitive' } },
                      { leadName: { contains: search, mode: 'insensitive' } },
                      { leadEmail: { contains: search, mode: 'insensitive' } }
                  ]
              }
            : {})
    };

    const [total, bookings] = await Promise.all([
        prisma.serviceBooking.count({ where }),
        prisma.serviceBooking.findMany({
            where,
            include: serviceBookingInclude,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { bookings, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

/** A request nobody has confirmed costs nothing to withdraw. */
export const quoteServiceCancellation = (booking, at = new Date()) => {
    if (booking.status === 'PENDING') {
        return { chargeCents: 0, refundCents: booking.sellTotalCents, currency: booking.currency };
    }

    const refund = calculateRefund(booking.cancellationSchedule, at);

    return { chargeCents: refund.chargeCents, refundCents: refund.refundCents, currency: booking.currency };
};


/**
 * A booking that belongs to an order is cancelled through the order, whose
 * roll-up and clawback must not be bypassed. 409 with the order reference.
 */
const assertNotInOrder = async (client, column, bookingId) => {
    const item = await client.orderItem.findUnique({ where: { [column]: bookingId }, include: { order: { select: { reference: true } } } });

    if (item) {
        throw new ConflictError('This booking is part of an order; cancel it from the order', {
            reason: 'PART_OF_ORDER',
            orderReference: item.order.reference,
            slotIndex: item.slotIndex
        });
    }
};

export const cancelServiceBookingInTx = async (tx, booking, { reason, waiveCharges = false } = {}, actor, req) => {
    if (!CANCELLABLE_STATUSES.includes(booking.status)) {
        throw new ConflictError('That booking cannot be cancelled', { reason: 'NOT_CANCELLABLE', status: booking.status });
    }

    const quote = waiveCharges
        ? { chargeCents: 0, refundCents: booking.sellTotalCents, currency: booking.currency }
        : quoteServiceCancellation(booking);

    const cancelled = await tx.serviceBooking.update({
        where: { id: booking.id },
        data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancellationChargeCents: quote.chargeCents,
            cancellationReason: reason ?? null
        },
        include: serviceBookingInclude
    });

    await recordAudit(tx, {
        action: 'SERVICE_BOOKING_CANCELLED',
        actor,
        entityType: AUDIT_ENTITY.serviceBooking,
        entityId: booking.id,
        summary: `Cancelled ${booking.reference}`,
        metadata: {
            reference: booking.reference,
            chargeCents: quote.chargeCents,
            refundCents: quote.refundCents,
            currency: booking.currency,
            ...(reason ? { reason } : {}),
            ...(waiveCharges ? { waived: true } : {})
        },
        req
    });

    await enqueueEvent(tx, {
        topic: TOPICS.SUPPLIER_BOOKING_CANCELLED,
        payload: { product: 'service', bookingId: booking.id, reason: reason ?? null },
        entityType: AUDIT_ENTITY.serviceBooking,
        entityId: booking.id
    });

    await syncBookingInTx(tx, 'SERVICE', booking.id, actor, req);

    return { booking: cancelled, quote };
};

export const cancelServiceBooking = async (reference, { reason, email } = {}, actor, req) =>
    prisma.$transaction(async (tx) => {
        const booking = await prisma.serviceBooking.findUnique({ where: { reference }, include: serviceBookingInclude });

        if (!booking) {
            throw new NotFoundError('Booking not found');
        }

        assertMayMutate(booking, actor, { capability: CAPABILITIES.BOOKINGS_CANCEL, email });

        await assertNotInOrder(tx, 'serviceBookingId', booking.id);

        const result = await cancelServiceBookingInTx(tx, booking, { reason }, actor, req);

        await enqueueBuyerEvent(tx, booking, TOPICS.SERVICE_BOOKING_CANCELLED, {
            chargeCents: result.quote.chargeCents,
            reason: reason ?? null
        });

        return result;
    });

const assertPending = (booking) => {
    if (booking.status !== 'PENDING') {
        throw new ConflictError('That booking is not awaiting an answer', { reason: 'NOT_PENDING', status: booking.status });
    }
};

export const confirmPendingServiceBookingInTx = async (tx, booking, actor, req) => {
    assertPending(booking);

    const confirmed = await tx.serviceBooking.update({
        where: { id: booking.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
        include: serviceBookingInclude
    });

    await recordAudit(tx, {
        action: 'SERVICE_BOOKING_CONFIRMED',
        actor,
        entityType: AUDIT_ENTITY.serviceBooking,
        entityId: booking.id,
        summary: `Confirmed request ${booking.reference}`,
        metadata: { reference: booking.reference },
        req
    });

    await syncBookingInTx(tx, 'SERVICE', booking.id, actor, req);

    return confirmed;
};

export const declinePendingServiceBookingInTx = async (tx, booking, { reason }, actor, req) => {
    assertPending(booking);

    const now = new Date();
    const declined = await tx.serviceBooking.update({
        where: { id: booking.id },
        data: {
            status: 'CANCELLED',
            declinedAt: now,
            declineReason: reason,
            cancelledAt: now,
            cancellationChargeCents: 0,
            cancellationReason: reason
        },
        include: serviceBookingInclude
    });

    await recordAudit(tx, {
        action: 'SERVICE_BOOKING_DECLINED',
        actor,
        entityType: AUDIT_ENTITY.serviceBooking,
        entityId: booking.id,
        summary: `Declined request ${booking.reference}`,
        metadata: { reference: booking.reference, reason },
        req
    });

    return declined;
};

// The standalone answers tell the buyer; an order's answers are told by the
// order, which is why the `…InTx` functions above write nothing to the outbox.
export const confirmPendingServiceBooking = (reference, actor, req) =>
    prisma.$transaction(async (tx) => {
        const confirmed = await confirmPendingServiceBookingInTx(tx, await findServiceBookingOr404(reference, actor), actor, req);

        await enqueueBuyerEvent(tx, confirmed, TOPICS.SERVICE_BOOKING_CONFIRMED);

        return confirmed;
    });

export const declinePendingServiceBooking = (reference, { reason }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const declined = await declinePendingServiceBookingInTx(
            tx,
            await findServiceBookingOr404(reference, actor),
            { reason },
            actor,
            req
        );

        await enqueueBuyerEvent(tx, declined, TOPICS.SERVICE_BOOKING_DECLINED, { reason });

        return declined;
    });

/** CONFIRMED bookings whose last day has passed roll to COMPLETED. */
export const sweepCompletedServiceBookings = async ({ now = new Date(), limit = 500 } = {}) => {
    const yesterday = dateOnlyToUtc(addDays(now.toISOString().slice(0, 10), -1));

    const due = await prisma.serviceBooking.findMany({
        where: { status: 'CONFIRMED', endDate: { lte: yesterday } },
        select: { id: true, reference: true },
        take: limit
    });

    let completed = 0;

    for (const row of due) {
        await prisma.$transaction(async (tx) => {
            const { count } = await tx.serviceBooking.updateMany({
                where: { id: row.id, status: 'CONFIRMED' },
                data: { status: 'COMPLETED', completedAt: now }
            });

            if (count === 0) {
                return;
            }

            await recordAudit(tx, {
                action: 'SERVICE_BOOKING_COMPLETED',
                actor: null,
                entityType: AUDIT_ENTITY.serviceBooking,
                entityId: row.id,
                summary: `Completed ${row.reference}`,
                metadata: { reference: row.reference }
            });
            completed += 1;
        });
    }

    return { completed };
};
