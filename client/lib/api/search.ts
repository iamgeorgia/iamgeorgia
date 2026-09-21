import { apiFetch, cachedFor, serverFetch, type RequestOptions } from "./client";
import { toQueryString, type QueryValue } from "./query";
import type { HotelAvailability, Offer, SearchResponse, StayQuery } from "@/types/booking";
import type {
  DestinationNode,
  Hotel,
  HotelSummary,
  KosherServiceLevel,
} from "@/types/catalogue";
import type { Paginated } from "@/types/partner";

/**
 * Public catalogue and dated search.
 *
 * `/hotels` browses what exists; `/search` answers what can actually be booked
 * on given dates for a given party. Conflating the two is how a site advertises
 * rooms it cannot sell, so they are separate calls with separate shapes.
 */

export interface SearchQuery extends StayQuery, Record<string, QueryValue> {
  destinationSlug?: string;
  destinationPath?: string;
  countryCode?: string;
  propertyType?: string | string[];
  minStars?: number;
  amenity?: string | string[];
  mealPlan?: string | string[];
  refundableOnly?: boolean;
  /**
   * The two kosher filters, and only two.
   *
   * Every kosher *facility* — a kosher restaurant, a Shabbat elevator, a
   * synagogue, a mikveh — is an amenity, so it travels on `amenity` above and
   * costs the search nothing new. What is left is the pair amenities cannot
   * express: a minimum level of kosher service, and whether a certificate that
   * is verified AND still valid today AND covers the property exists.
   */
  kosher?: Exclude<KosherServiceLevel, "NONE">;
  kosherCertified?: boolean;
  locale?: string;
  page?: number;
  pageSize?: number;
}

export const searchHotels = (query: SearchQuery) =>
  serverFetch<SearchResponse>(`/api/search${toQueryString(query)}`);

export const getHotelAvailability = (slug: string, query: StayQuery & { locale?: string }) =>
  serverFetch<HotelAvailability>(`/api/search/hotels/${slug}${toQueryString(query)}`);

/**
 * Re-prices an offer before checkout.
 *
 * The signature on the token proves nobody edited the price; this proves the
 * price is still real. A 409 carries both figures so the interface can say
 * "this went from X to Y" rather than failing blankly.
 */
export const quoteOffer = (token: string) =>
  apiFetch<Offer>("/api/search/offers/quote", { method: "POST", body: { token } });

// --- public catalogue -------------------------------------------------------

export const listPublicHotels = (query: Record<string, QueryValue> = {}) =>
  serverFetch<Paginated<HotelSummary>>(`/api/hotels${toQueryString(query)}`);

/**
 * The same catalogue, without forwarding cookies.
 *
 * For the sitemap and any prerender list: neither has a viewer, and both must
 * see exactly what an anonymous visitor sees. Forwarding a partner's session
 * here would publish B2B-only properties as indexable URLs.
 */
export const listPublicHotelsAnonymous = (
  query: Record<string, QueryValue> = {},
  init: RequestOptions = {},
) => apiFetch<Paginated<HotelSummary>>(`/api/hotels${toQueryString(query)}`, init);

export const getPublicHotel = (slug: string, query: { locale?: string } = {}) =>
  serverFetch<Hotel>(`/api/hotels/${slug}${toQueryString(query)}`);

export const getPublicDestinations = (query: Record<string, QueryValue> = {}) =>
  serverFetch<{ data: DestinationNode[] }>(`/api/destinations${toQueryString(query)}`);

/**
 * The same tree without the viewer's cookies, cached for ten minutes. The
 * endpoint never looks at the session, so there is nothing to forward and no
 * reason to ask the API on every page view.
 */
export const getPublicDestinationsCached = (query: Record<string, QueryValue> = {}) =>
  apiFetch<{ data: DestinationNode[] }>(`/api/destinations${toQueryString(query)}`, cachedFor(600));
