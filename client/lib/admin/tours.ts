import { bookingFiltersFromParams } from "./bookingFilters";
import type { AdminTourQuery } from "@/lib/api/tours";
import type {
  ConfirmationMode,
  TourBookingQuery,
  TourBookingStatus,
  TourCategory,
  TourOptionKind,
  TourPricingBasis,
  TourScheduleKind,
  TourStatus,
  TourUnavailableReason,
} from "@/types/tour";

/**
 * Display vocabulary for the tour screens, mirroring `lib/admin/hotels.ts`.
 *
 * The labels live here rather than in components so two screens cannot call
 * the same state different things.
 */

export const tourStatusLabels: Record<TourStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "On sale",
  INACTIVE: "Off sale",
  ARCHIVED: "Archived",
};

export const TOUR_STATUSES: TourStatus[] = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"];

export const TOUR_CATEGORIES: TourCategory[] = ["adventure", "culture", "wine", "nature", "city"];

export const categoryLabel = (category: string): string =>
  category.charAt(0).toUpperCase() + category.slice(1);

export const optionKindLabels: Record<TourOptionKind, string> = {
  SHARED: "Shared",
  PRIVATE: "Private",
};

export const pricingBasisLabels: Record<TourPricingBasis, string> = {
  PER_PERSON: "Per person",
  PER_GROUP: "Per group",
};

export const scheduleKindLabels: Record<TourScheduleKind, string> = {
  SCHEDULED: "Scheduled departures",
  ON_DEMAND: "On demand",
};

export const confirmationModeLabels: Record<ConfirmationMode, string> = {
  INSTANT: "Instant",
  ON_REQUEST: "On request",
};

export const unavailableReasonLabels: Record<TourUnavailableReason, string> = {
  SOLD_OUT: "Sold out",
  PARTY_SIZE: "Party size",
  TOO_SOON: "Too soon",
  BEYOND_HORIZON: "Beyond horizon",
  PAST: "Past",
  UNPRICED: "No price sheet",
};

// --- bookings ---------------------------------------------------------------

/**
 * PENDING reads as "awaiting confirmation" here rather than the hotel
 * register's "pending": a tour PENDING is an on-request booking the operator
 * has yet to answer, with seats already claimed.
 */
export const tourBookingStatusLabels: Record<TourBookingStatus, string> = {
  PENDING_APPROVAL: "Awaiting approval",
  PENDING: "Awaiting confirmation",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  NO_SHOW: "No show",
};

export const TOUR_BOOKING_STATUSES: TourBookingStatus[] = [
  "PENDING_APPROVAL",
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
];

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "12 Aug 2027" or "12 – 14 Aug 2027 · 3 days" for a multi-day departure. */
export const formatDeparture = (date: string, endDate: string): string => {
  const start = DATE.format(new Date(`${date}T00:00:00Z`));

  if (endDate === date) return start;

  const days =
    Math.round(
      (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${date}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;

  return `${start} – ${DATE.format(new Date(`${endDate}T00:00:00Z`))} · ${days} days`;
};

/** "2 adults, 1 child (6)" */
export const formatTourParty = (adults: number, childAges: number[]): string =>
  `${adults} ${adults === 1 ? "adult" : "adults"}${
    childAges.length > 0
      ? `, ${childAges.length} ${childAges.length === 1 ? "child" : "children"} (${childAges.join(", ")})`
      : ""
  }`;

const read = (params: Record<string, string | string[] | undefined>, key: string) => {
  const value = params[key];

  return Array.isArray(value) ? value[0] : value;
};

/** Reads the register query out of the URL, dropping anything unrecognised. */
export function tourQueryFromParams(
  params: Record<string, string | string[] | undefined>,
): AdminTourQuery {
  const status = read(params, "status");
  const category = read(params, "category");
  const page = Number.parseInt(read(params, "page") ?? "", 10);

  return {
    search: read(params, "search") || undefined,
    status: TOUR_STATUSES.includes(status as TourStatus) ? (status as TourStatus) : undefined,
    category: TOUR_CATEGORIES.includes(category as TourCategory) ? category : undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: 25,
  };
}

export function tourBookingQueryFromParams(
  params: Record<string, string | string[] | undefined>,
): TourBookingQuery {
  // The shared keys are read the same way on every register.
  const { status, ...shared } = bookingFiltersFromParams(params, { statuses: TOUR_BOOKING_STATUSES });

  return {
    ...shared,
    status: status as TourBookingStatus[] | undefined,
    tourId: read(params, "tourId") || undefined,
    pageSize: 25,
  };
}

export { tourImageUrl as tourCardImage } from "@/lib/tours/query";
