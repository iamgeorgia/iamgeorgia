import { apiFetch, serverFetch } from "./client";
import { toQueryString, type QueryValue } from "./query";
import type { Paginated } from "@/types/partner";
import type {
  AmendOrderInput,
  ConfirmCustomOrderInput,
  ConfirmOrderInput,
  CustomOrderHold,
  CustomOrderItemInput,
  CustomOrderQuote,
  Order,
  OrderCancellationQuote,
  OrderCancellationResult,
  OrderHold,
  OrderQuery,
  OrderSummary,
  QuoteCustomOrderInput,
} from "@/types/order";

/**
 * Orders: holds, confirmation, reading and cancelling.
 *
 * An order is written in one transaction or not at all, so there is no
 * partial state to recover from here — a failure is a 409 naming every slot
 * in the way, and the client re-quotes. The children are readable through
 * their own registers but only cancellable through these endpoints.
 */

// --- holds ------------------------------------------------------------------

/**
 * Secures the rooms and seats a composite offer needs while the form is
 * filled in. Only hotel and tour slots hold anything; transfers and services
 * have no inventory to reserve.
 */
export const createOrderHolds = (packageToken: string) =>
  apiFetch<OrderHold>("/api/orders/holds", { method: "POST", body: { packageToken } });

/** Abandoning checkout. Always succeeds, even if the holds already expired. */
export const releaseOrderHolds = (holdTokens: Record<string, string>) =>
  apiFetch<void>("/api/orders/holds", { method: "DELETE", body: { holdTokens } });

// --- confirmation -----------------------------------------------------------

/**
 * Books the whole package.
 *
 * The idempotency key is what makes a double-clicked button return the first
 * order rather than take a second set of rooms and seats.
 */
export const confirmOrder = (body: ConfirmOrderInput) =>
  apiFetch<Order>("/api/orders", {
    method: "POST",
    body,
    headers: body.idempotencyKey ? { "idempotency-key": body.idempotencyKey } : undefined,
    // Four products are prepared and committed in one transaction; the
    // default 15 s is the server's own budget for it, not a margin over it.
    timeoutMs: 30_000,
  });

// --- reading ----------------------------------------------------------------

/** A guest reading their own order: the reference alone is not a credential. */
export const getGuestOrder = (reference: string, email: string) =>
  serverFetch<Order>(`/api/orders/${reference}${toQueryString({ email })}`);

/** A signed-in partner reading one of its own; anyone else's is a 404. */
export const getPartnerOrder = (reference: string) =>
  serverFetch<Order>(`/api/orders/${reference}`);

export const getOrderCancellationQuote = (reference: string, email?: string) =>
  serverFetch<OrderCancellationQuote>(
    `/api/orders/${reference}/cancellation-quote${toQueryString({ email })}`,
  );

export const listPartnerOrders = (query: OrderQuery = {}) =>
  serverFetch<Paginated<OrderSummary>>(
    `/api/partner/orders${toQueryString(query as Record<string, QueryValue>)}`,
  );

// --- changing ---------------------------------------------------------------

export const amendOrder = (reference: string, body: AmendOrderInput) =>
  apiFetch<Order>(`/api/orders/${reference}`, { method: "PATCH", body });

export const cancelOrder = (reference: string, body: { reason?: string; email?: string } = {}) =>
  apiFetch<OrderCancellationResult>(`/api/orders/${reference}/cancel`, { method: "POST", body });

/**
 * Drops one part. A required part answers 409 `REQUIRED_COMPONENT` unless the
 * caller is staff: a package without its hotel is not a package, and keeping
 * the discounted transfer is the arbitrage the allocation exists to prevent.
 */
export const cancelOrderItem = (
  reference: string,
  slotIndex: number,
  body: { reason?: string; email?: string } = {},
) =>
  apiFetch<OrderCancellationResult>(`/api/orders/${reference}/items/${slotIndex}/cancel`, {
    method: "POST",
    body,
  });

// --- admin ------------------------------------------------------------------

export const listAdminOrders = (query: OrderQuery = {}) =>
  serverFetch<Paginated<OrderSummary>>(
    `/api/admin/orders${toQueryString(query as Record<string, QueryValue>)}`,
  );

export const getAdminOrder = (reference: string) =>
  serverFetch<Order>(`/api/admin/orders/${reference}`);

export const getAdminOrderCancellationQuote = (reference: string) =>
  serverFetch<OrderCancellationQuote>(`/api/admin/orders/${reference}/cancellation-quote`);

export const cancelOrderAsAdmin = (reference: string, reason?: string) =>
  apiFetch<OrderCancellationResult>(`/api/admin/orders/${reference}/cancel`, {
    method: "POST",
    body: reason ? { reason } : {},
  });

/** The operator's answer to one on-request part. */
export const confirmOrderItem = (reference: string, slotIndex: number) =>
  apiFetch<Order>(`/api/admin/orders/${reference}/items/${slotIndex}/confirm`, { method: "POST" });

/**
 * Declining charges nothing. A required part takes the whole order with it,
 * cancelled and waived; an optional one is dropped and the total shrinks.
 */
export const declineOrderItem = (reference: string, slotIndex: number, reason: string) =>
  apiFetch<Order>(`/api/admin/orders/${reference}/items/${slotIndex}/decline`, {
    method: "POST",
    body: { reason },
  });

/** The override that cancels a required part on its own. */
export const cancelOrderItemAsAdmin = (reference: string, slotIndex: number, reason?: string) =>
  apiFetch<OrderCancellationResult>(
    `/api/admin/orders/${reference}/items/${slotIndex}/cancel`,
    { method: "POST", body: reason ? { reason } : {} },
  );

// --- the cart: several products as one CUSTOM order -------------------------
//
// Behind the server's `CART_ENABLED`: off, every route below answers 404 with
// `details.reason === "CART_DISABLED"`. The client has its own switch
// (`NEXT_PUBLIC_CART_ENABLED`, see lib/booking/cartFlag.ts) so the buttons
// never appear against a server that will refuse them.

/**
 * What the cart page shows before checkout: whether every item is still
 * there, and at what price today. Nothing is written, and a moved price comes
 * back as a figure rather than a refusal.
 */
export const quoteCustomOrder = (body: QuoteCustomOrderInput) =>
  apiFetch<CustomOrderQuote>("/api/orders/custom/quote", { method: "POST", body, timeoutMs: 30_000 });

/** Holds every hotel room and tour seat in the cart for the checkout countdown. */
export const createCustomOrderHolds = (items: CustomOrderItemInput[]) =>
  apiFetch<CustomOrderHold>("/api/orders/custom/holds", {
    method: "POST",
    body: { items },
    timeoutMs: 30_000,
  });

/** Abandoning checkout. Takes the map as the holds call returned it; always succeeds. */
export const releaseCustomOrderHolds = (holds: CustomOrderHold["holds"]) =>
  apiFetch<void>("/api/orders/custom/holds", { method: "DELETE", body: { holds } });

/**
 * Books the cart as one CUSTOM order: one transaction, one approval, one
 * receivable. The idempotency key is what makes a double-clicked button
 * return the first order rather than take a second set of rooms and seats.
 */
export const confirmCustomOrder = (body: ConfirmCustomOrderInput) => {
  const { idempotencyKey, ...payload } = body;

  return apiFetch<Order>("/api/orders/custom", {
    method: "POST",
    body: payload,
    headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined,
    // Up to twenty products are prepared and committed in one transaction.
    timeoutMs: 45_000,
  });
};
