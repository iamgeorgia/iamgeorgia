import type { BookingSummary, LeadGuest } from "./booking";
import type { PlacedLocation } from "./geo";
import type { PackageComponentType } from "./package";
import type { ServiceBookingSummary } from "./service";
import type { TourBookingSummary } from "./tour";
import type { TransferBookingSummary } from "./transfer";

/**
 * Orders, mirroring `server/serializers/order.js`.
 *
 * An order is a package booked as one thing. One transaction writes a hotel
 * booking, a transfer booking, a tour booking and a service booking — each
 * with its own reference, snapshot and cancellation terms — and one item per
 * slot pointing at exactly one of them. The children are readable on their
 * own registers but can only be cancelled through the order.
 *
 * Money is integer minor units; dates are `YYYY-MM-DD`. Staff-only fields are
 * absent rather than null.
 */

export type OrderStatus =
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "PARTIALLY_CANCELLED"
  | "CANCELLED"
  | "COMPLETED";

export type OrderItemStatus =
  | "REQUESTED"
  | "CONFIRMED"
  | "DECLINED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW";

export type OrderItemFulfilment = "INTERNAL" | "ON_REQUEST" | "EXTERNAL";
export type OrderKind = "PACKAGE" | "CUSTOM";

/** The child booking an item points at, whichever product it belongs to. */
export type OrderChildBooking =
  | BookingSummary
  | TransferBookingSummary
  | TourBookingSummary
  | ServiceBookingSummary;

export interface OrderItem {
  slotIndex: number;
  componentType: PackageComponentType;
  label: string;
  required: boolean;
  status: OrderItemStatus;
  fulfilment: OrderItemFulfilment;
  /** This part's standalone price, before the package adjustment. */
  sellCents: number;
  /** Its share of the package adjustment: negative for a discount. */
  adjustmentCents: number;
  lineTotalCents: number;
  cancellationChargeCents: number | null;
  cancelledAt: string | null;
  /** staff only */
  netCents?: number;
  booking: OrderChildBooking | null;
}

export interface OrderSummary {
  reference: string;
  status: OrderStatus;
  kind: OrderKind;
  package: { id: string | null; slug: string | null; name: string | null };
  startDate: string;
  endDate: string;
  adults: number;
  childAges: number[];
  rooms: number;
  leadName: string;
  currency: string;
  totalCents: number;
  adjustmentCents: number;
  itemCount: number;
  /** How many parts are still waiting for a supplier's answer. */
  pendingCount: number;
  requestDeadlineAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  /** staff only */
  componentsNetCents?: number;
  componentsSellCents?: number;
  marginCents?: number;
  partner?: { id: string; reference: string; name: string } | null;
}

export interface Order extends OrderSummary {
  leadEmail: string;
  leadPhone: string | null;
  specialRequests: string | null;
  packageSnapshot: Record<string, unknown>;
  cancellationChargeCents: number | null;
  cancellationReason: string | null;
  source: string;
  items: OrderItem[];
}

/** What cancelling would cost right now, read off frozen figures. */
export interface OrderCancellationQuote {
  chargeCents: number;
  refundCents: number;
  currency: string;
  refundable: boolean;
  items: {
    slotIndex: number;
    label: string;
    chargeCents: number;
    refundCents: number;
    /** The discount share forfeited by dropping this part. */
    clawbackCents: number;
  }[];
}

export interface OrderCancellationResult extends Order {
  cancellation: OrderCancellationQuote;
}

// --- holds and confirmation -------------------------------------------------

export interface OrderHold {
  /** Keyed by slot index: only hotel and tour slots hold anything. */
  holdTokens: Record<string, string>;
  expiresAt: string;
}

export interface OrderTraveller {
  firstName: string;
  lastName: string;
  age?: number;
}

/** A structured requirement for the hotel part, as on a standalone stay. */
export interface OrderRequestInput {
  code: string;
  note?: string;
}

/** Note the absence of any amount: the token carries the price. */
export interface ConfirmOrderInput {
  packageToken: string;
  holdTokens?: Record<string, string>;
  leadGuest: LeadGuest;
  travellers?: OrderTraveller[];
  specialRequests?: string;
  requests?: OrderRequestInput[];
  flightNumber?: string;
  pickupAddress?: string;
  /** The searched pick-up door for the order's transfer, when there is one. */
  pickupPlace?: PlacedLocation;
  preferredDriverId?: string;
  preferredFleetVehicleId?: string;
  source?: "web" | "partner" | "admin";
  idempotencyKey?: string;
}

/** Paperwork only. Dates, party and money are a cancel-and-rebook. */
export interface AmendOrderInput {
  leadGuest?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string | null;
  };
  specialRequests?: string | null;
}

export interface OrderQuery {
  status?: OrderStatus | OrderStatus[];
  packageId?: string;
  partnerId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

// --- the 409s a checkout has to render --------------------------------------

/** `details` of a 409 PRICE_CHANGED: every slot whose price moved. */
export interface OrderPriceChangedDetails {
  reason: "PRICE_CHANGED";
  quotedCents: number;
  currentCents: number;
  components: {
    slotIndex: number;
    label: string;
    quotedCents: number;
    currentCents: number;
  }[];
}

/** `details` of a 409 UNAVAILABLE: every slot that can no longer be filled. */
export interface OrderUnavailableDetails {
  reason: "UNAVAILABLE";
  slots: { slotIndex: number; label: string; reason: string }[];
}
