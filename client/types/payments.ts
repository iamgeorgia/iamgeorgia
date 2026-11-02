/**
 * Card payments through Flitt, as the guest-facing API returns them.
 *
 * Mirrors `GET/POST /api/payments`. No amount is ever sent by the client; the
 * amounts here are what the server decided to charge.
 */

import type { PaymentTiming } from "./catalogue";

export type PspPaymentStatus =
  | "CREATED"
  | "REDIRECT_READY"
  | "PROCESSING"
  | "APPROVED"
  | "DECLINED"
  | "EXPIRED"
  | "CANCELLED"
  | "FAILED"
  | "MISMATCH"
  | "REVERSED";

/** Statuses in which the gateway may still answer; the result page polls while in one. */
export const OPEN_PAYMENT_STATUSES: readonly PspPaymentStatus[] = ["CREATED", "REDIRECT_READY", "PROCESSING"];

export type PaymentBookingType = "HOTEL" | "TOUR" | "TRANSFER" | "ORDER" | string;

export interface GuestPayment {
  id: string;
  /** "PAY-000012" */
  reference: string;
  status: PspPaymentStatus;
  mode: "TEST" | "LIVE";
  provider: string;
  amountCents: number;
  currency: string;
  bookingReference: string;
  bookingType: PaymentBookingType;
  maskedCard: string | null;
  cardType: string | null;
  paymentSystem: string | null;
  responseCode: number | string | null;
  responseDescription: string | null;
  /** Only while the payment is open. */
  checkoutUrl: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  createdAt: string;
  canRetry: boolean;
  receivable: {
    status: string;
    amountCents: number;
    paidCents: number;
    autoCancelAt: string | null;
  } | null;
  /** Create and retry only. */
  token?: string;
  reused?: boolean;
}

export interface PaymentSettings {
  enabled: boolean;
  provider: "FLITT";
  mode: "TEST" | "LIVE" | null;
}

export type CheckoutRuleParams = {
  hotelHold?: string[];
  tourHold?: string[];
  vehicleId?: string[];
  packageSlug?: string[];
};

// --- Staff side (admin panel) ------------------------------------------------

export type PspRefundStatus = "REQUESTED" | "SUBMITTED" | "APPROVED" | "DECLINED" | "FAILED";

/** One refund attempt through the gateway, as staff see it. */
export interface PspRefund {
  id: string;
  status: PspRefundStatus;
  amountCents: number;
  currency: string;
  reverseId: string | null;
  reason: string | null;
  approvalRequestId: string | null;
  paymentRecordId: string | null;
  responseCode: number | string | null;
  responseDescription: string | null;
  attempts: number;
  lastError: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** One inbound gateway callback, kept whether or not it was believed. */
export interface PspCallbackEvent {
  id: string;
  receivedAt: string;
  processedAt: string | null;
  signatureValid: boolean;
  orderStatus: string | null;
  sourceIp: string | null;
  error: string | null;
  payload: unknown;
}

export interface StaffPaymentReceivable {
  id: string;
  reference: string;
  status: string;
  currency: string;
  amountCents: number;
  paidCents: number;
  debtorEmail: string | null;
  debtorName: string | null;
  debtorPartnerId: string | null;
  paymentTiming: string | null;
  autoCancelAt: string | null;
  autoCancelledAt: string | null;
}

export interface StaffPayment {
  id: string;
  reference: string;
  status: PspPaymentStatus;
  mode: "TEST" | "LIVE";
  provider: string;
  amountCents: number;
  currency: string;
  bookingReference: string | null;
  /** Null for an order. */
  bookingType: "HOTEL" | "TOUR" | "TRANSFER" | "SERVICE" | null;
  debtorEmail: string | null;
  receivableId: string | null;
  actualAmountCents: number | null;
  actualCurrency: string | null;
  reversedCents: number;
  refundableCents: number;
  merchantOrderId: string | null;
  providerPaymentId: string | null;
  providerTransactionId: string | null;
  providerOrderStatus: string | null;
  providerOrderTime: string | null;
  responseCode: number | string | null;
  responseDescription: string | null;
  maskedCard: string | null;
  cardType: string | null;
  cardBin: string | null;
  paymentSystem: string | null;
  approvalCode: string | null;
  rrn: string | null;
  eci: string | null;
  paymentRecordId: string | null;
  paymentRecord: { id: string; paidAt: string; amountCents: number } | null;
  checkoutUrl: string | null;
  lang: string | null;
  lifetimeSeconds: number | null;
  expiresAt: string | null;
  redirectReadyAt: string | null;
  returnedAt: string | null;
  lastCallbackAt: string | null;
  lastStatusCheckAt: string | null;
  completedAt: string | null;
  reconciledAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  receivable?: StaffPaymentReceivable | null;
  /** Detail only. */
  callbacks?: PspCallbackEvent[];
  refunds?: PspRefund[];
}

/** `GET /api/admin/payments/settings`. */
export interface PaymentsSettings {
  enabled: boolean;
  provider: "FLITT";
  mode: "TEST" | "LIVE" | null;
  merchantId: string | null;
  apiBaseUrl: string | null;
  callbackUrl: string | null;
  currencies: string[];
  orderLifetimeSeconds: number | null;
}

export interface CardPaymentQuery {
  status?: PspPaymentStatus;
  mode?: "TEST" | "LIVE";
  q?: string;
  from?: string;
  to?: string;
  attention?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CardPaymentList {
  data: StaffPayment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type PaymentPolicyProductKind = "TOUR" | "TRANSFER" | "PACKAGE";

export interface PaymentPolicyInput {
  productKind: PaymentPolicyProductKind;
  name: string;
  timing: PaymentTiming;
  depositBps?: number | null;
  balanceDueDaysBeforeCheckIn?: number | null;
  unpaidCancelHours?: number | null;
  cardOptional?: boolean;
  description?: string | null;
  isActive?: boolean;
}
