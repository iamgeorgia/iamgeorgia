import { addDaysISO, weekdayOfISO } from "./dates";
import type { ParamValue, SearchParams } from "./bookingFilters";
import type { BookingApprovalProduct } from "../../types/booking";
import type { Deadline, DeadlineKind, DeadlineSource, DeadlineStatus } from "../../types/deadline";

/**
 * Display vocabulary and calendar arithmetic for the deadline screens.
 *
 * Kept free of React and of `@/` aliases so `test/deadlines.test.ts` can load
 * it under plain Node. Every date-only value here is a `YYYY-MM-DD` day key;
 * every instant is an ISO string. A deadline is placed on the calendar by the
 * day it falls on *in its own time zone* — a payment due at 23:00 in Tbilisi
 * is a Tuesday there however the operator's browser is set.
 */

// --- vocabulary --------------------------------------------------------------

export const DEADLINE_KINDS: DeadlineKind[] = ["PAYMENT", "FREE_CANCELLATION", "CONFIRMATION"];
export const DEADLINE_STATUSES: DeadlineStatus[] = ["OPEN", "MET", "MISSED", "CANCELLED"];
export const DEADLINE_PRODUCTS: BookingApprovalProduct[] = ["HOTEL", "TRANSFER", "TOUR", "SERVICE", "ORDER"];

export const deadlineKindLabels: Record<DeadlineKind, string> = {
  PAYMENT: "Payment due",
  FREE_CANCELLATION: "Free cancellation ends",
  CONFIRMATION: "Confirmation due",
};

/** The one-word form for a chip on a crowded day. */
export const deadlineKindShortLabels: Record<DeadlineKind, string> = {
  PAYMENT: "Payment",
  FREE_CANCELLATION: "Cancellation",
  CONFIRMATION: "Confirm",
};

export const deadlineKindHints: Record<DeadlineKind, string> = {
  PAYMENT: "The receivable's due date. Moving it changes when the bill is late.",
  FREE_CANCELLATION: "The last moment the booking can be cancelled free of charge. Moving it rewrites the frozen cancellation terms.",
  CONFIRMATION: "When the platform must approve the booking, or when the supplier must answer a request.",
};

export const deadlineStatusLabels: Record<DeadlineStatus, string> = {
  OPEN: "Open",
  MET: "Met",
  MISSED: "Missed",
  CANCELLED: "Cancelled",
};

export const deadlineSourceLabels: Record<DeadlineSource, string> = {
  SYSTEM: "Set by the system",
  MANUAL: "Moved by hand",
};

export const awaitingLabels: Record<"PLATFORM" | "SUPPLIER", string> = {
  PLATFORM: "Awaiting the platform's approval",
  SUPPLIER: "Awaiting the supplier's answer",
};

/**
 * The five tones the calendar paints with. `warning` and `attention` are
 * kept apart on purpose: a cancellation window closing is amber, a
 * confirmation falling due is the brand's own orange, and the two kinds sit
 * on the same day often enough that one colour for both would hide which is
 * which.
 */
export type DeadlineTone = "info" | "warning" | "attention" | "critical" | "positive" | "neutral";

export const deadlineKindTones: Record<DeadlineKind, DeadlineTone> = {
  PAYMENT: "info",
  FREE_CANCELLATION: "warning",
  CONFIRMATION: "attention",
};

export const deadlineStatusTones: Record<DeadlineStatus, DeadlineTone> = {
  OPEN: "info",
  MET: "positive",
  MISSED: "critical",
  CANCELLED: "neutral",
};

/** What colour one row wears: late beats kind, closed beats both. */
export function deadlineTone(deadline: Pick<Deadline, "kind" | "status" | "overdue">): DeadlineTone {
  if (deadline.status === "MET") return "positive";
  if (deadline.status === "CANCELLED") return "neutral";
  if (deadline.status === "MISSED" || deadline.overdue) return "critical";
  return deadlineKindTones[deadline.kind];
}

/** Any one of these lets the viewer move a deadline of that kind. */
export function moveCapabilitiesFor(kind: DeadlineKind): string[] {
  return kind === "PAYMENT"
    ? ["finance.adjustments.execute", "finance.adjustments.request"]
    : ["bookings.deadlines.write"];
}

