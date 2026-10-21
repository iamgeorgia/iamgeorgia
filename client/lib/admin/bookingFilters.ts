import { addDaysISO } from "./dates";
import { paymentStatusLabels, PAYMENT_STATUSES } from "./bookingApprovals";
import { bookingSourceLabels, BOOKING_SOURCES } from "./bookings";
import { invoiceStatusLabels, paymentMethodLabels } from "./finance";
import type { BookingPaymentStatus, BookingSort, BookingSource } from "@/types/booking";
import type { PaymentMethod } from "@/types/finance";
import type { InvoiceStatus } from "@/types/invoice";

/**
 * The filters every booking register shares, as the URL carries them.
 *
 * One vocabulary for the five product lists and the register of every
 * booking: the keys here are the server's own query parameters
 * (`server/lib/listing/bookingFilters.js`), so a state read off the URL can
 * be spread straight into the list call, and a bookmark written on one
 * register means the same thing on another. Each register adds its own
 * status set and names its own date column (Arriving, Pick-up, Departing,
 * Travelling); everything else is this file's.
 *
 * Unrecognised values are dropped rather than rejected, so a stale bookmark
 * shows an unfiltered list instead of an error page. Kept free of React so
 * `test/booking-filters.test.ts` can load it under plain Node.
 */

export type ParamValue = string | string[] | undefined;
export type SearchParams = Record<string, ParamValue>;

export const INVOICE_STATUSES: InvoiceStatus[] = ["DRAFT", "ISSUED", "SENT", "PAID", "PARTIAL", "CANCELLED", "ERROR"];
export const PAYMENT_METHODS: PaymentMethod[] = ["BANK_TRANSFER", "CASH", "CARD", "OTHER"];
export const BOOKING_SORTS: BookingSort[] = [
  "created:desc",
  "created:asc",
  "date:asc",
  "date:desc",
  "due:asc",
  "due:desc",
  "total:desc",
  "total:asc",
];
export const APPROVAL_FILTERS = ["PENDING", "OVERDUE"] as const;
export type ApprovalFilter = (typeof APPROVAL_FILTERS)[number];

export const sortLabels: Record<BookingSort, string> = {
  "created:desc": "Newest first",
  "created:asc": "Oldest first",
  "date:asc": "Service date, soonest first",
  "date:desc": "Service date, latest first",
  "due:asc": "Payment due, soonest first",
  "due:desc": "Payment due, latest first",
  "total:desc": "Total, highest first",
  "total:asc": "Total, lowest first",
};

export const approvalFilterLabels: Record<ApprovalFilter, string> = {
  PENDING: "Awaiting approval",
  OVERDUE: "Approval overdue",
};

export { PAYMENT_STATUSES, paymentStatusLabels, invoiceStatusLabels, paymentMethodLabels, bookingSourceLabels };

/** What the URL (and the list call) carries. `page` is always set; everything else only when chosen. */
export interface BookingFilterState {
  search?: string;
  /** The register's own statuses, validated against the set the caller names. */
  status?: string[];
  /** The register of every booking only: which products to show. */
  product?: string[];
  paymentStatus?: BookingPaymentStatus[];
  invoiceStatus?: InvoiceStatus[];
  paymentMethod?: PaymentMethod;
  source?: BookingSource[];
  partnerId?: string;
  customerId?: string;
  managerId?: string;
  destinationId?: string;
  approval?: ApprovalFilter;
  /** The register's own date column, inclusive on both ends. */
  from?: string;
  to?: string;
  createdFrom?: string;
  createdTo?: string;
  sort?: BookingSort;
  page: number;
}

/** The keys a register's filter bar owns, in the order the active chips read them. */
export const BOOKING_FILTER_KEYS = [
  "search",
  "product",
  "status",
  "approval",
  "paymentStatus",
  "invoiceStatus",
  "paymentMethod",
  "source",
  "partnerId",
  "customerId",
  "managerId",
  "destinationId",
  "from",
  "to",
  "createdFrom",
  "createdTo",
  "sort",
] as const satisfies readonly (keyof BookingFilterState)[];

export type BookingFilterKey = (typeof BOOKING_FILTER_KEYS)[number];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const first = (value: ParamValue): string | undefined => (Array.isArray(value) ? value[0] : value);

