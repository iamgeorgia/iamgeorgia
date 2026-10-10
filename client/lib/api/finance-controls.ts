import { API_BASE_URL, apiFetch, serverFetch } from "./client";
import { toQueryString } from "./query";
import type { CommissionReport, CreditPosition, Penalty, PenaltyProduct, SetCreditInput } from "@/types/finance-controls";
import type { Paginated } from "@/types/partner";

/**
 * Credit limits, cancellation penalties and the commission report
 * (`/api/admin/finance`, `/api/partner/finance`). Reads run in Server
 * Components; the credit edit runs from the browser and is followed by
 * `router.refresh()`.
 */

const base = "/api/admin/finance";

export interface PenaltyQuery {
  partnerId?: string;
  product?: PenaltyProduct;
  currency?: string;
  overridden?: "true" | "false";
  page?: number;
  pageSize?: number;
}

export interface CommissionQuery {
  /** YYYY-MM-DD, Tbilisi days. */
  from?: string;
  to?: string;
  currency?: string;
}

export const listPenalties = (query: PenaltyQuery = {}) =>
  serverFetch<Paginated<Penalty>>(`${base}/penalties${toQueryString(query)}`);

export const getPartnerCredit = (partnerId: string) =>
  serverFetch<CreditPosition>(`${base}/partners/${partnerId}/credit`);

export const setPartnerCredit = (partnerId: string, body: SetCreditInput) =>
  apiFetch<CreditPosition>(`${base}/partners/${partnerId}/credit`, { method: "PATCH", body });

export const getCommissionReport = (query: CommissionQuery & { groupBy?: CommissionReport["groupBy"]; partnerId?: string } = {}) =>
  serverFetch<CommissionReport>(`${base}/reports/commission${toQueryString(query)}`);

/** The commission report as CSV: a plain link the browser downloads, like `reportCsvUrl`. */
export const commissionCsvUrl = (query: Record<string, string | undefined>) =>
  `${API_BASE_URL}${base}/reports/commission${toQueryString({ ...query, format: "csv" })}`;

// --- Partner portal ---------------------------------------------------------------

export const getOwnCredit = () => serverFetch<CreditPosition>("/api/partner/finance/credit");

export const getOwnCommission = (query: CommissionQuery = {}) =>
  serverFetch<CommissionReport>(`/api/partner/finance/commission${toQueryString(query)}`);
