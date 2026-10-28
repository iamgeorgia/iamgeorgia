import { prisma } from '../../db/index.js';
import { AUDIT_ENTITY, recordAudit } from '../../lib/audit.js';
import { NotFoundError } from '../../lib/errors.js';

/**
 * Desk customers: buyers with no partner account, reused across bookings.
 */

const changedFields = (before, after) => Object.keys(after).filter((key) => before[key] !== after[key]);

export const findCustomerOr404 = async (id, client = prisma) => {
    const customer = await client.customer.findUnique({ where: { id } });

    if (!customer) {
        throw new NotFoundError('Customer not found');
    }

    return customer;
};

export const listCustomers = async ({ q, kind, page = 1, pageSize = 25 } = {}) => {
    const where = {
        ...(kind ? { kind } : {}),
        ...(q
            ? {
                  OR: [
                      { name: { contains: q, mode: 'insensitive' } },
                      { contactName: { contains: q, mode: 'insensitive' } },
                      { email: { contains: q, mode: 'insensitive' } },
                      { phone: { contains: q, mode: 'insensitive' } }
                  ]
              }
            : {})
    };

    const [total, customers] = await Promise.all([
        prisma.customer.count({ where }),
        prisma.customer.findMany({ where, orderBy: [{ name: 'asc' }], skip: (page - 1) * pageSize, take: pageSize })
    ]);

    return { customers, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

export const createCustomerInTx = async (tx, input, actor, req) => {
    const customer = await tx.customer.create({ data: { ...input, createdByUserId: actor?.id ?? null } });

    await recordAudit(tx, {
        action: 'CUSTOMER_CREATED',
        actor,
        entityType: AUDIT_ENTITY.customer,
        entityId: customer.id,
        summary: `Customer ${customer.name} created`,
        metadata: { kind: customer.kind, email: customer.email },
        req
    });

    return customer;
};

export const createCustomer = (input, actor, req) => prisma.$transaction((tx) => createCustomerInTx(tx, input, actor, req));

export const updateCustomer = (id, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const before = await findCustomerOr404(id, tx);
        const customer = await tx.customer.update({ where: { id }, data: input });

        await recordAudit(tx, {
            action: 'CUSTOMER_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.customer,
            entityId: id,
            summary: `Customer ${customer.name} updated`,
            metadata: { fields: changedFields(before, input) },
            req
        });

        return customer;
    });

/** A customer's bookings across the products, newest first, for its page. */
export const customerBookings = async (id, { take = 50 } = {}) => {
    const [hotels, transfers, tours, services, orders] = await Promise.all([
        prisma.hotelBooking.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take, select: { reference: true, status: true, checkIn: true, currency: true, sellTotalCents: true, taxTotalCents: true, priceAdjustmentCents: true, createdAt: true, hotelSnapshot: true } }),
        prisma.transferBooking.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take, select: { reference: true, status: true, pickupAt: true, currency: true, sellTotalCents: true, priceAdjustmentCents: true, createdAt: true, routeSnapshot: true } }),
        prisma.tourBooking.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take, select: { reference: true, status: true, date: true, currency: true, sellTotalCents: true, priceAdjustmentCents: true, createdAt: true, tourSnapshot: true } }),
        prisma.serviceBooking.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take, select: { reference: true, status: true, date: true, currency: true, sellTotalCents: true, priceAdjustmentCents: true, createdAt: true, serviceSnapshot: true } }),
        prisma.order.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take, select: { reference: true, status: true, startDate: true, currency: true, sellTotalCents: true, createdAt: true, packageSnapshot: true } })
    ]);

    return [
        ...hotels.map((b) => ({ product: 'HOTEL', reference: b.reference, status: b.status, title: b.hotelSnapshot?.name ?? 'Hotel', date: b.checkIn, currency: b.currency, totalCents: b.sellTotalCents + (b.taxTotalCents ?? 0) + (b.priceAdjustmentCents ?? 0), createdAt: b.createdAt })),
        ...transfers.map((b) => ({ product: 'TRANSFER', reference: b.reference, status: b.status, title: `${b.routeSnapshot?.fromName ?? 'Transfer'} → ${b.routeSnapshot?.toName ?? ''}`.trim(), date: b.pickupAt, currency: b.currency, totalCents: b.sellTotalCents + (b.priceAdjustmentCents ?? 0), createdAt: b.createdAt })),
        ...tours.map((b) => ({ product: 'TOUR', reference: b.reference, status: b.status, title: b.tourSnapshot?.title ?? 'Tour', date: b.date, currency: b.currency, totalCents: b.sellTotalCents + (b.priceAdjustmentCents ?? 0), createdAt: b.createdAt })),
        ...services.map((b) => ({ product: 'SERVICE', reference: b.reference, status: b.status, title: b.serviceSnapshot?.name ?? 'Service', date: b.date, currency: b.currency, totalCents: b.sellTotalCents + (b.priceAdjustmentCents ?? 0), createdAt: b.createdAt })),
        ...orders.map((b) => ({ product: 'ORDER', reference: b.reference, status: b.status, title: b.packageSnapshot?.name ?? 'Order', date: b.startDate, currency: b.currency, totalCents: b.sellTotalCents, createdAt: b.createdAt }))
    ].sort((a, b) => b.createdAt - a.createdAt);
};

export const toCustomer = (customer) => ({
    id: customer.id,
    kind: customer.kind,
    name: customer.name,
    contactName: customer.contactName ?? null,
    email: customer.email,
    phone: customer.phone ?? null,
    billingAddress: customer.billingAddress ?? null,
    city: customer.city ?? null,
    country: customer.country ?? null,
    taxId: customer.taxId ?? null,
    notes: customer.notes ?? null,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt
});
