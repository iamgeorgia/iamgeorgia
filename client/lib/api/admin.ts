import { serverFetch } from "./client";
import type { AdminBadges } from "@/lib/admin/navigation";

/**
 * The admin panel's aggregate reads.
 *
 * Counts and sums the panel used to derive from paginated lists — five
 * `pageSize: 1` calls for the sidebar, a page of a hundred rows reduced in
 * the client for a money tile. The API now answers each screen's figures in
 * one request, computed in the database.
 */

/** What the API sends: a dispatcher gets `null` for figures they may not see. */
interface BadgesResponse {
  pendingPartners: number | null;
  activeBookings: number | null;
  unassignedLegs: number;
  pendingTourRequests: number | null;
  pendingOrders: number | null;
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
  pendingBookings: 0,
  pendingPartners: 0,
  unassignedLegs: 0,
  pendingTourRequests: 0,
  pendingOrders: 0,
};

/** The sidebar's queue counts. A figure the viewer may not see reads as zero. */
export const getAdminBadges = async (): Promise<AdminBadges> => {
  const badges = await serverFetch<BadgesResponse>("/api/admin/badges");

  return {
    pendingBookings: badges.activeBookings ?? 0,
    pendingPartners: badges.pendingPartners ?? 0,
    unassignedLegs: badges.unassignedLegs,
    pendingTourRequests: badges.pendingTourRequests ?? 0,
    pendingOrders: badges.pendingOrders ?? 0,
  };
};

export const getBookingSummary = (days = 30) =>
  serverFetch<BookingSummary>(`/api/admin/bookings/summary?days=${days}`);

export const getTransferBookingSummary = () =>
  serverFetch<TransferBookingSummary>("/api/admin/transfers/bookings/summary");
