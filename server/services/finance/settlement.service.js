import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { syncPayableInTx } from './ledger.service.js';

/**
 * Reading payables, receivables and payments, and the three things Finance
 * may do to one by hand: set what a supplier is owed, waive what is left, and
 * move a buyer's due date. Each is audited with the reason given.
 */

const SETTLEABLE = ['OPEN', 'PARTIAL'];

const page = (total, { page: current, pageSize }) => ({
    total,
    page: current,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
});

const bookingRefs = {
    hotelBooking: { select: { id: true, reference: true, status: true } },
    transferBooking: { select: { id: true, reference: true, status: true } },
    tourBooking: { select: { id: true, reference: true, status: true } },
    serviceBooking: { select: { id: true, reference: true, status: true } }
};

const allocationsWithPayment = {
    include: {
        paymentRecord: {
            select: { id: true, direction: true, kind: true, method: true, reference: true, paidAt: true, currency: true, amountCents: true }
        }
    },
    orderBy: { createdAt: 'asc' }
};

export const payableInclude = {
    supplierPartner: { select: { id: true, name: true, reference: true } },
    instalments: { orderBy: { sequence: 'asc' }, include: { allocations: allocationsWithPayment } },
    ...bookingRefs
};

export const receivableInclude = {
    debtorPartner: { select: { id: true, name: true, reference: true } },
    allocations: allocationsWithPayment,
    order: { select: { id: true, reference: true, status: true } },
    ...bookingRefs
};

const PRODUCT_KEY = {
    HOTEL: 'hotelBookingId',
    TRANSFER: 'transferBookingId',
    TOUR: 'tourBookingId',
    SERVICE: 'serviceBookingId'
};

// --- Payables ---------------------------------------------------------------------

