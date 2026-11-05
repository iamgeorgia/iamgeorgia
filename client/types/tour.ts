import type { CancellationPolicy, ImageAsset, Money } from "./catalogue";
import type {
  BookingApproval,
  BookingDesk,
  BookingGuestType,
  BookingPayment,
  BookingSource,
  CancellationQuote,
  CancellationWindow,
  GuestTitle,
  SharedBookingFilters,
} from "./booking";
import type { GalleryImage } from "./common";

/**
 * Tours, mirroring `server/serializers/tour.js` and `tourBooking.js`.
 *
 * A tour is sold through **options** — a shared seat or a private group,
 * priced per person or per group — and each option has **departures**: a
 * capacity row per date. An **offer** is one departure priced for one party
 * and carried as a signed token; a **booking** is what the offer became, and
 * is a snapshot that does not follow the tour afterwards.
 *
 * The same two conventions as the hotel catalogue: money is integer minor
 * units with its currency beside it, and dates are `YYYY-MM-DD` strings.
 * Fields marked "staff only" are absent rather than null for a viewer who may
 * not see them.
 */

export type TourCategory = "adventure" | "culture" | "wine" | "nature" | "city";
export type Difficulty = "Easy" | "Moderate" | "Challenging";
export type TourStatus = "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type TourOptionStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type TourOptionKind = "SHARED" | "PRIVATE";
export type TourPricingBasis = "PER_PERSON" | "PER_GROUP";
export type TourUnitKind = "SEAT" | "GROUP";
export type TourScheduleKind = "SCHEDULED" | "ON_DEMAND";
export type ConfirmationMode = "INSTANT" | "ON_REQUEST";
export type TourVisibility = "PUBLIC" | "PARTNER_ONLY";
export type TourBookingStatus =
  | "PENDING_APPROVAL"
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW";

/**
 * Meals are a closed vocabulary rather than free text: the same three words
 * recur across every itinerary day of every tour, so they belong in the UI
 * dictionary (`t.tours.mealNames`) and travel through the data as keys.
 */
export type MealKey = "breakfast" | "lunch" | "dinner";

/** Why a departure cannot be sold to this party on this date. */
export type TourUnavailableReason =
  | "SOLD_OUT"
  | "PARTY_SIZE"
  | "TOO_SOON"
  | "BEYOND_HORIZON"
  | "PAST"
  | "UNPRICED";

export interface ItineraryDay {
  day: number;
  title: string;
  description: string;
  meals: MealKey[];
  accommodation: string | null;
}

export interface TourDestinationRef {
  id: string;
  slug: string;
  name: string;
  type: string;
  path: string;
}

// --- catalogue --------------------------------------------------------------

export interface TourSummary {
  id: string;
  slug: string;
  title: string;
  location: string;
  category: TourCategory;
  difficulty: Difficulty;
  durationDays: number;
  durationLabel: string;
  groupSize: string;
  summary: string;
  /** An editorial image path under /public, or null once the gallery rules. */
  image: string | null;
  coverImage: ImageAsset | null;
  /** Indicative and un-dated. Only availability quotes something bookable. */
  priceFrom: Money | null;
  currency: string;
  timezone: string;
  rating: number;
  reviewCount: number;
  featured: boolean;
  /** ISO timestamp of the last change, for the sitemap's `lastModified`. */
  updatedAt: string;
  destination: TourDestinationRef | null;
  /** staff only */
  status?: TourStatus;
  b2cEnabled?: boolean;
  supplier?: { id: string; name: string } | null;
  supplierId?: string | null;
}

export interface TourImage extends ImageAsset {
  tourImageId: string;
  caption: string | null;
  sortOrder: number;
  isCover: boolean;
}

export interface TourSeasonTier {
  id: string;
  minPax: number;
  maxPax: number | null;
  adultSellCents: number | null;
  childSellCents: number | null;
  groupSellCents: number | null;
  /** staff only */
  adultNetCents?: number | null;
  childNetCents?: number | null;
  infantNetCents?: number;
  groupNetCents?: number | null;
}

/** A price sheet: a date range with party-size tiers. Staff only. */
export interface TourSeason {
  id: string;
  name: string;
  validFrom: string;
  validUntil: string;
  /** ISO weekdays, 1 = Monday. Empty means every day. */
  weekdays: number[];
  priority: number;
  currency: string;
  isActive: boolean;
  tiers: TourSeasonTier[];
}

