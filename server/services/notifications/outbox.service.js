import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import {
    adminApprovalUrl,
    adminBookingUrl,
    adminInvoiceUrl,
    adminPayableUrl,
    adminReceivableUrl,
    bookingManageUrl,
    driverPanelUrl,
    formatLocal,
    formatMoney,
    portalFinanceUrl,
    portalUrl,
    ratingUrl,
    relativeDays,
    sendMail
} from '../../lib/mailer/index.js';
import { TOPICS, outboxContext } from '../../lib/outbox.js';
import { AUDIT_ENTITY, recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { CAPABILITIES } from '../../lib/permissions.js';
import { daysBetween, todayInTimezone } from '../../lib/time.js';
import { issueRatingToken } from '../../lib/transfer/ratingToken.js';
import { usersWithCapability } from '../rbac/access.js';
import { APPROVE_CAPABILITY_FOR_KIND } from '../finance/approval.service.js';
import { cancelInvoiceRemote, issueInvoice, recordProviderPayment, sendInvoice } from '../invoicing/invoice.service.js';
import { contactRevealed } from '../../serializers/dispatch.js';
import { sendTransferVoucher } from '../transfer/notify.service.js';
import { categoryOf } from '../../lib/notifications/categories.js';
import { sqlStateOf } from '../../middleware/errors.js';

/**
 * The outbox drain.
 *
 * Turns events written by the dispatch service into in-app notifications
 * and emails. Runs on an interval under an advisory lock, so several
 * instances may run it and only one will; a handler that throws leaves the
 * event to be retried with a growing delay, and after enough attempts it is
 * marked processed with the error kept, rather than blocking everything
 * behind it forever.
 *
 * Push and SMS are new entries in the channel table below; nothing else
 * changes when they arrive.
 *
 * Every handler sends with `sendMail`, which throws, and never with
 * `sendMailQuietly`. That is deliberate and it is the whole retry story: a
 * swallowed SMTP error would mark the event processed and the message would
 * be gone for good, whereas a thrown one leaves the event for the next
 * attempt. A handler here has no HTTP request to protect, so there is nothing
 * a quiet failure would be buying.
 */

const MAX_ATTEMPTS = 8;

const backoffMs = (attempts) => Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));

/**
 * The event a handler is running for, reachable from anywhere beneath it
 * without threading it through every signature. Set by `processEvent`; read
 * by `notify`, which needs it to keep a retried handler from handing out the
 * same in-app notice twice.
 */
const processing = outboxContext;
const currentEvent = () => processing.getStore()?.event ?? null;

// --- Lookups ---------------------------------------------------------------

const legWithContext = (legId) =>
    prisma.transferBookingLeg.findUnique({
        where: { id: legId },
        include: {
            fromPoint: { select: { kind: true, timezone: true } },
            booking: {
                include: {
                    partner: { select: { id: true, name: true } },
                    bookedByUser: { select: { id: true, email: true, firstName: true, isActive: true } }
                }
            },
            assignments: {
                where: { status: { in: ['OFFERED', 'ACCEPTED', 'COMPLETED', 'NO_SHOW'] } },
                orderBy: { assignedAt: 'desc' },
                take: 1,
                include: {
                    driver: { include: { user: { select: { id: true, email: true, isActive: true } } } },
                    fleetVehicle: { select: { make: true, model: true, colour: true, plateNumber: true } }
                }
            }
        }
    });

const driverWithUser = (driverId) =>
    prisma.transferDriver.findUnique({
        where: { id: driverId },
        include: { user: { select: { id: true, email: true, isActive: true } } }
    });

/** Who runs the fleet: everyone on the platform side who dispatches. */
const opsUserIds = () => usersWithCapability(CAPABILITIES.DISPATCH_WRITE, { partnerId: null });

/**
 * Who hears about money owed to suppliers: every active member of staff who
 * reads payables — the finance desk, management and the admins — and by
 * construction never a dispatcher or the reservations desk. Asked of the
 * roles as they are now, overrides included, not of a table in code.
 */
const financeUserIds = () => usersWithCapability(CAPABILITIES.FINANCE_PAYABLES_READ, { partnerId: null });

/** A partner company's people who read its statement: the owner, its admins and its finance role. */
const partnerFinanceUserIds = (partnerId) => usersWithCapability(CAPABILITIES.PARTNER_STATEMENT_READ, { partnerId });

/** The partner-side person to tell: whoever booked, else the company's primary contact. */
const partnerRecipient = async (booking) => {
    if (!booking.partnerId) return null;
    // Whoever booked, when they belong to the partner: a member of staff who
    // booked on the partner's behalf is not the one to tell.
    if (booking.bookedByUser?.isActive && (booking.bookedByUser.partnerId === undefined || booking.bookedByUser.partnerId === booking.partnerId)) {
        return booking.bookedByUser;
    }

    return prisma.user.findFirst({
        where: { partnerId: booking.partnerId, isActive: true },
        orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, email: true, firstName: true }
    });
};

/**
 * Writes one notice per recipient.
 *
 * A recipient list is read a moment before it is used, and an account can be
 * deleted in between — an admin removed while the drain runs. The foreign key
 * refuses the whole batch, so on that one failure the list is re-read and
 * the insert tried once more with whoever is still there.
 */
const notify = async (recipients, { kind, title, body, payload = {}, entityType = null, entityId = null, dedupeKey = null }) => {
    const event = currentEvent();
    const stamped = event ? { ...payload, outboxEventId: event.id } : payload;

    // A retry is a handler that got part-way last time — most likely the
    // relay refused the email that follows the notice. The people already
    // told must not be told again, so on a retry (and only on a retry, which
    // is what keeps the first attempt cheap) the notice is checked for first.
    // A notice with a dedupe key needs none of this: the unique index drops
    // the second copy whoever writes it.
    let pending = recipients;

    if (!dedupeKey && event && event.attempts > 0 && recipients.length > 0) {
        const already = await prisma.notification.findMany({
            where: { kind, recipientUserId: { in: recipients }, payload: { path: ['outboxEventId'], equals: event.id } },
            select: { recipientUserId: true }
        });
        const seen = new Set(already.map((row) => row.recipientUserId));
        pending = recipients.filter((id) => !seen.has(id));
    }

    const insert = (ids) =>
        ids.length === 0
            ? Promise.resolve()
            : prisma.notification.createMany({
                  data: ids.map((recipientUserId) => ({
                      recipientUserId,
                      kind,
                      category: categoryOf(kind),
                      title,
                      body,
                      payload: stamped,
                      entityType,
                      entityId,
                      dedupeKey
                  })),
                  skipDuplicates: Boolean(dedupeKey)
              });

    // Bounded, not once: the ops list can lose two accounts in the same
    // moment when several administrators are removed together, and a single
    // re-read that then fails the same way would fail the whole event.
    for (let attempt = 0; ; attempt += 1) {
        try {
            await insert(pending);

            return;
        } catch (err) {
            if ((sqlStateOf(err) !== '23503' && err?.code !== 'P2003') || attempt >= 3) {
                throw err;
            }

            const stillThere = await prisma.user.findMany({ where: { id: { in: pending } }, select: { id: true } });
            pending = stillThere.map((row) => row.id);
        }
    }
};

const legLine = (leg) => `${leg.fromPointName} → ${leg.toPointName}`;

const mailData = (leg) => ({
    reference: leg.booking.reference,
    from: leg.fromPointName,
    to: leg.toPointName,
    pickupAt: leg.pickupAt,
    timezone: leg.fromPoint?.timezone ?? 'Asia/Tbilisi',
    passengers: leg.booking.adults + leg.booking.children,
    passengerName: leg.booking.leadPassengerName,
    passengerPhone: leg.booking.leadPassengerPhone,
    flightNumber: leg.booking.flightNumber,
    pickupAddress: leg.booking.pickupAddress
});

const driverLine = (assignment) =>
    assignment
        ? {
              driverName: `${assignment.driver.firstName} ${assignment.driver.lastName}`,
              driverPhone: assignment.driver.phone,
              vehicle: assignment.fleetVehicle
                  ? `${assignment.fleetVehicle.make} ${assignment.fleetVehicle.model}${assignment.fleetVehicle.colour ? `, ${assignment.fleetVehicle.colour}` : ''} · ${assignment.fleetVehicle.plateNumber}`
                  : null
          }
        : {};

// --- Handlers -------------------------------------------------------------------

/** An order with enough of its children to write a mail about it. */
const loadOrderForMail = (orderId) =>
    prisma.order.findUnique({
        where: { id: orderId },
        include: {
            partner: { select: { name: true } },
            items: {
                orderBy: { slotIndex: 'asc' },
                include: {
                    hotelBooking: { select: { reference: true, status: true } },
                    transferBooking: { select: { reference: true, status: true } },
                    tourBooking: { select: { reference: true, status: true } },
                    serviceBooking: { select: { reference: true, status: true } }
                }
            }
        }
    });

const orderMailData = (order) => {
    const child = (item) => item.hotelBooking ?? item.transferBooking ?? item.tourBooking ?? item.serviceBooking;
    const items = order.items.map((item) => ({ label: item.label, reference: child(item)?.reference ?? '—', status: item.status }));

    return {
        reference: order.reference,
        packageName: order.packageSnapshot?.name ?? 'Package',
        startDate: order.startDate.toISOString().slice(0, 10),
        endDate: order.endDate.toISOString().slice(0, 10),
        leadName: order.leadName,
        totalCents: order.sellTotalCents,
        currency: order.currency,
        items,
        pending: items.filter((item) => item.status === 'REQUESTED'),
        partnerName: order.partner?.name ?? null,
        requestDeadlineAt: order.requestDeadlineAt
    };
};

