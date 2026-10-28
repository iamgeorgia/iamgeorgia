import { apiFetch, serverFetch } from "./client";
import { toQueryString } from "./query";
import type { BookingApprovalQuery } from "@/lib/admin/bookingApprovals";
import type { BookingApprovalProduct, BookingApprovalRow } from "@/types/booking";
import type { Paginated } from "@/types/partner";

/**
 * The booking approval endpoints (`/api/admin/booking-approvals`), all behind
 * `bookings.approve`.
 *
 * The list runs in a Server Component; approving and rejecting run from the
 * browser and are followed by `router.refresh()`. Either decision answers with
 * the product's own detail JSON plus a `product` field, which nothing here
 * reads — the page re-renders from the server instead.
 *
 * Refusals worth knowing: 409 `NOT_PENDING_APPROVAL` (somebody got there
 * first), `STATUS_CHANGED`, `PART_OF_ORDER` (approve the order, not the
 * part); 422 `CREDIT_LIMIT_EXCEEDED` with the reason in `details`.
 */

const base = "/api/admin/booking-approvals";

export const listBookingApprovals = (query: BookingApprovalQuery = {}) =>
  serverFetch<Paginated<BookingApprovalRow>>(`${base}${toQueryString(query)}`);

export const approveBooking = (product: BookingApprovalProduct, reference: string, note?: string) =>
  apiFetch<{ product: BookingApprovalProduct; reference: string }>(
    `${base}/${product}/${encodeURIComponent(reference)}/approve`,
    { method: "POST", body: { note: note?.trim() || undefined } },
  );

export const rejectBooking = (product: BookingApprovalProduct, reference: string, reason: string) =>
  apiFetch<{ product: BookingApprovalProduct; reference: string }>(
    `${base}/${product}/${encodeURIComponent(reference)}/reject`,
    { method: "POST", body: { reason: reason.trim() } },
  );
