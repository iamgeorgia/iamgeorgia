/**
 * Card payments through Flitt, as the guest-facing API returns them.
 *
 * Mirrors `GET/POST /api/payments`. No amount is ever sent by the client; the
 * amounts here are what the server decided to charge.
 */

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
