import { config } from '../config.js';
import { ACTOR, transferLegMachine } from '../lib/transfer/machines.js';
import { isTransferOps } from '../middleware/auth.js';
import { toDriverPublic } from './driver.js';
import { toFleetVehiclePublic } from './fleet.js';

/**
 * Legs and assignments, for three audiences.
 *
 *   operations — everything, including who dispatched and what they overrode
 *   the driver  — the job and the passenger, never the money
 *   the partner (and the passenger) — who is coming, once they have said yes,
 *                and how to reach them, once the pick-up is close enough
 */

const iso = (value) => (value ? value.toISOString() : null);

const MS_PER_HOUR = 3_600_000;

/** Whether the driver's phone number is shown yet. Decided here, from the pick-up time. */
export const contactRevealed = (leg, now = new Date()) =>
    now.getTime() >= leg.pickupAt.getTime() - config.transfer.dispatch.contactRevealHours * MS_PER_HOUR;

/** The passenger-facing part of a leg: where, when, who, what they asked for. */
const toLegJob = (leg) => ({
    id: leg.id,
    legIndex: leg.legIndex,
    direction: leg.direction,
    from: leg.fromPointName,
    to: leg.toPointName,
    fromKind: leg.fromPoint?.kind ?? null,
    timezone: leg.fromPoint?.timezone ?? leg.booking?.routeSnapshot?.fromTimezone ?? 'Asia/Tbilisi',
    pickupAt: iso(leg.pickupAt),
    distanceKm: leg.distanceKm,
    durationMinutes: leg.durationMinutes,
    status: leg.status,
    statusChangedAt: iso(leg.statusChangedAt)
});

const toPassengerBlock = (booking) => ({
    reference: booking.reference,
    bookingStatus: booking.status,
    tripType: booking.tripType,
    adults: booking.adults,
    children: booking.children,
    childAges: booking.childAges ?? [],
    passengers: booking.adults + booking.children,
    luggage: booking.luggage,
    cabinBags: booking.cabinBags,
    leadPassengerName: booking.leadPassengerName,
    leadPassengerPhone: booking.leadPassengerPhone ?? null,
    flightNumber: booking.flightNumber ?? null,
    pickupAddress: booking.pickupAddress ?? null,
    dropoffAddress: booking.dropoffAddress ?? null,
    // Coordinates for the driver's navigation app; the text above is what
    // they read out to the passenger.
    pickupPlace: booking.pickupPlace ?? null,
    dropoffPlace: booking.dropoffPlace ?? null,
    specialRequests: booking.specialRequests ?? null,
    vehicleClassName: booking.vehicleSnapshot?.name ?? booking.vehicle?.name ?? null,
    extras: (booking.extras ?? []).map((extra) => ({ code: extra.code, name: extra.name, quantity: extra.quantity }))
});

const toMilestones = (assignment) => ({
    acceptedAt: iso(assignment?.acceptedAt),
    enRouteAt: iso(assignment?.enRouteAt),
    arrivedAt: iso(assignment?.arrivedAt),
    pickedUpAt: iso(assignment?.pickedUpAt),
    completedAt: iso(assignment?.completedAt),
    noShowReportedAt: iso(assignment?.noShowReportedAt)
});

// --- Operations ---------------------------------------------------------------

export const toAssignmentAdmin = (assignment) =>
    assignment
        ? {
              id: assignment.id,
              legId: assignment.legId,
              bookingId: assignment.bookingId,
              status: assignment.status,
              driver: toDriverPublic(assignment.driver, { revealPhone: true }),
              vehicle: toFleetVehiclePublic(assignment.fleetVehicle),
              windowStart: iso(assignment.windowStart),
              windowEnd: iso(assignment.windowEnd),
              preBufferMinutes: assignment.preBufferMinutes,
              postBufferMinutes: assignment.postBufferMinutes,
              assignedAt: iso(assignment.assignedAt),
              assignedBy: assignment.assignedByUser
                  ? {
                        id: assignment.assignedByUser.id,
                        email: assignment.assignedByUser.email,
                        fullName: [assignment.assignedByUser.firstName, assignment.assignedByUser.lastName]
                            .filter(Boolean)
                            .join(' ')
                    }
                  : null,
              overrides: assignment.overrides ?? [],
              declinedAt: iso(assignment.declinedAt),
              declineReason: assignment.declineReason ?? null,
              revokedAt: iso(assignment.revokedAt),
              revokeReason: assignment.revokeReason ?? null,
              supersededByAssignmentId: assignment.supersededByAssignmentId ?? null,
              milestones: toMilestones(assignment),
              driverNotes: assignment.driverNotes ?? null,
              dispatcherNotes: assignment.dispatcherNotes ?? null,
              createdAt: iso(assignment.createdAt)
          }
        : null;