const many = (value: ParamValue): string[] => (Array.isArray(value) ? value : value ? [value] : []);

/** The values of a repeated parameter that belong to a known set, deduplicated, in the set's order. */
const subset = <T extends string>(value: ParamValue, allowed: readonly T[]): T[] | undefined => {
  const wanted = new Set(many(value));
  const kept = allowed.filter((entry) => wanted.has(entry));
  return kept.length > 0 ? kept : undefined;
};

const oneOf = <T extends string>(value: ParamValue, allowed: readonly T[]): T | undefined => {
  const single = first(value);
  return allowed.includes(single as T) ? (single as T) : undefined;
};

const dateOnly = (value: ParamValue): string | undefined => {
  const single = first(value);
  return single && DATE_ONLY.test(single) ? single : undefined;
};

const id = (value: ParamValue): string | undefined => {
  const single = first(value)?.trim();
  return single && single.length <= 64 ? single : undefined;
};

export interface BookingFilterOptions {
  /** The register's own status vocabulary. Omit it and `status` is never read. */
  statuses?: readonly string[];
  /** The products the register may show (the register of every booking). */
  products?: readonly string[];
}

/**
 * Reads a register's filters out of its URL search params.
 *
 * Arrays arrive as repeated parameters (`status=A&status=B`), exactly as the
 * server reads them; a comma-joined form is not understood, on purpose.
 */
export function bookingFiltersFromParams(params: SearchParams, options: BookingFilterOptions = {}): BookingFilterState {
  const page = Number.parseInt(first(params.page) ?? "", 10);
  const search = first(params.search)?.trim();

  const state: BookingFilterState = {
    search: search || undefined,
    status: options.statuses ? subset(params.status, options.statuses) : undefined,
    product: options.products ? subset(params.product, options.products) : undefined,
    paymentStatus: subset(params.paymentStatus, PAYMENT_STATUSES),
    invoiceStatus: subset(params.invoiceStatus, INVOICE_STATUSES),
    paymentMethod: oneOf(params.paymentMethod, PAYMENT_METHODS),
    source: subset(params.source, BOOKING_SOURCES),
    partnerId: id(params.partnerId),
    customerId: id(params.customerId),
    managerId: id(params.managerId),
    destinationId: id(params.destinationId),
    approval: oneOf(params.approval, APPROVAL_FILTERS),
    from: dateOnly(params.from),
    to: dateOnly(params.to),
    createdFrom: dateOnly(params.createdFrom),
    createdTo: dateOnly(params.createdTo),
    sort: oneOf(params.sort, BOOKING_SORTS),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };

  // Undefined keys are dropped so a spread into a query string stays clean
  // and a deep-equal in a test reads what was actually chosen.
  return Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined)) as BookingFilterState;
}

/**
 * Writes a state back as search params: arrays repeated, nothing for an
 * unset key, and no `page=1`. The inverse of `bookingFiltersFromParams` for
 * any state that function could have produced.
 */
export function bookingFiltersToParams(state: Partial<BookingFilterState>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};

  for (const key of BOOKING_FILTER_KEYS) {
    const value = state[key];
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) out[key] = [...value];
    } else {
      out[key] = value;
    }
  }

  if (state.page && state.page > 1) out.page = String(state.page);

  return out;
}

