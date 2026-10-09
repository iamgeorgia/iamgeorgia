import { createHash } from 'node:crypto';

import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { assertReplayOwner } from '../../lib/idempotency.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { syncBookingInTx, syncBookingReceivableInTx, syncPayableInTx } from '../finance/ledger.service.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { nextTourBookingReference } from '../../lib/reference.js';
import { dateOnlyToUtc, toDateOnly } from '../../lib/time.js';
import { readsAllBookings } from '../../middleware/auth.js';
import { readTourOfferToken } from '../../lib/tour/offerToken.js';
import { buildCancellationSchedule, calculateRefund } from '../hotel/policy.service.js';
import { revalidateTourOffer } from './search.service.js';
import {
    commitTourHold,
    createTourHold,
    createTourHoldIn,
    findUsableTourHold,
    releaseBookedTourUnits
} from './availability.service.js';

/**
 * Tour bookings.
 *
 * Modelled on the hotel and transfer booking services, and split the same way
 * from the start: `prepare` outside the transaction, `confirmInTx` inside it,
 * so a package can commit a tour alongside a room and a car in one
 * transaction. The two guarantees are the same:
 *
 *   1. Nothing the client sends about money is believed; the offer is
 *      re-quoted and a price that moved is a 409.
 *   2. The booking is a snapshot. The tour, the option and every price line
 *      are frozen onto it, and the cancellation schedule is the only thing a
 *      cancellation ever reads.
 *
 * What is new is `ON_REQUEST`: an option the operator confirms by hand is
 * written as PENDING with its units already claimed, so a departure that is
 * still being answered cannot be sold twice meanwhile. Confirming or
 * declining is an operations action; declining gives the units back and
 * charges nothing, because the failure is the supplier's.
 */

export const tourBookingInclude = {
    // `supplierId` is selected so the serializer can tell whether the viewer
    // is the operator, which decides whether it sees the net side.
    tour: { select: { id: true, slug: true, title: true, timezone: true, currency: true, supplierId: true } },
    tourOption: { select: { id: true, code: true, name: true, kind: true, confirmationMode: true } },
    partner: { select: { id: true, reference: true, name: true } },
    travellers: { orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }] }
};

const deriveIdempotencyKey = (input) =>
    input.idempotencyKey ??
    createHash('sha256')
        .update(
            [
                input.holdToken ?? input.offerToken ?? '',
                input.leadTraveller.email.toLowerCase(),
                input.leadTraveller.lastName.toLowerCase()
            ].join('|')
        )
        .digest('base64url');

/** The tour and option as they were sold. A voucher reads this, never the live rows. */
const snapshotTour = (tour, option, { departureTime }) => ({
    id: tour.id,
    slug: tour.slug,
    title: tour.title,
    location: tour.location,
    category: tour.category,
    difficulty: tour.difficulty,
    durationDays: tour.durationDays,
    durationLabel: tour.durationLabel,
    timezone: tour.timezone,
    meetingPoint: tour.meetingPoint,
    meetingTime: tour.meetingTime ?? null,
    meetingPointName: tour.meetingPointRef?.name ?? null,
    included: tour.included ?? [],
    excluded: tour.excluded ?? [],
    importantInfo: tour.importantInfo ?? [],
    itinerary: (tour.itinerary ?? []).map((day) => ({ day: day.day, title: day.title })),
    supplierName: tour.supplier?.name ?? null,
    option: {
        id: option.id,
        code: option.code,
        name: option.name,
        kind: option.kind,
        pricingBasis: option.pricingBasis,
        unitKind: option.unitKind,
        languages: option.languages ?? [],
        departureTime: departureTime ?? null
    }
});

/**
 * Everything a confirmation needs before a transaction is opened. `strict`
 * behaves exactly as in the hotel service: throw on a moved price, or report
 * it for an orchestrator to collect.
 */