/** A sellable variant of a tour. */
export interface TourOption {
  id: string;
  code: string;
  name: string;
  status: TourOptionStatus;
  kind: TourOptionKind;
  pricingBasis: TourPricingBasis;
  unitKind: TourUnitKind;
  scheduleKind: TourScheduleKind;
  confirmationMode: ConfirmationMode;
  visibility: TourVisibility;
  minPax: number;
  maxPax: number;
  startTime: string | null;
  durationMinutes: number | null;
  languages: string[];
  operatesOnWeekdays: number[];
  noticeHours: number;
  horizonDays: number;
  sortOrder: number;
  cancellation: CancellationPolicy | null;
  /** staff only */
  seasons?: TourSeason[];
}

export interface Tour extends TourSummary {
  description: string[];
  highlights: string[];
  included: string[];
  excluded: string[];
  importantInfo: string[];
  meetingPoint: string;
  meetingTime: string | null;
  meetingPointRef: { id: string; slug: string; name: string; kind: string } | null;
  minAge: number | null;
  /** The child bands this tour prices with. */
  ages: { infantMaxAge: number; childMaxAge: number };
  gallery: GalleryImage[];
  itinerary: ItineraryDay[];
  images: TourImage[];
  options: TourOption[];
  createdAt: string;
  updatedAt: string;
}

export interface PublishChecklistItem {
  code: string;
  message: string;
}

export interface TourWithChecklist extends Tour {
  publishChecklist: PublishChecklistItem[];
}

export interface TourTranslation {
  locale: string;
  title: string | null;
  location: string | null;
  summary: string | null;
  description: string[];
  highlights: string[];
  included: string[];
  excluded: string[];
  importantInfo: string[];
  meetingPoint: string | null;
  durationLabel: string | null;
  groupSize: string | null;
}

/** What the translation editor sends: prose only, field by field. */
export type TourTranslationInput = Partial<Omit<TourTranslation, "locale">>;

// --- departures -------------------------------------------------------------

export interface TourDeparture {
  date: string;
  totalUnits: number;
  blockedUnits: number;
  bookedUnits: number;
  heldUnits: number;
  /** Derived on read, never stored. */
  availableUnits: number;
  stopSell: boolean;
  departureTime: string | null;
  note: string | null;
}

export interface TourCalendar {
  option: { id: string; code: string; name: string; unitKind: TourUnitKind };
  departures: TourDeparture[];
}

/** Anything omitted keeps the value the departure already had. */
export interface TourInventoryRangeInput {
  from: string;
  to: string;
  weekdays?: number[];
  totalUnits?: number;
  blockedUnits?: number;
  stopSell?: boolean;
  departureTime?: string | null;
  note?: string | null;
}

export interface TourInventoryWriteResult {
  departures: number;
  days: number;
}

// --- search -----------------------------------------------------------------

/** The party a tour is priced for. Ages, not a count — the bands need them. */
export interface TourPartyQuery {
  adults: number;
  childAges: number[];
}

export interface TourQuoteLine {
  travellerType: BookingGuestType;
  count: number;
  unitSellCents: number;
  sellCents: number;
  /** staff only */
  unitNetCents?: number;
  netCents?: number;
}

export interface TourQuote {
  currency: string;
  pricingBasis: TourPricingBasis;
  party: { adults: number; children: number; infants: number; pax: number };
  /** Inventory units this party takes: seats, or one group. */
  units: number;
  lines: TourQuoteLine[];
  totals: {
    totalCents: number;
    /** staff only */
    netCents?: number;
    markupBps?: number;
    marginCents?: number;
  };
}

/** A departure that can be sold. `token` carries the offer; never a price. */
export interface TourOfferAvailable {
  available: true;
  date: string;
  departureTime: string | null;
  startAt: string;
  endDate: string;
  availableUnits: number;
  units: number;
  token: string;
  quote: TourQuote;
  cancellation: { freeUntil: string | null; windows: CancellationWindow[] };
  /** Set by a re-quote when the price moved since the token was issued. */
  priceChanged?: boolean;
}

/** A departure that exists but cannot be sold, and why. */
export interface TourOfferUnavailable {
  available: false;
  date: string;
  reason: TourUnavailableReason;
  departureTime?: string | null;
  availableUnits?: number;
  units?: number;
  minPax?: number;
  maxPax?: number;
  bookableUntil?: string;
  noticeHours?: number;
}

