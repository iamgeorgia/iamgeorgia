import { prisma } from '../../db/index.js';
import { namesFor, namedBlocks } from '../../lib/booking/names.js';
import { approvalOf } from '../../lib/booking/approval.js';
import { readsAllBookings } from '../../middleware/auth.js';
import { dateOnlyToUtc, toDateOnly } from '../../lib/time.js';
import { receivableWhereFor } from '../../lib/listing/bookingFilters.js';
import { syncDeadlinesInTx } from './deadline.service.js';

/**
 * The cross-product booking index (`booking_index`).
 *
 * A projection, never the truth: every service that changes a booking or
 * its money calls `syncBookingIndexInTx` in the same transaction, and a
 * nightly reconcile rebuilds whatever drifted. What it buys is one table to
 * list, filter and search every product together — the register of all
 * bookings, the approvals queue, the dashboard — with one trigram index
 * where `contains` on five tables could use none.
 */

const RECEIVABLE = { select: { id: true, status: true, dueAt: true, paidCents: true } };
const ORDER_LINK = { select: { order: { select: { id: true, reference: true, receivable: RECEIVABLE } } } };
const PARTNER = { select: { name: true } };
const CUSTOMER = { select: { name: true } };

const LOADERS = {
    HOTEL: (client, id) =>
        client.hotelBooking.findUnique({
            where: { id },
            include: { hotel: { select: { destinationId: true } }, partner: PARTNER, customer: CUSTOMER, receivable: RECEIVABLE, orderItem: ORDER_LINK }
        }),
    TRANSFER: (client, id) =>
        client.transferBooking.findUnique({
            where: { id },
            include: {
                legs: { orderBy: { legIndex: 'asc' }, take: 1, select: { fromPoint: { select: { destinationId: true } } } },
                partner: PARTNER,
                customer: CUSTOMER,
                receivable: RECEIVABLE,
                orderItem: ORDER_LINK
            }
        }),
    TOUR: (client, id) =>
        client.tourBooking.findUnique({
            where: { id },
            include: { tour: { select: { destinationId: true } }, partner: PARTNER, customer: CUSTOMER, receivable: RECEIVABLE, orderItem: ORDER_LINK }
        }),
    SERVICE: (client, id) =>
        client.serviceBooking.findUnique({
            where: { id },
            include: { service: { select: { destinationId: true } }, partner: PARTNER, customer: CUSTOMER, receivable: RECEIVABLE, orderItem: ORDER_LINK }
        }),
    ORDER: (client, id) =>
        client.order.findUnique({
            where: { id },
            include: { package: { select: { destinationId: true } }, partner: PARTNER, customer: CUSTOMER, receivable: RECEIVABLE }
        })
};

const MODEL = { HOTEL: 'hotelBooking', TRANSFER: 'transferBooking', TOUR: 'tourBooking', SERVICE: 'serviceBooking', ORDER: 'order' };

/** The bill a booking is paid through: its own, or its order's. */
const receivableOf = (row) => row.receivable ?? row.orderItem?.order?.receivable ?? null;

const SHAPES = {
    HOTEL: (row) => ({
        title: row.hotelSnapshot?.name ?? 'Hotel',
        leadName: row.leadGuestName,
        leadEmail: row.leadGuestEmail,
        destinationId: row.hotel?.destinationId ?? null,
        startDate: row.checkIn,
        endDate: row.checkOut,
        startAt: row.checkIn,
        totalCents: row.sellTotalCents + (row.taxTotalCents ?? 0) + (row.priceAdjustmentCents ?? 0)
    }),
    TRANSFER: (row) => ({
        title: `${row.routeSnapshot?.fromName ?? 'Transfer'} → ${row.routeSnapshot?.toName ?? ''}`.trim(),
        leadName: row.leadPassengerName,
        leadEmail: row.leadPassengerEmail,
        destinationId: row.legs?.[0]?.fromPoint?.destinationId ?? null,
        startDate: dateOnlyToUtc(toDateOnly(row.pickupAt)),
        endDate: dateOnlyToUtc(toDateOnly(row.returnPickupAt ?? row.pickupAt)),
        startAt: row.pickupAt,
        totalCents: row.sellTotalCents + (row.priceAdjustmentCents ?? 0)
    }),
    TOUR: (row) => ({
        title: `${row.tourSnapshot?.title ?? 'Tour'}${row.tourSnapshot?.option?.name ? ` · ${row.tourSnapshot.option.name}` : ''}`,
        leadName: row.leadTravellerName,
        leadEmail: row.leadTravellerEmail,
        destinationId: row.tour?.destinationId ?? null,
        startDate: row.date,
        endDate: row.endDate,
        startAt: row.startAt ?? row.date,
        totalCents: row.sellTotalCents + (row.priceAdjustmentCents ?? 0)
    }),
    SERVICE: (row) => ({
        title: row.serviceSnapshot?.name ?? 'Service',
        leadName: row.leadName,
        leadEmail: row.leadEmail,
        destinationId: row.service?.destinationId ?? null,
        startDate: row.date,
        endDate: row.endDate,
        startAt: row.startAt ?? row.date,
        totalCents: row.sellTotalCents + (row.priceAdjustmentCents ?? 0)
    }),
    ORDER: (row) => ({
        title: row.packageSnapshot?.name ?? (row.kind === 'CUSTOM' ? 'Custom order' : 'Package'),
        leadName: row.leadName,
        leadEmail: row.leadEmail,
        destinationId: row.package?.destinationId ?? null,
        startDate: row.startDate,
        endDate: row.endDate,
        startAt: row.startDate,
        totalCents: row.sellTotalCents
    })
};

