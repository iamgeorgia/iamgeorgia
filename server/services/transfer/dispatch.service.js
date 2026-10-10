import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import {
    ACTOR,
    ACTIVE_ASSIGNMENT_STATUSES,
    IN_PROGRESS_LEG_STATUSES,
    LIVE_LEG_STATUSES,
    transferBookingMachine,
    transferLegMachine
} from '../../lib/transfer/machines.js';
import { assignmentWindow } from '../../lib/transfer/schedule.js';
import { dateOnlyToUtc } from '../../lib/time.js';
import { sqlStateOf } from '../../middleware/errors.js';
import { CAPABILITIES, can } from '../../lib/permissions.js';
import { findConflicts, lockResources } from './schedule.service.js';

/**
 * Dispatch: who is doing which leg, and how far along it is.
 *
 * One service owns every write to a leg's status and to an assignment, so
 * the invariant — a leg in a live state has exactly one OFFERED or ACCEPTED
 * assignment, and a leg in any other state has none — is kept by one piece
 * of code rather than by everyone remembering.
 *
 * Assigning takes a row lock on the driver (and the car), pre-checks the
 * occupancy view under that lock, and inserts. The EXCLUDE constraints in the
 * database are the backstop for a writer that did not take the lock; here,
 * they should never fire.
 */

const dispatch = () => config.transfer.dispatch;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

const imageWithVariants = { include: { variants: true } };

/** What an assignment row carries when it is read for any panel. */
export const assignmentInclude = {
    driver: {
        include: {
            photo: imageWithVariants,
            provider: { select: { id: true, slug: true, name: true } }
        }
    },
    fleetVehicle: { include: { mainImage: imageWithVariants } },
    // `partnerId` is how a partner's own request at checkout is told apart
    // from an offer a dispatcher made: the former is shown to the partner
    // while it waits, the latter is not.
    assignedByUser: { select: { id: true, email: true, firstName: true, lastName: true, partnerId: true } }
};

/** A leg with everything the board, the driver and the partner read from it. */
export const legInclude = {
    booking: {
        include: {
            partner: { select: { id: true, reference: true, name: true } },
            vehicle: { select: { id: true, slug: true, name: true, vehicleClass: true, partnerId: true } },
            extras: true
        }
    },
    fromPoint: { select: { id: true, kind: true, timezone: true } },
    toPoint: { select: { id: true, kind: true, timezone: true } },
    assignments: {
        where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
        include: assignmentInclude
    }
};

/** The one live assignment, when there is one. */
export const activeAssignmentOf = (leg) => leg.assignments?.[0] ?? null;

/** Which kind of actor this viewer is, for the transition tables. */
export const actorKindFor = (viewer) => {
    if (!viewer) return ACTOR.GUEST;
    if (can(viewer, CAPABILITIES.DISPATCH_WRITE)) return ACTOR.OPS;
    if (can(viewer, CAPABILITIES.DRIVER_PANEL)) return ACTOR.DRIVER;
    if (viewer.partnerId) return ACTOR.PARTNER;
    return ACTOR.GUEST;
};

const findLegInTx = async (tx, legId) => {
    const leg = await tx.transferBookingLeg.findUnique({ where: { id: legId }, include: legInclude });

    if (!leg) {
        throw new NotFoundError('That transfer leg does not exist');
    }

    return leg;
};

export const findLegOr404 = (legId) => findLegInTx(prisma, legId);

