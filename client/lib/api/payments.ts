import { apiFetch, serverFetch } from "./client";
import { toQueryString } from "./query";
import type { CheckoutPaymentRule } from "@/types/catalogue";
import type { CheckoutRuleParams, GuestPayment, PaymentSettings } from "@/types/payments";

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