const handlers = {
    [TOPICS.ASSIGNMENT_OFFERED]: async ({ legId, driverId, assignmentId, onBehalf }) => {
        const [leg, driver] = await Promise.all([legWithContext(legId), driverWithUser(driverId)]);
        if (!leg || !driver) return;

        if (driver.user?.isActive) {
            await notify([driver.user.id], {
                kind: 'TRANSFER_ASSIGNMENT_OFFERED',
                title: onBehalf ? 'New transfer assigned to you' : 'New transfer offered to you',
                body: `${legLine(leg)} · ${leg.booking.reference}`,
                payload: { assignmentId, legId, bookingReference: leg.booking.reference },
                entityType: 'TransferAssignment',
                entityId: assignmentId
            });

            await sendMail({
                to: driver.user.email,
                template: 'transferAssignmentOffered',
                data: { ...mailData(leg), driverName: driver.firstName, onBehalf, url: driverPanelUrl(assignmentId) }
            });
        }
    },

    [TOPICS.ASSIGNMENT_ACCEPTED]: async ({ legId, assignmentId }) => {
        const leg = await legWithContext(legId);
        if (!leg) return;
        const assignment = leg.assignments[0];

        await notify(await opsUserIds(), {
            kind: 'TRANSFER_ASSIGNMENT_ACCEPTED',
            title: `${assignment ? `${assignment.driver.firstName} ${assignment.driver.lastName}` : 'Driver'} accepted ${leg.booking.reference}`,
            body: legLine(leg),
            payload: { assignmentId, legId, bookingReference: leg.booking.reference },
            entityType: 'TransferAssignment',
            entityId: assignmentId
        });

        const recipient = await partnerRecipient(leg.booking);

        if (recipient) {
            await notify([recipient.id], {
                kind: 'TRANSFER_ASSIGNMENT_ACCEPTED',
                title: `Driver confirmed for ${leg.booking.reference}`,
                body: `${assignment?.driver.firstName ?? 'A driver'} will drive ${legLine(leg)}`,
                payload: { legId, bookingReference: leg.booking.reference },
                entityType: 'TransferBookingLeg',
                entityId: legId
            });

            const revealed = contactRevealed(leg);

            await sendMail({
                to: recipient.email,
                template: 'transferDriverAssigned',
                data: { ...mailData(leg), ...driverLine(assignment), driverPhone: revealed ? assignment?.driver.phone : null }
            });
        }
    },

    [TOPICS.ASSIGNMENT_DECLINED]: async ({ legId, driverId, reason }) => {
        const [leg, driver] = await Promise.all([legWithContext(legId), driverWithUser(driverId)]);
        if (!leg) return;

        await notify(await opsUserIds(), {
            kind: 'TRANSFER_ASSIGNMENT_DECLINED',
            title: `${driver ? `${driver.firstName} ${driver.lastName}` : 'Driver'} declined ${leg.booking.reference}`,
            body: `${legLine(leg)} needs a driver${reason ? ` — "${reason}"` : ''}`,
            payload: { legId, bookingReference: leg.booking.reference },
            entityType: 'TransferBookingLeg',
            entityId: legId
        });
    },

    [TOPICS.ASSIGNMENT_REVOKED]: async ({ legId, driverId, assignmentId, reason }) => {
        const [leg, driver] = await Promise.all([legWithContext(legId), driverWithUser(driverId)]);
        if (!leg || !driver?.user?.isActive) return;

        await notify([driver.user.id], {
            kind: 'TRANSFER_ASSIGNMENT_REVOKED',
            title: `${leg.booking.reference} is no longer yours`,
            body: `${legLine(leg)} — ${reason === 'REASSIGNED' ? 'reassigned by dispatch' : reason === 'BOOKING_CANCELLED' ? 'the booking was cancelled' : 'withdrawn by dispatch'}`,
            payload: { assignmentId, legId, bookingReference: leg.booking.reference, reason },
            entityType: 'TransferAssignment',
            entityId: assignmentId
        });

        await sendMail({
            to: driver.user.email,
            template: 'transferAssignmentRevoked',
            data: { ...mailData(leg), driverName: driver.firstName, reason }
        });
    },

    [TOPICS.BOOKING_CANCELLED]: async ({ legId, driverId }) => {
        // The revocation event already told the driver; this one is the ops record.
        const leg = await legWithContext(legId);
        if (!leg) return;

        await notify(await opsUserIds(), {
            kind: 'TRANSFER_BOOKING_CANCELLED',
            title: `${leg.booking.reference} cancelled${driverId ? ' with a driver assigned' : ''}`,
            body: legLine(leg),
            payload: { legId, bookingReference: leg.booking.reference },
            entityType: 'TransferBookingLeg',
            entityId: legId
        });
    },

    [TOPICS.LEG_STATUS_CHANGED]: async ({ legId, to }) => {
        if (!['ARRIVED', 'ON_BOARD', 'COMPLETED'].includes(to)) return;
        const leg = await legWithContext(legId);
        if (!leg) return;
        const recipient = await partnerRecipient(leg.booking);
        if (!recipient) return;

        const wording = { ARRIVED: 'The driver has arrived at the pick-up', ON_BOARD: 'Your passenger is on board', COMPLETED: 'Transfer completed' }[to];

        await notify([recipient.id], {
            kind: 'TRANSFER_LEG_STATUS_CHANGED',
            title: `${wording} · ${leg.booking.reference}`,
            body: legLine(leg),
            payload: { legId, bookingReference: leg.booking.reference, status: to },
            entityType: 'TransferBookingLeg',
            entityId: legId
        });
    },

    [TOPICS.LEG_NO_SHOW_REPORTED]: async ({ legId, driverId }) => {
        const [leg, driver] = await Promise.all([legWithContext(legId), driverId ? driverWithUser(driverId) : null]);
        if (!leg) return;

        await notify(await opsUserIds(), {
            kind: 'TRANSFER_LEG_NO_SHOW_REPORTED',
            title: `No-show reported on ${leg.booking.reference}`,
            body: `${driver ? `${driver.firstName} ${driver.lastName}` : 'The driver'} is waiting at ${leg.fromPointName} — confirm or correct`,
            payload: { legId, bookingReference: leg.booking.reference },
            entityType: 'TransferBookingLeg',
            entityId: legId
        });
    },

    [TOPICS.LEG_UNASSIGNED_ALERT]: async ({ legId }) => {
        const leg = await legWithContext(legId);
        if (!leg) return;

        await notify(await opsUserIds(), {
            kind: 'TRANSFER_LEG_UNASSIGNED_ALERT',
            title: `${leg.booking.reference} still has no driver`,
            body: `${legLine(leg)} · pick-up within 24 hours`,
            payload: { legId, bookingReference: leg.booking.reference },
            entityType: 'TransferBookingLeg',
            entityId: legId
        });

        if (config.transfer.dispatch.opsEmail) {
            await sendMail({
                to: config.transfer.dispatch.opsEmail,
                template: 'transferUnassignedAlert',
                data: mailData(leg)
            });
        }
    },

    [TOPICS.TOUR_REQUEST_OVERDUE]: async ({ bookingId }) => {
        const booking = await prisma.tourBooking.findUnique({
            where: { id: bookingId },
            include: {
                tour: { select: { title: true, timezone: true } },
                partner: { select: { name: true, reference: true } }
            }
        });

        // Answered or withdrawn since the sweep: nothing to say.
        if (!booking || booking.status !== 'PENDING') return;

        const data = {
            reference: booking.reference,
            tourTitle: booking.tour?.title ?? booking.tourSnapshot?.title ?? 'Tour',
            optionName: booking.tourSnapshot?.option?.name ?? null,
            date: booking.date,
            timezone: booking.tour?.timezone ?? 'Asia/Tbilisi',
            travellers: booking.adults + (booking.childAges?.length ?? 0),
            partnerName: booking.partner?.name ?? null,
            requestDeadlineAt: booking.requestDeadlineAt
        };

        await notify(await opsUserIds(), {
            kind: 'TOUR_REQUEST_OVERDUE',
            title: `${booking.reference} is waiting for the operator`,
            body: `${data.tourTitle}${data.optionName ? ` · ${data.optionName}` : ''} · request unanswered past its deadline`,
            payload: { bookingId, bookingReference: booking.reference },
            entityType: 'TourBooking',
            entityId: bookingId
        });

        if (config.transfer.dispatch.opsEmail) {
            await sendMail({ to: config.transfer.dispatch.opsEmail, template: 'tourRequestOverdue', data });
        }
    },


    // --- orders ---------------------------------------------------------------

    [TOPICS.ORDER_CONFIRMED]: async ({ orderId }) => {
        const order = await loadOrderForMail(orderId);

        if (!order || order.status !== 'CONFIRMED') return;

        await sendMail({ to: order.leadEmail, template: 'orderConfirmed', data: orderMailData(order) });
    },

    [TOPICS.ORDER_REQUESTED]: async ({ orderId }) => {
        const order = await loadOrderForMail(orderId);

        if (!order || order.status !== 'PENDING_CONFIRMATION') return;

        await sendMail({ to: order.leadEmail, template: 'orderRequested', data: orderMailData(order) });
    },

    [TOPICS.ORDER_ITEM_DECLINED]: async ({ orderId, slotIndex, reason }) => {
        const order = await loadOrderForMail(orderId);

        if (!order) return;

        const item = order.items.find((candidate) => candidate.slotIndex === slotIndex);

        await sendMail({
            to: order.leadEmail,
            template: 'orderItemDeclined',
            data: { ...orderMailData(order), label: item?.label ?? 'A part of the order', reason }
        });
    },

    [TOPICS.ORDER_CANCELLED]: async ({ orderId, chargeCents, reason }) => {
        const order = await loadOrderForMail(orderId);

        // A rejected order (OD1) was cancelled by the platform saying no;
        // the rejection note covers it and a second "cancelled" mail would read
        // as if the buyer had done it.
        if (!order || order.rejectedAt) return;

        await sendMail({
            to: order.leadEmail,
            template: 'orderCancelled',
            data: { ...orderMailData(order), chargeCents: chargeCents ?? order.cancellationChargeCents ?? 0, reason: reason ?? null }
        });
    },

    [TOPICS.ORDER_REQUEST_OVERDUE]: async ({ orderId }) => {
        const order = await loadOrderForMail(orderId);

        if (!order || order.status !== 'PENDING_CONFIRMATION') return;

        const data = orderMailData(order);

        await notify(await opsUserIds(), {
            kind: 'ORDER_REQUEST_OVERDUE',
            title: `${order.reference} is waiting for a supplier`,
            body: `${data.packageName} · ${data.pending.map((item) => item.label).join(', ')} unanswered past the deadline`,
            payload: { orderId, orderReference: order.reference },
            entityType: 'Order',
            entityId: orderId
        });

        if (config.transfer.dispatch.opsEmail) {
            await sendMail({ to: config.transfer.dispatch.opsEmail, template: 'orderRequestOverdue', data });
        }
    },

    [TOPICS.PICKUP_REMINDER]: async ({ legId, assignmentId, driverId }) => {
        const [leg, driver] = await Promise.all([legWithContext(legId), driverWithUser(driverId)]);
        if (!leg || !driver?.user?.isActive) return;

        await notify([driver.user.id], {
            kind: 'TRANSFER_PICKUP_REMINDER',
            title: `Pick-up soon · ${leg.booking.reference}`,
            body: legLine(leg),
            payload: { assignmentId, legId, bookingReference: leg.booking.reference },
            entityType: 'TransferAssignment',
            entityId: assignmentId
        });

        await sendMail({
            to: driver.user.email,
            template: 'transferPickupReminder',
            data: { ...mailData(leg), driverName: driver.firstName, url: driverPanelUrl(assignmentId) }
        });
    },

    [TOPICS.DRIVER_DETAILS]: async ({ legId }) => {
        const leg = await legWithContext(legId);
        if (!leg) return;
        const assignment = leg.assignments[0];
        if (!assignment || assignment.status !== 'ACCEPTED') return;

        const recipient = await partnerRecipient(leg.booking);
        const addresses = new Set([leg.booking.leadPassengerEmail, recipient?.email].filter(Boolean));

        for (const to of addresses) {
            await sendMail({
                to,
                template: 'transferDriverDetails',
                data: { ...mailData(leg), ...driverLine(assignment) }
            });
        }
    },

    [TOPICS.RATING_INVITE]: async ({ legId }) => {
        const leg = await legWithContext(legId);
        if (!leg || leg.status !== 'COMPLETED') return;
        const assignment = leg.assignments[0];

        const token = issueRatingToken({ legId, email: leg.booking.leadPassengerEmail });

        await sendMail({
            to: leg.booking.leadPassengerEmail,
            template: 'transferRatingInvite',
            data: { ...mailData(leg), ...driverLine(assignment), url: ratingUrl(token) }
        });
    },

    [TOPICS.RATING_RECEIVED]: async ({ driverId, score, status }) => {
        if (status !== 'PUBLISHED') return;
        const driver = await driverWithUser(driverId);
        if (!driver?.user?.isActive) return;

        await notify([driver.user.id], {
            kind: 'TRANSFER_RATING_RECEIVED',
            title: `You received a ${score}-star rating`,
            body: 'Thank you for driving with us.',
            payload: { score }
        });
    },

    // --- standalone bookings: the guest -----------------------------------------
    //
    // Each handler re-reads the booking rather than trusting the payload: the
    // email should describe the row as it is, and a payload is only ever an
    // id plus whatever the facade knew that the row does not (a charge, a
    // reason). A booking that has since been deleted has nobody to write to.

    [TOPICS.HOTEL_BOOKING_CONFIRMED]: async ({ bookingId }) => {
        const booking = await loadHotelBookingForMail(bookingId);
        if (!booking) return;

        await sendMail({ to: booking.leadGuestEmail, template: 'hotelBookingConfirmed', data: hotelGuestData(booking) });
    },

    [TOPICS.HOTEL_BOOKING_CANCELLED]: async ({ bookingId, chargeCents, reason }) => {
        const booking = await loadHotelBookingForMail(bookingId);
        if (!booking) return;

        await sendMail({
            to: booking.leadGuestEmail,
            template: 'hotelBookingCancelled',
            data: {
                ...hotelGuestData(booking),
                chargeCents: chargeCents ?? booking.cancellationChargeCents ?? 0,
                reason: reason ?? booking.cancellationReason ?? null
            }
        });
    },

    [TOPICS.TOUR_BOOKING_CONFIRMED]: async ({ bookingId }) => {
        const booking = await loadTourBookingForMail(bookingId);
        if (!booking) return;

        await sendMail({ to: booking.leadTravellerEmail, template: 'tourBookingConfirmed', data: tourGuestData(booking) });
    },

    [TOPICS.TOUR_BOOKING_REQUESTED]: async ({ bookingId }) => {
        const booking = await loadTourBookingForMail(bookingId);
        if (!booking) return;

        await sendMail({ to: booking.leadTravellerEmail, template: 'tourBookingRequested', data: tourGuestData(booking) });
    },

    [TOPICS.TOUR_BOOKING_DECLINED]: async ({ bookingId, reason }) => {
        const booking = await loadTourBookingForMail(bookingId);
        if (!booking) return;

        await sendMail({
            to: booking.leadTravellerEmail,
            template: 'tourBookingDeclined',
            data: { ...tourGuestData(booking), reason: reason ?? booking.declineReason ?? null }
        });
    },

    [TOPICS.TOUR_BOOKING_CANCELLED]: async ({ bookingId, chargeCents, reason }) => {
        const booking = await loadTourBookingForMail(bookingId);
        if (!booking) return;

        await sendMail({
            to: booking.leadTravellerEmail,
            template: 'tourBookingCancelled',
            data: {
                ...tourGuestData(booking),
                chargeCents: chargeCents ?? booking.cancellationChargeCents ?? 0,
                reason: reason ?? booking.cancellationReason ?? null
            }
        });
    },

    [TOPICS.SERVICE_BOOKING_CONFIRMED]: async ({ bookingId }) => {
        const booking = await loadServiceBookingForMail(bookingId);
        if (!booking) return;

        await sendMail({ to: booking.leadEmail, template: 'serviceBookingConfirmed', data: serviceGuestData(booking) });
    },

    [TOPICS.SERVICE_BOOKING_REQUESTED]: async ({ bookingId }) => {
        const booking = await loadServiceBookingForMail(bookingId);
        if (!booking) return;

        await sendMail({ to: booking.leadEmail, template: 'serviceBookingRequested', data: serviceGuestData(booking) });
    },

    [TOPICS.SERVICE_BOOKING_DECLINED]: async ({ bookingId, reason }) => {
        const booking = await loadServiceBookingForMail(bookingId);
        if (!booking) return;

        await sendMail({
            to: booking.leadEmail,
            template: 'serviceBookingDeclined',
            data: { ...serviceGuestData(booking), reason: reason ?? booking.declineReason ?? null }
        });
    },

    [TOPICS.SERVICE_BOOKING_CANCELLED]: async ({ bookingId, chargeCents, reason }) => {
        const booking = await loadServiceBookingForMail(bookingId);
        if (!booking) return;

        await sendMail({
            to: booking.leadEmail,
            template: 'serviceBookingCancelled',
            data: {
                ...serviceGuestData(booking),
                chargeCents: chargeCents ?? booking.cancellationChargeCents ?? 0,
                reason: reason ?? booking.cancellationReason ?? null
            }
        });
    },

    // --- standalone bookings: the supplier --------------------------------------

    [TOPICS.SUPPLIER_BOOKING_RECEIVED]: async ({ product, bookingId, requested }) => {
        const view = await supplierViews[product]?.(bookingId);
        if (!view) return;

        const to = await supplierAddress(view);
        if (!to) return;

        await sendMail({
            to: to.email,
            template: 'supplierBookingReceived',
            data: { ...view.data, requested: requested ?? view.data.requested, partnerName: to.name, url: portalUrl() }
        });
    },

    [TOPICS.SUPPLIER_BOOKING_CANCELLED]: async ({ product, bookingId, reason }) => {
        const view = await supplierViews[product]?.(bookingId);
        if (!view) return;

        // A booking the platform never approved was never put to the supplier
        // (OD1); there is nothing for them to un-hear.
        if (view.neverAnnounced) return;

        const to = await supplierAddress(view);
        if (!to) return;

        await sendMail({
            to: to.email,
            template: 'supplierBookingCancelled',
            data: { ...view.data, reason: reason ?? view.data.reason ?? null, partnerName: to.name, url: portalUrl() }
        });
    },

    // --- booking approval (OD1) --------------------------------------------------
    //
    // `payload.product` says which table `bookingId` points into. The buyer
    // is written to at every step; the operators who may decide get an in-app
    // notice when something arrives or goes overdue; the partner's people
    // get one when it is decided. The confirmation the buyer would have had
    // at booking follows an approval, by the product's own handler.

    [TOPICS.BOOKING_AWAITING_APPROVAL]: async ({ product, bookingId }) => {
        const view = await approvalViews[product]?.(bookingId);
        if (!view || view.status !== 'PENDING_APPROVAL') return;

        const approvers = (await usersWithCapability(CAPABILITIES.BOOKINGS_APPROVE, { partnerId: null })).filter((id) => id !== view.bookedByUserId);

        await notify(approvers, {
            kind: 'BOOKING_AWAITING_APPROVAL',
            title: `${view.reference} is waiting for approval`,
            body: `${view.title} · ${view.leadName}${view.partnerName ? ` · ${view.partnerName}` : ''}`,
            payload: { product, bookingId, bookingReference: view.reference, deadlineAt: view.deadlineAt },
            entityType: view.entityType,
            entityId: bookingId,
            dedupeKey: `booking:${product}:${bookingId}:awaiting`
        });

        await sendMail({ to: view.leadEmail, template: 'bookingAwaitingApproval', data: view.mail });

        if (config.booking.opsEmail) {
            await sendMail({ to: config.booking.opsEmail, template: 'bookingApprovalQueue', data: view.mail });
        }
    },

    [TOPICS.BOOKING_APPROVED]: async ({ product, bookingId }) => {
        const view = await approvalViews[product]?.(bookingId);
        if (!view || !view.approvedAt) return;

        if (view.partnerId) {
            await notify(await usersWithCapability(CAPABILITIES.PARTNER_BOOKINGS_READ, { partnerId: view.partnerId }), {
                kind: 'BOOKING_APPROVED',
                title: `${view.reference} is approved`,
                body: `${view.title} · ${view.leadName}`,
                payload: { product, bookingId, bookingReference: view.reference },
                entityType: view.entityType,
                entityId: bookingId,
                dedupeKey: `booking:${product}:${bookingId}:approved`
            });
        }

        // The confirmation (or "we have passed your request on") the buyer
        // would have had at booking.
        if (view.confirm) {
            await handlers[view.confirm.topic](view.confirm.payload);
        }
    },

    [TOPICS.BOOKING_REJECTED]: async ({ product, bookingId, reason, expired }) => {
        const view = await approvalViews[product]?.(bookingId);
        if (!view || !view.rejectedAt) return;

        if (view.partnerId) {
            await notify(await usersWithCapability(CAPABILITIES.PARTNER_BOOKINGS_READ, { partnerId: view.partnerId }), {
                kind: 'BOOKING_REJECTED',
                title: `${view.reference} was ${expired ? 'not approved in time' : 'rejected'}`,
                body: `${view.title} · ${reason ?? view.reason ?? ''}`.trim(),
                payload: { product, bookingId, bookingReference: view.reference, reason: reason ?? view.reason ?? null, expired: Boolean(expired) },
                entityType: view.entityType,
                entityId: bookingId,
                dedupeKey: `booking:${product}:${bookingId}:rejected`
            });
        }

        await sendMail({ to: view.leadEmail, template: 'bookingRejected', data: { ...view.mail, reason: reason ?? view.reason ?? null, expired: Boolean(expired) } });
    },

    [TOPICS.BOOKING_APPROVAL_OVERDUE]: async ({ product, bookingId }) => {
        const view = await approvalViews[product]?.(bookingId);
        if (!view || view.status !== 'PENDING_APPROVAL') return;

        await notify(await usersWithCapability(CAPABILITIES.BOOKINGS_APPROVE, { partnerId: null }), {
            kind: 'BOOKING_APPROVAL_OVERDUE',
            title: `${view.reference} is still waiting for approval`,
            body: `${view.title} · ${view.leadName} · past its answer deadline`,
            payload: { product, bookingId, bookingReference: view.reference, deadlineAt: view.deadlineAt },
            entityType: view.entityType,
            entityId: bookingId,
            dedupeKey: `booking:${product}:${bookingId}:approval_overdue`
        });

        if (config.booking.opsEmail) {
            await sendMail({ to: config.booking.opsEmail, template: 'bookingApprovalOverdue', data: view.mail });
        }
    },

    /**
     * A booking arrived. The desk — whoever may change bookings — hears of
     * every one made, however it was sold. A booking that waits for
     * approval is announced by its awaiting-approval notice instead, so
     * nobody reads the same arrival twice.
     */
    [TOPICS.BOOKING_CREATED]: async ({ product, bookingId }) => {
        const view = await approvalViews[product]?.(bookingId);
        if (!view || view.status === 'PENDING_APPROVAL') return;

        const desk = (await usersWithCapability(CAPABILITIES.BOOKINGS_WRITE, { partnerId: null })).filter((id) => id !== view.bookedByUserId);

        await notify(desk, {
            kind: 'BOOKING_NEW',
            title: `New booking ${view.reference}`,
            body: `${view.title} · ${view.leadName}${view.partnerName ? ` · ${view.partnerName}` : ''}`,
            payload: { product, bookingId, bookingReference: view.reference },
            entityType: view.entityType,
            entityId: bookingId,
            dedupeKey: `booking:${product}:${bookingId}:new`
        });
    },

    /** The paperwork on a booking changed: names, a flight, a request. The desk is told. */
    [TOPICS.BOOKING_MODIFIED]: async ({ product, bookingId, fields = [], byUserId = null }) => {
        const view = await approvalViews[product]?.(bookingId);
        if (!view) return;

        const event = currentEvent();
        const desk = (await usersWithCapability(CAPABILITIES.BOOKINGS_WRITE, { partnerId: null })).filter((id) => id !== byUserId);

        await notify(desk, {
            kind: 'BOOKING_MODIFIED',
            title: `${view.reference} was amended`,
            body: `${view.title} · ${fields.length > 0 ? fields.join(', ') : 'paperwork changed'}`,
            payload: { product, bookingId, bookingReference: view.reference, fields },
            entityType: view.entityType,
            entityId: bookingId,
            // Once per amendment, not once per booking: keyed on the event.
            dedupeKey: event ? `booking:${product}:${bookingId}:modified:${event.id}` : null
        });
    },

    /**
     * A deadline is N days away. Who is told and how comes from the policy
     * that claimed it; the row is re-read first, so a deadline met or
     * closed since the claim is left alone.
     */
    [TOPICS.DEADLINE_UPCOMING]: async ({ deadlineId, offsetDays, policyId }) => {
        const deadline = await prisma.bookingDeadline.findUnique({ where: { id: deadlineId } });
        if (!deadline || deadline.status !== 'OPEN') return;

        const policy = policyId ? await prisma.reminderPolicy.findUnique({ where: { id: policyId } }) : null;
        const channels = new Set(policy?.channels ?? ['IN_APP']);
        const recipients = new Set(policy?.recipients ?? ['STAFF']);
        const view = await approvalViews[deadline.product]?.(deadline.bookingId);
        if (!view) return;

        const kind = DEADLINE_NOTICE_KIND[deadline.kind];
        const label = DEADLINE_LABEL[deadline.kind];
        const when = formatLocal(deadline.dueAt, deadline.timezone);
        const days = Number(offsetDays);
        const inWords = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
        const notice = {
            kind,
            title: `${label} for ${deadline.reference} ${inWords}`,
            body: `${deadline.title} · ${when}`,
            payload: { deadlineId, product: deadline.product, bookingId: deadline.bookingId, bookingReference: deadline.reference, kind: deadline.kind, dueAt: deadline.dueAt, offsetDays: days },
            entityType: view.entityType,
            entityId: deadline.bookingId,
            dedupeKey: `deadline:${deadlineId}:${days}`
        };
        const mail = { ...view.mail, deadlineKind: deadline.kind, deadlineLabel: label, dueAt: deadline.dueAt, timezone: deadline.timezone, offsetDays: days };

        if (recipients.has('STAFF') && channels.has('IN_APP')) {
            const staff = deadline.kind === 'PAYMENT' ? await usersWithCapability(CAPABILITIES.FINANCE_RECEIVABLES_READ, { partnerId: null }) : await usersWithCapability(CAPABILITIES.BOOKINGS_WRITE, { partnerId: null });

            await notify(staff, notice);
        }

        if (recipients.has('PARTNER') && deadline.partnerId) {
            if (channels.has('IN_APP')) {
                await notify(await usersWithCapability(CAPABILITIES.PARTNER_BOOKINGS_READ, { partnerId: deadline.partnerId }), notice);
            }

            if (channels.has('EMAIL')) {
                const to = await partnerContactEmail(deadline.partnerId);
                if (to) await sendMail({ to, template: 'deadlineReminder', data: { ...mail, forPartner: true } });
            }
        }

        // The guest (or desk customer) is the lead on the booking; a partner's
        // traveller is written to by the partner, not by us.
        if (recipients.has('GUEST') && channels.has('EMAIL') && !deadline.partnerId && view.leadEmail) {
            await sendMail({ to: view.leadEmail, template: 'deadlineReminder', data: mail });
        }
    },

    /** The transfer voucher, when it follows an approval rather than the booking request. */
    [TOPICS.TRANSFER_BOOKING_CONFIRMED]: async ({ bookingId }) => {
        const booking = await prisma.transferBooking.findUnique({ where: { id: bookingId } });
        if (!booking || booking.status !== 'CONFIRMED') return;

        await sendTransferVoucher(booking);
    },

    // --- finance ----------------------------------------------------------------
    //
    // Each handler re-reads the row and says nothing when the money is no
    // longer owed: the sweep claimed the reminder a moment before a payment
    // landed, or Finance voided the payable. The claim is never undone, so
    // a row that is re-opened later does not resend the offsets it passed.

    [TOPICS.PAYABLE_INSTALMENT_DUE]: async ({ instalmentId }) => {
        const instalment = await loadInstalmentForMail(instalmentId);
        if (!instalment || !instalmentOwed(instalment)) return;

        const data = instalmentMailData(instalment);
        if (data.daysUntil < 0) return; // overdue by now: the overdue alert covers it

        await notify(await financeUserIds(), {
            kind: 'FINANCE_PAYABLE_DUE',
            title: `${data.who}: ${data.instalmentLabel} (${formatMoney(data.amountCents, data.currency)}) due ${relativeDays(data.daysUntil)}`,
            body: `${data.bookingReference} · due ${formatLocal(data.dueAt, data.timezone)}`,
            payload: { payableId: data.payableId, instalmentId, bookingReference: data.bookingReference, daysUntil: data.daysUntil },
            entityType: 'SupplierPayable',
            entityId: data.payableId
        });

        if (config.finance.opsEmail) {
            await sendMail({ to: config.finance.opsEmail, template: 'financePayableDue', data });
        }
    },

    [TOPICS.PAYABLE_INSTALMENT_OVERDUE]: async ({ instalmentId }) => {
        const instalment = await loadInstalmentForMail(instalmentId);
        if (!instalment || !instalmentOwed(instalment) || instalment.dueAt >= new Date()) return;

        const data = instalmentMailData(instalment);

        await notify(await financeUserIds(), {
            kind: 'FINANCE_PAYABLE_OVERDUE',
            title: `${data.who}: ${data.instalmentLabel} (${formatMoney(data.amountCents, data.currency)}) overdue`,
            body: `${data.bookingReference} · was due ${formatLocal(data.dueAt, data.timezone)}`,
            payload: { payableId: data.payableId, instalmentId, bookingReference: data.bookingReference, daysOverdue: data.daysOverdue },
            entityType: 'SupplierPayable',
            entityId: data.payableId
        });

        if (config.finance.opsEmail) {
            await sendMail({ to: config.finance.opsEmail, template: 'financePayableOverdue', data });
        }
    },

    [TOPICS.RECEIVABLE_OVERDUE]: async ({ receivableId }) => {
        const receivable = await prisma.receivable.findUnique({
            where: { id: receivableId },
            include: { debtorPartner: { select: { id: true, name: true, email: true } } }
        });
        if (!receivable || !SETTLEABLE.has(receivable.status) || !receivable.dueAt || receivable.dueAt >= new Date()) return;

        const timezone = config.finance.defaultTimezone;
        const amountCents = Math.max(0, receivable.amountCents - receivable.paidCents);
        const daysOverdue = daysBetween(todayInTimezone(timezone, receivable.dueAt), todayInTimezone(timezone));
        const base = { reference: receivable.reference, amountCents, currency: receivable.currency, dueAt: receivable.dueAt, timezone, daysOverdue };

        await notify(await financeUserIds(), {
            kind: 'FINANCE_RECEIVABLE_OVERDUE',
            title: `${receivable.debtorName} owes ${formatMoney(amountCents, receivable.currency)} for ${receivable.reference} — overdue`,
            body: `Was due ${formatLocal(receivable.dueAt, timezone)}`,
            payload: { receivableId, reference: receivable.reference, daysOverdue },
            entityType: 'Receivable',
            entityId: receivableId
        });

        if (config.finance.opsEmail) {
            await sendMail({
                to: config.finance.opsEmail,
                template: 'financeReceivableOverdue',
                data: { ...base, debtorName: receivable.debtorName, url: adminReceivableUrl(receivableId) }
            });
        }

        // The debtor is nudged only when it is a company with a portal to
        // pay from. A guest's receivable is settled at the property or by
        // hand, and an automated chaser with nowhere to pay would be noise.
        if (!receivable.debtorPartnerId) return;

        await notify(await partnerFinanceUserIds(receivable.debtorPartnerId), {
            kind: 'FINANCE_RECEIVABLE_OVERDUE',
            title: `Payment overdue: ${formatMoney(amountCents, receivable.currency)} for ${receivable.reference}`,
            body: `Was due ${formatLocal(receivable.dueAt, timezone)} · please settle it at your earliest convenience`,
            payload: { receivableId, reference: receivable.reference, daysOverdue },
            entityType: 'Receivable',
            entityId: receivableId
        });

        const to = receivable.debtorEmail || receivable.debtorPartner?.email;

        if (to) {
            await sendMail({
                to,
                template: 'receivableOverdue',
                data: { ...base, debtorName: receivable.debtorPartner?.name ?? receivable.debtorName, url: portalFinanceUrl() }
            });
        }
    },

    /**
     * A receipt to whoever paid: the agency whose money arrived, or the
     * guest who paid for their own booking. Nothing for the other
     * directions: Finance recorded those itself.
     */
    [TOPICS.PAYMENT_RECORDED]: async ({ paymentId }) => {
        const payment = await prisma.paymentRecord.findUnique({
            where: { id: paymentId },
            include: {
                counterpartyPartner: { select: { id: true, name: true, email: true } },
                allocations: {
                    include: { receivable: { select: { reference: true, debtorName: true, debtorEmail: true } } },
                    orderBy: { createdAt: 'asc' }
                }
            }
        });
        if (!payment || payment.direction !== 'IN' || payment.kind !== 'PAYMENT') return;

        // The provider's ledger first, so a receipt is never sent for money
        // InvoiceOcean does not know about. Skips what it already posted.
        await recordProviderPayment(paymentId);

        const partnerId = payment.counterpartyPartnerId;
        // A guest's payment names its payer as Finance recorded it, or else
        // as the debtor of the booking it settles.
        const settled = payment.allocations.find((entry) => entry.receivable)?.receivable ?? null;

        const allocations = payment.allocations
            .filter((entry) => entry.receivable)
            .map((entry) => ({ reference: entry.receivable.reference, amountCents: entry.amountCents }));
        const allocatedCents = payment.allocations.reduce((sum, entry) => sum + Math.abs(entry.amountCents), 0);
        const data = {
            partnerName: partnerId ? payment.counterpartyPartner.name : payment.counterpartyName || settled?.debtorName || null,
            amountCents: payment.amountCents,
            currency: payment.currency,
            paidAt: payment.paidAt,
            method: payment.method,
            reference: payment.reference ?? null,
            allocations,
            unallocatedCents: Math.max(0, payment.amountCents - allocatedCents),
            // A guest has no statement page to open.
            url: partnerId ? portalFinanceUrl() : null
        };

        if (partnerId) {
            await notify(await partnerFinanceUserIds(partnerId), {
                kind: 'FINANCE_PAYMENT_RECEIVED',
                title: `Payment received: ${formatMoney(payment.amountCents, payment.currency)}`,
                body: allocations.length > 0 ? `Applied to ${allocations.map((entry) => entry.reference).join(', ')}` : 'Held on your account for your next open item',
                payload: { paymentId, reference: payment.reference ?? null },
                entityType: 'PaymentRecord',
                entityId: paymentId
            });
        }

        const to = partnerId
            ? payment.counterpartyPartner.email || (await partnerContactEmail(partnerId))
            : payment.counterpartyEmail || settled?.debtorEmail || null;

        if (to) {
            await sendMail({ to, template: 'paymentReceipt', data });
        }
    },

    /** A refund or an adjustment waits on a second person: everyone who may decide it, minus whoever asked. */
    [TOPICS.APPROVAL_REQUESTED]: async ({ approvalId }) => {
        const request = await prisma.approvalRequest.findUnique({ where: { id: approvalId }, include: { requestedBy: true } });
        if (!request || request.status !== 'PENDING') return;

        const approvers = (await usersWithCapability(APPROVE_CAPABILITY_FOR_KIND[request.kind], { partnerId: null })).filter((id) => id !== request.requestedByUserId);
        const kindLabel = APPROVAL_KIND_LABELS[request.kind];
        const requestedByName = request.requestedBy ? [request.requestedBy.firstName, request.requestedBy.lastName].filter(Boolean).join(' ') : 'Someone';

        await notify(approvers, {
            kind: 'APPROVAL_REQUESTED',
            title: `Approval needed: ${kindLabel}${request.amountCents != null && request.currency ? `, ${formatMoney(request.amountCents, request.currency)}` : ''}`,
            body: request.summary,
            payload: { approvalId, reference: request.reference, kind: request.kind },
            entityType: 'ApprovalRequest',
            entityId: approvalId
        });

        if (config.finance.opsEmail) {
            await sendMail({
                to: config.finance.opsEmail,
                template: 'approvalRequested',
                data: {
                    reference: request.reference,
                    kindLabel,
                    summary: request.summary,
                    requestedByName,
                    amountCents: request.amountCents,
                    currency: request.currency,
                    note: request.requestNote,
                    url: adminApprovalUrl(approvalId)
                }
            });
        }
    },

    /** The requester hears how it went. */
    [TOPICS.APPROVAL_DECIDED]: async ({ approvalId }) => {
        const request = await prisma.approvalRequest.findUnique({ where: { id: approvalId }, include: { requestedBy: true, decidedBy: true } });
        if (!request || !['APPROVED', 'REJECTED'].includes(request.status) || !request.requestedByUserId) return;

        const kindLabel = APPROVAL_KIND_LABELS[request.kind];
        const decidedByName = request.decidedBy ? [request.decidedBy.firstName, request.decidedBy.lastName].filter(Boolean).join(' ') : 'An approver';
        const verb = request.status === 'APPROVED' ? 'approved' : 'rejected';

        await notify([request.requestedByUserId], {
            kind: 'APPROVAL_DECIDED',
            title: `${kindLabel} ${verb}: ${request.reference}`,
            body: request.decisionNote ?? request.summary,
            payload: { approvalId, reference: request.reference, kind: request.kind, status: request.status },
            entityType: 'ApprovalRequest',
            entityId: approvalId
        });

        if (request.requestedBy?.isActive) {
            await sendMail({
                to: request.requestedBy.email,
                template: 'approvalDecided',
                data: {
                    reference: request.reference,
                    kindLabel,
                    summary: request.summary,
                    status: request.status,
                    decidedByName,
                    note: request.decisionNote,
                    url: adminApprovalUrl(approvalId)
                }
            });
        }
    }
};

