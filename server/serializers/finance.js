/**
 * Finance responses.
 *
 * Every settlement carries the two derived figures a screen needs and should
 * never compute for itself: `outstandingCents` (still to be paid) and
 * `refundDueCents` (paid beyond what is now owed, after a cancellation). Both
 * are read off the stored amounts here, in one place.
 */

import { toInvoiceSummary } from './invoice.js';

const outstanding = (row) => Math.max(0, row.amountCents - row.paidCents);
const refundDue = (row) => Math.max(0, row.paidCents - row.amountCents);

const PRODUCTS = [
    ['hotelBooking', 'HOTEL'],
    ['transferBooking', 'TRANSFER'],
    ['tourBooking', 'TOUR'],
    ['serviceBooking', 'SERVICE']
];

/** The booking (or order) a settlement belongs to: enough to link to it. */
const subjectOf = (row) => {
    if (row.order) {
        return { kind: 'ORDER', id: row.order.id, reference: row.order.reference, status: row.order.status };
    }

    for (const [relation, kind] of PRODUCTS) {
        if (row[relation]) {
            return { kind, id: row[relation].id, reference: row[relation].reference, status: row[relation].status };
        }
    }

    return null;
};

const partnerRef = (partner) => (partner ? { id: partner.id, name: partner.name, reference: partner.reference ?? null } : null);

export const toAllocation = (allocation) => ({
    id: allocation.id,
    amountCents: allocation.amountCents,
    createdAt: allocation.createdAt,
    payment: allocation.paymentRecord
        ? {
              id: allocation.paymentRecord.id,
              direction: allocation.paymentRecord.direction,
              kind: allocation.paymentRecord.kind,
              method: allocation.paymentRecord.method,
              reference: allocation.paymentRecord.reference ?? null,
              paidAt: allocation.paymentRecord.paidAt
          }
        : undefined,
    receivable: allocation.receivable
        ? { id: allocation.receivable.id, reference: allocation.receivable.reference, debtorName: allocation.receivable.debtorName }
        : undefined,
    instalment: allocation.payableInstalment
        ? {
              id: allocation.payableInstalment.id,
              sequence: allocation.payableInstalment.sequence,
              kind: allocation.payableInstalment.kind,
              payableId: allocation.payableInstalment.payable?.id ?? null,
              bookingReference: allocation.payableInstalment.payable?.bookingReference ?? null,
              product: allocation.payableInstalment.payable?.product ?? null
          }
        : undefined
});

export const toInstalment = (instalment) => ({
    id: instalment.id,
    sequence: instalment.sequence,
    kind: instalment.kind,
    originalAmountCents: instalment.originalAmountCents,
    amountCents: instalment.amountCents,
    paidCents: instalment.paidCents,
    outstandingCents: outstanding(instalment),
    status: instalment.status,
    dueAt: instalment.dueAt ?? null,
    overdue: Boolean(instalment.dueAt && instalment.dueAt < new Date() && ['OPEN', 'PARTIAL'].includes(instalment.status)),
    ...(instalment.allocations ? { allocations: instalment.allocations.map(toAllocation) } : {})
});

/** An instalment in the "payments due" queue: the instalment, with enough of its payable to say whose money it is. */
export const toDueInstalment = (instalment) => ({
    ...toInstalment(instalment),
    currency: instalment.payable.currency,
    payable: {
        id: instalment.payable.id,
        product: instalment.payable.product,
        bookingReference: instalment.payable.bookingReference,
        supplier: partnerRef(instalment.payable.supplierPartner),
        currency: instalment.payable.currency,
        timezone: instalment.payable.timezone,
        status: instalment.payable.status
    }
});

export const toPayable = (payable) => ({
    id: payable.id,
    product: payable.product,
    booking: subjectOf(payable),
    bookingReference: payable.bookingReference,
    supplier: partnerRef(payable.supplierPartner),
    currency: payable.currency,
    originalAmountCents: payable.originalAmountCents,
    amountCents: payable.amountCents,
    paidCents: payable.paidCents,
    outstandingCents: outstanding(payable),
    refundDueCents: refundDue(payable),
    status: payable.status,
    nextDueAt: payable.nextDueAt ?? null,
    needsReview: payable.needsReview,
    reviewReason: payable.reviewReason ?? null,
    amountOverrideCents: payable.amountOverrideCents ?? null,
    overrideReason: payable.overrideReason ?? null,
    cancellationLiability: payable.cancellationLiability ?? null,
    source: payable.source,
    notes: payable.notes ?? null,
    timezone: payable.timezone,
    voidedAt: payable.voidedAt ?? null,
    waivedAt: payable.waivedAt ?? null,
    createdAt: payable.createdAt,
    instalments: (payable.instalments ?? []).map(toInstalment)
});

