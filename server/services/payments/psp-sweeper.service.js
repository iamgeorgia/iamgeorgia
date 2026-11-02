import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { UnprocessableEntityError } from '../../lib/errors.js';
import { lockRows } from '../../lib/locks.js';
import { logger } from '../../lib/logger.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { bookingInclude as hotelInclude, cancelHotelBookingInTx } from '../hotel/booking.service.js';
import { cancelOrderInTx, orderInclude } from '../order/order.service.js';
import { cancelServiceBookingInTx, serviceBookingInclude } from '../service/booking.service.js';
import { cancelTourBookingInTx, tourBookingInclude } from '../tour/booking.service.js';
import { bookingInclude as transferInclude, cancelTransferBookingInTx } from '../transfer/booking.service.js';
import { syncBookingReceivableInTx, syncOrderReceivableInTx } from '../finance/ledger.service.js';
import { applyCallbackEvents } from './flitt-callback.service.js';
import { closeAttempt, refreshFromProvider } from './psp-payment.service.js';

/**
 * The payments sweeper: what the clock does that no request would.
 *
 *   1. apply any verified callbacks still in the inbox;
 *   2. ask the gateway about attempts that have been open a while;
 *   3. close attempts past their lifetime once the gateway agrees;
 *   4. fail rows whose create call never came back;
 *   5. cancel PAY_NOW bookings nobody paid for (§4.4, §16.6).
 *
 * Every step is idempotent and conditional, so two instances racing waste a
 * query and change nothing twice. Runs every FLITT_SWEEP_INTERVAL_MS while
 * card payments are enabled.
 */

const settings = () => config.payments.flitt;
const BATCH = 50;

const STUCK_AFTER_MS = 60 * 1000;
const EXPIRY_GRACE_MS = 5 * 60 * 1000;
const CREATE_TIMEOUT_MS = 10 * 60 * 1000;

const isNotFoundAtProvider = (err) => err instanceof UnprocessableEntityError && err.details?.errorCode === 1018;

/** Attempts the gateway has not been asked about for a minute. */
const pollOpenAttempts = async () => {
    const now = Date.now();
    const rows = await prisma.pspPayment.findMany({
        where: {
            status: { in: ['REDIRECT_READY', 'PROCESSING'] },
            createdAt: { lt: new Date(now - STUCK_AFTER_MS) },
            OR: [{ lastStatusCheckAt: null }, { lastStatusCheckAt: { lt: new Date(now - Math.max(STUCK_AFTER_MS, settings().statusPollMinSeconds * 1000)) } }]
        },
        select: { id: true, status: true, expiresAt: true, reference: true },
        orderBy: { createdAt: 'asc' },
        take: BATCH
    });

    let polled = 0;
    let expired = 0;

    for (const row of rows) {
        try {
            const result = await refreshFromProvider(row.id, { source: 'sweep' });

            polled += 1;

            // Past its lifetime and the gateway still says nobody paid: closed
            // on our side so the guest can start again. A late approval would
            // still be taken (the machine allows EXPIRED → APPROVED).
            if (!result.changed && row.expiresAt.getTime() + EXPIRY_GRACE_MS < now && ['REDIRECT_READY', 'PROCESSING'].includes(result.status)) {
                const closed = await closeAttempt(row.id, 'EXPIRED', 'SYSTEM', { reason: 'Lifetime passed without a payment' });
                if (closed.changed) expired += 1;
            }
        } catch (err) {
            if (isNotFoundAtProvider(err)) {
                // We hold a checkout URL the gateway has no order for: the order
                // was never created on its side. Nothing can be paid on it.
                await closeAttempt(row.id, 'EXPIRED', 'SYSTEM', { reason: 'Order unknown at the gateway' });
                expired += 1;
                continue;
            }

            logger.warn({ paymentId: row.id, paymentReference: row.reference, err: err?.message, reason: err?.details?.reason }, 'Sweeper could not refresh a card payment');
        }
    }

    return { polled, expired };
};