export const prepareTourBooking = async (input, actor, { strict = true } = {}) => {
    const offer = input.holdToken ? null : readTourOfferToken(input.offerToken);

    let hold = null;
    let priced;
    let quotedCents;

    if (input.holdToken) {
        hold = await findUsableTourHold(prisma, input.holdToken);
        const option = await prisma.tourOption.findUnique({
            where: { id: hold.tourOptionId },
            select: { tourId: true }
        });

        if (!option) {
            throw new NotFoundError('That tour is no longer available');
        }

        priced = await revalidateTourOffer(
            {
                tourId: option.tourId,
                tourOptionId: hold.tourOptionId,
                date: toDateOnly(hold.date),
                adults: hold.adults,
                childAges: hold.childAges,
                quotedSellCents: hold.quotedSellCents,
                currency: hold.currency
            },
            actor,
            // The hold owns the seats; only the price is still in question.
            { strict: false, requireAvailability: false }
        );
        quotedCents = hold.quotedSellCents;
    } else {
        priced = await revalidateTourOffer(offer, actor, { strict });
        quotedCents = offer.quotedSellCents;
    }

    const currentCents = priced.quote.totals.totalCents;
    const priceChanged = currentCents !== quotedCents;

    if (strict && priceChanged) {
        throw new ConflictError('The price for this tour has changed', {
            reason: 'PRICE_CHANGED',
            quotedCents,
            currentCents,
            currency: priced.quote.currency
        });
    }

    return {
        kind: 'TOUR',
        hold,
        priced,
        tour: priced.tour,
        option: priced.option,
        date: priced.date,
        endDate: priced.endDate,
        startAt: priced.startAt,
        departureTime: priced.departureTime,
        party: priced.party,
        units: priced.units,
        adults: priced.party.adultsDeclared,
        childAges: hold ? hold.childAges : offer.childAges ?? [],
        schedule: priced.schedule,
        leadTraveller: input.leadTraveller,
        travellers: input.travellers ?? [],
        specialRequests: input.specialRequests ?? null,
        pickupNote: input.pickupNote ?? null,
        source: input.source ?? 'web',
        priceChanged,
        quotedCents,
        currentCents,
        currency: priced.quote.currency,
        // What an orchestrator claiming several products sorts on.
        lockKey: priced.option.id
    };
};

/** A traveller's own price line, from the quote's per-type lines. */
const unitPriceFor = (quote, type) => {
    const line = quote.lines.find((entry) => entry.travellerType === type);

    return line ? { unitNetCents: line.unitNetCents, unitSellCents: line.unitSellCents } : { unitNetCents: 0, unitSellCents: 0 };
};

/**
 * Writes a prepared booking inside the caller's transaction: claim first, then
 * the booking, then held -> booked, then the audit row. An ON_REQUEST option
 * is written PENDING with a deadline; everything else CONFIRMED.
 */
