import type { ImageAsset, KosherCertificationScope, KosherServiceLevel, Money, PaymentPolicy } from "./catalogue";
import type { GalleryImage } from "./common";
import type { ConfirmationMode, TourOptionKind, TourSearchResult } from "./tour";
import type { TransferOffer, TransferPoint, TransferTripType, TransferVehicleClass } from "./transfer";
import type { ServiceBasis } from "./service";

/**
 * Packages, mirroring `server/serializers/package.js`.
 *
 * A package is an admin-defined **template with typed slots**: a hotel stay,
 * a transfer, a tour, a service, each constrained to what the admin allows.
 * It has no price of its own. A **quote** for one start date and one party
 * resolves every slot through that product's own engine, applies the package
 * adjustment and signs the lot into a composite token, which is the only
 * thing an order can be built from.
 *
 * Money is integer minor units with its currency beside it; dates are
 * `YYYY-MM-DD`. Staff-only fields are absent rather than null.
 */

export type PackageStatus = "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type PackageComponentType = "HOTEL_STAY" | "TRANSFER" | "TOUR" | "SERVICE";
export type PackageAdjustmentKind = "NONE" | "DISCOUNT_BPS" | "FIXED_SELL" | "PER_PERSON_FIXED";
export type PackageAdjustmentScope = "REQUIRED_ONLY" | "ALL_ITEMS";
export type PackageQuantityRule = "ONE" | "PER_PERSON" | "PER_ROOM";
export type ShabbatMode = "SOLAR" | "FIXED_HOURS" | "NONE";
export type MealPlanCode = "RO" | "BB" | "HB" | "HB_PLUS" | "FB" | "FB_PLUS" | "AI" | "UAI";

/** Why a package cannot be sold for the requested date and party. */
export type PackageUnavailableReason =
  | "COMPONENT_UNAVAILABLE"
  | "ADJUSTMENT_BELOW_COST"
  | "KOSHER_INELIGIBLE";

/** Why one slot could not be filled. Rendered from `t.packages.slotReasons`. */
export type SlotReason =
  | "EXCLUDED"
  | "UNAVAILABLE"
  | "ROUTE_CLOSED"
  | "SOLD_OUT"
  | "PARTY_SIZE"
  | "TOO_SOON"
  | "BEYOND_HORIZON"
  | "PAST"
  | "UNPRICED"
  | "QUANTITY"
  | "NOT_FOUND"
  | "INACTIVE"
  | "CURRENCY";

export interface PackageDestinationRef {
  id: string;
  slug: string;
  name: string;
  type: string;
  path: string;
}

export interface PackagePartyRules {
  minAdults: number;
  maxAdults: number | null;
  maxChildren: number | null;
  maxPax: number | null;
}

export interface PackageAdjustment {
  kind: PackageAdjustmentKind;
  value: number;
  appliesTo: PackageAdjustmentScope;
}

// --- catalogue --------------------------------------------------------------

export interface PackageSummary {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  nights: number;
  currency: string;
  timezone: string;
  /** An editorial image path under /public, or null once the gallery rules. */
  image: string | null;
  coverImage: ImageAsset | null;
  featured: boolean;
  kosher: { minServiceLevel: KosherServiceLevel; certifiedRequired: boolean } | null;
  /** Indicative and un-dated: a cached cheapest sample, never a quote. */
  priceFrom: Money | null;
  party: PackagePartyRules;
  validFrom: string | null;
  validUntil: string | null;
  componentCount: number;
  destination: PackageDestinationRef | null;
  updatedAt: string;
  /** staff only */
  status?: PackageStatus;
  b2cEnabled?: boolean;
  sortOrder?: number;
  sellableFrom?: string | null;
  sellableUntil?: string | null;
  adjustment?: PackageAdjustment;
  kosherOverrideUntil?: string | null;
}

export interface PackageImage extends ImageAsset {
  packageImageId: string;
  caption: string | null;
  sortOrder: number;
  isCover: boolean;
}

