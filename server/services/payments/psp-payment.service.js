import { randomBytes } from 'node:crypto';

import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { BadGatewayError, ConflictError, GoneError, NotFoundError, ServiceUnavailableError, UnprocessableEntityError } from '../../lib/errors.js';
import { createFlittClient } from '../../lib/integrations/flitt/client.js';
import { parseAdditionalInfo } from '../../lib/integrations/flitt/parse.js';
import { isFinal, isOpen, mapOrderStatus, rank, toCents, toResponseCode } from '../../lib/integrations/flitt/status.js';
import { lockRows } from '../../lib/locks.js';
import { logger } from '../../lib/logger.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { pspPaymentMachine } from '../../lib/payments/machines.js';
import { cardAllowedFor } from '../../lib/payments/policy.js';
import { issueReturnToken, verifyReturnToken } from '../../lib/payments/returnToken.js';
import { CAPABILITIES, can } from '../../lib/permissions.js';
import { nextReference } from '../../lib/reference.js';
import { recordPaymentInTx } from '../finance/payment.service.js';

/**
 * Card payments against a receivable, through Flitt.
 *
 * A `PspPayment` is one attempt. It is created against the receivable the
 * ledger opened at confirmation, sent to the gateway for a hosted checkout
 * URL, and then only ever moved by `applyProviderStatus` — which takes the
 * gateway's *signed status answer*, never a callback's words or a browser's
 * return, and writes the money through the finance ledger exactly once.
 *
 * No HTTP happens inside a database transaction: the create call and the
 * status reads are made first, the row is updated after, under a row lock.
 */

const settings = () => config.payments.flitt;

let client = null;

/** The gateway client; tests swap it with `setFlittClient`. */
export const flittClient = () => (client ??= createFlittClient(settings));
export const setFlittClient = (next) => {
    client = next;
};

export const modeNow = () => (settings().mode === 'live' ? 'LIVE' : 'TEST');

const assertEnabled = () => {
    if (!settings().enabled) {
        throw new ServiceUnavailableError('Card payments are not available', { reason: 'PAYMENTS_DISABLED' });
    }
};

const receivableSelect = {
    id: true,
    reference: true,
    status: true,
    currency: true,
    amountCents: true,
    paidCents: true,
    debtorEmail: true,
    debtorName: true,
    debtorPartnerId: true,
    paymentTiming: true,
    autoCancelAt: true,
    autoCancelledAt: true,
    hotelBookingId: true,
    transferBookingId: true,
    tourBookingId: true,
    serviceBookingId: true,
    orderId: true
};

export const paymentInclude = {
    receivable: { select: receivableSelect },
    paymentRecord: { select: { id: true, paidAt: true, amountCents: true } }
};

export const paymentDetailInclude = {
    ...paymentInclude,
    callbacks: { orderBy: { receivedAt: 'asc' } },
    refunds: { orderBy: { createdAt: 'asc' } }
};

const bookingTypeOf = (receivable) =>
    receivable.hotelBookingId ? 'HOTEL' : receivable.transferBookingId ? 'TRANSFER' : receivable.tourBookingId ? 'TOUR' : receivable.serviceBookingId ? 'SERVICE' : null;

const outstanding = (receivable) => Math.max(0, receivable.amountCents - receivable.paidCents);

const PAYABLE = new Set(['OPEN', 'PARTIAL']);

/** Only letters, digits and dashes reach the gateway as an order id. */
const merchantOrderIdFor = (reference) => `${settings().orderPrefix}-${reference}-${randomBytes(3).toString('hex').toUpperCase()}`.replace(/[^A-Za-z0-9-]/g, '');

/** Flitt's page languages: ours minus Hebrew, which it does not have (OQ7). */
const langFor = (locale) => (['en', 'ka', 'ru'].includes(locale) ? locale : 'en');

const RETRIABLE = new Set(['DECLINED', 'EXPIRED', 'CANCELLED', 'FAILED']);

// --- Access -------------------------------------------------------------------------

const staffReads = (viewer) => can(viewer, CAPABILITIES.FINANCE_PAYMENTS_READ);
const staffWrites = (viewer) => can(viewer, CAPABILITIES.FINANCE_PAYMENTS_WRITE);