export const confirmTourBookingInTx = async (tx, prepared, { idempotencyKey, holdTtlMs = 60_000 } = {}, actor, req) => {
    const { hold, priced, tour, option, date, endDate, startAt, party, units, schedule } = prepared;
    const quote = priced.quote;

    const claimedHold =
        hold ??
        (await createTourHoldIn(tx, {
            offer: {
                tourOptionId: option.id,
                date,
                units,
                adults: prepared.adults,
                childAges: prepared.childAges
            },
            quote,
            actor,
            ttlMs: holdTtlMs
        }));

    const onRequest = option.confirmationMode === 'ON_REQUEST';
    const now = new Date();
    const reference = await nextTourBookingReference(tx);

    const lead = prepared.leadTraveller;
    const perType = {
        ADULT: unitPriceFor(quote, option.pricingBasis === 'PER_GROUP' ? 'GROUP' : 'ADULT'),
        CHILD: unitPriceFor(quote, 'CHILD'),
        INFANT: unitPriceFor(quote, 'INFANT')
    };

    // A group price sits on the booking, not on any one traveller.
    const priceFor = (type) => (option.pricingBasis === 'PER_GROUP' ? { unitNetCents: 0, unitSellCents: 0 } : perType[type]);

    const created = await tx.tourBooking.create({
        data: {
            reference,
            status: onRequest ? 'PENDING' : 'CONFIRMED',
            idempotencyKey: idempotencyKey ?? null,
            partnerId: actor?.partnerId ?? null,
            bookedByUserId: actor?.id ?? null,
            tourId: tour.id,
            tourOptionId: option.id,
            date: dateOnlyToUtc(date),
            endDate: dateOnlyToUtc(endDate),
            startAt,
            adults: prepared.adults,
            childAges: prepared.childAges,
            units,
            currency: quote.currency,
            netTotalCents: quote.totals.netCents,
            sellTotalCents: quote.totals.sellCents,
            markupBps: quote.totals.markupBps,
            leadTravellerName: `${lead.firstName} ${lead.lastName}`,
            leadTravellerEmail: lead.email,
            leadTravellerPhone: lead.phone ?? null,
            specialRequests: prepared.specialRequests,
            pickupNote: prepared.pickupNote,
            tourSnapshot: snapshotTour(tour, option, { departureTime: prepared.departureTime }),
            priceLines: quote.lines,
            cancellationSummary: option.cancellationPolicy?.description ?? null,
            cancellationSchedule: schedule,
            confirmationMode: option.confirmationMode,
            ...(onRequest
                ? {
                      requestedAt: now,
                      requestDeadlineAt: new Date(now.getTime() + config.tour.onRequestSlaHours * 60 * 60 * 1000)
                  }
                : { confirmedAt: now }),
            source: prepared.source,
            travellers: {
                create: [
                    {
                        type: 'ADULT',
                        firstName: lead.firstName,
                        lastName: lead.lastName,
                        isLead: true,
                        ...priceFor('ADULT')
                    },
                    ...prepared.travellers.map((traveller) => ({
                        type: traveller.type ?? 'ADULT',
                        firstName: traveller.firstName,
                        lastName: traveller.lastName,
                        age: traveller.age ?? null,
                        passportNumber: traveller.passportNumber ?? null,
                        nationality: traveller.nationality ?? null,
                        dietary: traveller.dietary ?? null,
                        ...priceFor(traveller.type ?? 'ADULT')
                    }))
                ]
            }
        }
    });

    await commitTourHold(tx, claimedHold, created.id);

    await recordAudit(tx, {
        action: 'TOUR_BOOKING_CREATED',
        actor,
        entityType: AUDIT_ENTITY.tourBooking,
        entityId: created.id,
        summary: `${onRequest ? 'Requested' : 'Booked'} ${tour.title} (${option.name}) for ${date}`,
        metadata: {
            reference,
            tourId: tour.id,
            tourOptionId: option.id,
            date,
            units,
            pax: party.pax,
            totalCents: created.sellTotalCents,
            currency: created.currency,
            confirmationMode: option.confirmationMode
        },
        req
    });

    // The operator hears about every booking of its tour, however it was
    // sold; the traveller's own email is the facade's business.
    await enqueueEvent(tx, {
        topic: TOPICS.SUPPLIER_BOOKING_RECEIVED,
        payload: { product: 'tour', bookingId: created.id, requested: onRequest },
        entityType: AUDIT_ENTITY.tourBooking,
        entityId: created.id
    });

    // Owed to the operator once confirmed; an on-request booking owes nothing yet.
    await syncPayableInTx(tx, 'TOUR', created.id, actor, req);

    return tx.tourBooking.findUnique({ where: { id: created.id }, include: tourBookingInclude });
};

/** The traveller's side of a fresh booking: a request or a confirmation, by what was written. */
const enqueueTravellerEvent = (tx, booking, topic, payload = {}) =>
    enqueueEvent(tx, {
        topic,
        payload: { bookingId: booking.id, ...payload },
        entityType: AUDIT_ENTITY.tourBooking,
        entityId: booking.id
    });