/** A festival or other explicit rest window, beyond the weekly Shabbat. */
export interface RestDay {
  from: string;
  to: string;
  label?: string;
}

/** What a kosher package promises, before any hotel is resolved. */
export interface KosherPackageProfile {
  minServiceLevel: KosherServiceLevel;
  certifiedRequired: boolean;
  certificationScopes: KosherCertificationScope[];
  requireCertValidThroughStay: boolean;
  requiredMealPlanCodes: MealPlanCode[];
  hotelRequestCodes: string[];
  shabbatMode: ShabbatMode;
  shabbatFixedStart: string | null;
  shabbatFixedEnd: string | null;
  candleLightingOffsetMin: number;
  havdalahOffsetMin: number;
  noTransfersInShabbat: boolean;
  noToursOnShabbat: boolean;
  extraRestDays: RestDay[];
  supervisionAuthority: string | null;
  notes: string | null;
}

export interface TourKosherProfile {
  kosherMealsAvailable: boolean;
  operatesOnShabbat: boolean;
  notes: string | null;
}

/** A slot as the template describes it, with any fixed product named. */
export interface PackageComponent {
  slotIndex: number;
  componentType: PackageComponentType;
  label: string;
  required: boolean;
  dayOffset: number;
  nights: number | null;
  timeOfDay: string | null;
  quantityRule: PackageQuantityRule;
  hotel: { id: string; slug: string; name: string } | null;
  allowedRoomTypeIds: string[];
  allowedRatePlanIds: string[];
  allowedMealPlanCodes: MealPlanCode[];
  fromPoint: { id: string; slug: string; name: string } | null;
  toPoint: { id: string; slug: string; name: string } | null;
  route: { id: string; slug: string; title: string } | null;
  allowedVehicleClasses: TransferVehicleClass[];
  tripType: TransferTripType | null;
  tour: { id: string; slug: string; title: string; kosher: TourKosherProfile | null } | null;
  allowedTourOptionIds: string[];
  service: {
    id: string;
    slug: string;
    name: string;
    basis: ServiceBasis;
    confirmationMode: ConfirmationMode;
  } | null;
  kosher: {
    minServiceLevel: KosherServiceLevel | null;
    certifiedRequired: boolean | null;
    certificationScopes: KosherCertificationScope[];
  } | null;
  /** staff only */
  constraints?: Record<string, unknown>;
}

export interface PackageDetail extends PackageSummary {
  /** The card rule attached to the package; null = the platform default. */
  payment?: PaymentPolicy | null;
  description: string[];
  gallery: GalleryImage[];
  images: PackageImage[];
  components: PackageComponent[];
  kosherProfile: KosherPackageProfile | null;
  createdAt: string;
  updatedAt: string;
}

export interface PackageWithChecklist extends PackageDetail {
  publishChecklist: { code: string; message: string }[];
  /**
   * The kosher template check, re-run against live hotel data on every read.
   *
   * Null when the package has no kosher profile. It is not the same as a
   * quote's `kosher`: this judges the fixed hotels a template names, without
   * dates, so an admin sees a lapsed certificate before a buyer hits it.
   */
  kosherEligibility: { blockers: KosherFinding[]; warnings: KosherFinding[] } | null;
}

export interface PackageTranslation {
  locale: string;
  name: string | null;
  summary: string | null;
  description: string[];
}

// --- quotes -----------------------------------------------------------------

export interface ResolvedHotelSlot {
  sellCents: number;
  netCents?: number;
  hotel: { id: string; slug: string; name: string };
  roomType: { id: string; name: string };
  ratePlan: { id: string; name: string; mealPlanCode: MealPlanCode | null; mealPlanName: string | null };
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  payableAtPropertyCents: number;
  freeCancellationUntil: string | null;
  token: string;
}

export interface ResolvedTransferSlot {
  sellCents: number;
  netCents?: number;
  vehicle: { id: string; slug: string; name: string; vehicleClass: TransferVehicleClass };
  from: { id: string; name: string };
  to: { id: string; name: string };
  tripType: TransferTripType;
  legs: { direction: string; pickupAt: string; fromPointName: string; toPointName: string }[];
  token: string;
}

