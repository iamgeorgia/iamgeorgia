import type { KosherSummary, MealPlan, Money, PaymentPolicy } from "./catalogue";

/**
 * Search offers and bookings, mirroring `server/serializers/search.js` and
 * `server/serializers/booking.js`.
 *
 * The thing to hold onto: an **offer** is a priced, bookable proposition for
 * exact dates and an exact party, carried as a signed token. A **booking** is
 * what that offer became, and it is a snapshot — every name and price on it was
 * frozen at confirmation and does not follow the hotel afterwards.
 */

export type HotelBookingStatus =
  | "PENDING_APPROVAL"
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW";
export type BookingRoomStatus = "CONFIRMED" | "CANCELLED";

// --- approval and payment, shared by every product ---------------------------

/**
 * Where the platform's yes stands on a booking (owner decision OD1: every
 * booking waits for an operator before it is confirmed). Carried by hotel,
 * transfer, tour and service bookings and by orders alike, mirroring the
 * `approval` block in `server/serializers/*`.
 */
export type BookingApprovalState = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export interface BookingApproval {
  state: BookingApprovalState;
  requestedAt: string;
  /** When the platform's answer is due; null when no deadline applies. */
  deadlineAt: string | null;
  overdue: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  /** The operator's reason on a rejection; a note on an approval. */
  reason: string | null;
}

/**
 * What the buyer owes for a booking, read off its receivable. `NONE` means no
 * bill has been raised yet — an unapproved booking, or one the platform never
 * invoices. `via` says whether the bill sits on this booking or on the order
 * it belongs to.
 */
export type BookingPaymentStatus = "NONE" | "UNPAID" | "PARTIAL" | "OVERDUE" | "PAID" | "WAIVED" | "VOID";

export interface BookingPayment {
  status: BookingPaymentStatus;
  via: "BOOKING" | "ORDER";
  receivableId: string | null;
  dueAt: string | null;
  amountCents: number | null;
  paidCents: number | null;
  outstandingCents: number | null;
}

/** Which register a booking awaiting approval belongs to. */
export type BookingApprovalProduct = "HOTEL" | "TRANSFER" | "TOUR" | "SERVICE" | "ORDER";

/**
 * Where a booking came from, read off the session that made it — or, for a
 * booking made at the desk, the channel the operator named. Upper-case, as
 * the server's `BookingSource` enum spells it.
 */
export type BookingSource = "WEB" | "PARTNER" | "ADMIN" | "PHONE" | "EMAIL" | "EXTERNAL_AGENCY" | "DIRECT" | "DEMO";

/** The channels the desk may name on a manual booking. */
export type ManualBookingChannel = "PHONE" | "EMAIL" | "EXTERNAL_AGENCY" | "DIRECT";

/** A courtesy title, printed before a guest's name on vouchers and invoices. */
export type GuestTitle = "MR" | "MRS" | "MS" | "MISS" | "MSTR";

/**
 * The desk block: who the booking is for and who is handling it. Present
 * only for staff who may see the buyer (`partners.read`); a partner or a
 * guest never receives it. Orders carry no `priceAdjustment`.
 */
export interface BookingDesk {
  source: BookingSource;
  customer: {
    id: string;
    kind: "INDIVIDUAL" | "COMPANY";
    name: string;
    contactName: string | null;
    email: string;
    phone: string | null;
  } | null;
  assignedManager: { id: string; name: string } | null;
  internalNotes: string | null;
  /** A signed figure on top of the catalogue price; `totalCents` already includes it. */
  priceAdjustment?: { cents: number; reason: string | null } | null;
}

/** The sort orders every booking register accepts. */
export type BookingSort =
  | "created:desc"
  | "created:asc"
  | "date:asc"
  | "date:desc"
  | "due:asc"
  | "due:desc"
  | "total:desc"
  | "total:asc";

/**
 * The filters every booking register accepts beside its own fields — the
 * five product lists, the partner lists and the register of every booking.
 * Arrays go as repeated parameters (`lib/api/query.ts`).
 */
export interface SharedBookingFilters {
  paymentStatus?: BookingPaymentStatus | BookingPaymentStatus[];
  invoiceStatus?: string | string[];
  paymentMethod?: "BANK_TRANSFER" | "CASH" | "CARD" | "OTHER";
  createdFrom?: string;
  createdTo?: string;
  customerId?: string;
  managerId?: string;
  destinationId?: string;
  source?: BookingSource | BookingSource[];
  approval?: "PENDING" | "OVERDUE";
  sort?: BookingSort;
}

