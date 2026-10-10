import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { lockKey } from '../../lib/locks.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';

/**
 * A partner's credit limit: how much it may owe, open, in one currency.
 *
 * Checked in the transaction that confirms a booking, under a lock on the
 * partner, before anything is claimed — so two bookings confirmed at the
 * same moment take turns, each sees the receivable the other committed, and
 * a refused booking leaves no room held. Null is no limit; a limit counts
 * only its own currency's open receivables, and nothing is summed across
 * exchange rates.
 */

/** What the partner owes now, open, in that currency. */
const outstandingCents = async (tx, partnerId, currency) => {
    const [row] = await tx.$queryRaw`
        SELECT COALESCE(SUM("amount_cents" - "paid_cents"), 0)::int AS outstanding
          FROM "receivables"
         WHERE "debtor_partner_id" = ${partnerId} AND "currency" = ${currency} AND "status" IN ('OPEN', 'PARTIAL')`;

    return row?.outstanding ?? 0;
};

/**
 * Refuses, or warns about, a booking that would take the partner past its
 * limit. Returns `{ warning }` for a WARN partner that is now over, null
 * otherwise. Takes the lock either way so the sum it reads is the truth.
 */
export const assertCreditInTx = async (tx, partnerId, { addCents, currency }, actor = null, req = null) => {
    if (!partnerId) return null;

    const partner = await tx.partner.findUnique({
        where: { id: partnerId },
        select: { id: true, name: true, creditLimitCents: true, creditLimitCurrency: true, creditLimitMode: true }
    });

    if (!partner || partner.creditLimitCents === null || partner.creditLimitCurrency !== currency) {
        return null;
    }

    await lockKey(tx, `partner_credit:${partnerId}`);

    const outstanding = await outstandingCents(tx, partnerId, currency);
    const after = outstanding + addCents;

    if (after <= partner.creditLimitCents) {
        return null;
    }

    const details = {
        reason: 'CREDIT_LIMIT_EXCEEDED',
        limitCents: partner.creditLimitCents,
        outstandingCents: outstanding,
        requestedCents: addCents,
        currency
    };

    if (partner.creditLimitMode === 'BLOCK') {
        throw new UnprocessableEntityError('This booking would take the company past its credit limit', details);
    }

    await recordAudit(tx, {
        action: 'PARTNER_CREDIT_WARNING',
        actor,
        entityType: AUDIT_ENTITY.partner,
        entityId: partnerId,
        summary: `${partner.name} booked past its credit limit`,
        metadata: details,
        req
    });

    await enqueueEvent(tx, { topic: TOPICS.CREDIT_LIMIT_WARNING, payload: { partnerId, ...details }, entityType: AUDIT_ENTITY.partner, entityId: partnerId });

    return { warning: details };
};

/** The limit, what is open against it, and what is left, for the partner and the desk. */
export const creditPosition = async (partnerId) => {
    const partner = await prisma.partner.findUnique({
        where: { id: partnerId },
        select: { id: true, creditLimitCents: true, creditLimitCurrency: true, creditLimitMode: true }
    });

    if (!partner) {
        throw new NotFoundError('Partner not found');
    }

    if (partner.creditLimitCents === null) {
        return { limitCents: null, currency: null, mode: partner.creditLimitMode, outstandingCents: null, availableCents: null };
    }

    const outstanding = await outstandingCents(prisma, partnerId, partner.creditLimitCurrency);

    return {
        limitCents: partner.creditLimitCents,
        currency: partner.creditLimitCurrency,
        mode: partner.creditLimitMode,
        outstandingCents: outstanding,
        availableCents: Math.max(0, partner.creditLimitCents - outstanding)
    };
};

export const setCreditLimit = (partnerId, { creditLimitCents, creditLimitCurrency, creditLimitMode }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const partner = await tx.partner.findUnique({
            where: { id: partnerId },
            select: { id: true, name: true, creditLimitCents: true, creditLimitCurrency: true, creditLimitMode: true }
        });

        if (!partner) {
            throw new NotFoundError('Partner not found');
        }

        const data = {
            creditLimitCents: creditLimitCents ?? null,
            creditLimitCurrency: creditLimitCents == null ? null : creditLimitCurrency,
            creditLimitMode: creditLimitMode ?? partner.creditLimitMode
        };

        const changes = Object.fromEntries(
            Object.entries(data)
                .filter(([key, value]) => (partner[key] ?? null) !== (value ?? null))
                .map(([key, value]) => [key, { from: partner[key] ?? null, to: value ?? null }])
        );

        if (Object.keys(changes).length === 0) {
            return partner;
        }

        const updated = await tx.partner.update({ where: { id: partnerId }, data });

        await recordAudit(tx, {
            action: 'PARTNER_CREDIT_LIMIT_CHANGED',
            actor,
            entityType: AUDIT_ENTITY.partner,
            entityId: partnerId,
            summary: `Changed the credit limit of ${partner.name}`,
            metadata: { changes },
            req
        });

        return updated;
    });
