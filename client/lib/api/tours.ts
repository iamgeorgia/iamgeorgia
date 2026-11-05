import { apiFetch, serverFetch, type RequestOptions } from "./client";
import { actAsInit, type ActAsOptions } from "./manualBookings";
import { toQueryString, type QueryValue } from "./query";
import type { CancellationPolicy } from "@/types/catalogue";
import type { Paginated } from "@/types/partner";
import type {
  AmendTourBookingInput,
  ConfirmTourBookingInput,
  Tour,
  TourAvailability,
  TourBooking,
  TourBookingQuery,
  TourBookingSummary,
  TourCalendar,
  TourCancellationQuote,
  TourHold,
  TourInventoryRangeInput,
  TourInventoryWriteResult,
  TourOffer,
  TourOption,
  TourSearchResponse,
  TourStatus,
  TourSummary,
  TourTranslation,
  TourTranslationInput,
  TourWithChecklist,
} from "@/types/tour";

/**
 * Tours: the public catalogue, dated search, holds and bookings, and the
 * admin register behind them.
 *
 * Split by where the call runs, as everywhere in `lib/api`: reads that happen
 * during a render use `serverFetch` so the session cookie is forwarded;
 * mutations fired from a button use `apiFetch`. Nothing here sends an amount —
 * the server prices every departure from the signed offer and the request
 * schemas are strict, so a body carrying a price is a 400.
 */

// --- public catalogue -------------------------------------------------------

export interface PublicTourQuery extends Record<string, QueryValue> {
  search?: string;
  destinationSlug?: string;
  destinationPath?: string;
  category?: string | string[];
  difficulty?: string | string[];
  minDays?: number;
  maxDays?: number;
  featured?: boolean;
  locale?: string;
  page?: number;
  pageSize?: number;
}

export const listPublicTours = (query: PublicTourQuery = {}) =>
  serverFetch<Paginated<TourSummary>>(`/api/tours${toQueryString(query)}`);

/**
 * The same programme, without forwarding cookies — for the sitemap, which has
 * no viewer and must publish only what an anonymous visitor can open. See the
 * note on `listPublicHotelsAnonymous`.
 */
export const listPublicToursAnonymous = (
  query: PublicTourQuery = {},
  init: RequestOptions = {},
) => apiFetch<Paginated<TourSummary>>(`/api/tours${toQueryString(query)}`, init);

export const getPublicTour = (slug: string, query: { locale?: string } = {}) =>
  serverFetch<Tour>(`/api/tours/${slug}${toQueryString(query)}`);

// --- dated search -----------------------------------------------------------

export interface TourSearchQuery extends PublicTourQuery {
  date?: string;
  adults?: number;
  childAges?: number[];
}

/** With a date: tours with a bookable departure that day. Without: the catalogue. */
export const searchTours = (query: TourSearchQuery) =>
  serverFetch<TourSearchResponse>(`/api/search/tours${toQueryString(query)}`);

export interface TourAvailabilityQuery extends Record<string, QueryValue> {
  date?: string;
  from?: string;
  to?: string;
  adults: number;
  childAges: number[];
  locale?: string;
}

/** Every option of one tour, priced for every departure in a window of up to 62 days. */
export const getTourAvailability = (slug: string, query: TourAvailabilityQuery) =>
  serverFetch<TourAvailability>(`/api/search/tours/${slug}${toQueryString(query)}`);

/**
 * The same searches from the browser, for the desk. `asPartnerId` prices the
 * departures for that partner (`X-Act-As-Partner`).
 */
export const searchToursClient = (query: TourSearchQuery, options: ActAsOptions = {}) =>
  apiFetch<TourSearchResponse>(`/api/search/tours${toQueryString(query)}`, actAsInit(options));

export const getTourAvailabilityClient = (slug: string, query: TourAvailabilityQuery, options: ActAsOptions = {}) =>
  apiFetch<TourAvailability>(`/api/search/tours/${slug}${toQueryString(query)}`, actAsInit(options));

export const listPublicToursClient = (query: PublicTourQuery = {}, options: ActAsOptions = {}) =>
  apiFetch<Paginated<TourSummary>>(`/api/tours${toQueryString(query)}`, actAsInit(options));

/** Re-prices an offer. A moved price comes back with `priceChanged: true`. */
export const quoteTourOffer = (token: string) =>
  apiFetch<TourOffer>("/api/search/tours/offers/quote", { method: "POST", body: { token } });

// --- holds and bookings -----------------------------------------------------

/** Secures the seats while the traveller fills in the form. 409 if gone. */
export const createTourHold = (token: string) =>
  apiFetch<TourHold>("/api/tours/bookings/holds", { method: "POST", body: { token } });

/** Abandoning checkout. Always succeeds, even if already released. */
export const releaseTourHold = (token: string) =>
  apiFetch<void>(`/api/tours/bookings/holds/${token}`, { method: "DELETE" });