/** One row of the approval queue (`GET /api/admin/booking-approvals`). */
export interface BookingApprovalRow {
  product: BookingApprovalProduct;
  id: string;
  reference: string;
  status: string;
  /** The property, route, tour, service or package name. */
  title: string;
  when: { from: string; to: string };
  leadName: string;
  leadEmail: string;
  partner: { id: string; reference: string; name: string } | null;
  currency: string;
  totalCents: number;
  source: string;
  requestedAt: string;
  deadlineAt: string | null;
  overdue: boolean;
  createdAt: string;
}
export type BookingGuestType = "ADULT" | "CHILD" | "INFANT";

/**
 * The life of one structured requirement on a booking.
 *
 * Deliberately independent of `HotelBookingStatus`: the rooms were secured and
 * priced at confirmation, and a meal still being arranged does not put them
 * back in doubt. A booking can be CONFIRMED with three REQUESTED requirements
 * on it, and that is the accurate description of where things stand.
 */
export type BookingRequestStatus = "REQUESTED" | "CONFIRMED" | "DECLINED" | "WITHDRAWN";

/**
 * A requirement an agency asked the property for.
 *
 * `code` is a facility key from the amenity vocabulary, never a label — the
 * display string comes from the client dictionary, so a booking made in English
 * reads in Hebrew for whoever opens it next.
 */
export interface BookingRequest {
  id: string;
  code: string;
  note: string | null;
  status: BookingRequestStatus;
  respondedAt: string | null;
  responseNote: string | null;
}

/** What an agency asks for at checkout. */
export interface BookingRequestInput {
  code: string;
  note?: string | null;
}

// --- search -----------------------------------------------------------------

export interface StayQuery {
  checkIn: string;
  checkOut: string;
  adults: number;
  /** One age per child. A count would leave the server guessing how to price. */
  childAges?: number[];
  rooms?: number;
}

export interface QuoteNight {
  date: string;
  sellCents: number;
  /** staff only */
  netCents?: number;
  lines?: { label: string; amountCents: number }[];
}

export interface QuoteTotals {
  nights: number;
  roomCents: number;
  taxIncludedCents: number;
  payableAtPropertyCents: number;
  totalCents: number;
  /** staff only */
  netCents?: number;
  markupBps?: number;
  marginCents?: number;
}

export interface Quote {
  currency: string;
  party: { adults: number; children: number; infants: number; countedOccupancy: number };
  nights: QuoteNight[];
  taxes: {
    includedCents: number;
    payableAtPropertyCents: number;
    applied: { name: string; basis: string; amountCents: number; includedInRate: boolean }[];
  };
  totals: QuoteTotals;
}

export interface OfferTerms {
  mealPlan: MealPlan | null;
  cancellation: {
    name: string | null;
    kind: string | null;
    description: string | null;
    /** ISO instant. Null means the rate was never free. */
    freeUntil: string | null;
    refundable: boolean | null;
  };
  payment: PaymentPolicy | null;
}

/** A bookable proposition. `token` is what checkout carries; never a price. */
export interface Offer {
  token: string;
  roomTypeId: string;
  ratePlanId: string;
  name: string;
  terms: OfferTerms;
  quote: Quote;
  occupancy: { extraBedsNeeded: number; extraGuests: number };
  availableUnits: number;
  freeCancellationUntil: string | null;
}

export interface SearchResult {
  id: string;
  slug: string;
  name: string;
  propertyType: string;
  starRating: number;
  guestScore: number;
  reviewCount: number;
  shortDescription: string | null;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  currency: string;
  featured: boolean;
  coverImage: { url: string; altText: string | null; variants: { variant: string; format: string; url: string }[] } | null;
  destination: { id: string; slug: string; name: string; path: string } | null;
  priceFrom: Money | null;
  /** The cheapest offer that can actually be booked for these exact dates. */
  startingFrom: { totalCents: number; perNightCents: number; currency: string };
  mealPlans: string[];
  refundable: boolean;
  offerCount: number;
  cheapestOffer: Offer;
  /** Present only for a property that offers kosher services at all. */
  kosher?: KosherSummary | null;
}

export interface SearchResponse {
  data: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  nights: number;
}

export interface RoomAvailability {
  id: string;
  name: string;
  code: string;
  occupancy: { max: number; maxAdults: number; maxChildren: number; standard: number };
  bedGroups: { groupIndex: number; sleeps: number; beds: { name: string; quantity: number }[] }[];
  coverImage: { url: string } | null;
  offers: Offer[];
}

export interface HotelAvailability {
  hotelId: string;
  nights: number;
  roomTypes: RoomAvailability[];
}

// --- holds ------------------------------------------------------------------

export interface Hold {
  token: string;
  expiresAt: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  currency: string;
  totalCents: number;
  hotel?: { id: string; name: string; slug: string };
  roomTypeName?: string | null;
  ratePlanName?: string | null;
}