const emailMatches = (receivable, email) => typeof email === 'string' && email.trim().toLowerCase() === receivable.debtorEmail.toLowerCase();

/** A guest proves the booking's email; staff hold the capability. Anyone else sees 404, as with bookings. */
const assertMayCreate = (receivable, actor, email) => {
    if (staffWrites(actor)) return;

    if (receivable.debtorPartnerId || !emailMatches(receivable, email)) {
        throw new NotFoundError('Booking not found');
    }
};

const assertMayRead = (payment, viewer, token) => {
    if (staffReads(viewer)) return;

    if (!verifyReturnToken(payment.id, token)) {
        throw new NotFoundError('Payment not found');
    }
};

// --- Shapes -------------------------------------------------------------------------

/** What a guest's result page needs, and nothing a stranger could use. */
export const toGuestPayment = (payment, { token = null } = {}) => ({
    id: payment.id,
    reference: payment.reference,
    status: payment.status,
    mode: payment.mode,
    provider: payment.provider,
    amountCents: payment.amountCents,
    currency: payment.currency,
    bookingReference: payment.bookingReference,
    bookingType: payment.bookingType,
    maskedCard: payment.maskedCard,
    cardType: payment.cardType,
    paymentSystem: payment.paymentSystem,
    responseCode: payment.responseCode,
    responseDescription: payment.responseDescription,
    checkoutUrl: isOpen(payment.status) ? payment.checkoutUrl : null,
    expiresAt: payment.expiresAt,
    completedAt: payment.completedAt,
    createdAt: payment.createdAt,
    canRetry: RETRIABLE.has(payment.status) && Boolean(payment.receivable) && PAYABLE.has(payment.receivable.status) && !payment.receivable.autoCancelledAt,
    receivable: payment.receivable
        ? { status: payment.receivable.status, amountCents: payment.receivable.amountCents, paidCents: payment.receivable.paidCents, autoCancelAt: payment.receivable.autoCancelAt }
        : null,
    ...(token ? { token } : {})
});

/** The finance view: everything the guest sees plus the provider's words and the trail. */
export const toStaffPayment = (payment) => ({
    ...toGuestPayment(payment),
    checkoutUrl: payment.checkoutUrl,
    debtorEmail: payment.debtorEmail,
    receivableId: payment.receivableId,
    actualAmountCents: payment.actualAmountCents,
    actualCurrency: payment.actualCurrency,
    reversedCents: payment.reversedCents,
    merchantOrderId: payment.merchantOrderId,
    providerPaymentId: payment.providerPaymentId,
    providerTransactionId: payment.providerTransactionId,
    providerOrderStatus: payment.providerOrderStatus,
    providerOrderTime: payment.providerOrderTime,
    cardBin: payment.cardBin,
    approvalCode: payment.approvalCode,
    rrn: payment.rrn,
    eci: payment.eci,
    paymentRecordId: payment.paymentRecordId,
    paymentRecord: payment.paymentRecord ?? null,
    lang: payment.lang,
    lifetimeSeconds: payment.lifetimeSeconds,
    redirectReadyAt: payment.redirectReadyAt,
    returnedAt: payment.returnedAt,
    lastCallbackAt: payment.lastCallbackAt,
    lastStatusCheckAt: payment.lastStatusCheckAt,
    reconciledAt: payment.reconciledAt,
    failureReason: payment.failureReason,
    updatedAt: payment.updatedAt,
    receivable: payment.receivable ?? null,
    /** What may still go back to the card: charged minus reversed minus refunds in flight. */
    refundableCents:
        ['APPROVED', 'REVERSED', 'MISMATCH'].includes(payment.status) && payment.actualAmountCents
            ? Math.max(0, payment.actualAmountCents - payment.reversedCents - (payment.refunds ?? []).filter((r) => ['REQUESTED', 'SUBMITTED', 'FAILED'].includes(r.status)).reduce((sum, r) => sum + r.amountCents, 0))
            : 0,
    callbacks: (payment.callbacks ?? []).map((event) => ({
        id: event.id,
        receivedAt: event.receivedAt,
        processedAt: event.processedAt,
        signatureValid: event.signatureValid,
        orderStatus: event.orderStatus,
        sourceIp: event.sourceIp,
        error: event.error,
        payload: event.payload
    })),
    refunds: (payment.refunds ?? []).map((refund) => ({
        id: refund.id,
        status: refund.status,
        amountCents: refund.amountCents,
        currency: refund.currency,
        reverseId: refund.reverseId,
        reason: refund.reason,
        approvalRequestId: refund.approvalRequestId,
        paymentRecordId: refund.paymentRecordId,
        responseCode: refund.responseCode,
        responseDescription: refund.responseDescription,
        attempts: refund.attempts,
        lastError: refund.lastError,
        submittedAt: refund.submittedAt,
        completedAt: refund.completedAt,
        createdAt: refund.createdAt
    }))
});

