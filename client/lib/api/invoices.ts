import { API_BASE_URL, apiFetch, serverFetch } from "./client";
import { toQueryString } from "./query";
import type { Paginated } from "@/types/partner";
import type {
  Invoice,
  InvoiceKind,
  InvoiceStatus,
  InvoiceSyncEvent,
  InvoicingSettings,
  PartnerInvoice,
  RequestInvoiceInput,
} from "@/types/invoice";

/**
 * The invoicing endpoints (`/api/admin/invoices`, `/api/partner/finance/invoices`
 * and the issue-by-hand route on a receivable).
 *
 * Reads run in Server Components during the render; mutations run from the
 * browser and are followed by `router.refresh()`. The server does the issuing
 * through its outbox, so every mutation answers at once and the document's
 * status moves on its own a few seconds later.
 */

const base = "/api/admin/invoices";

export interface InvoiceQuery {
  kind?: InvoiceKind;
  status?: InvoiceStatus | InvoiceStatus[];
  receivableId?: string;
  /** A partner id, or "GUEST" for documents addressed to guests. */
  debtorPartnerId?: string;
  /** YYYY-MM-DD, by issue date. */
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

// --- Server-side reads ------------------------------------------------------------

export const listInvoices = (query: InvoiceQuery = {}) =>
  serverFetch<Paginated<Invoice>>(`${base}${toQueryString(query)}`);

export const getInvoice = (id: string) => serverFetch<Invoice>(`${base}/${id}`);

export const getInvoicingSettings = () => serverFetch<InvoicingSettings>(`${base}/settings`);

export const listInvoiceSyncEvents = (query: { page?: number; pageSize?: number } = {}) =>
  serverFetch<Paginated<InvoiceSyncEvent>>(`${base}/sync-events${toQueryString(query)}`);

export const listOwnInvoices = (query: Pick<InvoiceQuery, "kind" | "status" | "page" | "pageSize"> = {}) =>
  serverFetch<Paginated<PartnerInvoice>>(`/api/partner/finance/invoices${toQueryString(query)}`);

/**
 * The PDF as a plain link the browser opens in a new tab — the session cookie
 * goes with it — rather than a fetch, so the document streams straight from
 * the API without passing through client memory.
 */
export const invoicePdfUrl = (id: string) => `${API_BASE_URL}${base}/${id}/pdf`;

export const ownInvoicePdfUrl = (id: string) => `${API_BASE_URL}/api/partner/finance/invoices/${id}/pdf`;

// --- Browser-side mutations -----------------------------------------------------------

/** Issues a document by hand for a receivable. 202: the draft is written here and created at the provider by the outbox. */
export const requestInvoice = (receivableId: string, body: RequestInvoiceInput) =>
  apiFetch<{ invoice: Invoice; queued: boolean }>(`/api/admin/finance/receivables/${receivableId}/invoices`, {
    method: "POST",
    body,
  });

/** Asks the provider to email the document to the buyer, or to `to` instead. 202. */
export const sendInvoice = (id: string, to?: string) =>
  apiFetch<{ invoice: Invoice; queued: boolean }>(`${base}/${id}/send`, { method: "POST", body: to ? { to } : {} });

/** Cancels an unpaid proforma, here and at the provider. A VAT invoice is corrected, never cancelled. */
export const cancelInvoice = (id: string, reason?: string) =>
  apiFetch<Invoice>(`${base}/${id}/cancel`, { method: "POST", body: reason ? { reason } : {} });

/** Queues a failed document for another attempt at the provider. */
export const retryInvoice = (id: string) => apiFetch<{ invoice: Invoice; queued: boolean }>(`${base}/${id}/retry`, { method: "POST" });
