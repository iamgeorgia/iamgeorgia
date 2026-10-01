/**
 * The live hotel catalogue, mirroring `server/serializers/*`.
 *
 * Spelled exactly as the server sends it, so nothing has to be translated at
 * the boundary. Two conventions carried over from the API and worth stating
 * because they are easy to get wrong in a component:
 *
 *   * **Money is integer minor units** and always arrives with its currency.
 *     Never do arithmetic that assumes whole units.
 *   * **Dates are `YYYY-MM-DD` strings**, not `Date`. Check-out is exclusive:
 *     1–4 June is three nights.
 *
 * Fields marked "staff only" are *absent* rather than null for anyone who may
 * not see them, so `in` and `?.` distinguish "no value" from "not permitted".
 */
import type { PlaceRef } from "./geo";

export type PropertyType =
  | "Hotel"
  | "Boutique"
  | "Resort"
  | "Guesthouse"
  | "Lodge"
  | "Apartment"
  | "Chalet"
  | "Hostel"
  | "Villa";

export type HotelStatus = "DRAFT" | "ACTIVE" | "INACTIVE" | "SUSPENDED" | "ARCHIVED";
export type CatalogueStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type InventorySource = "MANUAL" | "CHANNEL_MANAGER" | "SUPPLIER_API";

export type MealPlanCode = "RO" | "BB" | "HB" | "HB_PLUS" | "FB" | "FB_PLUS" | "AI" | "UAI";
export type CancellationKind = "FLEXIBLE" | "NON_REFUNDABLE" | "TIERED";
export type ChargeBasis =
  | "PERCENT_OF_TOTAL"
  | "PERCENT_OF_FIRST_NIGHT"
  | "FIXED_AMOUNT"
  | "NIGHTS";
export type PaymentTiming =
  | "PAY_NOW"
  | "PAY_LATER"
  | "DEPOSIT"
  | "PAY_AT_HOTEL"
  | "CREDIT_ACCOUNT";
export type BedTypeCode = "SINGLE" | "TWIN" | "DOUBLE" | "QUEEN" | "KING" | "SOFA" | "BUNK" | "FUTON";
export type BathroomType = "PRIVATE" | "ENSUITE" | "SHARED";
export type ChildChargeMode = "FREE" | "PERCENT_OF_ADULT" | "FIXED_PER_NIGHT" | "FULL_ADULT";
export type TaxFeeBasis = "PERCENT" | "PER_NIGHT_PER_PERSON" | "PER_NIGHT_PER_ROOM" | "PER_STAY";
export type ImageCategory =
  | "Exterior"
  | "Lobby"
  | "Restaurant"
  | "Pool"
  | "Spa"
  | "Room"
  | "Bathroom"
  | "View"
  | "Facilities";
export type AmenityCategory =
  | "General"
  | "FoodDrink"
  | "Wellness"
  | "Parking"
  | "Business"
  | "Family"
  | "Ski"
  | "Accessibility"
  | "Transportation"
  | "KosherFood"
  | "Shabbat"
  | "Religious";

/** The three categories the kosher panel is built from. */
export const KOSHER_AMENITY_CATEGORIES = ["KosherFood", "Shabbat", "Religious"] as const;

/**
 * How much of a property's operation is kosher — declared by staff, and
 * deliberately saying nothing about whether anyone has certified it.
 *
 * Ordered weakest-first, which is the ordering the `kosher=` filter uses.
 */
export type KosherServiceLevel =
  | "NONE"
  | "ON_REQUEST"
  | "KOSHER_FRIENDLY"
  | "PARTIAL"
  | "FULL";

/** What a certificate covers. Only PROPERTY and KITCHEN certify the property. */
export type KosherCertificationScope = "PROPERTY" | "KITCHEN" | "RESTAURANT" | "PASSOVER";

/**
 * The state a certificate is actually in.
 *
 * `EXPIRED` is computed by the server from the expiry date and today — it is
 * never stored, so it is right at 00:01 whether or not any job has run. `NONE`
 * means the property has no certificate at all.
 */