// --- Lookup -------------------------------------------------------------------------

export const findPaymentOr404 = async (id, { detail = false } = {}) => {
    const payment = await prisma.pspPayment.findFirst({
        where: { OR: [{ id }, { reference: id }] },
        include: detail ? paymentDetailInclude : paymentInclude
    });

    if (!payment) {
        throw new NotFoundError('Payment not found');
    }

    return payment;
};

/** The receivable a guest means by a booking or order reference. */
const findReceivableByReference = async (reference) =>
    prisma.receivable.findFirst({ where: { reference }, select: receivableSelect, orderBy: { createdAt: 'desc' } });

// --- Create -------------------------------------------------------------------------

/**
 * Opens a card payment for the balance of a booking's receivable and asks
 * the gateway for a checkout URL.
 *
 * Idempotent on `idempotencyKey`; without one, the key is the receivable
 * and its attempt number, so two clicks that race land on one row. An open
 * attempt younger than the reuse window is handed back instead of a second
 * gateway order. The row is written first, in its own transaction, and the
 * gateway is called after: a crash between the two leaves a CREATED row the
 * sweeper closes, never a charge nobody recorded.
 */
export const createPayment = async ({ reference, email, idempotencyKey, locale, ip }, actor, req) => {
    assertEnabled();

    const receivable = await findReceivableByReference(reference);

    if (!receivable) {
        throw new NotFoundError('Booking not found');
    }

    assertMayCreate(receivable, actor, email);

    if (receivable.debtorPartnerId) {
        throw new ConflictError('Partner bookings are settled on account, not by card', { reason: 'PARTNER_RECEIVABLE' });
    }

    if (receivable.autoCancelledAt) {
        throw new GoneError('This booking was cancelled because it was not paid in time', { reason: 'BOOKING_CANCELLED' });
    }

    if (!PAYABLE.has(receivable.status) || outstanding(receivable) <= 0) {
        throw new ConflictError('There is nothing left to pay on this booking', { reason: 'RECEIVABLE_NOT_PAYABLE', status: receivable.status });
    }

    if (!cardAllowedFor(receivable.paymentTiming)) {
        throw new ConflictError('This booking is not paid by card', { reason: 'CARD_NOT_OFFERED', timing: receivable.paymentTiming });
    }

    if (!settings().currencies.includes(receivable.currency)) {
        throw new UnprocessableEntityError(`Card payments are not available in ${receivable.currency}`, { reason: 'CURRENCY_NOT_SUPPORTED', currency: receivable.currency });
    }

    const amountCents = outstanding(receivable);
    const mode = modeNow();
    const now = new Date();

    // An attempt the guest may still be on: same URL, no second order.
    const open = await prisma.pspPayment.findFirst({
        where: {
            receivableId: receivable.id,
            mode,
            status: { in: ['REDIRECT_READY', 'PROCESSING'] },
            checkoutUrl: { not: null },
            expiresAt: { gt: now },
            createdAt: { gt: new Date(now.getTime() - settings().reuseWindowSeconds * 1000) }
        },
        include: paymentInclude,
        orderBy: { createdAt: 'desc' }
    });

    if (open && (!idempotencyKey || open.idempotencyKey === idempotencyKey)) {
        return { payment: open, token: issueReturnToken(open.id), reused: true };
    }

    const attempts = await prisma.pspPayment.count({ where: { receivableId: receivable.id } });
    const key = idempotencyKey ?? `psp:${receivable.id}:${attempts + 1}`;

    const existing = await prisma.pspPayment.findUnique({ where: { idempotencyKey: key }, include: paymentInclude });

    if (existing) {
        return { payment: existing, token: issueReturnToken(existing.id), reused: true };
    }

    const lifetimeSeconds = settings().orderLifetimeSeconds;
    let created;

    try {
        created = await prisma.$transaction(async (tx) => {
            const row = await tx.pspPayment.create({
                data: {
                    reference: await nextReference(tx, 'pspPayment'),
                    provider: 'FLITT',
                    mode,
                    status: 'CREATED',
                    receivableId: receivable.id,
                    debtorEmail: receivable.debtorEmail,
                    bookingType: bookingTypeOf(receivable),
                    bookingReference: receivable.reference,
                    amountCents,
                    currency: receivable.currency,
                    merchantOrderId: merchantOrderIdFor(receivable.reference),
                    idempotencyKey: key,
                    lang: langFor(locale),
                    createdIp: ip ?? null,
                    lifetimeSeconds,
                    expiresAt: new Date(now.getTime() + lifetimeSeconds * 1000)
                },
                include: paymentInclude
            });

            await recordAudit(tx, {
                action: 'PSP_PAYMENT_CREATED',
                actor,
                entityType: AUDIT_ENTITY.pspPayment,
                entityId: row.id,
                summary: `Card payment ${row.reference} opened for ${receivable.reference}: ${(amountCents / 100).toFixed(2)} ${receivable.currency} (${mode})`,
                metadata: { receivableId: receivable.id, bookingReference: receivable.reference, amountCents, currency: receivable.currency, mode, merchantOrderId: row.merchantOrderId },
                req
            });

            return row;
        });
    } catch (err) {
        // Two identical requests at once: the loser answers with the winner.
        if (err?.code === 'P2002') {
            const winner = await prisma.pspPayment.findUnique({ where: { idempotencyKey: key }, include: paymentInclude });
            if (winner) return { payment: winner, token: issueReturnToken(winner.id), reused: true };
        }
        throw err;
    }

    const token = issueReturnToken(created.id);
    const urls = {
        responseUrl: `${settings().returnUrl}/${created.id}/${token}`,
        cancelUrl: `${settings().returnUrl}/${created.id}/${token}?cancel=1`,
        serverCallbackUrl: settings().callbackUrl
    };

    let answer;

    try {
        answer = await flittClient().createCheckoutUrl({
            orderId: created.merchantOrderId,
            orderDesc: `I am Georgia ${bookingTypeOf(receivable)?.toLowerCase() ?? 'order'} ${receivable.reference}`,
            amountCents,
            currency: receivable.currency,
            ...urls,
            lifetimeSeconds,
            senderEmail: receivable.debtorEmail,
            merchantData: JSON.stringify({ paymentId: created.id, reference: created.reference, mode }),
            productId: receivable.reference,
            lang: created.lang,
            delayed: 'N',
            designId: settings().designId ?? undefined
        });
    } catch (err) {
        const reason = err?.details?.reason ?? 'PROVIDER_ERROR';

        await prisma.pspPayment.update({
            where: { id: created.id },
            data: { status: 'FAILED', completedAt: new Date(), failureReason: `${reason}: ${err?.message ?? err}`.slice(0, 500) }
        });
        logger.error({ paymentId: created.id, paymentReference: created.reference, merchantOrderId: created.merchantOrderId, mode, reason, err: err?.message }, 'Card payment could not be opened at the gateway');

        if (err instanceof BadGatewayError) {
            throw new BadGatewayError('The payment provider could not be reached. Nothing was charged.', { reason: 'PROVIDER_UNAVAILABLE', paymentId: created.id, cause: reason });
        }

        throw err;
    }

    const payment = await prisma.pspPayment.update({
        where: { id: created.id },
        data: {
            status: 'REDIRECT_READY',
            checkoutUrl: String(answer.checkout_url),
            providerPaymentId: answer.payment_id !== undefined && answer.payment_id !== null ? String(answer.payment_id) : null,
            redirectReadyAt: new Date()
        },
        include: paymentInclude
    });

    return { payment, token, reused: false };
};

