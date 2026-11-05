import { defineMachine } from '../stateMachine.js';
import { ACTOR } from '../transfer/machines.js';

/**
 * The commercial life of a hotel, tour or service booking.
 *
 * Written down late: these three ran for a year on hard-coded status checks,
 * and the approval step is what made a table worth having. PENDING_APPROVAL
 * is the platform's wait, PENDING the supplier's (an on-request tour or
 * service), and the two are sequential — the supplier is never asked about a
 * booking the platform may still refuse. The transfer booking's own table
 * lives beside the leg machine in `lib/transfer/machines.js`.
 */

const { OPS, PARTNER, GUEST, SYSTEM } = ACTOR;

const CANCELLERS = [OPS, PARTNER, GUEST, SYSTEM];

const bookingTransitions = {
    PENDING_APPROVAL: {
        // Approved: confirmed outright, or passed to the supplier.
        CONFIRMED: [OPS, SYSTEM],
        PENDING: [OPS, SYSTEM],
        // Rejected by operations, withdrawn by the buyer, or expired by the sweeper.
        CANCELLED: CANCELLERS
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
};

const terminal = ['CANCELLED', 'COMPLETED', 'NO_SHOW'];

export const hotelBookingMachine = defineMachine({ name: 'hotel booking', terminal, transitions: bookingTransitions });
export const tourBookingMachine = defineMachine({ name: 'tour booking', terminal, transitions: bookingTransitions });
export const serviceBookingMachine = defineMachine({ name: 'service booking', terminal, transitions: bookingTransitions });

/** The statuses in which a booking may still be cancelled by its buyer or by operations. */
export const CANCELLABLE_BOOKING_STATUSES = Object.freeze(['PENDING_APPROVAL', 'PENDING', 'CONFIRMED']);

/** The statuses in which the paperwork — names, requests, flight — may still be corrected. */
export const AMENDABLE_BOOKING_STATUSES = CANCELLABLE_BOOKING_STATUSES;

/** Every status a product booking can carry, for validation. */
export const BOOKING_STATUSES = Object.freeze(['PENDING_APPROVAL', 'PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']);

/** The products a standalone booking can be, keyed as the approval routes spell them. */
export const BOOKING_PRODUCTS = Object.freeze(['HOTEL', 'TRANSFER', 'TOUR', 'SERVICE', 'ORDER']);
