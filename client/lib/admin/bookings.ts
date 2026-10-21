import { bookingFiltersFromParams } from "./bookingFilters";
import type { BookingQuery, BookingSource, GuestTitle, HotelBookingStatus } from "@/types/booking";

/**
 * Display vocabulary for bookings, mirroring `lib/admin/partners.ts`.
 *
 * The labels live here rather than in components so two screens cannot end up
 * calling the same state different things, and so the eventual translation pass
 * has one file to work through rather than nine.
 */

/**
 * PENDING_APPROVAL is the platform's own gate (owner decision OD1), before
 * any supplier is asked: the rooms are held, nothing is owed, and the booking
 * goes nowhere until an operator says yes on the approval queue.
 */
export const bookingStatusLabels: Record<HotelBookingStatus, string> = {
  PENDING_APPROVAL: "Awaiting approval",
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  NO_SHOW: "No show",
};

/** The same sentence for every register: what the platform's gate means. */
export const AWAITING_APPROVAL_HINT =
  "Waiting for the platform's yes. Rooms or seats are held; nothing is owed yet.";

/** What each state means for the operator, shown under a filter. */
export const bookingStatusHints: Record<HotelBookingStatus, string> = {
  PENDING_APPROVAL: AWAITING_APPROVAL_HINT,
  PENDING: "Held but not yet confirmed.",
  CONFIRMED: "Rooms are committed and the guest has been told.",
  CANCELLED: "Rooms released. Any charge follows the terms agreed at booking.",
  COMPLETED: "The stay has finished.",
  NO_SHOW: "The guest never arrived.",
};

export const BOOKING_STATUSES: HotelBookingStatus[] = [
  "PENDING_APPROVAL",
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
];

/** The states that still owe the operator something. */
export const ACTIVE_BOOKING_STATUSES: HotelBookingStatus[] = ["PENDING_APPROVAL", "PENDING", "CONFIRMED"];

/**
 * Where a booking came from: the session that made it, or the channel the
 * desk named on a manual one. Upper-case, as the server's enum spells it.
 */
export const BOOKING_SOURCES: BookingSource[] = ["WEB", "PARTNER", "ADMIN", "PHONE", "EMAIL", "EXTERNAL_AGENCY", "DIRECT", "DEMO"];

export const bookingSourceLabels: Record<BookingSource, string> = {
  WEB: "Web",
  PARTNER: "Partner",
  ADMIN: "Admin",
  PHONE: "Phone",
  EMAIL: "Email",
  EXTERNAL_AGENCY: "External agency",
  DIRECT: "Direct",
  DEMO: "Demo",
};

/** The courtesy titles a guest may carry, as the voucher prints them. */
export const GUEST_TITLES: GuestTitle[] = ["MR", "MRS", "MS", "MISS", "MSTR"];

export const guestTitleLabels: Record<GuestTitle, string> = {
  MR: "Mr",
  MRS: "Mrs",
  MS: "Ms",
  MISS: "Miss",
  MSTR: "Master",
};

/** "Mrs " before a name, or nothing when no title was given. */
export const guestTitleLabel = (title: GuestTitle | string | null | undefined): string =>
  title && title in guestTitleLabels ? `${guestTitleLabels[title as GuestTitle]} ` : "";

/** A source word as the register shows it; an unknown one is shown as sent. */
export const bookingSourceLabel = (source: string | null | undefined): string =>
  source ? (bookingSourceLabels[source as BookingSource] ?? source) : "—";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * A stay date, formatted without a time zone conversion.
 *
 * These arrive as `YYYY-MM-DD` — a calendar date at the property, not an
 * instant — so they are parsed as UTC and read back as UTC. Letting the
 * browser's zone touch them is how a booking appears to start a day early for
 * anyone west of the property.
 */
export const formatStayDate = (value: string): string =>
  DATE.format(new Date(`${value}T00:00:00Z`));

/** An actual instant: created, confirmed, cancelled, a cancellation deadline. */
export const formatInstant = (value: string | null | undefined): string =>
  value ? DATE_TIME.format(new Date(value)) : "—";

/** "1 – 4 Jun 2027 · 3 nights" */
export const formatStay = (checkIn: string, checkOut: string, nights: number): string =>
  `${formatStayDate(checkIn)} – ${formatStayDate(checkOut)} · ${nights} ${nights === 1 ? "night" : "nights"}`;

/**
 * Reads a booking query out of URL search params.
 *
 * Unrecognised values are dropped rather than rejected, so a stale bookmark or
 * a hand-edited URL shows an unfiltered list instead of an error page — the
 * same forgiving treatment `partnerQueryFromParams` already gives.
 */
export function bookingQueryFromParams(
  params: Record<string, string | string[] | undefined>,
  options: { lockedStatuses?: HotelBookingStatus[] } = {},
): BookingQuery {
  const read = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  // The shared keys — payment, source, partner, manager, created range, sort
  // — are read the same way on every register (`lib/admin/bookingFilters.ts`).
  const { status, ...shared } = bookingFiltersFromParams(params, { statuses: BOOKING_STATUSES });

  return {
    ...shared,
    status: options.lockedStatuses ?? (status as HotelBookingStatus[] | undefined),
    hotelId: read("hotelId") || undefined,
    pageSize: 25,
  };
}