// --- bookings ---------------------------------------------------------------

export interface BookingGuestInput {
  type?: BookingGuestType;
  title?: GuestTitle;
  firstName: string;
  lastName: string;
  age?: number;
}

export interface LeadGuest {
  title?: GuestTitle;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

/** Note the absence of any amount. Every figure is recomputed server-side. */
export interface ConfirmBookingInput {
  holdToken?: string;
  offerToken?: string;
  leadGuest: LeadGuest;
  guests?: BookingGuestInput[];
  specialRequests?: string;
  /**
   * Structured requirements, alongside the free text rather than instead of it.
   *
   * Validated against what the property actually offers: a code the hotel does
   * not support is a 422 naming it, because a capability says the hotel *can*
   * and a request says this guest *needs*, and an agency should learn the
   * difference at booking rather than at the desk.
   */
  requests?: BookingRequestInput[];
  source?: "web" | "partner" | "admin";
  idempotencyKey?: string;
}

/**
 * An amendment: the paperwork around a sale, never the sale itself.
 *
 * Note what cannot be expressed here — dates, rooms, board, party, any amount.
 * Changing those means releasing inventory and re-quoting, which is a
 * cancellation and a fresh booking. The server's schema is strict, so a body
 * carrying one of them is a 400 rather than a field quietly dropped.
 */
export interface AmendBookingInput {
  leadGuest?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    /** Null clears it. */
    phone?: string | null;
  };
  specialRequests?: string | null;
  /**
   * The requirement set, sent whole — withdrawing one means sending the list
   * without it. Anything the property has already answered is left alone, so
   * re-asking cannot quietly undo a refusal.
   */
  requests?: BookingRequestInput[];
  /** A guest's proof the booking is theirs. Ignored for a signed-in viewer. */
  email?: string;
}

export interface CancellationWindow {
  fromAt: string | null;
  toAt: string | null;
  chargeCents: number;
}

export interface BookingRoom {
  id: string;
  status: BookingRoomStatus;
  /** As it was sold. The hotel may have renamed it since. */
  roomTypeName: string;
  ratePlanName: string;
  mealPlan: { code: string; name: string };
  bedConfiguration: string | null;
  adults: number;
  childAges: number[];
  cancellation: {
    summary: string | null;
    freeUntil: string | null;
    /** The tiers, frozen to absolute instants at confirmation. */
    windows: CancellationWindow[];
  };
  sellSubtotalCents: number;
  nights: QuoteNight[];
  guests: {
    type: BookingGuestType;
    title?: GuestTitle | null;
    firstName: string;
    lastName: string;
    age: number | null;
    isLead: boolean;
  }[];
  /** staff only */
  netSubtotalCents?: number;
  roomTypeId?: string | null;
}

export interface BookingSummary {
  reference: string;
  status: HotelBookingStatus;
  hotel: { id: string; name: string; slug: string };
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  leadGuestName: string;
  currency: string;
  totalCents: number;
  payableAtPropertyCents: number;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  /** How many requirements the property has still to answer. */
  requestsPending: number;
  /** The platform's yes: null on a booking that never needed one. */
  approval: BookingApproval | null;
  payment: BookingPayment;
  /** staff only */
  netTotalCents?: number;
  markupBps?: number;
  marginCents?: number;
  partner?: { id: string; reference: string; name: string } | null;
  /** staff with `partners.read` only: the buyer and the desk's own fields. */
  desk?: BookingDesk;
}

export interface HotelSnapshot {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  postalCode: string | null;
  countryCode: string;
  phone: string | null;
  email: string | null;
  timezone: string;
  starRating: number;
  propertyType: string;
  checkIn: { from: string | null; until: string | null };
  checkOut: { from: string | null; until: string | null };
  latitude: number | null;
  longitude: number | null;
}

export interface Booking extends BookingSummary {
  /** The property as it was when booked. A voucher reads this, not the hotel. */
  hotelSnapshot: HotelSnapshot;
  leadGuestEmail: string;
  leadGuestPhone: string | null;
  specialRequests: string | null;
  taxIncludedCents: number;
  cancellationChargeCents: number | null;
  cancellationReason: string | null;
  source: BookingSource;
  /** The structured requirements and the property's answers to them. */
  requests: BookingRequest[];
  bookingRooms: BookingRoom[];
}

export interface CancellationQuote {
  chargeCents: number;
  refundCents: number;
  currency: string;
  refundable: boolean;
}

export interface BookingQuery extends SharedBookingFilters {
  status?: HotelBookingStatus | HotelBookingStatus[];
  hotelId?: string;
  partnerId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}