export const confirmTourBooking = async (input, actor, req) => {
    const idempotencyKey = deriveIdempotencyKey(input);

    const existing = await prisma.tourBooking.findUnique({
        where: { idempotencyKey },
        include: tourBookingInclude
    });

    // A replay is a read of the original, and is gated like one: the key
    // alone does not prove the caller made the request it names.
    const replayOf = (booking) => {
        assertReplayOwner(() => assertMayRead(booking, actor, { email: input.leadTraveller?.email }));

        return { booking, replayed: true };
    };

    if (existing) {
        return replayOf(existing);
    }

    const prepared = await prepareTourBooking(input, actor);

    try {
        const booking = await prisma.$transaction(async (tx) => {
            const created = await confirmTourBookingInTx(tx, prepared, { idempotencyKey }, actor, req);

            await syncBookingReceivableInTx(tx, 'TOUR', created.id, actor, req);

            await enqueueTravellerEvent(
                tx,
                created,
                created.status === 'PENDING' ? TOPICS.TOUR_BOOKING_REQUESTED : TOPICS.TOUR_BOOKING_CONFIRMED
            );

            return created;
        });

        return { booking, replayed: false };
    } catch (err) {
        if (err?.code === 'P2002') {
            const winner = await prisma.tourBooking.findUnique({
                where: { idempotencyKey },
                include: tourBookingInclude
            });

            if (winner) {
                return replayOf(winner);
            }
        }

        throw err;
    }
};

/** Takes a hold from an offer token, so checkout can secure the seats. */
export const holdTourOffer = async (token, actor) => {
    const offer = readTourOfferToken(token);
    const priced = await revalidateTourOffer(offer, actor);

    const hold = await createTourHold({
        offer: {
            tourOptionId: priced.option.id,
            date: priced.date,
            units: priced.units,
            adults: offer.adults,
            childAges: offer.childAges
        },
        quote: priced.quote,
        actor
    });

    return { hold, priced };
};

/**
 * Who may read a booking: an admin anything, a partner its own, a guest by
 * quoting the lead email. Every failure is a 404 so the sequential references
 * cannot be enumerated.
 */
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

    const matches =
        booking.partnerId === null &&
        typeof email === 'string' &&
        email.trim().toLowerCase() === booking.leadTravellerEmail.toLowerCase();

    if (!matches) {
        throw new NotFoundError('Booking not found');
    }
};

export const findTourBookingOr404 = async (reference, viewer, options = {}) => {
    const booking = await prisma.tourBooking.findFirst({
        where: { OR: [{ id: reference }, { reference }] },
        include: tourBookingInclude
    });

    if (!booking) {
        throw new NotFoundError('Booking not found');
    }

    assertMayRead(booking, viewer, options);

    return booking;
};