/**
 * Confirms — or, for an on-request option, requests — a booking.
 *
 * The idempotency key is what makes a double-clicked button return the first
 * booking rather than take a second set of seats.
 */
export const confirmTourBooking = (body: ConfirmTourBookingInput) =>
  apiFetch<TourBooking>("/api/tours/bookings", {
    method: "POST",
    body,
    headers: body.idempotencyKey ? { "idempotency-key": body.idempotencyKey } : undefined,
  });

/** A guest reading their own booking: the reference alone is not a credential. */
export const getGuestTourBooking = (reference: string, email: string) =>
  serverFetch<TourBooking>(`/api/tours/bookings/${reference}${toQueryString({ email })}`);

/** A signed-in partner reading one of its own; anyone else's is a 404. */
export const getPartnerTourBooking = (reference: string) =>
  serverFetch<TourBooking>(`/api/tours/bookings/${reference}`);

export const getTourCancellationQuote = (reference: string, email?: string) =>
  serverFetch<TourCancellationQuote>(
    `/api/tours/bookings/${reference}/cancellation-quote${toQueryString({ email })}`,
  );

export const amendTourBooking = (reference: string, body: AmendTourBookingInput) =>
  apiFetch<TourBooking>(`/api/tours/bookings/${reference}`, { method: "PATCH", body });

export const cancelTourBooking = (
  reference: string,
  body: { reason?: string; email?: string } = {},
) =>
  apiFetch<TourBookingSummary & { cancellation: TourCancellationQuote }>(
    `/api/tours/bookings/${reference}/cancel`,
    { method: "POST", body },
  );

export const listPartnerTourBookings = (query: TourBookingQuery = {}) =>
  serverFetch<Paginated<TourBookingSummary>>(`/api/partner/tours/bookings${toQueryString(query)}`);

// --- admin: register --------------------------------------------------------

export interface AdminTourQuery extends PublicTourQuery {
  status?: TourStatus | TourStatus[];
  supplierId?: string;
}

export const listTours = (query: AdminTourQuery = {}) =>
  serverFetch<Paginated<TourSummary>>(`/api/admin/tours${toQueryString(query)}`);

export const getTour = (id: string, query: { locale?: string } = {}) =>
  serverFetch<TourWithChecklist>(`/api/admin/tours/${id}${toQueryString(query)}`);

/** The same two reads from the browser, for the admin pickers. */
export const listToursClient = (query: AdminTourQuery = {}) =>
  apiFetch<Paginated<TourSummary>>(`/api/admin/tours${toQueryString(query)}`);

export const getTourClient = (id: string) =>
  apiFetch<TourWithChecklist>(`/api/admin/tours/${id}`);

export interface CreateTourInput {
  slug: string;
  title: string;
  location: string;
  destinationId: string;
  category: string;
  summary: string;
  durationDays: number;
  durationLabel: string;
  groupSize: string;
  difficulty: string;
  meetingPoint: string;
  supplierId?: string | null;
  currency?: string;
}

/** Creates a DRAFT with a `publishChecklist` naming everything still to do. */
export const createTour = (body: CreateTourInput) =>
  apiFetch<TourWithChecklist>("/api/admin/tours", { method: "POST", body });

export const updateTour = (id: string, body: Record<string, unknown>) =>
  apiFetch<TourWithChecklist>(`/api/admin/tours/${id}`, { method: "PATCH", body });

/** 422 with `details.missing` until the checklist is clear. */
export const publishTour = (id: string) =>
  apiFetch<TourWithChecklist>(`/api/admin/tours/${id}/publish`, { method: "POST" });

export const unpublishTour = (id: string) =>
  apiFetch<TourWithChecklist>(`/api/admin/tours/${id}/unpublish`, { method: "POST" });

export const archiveTour = (id: string, reason?: string) =>
  apiFetch<TourWithChecklist>(`/api/admin/tours/${id}/archive`, {
    method: "POST",
    body: reason ? { reason } : {},
  });

/** Hard delete; 409 `HAS_BOOKINGS` the moment anything was ever sold. */
export const deleteTour = (id: string) =>
  apiFetch<void>(`/api/admin/tours/${id}`, { method: "DELETE" });

/** Every translation a tour has; English is the tour record itself. */
export const listTourTranslations = (id: string) =>
  serverFetch<{ data: TourTranslation[] }>(`/api/admin/tours/${id}/translations`);

/** The platform cancellation templates a tour option may use. */
export const listTourCancellationPolicies = () =>
  serverFetch<{ data: CancellationPolicy[] }>("/api/admin/tours/policies/cancellation");

export const setTourTranslation = (id: string, locale: string, body: TourTranslationInput) =>
  apiFetch<TourTranslation>(`/api/admin/tours/${id}/translations/${locale}`, {
    method: "PUT",
    body,
  });