/** A WARN-mode partner booked past its credit limit: the finance desk hears, in-app. */
handlers[TOPICS.CREDIT_LIMIT_WARNING] = async ({ partnerId, limitCents, outstandingCents, requestedCents, currency }) => {
    const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { name: true } });
    if (!partner) return;

    await notify(await financeUserIds(), {
        kind: 'FINANCE_CREDIT_WARNING',
        title: `Over its credit limit: ${partner.name}`,
        body: `Owes ${formatMoney(outstandingCents + requestedCents, currency)} open against a limit of ${formatMoney(limitCents, currency)} after this booking.`,
        payload: { partnerId, limitCents, outstandingCents, requestedCents, currency },
        entityType: 'Partner',
        entityId: partnerId
    });
};

// --- Invoicing ----------------------------------------------------------------------------
//
// The three "requested" handlers call the provider through the invoice
// service, which is idempotent: a retried event finds the document already
// there and adopts it. The other two tell people.

/** Creates the document at the provider. The last attempt is told so, so a failure then is recorded for Finance. */
handlers[TOPICS.INVOICE_ISSUE_REQUESTED] = async ({ invoiceId }) => {
    const event = currentEvent();
    await issueInvoice(invoiceId, { finalAttempt: Boolean(event) && event.attempts + 1 >= MAX_ATTEMPTS });
};

