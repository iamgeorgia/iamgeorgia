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
import type { InvoiceKind, InvoiceStatus } from "@/types/invoice";

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

// --- Invoices (Phase 4) -----------------------------------------------------------

export const invoiceKindLabels: Record<InvoiceKind, string> = {
  PROFORMA: "Proforma",
  VAT: "VAT invoice",
  ADVANCE: "Advance invoice",
  FINAL: "Final invoice",
  CORRECTION: "Correction",
};

export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  DRAFT: "Queued",
  ISSUED: "Issued",
  SENT: "Sent",
  PAID: "Paid",
  PARTIAL: "Part paid",
  CANCELLED: "Cancelled",
  ERROR: "Failed",
};

/** Pill tone per status: queued and cancelled neutral, issued and sent informative, paid positive, part paid attention, failed critical. */
export const invoiceStatusTone: Record<InvoiceStatus, "neutral" | "attention" | "positive" | "critical" | "info"> = {
  DRAFT: "neutral",
  ISSUED: "info",
  SENT: "info",
  PAID: "positive",
  PARTIAL: "attention",
  CANCELLED: "neutral",
  ERROR: "critical",
};

/** One sentence on what each status means, for a tooltip or a detail page. */
export const invoiceStatusHints: Record<InvoiceStatus, string> = {
  DRAFT: "Written here and waiting for the invoicing provider to create it. Usually a few seconds.",
  ISSUED: "Created at the provider and numbered. Not yet sent to the buyer.",
  SENT: "Emailed to the buyer by the provider.",
  PAID: "Marked paid at the provider.",
  PARTIAL: "Part of the amount has been recorded against it at the provider.",
  CANCELLED: "Cancelled. A cancelled proforma is replaced by a new one when something is still owed.",
  ERROR: "The provider refused it, or could not be reached. The reason is shown; Retry sends it again.",
};

export const invoiceSourceLabels: Record<string, string> = {
  CONFIRM: "Issued when the booking was confirmed",
  PAYMENT: "Issued when the bill was paid in full",
  CANCELLATION: "Issued after a cancellation or a price change",
  MANUAL: "Issued by hand",
  IMPORT: "Imported from the provider",
};

/** The languages the provider prints in (its own codes; no Georgian or Hebrew). */
export const invoiceLanguageLabels: Record<string, string> = {
  en: "English",
  ru: "Russian",
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pl: "Polish",
  cz: "Czech",
  sk: "Slovak",
  hr: "Croatian",
  nl: "Dutch",
  pt: "Portuguese",
  tr: "Turkish",
  uk: "Ukrainian",
  hu: "Hungarian",
  ro: "Romanian",
  bg: "Bulgarian",
  et: "Estonian",
  lv: "Latvian",
  lt: "Lithuanian",
  sl: "Slovenian",
  sv: "Swedish",
  sr: "Serbian",
  ko: "Korean",
  ee: "Estonian",
  da: "Danish",
  fi: "Finnish",
  no: "Norwegian",
  el: "Greek",
  ar: "Arabic",
  zh: "Chinese",
  ja: "Japanese",
};

export const invoiceLanguageLabel = (code: string) => invoiceLanguageLabels[code] ?? code.toUpperCase();

/** "18%" from basis points; "no VAT" for zero or none. */
export const taxRateLabel = (bps: number | null | undefined) => {
  if (bps === null || bps === undefined) return "no VAT";
  if (bps === 0) return "0%";
  return (bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 }) + "%";
};
