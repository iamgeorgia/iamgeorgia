import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The transactional outbox.
 *
 * A state change and the event describing it commit together, and a sweeper
 * turns the event into emails and in-app notifications afterwards. The
 * handler that writes the row never sends anything itself — which is what
 * keeps a dead mail server from turning a successful assignment into a 500,
 * and what lets a notification be retried without the assignment being made
 * twice.
 *
 * Topics are dotted and past-tense: `transfer.assignment.offered`.
 */
export const TOPICS = Object.freeze({
    ASSIGNMENT_OFFERED: 'transfer.assignment.offered',
    ASSIGNMENT_ACCEPTED: 'transfer.assignment.accepted',
    ASSIGNMENT_DECLINED: 'transfer.assignment.declined',
    ASSIGNMENT_REVOKED: 'transfer.assignment.revoked',
    LEG_STATUS_CHANGED: 'transfer.leg.status_changed',
    LEG_NO_SHOW_REPORTED: 'transfer.leg.no_show_reported',
    LEG_UNASSIGNED_ALERT: 'transfer.leg.unassigned_alert',
    BOOKING_CANCELLED: 'transfer.booking.cancelled',
    PICKUP_REMINDER: 'transfer.pickup.reminder',
    DRIVER_DETAILS: 'transfer.driver.details',
    RATING_RECEIVED: 'transfer.rating.received',
    RATING_INVITE: 'transfer.rating.invite',
    TOUR_REQUEST_OVERDUE: 'tour.booking.request_overdue',
    ORDER_CONFIRMED: 'order.confirmed',
    ORDER_REQUESTED: 'order.requested',
    ORDER_ITEM_DECLINED: 'order.item.declined',
    ORDER_CANCELLED: 'order.cancelled',
    ORDER_REQUEST_OVERDUE: 'order.request_overdue',
    PACKAGE_KOSHER_ELIGIBILITY_CHANGED: 'package.kosher.eligibility_changed',

    // The buyer's side of a standalone booking. Written by the facades only:
    // a booking made as part of an order is described by the order's own
    // emails, and a guest who bought one package should not get four
    // confirmations for it.
    HOTEL_BOOKING_CONFIRMED: 'hotel.booking.confirmed',
    HOTEL_BOOKING_CANCELLED: 'hotel.booking.cancelled',
    TOUR_BOOKING_CONFIRMED: 'tour.booking.confirmed',
    TOUR_BOOKING_REQUESTED: 'tour.booking.requested',
    TOUR_BOOKING_DECLINED: 'tour.booking.declined',
    TOUR_BOOKING_CANCELLED: 'tour.booking.cancelled',
    SERVICE_BOOKING_CONFIRMED: 'service.booking.confirmed',
    SERVICE_BOOKING_REQUESTED: 'service.booking.requested',
    SERVICE_BOOKING_DECLINED: 'service.booking.declined',
    SERVICE_BOOKING_CANCELLED: 'service.booking.cancelled',

    // The transfer voucher, when it follows an approval rather than the
    // booking request itself (the route sends it directly otherwise).
    TRANSFER_BOOKING_CONFIRMED: 'transfer.booking.confirmed',

    // Platform approval (OD1). `payload.product` is HOTEL, TRANSFER, TOUR,
    // SERVICE or ORDER and `bookingId` points into that table. Written by
    // the facades when a booking is made, and by the approval service and
    // its sweeper afterwards.
    // Every booking made and every one amended, for the desk's bell. Written
    // by the facades and the amend paths, whatever the product.
    BOOKING_CREATED: 'booking.created',
    BOOKING_MODIFIED: 'booking.modified',
    BOOKING_AWAITING_APPROVAL: 'booking.awaiting_approval',
    BOOKING_APPROVED: 'booking.approved',
    BOOKING_REJECTED: 'booking.rejected',
    BOOKING_APPROVAL_OVERDUE: 'booking.approval_overdue',
    // A deadline is N days away, per the reminder schedule (`sweepDeadlineReminders`).
    DEADLINE_UPCOMING: 'booking.deadline.upcoming',

    // The supplier's side. Written inside the `…InTx` functions, so the
    // property, operator or provider hears about every booking of theirs,
    // whether it was sold on its own or inside a package. `payload.product`
    // says which table `bookingId` points into.
    SUPPLIER_BOOKING_RECEIVED: 'supplier.booking.received',
    SUPPLIER_BOOKING_CANCELLED: 'supplier.booking.cancelled',

    // Finance. The first three are written by the reminder sweeper
    // (`services/finance/reminder.service.js`) on the clock; the last by
    // `recordPayment`, in the transaction that recorded the money.
    PAYABLE_INSTALMENT_DUE: 'finance.payable.instalment_due',
    PAYABLE_INSTALMENT_OVERDUE: 'finance.payable.instalment_overdue',
    RECEIVABLE_OVERDUE: 'finance.receivable.overdue',
    PAYMENT_RECORDED: 'finance.payment.recorded',

    // Approvals: a request opened for someone else to decide, and decided.
    APPROVAL_REQUESTED: 'finance.approval.requested',
    APPROVAL_DECIDED: 'finance.approval.decided',
    /** A WARN-mode partner booked past its credit limit; finance hears. */
    CREDIT_LIMIT_WARNING: 'finance.credit.warning',

    // Invoicing. The first three ask the drain to call the provider — issue,
    // email, cancel — and are written with the DRAFT row in the booking's own
    // transaction, so the vendor is never called inside it. The last two
    // are what the drain writes afterwards for the people to be told.
    INVOICE_ISSUE_REQUESTED: 'finance.invoice.issue_requested',
    INVOICE_SEND_REQUESTED: 'finance.invoice.send_requested',
    INVOICE_CANCEL_REQUESTED: 'finance.invoice.cancel_requested',
    INVOICE_ISSUED: 'finance.invoice.issued',
    INVOICE_SYNC_FAILED: 'finance.invoice.sync_failed'
});

/** Writes one event on the given client — a transaction handle, in practice. */
export const enqueueEvent = (client, { topic, payload = {}, entityType = null, entityId = null }) =>
    client.outboxEvent.create({
        data: { topic, payload, entityType, entityId }
    });

/**
 * The event an outbox handler is running for, reachable from anywhere beneath
 * it. The drain sets it; the in-app notices read it to avoid telling someone
 * twice on a retry, and the mailer reads it to avoid emailing them twice.
 */
export const outboxContext = new AsyncLocalStorage();

export const currentOutboxEvent = () => outboxContext.getStore()?.event ?? null;