export const listPayables = async (query) => {
    const { status, supplierPartnerId, product, currency, dueBefore, needsReview, q } = query;
    const where = {
        ...(status ? { status: { in: status } } : {}),
        ...(supplierPartnerId === 'PLATFORM' ? { supplierPartnerId: null } : supplierPartnerId ? { supplierPartnerId } : {}),
        ...(product ? { product } : {}),
        ...(currency ? { currency } : {}),
        ...(dueBefore ? { nextDueAt: { lte: dueBefore } } : {}),
        ...(needsReview !== undefined ? { needsReview } : {}),
        ...(q ? { bookingReference: { contains: q, mode: 'insensitive' } } : {})
    };

    const [total, payables] = await Promise.all([
        prisma.supplierPayable.count({ where }),
        prisma.supplierPayable.findMany({
            where,
            include: payableInclude,
            orderBy: [{ nextDueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize
        })
    ]);

    return { payables, ...page(total, query) };
};

export const findPayableOr404 = async (id, client = prisma) => {
    const payable = await client.supplierPayable.findUnique({ where: { id }, include: payableInclude });

    if (!payable) {
        throw new NotFoundError('Payable not found');
    }

    return payable;
};

/**
 * Finance's own hand on a payable.
 *
 * `amountOverrideCents` sets what the supplier is owed, and every later sync
 * keeps it (null hands the figure back to the rules). `waive` writes off what
 * is left. Either clears the review flag: a person has looked.
 */
export const adjustPayable = (id, input, actor, req) => prisma.$transaction((tx) => adjustPayableInTx(tx, id, input, actor, req));

/**
 * The transaction's half, for an approval to run in its own: `via` names
 * the request it was asked through, and travels on every audit row so the
 * trail reads "approved by X, asked by Y".
 */
export const adjustPayableInTx = async (tx, id, { amountOverrideCents, waive, reason, notes }, actor, req, via = null) => {
    {
        const payable = await findPayableOr404(id, tx);
        const trail = via ? { approvalId: via.approvalId, requestedByUserId: via.requestedByUserId } : {};

        if (payable.status === 'WAIVED') {
            throw new ConflictError('This payable has been waived', { reason: 'WAIVED' });
        }

        if (notes !== undefined && (notes ?? null) !== (payable.notes ?? null)) {
            await tx.supplierPayable.update({ where: { id }, data: { notes } });

            await recordAudit(tx, {
                action: 'PAYABLE_NOTES_CHANGED',
                actor,
                entityType: AUDIT_ENTITY.supplierPayable,
                entityId: id,
                summary: `Changed the notes on the supplier payable for ${payable.bookingReference}`,
                metadata: { from: payable.notes ?? null, to: notes ?? null },
                req
            });
        }

        if (amountOverrideCents !== undefined) {
            if (amountOverrideCents !== null && amountOverrideCents > payable.originalAmountCents) {
                throw new UnprocessableEntityError('A supplier cannot be owed more than the booking was worth to them', {
                    reason: 'ABOVE_ORIGINAL',
                    originalAmountCents: payable.originalAmountCents
                });
            }

            await tx.supplierPayable.update({
                where: { id },
                data: {
                    amountOverrideCents,
                    overrideReason: amountOverrideCents === null ? null : reason,
                    needsReview: false,
                    reviewReason: null
                }
            });

            await syncPayableInTx(tx, payable.product, payable[PRODUCT_KEY[payable.product]], actor, req);

            await recordAudit(tx, {
                action: 'PAYABLE_AMOUNT_CHANGED',
                actor,
                entityType: AUDIT_ENTITY.supplierPayable,
                entityId: id,
                summary:
                    amountOverrideCents === null
                        ? `Handed ${payable.bookingReference} back to the supplier's terms`
                        : `Set the supplier payable for ${payable.bookingReference} to ${(amountOverrideCents / 100).toFixed(2)} ${payable.currency}`,
                metadata: { from: payable.amountCents, override: amountOverrideCents, reason, manual: true, ...trail },
                req
            });
        }

        if (waive) {
            const now = new Date();

            await tx.payableInstalment.updateMany({ where: { payableId: id, status: { in: SETTLEABLE } }, data: { status: 'WAIVED' } });
            await tx.supplierPayable.update({
                where: { id },
                data: { status: 'WAIVED', waivedAt: now, nextDueAt: null, needsReview: false, reviewReason: null }
            });

            await recordAudit(tx, {
                action: 'PAYABLE_WAIVED',
                actor,
                entityType: AUDIT_ENTITY.supplierPayable,
                entityId: id,
                summary: `Waived what was left on the supplier payable for ${payable.bookingReference}`,
                metadata: { outstandingCents: Math.max(0, payable.amountCents - payable.paidCents), reason, ...trail },
                req
            });
        }

        return findPayableOr404(id, tx);
    }
};

// --- Receivables ----------------------------------------------------------------

export const listReceivables = async (query) => {
    const { status, debtorPartnerId, currency, dueBefore, overdue, q } = query;
    const now = new Date();
    const where = {
        ...(status ? { status: { in: status } } : {}),
        ...(debtorPartnerId === 'GUEST' ? { debtorPartnerId: null } : debtorPartnerId ? { debtorPartnerId } : {}),
        ...(currency ? { currency } : {}),
        ...(overdue ? { status: { in: SETTLEABLE }, dueAt: { lt: now } } : dueBefore ? { dueAt: { lte: dueBefore } } : {}),
        ...(q
            ? {
                  OR: [
                      { reference: { contains: q, mode: 'insensitive' } },
                      { debtorName: { contains: q, mode: 'insensitive' } },
                      { debtorEmail: { contains: q, mode: 'insensitive' } }
                  ]
              }
            : {})
    };

    const [total, receivables] = await Promise.all([
        prisma.receivable.count({ where }),
        prisma.receivable.findMany({
            where,
            include: receivableInclude,
            orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize
        })
    ]);

    return { receivables, ...page(total, query) };
};

export const findReceivableOr404 = async (id, client = prisma) => {
    const receivable = await client.receivable.findUnique({ where: { id }, include: receivableInclude });

    if (!receivable) {
        throw new NotFoundError('Receivable not found');
    }

    return receivable;
};

/** Moves a due date (D5) or writes off what is left. */
export const adjustReceivable = (id, input, actor, req) => prisma.$transaction((tx) => adjustReceivableInTx(tx, id, input, actor, req));

/** The transaction's half; `via` as on `adjustPayableInTx`. */
export const adjustReceivableInTx = async (tx, id, { dueAt, waive, reason, notes }, actor, req, via = null) => {
    {
        const receivable = await findReceivableOr404(id, tx);
        const trail = via ? { approvalId: via.approvalId, requestedByUserId: via.requestedByUserId } : {};

        if (receivable.status === 'WAIVED') {
            throw new ConflictError('This receivable has been waived', { reason: 'WAIVED' });
        }

        if (notes !== undefined && (notes ?? null) !== (receivable.notes ?? null)) {
            await tx.receivable.update({ where: { id }, data: { notes } });

            await recordAudit(tx, {
                action: 'RECEIVABLE_NOTES_CHANGED',
                actor,
                entityType: AUDIT_ENTITY.receivable,
                entityId: id,
                summary: `Changed the notes on ${receivable.reference}`,
                metadata: { from: receivable.notes ?? null, to: notes ?? null },
                req
            });
        }

        if (dueAt !== undefined && String(dueAt) !== String(receivable.dueAt)) {
            await tx.receivable.update({
                where: { id },
                // A later date re-arms the overdue alert for the new deadline.
                data: { dueAt, ...(dueAt && (!receivable.dueAt || dueAt > receivable.dueAt) ? { overdueAlertAt: null } : {}) }
            });

            await recordAudit(tx, {
                action: 'RECEIVABLE_DUE_DATE_CHANGED',
                actor,
                entityType: AUDIT_ENTITY.receivable,
                entityId: id,
                summary: `Moved the due date of ${receivable.reference}`,
                metadata: { from: receivable.dueAt, to: dueAt, reason, ...trail },
                req
            });
        }

        if (waive) {
            await tx.receivable.update({ where: { id }, data: { status: 'WAIVED', waivedAt: new Date() } });

            await recordAudit(tx, {
                action: 'RECEIVABLE_WAIVED',
                actor,
                entityType: AUDIT_ENTITY.receivable,
                entityId: id,
                summary: `Waived what was left on ${receivable.reference}`,
                metadata: { outstandingCents: Math.max(0, receivable.amountCents - receivable.paidCents), reason, ...trail },
                req
            });
        }

        return findReceivableOr404(id, tx);
    }
};

// --- Payments ----------------------------------------------------------------------

export const listPayments = async (query, include) => {
    const { direction, kind, method, currency, counterpartyPartnerId, from, to, q } = query;
    const where = {
        ...(direction ? { direction } : {}),
        ...(kind ? { kind } : {}),
        ...(method ? { method } : {}),
        ...(currency ? { currency } : {}),
        ...(counterpartyPartnerId ? { counterpartyPartnerId } : {}),
        ...(from || to ? { paidAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(q
            ? {
                  OR: [
                      { reference: { contains: q, mode: 'insensitive' } },
                      { counterpartyName: { contains: q, mode: 'insensitive' } },
                      { counterpartyPartner: { name: { contains: q, mode: 'insensitive' } } }
                  ]
              }
            : {})
    };

    const [total, payments] = await Promise.all([
        prisma.paymentRecord.count({ where }),
        prisma.paymentRecord.findMany({
            where,
            include,
            orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize
        })
    ]);

    return { payments, ...page(total, query) };
};

export const findPaymentOr404 = async (id, include) => {
    const payment = await prisma.paymentRecord.findUnique({ where: { id }, include });

    if (!payment) {
        throw new NotFoundError('Payment not found');
    }

    return payment;
};
