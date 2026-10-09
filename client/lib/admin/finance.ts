import type {
  AgeingBucket,
  CancellationLiability,
  FinanceProduct,
  InstalmentKind,
  MilestoneAnchor,
  PaymentDirection,
  PaymentKind,
  PaymentMethod,
  SettlementStatus,
  SettlementSubject,
} from "@/types/finance";

/**
 * Wording and small helpers for the finance screens, in one place so the
 * payables, receivables, payments and reports screens say the same thing the
 * same way. Money formatting is `formatMoney` from `lib/money.ts`; nothing
 * here adds amounts in different currencies.
 */

export const settlementStatusLabels: Record<SettlementStatus, string> = {
  OPEN: "Open",
  PARTIAL: "Part paid",
  PAID: "Paid",
  VOID: "Nothing owed",
  WAIVED: "Written off",
};

/** Pill tone per status, in the admin's existing tone names. */
export const settlementStatusTone: Record<SettlementStatus, "neutral" | "attention" | "positive" | "critical" | "info"> = {
  OPEN: "info",
  PARTIAL: "attention",
  PAID: "positive",
  VOID: "neutral",
  WAIVED: "neutral",
};

export const productLabels: Record<FinanceProduct, string> = {
  HOTEL: "Hotel",
  TRANSFER: "Transfer",
  TOUR: "Tour",
  SERVICE: "Service",
};

export const instalmentKindLabels: Record<InstalmentKind, string> = {
  DEPOSIT: "Deposit",
  BALANCE: "Balance",
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  CARD: "Card",
  OTHER: "Other",
};

/** A payment described from our side: what it was and which way it went. */
export const paymentKindLabel = (direction: PaymentDirection, kind: PaymentKind): string => {
  if (kind === "REFUND") return direction === "OUT" ? "Refund to a buyer" : "Refund from a supplier";
  return direction === "IN" ? "Received" : "Paid to a supplier";
};

export const cancellationLiabilityLabels: Record<CancellationLiability, string> = {
  PROPORTIONAL: "Same share of the net",
  NONE_UNLESS_NON_REFUNDABLE: "Nothing unless non-refundable",
  MANUAL: "Decide by hand",
};

export const cancellationLiabilityHints: Record<CancellationLiability, string> = {
  PROPORTIONAL: "If the buyer is charged 50% on cancellation, the supplier is owed 50% of the net.",
  NONE_UNLESS_NON_REFUNDABLE: "A cancellation clears what the supplier is owed, unless the booking was charged in full.",
  MANUAL: "Each cancelled booking is flagged for Finance to set the amount by hand.",
};

export const milestoneAnchorLabels: Record<MilestoneAnchor, string> = {
  CONFIRMATION: "confirmation",
  ARRIVAL: "arrival",
  DEPARTURE: "departure",
};

export const reviewReasonLabels: Record<string, string> = {
  NO_TERMS: "No payment terms for this supplier",
  CANCELLATION_MANUAL: "Cancelled — amount to be set by hand",
};

export const ageingBucketLabels: Record<AgeingBucket, string> = {
  current: "Not yet due",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "Over 90 days",
};

/**
 * Where the booking or order behind a settlement lives in the admin panel, by
 * reference. Service bookings have no page of their own yet, so they have no
 * link; the reference is still shown.
 */
export const subjectHref = (subject: SettlementSubject | null): string | null => {
  if (!subject) return null;

  switch (subject.kind) {
    case "HOTEL":
      return `/admin/bookings/${subject.reference}`;
    case "TRANSFER":
      return `/admin/transfers/bookings/${subject.reference}`;
    case "TOUR":
      return `/admin/tours/bookings/${subject.reference}`;
    case "SERVICE":
      return null;
    case "ORDER":
      return `/admin/orders/${subject.reference}`;
    default:
      return null;
  }
};

/** "In 3 days", "Today", "5 days late" — for a due date, from a fixed `now`. */
export const dueInWords = (dueAt: string | null, now: Date = new Date()): string | null => {
  if (!dueAt) return null;
  const days = Math.round((new Date(dueAt).getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days > 0) return days === 1 ? "Tomorrow" : `In ${days} days`;
  return days === -1 ? "1 day late" : `${-days} days late`;
};
