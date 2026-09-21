import type { StayQuery } from "@/types/booking";
import { dateTimeFormat } from "@/lib/intl";

/**
 * The stay a visitor is shopping for: dates, party, room count.
 *
 * This is the one piece of state the whole booking flow agrees on. It lives in
 * the URL rather than in React state, because everything downstream of it is a
 * server render — the search results, the availability on a property page — and
 * because a traveller comparing two hotels expects to be able to open both in
 * tabs and still see the same dates in each.
 *
 * Dates are `YYYY-MM-DD` calendar dates at the property, never instants. They
 * are parsed and read back in UTC, mirroring `server/lib/time.js`: letting the
 * browser's zone touch them is how a stay appears to start a day early for
 * anyone west of Georgia. `lib/admin/dates.ts` keeps the panel's copy of the
 * same convention.
 */

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

export const addDaysISO = (dateOnly: string, days: number): string => {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
};

/** Check-out is exclusive, so this is a subtraction and never an off-by-one. */
export const nightsBetween = (checkIn: string, checkOut: string): number =>
  Math.round(
    (new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) /
      86_400_000,
  );

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isDateOnly = (value: unknown): value is string =>
  typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * A stay the API would accept.
 *
 * The server applies the same rules (`validation/search.js`); checking them
 * here as well is not duplication for its own sake — it is what lets the form
 * say "check-out must be after check-in" instead of round-tripping to a 400.
 */
export function isValidStay(stay: StayQuery | null): stay is StayQuery {
  if (!stay) return false;
  if (!isDateOnly(stay.checkIn) || !isDateOnly(stay.checkOut)) return false;
  if (stay.checkOut <= stay.checkIn) return false;
  if (!Number.isInteger(stay.adults) || stay.adults < 1 || stay.adults > 30) return false;
  if ((stay.childAges ?? []).some((age) => !Number.isInteger(age) || age < 0 || age > 17)) {
    return false;
  }
  const rooms = stay.rooms ?? 1;

  return Number.isInteger(rooms) && rooms >= 1 && rooms <= 9;
}

/** Tomorrow, for two nights, two adults — what an empty search box means. */
export function defaultStay(): StayQuery {
  const checkIn = addDaysISO(todayISO(), 1);

  return { checkIn, checkOut: addDaysISO(checkIn, 2), adults: 2, childAges: [], rooms: 1 };
}

type ParamValue = string | string[] | undefined;
export type RawSearchParams = Record<string, ParamValue>;

const first = (value: ParamValue): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const asList = (value: ParamValue): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/**
 * Reads a stay out of URL search params.
 *
 * Returns `null` when there are no dates at all — that is a visitor browsing
 * the catalogue, not a failed search, and the difference decides which page
 * they get. A malformed stay is also `null` rather than an error: a stale
 * bookmark should show the search form, not a crash.
 */
export function stayFromParams(params: RawSearchParams): StayQuery | null {
  const checkIn = first(params.checkIn);
  const checkOut = first(params.checkOut);

  if (!checkIn && !checkOut) return null;

  const adults = Number.parseInt(first(params.adults) ?? "2", 10);
  const rooms = Number.parseInt(first(params.rooms) ?? "1", 10);

  const stay: StayQuery = {
    checkIn: checkIn ?? "",
    checkOut: checkOut ?? "",
    adults: Number.isFinite(adults) ? adults : 2,
    childAges: asList(params.childAges)
      .map((age) => Number.parseInt(age, 10))
      .filter((age) => Number.isInteger(age)),
    rooms: Number.isFinite(rooms) ? rooms : 1,
  };

  return isValidStay(stay) ? stay : null;
}

/**
 * Back to query parameters.
 *
 * `childAges` stays an array so `toQueryString` repeats it — one age per child
 * is what lets the server price a room rather than guess at it.
 */
export function stayToParams(stay: StayQuery): {
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
  rooms: number;
} {
  return {
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    adults: stay.adults,
    childAges: stay.childAges ?? [],
    rooms: stay.rooms ?? 1,
  };
}

/** A stay as a query string, for building an href. */
export const stayQueryString = (stay: StayQuery): string => {
  const params = new URLSearchParams();
  const { checkIn, checkOut, adults, childAges, rooms } = stayToParams(stay);

  params.set("checkIn", checkIn);
  params.set("checkOut", checkOut);
  params.set("adults", String(adults));
  params.set("rooms", String(rooms));
  for (const age of childAges) params.append("childAges", String(age));

  return `?${params.toString()}`;
};

/** Everyone the party contains, however they are priced. */
export const partySize = (stay: StayQuery): number => stay.adults + (stay.childAges?.length ?? 0);

// --- display ----------------------------------------------------------------

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (intlLocale: string, options: Intl.DateTimeFormatOptions) => {
  const key = `${intlLocale}:${JSON.stringify(options)}`;
  let cached = dateFormatters.get(key);

  if (!cached) {
    // timeZone: UTC for the same reason the parsing is — these are calendar
    // dates, and a formatter in the reader's zone would shift them.
    cached = new Intl.DateTimeFormat(intlLocale, { ...options, timeZone: "UTC" });
    dateFormatters.set(key, cached);
  }

  return cached;
};

/** "4 Jun 2027" in the reader's language. */
export const formatStayDate = (dateOnly: string, intlLocale = "en-GB"): string =>
  formatterFor(intlLocale, { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${dateOnly}T00:00:00Z`),
  );

/** "Fri 4 Jun" — for a nightly breakdown, where the year is noise. */
export const formatNightDate = (dateOnly: string, intlLocale = "en-GB"): string =>
  formatterFor(intlLocale, { weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${dateOnly}T00:00:00Z`),
  );

/** An actual instant — a hold expiry, a cancellation deadline. */
export const formatInstant = (value: string | null | undefined, intlLocale = "en-GB"): string =>
  value
    ? dateTimeFormat(intlLocale, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
