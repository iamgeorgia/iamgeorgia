import { createHash } from 'node:crypto';

import { prisma } from '../../db/index.js';
import { AUDIT_ENTITY, recordAudit } from '../../lib/audit.js';
import { syncBookingInTx, syncBookingReceivableInTx, syncPayableInTx } from '../finance/ledger.service.js';
import { assertCreditInTx } from '../finance/credit.service.js';
import { BadRequestError, ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { assertReplayOwner } from '../../lib/idempotency.js';
import { sqlStateOf } from '../../middleware/errors.js';
import { nextTransferBookingReference } from '../../lib/reference.js';
import { dateOnlyToUtc } from '../../lib/time.js';
import { CAPABILITIES, can } from '../../lib/permissions.js';
import { buildCancellationSchedule, calculateRefund, freeCancellationUntil } from '../hotel/policy.service.js';
import { revalidateQuote } from './quote.service.js';
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../lib/transfer/machines.js';
import { assignDriverInTx, cascadeBookingCancellation } from './dispatch.service.js';

/**
 * Confirming, reading, amending and cancelling a transfer.
 *
 * Modelled beat for beat on `services/hotel/booking.service.js`, because the
 * hard parts are identical and solving them twice differently would guarantee
 * the two disagreed:
 *
 *   * the idempotency replay is answered **before** anything else happens;
 *   * the re-quote runs **outside** the transaction, which reads a lot;
 *   * a fare that moved is a 409 the traveller re-confirms, never absorbed;
 *   * the cancellation schedule is frozen at confirmation and is the only
 *     thing a cancellation ever reads;
 *   * nothing slow happens inside the transaction — no email, no HTTP.
 *
 * What is different is what is *not* here: no inventory claim, because a
 * transfer has none. The transaction writes the booking and its legs and that
 * is all, which makes it shorter than the hotel one rather than more clever.
 */

const bookingInclude = {
    legs: {
        orderBy: { legIndex: 'asc' },
        include: {
            fromPoint: { select: { id: true, kind: true, timezone: true } },
            rating: { select: { id: true, score: true, status: true } },
            assignments: {
                where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
                include: {
                    driver: {
                        include: {
                            photo: { include: { variants: true } },
                            provider: { select: { id: true, slug: true, name: true } }
                        }
                    },
                    fleetVehicle: { include: { mainImage: { include: { variants: true } } } },
                    assignedByUser: { select: { id: true, email: true, firstName: true, lastName: true, partnerId: true } }
                }
            }
        }
    },
    extras: true,
    vehicle: { select: { id: true, slug: true, name: true, partnerId: true } },
    route: { select: { id: true, slug: true } },
    partner: { select: { id: true, reference: true, name: true } }
};

/**
 * A key derived from the request when the client did not send one.
 *
 * A double-clicked submit button produces two identical requests, and without
 * this the second one dispatches a second car. Derived from the things that
 * make this booking *this* booking rather than from a timestamp, which would
 * differ between the two and defeat the point.
 */
const deriveIdempotencyKey = (input) =>
    input.idempotencyKey ??
    createHash('sha256')
        .update(
            [
                input.quoteToken,
                input.leadPassenger.email.toLowerCase(),
                input.leadPassenger.lastName.toLowerCase()
            ].join('|')
        )
        .digest('base64url');

/** The journey as it was sold. A voucher reads this, never the live route. */
const snapshotRoute = (from, to, route, legs) => ({
    fromSlug: from.slug,
    fromName: from.name,
    fromRegion: from.regionLabel,
    fromKind: from.kind,
    fromTimezone: from.timezone,
    toSlug: to.slug,
    toName: to.name,
    toRegion: to.regionLabel,
    toKind: to.kind,
    routeSlug: route?.slug ?? null,
    routeTitle: route?.title ?? null,
    distanceKm: legs[0]?.distanceKm ?? null,
    durationMinutes: legs[0]?.durationMinutes ?? null,
    stops: (route?.stops ?? []).map((stop) => ({ name: stop.point.name, dwellMinutes: stop.dwellMinutes }))
});

const snapshotVehicle = (vehicle) => ({
    slug: vehicle.slug,
    name: vehicle.name,
    vehicleClass: vehicle.vehicleClass,
    body: vehicle.body,
    kind: vehicle.kind,
    vehicleExample: vehicle.vehicleExample,
    maxPassengers: vehicle.maxPassengers,
    maxLuggage: vehicle.maxLuggage,
    features: vehicle.features ?? [],
    providerName: vehicle.provider?.name ?? null,
    pickupProcedure: vehicle.pickupProcedure,
    included: vehicle.included ?? [],
    excluded: vehicle.excluded ?? []
});

/** Who may ask for a particular driver: a partner, or operations booking for one. */
const mayChooseDriver = (actor) =>
    Boolean(actor?.partnerId) || can(actor, CAPABILITIES.BOOKINGS_WRITE, CAPABILITIES.DISPATCH_WRITE);

/** Staff who read every transfer booking: the booking desks, and operations who dispatch against them. */
const readsAllTransfers = (viewer) => can(viewer, CAPABILITIES.BOOKINGS_READ, CAPABILITIES.DISPATCH_READ);

const notEligible = (message, field) =>
    new UnprocessableEntityError(message, { reason: 'DRIVER_NOT_ELIGIBLE', field });

/**
 * The driver a partner asked for, checked before a single leg is offered.
 *
 * The same bar `availableDriversForQuote` set when it drew up the list —
 * active, verified, in a car on the road that is sold as the booked class,
 * linked to them, and big enough for the party — so a list entry and a
 * confirmation agree. The car defaults to the driver's primary one of that
 * class. Availability is not checked here: the offer itself does that,
 * under the driver's row lock.
 */
const resolvePreferredDriver = async (tx, input, { vehicle, booking }) => {
    const driver = await tx.transferDriver.findUnique({
        where: { id: input.preferredDriverId },
        include: {
            vehicles: {
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                include: { fleetVehicle: true }
            }
        }
    });

    if (!driver || !driver.isActive || driver.verificationStatus !== 'VERIFIED') {
        throw notEligible('That driver cannot be requested for this journey', 'preferredDriverId');
    }

    const passengers = booking.adults + booking.children;
    const eligible = driver.vehicles
        .map((link) => link.fleetVehicle)
        .filter(
            (car) =>
                car.status === 'ACTIVE' &&
                car.vehicleClassId === vehicle.id &&
                car.passengerCapacity >= passengers &&
                car.luggageCapacity >= booking.luggage
        );

    const car = input.preferredFleetVehicleId
        ? eligible.find((candidate) => candidate.id === input.preferredFleetVehicleId)
        : eligible[0];

    if (!car) {
        throw notEligible(
            'That driver has no suitable car for this journey',
            input.preferredFleetVehicleId ? 'preferredFleetVehicleId' : 'preferredDriverId'
        );
    }

    return { driverId: driver.id, fleetVehicleId: car.id };
};

/** What a partner is told when the driver they chose was taken while they typed. */
const driverUnavailable = (conflicts = []) =>
    new ConflictError('That driver is no longer free for this journey — choose another, or let us assign one', {
        reason: 'DRIVER_UNAVAILABLE',
        conflicts
    });

/** A guest cannot name a driver; a partner or operations may. Checked before anything is read. */
const assertMayChooseDriver = (input, actor) => {
    if (input.preferredDriverId && !mayChooseDriver(actor)) {
        throw new BadRequestError('Choosing a driver is available to partner accounts', {
            field: 'preferredDriverId'
        });
    }
};

/**
 * Everything a confirmation needs before a transaction is opened: the fresh
 * fare and the frozen cancellation schedule. Reads a lot, holds no locks.
 *
 * Split from the commit for the same reason as the hotel one — a package
 * prepares every product up front and commits them together. With `strict`
 * (the default) a fare that moved is a 409 thrown here; with `strict: false`
 * the result carries `priceChanged` and both figures so an orchestrator can
 * report every drifted component at once.
 */
export const prepareTransferBooking = async (input, actor, { strict = true } = {}) => {
    assertMayChooseDriver(input, actor);

    // Re-quoted from scratch. The token names the journey; it does not set the
    // price, and a fare that has moved since it was issued raises here.
    const offer = await revalidateQuote(input.quoteToken, actor, { strict });
    const { vehicle, quote, from, to, route, decoded } = offer;

    const schedule = buildCancellationSchedule({
        rules: vehicle.cancellationPolicy?.rules ?? [],
        // A transfer's deadline is measured from the pick-up, which is what
        // `checkInDate` and `checkInTime` mean to this function: the moment the
        // thing being cancelled was due to start.
        checkInDate: decoded.date,
        checkInTime: decoded.time,
        timezone: from.timezone,
        // One "night": a transfer is charged whole, so the tiers are
        // proportions of the total fare rather than of a nightly rate.
        nightlyCents: [quote.totals.sellCents],
        currency: quote.currency,
        bookedAt: new Date()
    });

    return {
        kind: 'TRANSFER',
        vehicle,
        quote,
        from,
        to,
        route,
        decoded,
        schedule,
        leadPassenger: input.leadPassenger,
        flightNumber: input.flightNumber ?? null,
        pickupAddress: input.pickupAddress ?? null,
        dropoffAddress: input.dropoffAddress ?? null,
        pickupPlace: input.pickupPlace ?? null,
        dropoffPlace: input.dropoffPlace ?? null,
        specialRequests: input.specialRequests ?? null,
        source: input.source ?? 'web',
        preferredDriverId: input.preferredDriverId ?? null,
        preferredFleetVehicleId: input.preferredFleetVehicleId ?? null,
        priceChanged: quote.totals.sellCents !== decoded.quotedSellCents,
        quotedCents: decoded.quotedSellCents,
        currentCents: quote.totals.sellCents,
        currency: quote.currency,
        // A transfer claims no inventory, so there is nothing to order locks on.
        lockKey: null
    };
};

/**
 * Writes a prepared transfer inside the caller's transaction: the booking, its
 * legs and extras, the audit row, and — when a partner named a driver — the
 * offer on every leg, so a driver who is no longer free rolls the whole
 * thing back and the partner chooses again.
 */
export const confirmTransferBookingInTx = async (tx, prepared, { idempotencyKey } = {}, actor, req) => {
    const { vehicle, quote, from, to, route, decoded, schedule } = prepared;

    const reference = await nextTransferBookingReference(tx);

    const created = await tx.transferBooking.create({
        data: {
            reference,
            status: 'CONFIRMED',
            idempotencyKey: idempotencyKey ?? null,
            partnerId: actor?.partnerId ?? null,
            bookedByUserId: actor?.id ?? null,
            routeId: route?.id ?? null,
            vehicleId: vehicle.id,
            tripType: decoded.tripType,
            pickupAt: quote.legs[0].pickupAt,
            returnPickupAt: quote.legs[1]?.pickupAt ?? null,
            adults: decoded.adults,
            children: decoded.children,
            childAges: decoded.childAges ?? [],
            luggage: decoded.luggage,
            cabinBags: decoded.cabinBags,
            currency: quote.currency,
            netTotalCents: quote.totals.netCents,
            sellTotalCents: quote.totals.sellCents,
            markupBps: quote.totals.markupBps,
            commissionRateBps: actor?.partner?.commissionRateBps ?? null,
            leadPassengerName: `${prepared.leadPassenger.firstName} ${prepared.leadPassenger.lastName}`,
            leadPassengerEmail: prepared.leadPassenger.email,
            leadPassengerPhone: prepared.leadPassenger.phone ?? null,
            flightNumber: prepared.flightNumber,
            pickupAddress: prepared.pickupAddress,
            dropoffAddress: prepared.dropoffAddress,
            pickupPlace: prepared.pickupPlace,
            dropoffPlace: prepared.dropoffPlace,
            specialRequests: prepared.specialRequests,
            routeSnapshot: snapshotRoute(from, to, route, quote.legs),
            vehicleSnapshot: snapshotVehicle(vehicle),
            cancellationSchedule: schedule,
            confirmedAt: new Date(),
            source: prepared.source,
            legs: {
                create: quote.legs.map((leg, index) => ({
                    legIndex: index,
                    direction: leg.direction,
                    fromPointId: leg.fromPointId,
                    toPointId: leg.toPointId,
                    fromPointName: leg.fromPointName,
                    toPointName: leg.toPointName,
                    pickupAt: leg.pickupAt,
                    distanceKm: leg.distanceKm,
                    durationMinutes: leg.durationMinutes,
                    netCents: leg.netCents,
                    sellCents: leg.sellCents
                }))
            },
            // Extras are summed across the legs: a return buys the
            // child seat twice, and the booking records one line for it
            // at the total quantity and total price.
            extras: {
                create: aggregateExtras(quote.legs)
            }
        },
        include: bookingInclude
    });

    await recordAudit(tx, {
        action: 'TRANSFER_BOOKING_CREATED',
        actor,
        entityType: AUDIT_ENTITY.transferBooking,
        entityId: created.id,
        summary: `Transfer ${created.reference} confirmed: ${from.name} to ${to.name}`,
        metadata: { reference: created.reference, vehicle: vehicle.slug, totalCents: created.sellTotalCents },
        req
    });

    // What we now owe the transfer company, on its terms.
    await syncPayableInTx(tx, 'TRANSFER', created.id, actor, req);

    if (!prepared.preferredDriverId) {
        return created;
    }

    const chosen = await resolvePreferredDriver(tx, prepared, { vehicle, booking: created });

    for (const leg of created.legs) {
        await assignDriverInTx(
            tx,
            leg.id,
            { ...chosen, acceptOnBehalf: false, requestedByPartner: true, note: 'Requested by the partner at booking' },
            actor,
            req
        );
    }

    return tx.transferBooking.findUnique({ where: { id: created.id }, include: bookingInclude });
};

/**
 * The chosen driver was taken between the list and the confirmation: the
 * service's pre-check under the row lock, or the exclusion constraint behind
 * it. Either way the transaction rolled back, and the partner is told to
 * choose again. Null when the error is something else.
 */
export const driverConflictFor = (err, prepared) => {
    if (!prepared?.preferredDriverId) {
        return null;
    }

    if (sqlStateOf(err) === '23P01') {
        return driverUnavailable();
    }

    if (err instanceof ConflictError && err.details?.reason === 'SCHEDULE_CONFLICT') {
        return driverUnavailable(err.details.conflicts);
    }

    return null;
};

/**
 * Confirms a transfer on its own.
 *
 * Idempotent: a repeated `Idempotency-Key` returns the original booking with a
 * 200 rather than making a second one with a 201.
 */
export const confirmTransferBooking = async (input, actor, req) => {
    assertMayChooseDriver(input, actor);

    const idempotencyKey = deriveIdempotencyKey(input);

    // Answered first, before anything is written, so a retry can never produce
    // a second dispatch.
    const existing = await prisma.transferBooking.findUnique({
        where: { idempotencyKey },
        include: bookingInclude
    });

    // A replay is a read of the original, and is gated like one: the key
    // alone does not prove the caller made the request it names.
    const replayOf = (booking) => {
        assertReplayOwner(() => assertMayRead(booking, actor, { email: input.leadPassenger?.email }));

        return { booking, replayed: true };
    };

    if (existing) {
        return replayOf(existing);
    }

    const prepared = await prepareTransferBooking(input, actor);

    try {
        const booking = await prisma.$transaction(async (tx) => {
            await assertCreditInTx(tx, actor?.partnerId, { addCents: prepared.quote.totals.sellCents, currency: prepared.quote.currency }, actor, req);

            const created = await confirmTransferBookingInTx(tx, prepared, { idempotencyKey }, actor, req);

            // What the buyer owes; an order's transfer is owed through the order.
            await syncBookingReceivableInTx(tx, 'TRANSFER', created.id, actor, req);

            return created;
        });

        return { booking, replayed: false };
    } catch (err) {
        // Two identical requests in flight at once: the loser reads back what
        // the winner wrote and reports it as the replay it is.
        if (err?.code === 'P2002') {
            const raced = await prisma.transferBooking.findUnique({
                where: { idempotencyKey },
                include: bookingInclude
            });

            if (raced) {
                return replayOf(raced);
            }
        }

        const conflict = driverConflictFor(err, prepared);

        if (conflict) {
            throw conflict;
        }

        throw err;
    }
};

/** One line per extra, summed across every leg it was bought on. */
const aggregateExtras = (legs) => {
    const totals = new Map();

    for (const leg of legs) {
        for (const extra of leg.extras ?? []) {
            const entry = totals.get(extra.code) ?? {
                code: extra.code,
                name: extra.name,
                quantity: 0,
                unitCents: extra.unitCents,
                totalCents: 0
            };

            entry.quantity += extra.quantity;
            entry.totalCents += extra.totalCents;
            totals.set(extra.code, entry);
        }
    }

    return [...totals.values()];
};

/**
 * Who may read a booking.
 *
 * Every failure is a 404 rather than a 403, and that is not politeness: the
 * references come from a sequence and are trivially enumerable, so a 403 would
 * turn this endpoint into a way of discovering which ones exist.
 */
const assertMayRead = (booking, viewer, { email } = {}) => {
    if (readsAllTransfers(viewer)) {
        return;
    }

    if (viewer?.partnerId) {
        if (booking.partnerId !== viewer.partnerId) {
            throw new NotFoundError('That booking does not exist');
        }

        return;
    }

    // An anonymous traveller proves it with the email they booked under. A
    // partner booking is never readable this way, whatever email is quoted.
    const matches =
        booking.partnerId === null &&
        typeof email === 'string' &&
        email.toLowerCase() === booking.leadPassengerEmail.toLowerCase();

    if (!matches) {
        throw new NotFoundError('That booking does not exist');
    }
};

/**
 * Who may change a booking: cancel it or amend its paperwork.
 *
 * Narrower than reading. Operations and finance read every booking, but a
 * dispatcher never touches money, and a cancellation is money: it fixes the
 * charge and the refund. So of the platform side only the roles holding the
 * capability pass (`bookings.cancel` to cancel, `bookings.write` to amend);
 * everyone else needs the same proof a read does — their own partner's
 * booking, or the lead passenger's email. Staff who may read but not change
 * are answered as a stranger would be, with a 404.
 */
const assertMayMutate = (booking, viewer, { capability, ...options }) => {
    if (can(viewer, capability)) {
        return;
    }

    if (readsAllTransfers(viewer)) {
        throw new NotFoundError('That booking does not exist');
    }

    assertMayRead(booking, viewer, options);
};

export const findTransferBookingOr404 = async (reference, viewer, options = {}) => {
    const booking = await prisma.transferBooking.findUnique({
        where: { reference },
        include: bookingInclude
    });

    if (!booking) {
        throw new NotFoundError('That booking does not exist');
    }

    assertMayRead(booking, viewer, options);

    return booking;
};

export const listTransferBookings = async (query, viewer) => {
    const { page, pageSize, status, from, to, search } = query;

    const where = {
        // Scoped in the query rather than filtered after, so there is no path
        // by which one partner reads another's.
        ...(readsAllTransfers(viewer) ? {} : { partnerId: viewer?.partnerId ?? '__none__' }),
        ...(status ? { status: Array.isArray(status) ? { in: status } : status } : {}),
        ...(from || to
            ? {
                  pickupAt: {
                      ...(from ? { gte: dateOnlyToUtc(from) } : {}),
                      ...(to ? { lte: new Date(dateOnlyToUtc(to).getTime() + 86_399_000) } : {})
                  }
              }
            : {}),
        ...(search
            ? {
                  OR: [
                      { reference: { contains: search, mode: 'insensitive' } },
                      { leadPassengerName: { contains: search, mode: 'insensitive' } },
                      { leadPassengerEmail: { contains: search, mode: 'insensitive' } }
                  ]
              }
            : {})
    };

    const [total, bookings] = await Promise.all([
        prisma.transferBooking.count({ where }),
        prisma.transferBooking.findMany({
            where,
            include: bookingInclude,
            orderBy: { pickupAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { bookings, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

/**
 * What cancelling would cost right now.
 *
 * Read entirely off the frozen schedule. The vehicle's current policy is never
 * consulted, which is the point of freezing it: terms tightened in March cannot
 * change what a January traveller is owed.
 */
export const quoteTransferCancellation = (booking, at = new Date()) => {
    const refund = calculateRefund(booking.cancellationSchedule, at);

    return {
        chargeCents: refund.chargeCents,
        refundCents: refund.refundCents,
        currency: refund.currency,
        freeUntil: freeCancellationUntil(booking.cancellationSchedule),
        asAt: (at instanceof Date ? at : new Date(at)).toISOString()
    };
};

const CANCELLABLE_STATUSES = ['PENDING', 'CONFIRMED'];

/**
 * Cancels an already-loaded booking inside the caller's transaction.
 *
 * The legs go first: that is what refuses a cancellation once a passenger is
 * in the car, and what tells the driver of one on the way. `waiveCharges` is
 * for the platform walking away rather than the traveller — a package whose
 * supplier declined — and records a zero charge without reading the schedule.
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

export const cancelTransferBookingInTx = async (tx, booking, { reason, waiveCharges = false } = {}, actor, req) => {
    if (!CANCELLABLE_STATUSES.includes(booking.status)) {
        throw new ConflictError('That booking cannot be cancelled', {
            reason: 'NOT_CANCELLABLE',
            status: booking.status
        });
    }

    const quote = waiveCharges
        ? {
              chargeCents: 0,
              refundCents: booking.sellTotalCents,
              currency: booking.currency,
              freeUntil: null,
              asAt: new Date().toISOString()
          }
        : quoteTransferCancellation(booking);

    await cascadeBookingCancellation(tx, booking.id, actor, req);

    // The status the charge was computed against is part of the WHERE, so a
    // cancellation racing a second cancellation, or a driver completing the
    // trip, cannot write over a row that has moved on: the update finds no
    // row and the whole transaction, cascade included, is rolled back.
    const result = await tx.transferBooking
        .update({
            where: { id: booking.id, status: { in: CANCELLABLE_STATUSES } },
            data: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                cancellationChargeCents: quote.chargeCents,
                cancellationReason: reason ?? null
            },
            include: bookingInclude
        })
        .catch((err) => {
            if (err?.code === 'P2025') {
                throw new ConflictError('That booking cannot be cancelled', { reason: 'NOT_CANCELLABLE' });
            }

            throw err;
        });

    await recordAudit(tx, {
        action: 'TRANSFER_BOOKING_CANCELLED',
        actor,
        entityType: AUDIT_ENTITY.transferBooking,
        entityId: booking.id,
        summary: `Transfer ${booking.reference} cancelled`,
        metadata: {
            chargeCents: quote.chargeCents,
            reason: reason ?? null,
            ...(waiveCharges ? { waived: true } : {})
        },
        req
    });

    await syncBookingInTx(tx, 'TRANSFER', booking.id, actor, req);

    return { booking: result, quote };
};

/**
 * Cancels a booking by reference.
 *
 * Read, checked and written inside one transaction, as the hotel module does
 * it: a booking read before the transaction opened is a booking whose status
 * may have moved by the time the charge is written against it.
 */
export const cancelTransferBooking = async (reference, { reason, email } = {}, actor, req) =>
    prisma.$transaction(async (tx) => {
        const booking = await tx.transferBooking.findUnique({ where: { reference }, include: bookingInclude });

        if (!booking) {
            throw new NotFoundError('That booking does not exist');
        }

        assertMayMutate(booking, actor, { email, capability: CAPABILITIES.BOOKINGS_CANCEL });

        await assertNotInOrder(tx, 'transferBookingId', booking.id);

        return cancelTransferBookingInTx(tx, booking, { reason }, actor, req);
    });

const AMENDABLE_STATUSES = ['PENDING', 'CONFIRMED'];

/**
 * Amends the paperwork on a booking.
 *
 * Deliberately narrow. Nothing that was priced is reachable, so this endpoint
 * cannot change what a transfer costs — moving the pick-up means cancelling and
 * booking again, because the fare has to be re-quoted against the new time and
 * the driver re-rostered.
 */
export const amendTransferBooking = async (reference, input, actor, req) => {
    const { email, leadPassenger, ...rest } = input;
    const booking = await findTransferBookingOr404(reference, actor, { email });

    assertMayMutate(booking, actor, { email, capability: CAPABILITIES.BOOKINGS_WRITE });

    if (!AMENDABLE_STATUSES.includes(booking.status)) {
        throw new ConflictError('That booking can no longer be amended', {
            reason: 'NOT_AMENDABLE',
            status: booking.status
        });
    }

    const data = { ...rest };

    if (leadPassenger) {
        const firstName = leadPassenger.firstName ?? booking.leadPassengerName.split(' ')[0];
        const lastName =
            leadPassenger.lastName ?? booking.leadPassengerName.split(' ').slice(1).join(' ');

        data.leadPassengerName = `${firstName} ${lastName}`.trim();

        if (leadPassenger.email) data.leadPassengerEmail = leadPassenger.email;
        if (leadPassenger.phone !== undefined) data.leadPassengerPhone = leadPassenger.phone;
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.transferBooking.update({
            where: { id: booking.id },
            data,
            include: bookingInclude
        });

        await recordAudit(tx, {
            action: 'TRANSFER_BOOKING_AMENDED',
            actor,
            entityType: AUDIT_ENTITY.transferBooking,
            entityId: booking.id,
            summary: `Transfer ${booking.reference} amended`,
            metadata: { fields: Object.keys(data) },
            req
        });

        return updated;
    });
};

export { bookingInclude, assertMayRead };

/** The include an order needs to read this product's bookings by the same shape. */
export const transferBookingInclude = bookingInclude;

/**
 * The transfer bookings screen's tiles: how many journeys, how many
 * confirmed, and what the confirmed ones are worth — summed in the database
 * and grouped by currency, not over "the most recent 100" as the page used
 * to do.
 */
export const summarizeTransferBookings = async () => {
    const [total, confirmed, grouped] = await Promise.all([
        prisma.transferBooking.count(),
        prisma.transferBooking.count({ where: { status: 'CONFIRMED' } }),
        prisma.transferBooking.groupBy({
            by: ['currency'],
            where: { status: 'CONFIRMED' },
            _sum: { sellTotalCents: true },
            _count: { _all: true }
        })
    ]);

    return {
        total,
        confirmed,
        confirmedValue: {
            byCurrency: grouped
                .map((row) => ({
                    currency: row.currency,
                    amountCents: row._sum.sellTotalCents ?? 0,
                    count: row._count._all
                }))
                .sort((a, b) => b.amountCents - a.amountCents)
        }
    };
};
