import { API_BASE_URL, apiFetch, serverFetch } from "./client";
import { toQueryString } from "./query";
import type { Paginated } from "@/types/partner";
import type {
  AdjustPayableInput,
  AdjustReceivableInput,
  AgeingReport,
  FinanceProduct,
  FinanceSummary,
  MarginReport,
  PartnerStatement,
  PartnerTerms,
  PayInstalmentInput,
  Payable,
  Payment,
  PaymentDirection,
  PaymentKind,
  PaymentMethod,
  Receivable,
  RecordPaymentInput,
  SettlementStatus,
  SupplierStatementPayable,
  SupplierTerms,
  SupplierTermsKind,
  AllocationInput,
  ReceivableDueAnchor,
  Milestone,
  CancellationLiability,
} from "@/types/finance";

/**
 * The finance endpoints (`/api/admin/finance`, `/api/partner/finance`).
 *
 * Reads run in Server Components during the render; mutations run from the
 * browser and are followed by `router.refresh()`. Money-moving POSTs send an
 * Idempotency-Key so a double click or a retried request records once.
 */

const base = "/api/admin/finance";

export interface PayableQuery {
  status?: SettlementStatus | SettlementStatus[];
  /** A partner id, or "PLATFORM". */
  supplierPartnerId?: string;
  product?: FinanceProduct;
  currency?: string;
  dueBefore?: string;
  needsReview?: "true" | "false";
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface ReceivableQuery {
  status?: SettlementStatus | SettlementStatus[];
  /** A partner id, or "GUEST". */
  debtorPartnerId?: string;
  currency?: string;
  dueBefore?: string;
  overdue?: "true" | "false";
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface PaymentQuery {
  direction?: PaymentDirection;
  kind?: PaymentKind;
  method?: PaymentMethod;
  currency?: string;
  counterpartyPartnerId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface ReportPeriod {
  currency?: string;
  /** YYYY-MM-DD, Tbilisi days. */
  from?: string;
  to?: string;
}

// --- Server-side reads ------------------------------------------------------------

export const listPayables = (query: PayableQuery = {}) =>
  serverFetch<Paginated<Payable>>(`${base}/payables${toQueryString(query)}`);

export const getPayable = (id: string) => serverFetch<Payable>(`${base}/payables/${id}`);

export const listReceivables = (query: ReceivableQuery = {}) =>
  serverFetch<Paginated<Receivable>>(`${base}/receivables${toQueryString(query)}`);

export const getReceivable = (id: string) => serverFetch<Receivable>(`${base}/receivables/${id}`);

export const listPayments = (query: PaymentQuery = {}) =>
  serverFetch<Paginated<Payment>>(`${base}/payments${toQueryString(query)}`);

export const getPayment = (id: string) => serverFetch<Payment>(`${base}/payments/${id}`);

export const getFinanceSummary = (query: ReportPeriod = {}) =>
  serverFetch<FinanceSummary>(`${base}/reports/summary${toQueryString(query)}`);

export const getMarginReport = (query: ReportPeriod & { groupBy?: MarginReport["groupBy"] } = {}) =>
  serverFetch<MarginReport>(`${base}/reports/margin${toQueryString(query)}`);

export const getAgeingReport = (query: { side?: AgeingReport["side"]; currency?: string } = {}) =>
  serverFetch<AgeingReport>(`${base}/reports/ageing${toQueryString(query)}`);

export const getSupplierTerms = (kind: SupplierTermsKind, id: string) =>
  serverFetch<SupplierTerms>(`${base}/terms/${kind}/${id}`);

export const getPartnerTerms = (partnerId: string) =>
  serverFetch<PartnerTerms>(`${base}/partners/${partnerId}/terms`);

export const getPartnerStatement = (query: { status?: SettlementStatus | SettlementStatus[]; page?: number; pageSize?: number } = {}) =>
  serverFetch<PartnerStatement>(`/api/partner/finance/statement${toQueryString(query)}`);

export const getSupplierStatement = (query: { status?: SettlementStatus | SettlementStatus[]; page?: number; pageSize?: number } = {}) =>
  serverFetch<Paginated<SupplierStatementPayable>>(`/api/partner/finance/payables${toQueryString(query)}`);

/**
 * The URL of a report as CSV. A plain link the browser downloads — the session
 * cookie goes with it — rather than a fetch, so a large export streams to disk.
 */
export const reportCsvUrl = (report: "summary" | "margin" | "ageing", query: Record<string, string | undefined>) =>
  `${API_BASE_URL}${base}/reports/${report}${toQueryString({ ...query, format: "csv" })}`;

// --- Browser-side mutations -----------------------------------------------------------

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Records a payment. Pass the same `idempotencyKey` when retrying the same
 * submission (keep it in the form's state), so a retry answers with the
 * original rather than paying twice.
 */
export const recordPayment = (body: RecordPaymentInput, idempotencyKey: string = newKey()) =>
  apiFetch<{ payment: Payment; replayed: boolean }>(`${base}/payments`, {
    method: "POST",
    body,
    headers: { "Idempotency-Key": idempotencyKey },
  });

export const allocatePayment = (paymentId: string, allocations: AllocationInput[]) =>
  apiFetch<Payment>(`${base}/payments/${paymentId}/allocations`, { method: "POST", body: { allocations } });

export const payInstalment = (payableId: string, sequence: number, body: PayInstalmentInput, idempotencyKey: string = newKey()) =>
  apiFetch<{ payment: Payment; replayed: boolean }>(`${base}/payables/${payableId}/instalments/${sequence}/pay`, {
    method: "POST",
    body,
    headers: { "Idempotency-Key": idempotencyKey },
  });

export const adjustPayable = (id: string, body: AdjustPayableInput) =>
  apiFetch<Payable>(`${base}/payables/${id}`, { method: "PATCH", body });

export const adjustReceivable = (id: string, body: AdjustReceivableInput) =>
  apiFetch<Receivable>(`${base}/receivables/${id}`, { method: "PATCH", body });

export const saveSupplierTerms = (
  kind: SupplierTermsKind,
  id: string,
  body: { milestones: Milestone[]; cancellationLiability: CancellationLiability; cutoffTime?: string | null; notes?: string | null },
) => apiFetch<SupplierTerms>(`${base}/terms/${kind}/${id}`, { method: "PUT", body });

export const savePartnerTerms = (
  partnerId: string,
  body: { paymentDueDays?: number; paymentDueAnchor?: ReceivableDueAnchor; paymentTermsNote?: string | null },
) => apiFetch<PartnerTerms>(`${base}/partners/${partnerId}/terms`, { method: "PATCH", body });

export { newKey as newIdempotencyKey };