/** CREATED rows whose gateway call died with the process. */
const failAbandonedCreates = async () => {
    const rows = await prisma.pspPayment.findMany({
        where: { status: 'CREATED', createdAt: { lt: new Date(Date.now() - CREATE_TIMEOUT_MS) } },
        select: { id: true },
        take: BATCH
    });

    let failed = 0;

    for (const row of rows) {
        const result = await closeAttempt(row.id, 'FAILED', 'SYSTEM', { reason: 'The gateway was never asked (process stopped)' });
        if (result.changed) failed += 1;
    }

    return { failed };
};

// --- Unpaid PAY_NOW bookings ----------------------------------------------------------------

const PRODUCT_OF = {
    hotelBookingId: { model: 'hotelBooking', product: 'HOTEL', include: hotelInclude, cancel: cancelHotelBookingInTx, topic: TOPICS.HOTEL_BOOKING_CANCELLED, entity: AUDIT_ENTITY.booking },
    tourBookingId: { model: 'tourBooking', product: 'TOUR', include: tourBookingInclude, cancel: cancelTourBookingInTx, topic: TOPICS.TOUR_BOOKING_CANCELLED, entity: AUDIT_ENTITY.tourBooking },
    transferBookingId: { model: 'transferBooking', product: 'TRANSFER', include: transferInclude, cancel: cancelTransferBookingInTx, topic: null, entity: AUDIT_ENTITY.transferBooking },
    serviceBookingId: { model: 'serviceBooking', product: 'SERVICE', include: serviceBookingInclude, cancel: cancelServiceBookingInTx, topic: TOPICS.SERVICE_BOOKING_CANCELLED, entity: AUDIT_ENTITY.serviceBooking }
};

const LIVE_ATTEMPT = ['APPROVED', 'PROCESSING', 'MISMATCH'];

/**
 * Cancels one unpaid booking or order, re-checking everything under the
 * receivable's row lock: still open, still past its deadline, no attempt
 * that might be money. Charges are waived — the guest never paid — and the
 * usual cancellation events go out, plus one that says why.
 */