/** A fresh attempt after a decline, expiry or failure. The old row stays as history. */
export const retryPayment = async (id, { idempotencyKey, locale, ip, token }, actor, req) => {
    assertEnabled();

    const previous = await findPaymentOr404(id);

    assertMayRead(previous, actor, token);

    if (!RETRIABLE.has(previous.status)) {
        throw new ConflictError('This payment can still be completed; open it again instead', { reason: 'NOT_RETRIABLE', status: previous.status });
    }

    return createPayment(
        { reference: previous.bookingReference, email: previous.debtorEmail, idempotencyKey: idempotencyKey ?? `psp:${previous.receivableId}:retry:${previous.id}`, locale: locale ?? previous.lang, ip },
        // The token already proved the guest; the email check is satisfied with the row's own.
        staffWrites(actor) ? actor : null,
        req
    );
};

// --- Read ---------------------------------------------------------------------------

/**
 * One payment, for its guest (token) or for staff. While the attempt is
 * open and the gateway has not been asked recently, ask it now: this is what
 * converges a payment whose callback never came, and what a developer's
 * machine with no public URL relies on.
 */
export const getPayment = async (id, { token = null, refresh = true } = {}, viewer = null, req = null) => {
    let payment = await findPaymentOr404(id, { detail: staffReads(viewer) });

    assertMayRead(payment, viewer, token);

    const minAgeMs = settings().statusPollMinSeconds * 1000;
    const stale = !payment.lastStatusCheckAt || Date.now() - payment.lastStatusCheckAt.getTime() >= minAgeMs;

    if (refresh && settings().enabled && !isFinal(payment.status) && payment.status !== 'CREATED' && stale) {
        try {
            await refreshFromProvider(payment.id, { source: 'poll', actor: null, req });
            payment = await findPaymentOr404(id, { detail: staffReads(viewer) });
        } catch (err) {
            // The page shows what we know; the sweeper will try again.
            logger.warn({ paymentId: payment.id, err: err?.message, reason: err?.details?.reason }, 'Could not refresh a card payment from the gateway');
        }
    }

    return payment;
};

