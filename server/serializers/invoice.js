/**
 * Invoice responses. The staff shape carries everything, the sync error and
 * the provider's ids included; the partner shape is listed field by field so
 * a column added to the staff view tomorrow does not reach a partner by
 * default — and it never carries the provider's token, which would open the
 * document without a sign-in.
 */

const dateOnly = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value ?? null);

const chainRef = (invoice) =>
    invoice ? { id: invoice.id, kind: invoice.kind, status: invoice.status, number: invoice.externalNumber ?? null, ...(invoice.totalCents !== undefined ? { totalCents: invoice.totalCents } : {}) } : null;

export const toInvoiceLine = (line) => ({
    id: line.id,
    description: line.description,
    quantity: line.quantity,
    taxRateBps: line.taxRateBps ?? null,
    totalGrossCents: line.totalGrossCents,
    bookingReference: line.bookingReference ?? null,
    kind: line.kind ?? null,
    unitCents: line.unitCents ?? null,
    detail: line.detail ?? null
});

export const toInvoice = (invoice) => ({
    id: invoice.id,
    provider: invoice.provider,
    kind: invoice.kind,
    status: invoice.status,
    number: invoice.externalNumber ?? null,
    externalId: invoice.externalId ?? null,
    currency: invoice.currency,
    lang: invoice.lang,
    totalCents: invoice.totalCents,
    paidCents: invoice.paidCents,
    issueDate: dateOnly(invoice.issueDate),
    sellDate: dateOnly(invoice.sellDate),
    dueDate: dateOnly(invoice.dueDate),
    buyer: invoice.buyerSnapshot ?? {},
    receivable: invoice.receivable
        ? {
              id: invoice.receivable.id,
              reference: invoice.receivable.reference,
              status: invoice.receivable.status,
              amountCents: invoice.receivable.amountCents,
              paidCents: invoice.receivable.paidCents,
              debtor: {
                  partner: invoice.receivable.debtorPartner
                      ? { id: invoice.receivable.debtorPartner.id, name: invoice.receivable.debtorPartner.name, reference: invoice.receivable.debtorPartner.reference ?? null }
                      : null,
                  name: invoice.receivable.debtorName,
                  email: invoice.receivable.debtorEmail
              }
          }
        : { id: invoice.receivableId },
    fromInvoice: chainRef(invoice.fromInvoice),
    derived: (invoice.derived ?? []).map(chainRef),
    correctionReason: invoice.correctionReason ?? null,
    source: invoice.source,
    syncError: invoice.syncError ?? null,
    lastSyncedAt: invoice.lastSyncedAt ?? null,
    externalUpdatedAt: invoice.externalUpdatedAt ?? null,
    hasPdf: Boolean(invoice.externalId),
    lines: (invoice.lines ?? []).map(toInvoiceLine),
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt
});

/** A compact row for a receivable's "Invoices" panel. */
export const toInvoiceSummary = (invoice) => ({
    id: invoice.id,
    kind: invoice.kind,
    status: invoice.status,
    number: invoice.externalNumber ?? null,
    currency: invoice.currency,
    totalCents: invoice.totalCents,
    paidCents: invoice.paidCents,
    issueDate: dateOnly(invoice.issueDate),
    fromInvoiceId: invoice.fromInvoiceId ?? null,
    syncError: invoice.syncError ?? null,
    hasPdf: Boolean(invoice.externalId),
    createdAt: invoice.createdAt
});

/** What a partner sees of its own documents: the number, the amount, the status, and that a PDF exists. */
export const toPartnerInvoice = (invoice) => ({
    id: invoice.id,
    kind: invoice.kind,
    status: invoice.status,
    number: invoice.externalNumber ?? null,
    currency: invoice.currency,
    totalCents: invoice.totalCents,
    paidCents: invoice.paidCents,
    issueDate: dateOnly(invoice.issueDate),
    dueDate: dateOnly(invoice.dueDate),
    reference: invoice.receivable?.reference ?? null,
    receivableId: invoice.receivableId,
    fromInvoice: invoice.fromInvoice ? { id: invoice.fromInvoice.id, kind: invoice.fromInvoice.kind, number: invoice.fromInvoice.externalNumber ?? null } : null,
    hasPdf: Boolean(invoice.externalId),
    lines: (invoice.lines ?? []).map(toInvoiceLine),
    createdAt: invoice.createdAt
});

export const toSyncEvent = (event) => ({
    id: event.id,
    source: event.source,
    externalId: event.externalId,
    externalUpdatedAt: event.externalUpdatedAt,
    status: event.payload?.status ?? null,
    number: event.payload?.number ?? null,
    oid: event.payload?.oid ?? null,
    error: event.error ?? null,
    processedAt: event.processedAt ?? null,
    createdAt: event.createdAt
});
