/**
 * Finance types. Mirror `server/serializers/finance.js` exactly.
 *
 * Every amount is integer minor units in the record's own `currency`; nothing
 * in the API ever adds two currencies together, and nothing here should.
 * `outstandingCents` and `refundDueCents` are computed by the server — read
 * them, never recompute them.
 */

export type SettlementStatus = "OPEN" | "PARTIAL" | "PAID" | "VOID" | "WAIVED";
export type FinanceProduct = "HOTEL" | "TRANSFER" | "TOUR" | "SERVICE";
export type InstalmentKind = "DEPOSIT" | "BALANCE";
export type CancellationLiability = "PROPORTIONAL" | "NONE_UNLESS_NON_REFUNDABLE" | "MANUAL";
export type PaymentDirection = "IN" | "OUT";
export type PaymentKind = "PAYMENT" | "REFUND";
export type PaymentMethod = "BANK_TRANSFER" | "CASH" | "CARD" | "OTHER";
export type MilestoneAnchor = "CONFIRMATION" | "ARRIVAL" | "DEPARTURE";
export type ReceivableDueAnchor = "CONFIRMATION" | "ARRIVAL";

export interface PartnerRef {
  id: string;
  name: string;
  reference: string | null;
}

/** The booking (or order) a settlement belongs to — enough to link to it. */
export interface SettlementSubject {
  kind: FinanceProduct | "ORDER";
  id: string;
  reference: string;
  status: string;
}

export interface Allocation {
  id: string;
  /** Negative for a refund. */
  amountCents: number;
  createdAt: string;
  payment?: {
    id: string;
    direction: PaymentDirection;
    kind: PaymentKind;
    method: PaymentMethod;
    reference: string | null;
    paidAt: string;
  };
  receivable?: { id: string; reference: string; debtorName: string };
  instalment?: {
    id: string;
    sequence: number;
    kind: InstalmentKind;
    payableId: string | null;
    bookingReference: string | null;
    product: FinanceProduct | null;
  };
}

export interface Instalment {
  id: string;
  sequence: number;
  kind: InstalmentKind;
  originalAmountCents: number;
  amountCents: number;
  paidCents: number;
  outstandingCents: number;
  status: SettlementStatus;
  dueAt: string | null;
  overdue: boolean;
  allocations?: Allocation[];
}

export interface Payable {
  id: string;
  product: FinanceProduct;
  booking: SettlementSubject | null;
  bookingReference: string;
  /** Null for inventory the platform owns itself. */
  supplier: PartnerRef | null;
  currency: string;
  originalAmountCents: number;
  amountCents: number;
  paidCents: number;
  outstandingCents: number;
  refundDueCents: number;
  status: SettlementStatus;
  nextDueAt: string | null;
  needsReview: boolean;
  reviewReason: "NO_TERMS" | "CANCELLATION_MANUAL" | string | null;
  amountOverrideCents: number | null;
  overrideReason: string | null;
  cancellationLiability: CancellationLiability | null;
  source: "CONFIRM" | "BACKFILL" | "MANUAL" | string;
  notes: string | null;
  timezone: string;
  voidedAt: string | null;
  waivedAt: string | null;
  createdAt: string;
  instalments: Instalment[];
}

export interface Receivable {
  id: string;
  reference: string;
  subject: SettlementSubject | null;
  debtor: { partner: PartnerRef | null; name: string; email: string };
  currency: string;
  originalAmountCents: number;
  amountCents: number;
  paidCents: number;
  outstandingCents: number;
  refundDueCents: number;
  status: SettlementStatus;
  dueAt: string | null;
  overdue: boolean;
  source: string;
  notes: string | null;
  voidedAt: string | null;
  waivedAt: string | null;
  createdAt: string;
  allocations?: Allocation[];
}

/** An instalment in the "payments due" queue, with enough of its payable to say whose money it is. */
export interface DueInstalment extends Instalment {
  currency: string;
  payable: {
    id: string;
    product: FinanceProduct;
    bookingReference: string;
    supplier: PartnerRef | null;
    currency: string;
    timezone: string;
    status: SettlementStatus;
  };
}

export interface DueTotals {
  overdue: number;
  due: number;
  /** Outstanding per currency, in minor units. Never summed across currencies. */
  outstandingByCurrency: Record<string, number>;
}

/** `GET /admin/finance/due`: what is overdue and what falls due within `days`. A side the viewer may not read is null. */
export interface PaymentsDue {
  days: number;
  asOf: string;
  horizon: string;
  instalments: DueInstalment[] | null;
  receivables: Receivable[] | null;
  totals: { instalments: DueTotals | null; receivables: DueTotals | null };
}

