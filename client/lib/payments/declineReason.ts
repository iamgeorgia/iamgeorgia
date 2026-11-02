/**
 * Flitt's `response_code` for a declined payment, mapped to a dictionary key.
 *
 * Kept free of imports so it can be unit-tested directly. The dictionary holds
 * the friendly sentence (`payment.declineReasons.<key>`); an unknown code, or a
 * missing one, reads as the generic "your bank did not approve the payment".
 */
export const DECLINE_REASON_KEYS = {
  "1037": "insufficientFunds",
  "1003": "invalidCvv",
  "1024": "threeDsFailed",
  "1025": "invalidExpiry",
  "1051": "fraudCheck",
  "1052": "orderExpired",
} as const;

export type DeclineReasonKey = (typeof DECLINE_REASON_KEYS)[keyof typeof DECLINE_REASON_KEYS] | "generic";

export function declineReasonKey(code: number | string | null | undefined): DeclineReasonKey {
  if (code === null || code === undefined) return "generic";

  const key = String(code).trim() as keyof typeof DECLINE_REASON_KEYS;

  return DECLINE_REASON_KEYS[key] ?? "generic";
}