handlers[TOPICS.INVOICE_SEND_REQUESTED] = async ({ invoiceId, to }) => {
    const event = currentEvent();
    await sendInvoice(invoiceId, { to: to ?? null, finalAttempt: Boolean(event) && event.attempts + 1 >= MAX_ATTEMPTS });
};

handlers[TOPICS.INVOICE_CANCEL_REQUESTED] = async ({ invoiceId }) => {
    await cancelInvoiceRemote(invoiceId);
};

const INVOICE_KIND_LABELS = { PROFORMA: 'Proforma', VAT: 'VAT invoice', ADVANCE: 'Advance invoice', FINAL: 'Final invoice', CORRECTION: 'Correction' };

const loadInvoiceForNotice = (invoiceId) =>
    prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { receivable: { select: { id: true, reference: true, debtorPartnerId: true, debtorName: true } } }
    });

/** A document exists: the finance desk hears, and so does the company it is addressed to. */
handlers[TOPICS.INVOICE_ISSUED] = async ({ invoiceId }) => {
    const invoice = await loadInvoiceForNotice(invoiceId);
    if (!invoice || !invoice.externalId) return;

    const label = INVOICE_KIND_LABELS[invoice.kind] ?? invoice.kind;
    const number = invoice.externalNumber ?? invoice.externalId;

    await notify(await usersWithCapability(CAPABILITIES.INVOICES_READ, { partnerId: null }), {
        kind: 'FINANCE_INVOICE_ISSUED',
        title: `${label} ${number} issued for ${invoice.receivable.reference}`,
        body: `${invoice.receivable.debtorName} · ${formatMoney(invoice.totalCents, invoice.currency)}`,
        payload: { invoiceId, receivableId: invoice.receivableId, reference: invoice.receivable.reference, kind: invoice.kind, number },
        entityType: 'Invoice',
        entityId: invoiceId
    });

    if (!invoice.receivable.debtorPartnerId) return;

    await notify(await usersWithCapability(CAPABILITIES.PARTNER_INVOICES_READ, { partnerId: invoice.receivable.debtorPartnerId }), {
        kind: 'FINANCE_INVOICE_ISSUED',
        title: `${label} ${number} for ${invoice.receivable.reference}`,
        body: `${formatMoney(invoice.totalCents, invoice.currency)} · open it from your statement`,
        payload: { invoiceId, receivableId: invoice.receivableId, reference: invoice.receivable.reference, kind: invoice.kind, number },
        entityType: 'Invoice',
        entityId: invoiceId
    });
};

