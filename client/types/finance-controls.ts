import type { FinanceProduct } from "./finance";

/**
 * Credit limits, cancellation penalties and the commission report. Mirrors the
 * finance routes in `server/routes/admin.finance.routes.js` and
 * `partner.finance.routes.js`. Money is integer minor units beside a currency.
 */

export type PenaltyProduct = FinanceProduct;

export interface Penalty {
  id: string;
  bookingType: PenaltyProduct;
  bookingId: string;
  /** The booking's reference. */
  reference: string;
  partner: { id: string; name: string; reference: string } | null;
  currency: string;
  /** What the policy charged. */
  chargeCents: number;
  /** What finance agreed to charge instead; null when the policy's figure stands. */
  overrideCents: number | null;
  overrideReason: string | null;
  /** What is actually charged: the override when there is one. */
  effectiveCents: number;
  /** The approval request behind the override, if any. */
  approvalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreditMode = "BLOCK" | "WARN";

export interface CreditPosition {
  /** Null means no limit. */
  limitCents: number | null;
  currency: string | null;
  mode: CreditMode;
  outstandingCents: number | null;
  availableCents: number | null;
}

export interface SetCreditInput {
  /** Null clears the limit. */
  creditLimitCents: number | null;
  creditLimitCurrency?: string;
  creditLimitMode?: CreditMode;
}

export interface CommissionRow {
  key: string;
  label: string;
  currency: string;
  bookings: number;
  sellCents: number;
  netCents: number;
  commissionCents: number;
  /** What the commission came to as a share of what was sold; null with nothing sold. */
  commissionBps: number | null;
  /** The agreed rate, or the lowest and highest where it varied. */
  rateBps: number | { min: number; max: number } | null;
}

export interface CommissionReport {
  from: string;
  to: string;
  groupBy: "partner" | "product";
  rows: CommissionRow[];
}

/** The 422 detail when a booking would take a partner past its credit limit. */
export interface CreditLimitDetails {
  reason: "CREDIT_LIMIT_EXCEEDED";
  limitCents: number;
  outstandingCents: number;
  requestedCents: number;
  currency: string;
}