const toIndexRow = (product, row) => {
    const shape = SHAPES[product](row);
    const receivable = receivableOf(row);
    const approval = approvalOf(row);

    return {
        product,
        bookingId: row.id,
        reference: row.reference,
        status: row.status,
        kind: product === 'ORDER' ? row.kind : null,
        partnerId: row.partnerId ?? null,
        customerId: row.customerId ?? null,
        assignedManagerUserId: row.assignedManagerUserId ?? null,
        orderId: row.orderItem?.order?.id ?? null,
        orderReference: row.orderItem?.order?.reference ?? null,
        leadName: shape.leadName,
        leadEmail: shape.leadEmail,
        title: shape.title,
        destinationId: shape.destinationId,
        startDate: shape.startDate,
        endDate: shape.endDate,
        startAt: shape.startAt,
        currency: row.currency,
        totalCents: shape.totalCents,
        receivableId: receivable?.id ?? null,
        receivableStatus: receivable?.status ?? null,
        dueAt: receivable?.dueAt ?? null,
        paidCents: receivable?.paidCents ?? 0,
        approvalState: approval?.state ?? null,
        approvalDeadlineAt: row.approvalDeadlineAt ?? null,
        source: row.source,
        search: [row.reference, shape.leadName, shape.leadEmail, shape.title, row.partner?.name, row.customer?.name, row.orderItem?.order?.reference]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
        createdAt: row.createdAt,
        confirmedAt: row.confirmedAt ?? null,
        cancelledAt: row.cancelledAt ?? null
    };
};

/** Brings one booking's index row into line, or removes it when the booking is gone. */
export const syncBookingIndexInTx = async (tx, product, bookingId) => {
    const row = await LOADERS[product](tx, bookingId);

    if (!row) {
        await tx.bookingIndex.deleteMany({ where: { product, bookingId } });

        return null;
    }

    const data = toIndexRow(product, row);
    const upserted = await tx.bookingIndex.upsert({ where: { product_bookingId: { product, bookingId } }, create: data, update: data });

    // The deadlines are a projection of the same columns: kept in the same breath.
    await syncDeadlinesInTx(tx, product, bookingId);

    return upserted;
};

/** The index row(s) a receivable's money is shown on: its own subject, plus an order's children. */
export const syncIndexForReceivableInTx = async (tx, receivableId) => {
    const receivable = await tx.receivable.findUnique({
        where: { id: receivableId },
        select: { hotelBookingId: true, transferBookingId: true, tourBookingId: true, serviceBookingId: true, orderId: true }
    });

    if (!receivable) return;

    if (receivable.hotelBookingId) await syncBookingIndexInTx(tx, 'HOTEL', receivable.hotelBookingId);
    if (receivable.transferBookingId) await syncBookingIndexInTx(tx, 'TRANSFER', receivable.transferBookingId);
    if (receivable.tourBookingId) await syncBookingIndexInTx(tx, 'TOUR', receivable.tourBookingId);
    if (receivable.serviceBookingId) await syncBookingIndexInTx(tx, 'SERVICE', receivable.serviceBookingId);

    if (receivable.orderId) {
        await syncBookingIndexInTx(tx, 'ORDER', receivable.orderId);

        const items = await tx.orderItem.findMany({
            where: { orderId: receivable.orderId },
            select: { hotelBookingId: true, transferBookingId: true, tourBookingId: true, serviceBookingId: true }
        });

        for (const item of items) {
            if (item.hotelBookingId) await syncBookingIndexInTx(tx, 'HOTEL', item.hotelBookingId);
            if (item.transferBookingId) await syncBookingIndexInTx(tx, 'TRANSFER', item.transferBookingId);
            if (item.tourBookingId) await syncBookingIndexInTx(tx, 'TOUR', item.tourBookingId);
            if (item.serviceBookingId) await syncBookingIndexInTx(tx, 'SERVICE', item.serviceBookingId);
        }
    }
};

