import { z } from 'zod';

import { PAYMENT_STATUSES } from '../finance/paymentStatus.js';
import { BOOKING_SOURCES } from '../booking/source.js';
import { dateOnlyToUtc } from '../time.js';

/**
 * The filters every booking register shares, and the Prisma `where` they
 * become.
 *
 * One contract for the five product lists and the cross-product index, so
 * the client builds one filter bar. What differs per product — the date
 * column, the path to its destination — is passed in as a spec. Payment and
 * invoice filters reach through the `receivable` relation (a booking's own,
 * or its order's), which every booking table carries.
 */

const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'SENT', 'PAID', 'PARTIAL', 'CANCELLED', 'ERROR'];
const PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'CARD', 'OTHER'];

export const BOOKING_SORTS = Object.freeze(['created:desc', 'created:asc', 'date:asc', 'date:desc', 'due:asc', 'due:desc', 'total:desc', 'total:asc']);

const oneOrMany = (values) => z.union([z.enum(values), z.array(z.enum(values)).max(values.length)]).optional();
const dateOnlyField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idField = z.string().min(1).max(64);

/** Spread into a product's query schema beside its own fields. */
export const bookingFilterFields = {
    paymentStatus: oneOrMany(PAYMENT_STATUSES),
    invoiceStatus: oneOrMany(INVOICE_STATUSES),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    createdFrom: dateOnlyField.optional(),
    createdTo: dateOnlyField.optional(),
    customerId: idField.optional(),
    managerId: idField.optional(),
    destinationId: idField.optional(),
    source: oneOrMany(BOOKING_SOURCES),
    approval: z.enum(['PENDING', 'OVERDUE']).optional(),
    sort: z.enum(BOOKING_SORTS).optional()
};

const many = (value) => (Array.isArray(value) ? value : [value]);

/** The receivable statuses and clock that one payment status means. */
export const receivableWhereFor = (paymentStatus, now = new Date()) => {
    switch (paymentStatus) {
        case 'PAID':
        case 'WAIVED':
        case 'VOID':
            return { status: paymentStatus };
        case 'OVERDUE':
            return { status: { in: ['OPEN', 'PARTIAL'] }, dueAt: { lt: now } };
        case 'PARTIAL':
            return { status: 'PARTIAL', OR: [{ dueAt: null }, { dueAt: { gte: now } }] };
        case 'UNPAID':
            return { status: 'OPEN', OR: [{ dueAt: null }, { dueAt: { gte: now } }] };
        default:
            return null;
    }
};

/** A booking whose own receivable, or whose order's, matches. */
const throughReceivable = (receivableWhere) => ({
    OR: [{ receivable: { is: receivableWhere } }, { orderItem: { is: { order: { receivable: { is: receivableWhere } } } } }]
});

/** A booking that owes nothing yet: no receivable of its own and none on its order. */
const noReceivable = () => ({
    receivable: { is: null },
    OR: [{ orderItem: { is: null } }, { orderItem: { is: { order: { receivable: { is: null } } } } }]
});

const paymentStatusWhere = (statuses, now) => {
    const clauses = statuses.map((status) => (status === 'NONE' ? noReceivable() : throughReceivable(receivableWhereFor(status, now))));

    return clauses.length === 1 ? clauses[0] : { OR: clauses };
};

/**
 * The shared part of a product list's `where`.
 *
 * `spec.destination` is the relation path to the product's destination id
 * (for example `{ hotel: { destinationId } }`); `spec.order` is true for the
 * orders table, whose receivable is its own and which has no order item.
 */
export const bookingWhere = (query, { now = new Date(), destination = null, order = false } = {}) => {
    const { paymentStatus, invoiceStatus, paymentMethod, createdFrom, createdTo, customerId, managerId, destinationId, source, approval } = query;
    const own = (receivableWhere) => (order ? { receivable: { is: receivableWhere } } : throughReceivable(receivableWhere));
    const none = () => (order ? { receivable: { is: null } } : noReceivable());

    // Every clause goes under AND: several of them are OR-shaped, and a
    // product's own `search` is too, so spreading them into one object
    // would have the last OR silently replace the others.
    const clauses = [];

    if (paymentStatus) {
        const options = many(paymentStatus).map((status) => (status === 'NONE' ? none() : own(receivableWhereFor(status, now))));
        clauses.push(options.length === 1 ? options[0] : { OR: options });
    }
    if (invoiceStatus) clauses.push(own({ invoices: { some: { status: { in: many(invoiceStatus) } } } }));
    if (paymentMethod) clauses.push(own({ allocations: { some: { paymentRecord: { is: { method: paymentMethod } } } } }));
    if (createdFrom || createdTo) {
        clauses.push({
            createdAt: {
                ...(createdFrom ? { gte: dateOnlyToUtc(createdFrom) } : {}),
                ...(createdTo ? { lt: new Date(dateOnlyToUtc(createdTo).getTime() + 86_400_000) } : {})
            }
        });
    }
    if (customerId) clauses.push({ customerId });
    if (managerId) clauses.push({ assignedManagerUserId: managerId });
    if (destinationId && destination) clauses.push(destination(destinationId));
    if (source) clauses.push({ source: { in: many(source) } });
    if (approval === 'PENDING') clauses.push({ status: 'PENDING_APPROVAL' });
    if (approval === 'OVERDUE') clauses.push({ status: 'PENDING_APPROVAL', approvalDeadlineAt: { lt: now } });

    return clauses.length > 0 ? { AND: clauses } : {};
};

/**
 * The order of a list, from the shared `sort`, or the product's own default.
 * `dateField` is the product's service-date column; `total` its sell column.
 */
export const bookingOrderBy = (sort, { dateField, totalField = 'sellTotalCents', fallback }) => {
    switch (sort) {
        case 'created:desc':
            return [{ createdAt: 'desc' }];
        case 'created:asc':
            return [{ createdAt: 'asc' }];
        case 'date:asc':
            return [{ [dateField]: 'asc' }, { createdAt: 'desc' }];
        case 'date:desc':
            return [{ [dateField]: 'desc' }, { createdAt: 'desc' }];
        case 'due:asc':
            return [{ receivable: { dueAt: { sort: 'asc', nulls: 'last' } } }, { createdAt: 'desc' }];
        case 'due:desc':
            return [{ receivable: { dueAt: { sort: 'desc', nulls: 'last' } } }, { createdAt: 'desc' }];
        case 'total:desc':
            return [{ [totalField]: 'desc' }];
        case 'total:asc':
            return [{ [totalField]: 'asc' }];
        default:
            return fallback;
    }
};