const cancelUnpaid = (receivableId) =>
    prisma.$transaction(
        async (tx) => {
            await lockRows(tx, 'receivables', [receivableId]);

            const receivable = await tx.receivable.findUnique({
                where: { id: receivableId },
                include: { pspPayments: { select: { id: true, status: true } } }
            });

            if (!receivable || receivable.status !== 'OPEN' || receivable.autoCancelledAt || !receivable.autoCancelAt || receivable.autoCancelAt > new Date() || receivable.debtorPartnerId) {
                return 'SKIPPED';
            }

            if (receivable.pspPayments.some((attempt) => LIVE_ATTEMPT.includes(attempt.status))) {
                // Money may be on its way: wait for the attempt to resolve.
                return 'POSTPONED';
            }

            const reason = 'Payment was not completed in time';
            let subject;

            if (receivable.orderId) {
                const order = await tx.order.findUnique({ where: { id: receivable.orderId }, include: orderInclude });

                if (!order || ['CANCELLED', 'COMPLETED'].includes(order.status)) {
                    await tx.receivable.update({ where: { id: receivable.id }, data: { autoCancelledAt: new Date() } });
                    return 'SKIPPED';
                }

                await cancelOrderInTx(tx, order, { reason, waiveCharges: true }, null, null);
                await syncOrderReceivableInTx(tx, order.id, null, null, { source: 'AUTO_CANCEL' });
                subject = { entityType: AUDIT_ENTITY.order, entityId: order.id, reference: order.reference, product: 'ORDER' };
            } else {
                const key = Object.keys(PRODUCT_OF).find((candidate) => receivable[candidate]);
                const spec = key ? PRODUCT_OF[key] : null;

                if (!spec) {
                    return 'SKIPPED';
                }

                const booking = await tx[spec.model].findUnique({ where: { id: receivable[key] }, include: spec.include });

                if (!booking || ['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(booking.status)) {
                    await tx.receivable.update({ where: { id: receivable.id }, data: { autoCancelledAt: new Date() } });
                    return 'SKIPPED';
                }

                const result = await spec.cancel(tx, booking, { reason, waiveCharges: true }, null, null);

                await syncBookingReceivableInTx(tx, spec.product, booking.id, null, null, { source: 'AUTO_CANCEL' });

                if (spec.topic) {
                    await enqueueEvent(tx, {
                        topic: spec.topic,
                        payload: { bookingId: booking.id, chargeCents: result?.quote?.chargeCents ?? 0, reason },
                        entityType: spec.entity,
                        entityId: booking.id
                    });
                }

                subject = { entityType: spec.entity, entityId: booking.id, reference: booking.reference, product: spec.product };
            }

            await tx.receivable.update({ where: { id: receivable.id }, data: { autoCancelledAt: new Date() } });

            await recordAudit(tx, {
                action: 'BOOKING_AUTO_CANCELLED_UNPAID',
                actor: null,
                entityType: subject.entityType,
                entityId: subject.entityId,
                summary: `${subject.reference} cancelled: card payment required (${receivable.paymentTiming}) and not completed within ${receivable.unpaidCancelHours ?? '?'} h`,
                metadata: { receivableId: receivable.id, product: subject.product, autoCancelAt: receivable.autoCancelAt, cause: 'UNPAID_AUTO_CANCEL' },
                req: null
            });

            await enqueueEvent(tx, {
                topic: TOPICS.BOOKING_AUTO_CANCELLED_UNPAID,
                payload: { receivableId: receivable.id, reference: subject.reference, product: subject.product, entityId: subject.entityId, debtorEmail: receivable.debtorEmail },
                entityType: subject.entityType,
                entityId: subject.entityId
            });

            return 'CANCELLED';
        },
        { timeout: config.order.txTimeoutMs }
    );

/** The unpaid PAY_NOW bookings whose deadline has passed. */
export const sweepUnpaidBookings = async () => {
    const due = await prisma.receivable.findMany({
        where: { autoCancelAt: { lt: new Date() }, autoCancelledAt: null, status: 'OPEN', debtorPartnerId: null },
        select: { id: true, reference: true },
        orderBy: { autoCancelAt: 'asc' },
        take: BATCH
    });

    const counts = { cancelled: 0, postponed: 0, skipped: 0, failed: 0 };

    for (const row of due) {
        try {
            const outcome = await cancelUnpaid(row.id);
            counts[outcome.toLowerCase()] += 1;
        } catch (err) {
            counts.failed += 1;
            logger.error({ receivableId: row.id, reference: row.reference, err: err?.message, reason: err?.details?.reason }, 'Could not auto-cancel an unpaid booking');
        }
    }

    return counts;
};

// --- Reconciliation ----------------------------------------------------------------------

const RECONCILE_AFTER_MS = 60 * 60 * 1000;
const RECONCILE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const RECONCILE_BATCH = 20;

/**
 * Settled payments are re-read from the gateway once, an hour after they
 * settled: the ledger row must equal what the gateway charged minus what it
 * reversed. Agreement stamps `reconciledAt`; disagreement is an alert and an
 * audit row, never a silent patch — the gateway is right, a person decides.
 * A handful per sweep, oldest first, so a backlog clears without a burst.
 */
export const reconcileSettledPayments = async () => {
    const now = Date.now();
    const rows = await prisma.pspPayment.findMany({
        where: {
            status: { in: ['APPROVED', 'REVERSED'] },
            reconciledAt: null,
            completedAt: { lt: new Date(now - RECONCILE_AFTER_MS), gt: new Date(now - RECONCILE_WINDOW_MS) }
        },
        select: { id: true, reference: true, bookingReference: true, merchantOrderId: true, status: true, actualAmountCents: true, reversedCents: true, currency: true, paymentRecordId: true },
        orderBy: { completedAt: 'asc' },
        take: RECONCILE_BATCH
    });

    let reconciled = 0;
    let mismatched = 0;

    for (const row of rows) {
        try {
            // The status read is applied too (a reversal made in the portal lands here).
            await refreshFromProvider(row.id, { source: 'sweep' });
            const current = await prisma.pspPayment.findUnique({
                where: { id: row.id },
                include: { paymentRecord: { select: { amountCents: true } }, refunds: { where: { status: 'APPROVED' }, select: { amountCents: true } } }
            });

            const ledgerIn = current.paymentRecord?.amountCents ?? 0;
            const ledgerOut = current.refunds.reduce((sum, r) => sum + r.amountCents, 0);
            const gatewayNet = (current.actualAmountCents ?? 0) - current.reversedCents;
            const agree = ledgerIn === (current.actualAmountCents ?? 0) && ledgerIn - ledgerOut === gatewayNet;

            if (agree) {
                await prisma.pspPayment.update({ where: { id: row.id }, data: { reconciledAt: new Date() } });
                reconciled += 1;
                continue;
            }

            mismatched += 1;
            await prisma.$transaction(async (tx) => {
                await recordAudit(tx, {
                    action: 'PSP_RECONCILIATION_MISMATCH',
                    actor: null,
                    entityType: AUDIT_ENTITY.pspPayment,
                    entityId: row.id,
                    summary: `Card payment ${row.reference}: ledger ${ledgerIn - ledgerOut} differs from gateway ${gatewayNet} ${current.currency}`,
                    metadata: { ledgerIn, ledgerOut, gatewayCharged: current.actualAmountCents, gatewayReversed: current.reversedCents },
                    req: null
                });
                await enqueueEvent(tx, {
                    topic: TOPICS.PSP_ALERT,
                    payload: { kind: 'RECONCILIATION_MISMATCH', paymentId: row.id, paymentReference: row.reference, bookingReference: row.bookingReference, ledgerIn, ledgerOut, gatewayCharged: current.actualAmountCents, gatewayReversed: current.reversedCents, currency: current.currency },
                    entityType: AUDIT_ENTITY.pspPayment,
                    entityId: row.id
                });
            });
        } catch (err) {
            logger.warn({ paymentId: row.id, err: err?.message, reason: err?.details?.reason }, 'Could not reconcile a card payment; will try again');
        }
    }

    return { reconciled, mismatched };
};

let lastSweep = null;

/** What the last pass did and when, for the health view. */
export const lastSweepSummary = () => lastSweep;

/** The numbers a person checks when something feels wrong. */
export const paymentsHealth = async () => {
    const now = Date.now();
    const [inboxBacklog, openAttempts, stuckProcessing, openMismatches, pendingRefunds, unpaidDue] = await Promise.all([
        prisma.pspCallbackEvent.count({ where: { signatureValid: true, processedAt: null } }),
        prisma.pspPayment.count({ where: { status: { in: ['CREATED', 'REDIRECT_READY', 'PROCESSING'] } } }),
        prisma.pspPayment.count({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(now - 30 * 60_000) } } }),
        prisma.pspPayment.count({ where: { status: 'MISMATCH' } }),
        prisma.pspRefund.count({ where: { status: { in: ['REQUESTED', 'SUBMITTED', 'FAILED'] } } }),
        prisma.receivable.count({ where: { autoCancelAt: { lt: new Date() }, autoCancelledAt: null, status: 'OPEN', debtorPartnerId: null } })
    ]);

    return {
        enabled: settings().enabled,
        mode: settings().enabled ? (settings().mode === 'live' ? 'LIVE' : 'TEST') : null,
        inboxBacklog,
        openAttempts,
        stuckProcessing,
        openMismatches,
        pendingRefunds,
        unpaidDue,
        lastSweep
    };
};

/** One pass of everything. Called by the timer in server.js and by tests. */
export const sweepPspPayments = async () => {
    if (!settings().enabled) {
        return { skipped: true };
    }

    const callbacks = await applyCallbackEvents();
    const polled = await pollOpenAttempts();
    const abandoned = await failAbandonedCreates();
    const unpaid = await sweepUnpaidBookings();
    const reconciliation = await reconcileSettledPayments();

    lastSweep = { at: new Date(), callbacks, ...polled, ...abandoned, unpaid, reconciliation };

    return { callbacks, ...polled, ...abandoned, unpaid, reconciliation };
};
