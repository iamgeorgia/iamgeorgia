import { apiFetch, serverFetch } from "./client";
import { toQueryString } from "./query";
import type { CheckoutPaymentRule, PaymentPolicy } from "@/types/catalogue";
import type {
  CardPaymentList,
  CardPaymentQuery,
  CheckoutRuleParams,
  GuestPayment,
  PaymentPolicyInput,
  PaymentPolicyProductKind,
  PaymentSettings,
  PaymentsSettings,
  PspPaymentStatus,
  StaffPayment,
} from "@/types/payments";

/**
 * Guest card payments (Flitt).
 *
 * Nothing here sends an amount: the server charges the receivable's
 * outstanding balance, whatever the browser believes it is.
 */

export const getPaymentSettings = () => apiFetch<PaymentSettings>("/api/payments/settings");

/** What the checkout may offer for the items held: card, pay later, or card only. */
export const getCheckoutRule = (params: CheckoutRuleParams) =>
  apiFetch<CheckoutPaymentRule>(`/api/payments/rules${toQueryString(params)}`);

/**
 * Opens (or reuses) a card payment for a booking the guest just made.
 * The email is the guest's proof of ownership; the key makes a retry return the
 * same attempt instead of opening a second.
 */
export const createPayment = (input: {
  reference: string;
  email: string;
  locale?: string;
  idempotencyKey: string;
}) =>
  apiFetch<GuestPayment>("/api/payments", {
    method: "POST",
    body: { reference: input.reference, email: input.email, locale: input.locale },
    headers: { "idempotency-key": input.idempotencyKey },
  });

/** Browser read, used by the result page's polling. Re-asks the gateway while open. */
export const getPayment = (id: string, token: string) =>
  apiFetch<GuestPayment>(`/api/payments/${id}${toQueryString({ t: token })}`);

/** Server-component read. */
export const getPaymentServer = (id: string, token: string) =>
  serverFetch<GuestPayment>(`/api/payments/${id}${toQueryString({ t: token })}`);

/** A new attempt after a declined, expired, cancelled or failed one. */
export const retryPayment = (id: string, token: string, locale?: string) =>
  apiFetch<GuestPayment>(`/api/payments/${id}/retry${toQueryString({ t: token })}`, {
    method: "POST",
    body: { locale },
  });

// --- Staff side (admin panel) ------------------------------------------------

/** Server-component read; any staff member may ask. */
export const getPaymentsSettings = () => serverFetch<PaymentsSettings>("/api/admin/payments/settings");

export const listCardPayments = (query: CardPaymentQuery = {}) =>
  serverFetch<CardPaymentList>(`/api/admin/payments${toQueryString(query)}`);

export const getCardPayment = (id: string) => serverFetch<StaffPayment>(`/api/admin/payments/${id}`);

/** Asks the gateway now and applies the answer through the one transition function. */
export const checkCardPaymentStatus = (id: string) =>
  apiFetch<{ status: PspPaymentStatus; changed: boolean; stale?: boolean; payment: StaffPayment }>(
    `/api/admin/payments/${id}/check-status`,
    { method: "POST" },
  );

/** Opens a refund approval; the money moves only after a second person approves it. */
export const requestCardRefund = (id: string, body: { amountCents: number; reason: string; note?: string }) =>
  apiFetch<{ id: string; reference: string }>(`/api/admin/payments/${id}/refunds`, {
    method: "POST",
    body,
  });

export const listPaymentPolicyTemplates = (
  query: { productKind?: PaymentPolicyProductKind; includeInactive?: boolean } = {},
) => serverFetch<{ data: PaymentPolicy[] }>(`/api/admin/payment-policies${toQueryString(query)}`);

export const createPaymentPolicyTemplate = (body: PaymentPolicyInput) =>
  apiFetch<PaymentPolicy>("/api/admin/payment-policies", { method: "POST", body });

export const updatePaymentPolicyTemplate = (id: string, body: Partial<PaymentPolicyInput>) =>
  apiFetch<PaymentPolicy>(`/api/admin/payment-policies/${id}`, { method: "PATCH", body });

export const setTransferProviderPaymentPolicy = (providerId: string, policyId: string | null) =>
  apiFetch<unknown>(`/api/admin/transfers/providers/${providerId}`, {
    method: "PATCH",
    body: { paymentPolicyId: policyId },
  });