export const listTourBookings = async (query, viewer) => {
    const { page, pageSize, status, tourId, partnerId, from, to, search } = query;

    const where = {
        ...(readsAllBookings(viewer) ? { ...(partnerId ? { partnerId } : {}) } : { partnerId: viewer?.partnerId ?? '__none__' }),
        ...(status ? { status: { in: Array.isArray(status) ? status : [status] } } : {}),
        ...(tourId ? { tourId } : {}),
        ...(from || to
            ? { date: { ...(from ? { gte: dateOnlyToUtc(from) } : {}), ...(to ? { lte: dateOnlyToUtc(to) } : {}) } }
            : {}),
        ...(search
            ? {
                  OR: [
                      { reference: { contains: search, mode: 'insensitive' } },
                      { leadTravellerName: { contains: search, mode: 'insensitive' } },
                      { leadTravellerEmail: { contains: search, mode: 'insensitive' } }
                  ]
              }
            : {})
    };

    const [total, bookings] = await Promise.all([
        prisma.tourBooking.count({ where }),
        prisma.tourBooking.findMany({
            where,
            include: tourBookingInclude,
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { bookings, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

/** What cancelling would cost right now, read off the frozen schedule. */
export const quoteTourCancellation = (booking, at = new Date()) => {
    // A request the operator has not answered costs nothing to withdraw.
    if (booking.status === 'PENDING') {
        return { chargeCents: 0, refundCents: booking.sellTotalCents, currency: booking.currency };
    }

    const refund = calculateRefund(booking.cancellationSchedule, at);

    return { chargeCents: refund.chargeCents, refundCents: refund.refundCents, currency: booking.currency };
};

const CANCELLABLE_STATUSES = ['PENDING', 'CONFIRMED'];

/**
 * Cancels an already-loaded booking inside the caller's transaction, giving
 * the units back. `waiveCharges` is for the platform walking away — a
 * declined request, a package whose supplier failed — and records zero.
 */

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

export const cancelTourBookingInTx = async (tx, booking, { reason, waiveCharges = false } = {}, actor, req) => {
    if (!CANCELLABLE_STATUSES.includes(booking.status)) {
        throw new ConflictError('That booking cannot be cancelled', {
            reason: 'NOT_CANCELLABLE',
            status: booking.status
        });
    }

    const quote = waiveCharges
        ? { chargeCents: 0, refundCents: booking.sellTotalCents, currency: booking.currency }
        : quoteTourCancellation(booking);

    if (booking.tourOptionId) {
        await releaseBookedTourUnits(tx, {
            tourOptionId: booking.tourOptionId,
            date: booking.date,
            quantity: booking.units
        });
    }

    const cancelled = await tx.tourBooking.update({
        where: { id: booking.id },
        data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancellationChargeCents: quote.chargeCents,
            cancellationReason: reason ?? null
        },
        include: tourBookingInclude
    });

    await recordAudit(tx, {
        action: 'TOUR_BOOKING_CANCELLED',
        actor,
        entityType: AUDIT_ENTITY.tourBooking,
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
        payload: { product: 'tour', bookingId: booking.id, reason: reason ?? null },
        entityType: AUDIT_ENTITY.tourBooking,
        entityId: booking.id
    });

    await syncBookingInTx(tx, 'TOUR', booking.id, actor, req);

    return { booking: cancelled, quote };
};

export const cancelTourBooking = async (reference, { reason, email } = {}, actor, req) =>
    prisma.$transaction(async (tx) => {
        const booking = await tx.tourBooking.findFirst({
            where: { OR: [{ id: reference }, { reference }] },
            include: tourBookingInclude
        });

        if (!booking) {
            throw new NotFoundError('Booking not found');
        }

        await assertNotInOrder(tx, 'tourBookingId', booking.id);

        assertMayRead(booking, actor, { email });

        const result = await cancelTourBookingInTx(tx, booking, { reason }, actor, req);

        await enqueueTravellerEvent(tx, booking, TOPICS.TOUR_BOOKING_CANCELLED, {
            chargeCents: result.quote.chargeCents,
            reason: reason ?? null
        });

        return result;
    });

const assertPending = (booking) => {
    if (booking.status !== 'PENDING') {
        throw new ConflictError('That booking is not awaiting confirmation', {
            reason: 'NOT_PENDING',
            status: booking.status
        });
    }
};

/** The operator says yes. The price was frozen at request; nothing is re-quoted. */
export const confirmPendingTourBookingInTx = async (tx, booking, actor, req) => {
    assertPending(booking);

    const confirmed = await tx.tourBooking.update({
        where: { id: booking.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
        include: tourBookingInclude
    });

    await recordAudit(tx, {
        action: 'TOUR_BOOKING_CONFIRMED',
        actor,
        entityType: AUDIT_ENTITY.tourBooking,
        entityId: booking.id,
        summary: `Confirmed request ${booking.reference}`,
        metadata: { reference: booking.reference },
        req
    });

    // The yes is what makes it owed, on both sides. A booking inside an order
    // is skipped on the buyer's side by the ledger itself.
    await syncBookingInTx(tx, 'TOUR', booking.id, actor, req);

    return confirmed;
};

/** The operator says no. Units go back and nothing is charged. */
export const declinePendingTourBookingInTx = async (tx, booking, { reason }, actor, req) => {
    assertPending(booking);

    if (booking.tourOptionId) {
        await releaseBookedTourUnits(tx, {
            tourOptionId: booking.tourOptionId,
            date: booking.date,
            quantity: booking.units
        });
    }

    const declined = await tx.tourBooking.update({
        where: { id: booking.id },
        data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            declinedAt: new Date(),
            declineReason: reason,
            cancellationChargeCents: 0,
            cancellationReason: reason
        },
        include: tourBookingInclude
    });

    await recordAudit(tx, {
        action: 'TOUR_BOOKING_DECLINED',
        actor,
        entityType: AUDIT_ENTITY.tourBooking,
        entityId: booking.id,
        summary: `Declined request ${booking.reference}`,
        metadata: { reference: booking.reference, reason },
        req
    });

    return declined;
};

const loadForOps = async (tx, reference) => {
    const booking = await tx.tourBooking.findFirst({
        where: { OR: [{ id: reference }, { reference }] },
        include: tourBookingInclude
    });

    if (!booking) {
        throw new NotFoundError('Booking not found');
    }

    return booking;
};

// The standalone answers tell the traveller; an order's answers are told by
// the order (`ORDER_CONFIRMED`, `ORDER_ITEM_DECLINED`), which is why the
// `…InTx` functions above write nothing to the outbox themselves.
export const confirmPendingTourBooking = (reference, actor, req) =>
    prisma.$transaction(async (tx) => {
        const confirmed = await confirmPendingTourBookingInTx(tx, await loadForOps(tx, reference), actor, req);

        await enqueueTravellerEvent(tx, confirmed, TOPICS.TOUR_BOOKING_CONFIRMED);

        return confirmed;
    });

export const declinePendingTourBooking = (reference, { reason }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const declined = await declinePendingTourBookingInTx(tx, await loadForOps(tx, reference), { reason }, actor, req);

        await enqueueTravellerEvent(tx, declined, TOPICS.TOUR_BOOKING_DECLINED, { reason });

        return declined;
    });

const AMENDABLE_STATUSES = ['PENDING', 'CONFIRMED'];

/** Paperwork only: who is travelling and how to reach them. Nothing priced is reachable. */
export const amendTourBooking = async (reference, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const booking = await tx.tourBooking.findFirst({
            where: { OR: [{ id: reference }, { reference }] },
            include: tourBookingInclude
        });

        if (!booking) {
            throw new NotFoundError('Booking not found');
        }

        assertMayRead(booking, actor, { email: input.email });

        if (!AMENDABLE_STATUSES.includes(booking.status)) {
            throw new ConflictError('This booking can no longer be amended', { status: booking.status });
        }

        const lead = input.leadTraveller ?? {};
        const renamed = lead.firstName !== undefined || lead.lastName !== undefined;
        const current = booking.travellers.find((traveller) => traveller.isLead);
        const firstName = lead.firstName ?? current?.firstName ?? booking.leadTravellerName;
        const lastName = lead.lastName ?? current?.lastName ?? '';

        const data = {
            ...(renamed ? { leadTravellerName: `${firstName} ${lastName}`.trim() } : {}),
            ...(lead.email !== undefined ? { leadTravellerEmail: lead.email } : {}),
            ...(lead.phone !== undefined ? { leadTravellerPhone: lead.phone ?? null } : {}),
            ...(input.specialRequests !== undefined ? { specialRequests: input.specialRequests ?? null } : {}),
            ...(input.pickupNote !== undefined ? { pickupNote: input.pickupNote ?? null } : {})
        };

        const fields = Object.keys(data);

        if (fields.length === 0) {
            return booking;
        }

        if (renamed && current) {
            await tx.tourBookingTraveller.update({ where: { id: current.id }, data: { firstName, lastName } });
        }

        await tx.tourBooking.update({ where: { id: booking.id }, data });

        await recordAudit(tx, {
            action: 'TOUR_BOOKING_AMENDED',
            actor,
            entityType: AUDIT_ENTITY.tourBooking,
            entityId: booking.id,
            summary: `Amended ${booking.reference}`,
            metadata: { reference: booking.reference, fields },
            req
        });

        return tx.tourBooking.findUnique({ where: { id: booking.id }, include: tourBookingInclude });
    });

/**
 * Rolls confirmed bookings whose last day has passed to COMPLETED.
 *
 * Hotels never do this; tours need it so an order made of them can complete.
 * Advisory lock, so every instance may run it and one will.
 */
export const sweepCompletedTourBookings = async ({ now = new Date(), limit = 500 } = {}) => {
    const [{ locked }] = await prisma.$queryRaw`
        SELECT pg_try_advisory_lock(hashtext('tour_completion_sweep')) AS locked
    `;

    if (!locked) {
        return { completed: 0, skipped: true };
    }

    try {
        // A day tour is over by the end of its date in the tour's zone; a full
        // calendar day of grace keeps a late-running trek from being closed
        // while it is still on the mountain.
        const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const due = await prisma.tourBooking.findMany({
            where: { status: 'CONFIRMED', endDate: { lt: cutoff } },
            select: { id: true, reference: true },
            take: limit
        });

        for (const booking of due) {
            await prisma.$transaction(async (tx) => {
                await tx.tourBooking.update({
                    where: { id: booking.id, status: 'CONFIRMED' },
                    data: { status: 'COMPLETED', completedAt: now }
                });
                await recordAudit(tx, {
                    action: 'TOUR_BOOKING_COMPLETED',
                    actor: null,
                    entityType: AUDIT_ENTITY.tourBooking,
                    entityId: booking.id,
                    summary: `Completed ${booking.reference}`,
                    metadata: { reference: booking.reference }
                });
            });
        }

        return { completed: due.length, skipped: false };
    } finally {
        await prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext('tour_completion_sweep'))`;
    }
};

/** Requests past their deadline and still unanswered, for the operations queue. */
export const listOverdueTourRequests = ({ now = new Date(), limit = 100 } = {}) =>
    prisma.tourBooking.findMany({
        where: { status: 'PENDING', requestDeadlineAt: { lt: now } },
        include: tourBookingInclude,
        orderBy: { requestDeadlineAt: 'asc' },
        take: limit
    });

/**
 * Tells operations about requests nobody has answered in time.
 *
 * Once per booking: the stamp and the outbox event are written in one
 * transaction, and the conditional update is what makes a second sweeper on
 * another instance find nothing to do. Nothing auto-declines — a late answer
 * is still an answer.
 */
export const sweepOverdueTourRequests = async ({ now = new Date(), limit = 100 } = {}) => {
    const due = await prisma.tourBooking.findMany({
        where: { status: 'PENDING', requestDeadlineAt: { lt: now }, overdueAlertAt: null },
        select: { id: true, reference: true },
        take: limit
    });

    let alerted = 0;

    for (const booking of due) {
        await prisma.$transaction(async (tx) => {
            const { count } = await tx.tourBooking.updateMany({
                where: { id: booking.id, status: 'PENDING', overdueAlertAt: null },
                data: { overdueAlertAt: now }
            });

            if (count === 0) {
                return;
            }

            await enqueueEvent(tx, {
                topic: TOPICS.TOUR_REQUEST_OVERDUE,
                payload: { bookingId: booking.id },
                entityType: AUDIT_ENTITY.tourBooking,
                entityId: booking.id
            });
            alerted += 1;
        });
    }

    return { alerted };
};

export { assertMayRead as assertMayReadTourBooking };
