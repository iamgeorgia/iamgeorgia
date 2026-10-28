import { apiFetch, serverFetch, type RequestOptions } from "./client";
import { actAsInit, type ActAsOptions } from "./manualBookings";
import { toQueryString, type QueryValue } from "./query";
import type { Paginated } from "@/types/partner";
import type {
  KosherPackageProfile,
  PackageDetail,
  PackageQuote,
  PackageStatus,
  PackageSummary,
  PackageTranslation,
  PackageWithChecklist,
  Recommendations,
} from "@/types/package";

/**
 * Packages: the public catalogue, the quote that prices one for a party, and
 * the admin register behind them.
 *
 * The rule the whole module turns on: a package has no price until it is
 * quoted. `priceFrom` on a card is an indicative sample refreshed daily and
 * cannot be booked; only a quote's `token` can become an order. Nothing here
 * sends an amount.
 */

// --- public catalogue -------------------------------------------------------

export interface PublicPackageQuery extends Record<string, QueryValue> {
  search?: string;
  destinationSlug?: string;
  destinationPath?: string;
  kosher?: boolean;
  minNights?: number;
  maxNights?: number;
  featured?: boolean;
  locale?: string;
  page?: number;
  pageSize?: number;
}

export const listPublicPackages = (query: PublicPackageQuery = {}) =>
  serverFetch<Paginated<PackageSummary>>(`/api/packages${toQueryString(query)}`);

/** Without the viewer's cookies — for the sitemap, which has no session. */
export const listPublicPackagesAnonymous = (
  query: PublicPackageQuery = {},
  init: RequestOptions = {},
) => apiFetch<Paginated<PackageSummary>>(`/api/packages${toQueryString(query)}`, init);

/** The public catalogue from the browser, for the desk: what this buyer may book, by name. */
export const listPublicPackagesClient = (query: PublicPackageQuery = {}, options: ActAsOptions = {}) =>
  apiFetch<Paginated<PackageSummary>>(`/api/packages${toQueryString(query)}`, actAsInit(options));

export const getPublicPackage = (slug: string, query: { locale?: string } = {}) =>
  serverFetch<PackageDetail>(`/api/packages/${slug}${toQueryString(query)}`);

// --- quotes -----------------------------------------------------------------

export interface PackageQuoteQuery extends Record<string, QueryValue> {
  startDate: string;
  adults: number;
  childAges?: number[];
  rooms?: number;
  /** `{ "<slotIndex>": { ratePlanId | hotelId | vehicleId | tourOptionId } }` */
  choices?: string;
  /** Optional slots the buyer dropped. */
  exclude?: number[];
  locale?: string;
}

/**
 * Prices one package for one start date and party.
 *
 * Answers 200 even when it cannot be sold: `available: false` with
 * `unavailableReason` and a per-slot `reason`, so a date picker can say why
 * rather than throwing.
 */
export const quotePackage = (slug: string, query: PackageQuoteQuery) =>
  serverFetch<PackageQuote>(`/api/packages/${slug}/quote${toQueryString(query)}`);

/**
 * The same call from the browser, for a slot chooser that re-quotes live.
 * `asPartnerId` prices the package for that partner (`X-Act-As-Partner`).
 */
export const quotePackageClient = (slug: string, query: PackageQuoteQuery, options: ActAsOptions = {}) =>
  apiFetch<PackageQuote>(`/api/packages/${slug}/quote${toQueryString(query)}`, actAsInit(options));

/** Re-prices a composite offer. A moved price comes back with `priceChanged`. */
export const revalidatePackageOffer = (token: string) =>
  apiFetch<PackageQuote>("/api/packages/quotes/revalidate", { method: "POST", body: { token } });

// --- recommendations --------------------------------------------------------

export interface RecommendationQuery extends Record<string, QueryValue> {
  hotel?: string;
  tour?: string;
  checkIn: string;
  checkOut?: string;
  adults?: number;
  childAges?: number[];
  locale?: string;
}

/** "Complete your trip": transfers, tours and packages around one anchor. */
export const getRecommendations = (query: RecommendationQuery) =>
  serverFetch<Recommendations>(`/api/recommendations${toQueryString(query)}`);

// --- admin: register --------------------------------------------------------

export interface AdminPackageQuery extends PublicPackageQuery {
  status?: PackageStatus | PackageStatus[];
  destinationId?: string;
}

export const listPackages = (query: AdminPackageQuery = {}) =>
  serverFetch<Paginated<PackageSummary>>(`/api/admin/packages${toQueryString(query)}`);

export const getPackage = (id: string, query: { locale?: string } = {}) =>
  serverFetch<PackageWithChecklist>(`/api/admin/packages/${id}${toQueryString(query)}`);

/** One slot of the template. Only the fields of its own type are read. */
export interface PackageComponentInput {
  componentType: "HOTEL_STAY" | "TRANSFER" | "TOUR" | "SERVICE";
  label: string;
  required?: boolean;
  dayOffset?: number;
  nights?: number | null;
  timeOfDay?: string | null;
  quantityRule?: "ONE" | "PER_PERSON" | "PER_ROOM";
  hotelId?: string | null;
  allowedRoomTypeIds?: string[];
  allowedRatePlanIds?: string[];
  allowedMealPlanCodes?: string[];
  fromPointId?: string | null;
  toPointId?: string | null;
  routeId?: string | null;
  allowedVehicleClasses?: string[];
  tripType?: string | null;
  tourId?: string | null;
  allowedTourOptionIds?: string[];
  serviceId?: string | null;
  kosherMinServiceLevel?: string | null;
  kosherCertifiedRequired?: boolean | null;
  kosherCertificationScopes?: string[];
}