/**
 * Rebuilds rows that have moved since they were indexed, or every row
 * (`since: null`). Each product table is walked in pages; a booking whose
 * table row is newer than its index row, or has no index row, is re-synced.
 */
const TABLE = { HOTEL: 'hotel_bookings', TRANSFER: 'transfer_bookings', TOUR: 'tour_bookings', SERVICE: 'service_bookings', ORDER: 'orders' };

/** Rows whose booking is gone (the projections carry no foreign key, so a deleted booking leaves them behind). */
const dropOrphans = async (product) => {
    const table = TABLE[product];
    const index = await prisma.$executeRawUnsafe(`DELETE FROM "booking_index" i WHERE i."product" = $1 AND NOT EXISTS (SELECT 1 FROM "${table}" b WHERE b."id" = i."booking_id")`, product);
    const deadlines = await prisma.$executeRawUnsafe(`DELETE FROM "booking_deadlines" d WHERE d."product" = $1 AND NOT EXISTS (SELECT 1 FROM "${table}" b WHERE b."id" = d."booking_id")`, product);

    return index + deadlines;
};

export const reconcileBookingIndex = async ({ since = new Date(Date.now() - 36 * 60 * 60 * 1000), pageSize = 200, force = false } = {}) => {
    const counts = {};

    for (const product of Object.keys(MODEL)) {
        await dropOrphans(product);

        let cursor = null;
        let synced = 0;

        for (;;) {
            const rows = await prisma[MODEL[product]].findMany({
                where: { ...(since ? { updatedAt: { gte: since } } : {}) },
                select: { id: true, updatedAt: true },
                orderBy: { id: 'asc' },
                take: pageSize,
                ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
            });

            if (rows.length === 0) break;

            const indexed = await prisma.bookingIndex.findMany({
                where: { product, bookingId: { in: rows.map((row) => row.id) } },
                select: { bookingId: true, updatedAt: true }
            });
            const stamp = new Map(indexed.map((row) => [row.bookingId, row.updatedAt]));

            for (const row of rows) {
                const have = stamp.get(row.id);

                if (force || !have || have < row.updatedAt) {
                    await prisma.$transaction((tx) => syncBookingIndexInTx(tx, product, row.id));
                    synced += 1;
                }
            }

            cursor = rows[rows.length - 1].id;
        }

        counts[product] = synced;
    }

    return counts;
};

// --- reading -----------------------------------------------------------------

const many = (value) => (Array.isArray(value) ? value : [value]);

const paymentClause = (status, now) => {
    if (status === 'NONE') return { receivableStatus: null };

    const where = receivableWhereFor(status, now);

    return {
        receivableStatus: typeof where.status === 'string' ? where.status : where.status,
        ...(where.dueAt ? { dueAt: where.dueAt } : {}),
        ...(where.OR ? { OR: where.OR } : {})
    };
};

