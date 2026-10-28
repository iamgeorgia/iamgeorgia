/**
 * A notice as a bell shows it, with the path it leads to.
 *
 * The path is decided here, from the entity and the panel the reader is in,
 * rather than stored on the row: a receivable is a detail page to Finance
 * and the statement to the agency that owes it. The client keeps a fallback
 * of the same table for rows served before this existed.
 */

const ADMIN_BOOKING_PATH = {
    HotelBooking: (reference) => `/admin/bookings/${reference}`,
    TransferBooking: (reference) => `/admin/transfers/bookings/${reference}`,
    TransferBookingLeg: (reference) => `/admin/transfers/bookings/${reference}`,
    TransferAssignment: (reference) => `/admin/transfers/bookings/${reference}`,
    TourBooking: (reference) => `/admin/tours/bookings/${reference}`,
    ServiceBooking: () => null,
    Order: (reference) => `/admin/orders/${reference}`
};

const adminHref = ({ entityType, entityId, payload }) => {
    const reference = payload.bookingReference ?? payload.orderReference ?? payload.reference ?? null;

    switch (entityType) {
        case 'SupplierPayable':
            return entityId ? `/admin/finance/payables/${entityId}` : null;
        case 'Receivable':
            return entityId ? `/admin/finance/receivables/${entityId}` : null;
        case 'PaymentRecord':
            return entityId ? `/admin/finance/payments/${entityId}` : null;
        case 'Invoice':
            return entityId ? `/admin/finance/invoices/${entityId}` : null;
        case 'ApprovalRequest':
            return entityId ? `/admin/finance/approvals/${entityId}` : null;
        case 'Partner':
            return entityId ? `/admin/partners/${entityId}` : null;
        case 'HotelBooking':
        case 'TransferBooking':
        case 'TransferBookingLeg':
        case 'TransferAssignment':
        case 'TourBooking':
        case 'ServiceBooking':
        case 'Order':
            return reference ? ADMIN_BOOKING_PATH[entityType](reference) : null;
        default:
            return null;
    }
};

const partnerHref = ({ entityType, payload }) => {
    if (entityType === 'Receivable' || entityType === 'PaymentRecord' || entityType === 'Invoice') return '/portal/finance';
    if (payload.bookingReference) return `/portal/bookings/${payload.bookingReference}`;
    if (payload.orderReference) return `/portal/bookings/${payload.orderReference}`;
    return null;
};

const driverHref = ({ payload }) => (payload.assignmentId ? `/driver/assignments/${payload.assignmentId}` : null);

const HREF = { admin: adminHref, partner: partnerHref, driver: driverHref };

/** Where a notice leads in the given panel, or null when it is only news. */
export const notificationHref = (scope, notification) => {
    const resolve = HREF[scope];
    const payload = notification.payload ?? {};

    return resolve ? resolve({ entityType: notification.entityType ?? null, entityId: notification.entityId ?? null, payload }) : null;
};

export const toNotification = (notification, scope = 'admin') => ({
    id: notification.id,
    kind: notification.kind,
    category: notification.category ?? 'SYSTEM',
    title: notification.title,
    body: notification.body,
    payload: notification.payload ?? {},
    entityType: notification.entityType ?? null,
    entityId: notification.entityId ?? null,
    href: notificationHref(scope, notification),
    readAt: notification.readAt,
    createdAt: notification.createdAt
});