export interface Payment {
  id: string;
  direction: PaymentDirection;
  kind: PaymentKind;
  method: PaymentMethod;
  counterparty: { partner: PartnerRef | null; name: string | null; email: string | null };
  currency: string;
  amountCents: number;
  allocatedCents: number;
  unallocatedCents: number;
  reference: string | null;
  paidAt: string;
  note: string | null;
  reason: string | null;
  recordedBy: { id: string; email: string; fullName: string } | null;
  attachment: { id: string; name: string; mimeType: string } | null;
  createdAt: string;
  allocations: Allocation[];
}

export interface AllocationInput {
  receivableId?: string;
  payableInstalmentId?: string;
  amountCents: number;
}

export interface RecordPaymentInput {
  direction: PaymentDirection;
  kind?: PaymentKind;
  method: PaymentMethod;
  currency: string;
  amountCents: number;
  /** ISO instant. */
  paidAt: string;
  reference?: string;
  note?: string;
  /** Required for a refund. */
  reason?: string;
  counterpartyPartnerId?: string;
  counterpartyName?: string;
  counterpartyEmail?: string;
  attachmentAssetId?: string;
  allocations?: AllocationInput[];
  allocate?: { mode: "OLDEST_DUE"; partnerId: string };
}

export interface PayInstalmentInput {
  method: PaymentMethod;
  paidAt: string;
  amountCents?: number;
  reference?: string;
  note?: string;
  attachmentAssetId?: string;
}

export interface AdjustPayableInput {
  /** Finance's own figure; null hands the amount back to the supplier's rules. */
  amountOverrideCents?: number | null;
  waive?: true;
  notes?: string | null;
  reason: string;
}

export interface AdjustReceivableInput {
  dueAt?: string | null;
  waive?: true;
  notes?: string | null;
  reason: string;
}

export type Milestone =
  | {
      kind: "DEPOSIT";
      basis: "PERCENT" | "FIXED";
      /** Basis points for PERCENT (3000 = 30%), minor units for FIXED. */
      value: number;
      anchor: MilestoneAnchor;
      offsetDays: number;
    }
  | { kind: "BALANCE"; anchor: MilestoneAnchor; offsetDays: number };

export interface SupplierTerms {
  id: string | null;
  milestones: Milestone[];
  cancellationLiability: CancellationLiability;
  cutoffTime: string | null;
  notes: string | null;
  /** True when nothing is saved and these are the defaults that apply. */
  isDefault: boolean;
  updatedAt: string | null;
}

export type SupplierTermsKind = "hotels" | "transfer-providers" | "tours" | "services";

export interface PartnerTerms {
  id: string;
  paymentDueDays: number;
  paymentDueAnchor: ReceivableDueAnchor;
  paymentTermsNote: string | null;
}

export interface FinanceSummary {
  from: string;
  to: string;
  currencies: {
    currency: string;
    receivables: { openCount: number; openCents: number; overdueCents: number; refundDueCents: number };
    payables: { openCount: number; openCents: number; overdueCents: number; dueThisWeekCents: number; needsReviewCount: number };
    cash: { inCents: number; outCents: number; refundsOutCents: number; refundsInCents: number };
  }[];
}

export interface MarginReport {
  from: string;
  to: string;
  groupBy: "product" | "supplier" | "partner";
  rows: {
    key: string;
    label: string;
    currency: string;
    bookings: number;
    revenueCents: number;
    costCents: number;
    marginCents: number;
    marginBps: number | null;
  }[];
}

export type AgeingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export interface AgeingReport {
  side: "receivables" | "payables";
  asOf: string;
  buckets: AgeingBucket[];
  rows: ({ key: string; label: string; currency: string; totalCents: number } & Record<AgeingBucket, number>)[];
}

/** The partner portal's view of what the agency owes. */
export interface PartnerStatement {
  balances: { currency: string; outstandingCents: number; overdueCents: number; creditCents: number }[];
  data: {
    id: string;
    reference: string;
    subject: SettlementSubject | null;
    currency: string;
    amountCents: number;
    paidCents: number;
    outstandingCents: number;
    refundDueCents: number;
    status: SettlementStatus;
    dueAt: string | null;
    overdue: boolean;
    createdAt: string;
    payments: { amountCents: number; paidAt: string | null; method: PaymentMethod | null; reference: string | null }[];
  }[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** A supplier's view of what we owe it. */
export interface SupplierStatementPayable {
  id: string;
  product: FinanceProduct;
  bookingReference: string;
  currency: string;
  amountCents: number;
  paidCents: number;
  outstandingCents: number;
  status: SettlementStatus;
  nextDueAt: string | null;
  createdAt: string;
  instalments: { sequence: number; kind: InstalmentKind; amountCents: number; paidCents: number; status: SettlementStatus; dueAt: string | null }[];
}
