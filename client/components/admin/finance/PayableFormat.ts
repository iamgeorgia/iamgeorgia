import type { PayableQuery } from "@/lib/api/finance";
import type { FinanceProduct, Payable, SettlementStatus } from "@/types/finance";

/**
 * Small helpers the payables screens share between the Server Component pages
 * and the client browser and actions. Plain TypeScript, no "use client", so a
 * page can call them during its render and a client component can import them
 * without dragging anything server-only along.
 */

/** The panel's working timezone, for a payable that somehow arrives without one. */
const FALLBACK_TIME_ZONE = "Asia/Tbilisi";

/**
 * The status chips. `unsettled` is not a server status: it asks for OPEN and
 * PARTIAL together — everything that still has money to go out.
 */
export const PAYABLE_STATUS_FILTERS = ["unsettled", "OPEN", "PARTIAL", "PAID", "VOID", "WAIVED"] as const;
export type PayableStatusFilter = (typeof PAYABLE_STATUS_FILTERS)[number];

export const PAYABLE_PRODUCTS: FinanceProduct[] = ["HOTEL", "TRANSFER", "TOUR", "SERVICE"];

/** The currencies the platform sells in. Amounts in different ones are never added. */
export const PAYABLE_CURRENCIES = ["GEL", "USD", "EUR"] as const;

export const UNSETTLED: SettlementStatus[] = ["OPEN", "PARTIAL"];

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Reads the list's filters out of the URL. Unknown values are dropped rather
 * than sent on, so a stale bookmark shows everything instead of a 400.
 */
export function payableQueryFromParams(params: Record<string, string | string[] | undefined>): PayableQuery {
  const status = single(params.status);
  const product = single(params.product);
  const currency = single(params.currency);
  const page = Number(single(params.page));

  return {
    q: single(params.q)?.trim() || undefined,
    status:
      status === "unsettled"
        ? UNSETTLED
        : (PAYABLE_STATUS_FILTERS as readonly string[]).includes(status ?? "")
          ? (status as SettlementStatus)
          : undefined,
    product: PAYABLE_PRODUCTS.includes(product as FinanceProduct) ? (product as FinanceProduct) : undefined,
    currency: (PAYABLE_CURRENCIES as readonly string[]).includes(currency ?? "") ? currency : undefined,
    needsReview: single(params.review) === "1" ? "true" : undefined,
    supplierPartnerId: single(params.platform) === "1" ? "PLATFORM" : undefined,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: 20,
  };
}

/** A due date or payment date as a calendar day in the payable's own timezone. */
export function formatPayableDate(value: string | null | undefined, timeZone = FALLBACK_TIME_ZONE): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timeZone || FALLBACK_TIME_ZONE,
  }).format(parsed);
}

/** Today as `YYYY-MM-DD` in Tbilisi — the default for a "paid on" date field. */
export const todayInTbilisi = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: FALLBACK_TIME_ZONE,
  }).format(new Date());

/**
 * A date field's day as the instant the server wants. Midday Tbilisi, so the
 * day cannot slip either way whatever timezone the server reports in.
 */
export const paidOnToInstant = (date: string): string => `${date}T12:00:00+04:00`;

/** Still has money to go out, and the next instalment's date has passed. */
export const isPayableLate = (payable: Pick<Payable, "nextDueAt" | "status">, now: Date = new Date()): boolean =>
  Boolean(payable.nextDueAt) &&
  UNSETTLED.includes(payable.status) &&
  new Date(payable.nextDueAt!).getTime() < now.getTime();