/** `?status=A&status=B&page=2` — for a link into a register. */
export function bookingFiltersToSearch(state: Partial<BookingFilterState>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(bookingFiltersToParams(state))) {
    for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Whether anything beyond the page number is narrowing the list. */
export const hasActiveFilters = (state: Partial<BookingFilterState>): boolean =>
  BOOKING_FILTER_KEYS.some((key) => {
    const value = state[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== "";
  });

// --- quick presets ------------------------------------------------------------

export type BookingPresetId =
  | "all"
  | "pendingApproval"
  | "awaitingPayment"
  | "confirmed"
  | "upcoming"
  | "overduePayments"
  | "recent";

export interface BookingPreset {
  id: BookingPresetId;
  label: string;
  /** One line under the chips when the preset is active. */
  hint: string;
}

/**
 * The views an operator opens most, each a mapping onto the shared keys.
 * "Confirmed" and "Upcoming arrivals" use the register's own `status`, so
 * they are only offered where `CONFIRMED` is one of its states — every
 * register today, orders included.
 */
export const BOOKING_PRESETS: BookingPreset[] = [
  { id: "all", label: "All bookings", hint: "Everything on the register, newest first." },
  { id: "pendingApproval", label: "Pending approval", hint: "Held until somebody says yes. Nothing is owed yet." },
  { id: "awaitingPayment", label: "Awaiting payment", hint: "Billed and not yet settled, the soonest due date first." },
  { id: "confirmed", label: "Confirmed", hint: "Rooms, seats or cars committed and the buyer told." },
  { id: "upcoming", label: "Upcoming arrivals", hint: "Confirmed bookings whose service date is today or later, soonest first." },
  { id: "overduePayments", label: "Overdue payments", hint: "Bills past their due date and still open." },
  { id: "recent", label: "Recently created", hint: "Made in the last seven days." },
];

export const RECENT_DAYS = 7;

/**
 * What a preset sets, for the given `today` (a `YYYY-MM-DD`, injected so a
 * server render and its hydration agree). Everything the preset does not
 * mention is cleared: a preset is a view, not a refinement.
 */
export function presetFilters(preset: BookingPresetId, today: string): Partial<BookingFilterState> {
  switch (preset) {
    case "all":
      return {};
    case "pendingApproval":
      return { approval: "PENDING" };
    case "awaitingPayment":
      return { paymentStatus: ["UNPAID", "PARTIAL"], sort: "due:asc" };
    case "confirmed":
      return { status: ["CONFIRMED"] };
    case "upcoming":
      return { status: ["CONFIRMED"], from: today, sort: "date:asc" };
    case "overduePayments":
      return { paymentStatus: ["OVERDUE"], sort: "due:asc" };
    case "recent":
      return { createdFrom: addDaysISO(today, -RECENT_DAYS), sort: "created:desc" };
  }
}

const sameList = (a?: readonly string[], b?: readonly string[]): boolean =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((entry) => (b ?? []).includes(entry));

/**
 * The preset the current state is exactly, or null when the operator has
 * narrowed things by hand. The search box and the page number do not count:
 * typing a name into "Awaiting payment" is still "Awaiting payment".
 */
export function activePreset(state: Partial<BookingFilterState>, today: string): BookingPresetId | null {
  for (const preset of BOOKING_PRESETS) {
    const wanted = presetFilters(preset.id, today);
    const matches = BOOKING_FILTER_KEYS.every((key) => {
      if (key === "search") return true;
      const have = state[key];
      const want = wanted[key];
      if (Array.isArray(have) || Array.isArray(want)) {
        return sameList(Array.isArray(have) ? have : undefined, Array.isArray(want) ? want : undefined);
      }
      return (have ?? undefined) === (want ?? undefined);
    });
    if (matches) return preset.id;
  }
  return null;
}

// --- active chips -------------------------------------------------------------

export interface ActiveFilterChip {
  /** Unique within the row: the key, or `key:value` for one entry of an array. */
  key: string;
  label: string;
  /** What removing the chip clears. */
  clear: { key: BookingFilterKey; value?: string };
}

export interface DescribeFilterOptions {
  /** The register's own status words. */
  statusLabel?: (status: string) => string;
  productLabel?: (product: string) => string;
  /** "Arriving", "Pick-up", "Departing", "Travelling" — the register's date column. */
  dateLabel?: string;
  /** Names for the ids the URL carries, where the screen knows them. */
  partnerName?: string | null;
  customerName?: string | null;
  managerName?: string | null;
  destinationName?: string | null;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const formatDate = (value: string): string => DATE.format(new Date(`${value}T00:00:00Z`));

const rangeLabel = (label: string, from?: string, to?: string): string | null => {
  if (from && to) return `${label} ${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `${label} from ${formatDate(from)}`;
  if (to) return `${label} until ${formatDate(to)}`;
  return null;
};

/**
 * One removable chip per active filter, in the order the keys are listed.
 * A range is one chip (removing it clears both ends); each entry of a
 * multi-select is its own chip; the default sort is not a chip at all.
 */
export function describeFilters(state: Partial<BookingFilterState>, options: DescribeFilterOptions = {}): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  const each = (key: BookingFilterKey, values: readonly string[] | undefined, label: (value: string) => string) => {
    for (const value of values ?? []) chips.push({ key: `${key}:${value}`, label: label(value), clear: { key, value } });
  };

  if (state.search) chips.push({ key: "search", label: `“${state.search}”`, clear: { key: "search" } });
  each("product", state.product, (value) => options.productLabel?.(value) ?? value);
  each("status", state.status, (value) => options.statusLabel?.(value) ?? value);
  if (state.approval) chips.push({ key: "approval", label: approvalFilterLabels[state.approval], clear: { key: "approval" } });
  each("paymentStatus", state.paymentStatus, (value) => `Payment: ${paymentStatusLabels[value as BookingPaymentStatus] ?? value}`);
  each("invoiceStatus", state.invoiceStatus, (value) => `Invoice: ${invoiceStatusLabels[value as InvoiceStatus] ?? value}`);
  if (state.paymentMethod) {
    chips.push({ key: "paymentMethod", label: `Paid by ${paymentMethodLabels[state.paymentMethod].toLowerCase()}`, clear: { key: "paymentMethod" } });
  }
  each("source", state.source, (value) => `Source: ${bookingSourceLabels[value as BookingSource] ?? value}`);
  if (state.partnerId) chips.push({ key: "partnerId", label: `Partner: ${options.partnerName ?? state.partnerId}`, clear: { key: "partnerId" } });
  if (state.customerId) chips.push({ key: "customerId", label: `Customer: ${options.customerName ?? state.customerId}`, clear: { key: "customerId" } });
  if (state.managerId) chips.push({ key: "managerId", label: `Manager: ${options.managerName ?? state.managerId}`, clear: { key: "managerId" } });
  if (state.destinationId) {
    chips.push({ key: "destinationId", label: `Destination: ${options.destinationName ?? state.destinationId}`, clear: { key: "destinationId" } });
  }

  const dates = rangeLabel(options.dateLabel ?? "Dates", state.from, state.to);
  if (dates) chips.push({ key: "dates", label: dates, clear: { key: "from" } });
  const created = rangeLabel("Created", state.createdFrom, state.createdTo);
  if (created) chips.push({ key: "created", label: created, clear: { key: "createdFrom" } });

  if (state.sort && state.sort !== "created:desc") chips.push({ key: "sort", label: sortLabels[state.sort], clear: { key: "sort" } });

  return chips;
}

/**
 * The state after a chip is removed. A date range clears both ends; an array
 * entry leaves its siblings; anything else is simply unset.
 */
export function withoutFilter(state: BookingFilterState, clear: ActiveFilterChip["clear"]): BookingFilterState {
  const next: BookingFilterState = { ...state, page: 1 };
  const { key, value } = clear;

  if (key === "from" || key === "to") {
    delete next.from;
    delete next.to;
  } else if (key === "createdFrom" || key === "createdTo") {
    delete next.createdFrom;
    delete next.createdTo;
  } else if (value !== undefined && Array.isArray(next[key])) {
    const kept = (next[key] as string[]).filter((entry) => entry !== value);
    if (kept.length > 0) Object.assign(next, { [key]: kept });
    else delete next[key];
  } else {
    delete next[key];
  }

  return next;
}

/** Everything cleared but the page size: what "Clear filters" does. */
export const clearedFilters = (): BookingFilterState => ({ page: 1 });

/** The date-range shortcuts beside every pair of date inputs. */
export const DATE_RANGE_PRESETS = [
  { id: "today", label: "Today", days: 0 },
  { id: "week", label: "7 days", days: 7 },
  { id: "month", label: "30 days", days: 30 },
] as const;

export type DateRangePresetId = (typeof DATE_RANGE_PRESETS)[number]["id"];

/**
 * A range starting today: "Today" is one day, "7 days" today and the six
 * after it, "30 days" likewise — forward-looking, because the ranges sit on
 * a service-date column. Created ranges are read backwards by the caller.
 */
export function dateRangeFor(preset: DateRangePresetId, today: string, direction: "forward" | "back" = "forward"): { from: string; to: string } {
  const days = DATE_RANGE_PRESETS.find((entry) => entry.id === preset)?.days ?? 0;
  const span = Math.max(0, days - 1);
  return direction === "forward"
    ? { from: today, to: addDaysISO(today, span) }
    : { from: addDaysISO(today, -span), to: today };
}
