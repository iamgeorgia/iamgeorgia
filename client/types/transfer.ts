/**
 * Transfers — private and shared point-to-point ground transport.
 *
 * Spelled exactly as `server/serializers/transfer.js` sends it, so nothing has
 * to be translated at the boundary. The same two conventions as the rest of the
 * live catalogue apply, and both used to be wrong here:
 *
 *   * **Money is integer minor units** and always arrives with its currency.
 *     The prototype carried plain-number dollars; every figure below is cents.
 *   * **Dates are `YYYY-MM-DD` strings** and times are 24-hour `HH:mm` wall
 *     clock at the pick-up point. Instants — `pickupAt` — are ISO strings and
 *     are what a schedule is ordered by.
 *
 * Fields marked "staff only" are *absent* rather than null for anyone who may
 * not see them, so `in` and `?.` distinguish "no value" from "not permitted".
 *
 * Pricing lives on the server and only on the server. The client used to
 * compute fares from coordinates; it now asks and is told. A price the browser
 * computes is a price the browser can change.
 */
import type { BookingApproval, BookingDesk, BookingPayment, BookingSource } from "./booking";
import type { PlaceRef, PlacedLocation } from "./geo";

export type TransferPointKind = "AIRPORT" | "CITY" | "RESORT" | "HOTEL" | "LANDMARK" | "STATION";

/** The commercial product tiers. What a price list is written against. */
export type TransferVehicleClass =
  | "ECONOMY"
  | "COMFORT"
  | "MINIVAN"
  | "VAN"
  | "GROUP"
  | "JEEP_4X4"
  | "VIP";

/** What the vehicle physically is. Selects the illustration, nothing else. */
export type TransferVehicleBody = "sedan" | "suv" | "minivan" | "van" | "bus";

/** Private hires the whole vehicle; shared sells a seat on a scheduled run. */
export type TransferKind = "PRIVATE" | "SHARED";

export type TransferRouteTier = "TIER_1" | "TIER_2" | "TIER_3";
export type TransferRouteCategory = "AIRPORT" | "CITY" | "RESORT" | "TOURIST_ROUTE" | "COMBINED";
export type TransferStatus = "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type TransferTripType = "ONE_WAY" | "RETURN";
export type TransferLegDirection = "OUTBOUND" | "RETURN";
export type TransferExtraBasis = "FIXED" | "PER_PASSENGER" | "PER_HOUR" | "PERCENT";

export type TransferBookingStatus =
  | "PENDING_APPROVAL"
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW";

/**
 * Closed set, so every surface renders the same icon and wording for the same
 * feature. Labels live in the dictionary, never in the data.
 */
export type TransferFeature =
  | "airConditioning"
  | "wifi"
  | "childSeat"
  | "englishDriver"
  | "meetGreet"
  | "flightTracking"
  | "bottledWater"
  | "freeWaiting";

export interface TransferPoint {
  id: string;
  slug: string;
  name: string;
  kind: TransferPointKind;
  /** IATA code for airports, shown as a chip. */
  code: string | null;
  /** Region or city the point sits in — the second line of every option row. */
  region: string;
  latitude: number;
  longitude: number;
  /** What the place search said when the pin was set; null for a pin placed by hand. */
  place: PlaceRef | null;
  /** IANA. A pick-up time is a wall clock reading here. */
  timezone: string;
  /** Surfaced first in the picker before the traveller types anything. */
  popular: boolean;
  image: string | null;
  /**
   * Always `ACTIVE` off the public endpoints, which never return anything else.
   * The panel reads it to tell a retired point from a live one.
   */
  status?: TransferStatus;
}

export interface TransferProvider {
  id: string;
  slug: string;
  name: string;
  /** Out of 5. */
  rating: number;
  reviewCount: number;
  verified: boolean;
  yearsActive: number;
}

export interface TransferVehicle {
  id: string;
  slug: string;
  name: string;
  vehicleClass: TransferVehicleClass;
  body: TransferVehicleBody;
  kind: TransferKind;
  provider: TransferProvider | null;
  /** "Toyota Camry or similar" — never a promise of a specific car. */
  vehicleExample: string;
  maxPassengers: number;
  /** Large checked bags. */
  maxLuggage: number;
  /** Cabin bags carried in addition to the checked allowance. */
  maxCabinBags: number;
  features: TransferFeature[];
  summary: string;
  description: string[];
  included: string[];
  excluded: string[];
  pickupProcedure: string;
  /** The terms in words. The exact schedule is frozen onto a booking instead. */
  cancellation: { kind: string; description: string | null } | null;
  currency: string;
  /** Editorial ordering for the "Recommended" sort. Lower sorts first. */
  recommendedRank: number;