// --- admin: images ----------------------------------------------------------

export const attachTourImage = (
  id: string,
  body: { fileAssetId: string; caption?: string | null; isCover?: boolean },
) => apiFetch(`/api/admin/tours/${id}/images`, { method: "POST", body });

export const updateTourImage = (
  id: string,
  imageId: string,
  body: { caption?: string | null; sortOrder?: number; isCover?: boolean },
) => apiFetch(`/api/admin/tours/${id}/images/${imageId}`, { method: "PATCH", body });

export const detachTourImage = (id: string, imageId: string) =>
  apiFetch<void>(`/api/admin/tours/${id}/images/${imageId}`, { method: "DELETE" });

export const reorderTourImages = (id: string, order: string[]) =>
  apiFetch(`/api/admin/tours/${id}/images/order`, { method: "PUT", body: { order } });

// --- admin: options, price sheets, departures -------------------------------

export const createTourOption = (tourId: string, body: Record<string, unknown>) =>
  apiFetch<TourOption>(`/api/admin/tours/${tourId}/options`, { method: "POST", body });

export const updateTourOption = (tourId: string, optionId: string, body: Record<string, unknown>) =>
  apiFetch<TourOption>(`/api/admin/tours/${tourId}/options/${optionId}`, {
    method: "PATCH",
    body,
  });

export const archiveTourOption = (tourId: string, optionId: string) =>
  apiFetch<TourOption>(`/api/admin/tours/${tourId}/options/${optionId}/archive`, {
    method: "POST",
  });

export interface TourSeasonInput {
  name: string;
  validFrom: string;
  validUntil: string;
  weekdays?: number[];
  priority?: number;
  currency?: string;
  isActive?: boolean;
  tiers: {
    minPax: number;
    maxPax?: number | null;
    adultNetCents?: number | null;
    childNetCents?: number | null;
    infantNetCents?: number;
    groupNetCents?: number | null;
    adultSellCents?: number | null;
    childSellCents?: number | null;
    groupSellCents?: number | null;
  }[];
}

/** A season is written whole, tiers included; the tour's "from" price follows. */
export const createTourSeason = (tourId: string, optionId: string, body: TourSeasonInput) =>
  apiFetch<TourOption>(`/api/admin/tours/${tourId}/options/${optionId}/seasons`, {
    method: "POST",
    body,
  });

export const updateTourSeason = (
  tourId: string,
  optionId: string,
  seasonId: string,
  body: TourSeasonInput,
) =>
  apiFetch<TourOption>(`/api/admin/tours/${tourId}/options/${optionId}/seasons/${seasonId}`, {
    method: "PUT",
    body,
  });

export const deleteTourSeason = (tourId: string, optionId: string, seasonId: string) =>
  apiFetch<void>(`/api/admin/tours/${tourId}/options/${optionId}/seasons/${seasonId}`, {
    method: "DELETE",
  });

export const getTourCalendar = (
  tourId: string,
  optionId: string,
  range: { from: string; to: string },
) =>
  serverFetch<TourCalendar>(
    `/api/admin/tours/${tourId}/options/${optionId}/inventory/calendar${toQueryString(range)}`,
  );

/** A range write; 409 `OVERSELL` names the dates already committed past the new total. */
export const setTourInventory = (
  tourId: string,
  optionId: string,
  body: TourInventoryRangeInput,
) =>
  apiFetch<TourInventoryWriteResult>(`/api/admin/tours/${tourId}/options/${optionId}/inventory`, {
    method: "PUT",
    body,
  });

// --- admin: bookings --------------------------------------------------------

export const listAdminTourBookings = (query: TourBookingQuery = {}) =>
  serverFetch<Paginated<TourBookingSummary>>(`/api/admin/tours/bookings${toQueryString(query)}`);

export const getAdminTourBooking = (reference: string) =>
  serverFetch<TourBooking>(`/api/admin/tours/bookings/${reference}`);

/** The operator's answer to an on-request booking. */
export const confirmTourRequest = (reference: string) =>
  apiFetch<TourBooking>(`/api/admin/tours/bookings/${reference}/confirm`, { method: "POST" });

/** Declining releases the seats and charges nothing; the reason reaches the agency. */
export const declineTourRequest = (reference: string, reason: string) =>
  apiFetch<TourBooking>(`/api/admin/tours/bookings/${reference}/decline`, {
    method: "POST",
    body: { reason },
  });

export const cancelTourBookingAsAdmin = (reference: string, reason?: string) =>
  apiFetch<TourBookingSummary & { cancellation: TourCancellationQuote }>(
    `/api/admin/tours/bookings/${reference}/cancel`,
    { method: "POST", body: reason ? { reason } : {} },
  );