/** A document could not be issued: the finance desk hears in-app and by email, with the provider's own words. */
handlers[TOPICS.INVOICE_SYNC_FAILED] = async ({ invoiceId }) => {
    const invoice = await loadInvoiceForNotice(invoiceId);
    if (!invoice || invoice.status !== 'ERROR') return;

    const label = INVOICE_KIND_LABELS[invoice.kind] ?? invoice.kind;

    await notify(await usersWithCapability(CAPABILITIES.INVOICES_WRITE, { partnerId: null }), {
        kind: 'FINANCE_INVOICE_SYNC_FAILED',
        title: `${label} for ${invoice.receivable.reference} was not issued`,
        body: invoice.syncError ?? 'InvoiceOcean did not accept it',
        payload: { invoiceId, receivableId: invoice.receivableId, reference: invoice.receivable.reference, kind: invoice.kind },
        entityType: 'Invoice',
        entityId: invoiceId
    });

    if (config.finance.opsEmail) {
        await sendMail({
            to: config.finance.opsEmail,
            template: 'financeInvoiceSyncFailed',
            data: {
                kindLabel: label,
                reference: invoice.receivable.reference,
                debtorName: invoice.receivable.debtorName,
                amountCents: invoice.totalCents,
                currency: invoice.currency,
                error: invoice.syncError ?? 'InvoiceOcean did not accept it',
                url: adminInvoiceUrl(invoiceId)
            }
        });
    }
};

