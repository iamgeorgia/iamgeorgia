import { prisma } from '../../db/index.js';
import { AUDIT_ENTITY, recordAudit } from '../../lib/audit.js';
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { CAPABILITIES, can } from '../../lib/permissions.js';
import { actorOnBehalfOf } from '../../lib/booking/onBehalf.js';
import { confirmBooking, bookingInclude as hotelBookingInclude } from '../hotel/booking.service.js';
import { confirmTransferBooking, transferBookingInclude } from '../transfer/booking.service.js';
import { confirmTourBooking, tourBookingInclude } from '../tour/booking.service.js';
import { confirmServiceBooking, serviceBookingInclude } from '../service/booking.service.js';
import { confirmOrder, orderInclude } from '../order/order.service.js';
import { confirmCustomOrder } from '../order/cart.service.js';
import { createCustomerInTx, findCustomerOr404 } from './customer.service.js';
import { syncBookingIndexInTx } from './index.service.js';

/**
 * Bookings made at the desk: by phone, by email, through another agency, or
 * face to face. The same products, the same `confirm` facades, the same
 * ledger and the same approval step as a public booking — made as the buyer
 * through `actorOnBehalfOf`, with the desk's own fields carried alongside.
 */

const FACADES = {
    HOTEL: { confirm: confirmBooking, model: 'hotelBooking', include: hotelBookingInclude, entity: AUDIT_ENTITY.booking, result: 'booking' },
    TRANSFER: { confirm: confirmTransferBooking, model: 'transferBooking', include: transferBookingInclude, entity: AUDIT_ENTITY.transferBooking, result: 'booking' },
    TOUR: { confirm: confirmTourBooking, model: 'tourBooking', include: tourBookingInclude, entity: AUDIT_ENTITY.tourBooking, result: 'booking' },
    SERVICE: { confirm: confirmServiceBooking, model: 'serviceBooking', include: serviceBookingInclude, entity: AUDIT_ENTITY.serviceBooking, result: 'booking' },
    ORDER: { confirm: confirmOrder, model: 'order', include: orderInclude, entity: AUDIT_ENTITY.order, result: 'order' },
    /** The cart at the desk: several products for one buyer, one CUSTOM order. */
    CART: { confirm: confirmCustomOrder, model: 'order', include: orderInclude, entity: AUDIT_ENTITY.order, result: 'order' }
};

const productOf = (product) => {
    const spec = FACADES[product];

    if (!spec) {
        throw new NotFoundError('Unknown product');
    }

    return spec;
};

/** A member of staff, active, with no partner: the only kind of person who can look after a booking. */
const assertManager = async (userId) => {
    if (!userId) return;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, partnerId: true } });

    if (!user || !user.isActive || user.partnerId) {
        throw new UnprocessableEntityError('That person cannot be assigned a booking', { reason: 'NOT_STAFF', field: 'assignedManagerUserId' });
    }
};

/**
 * Makes the booking. Returns what the product's facade returns
 * (`{ booking | order, replayed }`), so the route serializes as it always has.
 */
export const createManualBooking = async (product, body, staff, req) => {
    const spec = productOf(product);
    const { buyer, channel, confirmNow, priceAdjustment, assignedManagerUserId, internalNotes, booking } = body;

    if (priceAdjustment && !can(staff, CAPABILITIES.BOOKINGS_PRICE_OVERRIDE)) {
        throw new ForbiddenError('Changing the price needs bookings.price.override', { reason: 'CAPABILITY_REQUIRED', fields: ['priceAdjustment'] });
    }

    if (confirmNow && !can(staff, CAPABILITIES.BOOKINGS_APPROVE)) {
        throw new ForbiddenError('Confirming at once needs bookings.approve', { reason: 'CAPABILITY_REQUIRED', fields: ['confirmNow'] });
    }

    await assertManager(assignedManagerUserId ?? null);

    // A new customer is written before the booking and outside its
    // transaction: a booking refused for price or availability still leaves
    // the customer the desk just typed in, to try again with.
    let customerId = null;

    if (buyer.kind === 'CUSTOMER') {
        customerId = buyer.customerId ? (await findCustomerOr404(buyer.customerId)).id : (await prisma.$transaction((tx) => createCustomerInTx(tx, buyer.customer, staff, req))).id;
    }

    const actor = await actorOnBehalfOf(staff, buyer);

    const input = {
        ...booking,
        manual: true,
        confirmNow: Boolean(confirmNow),
        channel,
        customerId,
        assignedManagerUserId: assignedManagerUserId ?? null,
        internalNotes: internalNotes ?? null,
        priceAdjustment: priceAdjustment ?? null
    };

    return spec.confirm(input, actor, req);
};

/** The desk's fields after the fact: who is looking after it, and the notes. */
export const updateDesk = (product, reference, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const spec = productOf(product);
        const row = await tx[spec.model].findFirst({ where: { OR: [{ id: reference }, { reference }] }, select: { id: true, reference: true, assignedManagerUserId: true, internalNotes: true } });

        if (!row) {
            throw new NotFoundError('Booking not found');
        }

        if (input.assignedManagerUserId !== undefined) {
            await assertManager(input.assignedManagerUserId);
        }

        const updated = await tx[spec.model].update({
            where: { id: row.id },
            data: {
                ...(input.assignedManagerUserId !== undefined ? { assignedManagerUserId: input.assignedManagerUserId } : {}),
                ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {})
            },
            include: spec.include
        });

        await syncBookingIndexInTx(tx, product, row.id);

        if (input.assignedManagerUserId !== undefined && input.assignedManagerUserId !== row.assignedManagerUserId) {
            await recordAudit(tx, {
                action: 'BOOKING_MANAGER_ASSIGNED',
                actor,
                entityType: spec.entity,
                entityId: row.id,
                summary: input.assignedManagerUserId ? `${row.reference} assigned to a manager` : `${row.reference} left unassigned`,
                metadata: { reference: row.reference, from: row.assignedManagerUserId, to: input.assignedManagerUserId },
                req
            });
        }

        if (input.internalNotes !== undefined && input.internalNotes !== row.internalNotes) {
            await recordAudit(tx, {
                action: 'BOOKING_NOTES_CHANGED',
                actor,
                entityType: spec.entity,
                entityId: row.id,
                summary: `Notes on ${row.reference} changed`,
                metadata: { reference: row.reference },
                req
            });
        }

        return updated;
    });