export type KosherCertificationState =
  | "NONE"
  | "UNVERIFIED"
  | "PENDING_VERIFICATION"
  | "VERIFIED"
  | "EXPIRED"
  | "REJECTED"
  | "ARCHIVED";

/** Who asserted the record. Staff-only. */
export type KosherDataSource = "ADMIN" | "HOTEL" | "SUPPLIER" | "IMPORT";

/** An admin's decision on a certificate. */
export type KosherVerificationDecision = "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED";
export type AmenityScope = "HOTEL" | "ROOM" | "BOTH";
export type DestinationType = "COUNTRY" | "REGION" | "CITY" | "RESORT";

/** An amount, always with the currency it is denominated in. */
export interface Money {
  amountCents: number;
  currency: string;
}

// --- media ------------------------------------------------------------------

export interface ImageVariant {
  variant: "thumb" | "card" | "gallery" | "original";
  format: "webp" | "avif" | "jpeg";
  url: string;
  width: number;
  height: number;
}

/**
 * A public image. `url` is the original; pick a variant for anything smaller.
 * The server composes these from an object key at serialization time, so they
 * are safe to render but not to store.
 */
export interface ImageAsset {
  id: string;
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  mimeType: string;
  variants: ImageVariant[];
}

export interface HotelImage extends ImageAsset {
  hotelImageId: string;
  category: ImageCategory;
  caption: string | null;
  sortOrder: number;
  isCover: boolean;
}

export interface RoomImage extends ImageAsset {
  roomImageId: string;
  caption: string | null;
  sortOrder: number;
  isCover: boolean;
}

/** A private file. Deliberately has no URL — fetch a signed one when needed. */
export interface PrivateFile {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  uploadedAt: string;
}

// --- destinations -----------------------------------------------------------

export interface DestinationSummary {
  id: string;
  slug: string;
  name: string;
  type: DestinationType;
  parentId: string | null;
  /** Materialised ancestry, e.g. `/georgia/samtskhe-javakheti/bakuriani`. */
  path: string;
  countryCode: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  /** What the place search said when the pin was set; null for a pin placed by hand. */
  place: PlaceRef | null;
  coverImage: string | null;
  featured: boolean;
  hotelCount?: number;
  childCount?: number;
}

export interface DestinationNode extends DestinationSummary {
  children: DestinationNode[];
}

export interface Destination extends DestinationSummary {
  tagline: string | null;
  summary: string | null;
  description: string[];
  heroImage: string | null;
  gallery: { src: string; alt: string }[];
  idealFor: string[];
  attractions: { name: string; description: string }[];
  travelInfo: Record<string, string> | null;
  parent: DestinationSummary | null;
  children: DestinationSummary[];
  createdAt: string;
  updatedAt: string;
}

// --- amenities --------------------------------------------------------------

export interface CatalogueAmenity {
  id: string;
  /** Stable machine key. Prefer this over `id` for icons and saved filters. */
  code: string;
  name: string;
  category: AmenityCategory;
  scope: AmenityScope;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  hotelCount?: number;
  /** Set when the amenity hangs off a hotel or room. */
  note?: string | null;
}

// --- rooms ------------------------------------------------------------------

export interface BedGroup {
  groupIndex: number;
  /** How many the group sleeps in total. Groups are alternatives, not additions. */
  sleeps: number;
  beds: { code: BedTypeCode; name: string; quantity: number; sleeps: number }[];
}

export interface OccupancyLimits {
  max: number;
  maxAdults: number;
  maxChildren: number;
  minAdults: number;
  standard: number;
  extraBedCapacity: number;
}

/** Present only when the request said who was travelling. */
export interface OccupancyVerdict {
  fits: boolean;
  reasons: { code: string; message: string }[];
  extraBedsNeeded: number;
  extraGuests: number;
}