/** A closed deadline cannot be moved; a missed one can be given a new date. */
export const isDeadlineMovable = (status: DeadlineStatus): boolean => status === "OPEN" || status === "MISSED";

// --- calendar state ⇄ URL ----------------------------------------------------

export const CALENDAR_VIEWS = ["month", "week", "day"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export interface DeadlineCalendarState {
  view: CalendarView;
  /** The anchor day: any day of the month, the week or the day shown. */
  from: string;
  kind: DeadlineKind[];
  status: DeadlineStatus[];
  product: BookingApprovalProduct[];
  partnerId?: string;
  managerId?: string;
}

export const DEADLINE_FILTER_KEYS = ["kind", "status", "product", "partnerId", "managerId"] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const first = (value: ParamValue): string | undefined => (Array.isArray(value) ? value[0] : value);

const many = (value: ParamValue): string[] => (Array.isArray(value) ? value : value ? [value] : []);

const subset = <T extends string>(value: ParamValue, allowed: readonly T[]): T[] => {
  const wanted = new Set(many(value));
  return allowed.filter((entry) => wanted.has(entry));
};

const id = (value: ParamValue): string | undefined => {
  const single = first(value)?.trim();
  return single && single.length <= 64 ? single : undefined;
};

/**
 * Reads the calendar out of the URL. Unknown values fall back rather than
 * fail: a stale bookmark shows this month, not an error page. The default
 * view is the caller's — month on a desk, week on a phone.
 */
export function calendarStateFromParams(
  params: SearchParams,
  today: string,
  defaultView: CalendarView = "month",
): DeadlineCalendarState {
  const view = first(params.view);
  const from = first(params.from);
  const state: DeadlineCalendarState = {
    view: CALENDAR_VIEWS.includes(view as CalendarView) ? (view as CalendarView) : defaultView,
    from: from && DATE_ONLY.test(from) ? from : today,
    kind: subset(params.kind, DEADLINE_KINDS),
    status: subset(params.status, DEADLINE_STATUSES),
    product: subset(params.product, DEADLINE_PRODUCTS),
  };
  const partnerId = id(params.partnerId);
  const managerId = id(params.managerId);
  if (partnerId) state.partnerId = partnerId;
  if (managerId) state.managerId = managerId;
  return state;
}

/** The inverse: only what differs from the defaults is written, so a plain `/admin/deadlines` stays plain. */
export function calendarStateToParams(
  state: Partial<DeadlineCalendarState>,
  today?: string,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (state.view && state.view !== "month") out.view = state.view;
  if (state.from && state.from !== today) out.from = state.from;
  if (state.kind?.length) out.kind = [...state.kind];
  if (state.status?.length) out.status = [...state.status];
  if (state.product?.length) out.product = [...state.product];
  if (state.partnerId) out.partnerId = state.partnerId;
  if (state.managerId) out.managerId = state.managerId;
  return out;
}

export function calendarStateToSearch(state: Partial<DeadlineCalendarState>, today?: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(calendarStateToParams(state, today))) {
    for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const hasCalendarFilters = (state: Partial<DeadlineCalendarState>): boolean =>
  DEADLINE_FILTER_KEYS.some((key) => {
    const value = state[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });

export interface CalendarFilterChip {
  key: string;
  label: string;
  clear: { key: (typeof DEADLINE_FILTER_KEYS)[number]; value?: string };
}

export const deadlineProductLabels: Record<BookingApprovalProduct, string> = {
  HOTEL: "Hotels",
  TRANSFER: "Transfers",
  TOUR: "Tours",
  SERVICE: "Services",
  ORDER: "Orders",
};

export function describeCalendarFilters(
  state: Partial<DeadlineCalendarState>,
  names: { partnerName?: string | null; managerName?: string | null } = {},
): CalendarFilterChip[] {
  const chips: CalendarFilterChip[] = [];
  for (const kind of state.kind ?? []) chips.push({ key: `kind:${kind}`, label: deadlineKindLabels[kind], clear: { key: "kind", value: kind } });
  for (const status of state.status ?? []) {
    chips.push({ key: `status:${status}`, label: `Status: ${deadlineStatusLabels[status]}`, clear: { key: "status", value: status } });
  }
  for (const product of state.product ?? []) {
    chips.push({ key: `product:${product}`, label: deadlineProductLabels[product], clear: { key: "product", value: product } });
  }
  if (state.partnerId) chips.push({ key: "partnerId", label: `Partner: ${names.partnerName ?? state.partnerId}`, clear: { key: "partnerId" } });
  if (state.managerId) chips.push({ key: "managerId", label: `Manager: ${names.managerName ?? state.managerId}`, clear: { key: "managerId" } });
  return chips;
}

export function withoutCalendarFilter(state: DeadlineCalendarState, clear: CalendarFilterChip["clear"]): DeadlineCalendarState {
  const next: DeadlineCalendarState = { ...state, kind: [...state.kind], status: [...state.status], product: [...state.product] };
  const drop = <T extends string>(list: T[], value?: string): T[] =>
    value === undefined ? [] : list.filter((entry) => entry !== value);
  if (clear.key === "kind") next.kind = drop(next.kind, clear.value);
  else if (clear.key === "status") next.status = drop(next.status, clear.value);
  else if (clear.key === "product") next.product = drop(next.product, clear.value);
  else delete next[clear.key];
  return next;
}

// --- day keys and zones ------------------------------------------------------

const DAY_MS = 86_400_000;

const partsCache = new Map<string, Intl.DateTimeFormat>();

/** A formatter that reads an instant as a wall clock in `timeZone`; UTC when the zone is unknown. */
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = partsCache.get(timeZone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    formatter = partsFormatter("UTC");
  }
  partsCache.set(timeZone, formatter);
  return formatter;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** `{ date: "2026-10-20", time: "18:00" }` — the instant as the wall clock in its zone. */
export function zonedParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = partsFormatter(timeZone).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}

/** The calendar day an instant falls on in its own zone. */
export const dayKeyIn = (iso: string, timeZone: string): string => zonedParts(iso, timeZone).date;

/** The zone's offset from UTC, in minutes, at the instant given. */
function offsetMinutesAt(instant: number, timeZone: string): number {
  const { date, time } = zonedParts(new Date(instant).toISOString(), timeZone);
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  // The formatter drops seconds; compare at minute precision.
  return Math.round((asUtc - Math.floor(instant / 60_000) * 60_000) / 60_000);
}

/**
 * The instant at which a wall clock reads `date` `time` in `timeZone`.
 *
 * Two passes: a guess in UTC, corrected by the zone's offset at that guess,
 * then corrected again in case the first correction crossed a DST change.
 * No library needed for this; the browser's own `Intl` knows the rules.
 */
export function instantFromZoned(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (time || "00:00").split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let instant = guess - offsetMinutesAt(guess, timeZone) * 60_000;
  instant = guess - offsetMinutesAt(instant, timeZone) * 60_000;
  return new Date(instant).toISOString();
}

const DATE_TIME = new Map<string, Intl.DateTimeFormat>();

/** "20 Oct 2026, 18:00 (Asia/Tbilisi)" — the due moment where it counts. */
export function formatDeadlineInstant(iso: string, timeZone: string, withZone = true): string {
  let formatter = DATE_TIME.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    }
    DATE_TIME.set(timeZone, formatter);
  }
  const text = formatter.format(new Date(iso));
  return withZone ? `${text} (${timeZone})` : text;
}

