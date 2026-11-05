import { bookingFiltersFromParams } from "@/lib/admin/bookingFilters";
import { AWAITING_APPROVAL_HINT, formatStayDate } from "@/lib/admin/bookings";
import type { OrderItemStatus, OrderQuery, OrderStatus } from "@/types/order";
import type { PackageComponentType } from "@/types/package";

/**
 * Display vocabulary for the order screens, mirroring `lib/admin/tours.ts`.
 *
 * The labels live here rather than in components so two screens cannot call
 * the same state different things, and so a Server Component can read them
 * without importing a `"use client"` module.
 */

/**
 * PENDING_CONFIRMATION reads as "awaiting answers" rather than "pending":
 * the order itself is booked and its rooms and seats are claimed — what is
 * outstanding is a supplier's answer to one or more of its parts.
 */
export const orderStatusLabels: Record<OrderStatus, string> = {
  PENDING_APPROVAL: "Awaiting approval",
  PENDING_CONFIRMATION: "Awaiting answers",
  CONFIRMED: "Confirmed",
  PARTIALLY_CANCELLED: "Partly cancelled",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};

/** What each state means for the operator, shown under a filter. */
export const orderStatusHints: Record<OrderStatus, string> = {
  PENDING_APPROVAL: AWAITING_APPROVAL_HINT,
  PENDING_CONFIRMATION: "A part is on request. Its capacity is held and nobody else can sell it.",
  CONFIRMED: "Every part is committed and the buyer has been told.",
  PARTIALLY_CANCELLED: "A part was dropped. The rest of the trip still runs.",
  CANCELLED: "Nothing survives. Any charge follows the terms frozen at booking.",
  COMPLETED: "The trip has finished.",
};

export const ORDER_STATUSES: OrderStatus[] = [
  "PENDING_APPROVAL",
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PARTIALLY_CANCELLED",
  "CANCELLED",
  "COMPLETED",
];

export const orderItemStatusLabels: Record<OrderItemStatus, string> = {
  AWAITING_APPROVAL: "Awaiting approval",
  REQUESTED: "Awaiting answer",
  CONFIRMED: "Confirmed",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  NO_SHOW: "No show",
};

export const componentTypeLabels: Record<PackageComponentType, string> = {
  HOTEL_STAY: "Hotel",
  TRANSFER: "Transfer",
  TOUR: "Tour",
  SERVICE: "Service",
};

export const orderKindLabels = { PACKAGE: "From a package", CUSTOM: "Built to order" } as const;

/** "1 – 8 Jun 2027 · 7 nights", or the single date for a one-day trip. */
export const formatOrderDates = (startDate: string, endDate: string): string => {
  if (endDate === startDate) return formatStayDate(startDate);

  const nights = Math.round(
    (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) /
      86_400_000,
  );

  return `${formatStayDate(startDate)} – ${formatStayDate(endDate)} · ${nights} ${nights === 1 ? "night" : "nights"}`;
};

/** "2 adults, 1 child (6) · 2 rooms" */
export const formatOrderParty = (adults: number, childAges: number[], rooms: number): string =>
  [
    `${adults} ${adults === 1 ? "adult" : "adults"}`,
    childAges.length > 0
      ? `${childAges.length} ${childAges.length === 1 ? "child" : "children"} (${childAges.join(", ")})`
      : null,
  ]
    .filter(Boolean)
    .join(", ") + (rooms > 1 ? ` · ${rooms} rooms` : "");

/**
 * Whether the supplier's answer is already late.
 *
 * `at` is injectable so a caller that has to render the same verdict twice —
 * on the server and again on hydration — can pass one instant to both rather
 * than let the two renders disagree about what "now" is.
 */
export const isRequestOverdue = (
  requestDeadlineAt: string | null,
  at: Date = new Date(),
): boolean => requestDeadlineAt !== null && new Date(requestDeadlineAt).getTime() < at.getTime();

const read = (params: Record<string, string | string[] | undefined>, key: string) => {
  const value = params[key];

  return Array.isArray(value) ? value[0] : value;
};

/**
 * Reads the register query out of the URL.
 *
 * Unrecognised statuses are dropped rather than rejected, so a stale bookmark
 * or a hand-edited URL shows an unfiltered list instead of an error page — the
 * same forgiving treatment `tourBookingQueryFromParams` already gives.
 */
export function orderQueryFromParams(
  params: Record<string, string | string[] | undefined>,
): OrderQuery {
  // The shared keys are read the same way on every register.
  const { status, ...shared } = bookingFiltersFromParams(params, { statuses: ORDER_STATUSES });

  return {
    ...shared,
    status: status as OrderStatus[] | undefined,
    packageId: read(params, "packageId") || undefined,
    pageSize: 25,
  };
}