const INDEX_SORTS = {
    'created:desc': [{ createdAt: 'desc' }],
    'created:asc': [{ createdAt: 'asc' }],
    'date:asc': [{ startAt: 'asc' }, { createdAt: 'desc' }],
    'date:desc': [{ startAt: 'desc' }, { createdAt: 'desc' }],
    'due:asc': [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    'due:desc': [{ dueAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    'total:desc': [{ totalCents: 'desc' }],
    'total:asc': [{ totalCents: 'asc' }]
};

/**
 * Every booking of every product, for the register that cuts across them.
 * A partner's view is scoped in the query; an order's children are listed
 * beside their order (filter `product` to see one kind).
 */
export const listBookingIndex = async (query, viewer, { now = new Date() } = {}) => {
    const { product, status, paymentStatus, partnerId, customerId, managerId, destinationId, source, approval, from, to, createdFrom, createdTo, search, sort, page, pageSize, children } = query;

    const where = {
        ...(readsAllBookings(viewer) ? { ...(partnerId ? { partnerId } : {}) } : { partnerId: viewer?.partnerId ?? '__none__' }),
        ...(product ? { product: { in: many(product) } } : {}),
        ...(status ? { status: { in: many(status) } } : {}),
        ...(paymentStatus ? { AND: [{ OR: many(paymentStatus).map((entry) => paymentClause(entry, now)) }] } : {}),
        ...(customerId ? { customerId } : {}),
        ...(managerId ? { assignedManagerUserId: managerId } : {}),
        ...(destinationId ? { destinationId } : {}),
        ...(source ? { source: { in: many(source) } } : {}),
        ...(approval === 'PENDING' ? { status: 'PENDING_APPROVAL' } : {}),
        ...(approval === 'OVERDUE' ? { status: 'PENDING_APPROVAL', approvalDeadlineAt: { lt: now } } : {}),
        ...(from || to ? { startDate: { ...(from ? { gte: dateOnlyToUtc(from) } : {}), ...(to ? { lte: dateOnlyToUtc(to) } : {}) } } : {}),
        ...(createdFrom || createdTo
            ? { createdAt: { ...(createdFrom ? { gte: dateOnlyToUtc(createdFrom) } : {}), ...(createdTo ? { lt: new Date(dateOnlyToUtc(createdTo).getTime() + 86_400_000) } : {}) } }
            : {}),
        // Children of an order are listed under their order unless asked for.
        ...(children ? {} : { orderId: null }),
        ...(search ? { search: { contains: search.trim().toLowerCase() } } : {})
    };

    const [total, rows] = await Promise.all([
        prisma.bookingIndex.count({ where }),
        prisma.bookingIndex.findMany({ where, orderBy: INDEX_SORTS[sort] ?? INDEX_SORTS['created:desc'], skip: (page - 1) * pageSize, take: pageSize })
    ]);

    return { rows, names: await namesFor(rows), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};


const ADMIN_PATH = {
    HOTEL: (reference) => `/admin/bookings/${reference}`,
    TRANSFER: (reference) => `/admin/transfers/bookings/${reference}`,
    TOUR: (reference) => `/admin/tours/bookings/${reference}`,
    SERVICE: (reference) => `/admin/services/bookings/${reference}`,
    ORDER: (reference) => `/admin/orders/${reference}`
};

export const toIndexEntry = (row, { now = new Date(), names = null, scope = 'admin' } = {}) => ({
    product: row.product,
    id: row.bookingId,
    reference: row.reference,
    status: row.status,
    kind: row.kind,
    title: row.title,
    leadName: row.leadName,
    leadEmail: row.leadEmail,
    partnerId: row.partnerId,
    customerId: row.customerId,
    assignedManagerUserId: row.assignedManagerUserId,
    ...namedBlocks(row, names),
    order: row.orderId ? { id: row.orderId, reference: row.orderReference } : null,
    destinationId: row.destinationId,
    startDate: toDateOnly(row.startDate),
    endDate: toDateOnly(row.endDate),
    startAt: row.startAt,
    currency: row.currency,
    totalCents: row.totalCents,
    payment: {
        status: !row.receivableStatus
            ? 'NONE'
            : row.receivableStatus === 'PAID' || row.receivableStatus === 'WAIVED' || row.receivableStatus === 'VOID'
              ? row.receivableStatus
              : row.dueAt && row.dueAt < now
                ? 'OVERDUE'
                : row.receivableStatus === 'PARTIAL'
                  ? 'PARTIAL'
                  : 'UNPAID',
        receivableId: row.receivableId,
        dueAt: row.dueAt,
        paidCents: row.paidCents
    },
    approval: row.approvalState ? { state: row.approvalState, deadlineAt: row.approvalDeadlineAt, overdue: row.approvalState === 'PENDING' && Boolean(row.approvalDeadlineAt) && row.approvalDeadlineAt < now } : null,
    source: row.source,
    href: scope === 'partner' ? `/portal/bookings/${row.reference}` : ADMIN_PATH[row.product](row.reference),
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    cancelledAt: row.cancelledAt
});
