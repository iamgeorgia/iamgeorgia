import { apiFetch, serverFetch } from "./client";
import { toQueryString } from "./query";
import type { Approval, ApprovalKind, ApprovalStatus, RequestApprovalInput } from "@/types/approval";
import type { Paginated } from "@/types/partner";

/**
 * The approvals endpoints (`/api/admin/approvals`).
 *
 * Reads run in Server Components; requesting and deciding run from the
 * browser and are followed by `router.refresh()`.
 */

const base = "/api/admin/approvals";

export interface ApprovalQuery {
  status?: ApprovalStatus;
  kind?: ApprovalKind;
  /** Only requests the viewer made. */
  mine?: boolean;
  page?: number;
  pageSize?: number;
}

export const listApprovals = (query: ApprovalQuery = {}) =>
  serverFetch<Paginated<Approval>>(`${base}${toQueryString(query)}`);

export const getApproval = (id: string) => serverFetch<Approval>(`${base}/${id}`);

export const requestApproval = (body: RequestApprovalInput) => apiFetch<Approval>(base, { method: "POST", body });

export const approveApproval = (id: string, note?: string) =>
  apiFetch<Approval>(`${base}/${id}/approve`, { method: "POST", body: { note: note || undefined } });

export const rejectApproval = (id: string, note?: string) =>
  apiFetch<Approval>(`${base}/${id}/reject`, { method: "POST", body: { note: note || undefined } });

export const cancelApproval = (id: string) => apiFetch<Approval>(`${base}/${id}/cancel`, { method: "POST", body: {} });
