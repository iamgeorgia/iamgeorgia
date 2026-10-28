import { apiFetch, type RequestOptions } from "./client";
import type { Booking, BookingApprovalProduct, BookingDesk, ConfirmBookingInput, ManualBookingChannel } from "@/types/booking";
import type { ConfirmCustomOrderInput, ConfirmOrderInput, CustomOrderQuote, Order, QuoteCustomOrderInput } from "@/types/order";
import type { ConfirmServiceBookingInput, ServiceBooking } from "@/types/service";
import type { ConfirmTourBookingInput, TourBooking } from "@/types/tour";
import type { ConfirmTransferInput, TransferBooking } from "@/types/transfer";
import type { CustomerInput } from "@/types/customer";

/**
 * Bookings made at the desk — by phone, by email, through another agency,
 * or face to face — for a partner or for a customer with no account.
 *
 * The same products, the same confirmation bodies and the same ledger as a
 * booking made on the site: the envelope only says who it is for, where it
 * came from, and what the desk changed. The booking is made *as the buyer*,
 * so a partner's own prices and credit apply, which is also why the search
 * that produced the token must have been made as that partner (see
 * `ACT_AS_PARTNER_HEADER`).
 */

/** The header that makes a search or a quote answer as a partner would see it. */
export const ACT_AS_PARTNER_HEADER = "X-Act-As-Partner";

export interface ActAsOptions {
  /** Search as this partner: the offers come back priced for them. */
  asPartnerId?: string | null;
}

/** `{ "X-Act-As-Partner": id }`, or nothing for a customer with no account. */
export const actAsPartnerHeaders = (partnerId: string | null | undefined): Record<string, string> =>
  partnerId ? { [ACT_AS_PARTNER_HEADER]: partnerId } : {};

/** Request options for a browser read made as the buyer. */
export const actAsInit = (options: ActAsOptions = {}): RequestOptions =>
  options.asPartnerId ? { headers: actAsPartnerHeaders(options.asPartnerId) } : {};

// --- the envelope ------------------------------------------------------------

export type ManualBookingBuyer =
  | { kind: "PARTNER"; partnerId: string }
  | { kind: "CUSTOMER"; customerId: string }
  | { kind: "CUSTOMER"; customer: CustomerInput };

export interface ManualBookingEnvelope {
  buyer: ManualBookingBuyer;
  channel: ManualBookingChannel;
  /** Needs `bookings.approve`; otherwise the booking waits in the approvals queue. */
  confirmNow?: boolean;
  /** Needs `bookings.price.override`. Signed and non-zero, on top of the catalogue price. */
  priceAdjustment?: { cents: number; reason: string };
  assignedManagerUserId?: string | null;
  internalNotes?: string | null;
}

/**
 * The five registers plus `CART`: several products for one buyer, booked as
 * one CUSTOM order through `/admin/orders/custom/manual`. A cart is not a
 * register — the order it makes lives on the orders register — so it has no
 * `…/:reference/desk` of its own.
 */
export type ManualBookingProduct = BookingApprovalProduct | "CART";

/** The product's ordinary confirmation body, nested under `booking`. */
export interface ManualBookingBodies {
  HOTEL: ConfirmBookingInput;
  TRANSFER: ConfirmTransferInput;
  TOUR: ConfirmTourBookingInput;
  SERVICE: ConfirmServiceBookingInput;
  ORDER: ConfirmOrderInput;
  /** The `POST /orders/custom` body: `items`, `leadGuest`, `travellers?`, … The key travels as a header. */
  CART: Omit<ConfirmCustomOrderInput, "idempotencyKey">;
}

export interface ManualBookingResults {
  HOTEL: Booking;
  TRANSFER: TransferBooking;
  TOUR: TourBooking;
  SERVICE: ServiceBooking;
  ORDER: Order;
  CART: Order;
}

export type ManualBookingBody<P extends ManualBookingProduct> = ManualBookingEnvelope & {
  booking: ManualBookingBodies[P];
};

const MANUAL_PATHS: Record<ManualBookingProduct, string> = {
  HOTEL: "/api/admin/bookings",
  TRANSFER: "/api/admin/transfers/bookings",
  TOUR: "/api/admin/tours/bookings",
  SERVICE: "/api/admin/services/bookings",
  ORDER: "/api/admin/orders",
  CART: "/api/admin/orders/custom",
};

/** The admin register a product's bookings live under, for `…/manual` and `…/:reference/desk`. */
export const manualBookingBase = (product: ManualBookingProduct): string => MANUAL_PATHS[product];

/**
 * Makes the booking. 201 with the product's detail, or 200 with the same
 * detail on a replay: pass an `idempotencyKey` and a double-clicked submit
 * cannot take two rooms.
 *
 * Refusals worth rendering: 403 with `details.fields: ["priceAdjustment"]`
 * (no `bookings.price.override`), 403 on `confirmNow` (no `bookings.approve`),
 * 422 `PARTNER_INACTIVE`, 422 `NOT_STAFF` for the manager, and the product's
 * own 409s (`PRICE_CHANGED`, `UNAVAILABLE`). A `CART` names every item in
 * the way instead (`details.items[{ index, type, … }]`, see
 * `CustomOrderConflictDetails`) and refuses two currencies with 422
 * `MIXED_CURRENCY`.
 */
export const createManualBooking = <P extends ManualBookingProduct>(
  product: P,
  body: ManualBookingBody<P>,
  idempotencyKey?: string,
) =>
  apiFetch<ManualBookingResults[P]>(`${manualBookingBase(product)}/manual`, {
    method: "POST",
    body,
    headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined,
    // A cart prepares and commits up to twenty products in one transaction.
    ...(product === "CART" ? { timeoutMs: 45_000 } : {}),
  });

/**
 * The cart's preflight, made as the buyer: every line's current price, a
 * package's lines under their `groupKey`, and what went. Nothing is written.
 * The act-as header rides along so a partner's prices apply wherever the
 * server honours it on this route.
 */
export const quoteDeskCart = (body: QuoteCustomOrderInput, options: ActAsOptions = {}) =>
  apiFetch<CustomOrderQuote>("/api/orders/custom/quote", {
    method: "POST",
    body,
    timeoutMs: 30_000,
    ...actAsInit(options),
  });

export interface DeskUpdateInput {
  /** Null clears the assignment. The user must be an active member of staff (422 `NOT_STAFF`). */
  assignedManagerUserId?: string | null;
  internalNotes?: string | null;
}

/** The desk's fields that may change after the booking exists. Answers the product's detail. */
export const updateDesk = <P extends BookingApprovalProduct>(product: P, reference: string, body: DeskUpdateInput) =>
  apiFetch<ManualBookingResults[P] & { desk?: BookingDesk }>(`${manualBookingBase(product)}/${reference}/desk`, {
    method: "PATCH",
    body,
  });
