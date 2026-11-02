import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { BadGatewayError, ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { toCents, toResponseCode } from '../../lib/integrations/flitt/status.js';
import { lockRows } from '../../lib/locks.js';
import { logger } from '../../lib/logger.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { pspRefundMachine } from '../../lib/payments/machines.js';
import { recordPaymentInTx } from '../finance/payment.service.js';
import { requestApproval } from '../finance/approval.service.js';
import { flittClient } from './psp-payment.service.js';

/**
 * Money back to the card, through the gateway (plan Phase 5).
 *
 * Three steps, three places:
 *   1. finance asks — `requestCardRefund` opens an ordinary REFUND approval
 *      whose payload names the card payment;
 *   2. a second person approves — the approval's execute path calls
 *      `openPspRefundInTx`, which writes a PspRefund (REQUESTED) and an outbox
 *      event in the approver's transaction, and nothing else: the gateway is
 *      never called inside a transaction;
 *   3. the drain calls the gateway — `executePspRefund` sends the reversal
 *      with the refund's own id as Flitt's idempotent `reverse_id`, so a retry
 *      after a dropped connection can never reverse twice, and only when the
 *      gateway says `approved` is the REFUND written to the ledger.
 */

const money = (cents, currency) => `${(cents / 100).toFixed(2)} ${currency}`;

const PENDING = ['REQUESTED', 'SUBMITTED', 'FAILED'];

/** What may still go back: charged, minus reversed, minus refunds in flight. */
export const refundableCentsOf = (payment, refunds = payment.refunds ?? []) => {
    if (!['APPROVED', 'REVERSED', 'MISMATCH'].includes(payment.status) || !payment.actualAmountCents) return 0;

    const inFlight = refunds.filter((r) => PENDING.includes(r.status)).reduce((sum, r) => sum + r.amountCents, 0);

    return Math.max(0, payment.actualAmountCents - payment.reversedCents - inFlight);
};

/** Finance asks for money back. Opens the approval; nothing moves yet. */
export const requestCardRefund = async (paymentId, { amountCents, reason, note }, actor, req) => {
    const payment = await prisma.pspPayment.findFirst({
        where: { OR: [{ id: paymentId }, { reference: paymentId }] },
        include: { refunds: true, receivable: { select: { id: true, debtorName: true, debtorEmail: true, debtorPartnerId: true, paidCents: true } } }
    });

    if (!payment) {
        throw new NotFoundError('Payment not found');
    }

    if (payment.status !== 'APPROVED') {
        throw new ConflictError('Only an approved card payment can be refunded', { reason: 'NOT_REFUNDABLE', status: payment.status });
    }

    const refundable = refundableCentsOf(payment);

    if (amountCents > refundable) {
        throw new UnprocessableEntityError('That is more than can go back to the card', { reason: 'REFUND_EXCEEDS_CHARGE', refundableCents: refundable });
    }

    // The ledger side of the refund, as the approval will record it: against
    // the receivable while it holds the money, unallocated beyond that.
    const allocated = Math.min(amountCents, payment.receivable?.paidCents ?? 0);
    const payload = {
        direction: 'OUT',
        kind: 'REFUND',
        method: 'CARD',
        currency: payment.currency,
        amountCents,
        reason,
        counterpartyName: payment.receivable?.debtorName ?? payment.debtorEmail,
        counterpartyEmail: payment.receivable?.debtorEmail ?? payment.debtorEmail,
        ...(payment.receivable?.debtorPartnerId ? { counterpartyPartnerId: payment.receivable.debtorPartnerId } : {}),
        allocations: allocated > 0 ? [{ receivableId: payment.receivableId, amountCents: allocated }] : [],
        pspPaymentId: payment.id,
        pspPaymentReference: payment.reference
    };

    return requestApproval({ kind: 'REFUND', subjectId: payment.receivableId, payload, note }, actor, req);
};

/**
 * The approval's execute step for a refund that goes through the gateway:
 * the PspRefund row and the event, in the approver's transaction. The
 * ledger entry waits for the gateway's word.
 */
export const openPspRefundInTx = async (tx, request, actor, req, via) => {
    const { pspPaymentId, amountCents, currency, reason } = request.payload;

    await lockRows(tx, 'psp_payments', [pspPaymentId]);
    const payment = await tx.pspPayment.findUnique({ where: { id: pspPaymentId }, include: { refunds: true } });

    if (!payment) {
        throw new NotFoundError('Payment not found');
    }

    if (amountCents > refundableCentsOf(payment)) {
        throw new UnprocessableEntityError('That is more than can go back to the card', { reason: 'REFUND_EXCEEDS_CHARGE', refundableCents: refundableCentsOf(payment) });
    }

    const refund = await tx.pspRefund.create({
        data: {
            paymentId: payment.id,
            status: 'REQUESTED',
            amountCents,
            currency,
            // Flitt's idempotent key: the row's own id, 25 characters, one per refund.
            reverseId: `${payment.mode === 'TEST' ? 'T' : 'L'}${Date.now().toString(36)}`.slice(0, 10) + '-' + Math.random().toString(36).slice(2, 10),
            approvalRequestId: request.id,
            reason,
            requestedByUserId: request.requestedByUserId ?? null
        }
    });

    // The refund's id is the better key; it is only known after the insert.
    const keyed = await tx.pspRefund.update({ where: { id: refund.id }, data: { reverseId: refund.id } });

    await recordAudit(tx, {
        action: 'PSP_REFUND_REQUESTED',
        actor,
        entityType: AUDIT_ENTITY.pspRefund,
        entityId: keyed.id,
        summary: `Refund of ${money(amountCents, currency)} to the card for ${payment.reference} approved; sending to the gateway`,
        metadata: { paymentId: payment.id, paymentReference: payment.reference, amountCents, currency, reverseId: keyed.reverseId, approvalId: via?.approvalId ?? request.id, requestedByUserId: request.requestedByUserId },
        req
    });

    await enqueueEvent(tx, { topic: TOPICS.PSP_REFUND_REQUESTED, payload: { refundId: keyed.id }, entityType: AUDIT_ENTITY.pspRefund, entityId: keyed.id });

    return { entityType: AUDIT_ENTITY.pspRefund, entityId: keyed.id };
};

const terminalDecline = (err) => err instanceof UnprocessableEntityError;

/**
 * The outbox's step: one reversal request to the gateway. A dropped
 * connection or a 5xx leaves the row FAILED with the error and throws, so
 * the drain retries with the same `reverse_id`; a refusal the gateway means
 * (1084 only full refund, 1086 already finished, 1069 turnover) is DECLINED
 * and finance hears; `approved` writes the ledger row.
 */
export const executePspRefund = async (refundId) => {
    const refund = await prisma.pspRefund.findUnique({ where: { id: refundId }, include: { payment: true } });

    if (!refund) {
        logger.warn({ refundId }, 'Refund event for a row that is gone');
        return { status: null };
    }

    if (!PENDING.includes(refund.status)) {
        return { status: refund.status, changed: false };
    }

    if (pspRefundMachine.can(refund.status, 'SUBMITTED', 'SYSTEM')) {
        await prisma.pspRefund.update({ where: { id: refund.id }, data: { status: 'SUBMITTED', submittedAt: refund.submittedAt ?? new Date(), attempts: { increment: 1 } } });
    }

    let answer;

    try {
        answer = await flittClient().reverse({
            orderId: refund.payment.merchantOrderId,
            amountCents: refund.amountCents,
            currency: refund.currency,
            reverseId: refund.reverseId,
            comment: refund.reason.slice(0, 1000)
        });
    } catch (err) {
        if (terminalDecline(err)) {
            return applyRefundResult(refund.id, { reverse_status: 'declined', response_code: err.details?.errorCode ?? null, response_description: err.details?.errorMessage ?? err.message });
        }

        await prisma.pspRefund.update({ where: { id: refund.id }, data: { status: 'FAILED', lastError: String(err?.message ?? err).slice(0, 500) } });
        throw err instanceof BadGatewayError ? err : new BadGatewayError('The gateway could not be reached for the refund', { vendor: 'flitt', cause: String(err?.message ?? err) });
    }

    return applyRefundResult(refund.id, answer);
};

/** The gateway's answer, under the payment's row lock, into the refund row and — on approval — the ledger. */
export const applyRefundResult = (refundId, doc) =>
    prisma.$transaction(async (tx) => {
        const refund = await tx.pspRefund.findUnique({ where: { id: refundId } });

        if (!refund) {
            throw new NotFoundError('Refund not found');
        }

        await lockRows(tx, 'psp_payments', [refund.paymentId]);
        const payment = await tx.pspPayment.findUnique({ where: { id: refund.paymentId }, include: { receivable: { select: { id: true, debtorName: true, debtorEmail: true, debtorPartnerId: true, paidCents: true } } } });
        const status = String(doc.reverse_status ?? '').toLowerCase();
        const now = new Date();

        if (['APPROVED', 'DECLINED'].includes(refund.status)) {
            return { status: refund.status, changed: false };
        }

        if (status === 'approved') {
            const allocated = Math.min(refund.amountCents, payment.receivable?.paidCents ?? 0);
            const record = await recordPaymentInTx(
                tx,
                {
                    direction: 'OUT',
                    kind: 'REFUND',
                    method: 'CARD',
                    currency: refund.currency,
                    amountCents: refund.amountCents,
                    reason: refund.reason,
                    counterpartyName: payment.receivable?.debtorName ?? payment.debtorEmail,
                    counterpartyEmail: payment.receivable?.debtorEmail ?? payment.debtorEmail,
                    ...(payment.receivable?.debtorPartnerId ? { counterpartyPartnerId: payment.receivable.debtorPartnerId } : {}),
                    paidAt: now,
                    note: `${payment.mode === 'TEST' ? 'TEST MODE. ' : ''}Card refund via Flitt, payment ${payment.reference}, refund ${refund.id}`,
                    externalPaymentId: doc.transaction_id !== undefined && doc.transaction_id !== null && doc.transaction_id !== '' ? String(doc.transaction_id) : null,
                    idempotencyKey: `flitt:refund:${refund.reverseId}`,
                    allocations: allocated > 0 ? [{ receivableId: payment.receivableId, amountCents: allocated }] : []
                },
                null,
                null,
                refund.approvalRequestId ? { approvalId: refund.approvalRequestId, requestedByUserId: refund.requestedByUserId } : null
            );

            const reversedCents = Math.min(payment.actualAmountCents ?? payment.amountCents, toCents(doc.reversal_amount) ?? payment.reversedCents + refund.amountCents);
            const fully = reversedCents >= (payment.actualAmountCents ?? payment.amountCents);

            await tx.pspRefund.update({
                where: { id: refund.id },
                data: { status: 'APPROVED', completedAt: now, paymentRecordId: record.id, providerTransactionId: doc.transaction_id ? String(doc.transaction_id) : null, responseCode: null, responseDescription: null, lastError: null }
            });
            await tx.pspPayment.update({ where: { id: payment.id }, data: { reversedCents, ...(fully ? { status: 'REVERSED' } : {}) } });

            await recordAudit(tx, {
                action: 'PSP_REFUND_APPROVED',
                actor: null,
                entityType: AUDIT_ENTITY.pspRefund,
                entityId: refund.id,
                summary: `Refund of ${money(refund.amountCents, refund.currency)} to the card for ${payment.reference} went through${fully ? ' (fully reversed)' : ''}`,
                metadata: { paymentId: payment.id, paymentRecordId: record.id, reversedCents, transactionId: doc.transaction_id ?? null },
                req: null
            });

            return { status: 'APPROVED', changed: true, paymentRecordId: record.id };
        }

        const responseCode = toResponseCode(doc.response_code);
        const responseDescription = doc.response_description ? String(doc.response_description).slice(0, 500) : null;

        await tx.pspRefund.update({ where: { id: refund.id }, data: { status: 'DECLINED', completedAt: now, responseCode, responseDescription } });
        await recordAudit(tx, {
            action: 'PSP_REFUND_FAILED',
            actor: null,
            entityType: AUDIT_ENTITY.pspRefund,
            entityId: refund.id,
            summary: `Refund of ${money(refund.amountCents, refund.currency)} for ${payment.reference} refused by the gateway${responseCode ? ` (${responseCode} ${responseDescription ?? ''})` : ''}`,
            metadata: { paymentId: payment.id, responseCode, responseDescription, reverseStatus: status },
            req: null
        });
        await enqueueEvent(tx, {
            topic: TOPICS.PSP_ALERT,
            payload: { kind: 'REFUND_FAILED', paymentId: payment.id, paymentReference: payment.reference, bookingReference: payment.bookingReference, refundId: refund.id, amountCents: refund.amountCents, responseCode, responseDescription },
            entityType: AUDIT_ENTITY.pspPayment,
            entityId: payment.id
        });

        return { status: 'DECLINED', changed: true };
    });