export interface ResolvedTourSlot {
  sellCents: number;
  netCents?: number;
  tour: { id: string; slug: string; title: string };
  option: {
    id: string;
    code: string;
    name: string;
    kind: TourOptionKind;
    confirmationMode: ConfirmationMode;
  };
  date: string;
  endDate: string;
  departureTime: string | null;
  token: string;
}

export interface ResolvedServiceSlot {
  sellCents: number;
  netCents?: number;
  service: { id: string; slug: string; name: string; category: string; confirmationMode: ConfirmationMode };
  date: string;
  endDate: string;
  quantity: number;
  pax: number;
  days: number;
}

export type ResolvedSlot =
  | ResolvedHotelSlot
  | ResolvedTransferSlot
  | ResolvedTourSlot
  | ResolvedServiceSlot;

/** Another allowed choice for the same slot, each with its own signed offer. */
export interface HotelAlternative {
  hotelId: string;
  hotelName: string;
  roomTypeId: string;
  roomTypeName: string;
  ratePlanId: string;
  ratePlanName: string;
  mealPlanCode: MealPlanCode | null;
  sellCents: number;
  totalCents: number;
  token: string;
}

export interface TransferAlternative {
  vehicleId: string;
  vehicleName: string;
  vehicleClass: TransferVehicleClass;
  sellCents: number;
  token: string;
}

export interface TourAlternative {
  tourOptionId: string;
  optionName: string;
  kind: TourOptionKind;
  confirmationMode: ConfirmationMode;
  sellCents: number;
  token: string;
}

export type SlotAlternative = HotelAlternative | TransferAlternative | TourAlternative;

export interface QuotedComponent {
  slotIndex: number;
  componentType: PackageComponentType;
  label: string;
  required: boolean;
  included: boolean;
  reason: SlotReason | null;
  resolved: ResolvedSlot | null;
  adjustmentCents: number;
  lineTotalCents: number;
  alternatives: SlotAlternative[];
}

/** A kosher rule the resolved quote breaks, or a caution it carries. */
export interface KosherFinding {
  code: string;
  message: string;
  slotIndex?: number;
}

export interface PackageQuote {
  package: PackageSummary;
  startDate: string;
  endDate: string;
  party: { adults: number; children: number; childAges: number[]; pax: number };
  rooms: number;
  currency: string;
  available: boolean;
  unavailableReason: PackageUnavailableReason | null;
  components: QuotedComponent[];
  adjustment: PackageAdjustment & { appliedCents: number };
  totals: {
    componentsSellCents: number;
    adjustmentCents: number;
    sellTotalCents: number;
    totalCents: number;
    /** staff only */
    componentsNetCents?: number;
    marginCents?: number;
  };
  kosher: { blockers: KosherFinding[]; warnings: KosherFinding[]; overridden: boolean } | null;
  /** The composite offer. Absent when the package cannot be sold. */
  token: string | null;
  /** Present only on a revalidated offer. */
  priceChanged?: boolean;
  quotedTotalCents?: number;
}

// --- recommendations --------------------------------------------------------

export interface RecommendedTransfer {
  date: string;
  from: TransferPoint;
  to: TransferPoint;
  offer: TransferOffer;
}

export interface RecommendedPackage extends PackageSummary {
  quote: {
    startDate: string;
    endDate: string;
    currency: string;
    totalCents: number;
    adjustmentCents: number;
    /** staff only */
    marginCents?: number;
  };
}

export interface Recommendations {
  anchor: { type: "HOTEL" | "TOUR"; id: string; slug: string; name: string };
  stay: { checkIn: string; checkOut: string | null; adults: number; childAges: number[] };
  transfers: { arrival: RecommendedTransfer | null; departure: RecommendedTransfer | null };
  tours: TourSearchResult[];
  packages: RecommendedPackage[];
}