/**
 * One booking as the approval notices read it, whichever table it lives in.
 *
 * `mail` is what the four approval templates take; `confirm` is the
 * product's own confirmation handler and its payload, run after a yes.
 */
const approvalView = (row, { product, entityType, title, when, timezone, leadName, leadEmail, totalCents, url, confirm }) => ({
    product,
    status: row.status,
    reference: row.reference,
    title,
    leadName,
    leadEmail,
    partnerId: row.partnerId ?? null,
    partnerName: row.partner?.name ?? null,
    bookedByUserId: row.bookedByUserId ?? null,
    deadlineAt: row.approvalDeadlineAt ?? null,
    approvedAt: row.approvedAt ?? null,
    rejectedAt: row.rejectedAt ?? null,
    reason: row.rejectionReason ?? null,
    entityType,
    confirm,
    mail: {
        product,
        reference: row.reference,
        title,
        when,
        timezone,
        leadName,
        leadEmail,
        partnerName: row.partner?.name ?? null,
        currency: row.currency,
        totalCents,
        requestedAt: row.approvalRequestedAt ?? null,
        deadlineAt: row.approvalDeadlineAt ?? null,
        url,
        adminUrl: adminBookingUrl(product, row.reference)
    }
});

const partnerName = { partner: { select: { name: true } } };

const approvalViews = {
    HOTEL: async (id) => {
        const row = await prisma.hotelBooking.findUnique({ where: { id }, include: partnerName });
        if (!row) return null;

        return approvalView(row, {
            product: 'HOTEL',
            entityType: 'HotelBooking',
            title: row.hotelSnapshot?.name ?? 'Hotel',
            when: { from: row.checkIn, to: row.checkOut, kind: 'DATES' },
            timezone: row.hotelSnapshot?.timezone ?? 'Asia/Tbilisi',
            leadName: row.leadGuestName,
            leadEmail: row.leadGuestEmail,
            totalCents: row.sellTotalCents + (row.taxTotalCents ?? 0),
            url: bookingManageUrl(row.reference, row.leadGuestEmail),
            confirm: { topic: TOPICS.HOTEL_BOOKING_CONFIRMED, payload: { bookingId: row.id } }
        });
    },
    TRANSFER: async (id) => {
        const row = await prisma.transferBooking.findUnique({ where: { id }, include: partnerName });
        if (!row) return null;

        return approvalView(row, {
            product: 'TRANSFER',
            entityType: 'TransferBooking',
            title: `${row.routeSnapshot?.fromName ?? 'Transfer'} → ${row.routeSnapshot?.toName ?? ''}`.trim(),
            when: { from: row.pickupAt, to: row.returnPickupAt ?? null, kind: 'INSTANT' },
            timezone: row.routeSnapshot?.fromTimezone ?? 'Asia/Tbilisi',
            leadName: row.leadPassengerName,
            leadEmail: row.leadPassengerEmail,
            totalCents: row.sellTotalCents,
            url: bookingManageUrl(row.reference, row.leadPassengerEmail),
            confirm: { topic: TOPICS.TRANSFER_BOOKING_CONFIRMED, payload: { bookingId: row.id } }
        });
    },
    TOUR: async (id) => {
        const row = await prisma.tourBooking.findUnique({ where: { id }, include: partnerName });
        if (!row) return null;

        return approvalView(row, {
            product: 'TOUR',
            entityType: 'TourBooking',
            title: `${row.tourSnapshot?.title ?? 'Tour'}${row.tourSnapshot?.option?.name ? ` · ${row.tourSnapshot.option.name}` : ''}`,
            when: { from: row.date, to: row.endDate, kind: 'DATES' },
            timezone: 'Asia/Tbilisi',
            leadName: row.leadTravellerName,
            leadEmail: row.leadTravellerEmail,
            totalCents: row.sellTotalCents,
            url: bookingManageUrl(row.reference, row.leadTravellerEmail),
            confirm: {
                topic: row.status === 'PENDING' ? TOPICS.TOUR_BOOKING_REQUESTED : TOPICS.TOUR_BOOKING_CONFIRMED,
                payload: { bookingId: row.id }
            }
        });
    },
    SERVICE: async (id) => {
        const row = await prisma.serviceBooking.findUnique({ where: { id }, include: partnerName });
        if (!row) return null;

        return approvalView(row, {
            product: 'SERVICE',
            entityType: 'ServiceBooking',
            title: row.serviceSnapshot?.name ?? 'Service',
            when: { from: row.date, to: row.endDate, kind: 'DATES' },
            timezone: 'Asia/Tbilisi',
            leadName: row.leadName,
            leadEmail: row.leadEmail,
            totalCents: row.sellTotalCents,
            url: bookingManageUrl(row.reference, row.leadEmail),
            confirm: {
                topic: row.status === 'PENDING' ? TOPICS.SERVICE_BOOKING_REQUESTED : TOPICS.SERVICE_BOOKING_CONFIRMED,
                payload: { bookingId: row.id }
            }
        });
    },
    ORDER: async (id) => {
        const row = await prisma.order.findUnique({ where: { id }, include: partnerName });
        if (!row) return null;

        return approvalView(row, {
            product: 'ORDER',
            entityType: 'Order',
            title: row.packageSnapshot?.name ?? (row.kind === 'CUSTOM' ? 'Your order' : 'Package'),
            when: { from: row.startDate, to: row.endDate, kind: 'DATES' },
            timezone: 'Asia/Tbilisi',
            leadName: row.leadName,
            leadEmail: row.leadEmail,
            totalCents: row.sellTotalCents,
            url: bookingManageUrl(row.reference, row.leadEmail),
            confirm:
                row.status === 'CONFIRMED'
                    ? { topic: TOPICS.ORDER_CONFIRMED, payload: { orderId: row.id } }
                    : row.status === 'PENDING_CONFIRMATION'
                      ? { topic: TOPICS.ORDER_REQUESTED, payload: { orderId: row.id } }
                      : null
        });
    }
};

