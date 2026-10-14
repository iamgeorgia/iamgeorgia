/**
 * Writes one row of the audit trail.
 *
 * The Prisma client is passed in rather than imported so a caller can hand over
 * a transaction handle: an approval and the record that it happened then commit
 * together, and there is no window in which a partner is approved with nothing
 * saying who did it.
 *
 * `actorEmail` is denormalized on purpose. The foreign key is SetNull, so
 * deleting an admin account nulls `actorUserId` — without the snapshot the
 * trail would forget who acted, which is the one thing it exists to remember.
 */
export const recordAudit = (client, { action, actor, entityType, entityId, summary, metadata = {}, req }) =>
    client.auditLog.create({
        data: {
            action,
            entityType,
            entityId,
            summary,
            metadata,
            actorUserId: actor?.id ?? null,
            actorEmail: actor?.email ?? 'system',
            ip: req?.ip ?? null
        }
    });

/** Entity type labels, so the strings stay consistent across call sites. */
export const AUDIT_ENTITY = {
    partner: 'Partner',
    invitation: 'Invitation',
    user: 'User',
    role: 'AccessRole',
    approval: 'ApprovalRequest',
    penalty: 'PenaltyEntry',
    destination: 'Destination',
    hotel: 'Hotel',
    roomType: 'RoomType',
    ratePlan: 'RatePlan',
    booking: 'HotelBooking',
    pricingRule: 'PricingRule',
    amenity: 'Amenity',
    kosherCertification: 'HotelKosherCertification',
    hotelDocument: 'HotelDocument',
    bookingRequest: 'HotelBookingRequest',
    fileAsset: 'FileAsset',
    transferPoint: 'TransferPoint',
    transferProvider: 'TransferProvider',
    transferVehicle: 'TransferVehicle',
    transferRoute: 'TransferRoute',
    transferExtra: 'TransferExtra',
    transferBlackout: 'TransferBlackout',
    transferBooking: 'TransferBooking',
    transferBookingLeg: 'TransferBookingLeg',
    transferFleetVehicle: 'TransferFleetVehicle',
    transferDriver: 'TransferDriver',
    transferAssignment: 'TransferAssignment',
    transferResourceBlock: 'TransferResourceBlock',
    transferRating: 'TransferDriverRating',
    tour: 'Tour',
    tourOption: 'TourOption',
    tourSeason: 'TourSeason',
    tourBooking: 'TourBooking',
    service: 'Service',
    serviceBooking: 'ServiceBooking',
    package: 'Package',
    order: 'Order',
    orderItem: 'OrderItem',
    supplierPaymentTerms: 'SupplierPaymentTerms',
    supplierPayable: 'SupplierPayable',
    payableInstalment: 'PayableInstalment',
    receivable: 'Receivable',
    paymentRecord: 'PaymentRecord',
    outboxEvent: 'OutboxEvent',
    invoice: 'Invoice',
    invoicingCustomer: 'InvoicingCustomer'
};
