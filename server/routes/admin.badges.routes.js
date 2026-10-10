import { Router } from 'express';

import { prisma } from '../db/index.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { CAPABILITIES, can } from '../lib/permissions.js';
import { dateOnlyToUtc } from '../lib/time.js';
import { countDueInstalments } from '../services/finance/reminder.service.js';
import { countUnreadNotifications } from '../services/notifications/notification.service.js';
import { countPendingApprovals } from '../services/finance/approval.service.js';

/**
 * The queue counts on the admin panel's sidebar, in one request.
 *
 * The panel used to assemble these from five paginated list calls with
 * `pageSize: 1`, each of which ran its count *and* fetched one full row with
 * its includes, on every panel render and after every save. These are the
 * same `where` clauses the list endpoints use — a badge that says "3" must
 * open a queue that shows three — expressed as counts and nothing else.
 *
 * Open to dispatchers as well as admins, because the dispatch board has a
 * badge too; what a dispatcher may not see comes back as `null` rather than
 * a number they were never allowed to count. Mirrors `listDispatchLegs` for
 * the window: the same thirty days the client asks that list for.
 */
export const adminBadgeRoutes = Router();

adminBadgeRoutes.use(authenticate, requireCapability(CAPABILITIES.CATALOGUE_READ));

/** A hotel booking that still owes the operator something. */
const ACTIVE_BOOKING_STATUSES = ['PENDING', 'CONFIRMED'];

/** Applications submitted, and ones somebody is partway through filling in. */
const PENDING_PARTNER_STATUSES = ['PENDING_APPROVAL', 'REGISTRATION_IN_PROGRESS'];

/** How far ahead the dispatch board counts unassigned legs. */
const LEG_WINDOW_DAYS = 30;

/** How far ahead the payables badge counts supplier instalments. Same week the finance overview shows. */
const PAYMENTS_WINDOW_DAYS = 7;

adminBadgeRoutes.get('/', async (req, res) => {
    const partners = can(req.user, CAPABILITIES.PARTNERS_READ);
    const bookings = can(req.user, CAPABILITIES.BOOKINGS_READ);
    const dispatch = can(req.user, CAPABILITIES.DISPATCH_READ);
    const payables = can(req.user, CAPABILITIES.FINANCE_PAYABLES_READ);

    // The list takes `from`/`to` as calendar dates and treats `to` as
    // inclusive (`< to + 1 day`); the same arithmetic here keeps the badge and
    // the board in step at the window's far edge.
    const today = dateOnlyToUtc(new Date().toISOString().slice(0, 10));
    const until = new Date(today.getTime() + (LEG_WINDOW_DAYS + 1) * 86_400_000);

    const [pendingPartners, activeBookings, unassignedLegs, pendingTourRequests, pendingOrders, paymentsDue, unreadNotifications, pendingApprovals] =
        await Promise.all([
            partners ? prisma.partner.count({ where: { status: { in: PENDING_PARTNER_STATUSES } } }) : null,
            bookings ? prisma.hotelBooking.count({ where: { status: { in: ACTIVE_BOOKING_STATUSES } } }) : null,
            dispatch
                ? prisma.transferBookingLeg.count({
                      where: { status: 'UNASSIGNED', pickupAt: { gte: today, lt: until } }
                  })
                : null,
            bookings ? prisma.tourBooking.count({ where: { status: 'PENDING' } }) : null,
            bookings ? prisma.order.count({ where: { status: 'PENDING_CONFIRMATION' } }) : null,
            // Supplier instalments overdue or due this week: the Finance → Payables badge.
            payables ? countDueInstalments({ days: PAYMENTS_WINDOW_DAYS }) : null,
            // The bell. Everyone has one; it counts only the viewer's own rows.
            countUnreadNotifications(req.user.id),
            // Requests waiting on this viewer's decision; null for someone who decides none.
            countPendingApprovals(req.user)
        ]);

    res.json({ pendingPartners, activeBookings, unassignedLegs, pendingTourRequests, pendingOrders, paymentsDue, unreadNotifications, pendingApprovals });
});
