/**
 * The invoicing provider interface.
 *
 * Everything the invoice service needs from whoever numbers and prints the
 * documents, in the platform's own terms: integer cents, ISO dates, our
 * invoice kinds and statuses. An adapter (`invoiceocean.adapter.js`) maps
 * these to one vendor's API and keeps that vendor's field names to itself, so
 * swapping the provider is a new adapter and a config change — not a change
 * to the service, the routes or the schema.
 *
 * Every method returns a `ProviderInvoice`, a `ProviderClient` or a
 * `ProviderPayment` as described below, and throws an `HttpError`:
 *
 *   UnprocessableEntityError  the provider refused the document (422), with
 *                             its field errors in `details` — permanent, not
 *                             retried
 *   BadGatewayError           the provider was down, slow or answered
 *                             nonsense — transient, retried by the outbox
 *   NotFoundError             the document does not exist there
 *
 * @typedef {object} ProviderInvoice
 * @property {string} externalId        the provider's id, as a string
 * @property {string|null} number       the printed number, once issued
 * @property {'PROFORMA'|'VAT'|'ADVANCE'|'FINAL'|'CORRECTION'|null} kind
 * @property {'ISSUED'|'SENT'|'PAID'|'PARTIAL'|'CANCELLED'|null} status  null when the provider's word has no equivalent here
 * @property {string|null} oid          our reference, as the provider stores it
 * @property {string} currency
 * @property {number} totalCents        gross, minor units (negative on a reducing correction)
 * @property {number} paidCents
 * @property {string|null} issueDate    YYYY-MM-DD
 * @property {string|null} sellDate
 * @property {string|null} dueDate
 * @property {string|null} lang
 * @property {string|null} publicToken  the provider's unauthenticated view token
 * @property {string|null} fromExternalId  the document this one was issued from
 * @property {Date|null} updatedAt
 * @property {Array<{description: string, quantity: number, taxRateBps: number|null, totalGrossCents: number}>} lines
 *
 * @typedef {object} ProviderClient
 * @property {string} externalId
 * @property {string} name
 * @property {string|null} taxId
 * @property {string|null} email
 * @property {string|null} street
 * @property {string|null} city
 * @property {string|null} country
 * @property {string|null} ourId        what we registered it under: a partner id or `guest:<email>`
 *
 * @typedef {object} ProviderPayment
 * @property {string} externalId
 * @property {number} amountCents
 * @property {string} currency
 *
 * @typedef {object} InvoicingProvider
 * @property {(input: CreateInvoiceInput) => Promise<ProviderInvoice>} createInvoice
 * @property {(externalId: string) => Promise<ProviderInvoice|null>} getInvoice
 * @property {(oid: string) => Promise<ProviderInvoice[]>} findByOid
 * @property {(externalId: string, status: 'issued'|'sent'|'paid'|'partial'|'cancelled') => Promise<ProviderInvoice|null>} changeStatus
 * @property {(externalId: string, options?: {to?: string}) => Promise<void>} sendByEmail
 * @property {(externalId: string) => Promise<{stream: ReadableStream, contentType: string, contentLength: number|null}>} getPdf
 * @property {(ourId: string) => Promise<ProviderClient|null>} findClientByExternalId
 * @property {(client: Omit<ProviderClient, 'externalId'> & {externalId?: string}) => Promise<ProviderClient>} upsertClient
 * @property {(input: {name: string, amountCents: number, currency: string, invoiceExternalId: string, paidDate: string}) => Promise<ProviderPayment>} createPayment
 * @property {(query: {dateFrom: string, dateTo: string, page?: number, perPage?: number, includeLines?: boolean}) => Promise<ProviderInvoice[]>} listInvoices
 * @property {(input: {url: string, secret: string, events?: string[]}) => Promise<{externalId: string}>} registerWebhook
 *
 * @typedef {object} CreateInvoiceInput
 * @property {'PROFORMA'|'VAT'|'ADVANCE'|'FINAL'|'CORRECTION'} kind
 * @property {string} lang
 * @property {string} currency
 * @property {string} oid                 our reference: the booking or order reference
 * @property {string} issueDate           YYYY-MM-DD
 * @property {string} sellDate
 * @property {string|null} dueDate
 * @property {string|null} departmentId
 * @property {string|null} clientExternalId
 * @property {{name: string, taxId: string|null, email: string|null, street: string|null, city: string|null, country: string|null}} buyer
 * @property {Array<{description: string, quantity: number, taxRateBps: number|null, totalGrossCents: number}>} lines
 * @property {string|null} fromExternalId  for VAT, FINAL and CORRECTION: the document issued from
 * @property {string|null} correctionReason
 * @property {number|null} paidCents       what to mark as already paid (a VAT invoice issued on payment)
 */

/** The kinds a provider can be asked to create, and the ones that continue a chain. */
export const INVOICE_KINDS = Object.freeze(['PROFORMA', 'VAT', 'ADVANCE', 'FINAL', 'CORRECTION']);
export const CHAINED_KINDS = Object.freeze(['VAT', 'FINAL', 'CORRECTION']);

/** Statuses the platform understands from a provider; anything else leaves the row as it was. */
export const PROVIDER_STATUSES = Object.freeze(['ISSUED', 'SENT', 'PAID', 'PARTIAL', 'CANCELLED']);