export const listDispatchLegs = async (query) => {
    const { page, pageSize, from, to, legStatus, driverId, search } = query;

    const where = {
        ...(legStatus ? { status: Array.isArray(legStatus) ? { in: legStatus } : legStatus } : {}),
        ...(from || to
            ? {
                  pickupAt: {
                      ...(from ? { gte: dateOnlyToUtc(from) } : {}),
                      ...(to ? { lt: new Date(dateOnlyToUtc(to).getTime() + 86_400_000) } : {})
                  }
              }
            : {}),
        ...(driverId ? { assignments: { some: { driverId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } } } } : {}),
        ...(search
            ? {
                  booking: {
                      OR: [
                          { reference: { contains: search, mode: 'insensitive' } },
                          { leadPassengerName: { contains: search, mode: 'insensitive' } }
                      ]
                  }
              }
            : {})
    };

    const [total, legs] = await Promise.all([
        prisma.transferBookingLeg.count({ where }),
        prisma.transferBookingLeg.findMany({
            where,
            include: legInclude,
            orderBy: { pickupAt: 'asc' },
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { legs, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

export const listAssignments = async (query) => {
    const { page, pageSize, driverId, fleetVehicleId, status, from, to } = query;

    const where = {
        ...(driverId ? { driverId } : {}),
        ...(fleetVehicleId ? { fleetVehicleId } : {}),
        ...(status ? { status: Array.isArray(status) ? { in: status } : status } : {}),
        ...(from || to
            ? {
                  windowStart: {
                      ...(from ? { gte: dateOnlyToUtc(from) } : {}),
                      ...(to ? { lt: new Date(dateOnlyToUtc(to).getTime() + 86_400_000) } : {})
                  }
              }
            : {})
    };

    const [total, assignments] = await Promise.all([
        prisma.transferAssignment.count({ where }),
        prisma.transferAssignment.findMany({
            where,
            include: { ...assignmentInclude, leg: { include: legInclude } },
            orderBy: { windowStart: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { assignments, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

export const findAssignmentOr404 = async (id) => {
    const assignment = await prisma.transferAssignment.findUnique({
        where: { id },
        include: { ...assignmentInclude, leg: { include: legInclude }, supersededBy: { select: { id: true } } }
    });

    if (!assignment) {
        throw new NotFoundError('That assignment does not exist');
    }

    return assignment;
};

// --- Guards -----------------------------------------------------------------

const partySize = (booking) => booking.adults + booking.children;

/** Hard: a car that cannot carry the party is a mistake at the kerb. */
const assertCapacity = (car, booking) => {
    if (!car) return;

    if (car.passengerCapacity < partySize(booking) || car.luggageCapacity < booking.luggage) {
        throw new UnprocessableEntityError('That car cannot carry this party', {
            reason: 'CAPACITY',
            passengers: partySize(booking),
            luggage: booking.luggage,
            passengerCapacity: car.passengerCapacity,
            luggageCapacity: car.luggageCapacity
        });
    }
};

/**
 * Soft: things a dispatcher may knowingly do. Each needs its flag, and each
 * that was used is recorded on the assignment for the audit trail.
 */
const collectOverrides = (input, { driver, car, booking }) => {
    const needed = [];
    const used = [];

    const consider = (condition, code, flag) => {
        if (!condition) return;
        if (flag) used.push(code);
        else needed.push(code);
    };

    consider(driver.verificationStatus !== 'VERIFIED', 'UNVERIFIED_DRIVER', input.overrideUnverified);
    consider(Boolean(car) && car.vehicleClassId !== booking.vehicleId, 'CLASS_MISMATCH', input.overrideClassMismatch);
    consider(
        Boolean(car) && driver.vehicles.length > 0 && !driver.vehicles.some((link) => link.fleetVehicleId === car.id),
        'VEHICLE_NOT_LINKED',
        input.overrideVehicleLink
    );

    if (needed.length > 0) {
        throw new UnprocessableEntityError('This assignment needs a decision from you', {
            reason: 'OVERRIDE_REQUIRED',
            overrides: needed
        });
    }

    return used;
};

const conflictError = (conflicts) =>
    new ConflictError('That driver or car is not free for this leg', {
        reason: 'SCHEDULE_CONFLICT',
        conflicts
    });

/** Time guards, keyed on the transition they protect. Server clock only. */
const timeGuards = {
    'ACCEPTED->EN_ROUTE': (leg, now) => {
        const earliest = leg.pickupAt.getTime() - dispatch().maxEarlyStartMinutes * MS_PER_MINUTE;

        if (now.getTime() < earliest) {
            throw new ConflictError('Too early to set off for this pick-up', {
                reason: 'TOO_EARLY',
                notBefore: new Date(earliest)
            });
        }
    },
    '*->COMPLETED': (leg, now) => {
        if (now.getTime() < leg.pickupAt.getTime()) {
            throw new ConflictError('A transfer cannot be completed before its pick-up time', {
                reason: 'TOO_EARLY',
                notBefore: leg.pickupAt
            });
        }
    },
    'ARRIVED->NO_SHOW_REPORTED': (leg, now) => {
        const wait =
            leg.fromPoint?.kind === 'AIRPORT' ? dispatch().noShowWaitMinutesAirport : dispatch().noShowWaitMinutes;
        const earliest = leg.pickupAt.getTime() + wait * MS_PER_MINUTE;

        if (now.getTime() < earliest) {
            throw new ConflictError(`Wait ${wait} minutes past the pick-up time before reporting a no-show`, {
                reason: 'TOO_EARLY',
                notBefore: new Date(earliest)
            });
        }
    }
};

const runTimeGuard = (from, to, leg, now) => {
    (timeGuards[`${from}->${to}`] ?? timeGuards[`*->${to}`])?.(leg, now);
};

// --- Writes -----------------------------------------------------------------

const setLegStatus = (tx, leg, status, now) =>
    tx.transferBookingLeg.update({
        where: { id: leg.id },
        data: { status, statusChangedAt: now }
    });

const auditLeg = (tx, leg, from, to, actor, req, metadata = {}) =>
    recordAudit(tx, {
        action: 'TRANSFER_LEG_STATUS_CHANGED',
        actor,
        entityType: AUDIT_ENTITY.transferBookingLeg,
        entityId: leg.id,
        summary: `${leg.booking.reference} leg ${leg.legIndex + 1}: ${from} → ${to}`,
        metadata: { bookingId: leg.bookingId, from, to, ...metadata },
        req
    });

const legPayload = (leg, extra = {}) => ({
    legId: leg.id,
    bookingId: leg.bookingId,
    bookingReference: leg.booking.reference,
    legIndex: leg.legIndex,
    pickupAt: leg.pickupAt,
    ...extra
});

/**
 * Closes the booking once every leg has finished.
 *
 * Any leg driven → COMPLETED. None driven and at least one no-show →
 * NO_SHOW. Everything cancelled → the booking is already CANCELLED. Runs
 * inside the caller's transaction, after the leg it was called for has been
 * written.
 */
export const rollUpBookingStatus = async (tx, bookingId, actor, req) => {
    const booking = await tx.transferBooking.findUnique({
        where: { id: bookingId },
        select: { id: true, reference: true, status: true, legs: { select: { status: true, statusChangedAt: true } } }
    });

    if (!booking || booking.status !== 'CONFIRMED') {
        return booking?.status ?? null;
    }

    const statuses = booking.legs.map((leg) => leg.status);

    if (statuses.some((status) => !transferLegMachine.isTerminal(status))) {
        return booking.status;
    }

    let next = null;

    if (statuses.includes('COMPLETED')) next = 'COMPLETED';
    else if (statuses.includes('NO_SHOW')) next = 'NO_SHOW';

    if (!next) {
        return booking.status;
    }

    transferBookingMachine.assertTransition(booking.status, next, ACTOR.SYSTEM);

    const completedAt = booking.legs.reduce(
        (latest, leg) => (leg.statusChangedAt > latest ? leg.statusChangedAt : latest),
        new Date(0)
    );

    await tx.transferBooking.update({
        where: { id: bookingId },
        data: { status: next, ...(next === 'COMPLETED' ? { completedAt } : {}) }
    });

    await recordAudit(tx, {
        action: next === 'COMPLETED' ? 'TRANSFER_BOOKING_COMPLETED' : 'TRANSFER_BOOKING_NO_SHOW',
        actor,
        entityType: AUDIT_ENTITY.transferBooking,
        entityId: bookingId,
        summary: `Transfer ${booking.reference} closed as ${next}`,
        metadata: { legs: statuses },
        req
    });

    return next;
};

const recomputeCompletedCount = (tx, driverId) =>
    tx.$executeRaw`
        UPDATE transfer_drivers d
           SET completed_count = (SELECT count(*) FROM transfer_assignments a
                                   WHERE a.driver_id = d.id AND a.status = 'COMPLETED')
         WHERE d.id = ${driverId}
    `;

/**
 * Revokes the leg's live assignment, if any, without touching the leg.
 * Returns the revoked row.
 */
const revokeActive = async (tx, leg, { reason, actor, req, now, supersededByAssignmentId = null }) => {
    const current = activeAssignmentOf(leg);

    if (!current) {
        return null;
    }

    const revoked = await tx.transferAssignment.update({
        where: { id: current.id },
        data: { status: 'REVOKED', revokedAt: now, revokeReason: reason, supersededByAssignmentId },
        include: assignmentInclude
    });

    await recordAudit(tx, {
        action: 'TRANSFER_ASSIGNMENT_REVOKED',
        actor,
        entityType: AUDIT_ENTITY.transferAssignment,
        entityId: current.id,
        summary: `Revoked ${leg.booking.reference} leg ${leg.legIndex + 1} from ${current.driver.firstName} ${current.driver.lastName}: ${reason}`,
        metadata: { reason, legId: leg.id, driverId: current.driverId, supersededByAssignmentId },
        req
    });

    await enqueueEvent(tx, {
        topic: TOPICS.ASSIGNMENT_REVOKED,
        payload: legPayload(leg, { assignmentId: current.id, driverId: current.driverId, reason }),
        entityType: AUDIT_ENTITY.transferAssignment,
        entityId: current.id
    });

    return revoked;
};

/**
 * Offers a leg to a driver, in a car.
 *
 * Also the reassignment path: a leg that already has a live assignment has
 * it revoked, superseded by the new row, in the same transaction.
 */
export const assignDriverInTx = async (tx, legId, input, actor, req, now = new Date()) => {
    await lockResources(tx, { driverId: input.driverId, fleetVehicleId: input.fleetVehicleId ?? null });

    const leg = await findLegInTx(tx, legId);
    const current = activeAssignmentOf(leg);

    if (leg.booking.status !== 'CONFIRMED') {
        throw new ConflictError('Only a confirmed booking can be dispatched', {
            reason: 'BOOKING_NOT_CONFIRMED',
            status: leg.booking.status
        });
    }

    // The move as the machine sees it: a fresh offer from UNASSIGNED,
    // or — for a leg already held — an unassign followed by an offer.
    if (current) {
        transferLegMachine.assertTransition(leg.status, 'UNASSIGNED', ACTOR.OPS);
    } else {
        transferLegMachine.assertTransition(leg.status, 'ASSIGNED', ACTOR.OPS);
    }

    const target = input.acceptOnBehalf || !dispatch().requireDriverAcceptance ? 'ACCEPTED' : 'ASSIGNED';

    const driver = await tx.transferDriver.findUnique({
        where: { id: input.driverId },
        include: { vehicles: { select: { fleetVehicleId: true } } }
    });

    if (!driver) {
        throw new NotFoundError('That driver does not exist');
    }

    if (!driver.isActive) {
        throw new ConflictError('That driver is deactivated', { reason: 'DRIVER_INACTIVE' });
    }

    let car = null;

    if (input.fleetVehicleId) {
        car = await tx.transferFleetVehicle.findUnique({ where: { id: input.fleetVehicleId } });

        if (!car) {
            throw new NotFoundError('That car does not exist');
        }

        if (car.status !== 'ACTIVE') {
            throw new ConflictError('That car is not on the road', { reason: 'VEHICLE_INACTIVE', status: car.status });
        }
    }

    assertCapacity(car, leg.booking);
    const overrides = collectOverrides(input, { driver, car, booking: leg.booking });

    const window = assignmentWindow(leg, {
        preBufferMinutes: dispatch().preBufferMinutes,
        postBufferMinutes: dispatch().postBufferMinutes
    });

    if (input.windowEndOverride) {
        if (input.windowEndOverride <= window.windowStart) {
            throw new UnprocessableEntityError('The occupancy has to end after it starts', { field: 'windowEndOverride' });
        }

        window.windowEnd = input.windowEndOverride;
    }

    const conflicts = await findConflicts(tx, {
        driverId: driver.id,
        fleetVehicleId: car?.id ?? null,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        excludeAssignmentId: current?.id ?? null
    });

    if (conflicts.length > 0) {
        throw conflictError(conflicts);
    }

    // The old row is revoked *before* the new one is written: the
    // one-live-offer-per-leg index is checked statement by statement,
    // not at commit, so the order matters. It learns its successor's
    // id straight afterwards, still inside the transaction.
    if (current) {
        await tx.transferAssignment.update({
            where: { id: current.id },
            data: { status: 'REVOKED', revokedAt: now, revokeReason: 'REASSIGNED' }
        });
    }

    const created = await tx.transferAssignment.create({
        data: {
            legId: leg.id,
            bookingId: leg.bookingId,
            driverId: driver.id,
            fleetVehicleId: car?.id ?? null,
            status: target === 'ACCEPTED' ? 'ACCEPTED' : 'OFFERED',
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
            preBufferMinutes: window.preBufferMinutes,
            postBufferMinutes: window.postBufferMinutes,
            assignedByUserId: actor?.id ?? null,
            assignedAt: now,
            overrides,
            acceptedAt: target === 'ACCEPTED' ? now : null,
            dispatcherNotes: input.note ?? null
        },
        include: assignmentInclude
    });

    if (current) {
        await tx.transferAssignment.update({
            where: { id: current.id },
            data: { supersededByAssignmentId: created.id }
        });

        await recordAudit(tx, {
            action: 'TRANSFER_ASSIGNMENT_REVOKED',
            actor,
            entityType: AUDIT_ENTITY.transferAssignment,
            entityId: current.id,
            summary: `Reassigned ${leg.booking.reference} leg ${leg.legIndex + 1} away from ${current.driver.firstName} ${current.driver.lastName}`,
            metadata: { reason: 'REASSIGNED', supersededByAssignmentId: created.id },
            req
        });

        await enqueueEvent(tx, {
            topic: TOPICS.ASSIGNMENT_REVOKED,
            payload: legPayload(leg, { assignmentId: current.id, driverId: current.driverId, reason: 'REASSIGNED' }),
            entityType: AUDIT_ENTITY.transferAssignment,
            entityId: current.id
        });
    }

    await setLegStatus(tx, leg, target, now);
    await auditLeg(tx, leg, leg.status, target, actor, req, { assignmentId: created.id, driverId: driver.id });

    await recordAudit(tx, {
        action: 'TRANSFER_ASSIGNMENT_CREATED',
        actor,
        entityType: AUDIT_ENTITY.transferAssignment,
        entityId: created.id,
        summary: `Offered ${leg.booking.reference} leg ${leg.legIndex + 1} to ${driver.firstName} ${driver.lastName}${car ? ` in ${car.plateNumber}` : ''}`,
        metadata: {
            legId: leg.id,
            driverId: driver.id,
            fleetVehicleId: car?.id ?? null,
            overrides,
            target,
            requestedByPartner: Boolean(input.requestedByPartner)
        },
        req
    });

    await enqueueEvent(tx, {
        topic: target === 'ACCEPTED' ? TOPICS.ASSIGNMENT_ACCEPTED : TOPICS.ASSIGNMENT_OFFERED,
        payload: legPayload(leg, { assignmentId: created.id, driverId: driver.id, onBehalf: target === 'ACCEPTED' }),
        entityType: AUDIT_ENTITY.transferAssignment,
        entityId: created.id
    });

    if (current) {
        await recomputeCompletedCount(tx, current.driverId);
    }

    return findLegInTx(tx, legId);
};

/**
 * The same, in a transaction of its own. Booking calls the body directly
 * so a partner's requested driver is offered in the same transaction that
 * writes the booking, and a conflict rolls both back together.
 */
export const assignDriver = async (legId, input, actor, req) => {
    try {
        return await prisma.$transaction((tx) => assignDriverInTx(tx, legId, input, actor, req));
    } catch (err) {
        // The constraint is the backstop. It should not fire — the pre-check
        // ran under the row lock — but if it does, it is still a conflict.
        if (sqlStateOf(err) === '23P01') {
            throw conflictError([]);
        }

        throw err;
    }
};

/** Takes the driver off a leg and sends it back to the board. */
export const unassignLeg = (legId, { reason }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const now = new Date();
        const leg = await findLegInTx(tx, legId);

        transferLegMachine.assertTransition(leg.status, 'UNASSIGNED', ACTOR.OPS);

        await revokeActive(tx, leg, { reason, actor, req, now });
        await setLegStatus(tx, leg, 'UNASSIGNED', now);
        await auditLeg(tx, leg, leg.status, 'UNASSIGNED', actor, req, { reason });

        return findLegInTx(tx, legId);
    });

/**
 * The driver's answer to an offer.
 *
 * Addressed by assignment, not by leg: acting on a superseded offer fails on
 * the conditional update below rather than touching whoever holds the leg
 * now. Declining an already-accepted job is allowed until shortly before the
 * pick-up; after that, the driver phones dispatch.
 */
export const respondToAssignment = (assignmentId, answer, { reason } = {}, driver, actor, req) =>
    prisma.$transaction(async (tx) => {
        const now = new Date();

        const assignment = await tx.transferAssignment.findFirst({
            where: { id: assignmentId, driverId: driver.id },
            include: { leg: { include: legInclude } }
        });

        if (!assignment) {
            throw new NotFoundError('That assignment does not exist');
        }

        const { leg } = assignment;

        if (answer === 'accept') {
            transferLegMachine.assertTransition(leg.status, 'ACCEPTED', ACTOR.DRIVER);

            const { count } = await tx.transferAssignment.updateMany({
                where: { id: assignmentId, status: 'OFFERED' },
                data: { status: 'ACCEPTED', acceptedAt: now }
            });

            if (count === 0) {
                throw new ConflictError('This offer is no longer open', { reason: 'ASSIGNMENT_NOT_ACTIVE', status: assignment.status });
            }

            await setLegStatus(tx, leg, 'ACCEPTED', now);
            await auditLeg(tx, leg, leg.status, 'ACCEPTED', actor, req, { assignmentId });
            await recordAudit(tx, {
                action: 'TRANSFER_ASSIGNMENT_ACCEPTED',
                actor,
                entityType: AUDIT_ENTITY.transferAssignment,
                entityId: assignmentId,
                summary: `${driver.firstName} ${driver.lastName} accepted ${leg.booking.reference} leg ${leg.legIndex + 1}`,
                req
            });
            await enqueueEvent(tx, {
                topic: TOPICS.ASSIGNMENT_ACCEPTED,
                payload: legPayload(leg, { assignmentId, driverId: driver.id }),
                entityType: AUDIT_ENTITY.transferAssignment,
                entityId: assignmentId
            });
        } else {
            transferLegMachine.assertTransition(leg.status, 'UNASSIGNED', ACTOR.DRIVER);

            if (assignment.status === 'ACCEPTED') {
                const latest = leg.pickupAt.getTime() - dispatch().lateDeclineHours * MS_PER_HOUR;

                if (now.getTime() > latest) {
                    throw new ConflictError('Too close to the pick-up to decline — call dispatch', {
                        reason: 'LATE_DECLINE',
                        notAfter: new Date(latest)
                    });
                }
            }

            const { count } = await tx.transferAssignment.updateMany({
                where: { id: assignmentId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
                data: { status: 'DECLINED', declinedAt: now, declineReason: reason ?? null }
            });

            if (count === 0) {
                throw new ConflictError('This offer is no longer open', { reason: 'ASSIGNMENT_NOT_ACTIVE', status: assignment.status });
            }

            await setLegStatus(tx, leg, 'UNASSIGNED', now);
            await auditLeg(tx, leg, leg.status, 'UNASSIGNED', actor, req, { assignmentId, reason: reason ?? null });
            await recordAudit(tx, {
                action: 'TRANSFER_ASSIGNMENT_DECLINED',
                actor,
                entityType: AUDIT_ENTITY.transferAssignment,
                entityId: assignmentId,
                summary: `${driver.firstName} ${driver.lastName} declined ${leg.booking.reference} leg ${leg.legIndex + 1}`,
                metadata: { reason: reason ?? null },
                req
            });
            await enqueueEvent(tx, {
                topic: TOPICS.ASSIGNMENT_DECLINED,
                payload: legPayload(leg, { assignmentId, driverId: driver.id, reason: reason ?? null }),
                entityType: AUDIT_ENTITY.transferAssignment,
                entityId: assignmentId
            });
        }

        return tx.transferAssignment.findUnique({
            where: { id: assignmentId },
            include: { ...assignmentInclude, leg: { include: legInclude } }
        });
    });

/** Milestone stamps, in order. A forward skip fills the ones it jumped. */
const MILESTONES = [
    ['EN_ROUTE', 'enRouteAt'],
    ['ARRIVED', 'arrivedAt'],
    ['ON_BOARD', 'pickedUpAt'],
    ['COMPLETED', 'completedAt']
];

/**
 * Moves a leg along.
 *
 * `actorKind` decides which transitions are legal; `driver` (when the caller
 * is one) must hold the leg's live assignment, or the leg does not exist as
 * far as they are concerned. `expectedFrom` is the client's belief: a
 * mismatch is a 409, so a retried request from a flaky connection cannot
 * leap two states.
 */
export const transitionLeg = (legId, { to, expectedFrom, note }, { actorKind, driver = null }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const now = new Date();
        const leg = await findLegInTx(tx, legId);
        const current = activeAssignmentOf(leg);

        if (actorKind === ACTOR.DRIVER && (!current || current.driverId !== driver?.id)) {
            throw new NotFoundError('That transfer leg does not exist');
        }

        if (expectedFrom && expectedFrom !== leg.status) {
            throw new ConflictError('The leg has moved on since you last saw it', {
                reason: 'STALE_STATE',
                expectedFrom,
                current: leg.status
            });
        }

        if (transferLegMachine.assertTransition(leg.status, to, actorKind) === 'NOOP') {
            return leg;
        }

        if (to === 'ASSIGNED' || to === 'UNASSIGNED' || to === 'CANCELLED') {
            throw new ConflictError('Use the assign, unassign or cancel actions for that', { reason: 'USE_ACTION', to });
        }

        runTimeGuard(leg.status, to, leg, now);

        const data = {};
        const skipped = [];

        // Forward moves fill every milestone up to the target; a correction
        // backwards clears the ones beyond it.
        const fromIndex = MILESTONES.findIndex(([status]) => status === leg.status);
        const toIndex = MILESTONES.findIndex(([status]) => status === to);

        if (toIndex >= 0) {
            for (let index = 0; index <= toIndex; index += 1) {
                const [status, field] = MILESTONES[index];

                if (current && current[field] === null) {
                    data[field] = now;
                    if (index < toIndex && index > fromIndex) skipped.push(status);
                }
            }

            for (let index = toIndex + 1; index < MILESTONES.length; index += 1) {
                data[MILESTONES[index][1]] = null;
            }
        }

        if (to === 'NO_SHOW_REPORTED') data.noShowReportedAt = now;
        if (to === 'ARRIVED' && leg.status === 'NO_SHOW_REPORTED') data.noShowReportedAt = null;
        if (note) data.driverNotes = actorKind === ACTOR.DRIVER ? note : current?.driverNotes ?? null;
        if (note && actorKind !== ACTOR.DRIVER) data.dispatcherNotes = note;

        if (to === 'COMPLETED') data.status = 'COMPLETED';
        if (to === 'NO_SHOW') data.status = 'NO_SHOW';
        if (leg.status === 'COMPLETED' && to === 'ON_BOARD') data.status = 'ACCEPTED';

        if (current) {
            await tx.transferAssignment.update({ where: { id: current.id }, data });
        }

        await setLegStatus(tx, leg, to, now);
        await auditLeg(tx, leg, leg.status, to, actor, req, {
            assignmentId: current?.id ?? null,
            skipped,
            note: note ?? null,
            onBehalf: actorKind !== ACTOR.DRIVER && Boolean(actor)
        });

        await enqueueEvent(tx, {
            topic: to === 'NO_SHOW_REPORTED' ? TOPICS.LEG_NO_SHOW_REPORTED : TOPICS.LEG_STATUS_CHANGED,
            payload: legPayload(leg, { from: leg.status, to, assignmentId: current?.id ?? null, driverId: current?.driverId ?? null }),
            entityType: AUDIT_ENTITY.transferBookingLeg,
            entityId: leg.id
        });

        if (current && (to === 'COMPLETED' || to === 'NO_SHOW' || leg.status === 'COMPLETED')) {
            await recomputeCompletedCount(tx, current.driverId);
        }

        if (to === 'COMPLETED') {
            await enqueueEvent(tx, {
                topic: TOPICS.RATING_INVITE,
                payload: legPayload(leg, { assignmentId: current?.id ?? null, driverId: current?.driverId ?? null }),
                entityType: AUDIT_ENTITY.transferBookingLeg,
                entityId: leg.id
            });
        }

        if (transferLegMachine.isTerminal(to)) {
            await rollUpBookingStatus(tx, leg.bookingId, actor, req);
        }

        return findLegInTx(tx, legId);
    });

/** Cancels one leg — the return of a booking whose outbound already ran. */
export const cancelLeg = (legId, { reason }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const now = new Date();
        const leg = await findLegInTx(tx, legId);

        transferLegMachine.assertTransition(leg.status, 'CANCELLED', ACTOR.OPS);

        await revokeActive(tx, leg, { reason: 'LEG_CANCELLED', actor, req, now });
        await setLegStatus(tx, leg, 'CANCELLED', now);

        await recordAudit(tx, {
            action: 'TRANSFER_LEG_CANCELLED',
            actor,
            entityType: AUDIT_ENTITY.transferBookingLeg,
            entityId: leg.id,
            summary: `${leg.booking.reference} leg ${leg.legIndex + 1} cancelled`,
            metadata: { reason: reason ?? null, from: leg.status },
            req
        });

        await rollUpBookingStatus(tx, leg.bookingId, actor, req);

        return findLegInTx(tx, legId);
    });

/**
 * What a booking cancellation does to its legs. Called by the booking
 * service inside its own transaction; refuses when a passenger is already
 * in a car.
 */
export const cascadeBookingCancellation = async (tx, bookingId, actor, req) => {
    const now = new Date();
    const legs = await tx.transferBookingLeg.findMany({ where: { bookingId }, include: legInclude });

    const inProgress = legs.filter((leg) => IN_PROGRESS_LEG_STATUSES.includes(leg.status));

    if (inProgress.length > 0) {
        throw new ConflictError('A leg of this transfer is already under way', {
            reason: 'LEG_IN_PROGRESS',
            legs: inProgress.map((leg) => ({ legIndex: leg.legIndex, status: leg.status }))
        });
    }

    for (const leg of legs) {
        if (transferLegMachine.isTerminal(leg.status)) {
            continue;
        }

        await revokeActive(tx, leg, { reason: 'BOOKING_CANCELLED', actor, req, now });
        await setLegStatus(tx, leg, 'CANCELLED', now);

        if (LIVE_LEG_STATUSES.includes(leg.status)) {
            await enqueueEvent(tx, {
                topic: TOPICS.BOOKING_CANCELLED,
                payload: legPayload(leg, { driverId: activeAssignmentOf(leg)?.driverId ?? null }),
                entityType: AUDIT_ENTITY.transferBookingLeg,
                entityId: leg.id
            });
        }
    }
};

// --- Candidates -------------------------------------------------------------

/**
 * Who could take this leg.
 *
 * Only drivers with an active car of the class the booker chose, and only
 * those cars: the class is what was sold, so a Sedan booking never lists a
 * minivan driver as an option. Within that, ranked: free before busy,
 * verified before unverified, a car that fits the party before one that does
 * not. Conflicts are shown rather than hidden, because "why is Levan not on
 * the list" is a question the board should answer. The class-mismatch
 * override on `assignDriver` stays for the API; the board simply never offers
 * a car that would need it. This is the seam automatic assignment will call.
 */
export const candidatesForLeg = async (legId) => {
    const leg = await findLegOr404(legId);
    const window = assignmentWindow(leg, {
        preBufferMinutes: dispatch().preBufferMinutes,
        postBufferMinutes: dispatch().postBufferMinutes
    });

    const bookedClass = { status: 'ACTIVE', vehicleClassId: leg.booking.vehicleId };

    const drivers = await prisma.transferDriver.findMany({
        where: { isActive: true, vehicles: { some: { fleetVehicle: bookedClass } } },
        include: {
            photo: imageWithVariants,
            provider: { select: { id: true, name: true } },
            vehicles: {
                where: { fleetVehicle: bookedClass },
                orderBy: [{ isPrimary: 'desc' }],
                include: { fleetVehicle: { include: { mainImage: imageWithVariants } } }
            }
        },
        orderBy: [{ verificationStatus: 'asc' }, { lastName: 'asc' }]
    });

    const current = activeAssignmentOf(leg);

    const candidates = await Promise.all(
        drivers.map(async (driver) => {
            const conflicts = await findConflicts(prisma, {
                driverId: driver.id,
                fleetVehicleId: null,
                windowStart: window.windowStart,
                windowEnd: window.windowEnd,
                excludeAssignmentId: current?.id ?? null
            });

            const vehicles = await Promise.all(
                driver.vehicles.map(async (link) => {
                    const car = link.fleetVehicle;
                    const carConflicts = await findConflicts(prisma, {
                        driverId: null,
                        fleetVehicleId: car.id,
                        windowStart: window.windowStart,
                        windowEnd: window.windowEnd,
                        excludeAssignmentId: current?.id ?? null
                    });

                    return {
                        vehicle: car,
                        isPrimary: link.isPrimary,
                        classMatches: car.vehicleClassId === leg.booking.vehicleId,
                        fitsParty:
                            car.passengerCapacity >= partySize(leg.booking) && car.luggageCapacity >= leg.booking.luggage,
                        conflicts: carConflicts
                    };
                })
            );

            const warnings = [];
            if (driver.verificationStatus !== 'VERIFIED') warnings.push('UNVERIFIED_DRIVER');

            // Every car listed is of the booked class already; `classMatches` is
            // kept on the wire so an older client's warning keeps its meaning.
            const bestCar = vehicles.find((entry) => entry.fitsParty && entry.conflicts.length === 0) ?? null;

            const score =
                (conflicts.length === 0 ? 100 : 0) +
                (driver.verificationStatus === 'VERIFIED' ? 50 : 0) +
                (bestCar ? 10 : 0);

            return { driver, vehicles, conflicts, warnings, suggestedVehicleId: bestCar?.vehicle.id ?? null, score };
        })
    );

    candidates.sort((a, b) => b.score - a.score || a.driver.lastName.localeCompare(b.driver.lastName));

    return { leg, window, candidates };
};

// --- The driver's own lists -------------------------------------------------

export const listDriverAssignments = async (driverId, { scope, page, pageSize }) => {
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const endOfDay = new Date(startOfDay.getTime() + 86_400_000);

    const where = {
        driverId,
        ...(scope === 'today'
            ? { status: { in: ACTIVE_ASSIGNMENT_STATUSES }, leg: { pickupAt: { gte: startOfDay, lt: endOfDay } } }
            : scope === 'upcoming'
              ? { status: { in: ACTIVE_ASSIGNMENT_STATUSES }, windowEnd: { gte: now } }
              : { status: { notIn: ['OFFERED'] }, OR: [{ status: { notIn: ACTIVE_ASSIGNMENT_STATUSES } }, { windowEnd: { lt: now } }] })
    };

    const [total, assignments] = await Promise.all([
        prisma.transferAssignment.count({ where }),
        prisma.transferAssignment.findMany({
            where,
            include: { ...assignmentInclude, leg: { include: legInclude } },
            orderBy: { windowStart: scope === 'history' ? 'desc' : 'asc' },
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { assignments, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

export const findDriverAssignmentOr404 = async (driverId, id) => {
    const assignment = await prisma.transferAssignment.findFirst({
        where: { id, driverId },
        include: { ...assignmentInclude, leg: { include: legInclude } }
    });

    if (!assignment) {
        throw new NotFoundError('That assignment does not exist');
    }

    return assignment;
};