export interface RoomTypeSummary {
  id: string;
  hotelId: string;
  /**
   * Indicative nightly "from" on the public detail: the cheapest rate over the
   * coming months, marked up for the viewer. Not an offer — only dated search
   * quotes something bookable.
   */
  priceFrom?: Money | null;
  code: string;
  name: string;
  status: CatalogueStatus;
  sortOrder: number;
  roomSizeSqm: number | null;
  occupancy: OccupancyLimits;
  bedGroups: BedGroup[];
  coverImage: ImageAsset | null;
  availability?: OccupancyVerdict;
}

export interface RoomType extends RoomTypeSummary {
  description: string | null;
  bathroomType: BathroomType;
  smokingAllowed: boolean;
  accessible: boolean;
  amenities: CatalogueAmenity[];
  ratePlans: RatePlan[];
  images: RoomImage[];
  createdAt: string;
  updatedAt: string;
}

// --- commercial model -------------------------------------------------------

export interface MealPlan {
  code: MealPlanCode;
  name: string;
  description: string | null;
}

export interface HotelMealPlan extends MealPlan {
  hotelDescription: string | null;
  inclusions: string[];
  serviceTimes: Record<string, string>;
}

export interface CancellationRule {
  hoursBeforeCheckIn: number;
  chargeBasis: ChargeBasis;
  /** Basis points for the percentage bases, minor units for a fixed amount. */
  chargeValue: number;
}

export interface CancellationPolicy {
  id: string;
  name: string;
  kind: CancellationKind;
  description: string | null;
  isActive: boolean;
  /** A shared platform template. Usable by any hotel, editable by none. */
  isTemplate: boolean;
  rules: CancellationRule[];
}

export interface PaymentPolicy {
  id: string;
  name: string;
  timing: PaymentTiming;
  depositBps: number | null;
  balanceDueDaysBeforeCheckIn: number | null;
  description: string | null;
  isActive: boolean;
  isTemplate: boolean;
}

export interface RatePlanRestriction {
  id: string;
  startDate: string;
  endDate: string;
  minStay: number | null;
  maxStay: number | null;
  minAdvanceDays: number | null;
  maxAdvanceDays: number | null;
  /** The stay may span this date but may not begin or end on it. */
  closedToArrival: boolean;
  closedToDeparture: boolean;
  stopSell: boolean;
}

/** The sellable offer: a room, a board, cancellation terms, payment terms. */
export interface RatePlan {
  id: string;
  roomTypeId: string;
  code: string;
  name: string;
  status: CatalogueStatus;
  visibility: "PUBLIC" | "PARTNER_ONLY";
  sortOrder: number;
  currency: string;
  mealPlan: MealPlan | null;
  cancellation: CancellationPolicy | null;
  payment: PaymentPolicy | null;
  occupancy: {
    base: number;
    minAdults: number | null;
    maxAdults: number | null;
    maxChildren: number | null;
  };
  sellableFrom: string | null;
  sellableUntil: string | null;
  restrictions: RatePlanRestriction[];
  createdAt: string;
  updatedAt: string;
}

export interface ChildPolicyBand {
  minAge: number;
  maxAge: number;
  label: string;
  chargeMode: ChildChargeMode;
  chargeValue: number;
  requiresExtraBed: boolean;
}

export interface ChildPolicy {
  infantMaxAge: number;
  childMaxAge: number;
  childrenCountTowardOccupancy: boolean;
  maxChildrenFreePerRoom: number | null;
  bands: ChildPolicyBand[];
  updatedAt: string;
}

export interface TaxFee {
  id: string;
  name: string;
  basis: TaxFeeBasis;
  value: number;
  currency: string;
  /** Already paid, versus payable at the desk. Never present these the same way. */
  includedInRate: boolean;
  appliesToChildren: boolean;
  startDate: string | null;
  endDate: string | null;
}

// --- kosher -----------------------------------------------------------------

/**
 * One certificate, as the API reports it.
 *
 * `state` is what to render — it already folds expiry in, so a component must
 * never compare `expiresOn` against a browser clock and reach its own verdict.
 *
 * There is no URL to the scan and never will be: `documentAvailable` says
 * whether one exists, and reaching the bytes is a separate authorized, audited
 * request for a signed link.
 */