/** "18:00" in the deadline's zone, for a chip. */
export const formatDeadlineTime = (iso: string, timeZone: string): string => zonedParts(iso, timeZone).time;

/** "In 3 days", "Today", "2 days late", "Met", "Cancelled". */
export function deadlineDueWords(deadline: Pick<Deadline, "status" | "dueAt" | "timezone">, today: string): string {
  if (deadline.status === "MET") return "Met";
  if (deadline.status === "CANCELLED") return "Cancelled";
  const due = dayKeyIn(deadline.dueAt, deadline.timezone);
  const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  if (days === 0) return deadline.status === "MISSED" ? "Missed today" : "Today";
  if (days > 0) return days === 1 ? "Tomorrow" : `In ${days} days`;
  return days === -1 ? "1 day late" : `${-days} days late`;
}

// --- month, week and day arithmetic ------------------------------------------

export const monthStartISO = (dateOnly: string): string => `${dateOnly.slice(0, 7)}-01`;

export function monthEndISO(dateOnly: string): string {
  const [year, month] = dateOnly.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${dateOnly.slice(0, 7)}-${pad(last)}`;
}

export function addMonthsISO(dateOnly: string, months: number): string {
  const [year, month] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01`;
}

/** The Monday on or before the day. */
export const weekStartISO = (dateOnly: string): string => addDaysISO(dateOnly, 1 - weekdayOfISO(dateOnly));

