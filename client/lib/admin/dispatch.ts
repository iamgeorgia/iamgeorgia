import type { DispatchQuery } from "@/lib/api/dispatch";
import type { TransferAssignmentStatus, TransferBookingStatus, TransferLegStatus } from "@/types/transfer";
import { dateTimeFormat } from "@/lib/intl";

/**
 * Labels and URL parsing for the dispatch board and the driver panel.
 */

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const positiveInt = (value: string | string[] | undefined, fallback: number) => {
  const parsed = Number.parseInt(first(value) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const LEG_STATUSES: TransferLegStatus[] = [
  "UNASSIGNED",
  "ASSIGNED",
  "ACCEPTED",
  "EN_ROUTE",
  "ARRIVED",
  "ON_BOARD",
  "COMPLETED",
  "NO_SHOW_REPORTED",
  "NO_SHOW",
  "CANCELLED",
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The board shows every leg unless the URL narrows it.
 *
 * It used to default to today and the week ahead, which hid everything
 * outside that window behind two empty-looking date fields — with a
 * handful of bookings on the books, a board saying "3 legs" read as a bug.
 * The dates are filters now, applied only when given.
 */
export function dispatchQueryFromParams(params: Params): DispatchQuery {
  const from = first(params.from);
  const to = first(params.to);
  const legStatus = first(params.legStatus);
  const search = first(params.search)?.trim();

  return {
    ...(from && DATE.test(from) ? { from } : {}),
    ...(to && DATE.test(to) ? { to } : {}),
    ...(legStatus && LEG_STATUSES.includes(legStatus as TransferLegStatus)
      ? { legStatus: legStatus as TransferLegStatus }
      : {}),
    ...(search ? { search } : {}),
    page: positiveInt(params.page, 1),
    pageSize: positiveInt(params.pageSize, 50),
  };
}

/** The operational state of a leg, in the words a dispatcher uses. */
export const legStatusLabels: Record<TransferLegStatus, string> = {
  UNASSIGNED: "Needs a driver",
  ASSIGNED: "Offered",
  ACCEPTED: "Accepted",
  EN_ROUTE: "On the way",
  ARRIVED: "At the pick-up",
  ON_BOARD: "Passenger on board",
  COMPLETED: "Completed",
  NO_SHOW_REPORTED: "No-show reported",
  NO_SHOW: "No-show",
  CANCELLED: "Cancelled",
};

/** The same states as a driver reads them, in the second person. */
export const driverLegStatusLabels: Record<TransferLegStatus, string> = {
  UNASSIGNED: "Unassigned",
  ASSIGNED: "Waiting for your answer",
  ACCEPTED: "Accepted",
  EN_ROUTE: "You are on the way",
  ARRIVED: "You have arrived",
  ON_BOARD: "Passenger on board",
  COMPLETED: "Completed",
  NO_SHOW_REPORTED: "No-show reported",
  NO_SHOW: "No-show",
  CANCELLED: "Cancelled",
};

/** What the button says for each move a driver can make. */
export const driverActionLabels: Partial<Record<TransferLegStatus, string>> = {
  EN_ROUTE: "I'm on my way",
  ARRIVED: "I've arrived",
  ON_BOARD: "Passenger on board",
  COMPLETED: "Drop-off done",
  NO_SHOW_REPORTED: "Passenger didn't show",
};

export const assignmentStatusLabels: Record<TransferAssignmentStatus, string> = {
  OFFERED: "Offered",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  REVOKED: "Withdrawn",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
};

export const transferBookingStatusLabels: Record<TransferBookingStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
};

export const overrideLabels: Record<string, string> = {
  UNVERIFIED_DRIVER: "Driver not yet verified",
  CLASS_MISMATCH: "Car is a different class from the one booked",
  VEHICLE_NOT_LINKED: "Car is not one the driver usually takes",
};

export const blockReasonLabels = {
  DAY_OFF: "Day off",
  SICK: "Sick",
  MAINTENANCE: "Maintenance",
  OTHER: "Other",
} as const;

/** A pick-up instant in the pick-up point's own clock. */
export const formatPickup = (iso: string, timeZone: string, locale = "en-GB") =>
  dateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(
    new Date(iso),
  );

export const formatTime = (iso: string, timeZone: string, locale = "en-GB") =>
  dateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

/** Today and N days ahead, as calendar dates — the default window for a board or a diary. */
export const defaultWindow = (days: number) => ({
  from: new Date().toISOString().slice(0, 10),
  to: new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10),
});
