import { createPayment } from "@/lib/api/payments";

/**
 * Starting a card payment for a booking that already exists.
 *
 * The booking is never at risk here: if the payment cannot be opened the caller
 * sends the guest to the confirmation page, where "Pay now" is still on offer.
 * No amount is sent; the server charges the receivable's outstanding balance.
 */

const EMAIL_KEY = "iag:pay:email:";

/**
 * The guest's email is the proof of ownership the confirmation pages need, and
 * the payment result page has no way to know it. It is parked in
 * `sessionStorage` (this tab only, gone when the tab closes) just before the
 * redirect to the bank, so the result page can link back to the booking.
 */
export function rememberGuestEmail(reference: string, email: string): void {
  try {
    sessionStorage.setItem(EMAIL_KEY + reference, email);
  } catch {
    // Private mode or blocked storage: the result page falls back to the lookup form.
  }
}

export function recallGuestEmail(reference: string): string | null {
  try {
    return sessionStorage.getItem(EMAIL_KEY + reference);
  } catch {
    return null;
  }
}

/** Where a booking's confirmation lives, by reference prefix. */
export const confirmationPath = (reference: string): string =>
  reference.toUpperCase().startsWith("TRF-")
    ? `/transfers/confirmation/${reference}`
    : `/booking/confirmation/${reference}`;

/**
 * Opens a payment and sends the browser to the bank.
 *
 * Resolves `true` once the redirect has been issued (the page is leaving, so the
 * caller should leave its busy state alone) and `false` when the payment could
 * not be started for any reason.
 */
export async function startCardPayment(input: {
  reference: string;
  email: string;
  locale: string;
  idempotencyKey: string;
}): Promise<boolean> {
  try {
    const payment = await createPayment(input);

    if (!payment.checkoutUrl) return false;

    rememberGuestEmail(input.reference, input.email);
    window.location.assign(payment.checkoutUrl);

    return true;
  } catch {
    return false;
  }
}