/** The finance list. */
export const listPayments = async ({ status, mode, q, from, to, attention, page = 1, pageSize = 25 }) => {
    const where = {
        ...(status ? { status } : {}),
        ...(mode ? { mode } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(attention ? { OR: [{ status: 'MISMATCH' }, { callbacks: { some: { signatureValid: false } } }, { refunds: { some: { status: { in: ['FAILED', 'DECLINED'] } } } }] } : {}),
        ...(q
            ? {
                  OR: [
                      { reference: { contains: q, mode: 'insensitive' } },
                      { bookingReference: { contains: q, mode: 'insensitive' } },
                      { debtorEmail: { contains: q, mode: 'insensitive' } },
                      { providerPaymentId: { contains: q } },
                      { merchantOrderId: { contains: q, mode: 'insensitive' } }
                  ]
              }
            : {})
    };

    const [total, rows] = await Promise.all([
        prisma.pspPayment.count({ where }),
        prisma.pspPayment.findMany({ where, include: paymentInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })
    ]);

    return { data: rows.map(toStaffPayment), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

// --- The one state transition --------------------------------------------------------

const providerFieldsFrom = (doc, info) => ({
    providerOrderStatus: String(doc.order_status ?? ''),
    providerOrderTime: doc.order_time ? String(doc.order_time) : null,
    providerPaymentId: doc.payment_id !== undefined && doc.payment_id !== null && doc.payment_id !== '' ? String(doc.payment_id) : undefined,
    providerTransactionId: info.transaction_id !== undefined && info.transaction_id !== null ? String(info.transaction_id) : undefined,
    responseCode: toResponseCode(doc.response_code),
    responseDescription: doc.response_description ? String(doc.response_description).slice(0, 500) : null,
    maskedCard: doc.masked_card ? String(doc.masked_card) : undefined,
    cardType: doc.card_type ? String(doc.card_type) : undefined,
    cardBin: doc.card_bin ? String(doc.card_bin) : undefined,
    paymentSystem: doc.payment_system ? String(doc.payment_system) : undefined,
    approvalCode: doc.approval_code ? String(doc.approval_code) : undefined,
    rrn: doc.rrn ? String(doc.rrn) : undefined,
    eci: doc.eci ? String(doc.eci) : undefined,
    actualAmountCents: toCents(doc.actual_amount),
    actualCurrency: doc.actual_currency ? String(doc.actual_currency) : null,
    reversedCents: toCents(doc.reversal_amount) ?? 0
});

const alert = (tx, payment, kind, extra = {}) =>
    enqueueEvent(tx, {
        topic: TOPICS.PSP_ALERT,
        payload: { kind, paymentId: payment.id, paymentReference: payment.reference, bookingReference: payment.bookingReference, ...extra },
        entityType: AUDIT_ENTITY.pspPayment,
        entityId: payment.id
    });

/**
 * Applies a verified status document from the gateway to a payment.
 *
 * Under the row lock. A document older than the row (lower rank) changes
 * nothing but the timestamps. An approval is checked against what we asked
 * — amount, currency, merchant, mode — and, if it matches, becomes one
 * PaymentRecord through the ledger; if not, the row goes to MISMATCH for a
 * person. Declines, expiries and reversals are recorded as they are.
 *
 * `source` says where the document came from (`callback`, `poll`, `sweep`,
 * `staff`) and only affects which timestamp is stamped and the audit trail.
 */
export const applyProviderStatus = (paymentId, doc, { actor = null, req = null, source = 'poll', via = null } = {}) =>
    prisma.$transaction(async (tx) => {
        await lockRows(tx, 'psp_payments', [paymentId]);

        const payment = await tx.pspPayment.findUnique({ where: { id: paymentId }, include: { receivable: { select: receivableSelect } } });

        if (!payment) {
            throw new NotFoundError('Payment not found');
        }

        if (String(doc.merchant_id) !== String(settings().merchantId)) {
            throw new BadGatewayError('The gateway answered for a different merchant', { vendor: 'flitt', reason: 'PROVIDER_MERCHANT_MISMATCH' });
        }

        if (String(doc.order_id) !== payment.merchantOrderId) {
            throw new BadGatewayError('The gateway answered for a different order', { vendor: 'flitt', reason: 'PROVIDER_ORDER_MISMATCH' });
        }

        const info = parseAdditionalInfo(doc.additional_info);
        const next = mapOrderStatus(doc.order_status);
        const now = new Date();
        const stamps = { [source === 'callback' ? 'lastCallbackAt' : 'lastStatusCheckAt']: now, ...(source === 'callback' ? { lastStatusCheckAt: now } : {}) };
        const fields = providerFieldsFrom(doc, info);
        const fresh = rank(next) >= rank(payment.status) && next !== payment.status;

        if (!fresh) {
            // Same state, or an older one: keep what the provider now says
            // about reversals and ids, move nothing.
            await tx.pspPayment.update({ where: { id: payment.id }, data: { ...stamps, reversedCents: fields.reversedCents, providerTransactionId: fields.providerTransactionId, providerPaymentId: fields.providerPaymentId } });
            return { status: payment.status, changed: false, stale: rank(next) < rank(payment.status) };
        }

        if (!pspPaymentMachine.can(payment.status, next, 'PROVIDER')) {
            logger.warn({ paymentId: payment.id, from: payment.status, to: next, source }, 'Gateway reported a transition the payment machine does not allow; ignored');
            await tx.pspPayment.update({ where: { id: payment.id }, data: stamps });
            return { status: payment.status, changed: false, stale: false, refused: next };
        }

        const audit = (action, summary, metadata = {}) =>
            recordAudit(tx, { action, actor, entityType: AUDIT_ENTITY.pspPayment, entityId: payment.id, summary, metadata: { source, providerOrderStatus: doc.order_status, ...metadata, ...(via ? { approvalId: via.approvalId } : {}) }, req });

        if (next === 'APPROVED') {
            const charged = fields.actualAmountCents ?? toCents(doc.amount);
            const chargedCurrency = fields.actualCurrency || String(doc.currency ?? '');
            const askedAmount = toCents(doc.amount);
            const modeWrong = (payment.mode === 'LIVE' && info.is_test === true) || (payment.mode === 'TEST' && info.is_test === false);
            const mismatch = charged !== payment.amountCents || askedAmount !== payment.amountCents || chargedCurrency !== payment.currency || modeWrong;

            if (mismatch) {
                await tx.pspPayment.update({ where: { id: payment.id }, data: { ...fields, ...stamps, status: 'MISMATCH', completedAt: now } });
                await audit('PSP_PAYMENT_MISMATCH', `Card payment ${payment.reference}: gateway approved ${charged} ${chargedCurrency}, we asked ${payment.amountCents} ${payment.currency}${modeWrong ? ' (test/live mode differs)' : ''}`, { charged, chargedCurrency, askedAmount, modeWrong });
                await alert(tx, payment, 'MISMATCH', { charged, chargedCurrency, expectedCents: payment.amountCents, expectedCurrency: payment.currency, modeWrong });
                return { status: 'MISMATCH', changed: true };
            }

            let paymentRecordId = payment.paymentRecordId;
            let overpaid = false;

            if (!paymentRecordId) {
                const receivable = await tx.receivable.findUnique({ where: { id: payment.receivableId }, select: receivableSelect });
                const room = PAYABLE.has(receivable.status) ? outstanding(receivable) : 0;
                const allocated = Math.min(charged, room);
                overpaid = allocated < charged;

                const record = await recordPaymentInTx(
                    tx,
                    {
                        direction: 'IN',
                        kind: 'PAYMENT',
                        method: 'CARD',
                        currency: payment.currency,
                        amountCents: charged,
                        counterpartyName: receivable.debtorName,
                        counterpartyEmail: receivable.debtorEmail,
                        paidAt: now,
                        reference: fields.rrn ?? null,
                        note: `${payment.mode === 'TEST' ? 'TEST MODE. ' : ''}Card via Flitt, payment ${payment.reference}${fields.maskedCard ? `, ${fields.maskedCard}` : ''}`,
                        externalPaymentId: fields.providerPaymentId ?? payment.providerPaymentId ?? null,
                        idempotencyKey: `flitt:${payment.mode.toLowerCase()}:${fields.providerPaymentId ?? payment.providerPaymentId ?? payment.merchantOrderId}`,
                        allocations: allocated > 0 ? [{ receivableId: receivable.id, amountCents: allocated }] : []
                    },
                    actor,
                    req,
                    via
                );

                paymentRecordId = record.id;
            }

            await tx.pspPayment.update({ where: { id: payment.id }, data: { ...fields, ...stamps, status: 'APPROVED', completedAt: now, paymentRecordId } });
            await audit('PSP_PAYMENT_APPROVED', `Card payment ${payment.reference} approved: ${(charged / 100).toFixed(2)} ${payment.currency} for ${payment.bookingReference}`, { paymentRecordId, charged, overpaid });
            await enqueueEvent(tx, { topic: TOPICS.PSP_PAYMENT_APPROVED, payload: { paymentId: payment.id }, entityType: AUDIT_ENTITY.pspPayment, entityId: payment.id });

            if (overpaid) {
                await alert(tx, payment, 'OVERPAYMENT', { charged, paymentRecordId });
            }

            return { status: 'APPROVED', changed: true };
        }

        if (next === 'DECLINED' || next === 'EXPIRED') {
            await tx.pspPayment.update({ where: { id: payment.id }, data: { ...fields, ...stamps, status: next, completedAt: now } });
            await audit(next === 'DECLINED' ? 'PSP_PAYMENT_DECLINED' : 'PSP_PAYMENT_EXPIRED', `Card payment ${payment.reference} ${next.toLowerCase()}${fields.responseCode ? ` (${fields.responseCode} ${fields.responseDescription ?? ''})` : ''}`, { responseCode: fields.responseCode });
            await enqueueEvent(tx, { topic: TOPICS.PSP_PAYMENT_FAILED, payload: { paymentId: payment.id, status: next }, entityType: AUDIT_ENTITY.pspPayment, entityId: payment.id });
            return { status: next, changed: true };
        }

        if (next === 'REVERSED') {
            await tx.pspPayment.update({ where: { id: payment.id }, data: { ...fields, ...stamps, status: 'REVERSED' } });
            await audit('PSP_PAYMENT_REVERSED', `Card payment ${payment.reference} fully reversed at the gateway (${(fields.reversedCents / 100).toFixed(2)} ${payment.currency})`, { reversedCents: fields.reversedCents });
            return { status: 'REVERSED', changed: true };
        }

        // created → REDIRECT_READY, processing → PROCESSING
        await tx.pspPayment.update({ where: { id: payment.id }, data: { ...fields, ...stamps, status: next } });
        return { status: next, changed: true };
    });

/** Asks the gateway for the order and applies the (signed) answer. */
export const refreshFromProvider = async (paymentId, { actor = null, req = null, source = 'poll', via = null } = {}) => {
    const payment = await prisma.pspPayment.findUnique({ where: { id: paymentId }, select: { id: true, merchantOrderId: true, status: true } });

    if (!payment) {
        throw new NotFoundError('Payment not found');
    }

    const doc = await flittClient().getOrderStatus({ orderId: payment.merchantOrderId });

    return applyProviderStatus(payment.id, doc, { actor, req, source, via });
};

/** Finance asks for a status check by hand; audited. */
export const checkStatusByStaff = async (id, actor, req) => {
    assertEnabled();

    const payment = await findPaymentOr404(id);
    let result;

    try {
        result = await refreshFromProvider(payment.id, { actor, req, source: 'staff' });
    } catch (err) {
        if (err instanceof UnprocessableEntityError && err.details?.errorCode === 1018) {
            result = { status: payment.status, changed: false, unknownAtProvider: true };
        } else {
            throw err;
        }
    }

    await prisma.$transaction((tx) =>
        recordAudit(tx, {
            action: 'PSP_STATUS_CHECKED',
            actor,
            entityType: AUDIT_ENTITY.pspPayment,
            entityId: payment.id,
            summary: `Status of card payment ${payment.reference} checked: ${result.status}${result.changed ? ' (changed)' : ''}`,
            metadata: result,
            req
        })
    );

    return { ...result, payment: await findPaymentOr404(payment.id, { detail: true }) };
};

// --- Our own clock ------------------------------------------------------------------

/**
 * Closes an attempt on our own authority: the guest backed out through the
 * cancel link (`GUEST`), or the attempt sat past its lifetime (`SYSTEM`).
 * Never while the provider might still say approved: the caller asks first.
 */
export const closeAttempt = (paymentId, to, actorKind, { actor = null, req = null, reason = null } = {}) =>
    prisma.$transaction(async (tx) => {
        await lockRows(tx, 'psp_payments', [paymentId]);
        const payment = await tx.pspPayment.findUnique({ where: { id: paymentId } });

        if (!payment || payment.status === to || !pspPaymentMachine.can(payment.status, to, actorKind)) {
            return { status: payment?.status ?? null, changed: false };
        }

        await tx.pspPayment.update({ where: { id: payment.id }, data: { status: to, completedAt: new Date(), failureReason: reason } });
        await recordAudit(tx, {
            action: to === 'CANCELLED' ? 'PSP_PAYMENT_CANCELLED' : to === 'EXPIRED' ? 'PSP_PAYMENT_EXPIRED' : 'PSP_PAYMENT_DECLINED',
            actor,
            entityType: AUDIT_ENTITY.pspPayment,
            entityId: payment.id,
            summary: `Card payment ${payment.reference} ${to.toLowerCase()} (${actorKind.toLowerCase()}${reason ? `: ${reason}` : ''})`,
            metadata: { from: payment.status, to, actorKind, reason },
            req
        });

        return { status: to, changed: true };
    });

/** The guest came back through the return URL; remembered, never acted on. */
export const markReturned = async (paymentId) => {
    await prisma.pspPayment.updateMany({ where: { id: paymentId, returnedAt: null }, data: { returnedAt: new Date() } });
};
