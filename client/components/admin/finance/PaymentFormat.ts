import { productLabels } from "@/lib/admin/finance";
import { ApiError, describeError } from "@/lib/api/client";
import type { Payment, Receivable, SettlementSubject } from "@/types/finance";

/**
 * Small helpers the receivables and payments screens share.
 *
 * Dates are read and written in Tbilisi time: every operator works there,
 * and one fixed zone means the server render and the browser print the same
 * day. Georgia has kept UTC+4 without daylight saving since 2005, which is
 * what lets a calendar day become an instant with a fixed offset.
 */

export const FINANCE_TIME_ZONE = "Asia/Tbilisi";
const OFFSET = "+04:00";

/** The currencies offered in filters and forms. A record's own is always added. */
export const FINANCE_CURRENCIES = ["GEL", "USD", "EUR"] as const;

export const currencyOptions = (extra?: string | null) => {
  const codes = new Set<string>(FINANCE_CURRENCIES);
  if (extra) codes.add(extra);
  return [...codes].map((code) => ({ value: code, label: code }));
};

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: FINANCE_TIME_ZONE,
});

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: FINANCE_TIME_ZONE,
});

/** `en-CA` prints `YYYY-MM-DD`, which is what a date input wants. */
const DAY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: FINANCE_TIME_ZONE,
});

const parse = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** "8 Oct 2026", Tbilisi time. */
export const formatFinanceDate = (value: string | null | undefined) => {
  const parsed = parse(value);
  return parsed ? DATE.format(parsed) : "—";
};

/** "8 Oct 2026, 14:32", Tbilisi time. */
export const formatFinanceDateTime = (value: string | null | undefined) => {
  const parsed = parse(value);
  return parsed ? DATE_TIME.format(parsed) : "—";
};

/** The Tbilisi calendar day of an instant (today when none), as `YYYY-MM-DD`. */
export const tbilisiDay = (value?: string | null) => DAY.format(parse(value) ?? new Date());

/** Midday on a Tbilisi day — when a payment "paid on" that day is recorded. */
export const middayOf = (day: string) => `${day}T12:00:00${OFFSET}`;

/** The end of a Tbilisi working day — when a moved due date falls. */
export const dueEndOf = (day: string) => `${day}T23:59:00${OFFSET}`;

/** First and last instant of a Tbilisi day, for a date-range filter. */
export const startOfDay = (day: string) => new Date(`${day}T00:00:00.000${OFFSET}`).toISOString();
export const endOfDay = (day: string) => new Date(`${day}T23:59:59.999${OFFSET}`).toISOString();

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` that is a real calendar day, or undefined. */
export const calendarDay = (value: string | undefined) => {
  if (!value || !DAY_PATTERN.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : undefined;
};

/** What a settlement is for: "Hotel · HB-2026-00123", or "Order · ORD-…". */
export const subjectLine = (subject: SettlementSubject | null) => {
  if (!subject) return null;
  const kind = subject.kind === "ORDER" ? "Order" : productLabels[subject.kind];
  return `${kind} · ${subject.reference}`;
};

export const receivableSubjectLine = (receivable: Receivable) => subjectLine(receivable.subject);

/** Who owes it: the agency, or the guest who booked without an account. */
export const receivableDebtorName = (receivable: Receivable) =>
  receivable.debtor.partner?.name ?? (receivable.debtor.name || receivable.debtor.email || "Guest");

/** Who the money came from or went to. */
export const counterpartyName = (payment: Payment) =>
  payment.counterparty.partner?.name ?? (payment.counterparty.name || payment.counterparty.email || "—");

/**
 * What to say when the server refuses a money movement. The server's own
 * sentence is kept for anything not listed; these few get a sentence that
 * says what to do next.
 */
const reasonMessages: Record<string, string> = {
  ALLOCATION_EXCEEDS_OUTSTANDING: "That is more than the item can take. Lower the amount, or leave the extra unallocated.",
  ALLOCATIONS_EXCEED_PAYMENT: "The amounts to settle add up to more than the payment.",
  CURRENCY_MISMATCH: "A payment can only settle items in its own currency.",
  WRONG_TARGET: "Money in from a buyer settles receivables; money out to a supplier settles supplier instalments.",
  NOT_SETTLEABLE: "That item is no longer open — it may have been paid or written off meanwhile. Reload the page.",
  IDEMPOTENCY_KEY_REUSED: "This form was already used to record a different payment. Close it and open it again.",
  APPROVAL_REQUIRED: "This needs a second person to approve it. Close this and use Ask for approval instead.",
  COUNTERPARTY_REQUIRED: "Say who the money came from or went to: choose a partner, or enter a name.",
};

export const financeErrorMessage = (error: unknown) => {
  if (error instanceof ApiError) {
    const reason = (error.details as { reason?: string } | null | undefined)?.reason;
    if (reason && reasonMessages[reason]) return reasonMessages[reason];
  }
  return describeError(error);
};
