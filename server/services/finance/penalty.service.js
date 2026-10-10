import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';

/**
 * Cancellation penalties as rows finance works from.
 *
 * Every cancelled booking gets one, written by the ledger as it re-syncs
 * the receivable: the charge the policy calculated, frozen. What the buyer
 * is then owed for is `overrideCents ?? chargeCents`, and the override only
 * ever arrives through an approval request (`PENALTY_OVERRIDE`), so the
 * figure a second person agreed is the figure the ledger chases.
 */

const PRODUCT_FK = { HOTEL: 'hotelBookingId', TRANSFER: 'transferBookingId', TOUR: 'tourBookingId', SERVICE: 'serviceBookingId' };

/** The row for a cancelled booking, made on first sight and left alone after; idempotent by design. */
export const upsertPenaltyInTx = async (tx, product, booking) => {
    const existing = await tx.penaltyEntry.findUnique({ where: { bookingType_bookingId: { bookingType: product, bookingId: booking.id } } });

    if (existing) {
        return existing;
    }

    return tx.penaltyEntry.create({
        data: {
            bookingType: product,
            bookingId: booking.id,
            reference: booking.reference,
            partnerId: booking.partnerId ?? null,
            currency: booking.currency,
            chargeCents: Math.max(0, booking.cancellationChargeCents ?? 0)
        }
    });
};

export const findPenaltyOr404 = async (id, client = prisma) => {
    const penalty = await client.penaltyEntry.findUnique({ where: { id }, include: { partner: { select: { id: true, name: true, reference: true } } } });

    if (!penalty) {
        throw new NotFoundError('Penalty not found');
    }

    return penalty;
};

export const listPenalties = async ({ partnerId, product, currency, overridden, page, pageSize }) => {
    const where = {
        ...(partnerId ? { partnerId } : {}),
        ...(product ? { bookingType: product } : {}),
        ...(currency ? { currency } : {}),
        ...(overridden === true ? { overrideCents: { not: null } } : overridden === false ? { overrideCents: null } : {})
    };

    const [total, penalties] = await Promise.all([
        prisma.penaltyEntry.count({ where }),
        prisma.penaltyEntry.findMany({
            where,
            include: { partner: { select: { id: true, name: true, reference: true } } },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { penalties, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

/**
 * Sets what the buyer owes instead of the calculated charge (null hands
 * it back to the policy's figure), and re-syncs the receivable so the
 * ledger chases the new amount. Reached through an approval only; `via`
 * names the request.
 */
export const overridePenaltyInTx = async (tx, id, { overrideCents, reason }, actor, req, via = null, { syncReceivable }) => {
    const penalty = await findPenaltyOr404(id, tx);

    if (overrideCents !== null && overrideCents > penalty.chargeCents) {
        throw new UnprocessableEntityError('A penalty cannot be raised above what the policy charged', {
            reason: 'ABOVE_CHARGE',
            chargeCents: penalty.chargeCents
        });
    }

    const booking = await tx[{ HOTEL: 'hotelBooking', TRANSFER: 'transferBooking', TOUR: 'tourBooking', SERVICE: 'serviceBooking' }[penalty.bookingType]].findUnique({
        where: { id: penalty.bookingId },
        select: { status: true }
    });

    if (!booking || booking.status !== 'CANCELLED') {
        throw new ConflictError('Only a cancelled booking carries a penalty to change', { reason: 'NOT_CANCELLED' });
    }

    const updated = await tx.penaltyEntry.update({
        where: { id },
        data: {
            overrideCents,
            overrideReason: overrideCents === null ? null : reason,
            approvalId: via?.approvalId ?? null,
            createdByUserId: actor?.id ?? null
        }
    });

    await recordAudit(tx, {
        action: 'PENALTY_OVERRIDDEN',
        actor,
        entityType: AUDIT_ENTITY.penalty,
        entityId: id,
        summary:
            overrideCents === null
                ? `Handed the penalty on ${penalty.reference} back to the policy's figure`
                : `Set the penalty on ${penalty.reference} to ${(overrideCents / 100).toFixed(2)} ${penalty.currency} (charged ${(penalty.chargeCents / 100).toFixed(2)})`,
        metadata: {
            from: penalty.overrideCents ?? null,
            to: overrideCents,
            chargeCents: penalty.chargeCents,
            reason,
            ...(via ? { approvalId: via.approvalId, requestedByUserId: via.requestedByUserId } : {})
        },
        req
    });

    await syncReceivable(tx, penalty.bookingType, penalty.bookingId, actor, req);

    return updated;
};

export { PRODUCT_FK };
