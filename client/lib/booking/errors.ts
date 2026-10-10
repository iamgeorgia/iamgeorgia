import { ApiError } from "@/lib/api/client";
import { formatMoney } from "@/lib/money";
import type { CreditLimitDetails } from "@/types/finance-controls";

/**
 * What went wrong, in terms a traveller can act on.
 *
 * The booking endpoints fail in a small number of ways that each want a
 * different response from the person at the keyboard: a room that has gone
 * wants "choose another", an expired hold wants "pick it again", a price move
 * wants "go back and look". Collapsing all three into "something went wrong"
 * is what makes a checkout feel broken rather than busy.
 *
 * The server carries the distinction in `details.reason`
 * (`services/hotel/availability.service.js`, `search.service.js`); the status
 * alone is not enough, because a 409 is both "sold out" and "price changed".
 */

export type BookingErrorKey =
  | "generic"
  | "soldOut"
  | "holdExpired"
  | "priceChanged"
  | "creditLimit"
  | "termsOutdated"
  | "notFound";

const reasonOf = (error: ApiError): string | null => {
  const details = error.details;

  return details && typeof details === "object" && "reason" in details
    ? String((details as { reason: unknown }).reason)
    : null;
};

export function bookingErrorKey(error: unknown): BookingErrorKey {
  if (!(error instanceof ApiError)) return "generic";

  switch (reasonOf(error)) {
    case "CREDIT_LIMIT_EXCEEDED":
      return "creditLimit";
    // The owner has not accepted the current platform terms yet.
    case "TERMS_OUTDATED":
      return "termsOutdated";
    case "HOLD_EXPIRED":
      return "holdExpired";
    case "PRICE_CHANGED":
      return "priceChanged";
    case "UNAVAILABLE":
    case "ALREADY_COMMITTED":
    case "HOLD_INCONSISTENT":
    // The tour engine's reasons for a departure that cannot be sold to this
    // party right now. From the traveller's side they are all "choose another
    // date": the seats went, the party no longer fits, or the notice window
    // closed while they were deciding.
    case "SOLD_OUT":
    case "PARTY_SIZE":
    case "TOO_SOON":
    case "UNPRICED":
      return "soldOut";
    default:
      break;
  }

  // 410 is only ever an expired hold here. A 404 against a hold or an offer is
  // the same story as a 409 from the guest's side: it was there, now it isn't.
  if (error.status === 410) return "holdExpired";
  if (error.status === 409) return "soldOut";
  if (error.status === 404) return "notFound";

  return "generic";
}

/**
 * The figures in the credit-limit refusal, ready to drop into the
 * `booking.errors.creditLimit` sentence: what the company already owes and
 * what its limit is. Null when the error is not that refusal.
 */
export function creditLimitFigures(error: unknown): { used: string; limit: string } | null {
  if (!(error instanceof ApiError) || reasonOf(error) !== "CREDIT_LIMIT_EXCEEDED") return null;

  const details = error.details as Partial<CreditLimitDetails>;
  const currency = typeof details.currency === "string" ? details.currency : null;
  const show = (cents: unknown) =>
    currency && typeof cents === "number" ? formatMoney(cents, currency) : "—";

  return { used: show(details.outstandingCents), limit: show(details.limitCents) };
}

/** True when re-choosing a room is the only way forward. */
export const needsNewOffer = (key: string): boolean =>
  key === "soldOut" || key === "holdExpired" || key === "priceChanged";

/**
 * A stay the platform will not sell at all, as distinct from one nothing is
 * free for.
 *
 * `search.service.js` refuses four stays outright — a check-in already past,
 * one beyond the booking horizon, a stay longer than the night cap, and a
 * check-out before the check-in — each a 400. Letting those propagate blanks
 * the page; treating them as "no availability" is worse than useless, because
 * shifting the dates by a night is exactly the advice that will not help.
 *
 * Matched on the shape of `details` rather than the message, so the mapping
 * survives the server rewording its own copy.
 */
export type StayWindowIssue = {
  key: "tooFarAhead" | "inThePast" | "tooLong";
  /** The limit the server named: days ahead, or the maximum nights. */
  limit: number;
} | null;

export function stayWindowIssue(error: unknown): StayWindowIssue {
  if (!(error instanceof ApiError) || error.status !== 400) return null;

  const details = error.details;
  if (!details || typeof details !== "object") return null;

  const shape = details as Record<string, unknown>;

  if (typeof shape.limitDays === "number") {
    return { key: "tooFarAhead", limit: shape.limitDays };
  }
  if (typeof shape.limit === "number" && typeof shape.nights === "number") {
    return { key: "tooLong", limit: shape.limit };
  }
  if (typeof shape.today === "string" && typeof shape.checkIn === "string") {
    return { key: "inThePast", limit: 0 };
  }

  return null;
}