const DEADLINE_NOTICE_KIND = { PAYMENT: 'DEADLINE_PAYMENT_UPCOMING', FREE_CANCELLATION: 'DEADLINE_CANCELLATION_UPCOMING', CONFIRMATION: 'DEADLINE_CONFIRMATION_UPCOMING' };
const DEADLINE_LABEL = { PAYMENT: 'Payment due', FREE_CANCELLATION: 'Free cancellation ends', CONFIRMATION: 'Answer due' };

const APPROVAL_KIND_LABELS = {
    REFUND: 'Refund',
    PAYABLE_OVERRIDE: 'Supplier amount override',
    PAYABLE_WAIVE: 'Supplier write-off',
    RECEIVABLE_DUE_DATE: 'Due date change',
    RECEIVABLE_WAIVE: 'Write-off'
};

// --- Finance lookups ------------------------------------------------------------

const SETTLEABLE = new Set(['OPEN', 'PARTIAL']);

const loadInstalmentForMail = (id) =>
    prisma.payableInstalment.findUnique({
        where: { id },
        include: {
            payable: {
                include: {
                    supplierPartner: { select: { id: true, name: true } },
                    hotelBooking: { select: { hotelSnapshot: true, hotel: { select: { name: true } } } },
                    tourBooking: { select: { tourSnapshot: true, tour: { select: { title: true } } } },
                    serviceBooking: { select: { serviceSnapshot: true, service: { select: { name: true } } } }
                }
            }
        }
    });

const instalmentOwed = (instalment) =>
    Boolean(instalment.dueAt) && SETTLEABLE.has(instalment.status) && SETTLEABLE.has(instalment.payable.status);

/** The property, tour or service the money is for — what a person calls the booking. */
const payableSubject = (payable) => {
    switch (payable.product) {
        case 'HOTEL':
            return payable.hotelBooking?.hotelSnapshot?.name ?? payable.hotelBooking?.hotel?.name ?? null;
        case 'TOUR':
            return payable.tourBooking?.tourSnapshot?.title ?? payable.tourBooking?.tour?.title ?? null;
        case 'SERVICE':
            return payable.serviceBooking?.serviceSnapshot?.name ?? payable.serviceBooking?.service?.name ?? null;
        default:
            return null;
    }
};

/** "30% deposit", "70% balance", or just "balance" when it is the whole amount. */
const instalmentLabel = (instalment, payable) => {
    const kind = instalment.kind === 'DEPOSIT' ? 'deposit' : 'balance';
    const share = payable.originalAmountCents > 0 ? Math.round((instalment.originalAmountCents * 100) / payable.originalAmountCents) : 100;

    return share < 100 ? `${share}% ${kind}` : kind;
};

/** What the reminder emails and notices read, for an instalment with its payable loaded. */
const instalmentMailData = (instalment, now = new Date()) => {
    const { payable } = instalment;
    const timezone = payable.timezone;
    const today = todayInTimezone(timezone, now);
    const dueDay = todayInTimezone(timezone, instalment.dueAt);
    const supplierName = payable.supplierPartner?.name ?? 'Platform';
    const subjectName = payableSubject(payable);

    return {
        payableId: payable.id,
        supplierName,
        subjectName,
        who: subjectName ?? supplierName,
        product: payable.product,
        bookingReference: payable.bookingReference,
        instalmentLabel: instalmentLabel(instalment, payable),
        sequence: instalment.sequence,
        amountCents: Math.max(0, instalment.amountCents - instalment.paidCents),
        currency: payable.currency,
        dueAt: instalment.dueAt,
        timezone,
        daysUntil: daysBetween(today, dueDay),
        daysOverdue: daysBetween(dueDay, today),
        url: adminPayableUrl(payable.id)
    };
};

/** A partner company's primary contact's address, when the company itself has none on file. */
const partnerContactEmail = async (partnerId) =>
    (
        await prisma.user.findFirst({
            where: { partnerId, isActive: true },
            orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }],
            select: { email: true }
        })
    )?.email ?? null;

// --- Standalone booking lookups ------------------------------------------------

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const loadHotelBookingForMail = (id) =>
    prisma.hotelBooking.findUnique({
        where: { id },
        include: { rooms: true, requests: true, hotel: { select: { name: true, email: true, supplierId: true } } }
    });

const loadTourBookingForMail = (id) =>
    prisma.tourBooking.findUnique({
        where: { id },
        include: { tour: { select: { title: true, supplierId: true } } }
    });

const loadServiceBookingForMail = (id) =>
    prisma.serviceBooking.findUnique({
        where: { id },
        include: { service: { select: { name: true, supplierId: true } } }
    });

/** What the guest's hotel emails read. Everything comes from the snapshot the voucher is built on. */
const hotelGuestData = (booking) => {
    const snapshot = booking.hotelSnapshot ?? {};

    return {
        reference: booking.reference,
        leadName: booking.leadGuestName,
        hotelName: snapshot.name ?? booking.hotel?.name ?? 'your hotel',
        address: snapshot.address ?? null,
        phone: snapshot.phone ?? null,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        nights: booking.nights,
        checkInFrom: snapshot.checkIn?.from ?? null,
        rooms: booking.rooms.map((room) => ({
            roomTypeName: room.roomTypeName,
            ratePlanName: room.ratePlanName,
            mealPlanName: room.mealPlanName,
            adults: room.adults,
            children: room.childAges?.length ?? 0
        })),
        currency: booking.currency,
        // What the guest owes: the room price plus the taxes folded into it.
        // `sellTotalCents` alone is the room price before the included tax, and
        // a voucher that quoted it would be short by the tax. Same sum as the
        // booking's own `totalCents` (serializers/booking.js).
        totalCents: booking.sellTotalCents + (booking.taxTotalCents ?? 0),
        payableAtPropertyCents: booking.payableAtPropertyCents ?? 0,
        cancellationSummary: booking.rooms[0]?.cancellationSummary ?? null,
        specialRequests: booking.specialRequests ?? null,
        url: bookingManageUrl(booking.reference, booking.leadGuestEmail)
    };
};

const tourGuestData = (booking) => {
    const snapshot = booking.tourSnapshot ?? {};

    return {
        reference: booking.reference,
        leadName: booking.leadTravellerName,
        tourTitle: snapshot.title ?? booking.tour?.title ?? 'your tour',
        optionName: snapshot.option?.name ?? null,
        date: booking.date,
        endDate: booking.endDate,
        durationDays: snapshot.durationDays ?? 1,
        meetingPoint: snapshot.meetingPointName ?? snapshot.meetingPoint ?? null,
        departureTime: snapshot.option?.departureTime ?? snapshot.meetingTime ?? null,
        travellers: booking.adults + (booking.childAges?.length ?? 0),
        currency: booking.currency,
        totalCents: booking.sellTotalCents,
        cancellationSummary: booking.cancellationSummary ?? null,
        requestDeadlineAt: booking.requestDeadlineAt ?? null,
        wasRequest: booking.confirmationMode === 'ON_REQUEST',
        url: bookingManageUrl(booking.reference, booking.leadTravellerEmail)
    };
};

const serviceGuestData = (booking) => {
    const snapshot = booking.serviceSnapshot ?? {};

    return {
        reference: booking.reference,
        leadName: booking.leadName,
        serviceName: snapshot.name ?? booking.service?.name ?? 'your booking',
        date: booking.date,
        endDate: booking.endDate,
        days: booking.days,
        quantity: booking.quantity,
        pax: booking.pax,
        currency: booking.currency,
        totalCents: booking.sellTotalCents,
        requestDeadlineAt: booking.requestDeadlineAt ?? null,
        wasRequest: booking.confirmationMode === 'ON_REQUEST',
        url: bookingManageUrl(booking.reference, booking.leadEmail)
    };
};

/**
 * The supplier's view of each product, shaped for the two shared templates.
 * `directEmail` is the property's own address when it has one; `supplierId`
 * is the partner company behind it, whose contact is the fallback.
 */
