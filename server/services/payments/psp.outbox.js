import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { sendMail } from '../../lib/mailer/index.js';
import { bookingManageUrl, adminCardPaymentUrl, paymentResultUrl } from '../../lib/mailer/templates.js';
import { TOPICS } from '../../lib/outbox.js';
import { issueReturnToken } from '../../lib/payments/returnToken.js';
import { CAPABILITIES } from '../../lib/permissions.js';
import { usersWithCapability } from '../rbac/access.js';
import { executePspRefund } from './psp-refund.service.js';

/**
 * What the outbox does with card payment events: the guest's receipt, the
 * "payment not completed" note with a way back, the finance desk's alerts,
 * and the word that a PAY_NOW booking was cancelled unpaid.
 *
 * Built as a factory so the drain can lend it `notify`, which stays private
 * to outbox.service.js. Every handler sends with the throwing `sendMail`,
 * like the rest of the drain, so a refused email is retried.
 */

const paymentForMail = (paymentId) =>
    prisma.pspPayment.findUnique({
        where: { id: paymentId },
        include: { receivable: { select: { reference: true, debtorName: true, debtorEmail: true, debtorPartnerId: true, status: true, amountCents: true, paidCents: true, autoCancelAt: true } } }
    });

const financeUserIds = () => usersWithCapability(CAPABILITIES.FINANCE_PAYMENTS_READ, { partnerId: null });

const ALERT_KIND = {
    MISMATCH: 'PSP_PAYMENT_MISMATCH',
    CALLBACK_REJECTED: 'PSP_CALLBACK_REJECTED',
    REFUND_FAILED: 'PSP_REFUND_FAILED',
    RECONCILIATION_MISMATCH: 'PSP_RECONCILIATION_MISMATCH'
};

const ALERT_TITLE = {
    MISMATCH: 'Card payment approved for a different amount',
    CALLBACK_REJECTED: 'Payment callback rejected',
    UNKNOWN_ORDER: 'Payment callback for an unknown order',
    OVERPAYMENT: 'A booking was paid twice by card',
    REFUND_FAILED: 'A card refund failed at the gateway',
    RECONCILIATION_MISMATCH: 'Card payment and ledger disagree'
};

const money = (cents, currency) => `${(cents / 100).toFixed(2)} ${currency}`;