  // staff only
  status?: TransferStatus;
  b2cEnabled?: boolean;
  partnerId?: string | null;
  paceFactor?: number;
  fallbackPricing?: {
    perKmCents: number;
    minimumFareCents: number;
    airportFeeCents: number;
  };
}

export interface TransferRouteStop {
  id: string;
  position: number;
  dwellMinutes: number;
  point: TransferPoint;
}

export interface TransferRoutePrice {
  vehicleId: string;
  oneWayCents: number;
  returnCents: number | null;
  netCents: number | null;
  currency: string;
  isActive: boolean;
}

export interface TransferRoute {
  id: string;
  slug: string;
  from: TransferPoint;
  to: TransferPoint;
  tier: TransferRouteTier;
  category: TransferRouteCategory;
  distanceKm: number;
  durationMinutes: number;
  title: string | null;
  summary: string | null;
  description: string[];
  heroImage: string | null;
  featured: boolean;
  /** ISO timestamp of the last change, for the sitemap's `lastModified`. */
  updatedAt: string;
  stops: TransferRouteStop[];
  /**
   * The cheapest curated fare, for a "from" price on a card. Null when the
   * route has no prices at all — the distance engine's answer depends on the
   * party, and cannot be stated without one.
   */
  startingFromCents: number | null;

  // staff only
  status?: TransferStatus;
  prices?: TransferRoutePrice[];
}

export interface TransferRouteWithChecklist extends TransferRoute {
  publishChecklist: { code: string; message: string }[];
}

export interface TransferExtra {
  code: string;
  name: string;
  description: string | null;
  basis: TransferExtraBasis;
  /** Null for a PERCENT extra, which carries `percentBps` instead. */
  priceCents: number | null;
  percentBps: number | null;
  currency: string;
  appliesToClasses: TransferVehicleClass[];
  position: number;
  /**
   * Retired extras keep their row: a booking records the code it bought, and a
   * support conversation six months later still has to be able to say what
   * "skiEquipment" was. Only the admin list returns them.
   */
  isActive?: boolean;
}

export interface TransferQuoteExtraLine {
  code: string;
  name: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

export interface TransferQuoteLeg {
  direction: TransferLegDirection;
  from: string;
  to: string;
  /** ISO instant. */
  pickupAt: string;
  distanceKm: number;
  durationMinutes: number;
  isNight: boolean;
  baseFareCents: number;
  nightSurchargeCents: number;
  extras: TransferQuoteExtraLine[];
  sellCents: number;

  // staff only
  netCents?: number;
  source?: "curated" | "distance";
}

export interface TransferQuote {
  currency: string;
  /** Shared vehicles are sold by the seat; the total already reflects it. */
  perSeat: boolean;
  legs: TransferQuoteLeg[];
  totals: {
    sellCents: number;
    totalCents: number;

    // staff only
    netCents?: number;
    markupBps?: number;
    marginCents?: number;
  };
}

/** A costed offer for one specific journey — what a result card renders. */
export interface TransferOffer {
  /** Signed, and carried into checkout. Never decode or trust it client-side. */
  token: string;
  vehicle: TransferVehicle;
  quote: TransferQuote;
}

export interface TransferQuoteResult {
  from: TransferPoint;
  to: TransferPoint;
  route: TransferRoute | null;
  /** True when the road is shut for those dates. A real answer, not an error. */
  closed: boolean;
  offers: TransferOffer[];
}

/** Where a leg is operationally. The booking's own status is commercial. */
export type TransferLegStatus =
  | "UNASSIGNED"
  | "ASSIGNED"
  | "ACCEPTED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "ON_BOARD"
  | "COMPLETED"
  | "NO_SHOW_REPORTED"
  | "NO_SHOW"
  | "CANCELLED";

export type TransferAssignmentStatus =
  | "OFFERED"
  | "ACCEPTED"
  | "DECLINED"
  | "REVOKED"
  | "COMPLETED"
  | "NO_SHOW";

export interface TransferBookingLeg {
  id: string;
  legIndex: number;
  direction: TransferLegDirection;
  from: string;
  to: string;
  pickupAt: string;
  distanceKm: number;
  durationMinutes: number;
  sellCents: number;
  netCents?: number;
  /** The flight this leg meets or catches; null when none was given. */
  flightNumber?: string | null;
  status: TransferLegStatus;
  /**
   * Who is coming. Operations get the full assignment; a partner or a
   * passenger gets the accepted driver's public profile, or null until then.
   * Typed loosely here and narrowed by the screen that knows its audience.
   */
  assignment: import("./driver").AssignmentAdmin | import("./driver").AssignmentForPartner | null;
  /** The score already left on this leg, if any. */
  rating: { score: number; status: import("./driver").RatingStatus } | null;
}

/** The journey as it was sold. A voucher reads this, never the live route. */
export interface TransferRouteSnapshot {
  fromSlug: string;
  fromName: string;
  fromRegion: string;
  fromKind: TransferPointKind;
  fromTimezone: string;
  toSlug: string;
  toName: string;
  toRegion: string;
  toKind: TransferPointKind;
  routeSlug: string | null;
  routeTitle: string | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  stops: { name: string; dwellMinutes: number }[];
}

export interface TransferVehicleSnapshot {
  slug: string;
  name: string;
  vehicleClass: TransferVehicleClass;
  body: TransferVehicleBody;
  kind: TransferKind;
  vehicleExample: string;
  maxPassengers: number;
  maxLuggage: number;
  features: TransferFeature[];
  providerName: string | null;
  pickupProcedure: string;
  included: string[];
  excluded: string[];
}

export interface TransferBookingSummary {
  reference: string;
  status: TransferBookingStatus;
  tripType: TransferTripType;
  pickupAt: string;
  returnPickupAt: string | null;
  from: string | null;
  to: string | null;
  vehicleName: string | null;
  passengers: number;
  leadPassengerName: string;
  leadPassengerEmail: string;
  currency: string;
  totalCents: number;
  createdAt: string;
  /** One per leg, in leg order. */
  legStatuses: TransferLegStatus[];
  /** The platform's yes: null on a booking that never needed one. */
  approval: BookingApproval | null;
  payment: BookingPayment;

