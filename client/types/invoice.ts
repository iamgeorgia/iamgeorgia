/**
 * Invoices issued through the invoicing provider (InvoiceOcean, Phase 4).
 * Mirrors `server/serializers/invoice.js`: the staff shape carries everything,
 * the partner shape is the narrower one served under `/api/partner/finance`.
 */

export type InvoiceKind = "PROFORMA" | "VAT" | "ADVANCE" | "FINAL" | "CORRECTION";

export type InvoiceStatus = "DRAFT" | "ISSUED" | "SENT" | "PAID" | "PARTIAL" | "CANCELLED" | "ERROR";

/** Why a document exists: the booking flow, a payment, a cancellation, or a finance user. */
export type InvoiceSource = "CONFIRM" | "PAYMENT" | "CANCELLATION" | "MANUAL" | "IMPORT";

/** What a line stands for (owner decision OD4): one per room, per leg, per tour, per service. */
export type InvoiceLineKind =
  | "HOTEL_ROOM"
  | "TRANSFER_LEG"
  | "TOUR"
  | "SERVICE"
  | "EXTRA"
  | "ADJUSTMENT"
  | "CANCELLATION_CHARGE"
  | "MANUAL";

/**
 * The structured fields behind a line, plus the multi-line `text` the
 * provider prints under it. The other keys depend on `kind` (a hotel line
 * carries `hotel`, `room`, `checkIn`, `pax`; a transfer leg `from`, `to`,
 * `flightNumber`) and are read only for display.
 */
export interface InvoiceLineDetail {
  text: string;
  [key: string]: unknown;
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  /** Basis points: 1800 is 18%. Null when the line carries no tax. */
  taxRateBps: number | null;
  /** Gross, in minor units. Negative on a correction. */
  totalGrossCents: number;
  bookingReference: string | null;
  kind?: InvoiceLineKind | null;
  /** The gross price of one unit (a night, a leg) when the line has one. */
  unitCents?: number | null;
  detail?: InvoiceLineDetail | null;
}

/** Another document in the same chain: the proforma a VAT invoice came from, or the correction issued against it. */
export interface InvoiceChainRef {
  id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  number: string | null;
  totalCents?: number;
}

/** The buyer as printed on the document — frozen when it was requested. */
export interface InvoiceBuyer {
  name?: string | null;
  taxId?: string | null;
  email?: string | null;
  street?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface InvoiceReceivableRef {
  id: string;
  reference?: string;
  status?: string;
  amountCents?: number;
  paidCents?: number;
  debtor?: {
    partner: { id: string; name: string; reference: string | null } | null;
    name: string | null;
    email: string | null;
  };
}

/** The staff view of one document (`GET /api/admin/invoices/:id`, and each row of the list). */
export interface Invoice {
  id: string;
  provider: "INVOICEOCEAN";
  kind: InvoiceKind;
  status: InvoiceStatus;
  /** The provider's number, e.g. "P1" or "I1". Null until issued. */
  number: string | null;
  externalId: string | null;
  currency: string;
  lang: string;
  totalCents: number;
  paidCents: number;
  /** YYYY-MM-DD. */
  issueDate: string | null;
  sellDate: string | null;
  dueDate: string | null;
  buyer: InvoiceBuyer;
  receivable: InvoiceReceivableRef;
  fromInvoice: InvoiceChainRef | null;
  derived: InvoiceChainRef[];
  correctionReason: string | null;
  source: InvoiceSource | string;
  /** The provider's last refusal, kept until the next successful attempt. */
  syncError: string | null;
  lastSyncedAt: string | null;
  externalUpdatedAt: string | null;
  /** True once the provider holds the document, so a PDF can be streamed. */
  hasPdf: boolean;
  lines: InvoiceLine[];
  createdAt: string;
  updatedAt: string;
}

/** The compact row a receivable carries in its `invoices` panel. */
export interface InvoiceSummary {
  id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  number: string | null;
  currency: string;
  totalCents: number;
  paidCents: number;
  issueDate: string | null;
  fromInvoiceId: string | null;
  syncError: string | null;
  hasPdf: boolean;
  createdAt: string;
}

/** What a partner sees of its own documents (`GET /api/partner/finance/invoices`). */
export interface PartnerInvoice {
  id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  number: string | null;
  currency: string;
  totalCents: number;
  paidCents: number;
  issueDate: string | null;
  dueDate: string | null;
  /** The booking or order reference the document is for. */
  reference: string | null;
  receivableId: string;
  fromInvoice: { id: string; kind: InvoiceKind; number: string | null } | null;
  hasPdf: boolean;
  lines: InvoiceLine[];
  createdAt: string;
}

/** A status report from the provider that matched no document here (`GET /api/admin/invoices/sync-events`). */
export interface InvoiceSyncEvent {
  id: string;
  source: "WEBHOOK" | "POLL";
  externalId: string;
  externalUpdatedAt: string | null;
  status: string | null;
  number: string | null;
  oid: string | null;
  error: string | null;
  processedAt: string | null;
  createdAt: string;
}

/** `GET /api/admin/invoices/settings`: whether invoicing is on, and the defaults a hand-issued document starts from. */
export interface InvoicingSettings {
  enabled: boolean;
  provider: "INVOICEOCEAN";
  /** The languages the provider can print a document in (no Georgian or Hebrew). */
  languages: string[];
  defaultLang: string;
  /** Basis points: 1800 is 18%. */
  defaultTaxBps: number;
  /** True when the provider emails each document to the buyer as soon as it is issued. */
  autoSend: boolean;
}

export interface InvoiceLineInput {
  description: string;
  quantity?: number;
  taxRateBps?: number | null;
  totalGrossCents: number;
}

/** `POST /api/admin/finance/receivables/:id/invoices`. */
export interface RequestInvoiceInput {
  kind: Exclude<InvoiceKind, "CORRECTION">;
  lang?: string;
  /** YYYY-MM-DD, or null for no due date. */
  dueDate?: string | null;
  /** Applied to every generated line; ignored when `lines` are given with their own rates. */
  taxRateBps?: number | null;
  /** Replaces the lines built from the booking. */
  lines?: InvoiceLineInput[];
}
