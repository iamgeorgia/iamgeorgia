import { defineMachine } from '../stateMachine.js';

/**
 * Who is acting. Resolved from the session by the dispatch service; the
 * tables below only ever see one of these strings.
 *
 *   OPS     — SUPER_ADMIN, ADMIN, DISPATCHER
 *   DRIVER  — the driver holding the leg's active assignment (never any other)
 *   PARTNER — a user of the partner that made the booking
 *   GUEST   — the lead passenger, proven by email
 *   SYSTEM  — a sweeper or a roll-up
 */
export const ACTOR = Object.freeze({
    OPS: 'OPS',
    DRIVER: 'DRIVER',
    PARTNER: 'PARTNER',
    GUEST: 'GUEST',
    SYSTEM: 'SYSTEM'
});

const { OPS, DRIVER, PARTNER, GUEST, SYSTEM } = ACTOR;

const OPERATIONAL = [DRIVER, OPS];
const CANCELLERS = [OPS, PARTNER, GUEST];

/**
 * The operational life of one leg.
 *
 * Forward skips are legal on purpose: a driver who forgot to press "on my
 * way" and presses "arrived" has still arrived. Backward moves are corrections
 * and belong to operations alone. Cancellation is reachable until a passenger
 * is in the car; after that the job is happening and the commercial layer
 * settles it afterwards.
 */
export const transferLegMachine = defineMachine({
    name: 'transfer leg',
    terminal: ['COMPLETED', 'NO_SHOW', 'CANCELLED'],
    transitions: {
        UNASSIGNED: {
            ASSIGNED: [OPS],
            ACCEPTED: [OPS],
            CANCELLED: CANCELLERS
        },
        ASSIGNED: {
            ACCEPTED: OPERATIONAL,
            UNASSIGNED: OPERATIONAL,
            CANCELLED: CANCELLERS
        },
        ACCEPTED: {
            UNASSIGNED: OPERATIONAL,
            EN_ROUTE: OPERATIONAL,
            ARRIVED: OPERATIONAL,
            ON_BOARD: OPERATIONAL,
            COMPLETED: OPERATIONAL,
            CANCELLED: CANCELLERS
        },
        EN_ROUTE: {
            ARRIVED: OPERATIONAL,
            ON_BOARD: OPERATIONAL,
            COMPLETED: OPERATIONAL,
            UNASSIGNED: [OPS],
            CANCELLED: CANCELLERS
        },
        ARRIVED: {
            ON_BOARD: OPERATIONAL,
            COMPLETED: OPERATIONAL,
            NO_SHOW_REPORTED: OPERATIONAL,
            UNASSIGNED: [OPS],
            CANCELLED: CANCELLERS
        },
        ON_BOARD: {
            COMPLETED: OPERATIONAL
        },
        NO_SHOW_REPORTED: {
            NO_SHOW: [OPS, SYSTEM],
            ARRIVED: [OPS]
        },
        COMPLETED: {
            ON_BOARD: [OPS]
        },
        NO_SHOW: {},
        CANCELLED: {}
    }
});

/** Leg states in which someone is expected at the kerb. */
export const LIVE_LEG_STATUSES = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'ON_BOARD'];

/** Leg states past which a booking can no longer be cancelled as a whole. */
export const IN_PROGRESS_LEG_STATUSES = ['ON_BOARD', 'COMPLETED', 'NO_SHOW_REPORTED', 'NO_SHOW'];

/** Assignment states that occupy the driver's and the car's time. */
export const ACTIVE_ASSIGNMENT_STATUSES = ['OFFERED', 'ACCEPTED'];

/**
 * The commercial life of a booking, as it has always been, plus the two
 * closing states the roll-up writes once every leg is terminal.
 */
export const transferBookingMachine = defineMachine({
    name: 'transfer booking',
    terminal: ['CANCELLED', 'COMPLETED', 'NO_SHOW'],
    transitions: {
        // The platform's wait (OD1): approved to CONFIRMED, or rejected,
        // withdrawn or expired to CANCELLED at no charge.
        PENDING_APPROVAL: {
            CONFIRMED: [OPS, SYSTEM],
            CANCELLED: [...CANCELLERS, SYSTEM]
        },
        PENDING: {
            CONFIRMED: [OPS, SYSTEM],
            CANCELLED: CANCELLERS
        },
        CONFIRMED: {
            CANCELLED: CANCELLERS,
            COMPLETED: [OPS, SYSTEM],
            NO_SHOW: [OPS, SYSTEM]
        },
        CANCELLED: {},
        COMPLETED: {},
        NO_SHOW: {}
    }
});