export interface PackageInput {
  slug: string;
  name: string;
  destinationId: string;
  summary?: string;
  description?: string[];
  image?: string | null;
  nights: number;
  currency?: string;
  timezone?: string;
  b2cEnabled?: boolean;
  featured?: boolean;
  sortOrder?: number;
  minAdults?: number;
  maxAdults?: number | null;
  maxChildren?: number | null;
  maxPax?: number | null;
  adjustmentKind?: "NONE" | "DISCOUNT_BPS" | "FIXED_SELL" | "PER_PERSON_FIXED";
  adjustmentValue?: number;
  adjustmentAppliesTo?: "REQUIRED_ONLY" | "ALL_ITEMS";
  sellableFrom?: string | null;
  sellableUntil?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  components?: PackageComponentInput[];
}

/**
 * Creates a DRAFT. A slot the template cannot honour answers 422 with
 * `details.problems: [{ slotIndex, code, message }]`, so the builder can put
 * the message on the offending row rather than at the top of the form.
 */
export const createPackage = (body: PackageInput) =>
  apiFetch<PackageWithChecklist>("/api/admin/packages", { method: "POST", body });

/** Components are replaced whole whenever `components` is present. */
export const updatePackage = (id: string, body: Partial<PackageInput>) =>
  apiFetch<PackageWithChecklist>(`/api/admin/packages/${id}`, { method: "PATCH", body });

/** 422 with `details.missing` until the checklist is clear. */
export const publishPackage = (id: string) =>
  apiFetch<PackageWithChecklist>(`/api/admin/packages/${id}/publish`, { method: "POST" });

export const unpublishPackage = (id: string) =>
  apiFetch<PackageWithChecklist>(`/api/admin/packages/${id}/unpublish`, { method: "POST" });

export const archivePackage = (id: string, reason?: string) =>
  apiFetch<PackageWithChecklist>(`/api/admin/packages/${id}/archive`, {
    method: "POST",
    body: reason ? { reason } : {},
  });

/** Hard delete; 409 `HAS_ORDERS` the moment one was ever sold. */
export const deletePackage = (id: string) =>
  apiFetch<void>(`/api/admin/packages/${id}`, { method: "DELETE" });

/** The real quote for a draft, with staff figures: what a partner would see. */
export const previewPackageQuote = (id: string, query: PackageQuoteQuery) =>
  serverFetch<PackageQuote>(`/api/admin/packages/${id}/preview-quote${toQueryString(query)}`);

export const previewPackageQuoteClient = (id: string, query: PackageQuoteQuery) =>
  apiFetch<PackageQuote>(`/api/admin/packages/${id}/preview-quote${toQueryString(query)}`);

// --- admin: kosher ----------------------------------------------------------

export type KosherProfileInput = Partial<Omit<KosherPackageProfile, "extraRestDays">> & {
  extraRestDays?: { from: string; to: string; label?: string }[];
};

/**
 * Creating the profile is the switch: a package without one shows no kosher
 * block anywhere. 422 `KOSHER_INELIGIBLE` lists the slots in the way.
 */
export const setPackageKosher = (id: string, body: KosherProfileInput) =>
  apiFetch<PackageWithChecklist>(`/api/admin/packages/${id}/kosher`, { method: "PUT", body });

export const removePackageKosher = (id: string) =>
  apiFetch<PackageWithChecklist>(`/api/admin/packages/${id}/kosher`, { method: "DELETE" });

/** Sells past a blocker until a date. Audited, never silent. */
export const overridePackageKosher = (id: string, body: { until: string; reason: string }) =>
  apiFetch<PackageWithChecklist>(`/api/admin/packages/${id}/kosher/override`, {
    method: "PUT",
    body,
  });

/** What a kosher package may ask of a tour it contains. */
export const setTourKosher = (
  tourId: string,
  body: { kosherMealsAvailable: boolean; operatesOnShabbat: boolean; notes?: string | null },
) => apiFetch(`/api/admin/tours/${tourId}/kosher`, { method: "PUT", body });

// --- admin: translations and images -----------------------------------------

export const listPackageTranslations = (id: string) =>
  serverFetch<{ data: PackageTranslation[] }>(`/api/admin/packages/${id}/translations`);

export const setPackageTranslation = (
  id: string,
  locale: string,
  body: { name?: string | null; summary?: string | null; description?: string[] },
) => apiFetch<PackageTranslation>(`/api/admin/packages/${id}/translations/${locale}`, {
  method: "PUT",
  body,
});

export const attachPackageImage = (
  id: string,
  body: { fileAssetId: string; caption?: string | null; isCover?: boolean },
) => apiFetch(`/api/admin/packages/${id}/images`, { method: "POST", body });

export const updatePackageImage = (
  id: string,
  imageId: string,
  body: { caption?: string | null; sortOrder?: number; isCover?: boolean },
) => apiFetch(`/api/admin/packages/${id}/images/${imageId}`, { method: "PATCH", body });

export const detachPackageImage = (id: string, imageId: string) =>
  apiFetch<void>(`/api/admin/packages/${id}/images/${imageId}`, { method: "DELETE" });

export const reorderPackageImages = (id: string, order: string[]) =>
  apiFetch(`/api/admin/packages/${id}/images/order`, { method: "PUT", body: { order } });