/** The first and last day shown for a view, inclusive. The month view shows whole weeks. */
export function calendarRange(view: CalendarView, from: string): { start: string; end: string } {
  switch (view) {
    case "month": {
      const start = weekStartISO(monthStartISO(from));
      const end = addDaysISO(weekStartISO(monthEndISO(from)), 6);
      return { start, end };
    }
    case "week": {
      const start = weekStartISO(from);
      return { start, end: addDaysISO(start, 6) };
    }
    case "day":
      return { start: from, end: from };
  }
}

/** Every day key from `start` to `end`, inclusive. */
export function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = addDaysISO(day, 1)) days.push(day);
  return days;
}

export interface MonthGridDay {
  key: string;
  dayOfMonth: number;
  inMonth: boolean;
  weekend: boolean;
}

/** The month's grid: whole weeks, Monday first, 35 or 42 cells. */
export function monthGridDays(from: string): MonthGridDay[] {
  const { start, end } = calendarRange("month", from);
  const month = from.slice(0, 7);
  return daysBetween(start, end).map((key) => ({
    key,
    dayOfMonth: Number(key.slice(8, 10)),
    inMonth: key.slice(0, 7) === month,
    weekend: weekdayOfISO(key) >= 6,
  }));
}

/** Steps the anchor by one view-length either way. */
export function stepAnchor(view: CalendarView, from: string, direction: -1 | 1): string {
  switch (view) {
    case "month":
      return addMonthsISO(from, direction);
    case "week":
      return addDaysISO(weekStartISO(from), 7 * direction);
    case "day":
      return addDaysISO(from, direction);
  }
}

/**
 * The instant window to ask the server for. Padded by a day on either side,
 * because the days are bucketed afterwards in each deadline's own zone and a
 * 02:00 Tbilisi deadline is the previous evening in UTC.
 */
export function instantRangeFor(view: CalendarView, from: string): { from: string; to: string } {
  const { start, end } = calendarRange(view, from);
  return { from: `${addDaysISO(start, -1)}T00:00:00.000Z`, to: `${addDaysISO(end, 1)}T23:59:59.999Z` };
}

/** The rows of a window bucketed by the day they fall on in their own zone, soonest first within a day. */
export function groupByDay(rows: readonly Deadline[]): Map<string, Deadline[]> {
  const groups = new Map<string, Deadline[]>();
  for (const row of [...rows].sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
    const key = dayKeyIn(row.dueAt, row.timezone);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/** How many of each kind, for a counter row. */
export function countByKind(rows: readonly Deadline[]): Record<DeadlineKind, number> {
  const counts: Record<DeadlineKind, number> = { PAYMENT: 0, FREE_CANCELLATION: 0, CONFIRMATION: 0 };
  for (const row of rows) counts[row.kind] += 1;
  return counts;
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const FULL_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const utc = (dateOnly: string): Date => new Date(`${dateOnly}T00:00:00Z`);

/** "October 2026", "20 – 26 Oct 2026", "Tuesday 20 October 2026". */
export function rangeTitle(view: CalendarView, from: string): string {
  switch (view) {
    case "month":
      return MONTH_YEAR.format(utc(from));
    case "week": {
      const { start, end } = calendarRange("week", from);
      return start.slice(0, 7) === end.slice(0, 7)
        ? `${start.slice(8, 10).replace(/^0/, "")} – ${DAY_MONTH_YEAR.format(utc(end))}`
        : `${DAY_MONTH.format(utc(start))} – ${DAY_MONTH_YEAR.format(utc(end))}`;
    }
    case "day":
      return FULL_DAY.format(utc(from));
  }
}

export const WEEKDAY_HEADINGS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