export const createPspOutboxHandlers = ({ notify }) => ({
    /** The bill exists and a card can settle it: here is where, and by when — unless it was paid meanwhile. */
    [TOPICS.PSP_PAYMENT_DUE]: async ({ receivableId }) => {
        const receivable = await prisma.receivable.findUnique({
            where: { id: receivableId },
            select: { id: true, reference: true, status: true, amountCents: true, paidCents: true, currency: true, debtorName: true, debtorEmail: true, debtorPartnerId: true, paymentTiming: true, autoCancelAt: true, autoCancelledAt: true, pspPayments: { select: { status: true } } }
        });

        if (!receivable || receivable.debtorPartnerId || receivable.autoCancelledAt) return;
        if (!['OPEN', 'PARTIAL'].includes(receivable.status) || receivable.amountCents - receivable.paidCents <= 0) return;
        // Already paying or paid: the receipt says it all.
        if (receivable.pspPayments.some((p) => ['APPROVED', 'PROCESSING', 'REDIRECT_READY'].includes(p.status))) return;

        await sendMail({
            to: receivable.debtorEmail,
            template: 'cardPaymentDue',
            data: {
                name: receivable.debtorName,
                bookingReference: receivable.reference,
                amountCents: receivable.amountCents - receivable.paidCents,
                currency: receivable.currency,
                required: receivable.paymentTiming === 'PAY_NOW' || receivable.paymentTiming === 'DEPOSIT',
                payBefore: receivable.autoCancelAt,
                testMode: config.payments.flitt.mode !== 'live',
                url: bookingManageUrl(receivable.reference, receivable.debtorEmail)
            }
        });
    },

    /** The guest's receipt: what was charged, on which card, for which booking. */
    [TOPICS.PSP_PAYMENT_APPROVED]: async ({ paymentId }) => {
        const payment = await paymentForMail(paymentId);
        if (!payment || payment.status !== 'APPROVED' || payment.receivable?.debtorPartnerId) return;

        await sendMail({
            to: payment.debtorEmail,
            template: 'cardPaymentReceipt',
            data: {
                name: payment.receivable?.debtorName ?? null,
                paymentReference: payment.reference,
                bookingReference: payment.bookingReference,
                bookingType: payment.bookingType,
                amountCents: payment.actualAmountCents ?? payment.amountCents,
                currency: payment.currency,
                maskedCard: payment.maskedCard,
                cardType: payment.cardType,
                paidAt: payment.completedAt ?? new Date(),
                testMode: payment.mode === 'TEST',
                url: bookingManageUrl(payment.bookingReference, payment.debtorEmail)
            }
        });
    },

    /** The bank said no, or the page was left: how to try again, and by when. */
    [TOPICS.PSP_PAYMENT_FAILED]: async ({ paymentId, status }) => {
        const payment = await paymentForMail(paymentId);
        if (!payment || payment.receivable?.debtorPartnerId) return;
        // Only while there is still something to pay and the booking still stands.
        if (!['OPEN', 'PARTIAL'].includes(payment.receivable?.status ?? '')) return;

        await sendMail({
            to: payment.debtorEmail,
            template: 'cardPaymentFailed',
            data: {
                name: payment.receivable?.debtorName ?? null,
                paymentReference: payment.reference,
                bookingReference: payment.bookingReference,
                amountCents: payment.amountCents,
                currency: payment.currency,
                status: status ?? payment.status,
                responseDescription: payment.responseDescription,
                payBefore: payment.receivable?.autoCancelAt ?? null,
                testMode: payment.mode === 'TEST',
                url: paymentResultUrl(payment.id, issueReturnToken(payment.id), payment.lang)
            }
        });
    },

    /** Something for a person at the finance desk: in-app, and the shared mailbox when set. */
    [TOPICS.PSP_ALERT]: async ({ kind, paymentId = null, paymentReference = null, bookingReference = null, ...details }) => {
        const title = ALERT_TITLE[kind] ?? `Card payment alert: ${kind}`;
        const facts = Object.entries(details)
            .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
            .map(([key, value]) => `${key}: ${value}`);
        const body = [paymentReference ? `Payment ${paymentReference}` : null, bookingReference ? `booking ${bookingReference}` : null, ...facts].filter(Boolean).join(' · ');

        await notify(await financeUserIds(), {
            kind: ALERT_KIND[kind] ?? 'PSP_ALERT',
            title,
            body: body || title,
            payload: { kind, paymentId, paymentReference, bookingReference, ...details },
            entityType: paymentId ? 'PspPayment' : null,
            entityId: paymentId
        });

        if (config.finance.opsEmail) {
            await sendMail({
                to: config.finance.opsEmail,
                template: 'cardPaymentAlert',
                data: { title, kind, paymentReference, bookingReference, facts, url: paymentId ? adminCardPaymentUrl(paymentId) : null }
            });
        }
    },

    /** An approved refund: one reversal request to the gateway, retried on a dropped connection with the same key. */
    [TOPICS.PSP_REFUND_REQUESTED]: async ({ refundId }) => {
        await executePspRefund(refundId);
    },

    /** A PAY_NOW booking cancelled by the clock: the guest hears why, finance sees it happened. */
    [TOPICS.BOOKING_AUTO_CANCELLED_UNPAID]: async ({ reference, product, debtorEmail, receivableId }) => {
        const receivable = await prisma.receivable.findUnique({ where: { id: receivableId }, select: { debtorName: true, debtorEmail: true, unpaidCancelHours: true, currency: true, originalAmountCents: true } });

        await sendMail({
            to: debtorEmail ?? receivable?.debtorEmail,
            template: 'bookingAutoCancelledUnpaid',
            data: {
                name: receivable?.debtorName ?? null,
                reference,
                product,
                hours: receivable?.unpaidCancelHours ?? null,
                amountCents: receivable?.originalAmountCents ?? null,
                currency: receivable?.currency ?? 'GEL',
                url: config.appUrl
            }
        });

        await notify(await financeUserIds(), {
            kind: 'PSP_ALERT',
            title: `${reference} cancelled: card payment not completed`,
            body: `${product} ${reference} required payment by card and was not paid within ${receivable?.unpaidCancelHours ?? '?'} hours${receivable ? ` (${money(receivable.originalAmountCents, receivable.currency)})` : ''}.`,
            payload: { kind: 'UNPAID_AUTO_CANCEL', reference, product, receivableId },
            entityType: 'Receivable',
            entityId: receivableId
        });
    }
});