export type TourOffer = TourOfferAvailable | TourOfferUnavailable;

export interface TourOptionAvailability {
  option: TourOption;
  dates: TourOffer[];
}

export interface TourAvailability {
  tour: TourSummary;
  party: { adults: number; children: number; infants: number; pax: number };
  window: { from: string; to: string };
  options: TourOptionAvailability[];
}

export interface TourSearchResult extends TourSummary {
  /** The cheapest departure that day, or null on an undated search. */
  cheapestOffer:
    | (TourOfferAvailable & { option: { id: string; code: string; name: string; kind: TourOptionKind } })
    | null;
}

export interface TourSearchResponse {
  data: TourSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// --- holds and bookings -----------------------------------------------------

export interface TourHold {
  token: string;
  expiresAt: string;
  date: string;
  units: number;
  adults: number;
  childAges: number[];
  currency: string;
  totalCents: number;
  tour?: { id: string; slug: string; title: string };
  optionName?: string | null;
  confirmationMode?: ConfirmationMode;
}

export interface LeadTraveller {
  title?: GuestTitle;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

export interface TourTravellerInput {
  type?: BookingGuestType;
  title?: GuestTitle;
  firstName: string;
  lastName: string;
  age?: number;
  passportNumber?: string;
  nationality?: string;
  dietary?: string;
}

/** Note the absence of any amount. Every figure is recomputed server-side. */
export interface ConfirmTourBookingInput {
  holdToken?: string;
  offerToken?: string;
  leadTraveller: LeadTraveller;
  travellers?: TourTravellerInput[];
  specialRequests?: string;
  pickupNote?: string;
  source?: "web" | "partner" | "admin";
  idempotencyKey?: string;
}

/** Paperwork only: the departure, the party and the price cannot move. */
export interface AmendTourBookingInput {
  leadTraveller?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string | null;
  };
  specialRequests?: string | null;
  pickupNote?: string | null;
  email?: string;
}

export interface TourBookingSummary {
  reference: string;
  status: TourBookingStatus;
  tour: { id: string; slug: string | null; title: string | null };
  option: { id: string; code: string; name: string; kind: TourOptionKind } | null;
  date: string;
  endDate: string;
  startAt: string;
  adults: number;
  childAges: number[];
  units: number;
  travellerCount: number;
  leadTravellerName: string;
  currency: string;
  totalCents: number;
  confirmationMode: ConfirmationMode;
  /** Set on an on-request booking: when the operator's answer is due. */
  requestDeadlineAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  declinedAt: string | null;
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

export interface TourTraveller {
  id: string;
  type: BookingGuestType;
  title?: GuestTitle | null;
  firstName: string;
  lastName: string;
  age: number | null;
  isLead: boolean;
  unitSellCents: number;
  /** staff only */
  unitNetCents?: number;
  passportNumber: string | null;
  nationality: string | null;
  dietary: string | null;
}

/** The tour as it was when booked. A voucher reads this, not the live tour. */
export interface TourSnapshot {
  id: string;
  slug: string;
  title: string;
  location?: string;
  durationDays?: number;
  durationLabel?: string;
  timezone?: string;
  meetingPoint?: string | null;
  meetingTime?: string | null;
  option?: {
    id: string;
    code: string;
    name: string;
    kind: TourOptionKind;
    pricingBasis?: TourPricingBasis;
    unitKind?: TourUnitKind;
    languages?: string[];
    startTime?: string | null;
    departureTime?: string | null;
  };
  meetingPointName?: string | null;
  supplierName?: string | null;
  [key: string]: unknown;
}

export interface TourBooking extends TourBookingSummary {
  tourSnapshot: TourSnapshot;
  leadTravellerEmail: string;
  leadTravellerPhone: string | null;
  specialRequests: string | null;
  pickupNote: string | null;
  priceLines: TourQuoteLine[];
  cancellation: {
    summary: string | null;
    freeUntil: string | null;
    windows: CancellationWindow[];
    cancelledAt: string | null;
    chargeCents: number | null;
    reason: string | null;
  };
  declineReason: string | null;
  source: BookingSource;
  travellers: TourTraveller[];
}

export type TourCancellationQuote = CancellationQuote;

export interface TourBookingQuery extends SharedBookingFilters {
  status?: TourBookingStatus | TourBookingStatus[];
  tourId?: string;
  partnerId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}