export interface KosherCertification {
  id: string;
  authorityName: string;
  authorityWebsite: string | null;
  name: string | null;
  reference: string | null;
  scope: KosherCertificationScope;
  issuedOn: string | null;
  /** Null means the authority issues no expiry, not that nobody entered one. */
  expiresOn: string | null;
  state: KosherCertificationState;
  /** Negative once past. Null when the certificate never expires. */
  expiresInDays: number | null;
  archivedAt: string | null;
  documentAvailable: boolean;
  documentId: string | null;

  // staff only
  verification?: "UNVERIFIED" | "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED";
  verifiedAt?: string | null;
  verifiedBy?: { id: string; name: string; email: string } | null;
  verificationNotes?: string | null;
  source?: KosherDataSource;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * The card-sized kosher line.
 *
 * `certified` is derived by the server from a verified, unexpired,
 * property-scoped certificate. Nothing an admin can type sets it, and no
 * combination of amenities produces it — so a component may render it directly
 * and never has to second-guess what it means.
 */
export interface KosherSummary {
  serviceLevel: KosherServiceLevel;
  offersKosher: boolean;
  certified: boolean;
  certificationState: KosherCertificationState;
  expiringSoon: boolean;
  authorityName: string | null;
  expiresOn: string | null;
}

/** The full block on a hotel detail. */
export interface KosherProfile extends KosherSummary {
  certifiedScopes: KosherCertificationScope[];
  /** The one worth putting on a card — live beats pending beats lapsed. */
  certification: KosherCertification | null;
  certifications: KosherCertification[];
  /**
   * Amenity codes in the three kosher categories. A projection of the hotel's
   * own amenities, not a second store — ticking one writes a `hotel_amenities`
   * row through the endpoint that has always written them.
   */
  features: string[];
  notes: string | null;
  contact: { name: string | null; email: string | null; phone: string | null };
  updatedAt: string;

  // staff only
  source?: KosherDataSource;
  sourceRef?: string | null;
  sourceUpdatedAt?: string | null;
  lockedAt?: string | null;
  lockedBy?: { id: string; name: string; email: string } | null;
  /** A supplier payload held back because the record is locked. */
  pendingSupplierData?: Record<string, unknown> | null;
}

/** A private file attached to a property. Deliberately carries no URL. */
export interface HotelDocument {
  id: string;
  docType: string;
  label: string | null;
  validUntil: string | null;
  fileAssetId: string;
  file: {
    id: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    category: string;
  } | null;
  uploadedBy: { id: string; name: string; email: string } | null;
  createdAt: string;
}

// --- hotels -----------------------------------------------------------------

/**
 * A place near the property.
 *
 * The first three fields are the original contract and are still the only ones
 * guaranteed. The rest were added for religious facilities — an observant
 * traveller needs to know *which* synagogue and how far it is on foot — and are
 * optional because no record written before they existed has them.
 */
export interface NearbyPlace {
  name: string;
  /** The operator's own wording. `kind` is the machine-readable half. */
  type: string;
  distance: string;
  kind?:
    | "SYNAGOGUE"
    | "MIKVEH"
    | "KOSHER_RESTAURANT"
    | "KOSHER_SHOP"
    | "ERUV"
    | "AIRPORT"
    | "STATION"
    | "LANDMARK"
    | "OTHER";
  latitude?: number;
  longitude?: number;
  /** Minutes on foot — the number that matters on a Shabbat. */
  walkingMinutes?: number;
}

export interface HotelPolicies {
  checkIn?: string;
  checkOut?: string;
  cancellation?: string;
  children?: string;
  pets?: string;
  payment?: string;
  rules?: string[];
}

export interface HotelSummary {
  id: string;
  slug: string;
  name: string;
  propertyType: PropertyType;
  starRating: number;
  guestScore: number;
  reviewCount: number;
  shortDescription: string | null;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  currency: string;
  featured: boolean;
  /** ISO timestamp of the last change, for the sitemap's `lastModified`. */
  updatedAt: string;
  coverImage: ImageAsset | null;
  destination: DestinationSummary | null;
  /** An un-dated "from" price. Not an offer — never quote or book from it. */
  priceFrom: Money | null;
  /** Amenity codes for card icons, present when the list query loaded them. */
  amenityCodes?: string[];
  /**
   * Present only when the property offers kosher services at all — so its
   * absence and "this hotel does not do kosher" are the same thing, which is
   * the truth.
   */
  kosher?: KosherSummary | null;