  // staff only
  netTotalCents?: number;
  markupBps?: number;
  marginCents?: number;
  partner?: { id: string; reference: string; name: string } | null;
  /** staff with `partners.read` only: the buyer and the desk's own fields. */
  desk?: BookingDesk;
}

export interface TransferCancellationQuote {
  refundCents: number;
  /** @deprecated Older API builds named the field this way; prefer `refundCents`. */
  refundableCents?: number;
  chargeCents: number;
  currency: string;
  /** The last moment cancelling is still free. Null when it never was. */
  freeUntil: string | null;
  asAt: string;
}

export interface TransferBooking extends TransferBookingSummary {
  route: TransferRouteSnapshot;
  vehicle: TransferVehicleSnapshot;
  adults: number;
  children: number;
  childAges: number[];
  luggage: number;
  cabinBags: number;
  leadPassengerPhone: string | null;
  flightNumber: string | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  /** The searched doors, when the traveller picked them: what a driver navigates to. */
  pickupPlace: PlacedLocation | null;
  dropoffPlace: PlacedLocation | null;
  specialRequests: string | null;
  cancellation: {
    freeUntil: string | null;
    windows: { fromAt: string | null; toAt: string | null; chargeCents: number }[];
    cancelledAt: string | null;
    chargeCents: number | null;
    reason: string | null;
  };
  legs: TransferBookingLeg[];
  extras: TransferQuoteExtraLine[];
  confirmedAt: string | null;
  source?: BookingSource;
}

/**
 * A confirmation request.
 *
 * Note what is absent: any amount at all. The token names the journey and the
 * vehicle; everything else here is the paperwork a driver needs.
 */
export interface ConfirmTransferInput {
  quoteToken: string;
  leadPassenger: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
  flightNumber?: string;
  /** The flight per leg; `flightNumber` alone is the outbound's. */
  flights?: { outbound?: string | null; return?: string | null };
  pickupAddress?: string;
  dropoffAddress?: string;
  pickupPlace?: PlacedLocation;
  dropoffPlace?: PlacedLocation;
  specialRequests?: string;
  idempotencyKey?: string;
  /**
   * A partner's choice of driver, and which of their cars, for every leg.
   * Partner sessions only; the server checks eligibility and availability
   * and answers 409 `DRIVER_UNAVAILABLE` or 422 `DRIVER_NOT_ELIGIBLE`.
   */
  preferredDriverId?: string;
  preferredFleetVehicleId?: string;
}

/** Deliberately cannot move the journey. Amending that means cancel and rebook. */
export interface AmendTransferInput {
  leadPassenger?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string | null;
  };
  flightNumber?: string | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  pickupPlace?: PlacedLocation | null;
  dropoffPlace?: PlacedLocation | null;
  specialRequests?: string | null;
  email?: string;
}

export interface TransferBlackout {
  id: string;
  routeId: string | null;
  vehicleId: string | null;
  from: string;
  to: string;
  reason: string | null;
}