export const toReceivable = (receivable) => ({
    id: receivable.id,
    reference: receivable.reference,
    subject: subjectOf(receivable),
    debtor: {
        partner: partnerRef(receivable.debtorPartner),
        customer: receivable.debtorCustomer
            ? { id: receivable.debtorCustomer.id, name: receivable.debtorCustomer.name }
            : receivable.debtorCustomerId
              ? { id: receivable.debtorCustomerId, name: receivable.debtorName }
              : null,
        name: receivable.debtorName,
        email: receivable.debtorEmail
    },
    currency: receivable.currency,
    originalAmountCents: receivable.originalAmountCents,
    amountCents: receivable.amountCents,
    paidCents: receivable.paidCents,
    outstandingCents: outstanding(receivable),
    refundDueCents: refundDue(receivable),
    status: receivable.status,
    dueAt: receivable.dueAt ?? null,
    overdue: Boolean(receivable.dueAt && receivable.dueAt < new Date() && ['OPEN', 'PARTIAL'].includes(receivable.status)),
    source: receivable.source,
    notes: receivable.notes ?? null,
    voidedAt: receivable.voidedAt ?? null,
    waivedAt: receivable.waivedAt ?? null,
    createdAt: receivable.createdAt,
    ...(receivable.allocations ? { allocations: receivable.allocations.map(toAllocation) } : {}),
    ...(receivable.invoices ? { invoices: receivable.invoices.map(toInvoiceSummary) } : {})
});

export const toPayment = (payment) => {
    const allocations = payment.allocations ?? [];
    const allocatedCents = allocations.reduce((sum, a) => sum + Math.abs(a.amountCents), 0);

    return {
        id: payment.id,
        direction: payment.direction,
        kind: payment.kind,
        method: payment.method,
        counterparty: {
            partner: partnerRef(payment.counterpartyPartner),
            name: payment.counterpartyName ?? payment.counterpartyPartner?.name ?? null,
            email: payment.counterpartyEmail ?? null
        },
        currency: payment.currency,
        amountCents: payment.amountCents,
        allocatedCents,
        unallocatedCents: payment.amountCents - allocatedCents,
        reference: payment.reference ?? null,
        paidAt: payment.paidAt,
        note: payment.note ?? null,
        reason: payment.reason ?? null,
        recordedBy: payment.recordedByUser
            ? {
                  id: payment.recordedByUser.id,
                  email: payment.recordedByUser.email,
                  fullName: [payment.recordedByUser.firstName, payment.recordedByUser.lastName].filter(Boolean).join(' ')
              }
            : null,
        attachment: payment.attachmentAsset
            ? { id: payment.attachmentAsset.id, name: payment.attachmentAsset.originalFilename, mimeType: payment.attachmentAsset.mimeType }
            : null,
        createdAt: payment.createdAt,
        allocations: allocations.map(toAllocation)
    };
};

export const toSupplierTerms = (terms) => ({
    id: terms.id ?? null,
    milestones: terms.milestones ?? [],
    cancellationLiability: terms.cancellationLiability,
    cutoffTime: terms.cutoffTime ?? null,
    notes: terms.notes ?? null,
    isDefault: Boolean(terms.isDefault),
    updatedAt: terms.updatedAt ?? null
});

/**
 * A partner's own statement line: only what it owes and what it paid. Built by
 * listing fields, never by deleting from the staff shape, so a column added to
 * the staff view tomorrow does not reach a partner by default.
 */
export const toStatementReceivable = (receivable) => ({
    id: receivable.id,
    reference: receivable.reference,
    subject: subjectOf(receivable),
    currency: receivable.currency,
    amountCents: receivable.amountCents,
    paidCents: receivable.paidCents,
    outstandingCents: outstanding(receivable),
    refundDueCents: refundDue(receivable),
    status: receivable.status,
    dueAt: receivable.dueAt ?? null,
    overdue: Boolean(receivable.dueAt && receivable.dueAt < new Date() && ['OPEN', 'PARTIAL'].includes(receivable.status)),
    createdAt: receivable.createdAt,
    payments: (receivable.allocations ?? []).map((allocation) => ({
        amountCents: allocation.amountCents,
        paidAt: allocation.paymentRecord?.paidAt ?? null,
        method: allocation.paymentRecord?.method ?? null,
        reference: allocation.paymentRecord?.reference ?? null
    }))
});

/** A supplier's own payables: its net and its schedule, nothing of ours. Listed, not filtered. */
/** A cancellation penalty: the charge, and the figure approved in its place if any. */
export const toPenalty = (penalty) => ({
    id: penalty.id,
    bookingType: penalty.bookingType,
    bookingId: penalty.bookingId,
    reference: penalty.reference,
    partner: penalty.partner ? { id: penalty.partner.id, name: penalty.partner.name, reference: penalty.partner.reference } : null,
    currency: penalty.currency,
    chargeCents: penalty.chargeCents,
    overrideCents: penalty.overrideCents ?? null,
    overrideReason: penalty.overrideReason ?? null,
    effectiveCents: penalty.overrideCents ?? penalty.chargeCents,
    approvalId: penalty.approvalId ?? null,
    createdAt: penalty.createdAt,
    updatedAt: penalty.updatedAt
});

export const toSupplierStatementPayable = (payable) => ({
    id: payable.id,
    product: payable.product,
    bookingReference: payable.bookingReference,
    currency: payable.currency,
    amountCents: payable.amountCents,
    paidCents: payable.paidCents,
    outstandingCents: outstanding(payable),
    status: payable.status,
    nextDueAt: payable.nextDueAt ?? null,
    createdAt: payable.createdAt,
    instalments: (payable.instalments ?? []).map((instalment) => ({
        sequence: instalment.sequence,
        kind: instalment.kind,
        amountCents: instalment.amountCents,
        paidCents: instalment.paidCents,
        status: instalment.status,
        dueAt: instalment.dueAt ?? null
    }))
});