  // staff only
  status?: HotelStatus;
  /** Whether the property is sold to the public at all; everything is B2B by default. */
  b2cEnabled?: boolean;
  sourceType?: InventorySource;
  supplier?: { id: string; reference: string; name: string } | null;
  counts?: { amenities: number; images: number };
}

export interface Hotel extends HotelSummary {
  summary: string | null;
  description: string[];
  address: string | null;
  postalCode: string | null;
  /** What the place search said when the pin was set; null for a pin placed by hand. */
  place: PlaceRef | null;
  timezone: string;
  checkIn: { from: string | null; until: string | null };
  checkOut: { from: string | null; until: string | null };
  phone: string | null;
  email: string | null;
  website: string | null;
  languages: string[];
  policies: HotelPolicies;
  nearby: NearbyPlace[];
  categoryScores: { label: string; score: number }[];
  amenities: CatalogueAmenity[];
  images: HotelImage[];
  roomTypes: RoomType[];
  reviews?: {
    id: string;
    author: string;
    country: string;
    date: string;
    score: number;
    title: string;
    body: string;
    tripType: string;
  }[];
  childPolicy: ChildPolicy | null;
  /** The full block, replacing the summary on a detail response. */
  kosher?: KosherProfile | null;
  createdAt: string;
  updatedAt: string;

  // staff only
  externalRef?: Record<string, unknown> | null;
  supplierId?: string | null;
}

/** What still has to be true before a hotel may go on sale. */
export interface PublishChecklistItem {
  code: string;
  message: string;
}

export interface HotelWithChecklist extends Hotel {
  publishChecklist: PublishChecklistItem[];
}

// --- inventory --------------------------------------------------------------

export interface CalendarRate {
  ratePlanId: string;
  ratePlanName: string;
  ratePlanCode: string;
  date: string;
  currency: string;
  closed: boolean;
  sellCents: number | null;
  extraAdultCents: number | null;
  extraChildCents: number | null;
  singleOccupancyCents: number | null;
  /** staff only */
  netCents?: number;
}

export interface CalendarNight {
  date: string;
  totalUnits: number;
  blockedUnits: number;
  bookedUnits: number;
  heldUnits: number;
  /** Derived, never stored: total − blocked − booked − held. */
  availableUnits: number;
  stopSell: boolean;
  minStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  rates: CalendarRate[];
}

export interface InventoryCalendar {
  roomType: { id: string; name: string; code: string };
  nights: CalendarNight[];
}

/** Anything omitted keeps the value the night already had. */
export interface InventoryRangeInput {
  from: string;
  to: string;
  /** ISO weekdays, 1 = Monday. Omit for every day in the range. */
  weekdays?: number[];
  totalUnits?: number;
  blockedUnits?: number;
  stopSell?: boolean;
  minStay?: number | null;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
}

export interface RateRangeInput {
  from: string;
  to: string;
  weekdays?: number[];
  currency?: string;
  netCents?: number;
  sellCents?: number | null;
  extraAdultCents?: number | null;
  extraChildCents?: number | null;
  singleOccupancyCents?: number | null;
  closed?: boolean;
}

export interface BulkWriteResult {
  nights: number;
  days: number;
}

export interface PricingRule {
  id: string;
  markupBps: number;
  label: string | null;
  priority: number;
  isActive: boolean;
  partner: { id: string; reference: string; name: string } | null;
  hotel: { id: string; name: string; slug: string } | null;
  destination: { id: string; name: string; slug: string } | null;
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarkupExplanation {
  markupBps: number;
  source: "RULE" | "PARTNER_COMMISSION" | "PLATFORM_DEFAULT";
  ruleId?: string;
  label?: string | null;
}
