import { config } from '../../config.js';
import { CAPABILITIES, can } from '../permissions.js';

/**
 * Whether a booking waits for the platform's yes before it is confirmed.
 *
 * Owner decision OD1 (2026-10-20): every booking made without an online
 * payment — which is every booking, there being no card step — is approved
 * by an operator first. The one exception is a partner whose
 * `bookingApproval` an admin has set to AUTO, which keeps the instant
 * confirmation the platform started with; nothing sets that by itself.
 *
 * `manual` + `confirmNow` is the desk writing an already-agreed external
 * booking straight in as confirmed, which needs the same capability as
 * approving it would. Returned as a mode, not a boolean, so a third mode
 * (say, "deposit first") has somewhere to go.
 *
 *   AUTO      — written CONFIRMED, as before
 *   REQUIRED  — written PENDING_APPROVAL with its inventory claimed
 */
export const APPROVAL_MODES = Object.freeze(['AUTO', 'REQUIRED']);

export const approvalModeFor = (actor, { manual = false, confirmNow = false } = {}) => {
    if (!config.booking.approvalEnabled) return 'AUTO';
    if (manual && confirmNow && can(actor, CAPABILITIES.BOOKINGS_APPROVE)) return 'AUTO';
    if (actor?.partnerId) return actor.partner?.bookingApproval ?? 'REQUIRED';

    return 'REQUIRED';
};

/** When operations are told a waiting booking is overdue, from the moment it was written. */
export const approvalDeadlineFrom = (now = new Date()) =>
    new Date(now.getTime() + config.booking.approvalSlaHours * 60 * 60 * 1000);

/**
 * The columns a fresh booking carries for its approval state. REQUIRED is
 * written PENDING_APPROVAL with the request stamped; AUTO is written in
 * whatever status the product would have chosen on its own (`confirmed`
 * or, for an on-request product, `pending`).
 */
export const approvalStampsFor = (mode, { onRequest = false, now = new Date() } = {}) => {
    if (mode === 'REQUIRED') {
        return { status: 'PENDING_APPROVAL', approvalRequestedAt: now, approvalDeadlineAt: approvalDeadlineFrom(now) };
    }

    return onRequest ? { status: 'PENDING' } : { status: 'CONFIRMED', confirmedAt: now };
};

/** The label a serializer puts beside a booking: where its approval stands, or null when it never needed one. */
export const approvalOf = (booking, now = new Date()) => {
    if (!booking.approvalRequestedAt) return null;

    const state = booking.rejectedAt
        ? 'REJECTED'
        : booking.approvedAt
          ? 'APPROVED'
          : booking.status === 'PENDING_APPROVAL'
            ? 'PENDING'
            : 'WITHDRAWN';

    return {
        state,
        requestedAt: booking.approvalRequestedAt,
        deadlineAt: booking.approvalDeadlineAt ?? null,
        overdue: state === 'PENDING' && Boolean(booking.approvalDeadlineAt) && booking.approvalDeadlineAt < now,
        approvedAt: booking.approvedAt ?? null,
        approvedBy: booking.approvedByName ?? null,
        rejectedAt: booking.rejectedAt ?? null,
        rejectedBy: booking.rejectedByName ?? null,
        reason: booking.rejectionReason ?? null
    };
};

/** The name an approval or rejection is signed with: the actor's, or the system's. */
export const decidedByFor = (actor) => ({
    userId: actor?.id ?? null,
    name: actor ? [actor.firstName, actor.lastName].filter(Boolean).join(' ') || actor.email || 'Staff' : 'System'
});