/** A leg on the dispatch board. */
export const toLegAdmin = (leg, viewer) => {
    const assignment = leg.assignments?.[0] ?? null;

    return {
        ...toLegJob(leg),
        booking: {
            ...toPassengerBlock(leg.booking),
            leadPassengerEmail: leg.booking.leadPassengerEmail,
            partner: leg.booking.partner
                ? { id: leg.booking.partner.id, reference: leg.booking.partner.reference, name: leg.booking.partner.name }
                : null,
            vehicleClassId: leg.booking.vehicleId
        },
        assignment: toAssignmentAdmin(assignment),
        allowedTransitions: transferLegMachine.nextStates(leg.status, isTransferOps(viewer) ? ACTOR.OPS : ACTOR.PARTNER)
    };
};

/** An assignment in a driver's or a car's history. */
export const toAssignmentHistory = (assignment) => ({
    ...toAssignmentAdmin(assignment),
    leg: assignment.leg
        ? {
              ...toLegJob(assignment.leg),
              booking: {
                  reference: assignment.leg.booking.reference,
                  bookingStatus: assignment.leg.booking.status,
                  leadPassengerName: assignment.leg.booking.leadPassengerName,
                  passengers: assignment.leg.booking.adults + assignment.leg.booking.children
              }
          }
        : null
});

// --- The driver -----------------------------------------------------------------

/** Never money, never the partner, never another driver. */
export const toAssignmentForDriver = (assignment) => ({
    id: assignment.id,
    status: assignment.status,
    leg: toLegJob(assignment.leg),
    booking: toPassengerBlock(assignment.leg.booking),
    vehicle: toFleetVehiclePublic(assignment.fleetVehicle),
    windowStart: iso(assignment.windowStart),
    windowEnd: iso(assignment.windowEnd),
    assignedAt: iso(assignment.assignedAt),
    milestones: toMilestones(assignment),
    driverNotes: assignment.driverNotes ?? null,
    dispatcherNotes: assignment.dispatcherNotes ?? null,
    allowedTransitions:
        assignment.status === 'OFFERED' || assignment.status === 'ACCEPTED'
            ? transferLegMachine.nextStates(assignment.leg.status, ACTOR.DRIVER).filter((state) => state !== 'UNASSIGNED')
            : [],
    canAccept: assignment.status === 'OFFERED',
    canDecline: assignment.status === 'OFFERED' || assignment.status === 'ACCEPTED'
});

// --- The partner and the passenger ------------------------------------------------

/**
 * What a partner (or the passenger, with `fullName: false`) sees of a leg's
 * driver. Nothing until the driver has accepted — except the driver the
 * partner asked for at checkout, who is shown while the offer waits, with
 * `awaitingDriver` set. An offer a dispatcher made stays hidden until it is
 * answered, so a declined one never flickers past. The phone number only
 * once accepted, and only from the reveal time before pick-up.
 */
export const toAssignmentForPartner = (leg, { fullName = true, now = new Date() } = {}) => {
    const assignment = leg.assignments?.[0] ?? null;

    if (!assignment) {
        return null;
    }

    const accepted = assignment.status === 'ACCEPTED';
    const requested = assignment.status === 'OFFERED' && Boolean(assignment.assignedByUser?.partnerId);

    if (!accepted && !requested) {
        return null;
    }

    return {
        status: assignment.status,
        awaitingDriver: !accepted,
        driver: toDriverPublic(assignment.driver, { revealPhone: accepted && contactRevealed(leg, now), fullName }),
        vehicle: toFleetVehiclePublic(assignment.fleetVehicle),
        milestones: {
            enRouteAt: iso(assignment.enRouteAt),
            arrivedAt: iso(assignment.arrivedAt),
            pickedUpAt: iso(assignment.pickedUpAt),
            completedAt: iso(assignment.completedAt)
        },
        /** Seam for live tracking; nothing feeds it yet. */
        etaAvailable: false
    };
};

/** The leg block on a booking, shaped for whoever is asking. */
export const toLegAssignmentFor = (leg, viewer, { guest = false } = {}) => {
    if (isTransferOps(viewer)) {
        return toAssignmentAdmin(leg.assignments?.[0] ?? null);
    }

    return toAssignmentForPartner(leg, { fullName: !guest });
};
