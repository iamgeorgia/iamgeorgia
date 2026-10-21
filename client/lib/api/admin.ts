import { apiFetch, serverFetch } from "./client";
import type { AdminBadges } from "@/lib/admin/navigation";

/**
 * The admin panel's aggregate reads.
 *
 * Counts and sums the panel used to derive from paginated lists — five
 * `pageSize: 1` calls for the sidebar, a page of a hundred rows reduced in
 * the client for a money tile. The API now answers each screen's figures in
 * one request, computed in the database.
 */

/** What the API sends: `null` for each queue the viewer's role does not work. */
interface BadgesResponse {
  /** Null when the viewer cannot approve bookings. */
  pendingBookingApprovals: number | null;
  pendingPartners: number | null;
  activeBookings: number | null;
  unassignedLegs: number | null;
  pendingTourRequests: number | null;
  pendingOrders: number | null;
  paymentsDue: number | null;
  pendingApprovals: number | null;
  unreadNotifications: number;
}

export interface CurrencyTotal {
  currency: string;
  amountCents: number;
  count: number;
}

export interface BookingSummary {
  /** PENDING or CONFIRMED stays. */
  activeCount: number;
  /** What was *created* in the window, by currency, largest first. */
  recent: { days: number; from: string; byCurrency: CurrencyTotal[] };
}

export interface TransferBookingSummary {
  total: number;
  confirmed: number;
  confirmedValue: { byCurrency: CurrencyTotal[] };
}

export const NO_BADGES: AdminBadges = {
  pendingBookingApprovals: 0,
  pendingBookings: 0,
  pendingPartners: 0,
  unassignedLegs: 0,
  pendingTourRequests: 0,
  pendingOrders: 0,
  paymentsDue: 0,
  pendingApprovals: 0,
  unreadNotifications: 0,
};

/** The API's answer as the sidebar reads it: a figure the viewer may not see is zero. */
const toAdminBadges = (badges: BadgesResponse): AdminBadges => ({
  pendingBookingApprovals: badges.pendingBookingApprovals ?? 0,
  pendingBookings: badges.activeBookings ?? 0,
  pendingPartners: badges.pendingPartners ?? 0,
  unassignedLegs: badges.unassignedLegs ?? 0,
  pendingTourRequests: badges.pendingTourRequests ?? 0,
  pendingOrders: badges.pendingOrders ?? 0,
  paymentsDue: badges.paymentsDue ?? 0,
  pendingApprovals: badges.pendingApprovals ?? 0,
  unreadNotifications: badges.unreadNotifications ?? 0,
});

/** The sidebar's queue counts, read with the page. */
export const getAdminBadges = async (): Promise<AdminBadges> =>
  toAdminBadges(await serverFetch<BadgesResponse>("/api/admin/badges"));

/** The same counts from the browser, for the shell that keeps them fresh. */
export const fetchAdminBadges = async (): Promise<AdminBadges> =>
  toAdminBadges(await apiFetch<BadgesResponse>("/api/admin/badges"));

export const getBookingSummary = (days = 30) =>
  serverFetch<BookingSummary>(`/api/admin/bookings/summary?days=${days}`);

export const getTransferBookingSummary = () =>
  serverFetch<TransferBookingSummary>("/api/admin/transfers/bookings/summary");