const supplierViews = {
    hotel: async (bookingId) => {
        const booking = await loadHotelBookingForMail(bookingId);
        if (!booking) return null;

        const snapshot = booking.hotelSnapshot ?? {};
        const adults = booking.rooms.reduce((sum, room) => sum + room.adults, 0);
        const children = booking.rooms.reduce((sum, room) => sum + (room.childAges?.length ?? 0), 0);
        const first = booking.rooms[0];
        const requests = booking.requests.map((request) => `${request.code}${request.note ? ` (${request.note})` : ''}`);

        return {
            supplierId: booking.hotel?.supplierId ?? null,
            neverAnnounced: Boolean(booking.approvalRequestedAt) && !booking.approvedAt,
            directEmail: snapshot.email ?? booking.hotel?.email ?? null,
            data: {
                product: 'hotel',
                reference: booking.reference,
                productName: snapshot.name ?? booking.hotel?.name ?? 'Hotel',
                guestName: booking.leadGuestName,
                guestEmail: booking.leadGuestEmail,
                guestPhone: booking.leadGuestPhone ?? null,
                from: booking.checkIn,
                to: booking.checkOut,
                party: [
                    `${count(booking.rooms.length, 'room')} · ${count(adults, 'adult')}${children > 0 ? `, ${count(children, 'child', 'children')}` : ''}`,
                    first ? `${first.roomTypeName} · ${first.ratePlanName} · ${first.mealPlanName}` : null
                ]
                    .filter(Boolean)
                    .join('\n'),
                currency: booking.currency,
                netCents: booking.netTotalCents,
                notes: [booking.specialRequests, ...requests].filter(Boolean).join('; ') || null,
                requested: booking.status === 'PENDING',
                reason: booking.cancellationReason ?? null
            }
        };
    },

    tour: async (bookingId) => {
        const booking = await loadTourBookingForMail(bookingId);
        if (!booking) return null;

        const snapshot = booking.tourSnapshot ?? {};
        const children = booking.childAges?.length ?? 0;

        return {
            supplierId: booking.tour?.supplierId ?? null,
            neverAnnounced: Boolean(booking.approvalRequestedAt) && !booking.approvedAt,
            directEmail: null,
            data: {
                product: 'tour',
                reference: booking.reference,
                productName: `${snapshot.title ?? booking.tour?.title ?? 'Tour'}${snapshot.option?.name ? ` · ${snapshot.option.name}` : ''}`,
                guestName: booking.leadTravellerName,
                guestEmail: booking.leadTravellerEmail,
                guestPhone: booking.leadTravellerPhone ?? null,
                from: booking.date,
                to: booking.endDate,
                party: `${count(booking.adults, 'adult')}${children > 0 ? `, ${count(children, 'child', 'children')}` : ''}${
                    snapshot.option?.departureTime ? ` · departs ${snapshot.option.departureTime}` : ''
                }`,
                currency: booking.currency,
                netCents: booking.netTotalCents,
                notes: [booking.specialRequests, booking.pickupNote ? `Pick-up: ${booking.pickupNote}` : null].filter(Boolean).join('; ') || null,
                requested: booking.status === 'PENDING',
                reason: booking.cancellationReason ?? null
            }
        };
    },

    service: async (bookingId) => {
        const booking = await loadServiceBookingForMail(bookingId);
        if (!booking) return null;

        const snapshot = booking.serviceSnapshot ?? {};

        return {
            supplierId: booking.service?.supplierId ?? null,
            neverAnnounced: Boolean(booking.approvalRequestedAt) && !booking.approvedAt,
            directEmail: null,
            data: {
                product: 'service',
                reference: booking.reference,
                productName: snapshot.name ?? booking.service?.name ?? 'Service',
                guestName: booking.leadName,
                guestEmail: booking.leadEmail,
                guestPhone: booking.leadPhone ?? null,
                from: booking.date,
                to: booking.endDate,
                party: `${count(booking.pax, 'person', 'people')}${booking.quantity > 1 ? ` · ${booking.quantity} units` : ''}${
                    booking.days > 1 ? ` · ${count(booking.days, 'day')}` : ''
                }`,
                currency: booking.currency,
                netCents: booking.netTotalCents,
                notes: booking.notes ?? null,
                requested: booking.status === 'PENDING',
                reason: booking.cancellationReason ?? null
            }
        };
    }
};

/**
 * Who on the supplier's side to write to.
 *
 * The property's own address first, then the partner company's, then its
 * primary contact's. A product with no supplier is run by the platform
 * itself, and its bookings go to operations — the same address the overdue
 * alerts use — so a new booking of a house tour is never a surprise. Null
 * means there is genuinely nobody configured, which is logged and dropped
 * rather than retried: a retry would not conjure an address.
 */
const supplierAddress = async ({ supplierId, directEmail }) => {
    const partner = supplierId
        ? await prisma.partner.findUnique({ where: { id: supplierId }, select: { name: true, email: true } })
        : null;

    if (directEmail) return { name: partner?.name ?? null, email: directEmail };
    if (partner?.email) return { name: partner.name, email: partner.email };

    if (supplierId) {
        const contact = await prisma.user.findFirst({
            where: { partnerId: supplierId, isActive: true },
            orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }],
            select: { email: true }
        });

        if (contact) return { name: partner?.name ?? null, email: contact.email };
    }

    if (config.transfer.dispatch.opsEmail) return { name: 'Operations', email: config.transfer.dispatch.opsEmail };

    logger.warn({ supplierId }, 'No supplier or operations address to notify about a booking');

    return null;
};

// --- The drain ------------------------------------------------------------------

/** How long a claimed batch is left alone by other drainers before it is retried. */
const LEASE_MS = 5 * 60_000;

/**
 * Claims what is due.
 *
 * The advisory lock is transaction-scoped, so it lives and dies on one
 * connection — a session lock taken on one pooled connection and released on
 * another is a lock nobody ever releases. The claim pushes `nextAttemptAt`
 * forward as a lease, so the events can be processed *outside* the
 * transaction (an email inside one would hold the connection for the length
 * of an SMTP conversation) without another instance picking them up.
 */
const claimDue = (limit) =>
    prisma.$transaction(async (tx) => {
        const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('outbox_drain')) AS locked`;

        if (!locked) {
            return null;
        }

        const events = await tx.outboxEvent.findMany({
            where: { processedAt: null, nextAttemptAt: { lte: new Date() } },
            orderBy: { createdAt: 'asc' },
            take: limit
        });

        if (events.length > 0) {
            await tx.outboxEvent.updateMany({
                where: { id: { in: events.map((event) => event.id) } },
                data: { nextAttemptAt: new Date(Date.now() + LEASE_MS) }
            });
        }

        return events;
    });

/** Processes one event; never throws. Returns whether it succeeded. */
export const processEvent = async (event) => {
    const handler = handlers[event.topic];

    try {
        if (handler) {
            await processing.run({ event }, () => handler(event.payload ?? {}));
        } else {
            logger.warn({ topic: event.topic }, 'No handler for outbox topic');
        }

        // A cleared error is how a delivered event is told apart from one
        // that gave up: both are processed, both may carry attempts.
        await prisma.outboxEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), lastError: null } });

        return true;
    } catch (err) {
        const attempts = event.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;

        logger.error({ err, topic: event.topic, eventId: event.id, attempts }, 'Outbox handler failed');

        await prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
                attempts,
                lastError: String(err?.message ?? err).slice(0, 1000),
                nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
                ...(giveUp ? { processedAt: new Date() } : {})
            }
        });

        return false;
    }
};

/**
 * Drains what is due. Safe to call from several instances at once: the
 * advisory lock means only one does the work.
 */
export const drainOutbox = async ({ limit = 50 } = {}) => {
    const events = await claimDue(limit);

    if (events === null) {
        return { skipped: true, processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;

    for (const event of events) {
        if (await processEvent(event)) processed += 1;
        else failed += 1;
    }

    return { processed, failed, remaining: events.length === limit };
};

// --- Dead letters ------------------------------------------------------------------

export { MAX_ATTEMPTS };

/** The events that exhausted their attempts: processed, but with the error still on them. */
const FAILED = { processedAt: { not: null }, attempts: { gte: MAX_ATTEMPTS }, lastError: { not: null } };

export const listFailedEvents = async ({ page = 1, pageSize = 25 } = {}) => {
    const [total, events] = await Promise.all([
        prisma.outboxEvent.count({ where: FAILED }),
        prisma.outboxEvent.findMany({ where: FAILED, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })
    ]);

    return { events, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

/**
 * Puts a failed event back in the queue for one more attempt.
 *
 * The attempt count is kept, not reset: the handler's in-app dedupe keys on
 * it to avoid telling someone twice, and a retry that fails again should
 * give up at once rather than start another eight-attempt climb. An event
 * that was delivered is refused — running it again would send the email
 * twice — and so is one that never failed.
 */
export const retryEvent = (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const event = await tx.outboxEvent.findUnique({ where: { id } });

        if (!event) {
            throw new NotFoundError('That outbox event does not exist');
        }

        if (event.attempts === 0 || (event.processedAt && !event.lastError)) {
            throw new ConflictError('That event has not failed', { reason: 'NOT_FAILED' });
        }

        const updated = await tx.outboxEvent.update({
            where: { id },
            data: { processedAt: null, nextAttemptAt: new Date() }
        });

        await recordAudit(tx, {
            action: 'OUTBOX_EVENT_RETRIED',
            actor,
            entityType: AUDIT_ENTITY.outboxEvent,
            entityId: id,
            summary: `Re-queued ${event.topic} after ${event.attempts} failed attempt${event.attempts === 1 ? '' : 's'}`,
            metadata: { topic: event.topic, attempts: event.attempts, lastError: event.lastError, entityType: event.entityType, entityId: event.entityId },
            req
        });

        return updated;
    });
