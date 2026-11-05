import type {
  BookingApproval,
  BookingDesk,
  BookingPayment,
  BookingSource,
  BookingSummary,
  GuestTitle,
  LeadGuest,
  SharedBookingFilters,
} from "./booking";
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
  | "PENDING_APPROVAL"
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "PARTIALLY_CANCELLED"
  | "CANCELLED"
  | "COMPLETED";

export type OrderItemStatus =
  | "AWAITING_APPROVAL"
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
  /**
   * Where the item came from, on a CUSTOM order. A package booked through the
   * cart is flattened into its components, which share a `groupKey` and keep
   * the package's id and slot; a standalone item has none of the three.
   * Absent on a PACKAGE order written before the cart existed.
   */
  packageId?: string | null;
  packageSlotIndex?: number | null;
  groupKey?: string | null;
  /** Who gave the discount: the package's own allocation, the desk, or nobody. */
  adjustmentSource?: OrderAdjustmentSource;
}

export type OrderAdjustmentSource = "NONE" | "PACKAGE" | "MANUAL";

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
  /** How many parts are still waiting for the platform's yes. */
  awaitingApprovalCount: number;
  /** The platform's yes on the whole order: null when it never needed one. */
  approval: BookingApproval | null;
  payment: BookingPayment;
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
  /** staff with `partners.read` only: the buyer and the desk's fields (an order carries no price adjustment). */
  desk?: BookingDesk;
}

export interface Order extends OrderSummary {
  leadEmail: string;
  leadPhone: string | null;
  specialRequests: string | null;
  packageSnapshot: Record<string, unknown>;
  cancellationChargeCents: number | null;
  cancellationReason: string | null;
  source: BookingSource;
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
  title?: GuestTitle;
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

export interface OrderQuery extends SharedBookingFilters {
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

// --- the cart: several products as one CUSTOM order --------------------------

/**
 * One line of a cart, as `POST /orders/custom` wants it (`validation/order.js`,
 * `cartItemSchema`). Strict on the server: nothing but these fields may travel,
 * which is why the cart keeps its display snapshot beside the payload rather
 * than inside it. No amount anywhere — the tokens carry the price.
 */
export type CustomOrderItemInput =
  | {
      type: "HOTEL_STAY";
      label?: string;
      offerToken: string;
      holdToken?: string;
      travellers?: OrderTraveller[];
      requests?: OrderRequestInput[];
      specialRequests?: string;
    }
  | {
      type: "TOUR";
      label?: string;
      offerToken: string;
      holdToken?: string;
      travellers?: OrderTraveller[];
      specialRequests?: string;
    }
  | {
      type: "TRANSFER";
      label?: string;
      quoteToken: string;
      flightNumber?: string;
      flights?: { outbound?: string | null; return?: string | null };
      pickupAddress?: string;
      dropoffAddress?: string;
      pickupPlace?: PlacedLocation;
      dropoffPlace?: PlacedLocation;
      preferredDriverId?: string;
      preferredFleetVehicleId?: string;
    }
  | {
      type: "SERVICE";
      label?: string;
      serviceId: string;
      date: string;
      time?: string;
      days?: number;
      quantity?: number;
      pax?: number;
      quotedSellCents?: number;
    }
  | {
      type: "PACKAGE";
      label?: string;
      packageToken: string;
      holdTokens?: Record<string, string>;
      travellers?: OrderTraveller[];
      requests?: OrderRequestInput[];
      flightNumber?: string;
      pickupAddress?: string;
      pickupPlace?: PlacedLocation;
      preferredDriverId?: string;
      preferredFleetVehicleId?: string;
    };

export type CustomOrderItemType = CustomOrderItemInput["type"];

/** `POST /orders/custom/quote`: nothing is written; a lead is optional. */
export interface QuoteCustomOrderInput {
  items: CustomOrderItemInput[];
  leadGuest?: { firstName?: string; lastName?: string; email?: string };
}

/** One priced line of a cart quote. A package contributes one per component. */
export interface CustomOrderQuoteItem {
  /** Position in the `items` array that was sent. */
  index: number;
  slotIndex: number;
  type: CustomOrderItemType;
  componentType: PackageComponentType;
  label: string;
  /** Shared by the lines of one package; null for a standalone item. */
  groupKey: string | null;
  quotedCents: number;
  currentCents: number;
  adjustmentCents: number;
  lineTotalCents: number;
  priceChanged: boolean;
  dates: { from: string; to: string };
}

/** An item the quote could not price: it went, or it was never bookable. */
export interface CustomOrderGoneItem {
  index: number;
  type: CustomOrderItemType;
  reason: string;
  details?: unknown;
}

/** An item whose price moved since its token was issued. */
export interface CustomOrderDriftedItem {
  index: number;
  type: CustomOrderItemType;
  quotedCents: number;
  currentCents: number;
  /** A package names the slots that moved. */
  components?: { slotIndex: number; label: string; quotedCents: number; currentCents: number }[];
}

export type CustomOrderQuote =
  | {
      available: true;
      currency: string;
      startDate: string;
      endDate: string;
      items: CustomOrderQuoteItem[];
      priceChanged: boolean;
      drifted: CustomOrderDriftedItem[];
      totals: {
        componentsSellCents: number;
        adjustmentCents: number;
        manualAdjustmentCents: number;
        sellTotalCents: number;
        /** staff only */
        componentsNetCents?: number;
      };
    }
  | { available: false; reason: "UNAVAILABLE"; items: CustomOrderGoneItem[] }
  | { available: false; reason: "MIXED_CURRENCY"; currencies: string[] };

/**
 * `POST /orders/custom/holds`. Keyed by item index: a hotel or tour item holds
 * one token, a package holds one per slot, and a transfer or service holds
 * nothing and is absent.
 */
export interface CustomOrderHold {
  holds: Record<string, string | Record<string, string>>;
  expiresAt: string | null;
}

/** `POST /orders/custom`. As everywhere: no amount. */
export interface ConfirmCustomOrderInput {
  items: CustomOrderItemInput[];
  /** What the trip is called on its confirmation; the server has a default. */
  name?: string;
  leadGuest: LeadGuest;
  travellers?: OrderTraveller[];
  requests?: OrderRequestInput[];
  specialRequests?: string;
  idempotencyKey?: string;
}

/** `details` of a 409 from `POST /orders/custom`, naming every item in the way. */
export type CustomOrderConflictDetails =
  | { reason: "UNAVAILABLE"; items: CustomOrderGoneItem[] }
  | { reason: "PRICE_CHANGED"; items: CustomOrderDriftedItem[] };

/** `details` of a 422 MIXED_CURRENCY. */
export interface CustomOrderMixedCurrencyDetails {
  reason: "MIXED_CURRENCY";
  currencies: string[];
}

/** How the CUSTOM snapshot names the packages its items came from. */
export interface CustomOrderSnapshotPackage {
  groupKey: string;
  id?: string;
  slug?: string | null;
  name?: string | null;
}
