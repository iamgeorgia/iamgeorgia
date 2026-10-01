import { apiFetch, cachedFor, serverFetch, type RequestOptions } from "./client";
import { toQueryString } from "./query";
import type { AvailableDrivers } from "@/types/driver";
import type { PlaceRef } from "@/types/geo";
import type { Paginated } from "@/types/partner";
import type {
  AmendTransferInput,
  ConfirmTransferInput,
  TransferBlackout,
  TransferBooking,
  TransferBookingSummary,
  TransferCancellationQuote,
  TransferExtra,
  TransferExtraBasis,
  TransferFeature,
  TransferKind,
  TransferOffer,
  TransferPoint,
  TransferPointKind,
  TransferProvider,
  TransferQuoteResult,
  TransferRoute,
  TransferRouteCategory,
  TransferRouteTier,
  TransferRouteWithChecklist,
  TransferStatus,
  TransferVehicle,
  TransferVehicleBody,
  TransferVehicleClass,
} from "@/types/transfer";

/**
 * The transfer endpoints.
 *
 * Nothing here sends an amount. The server re-prices the journey from the
 * catalogue before it will confirm anything, and the request schema is strict —
 * a body carrying a fare is a 400, not a silently ignored field.
 *
 * Reads are `serverFetch` where a page renders them and `apiFetch` where a
 * component asks as the traveller types. The picker is the second kind, which
 * is why `searchPoints` is the one read that does not forward cookies.
 */

export interface TransferQuoteQuery {
  from: string;
  to: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** 24-hour `HH:mm`, wall clock at the pick-up point. */
  time: string;
  tripType?: "ONE_WAY" | "RETURN";
  returnDate?: string;
  returnTime?: string;
  adults?: number;
  children?: number;
  luggage?: number;
  cabinBags?: number;
  /** Repeated as `extra=childSeat&extra=skiEquipment`. */
  extra?: string[];
  locale?: string;
}

export interface TransferRouteQuery {
  tier?: TransferRouteTier | TransferRouteTier[];
  category?: TransferRouteCategory | TransferRouteCategory[];
  featured?: boolean;
  fromSlug?: string;
  toSlug?: string;
  search?: string;
  locale?: string;
  page?: number;
  pageSize?: number;
}

// --- public reads ------------------------------------------------------------

export const listTransferPoints = (
  query: { search?: string; kind?: TransferPointKind; popular?: boolean; locale?: string } = {},
) => serverFetch<{ data: TransferPoint[] }>(`/api/transfers/points${toQueryString(query)}`);

/**
 * Public reads that do not depend on the viewer, served from Next's data cache.
 *
 * The points list and the route catalogue are the same answer for an
 * anonymous visitor and a signed-in partner (only an admin sees extra fields,
 * and no public page reads those), so the landing pages ask without cookies
 * and keep the answer for a while instead of a round trip per page view.
 */
const CATALOGUE_TTL = 600;

export const listTransferPointsCached = (
  query: { kind?: TransferPointKind; popular?: boolean; locale?: string } = {},
) =>
  apiFetch<{ data: TransferPoint[] }>(
    `/api/transfers/points${toQueryString(query)}`,
    cachedFor(CATALOGUE_TTL),
  );

export const listTransferRoutesCached = (query: TransferRouteQuery = {}) =>
  apiFetch<Paginated<TransferRoute>>(
    `/api/transfers/routes${toQueryString(query)}`,
    cachedFor(CATALOGUE_TTL),
  );

export const getTransferRouteCached = (slug: string, locale?: string) =>
  apiFetch<TransferRoute>(
    `/api/transfers/routes/${slug}${toQueryString({ locale })}`,
    cachedFor(CATALOGUE_TTL),
  );

/** The picker, called from the browser as the traveller types. */
export const searchTransferPoints = (search: string, locale?: string) =>
  apiFetch<{ data: TransferPoint[] }>(
    `/api/transfers/points${toQueryString({ search, locale })}`,
  );

export const listTransferRoutes = (query: TransferRouteQuery = {}) =>
  serverFetch<Paginated<TransferRoute>>(`/api/transfers/routes${toQueryString(query)}`);

/**
 * The same list, without forwarding cookies.
 *
 * `generateStaticParams` runs at build time with no request in scope, and
 * `serverFetch` reads `next/headers` — which throws there. The route catalogue
 * is public, so there is nothing to forward anyway; this is the read a
 * prerender list should have been making all along.
 */
export const listTransferRoutesForBuild = (
  query: TransferRouteQuery = {},
  init: RequestOptions = {},
) => apiFetch<Paginated<TransferRoute>>(`/api/transfers/routes${toQueryString(query)}`, init);

export const getTransferRoute = (slug: string, locale?: string) =>
  serverFetch<TransferRoute>(`/api/transfers/routes/${slug}${toQueryString({ locale })}`);

export const listTransferVehicles = (query: { locale?: string } = {}) =>
  serverFetch<{ data: TransferVehicle[] }>(`/api/transfers/vehicles${toQueryString(query)}`);

/** Without the viewer's cookies — for the sitemap, which has no session. */
export const listTransferVehiclesAnonymous = (
  query: { locale?: string } = {},
  init: RequestOptions = {},
) => apiFetch<{ data: TransferVehicle[] }>(`/api/transfers/vehicles${toQueryString(query)}`, init);

export const getTransferVehicle = (slug: string, locale?: string) =>
  serverFetch<TransferVehicle>(`/api/transfers/vehicles/${slug}${toQueryString({ locale })}`);

export const listTransferExtras = () =>
  serverFetch<{ data: TransferExtra[] }>("/api/transfers/extras");

/**
 * Every vehicle that can carry the party, priced for the journey.
 *
 * A `404` means we do not serve one of the two places; a `422` carries a
 * `reason` explaining why the journey cannot be run. Both are answers, and the
 * page should say so rather than showing an error.
 */
export const quoteTransfers = (query: TransferQuoteQuery) =>
  serverFetch<TransferQuoteResult>(`/api/transfers/quotes${toQueryString(query)}`);

/** The same call from the browser, for a results page that refines in place. */
export const quoteTransfersClient = (query: TransferQuoteQuery) =>
  apiFetch<TransferQuoteResult>(`/api/transfers/quotes${toQueryString(query)}`);

/**
 * Re-prices a token that has been sitting in a tab.
 *
 * Deliberately not strict: it answers with the current fare rather than
 * refusing, so a stale results page can update itself. Booking re-prices the
 * same token strictly and gets a 409 instead.
 */
export const revalidateTransferQuote = (token: string) =>
  apiFetch<TransferOffer>("/api/transfers/quotes/revalidate", {
    method: "POST",
    body: { token },
  });

// --- bookings ----------------------------------------------------------------

/**
 * Confirms a transfer.
 *
 * Pass an `idempotencyKey` and a retry returns the original booking rather than
 * dispatching a second car — which is what stops a double-clicked submit button
 * booking two.
 */
export const confirmTransferBooking = (body: ConfirmTransferInput) =>
  apiFetch<TransferBooking>("/api/transfers/bookings", {
    method: "POST",
    body,
    headers: body.idempotencyKey ? { "idempotency-key": body.idempotencyKey } : undefined,
  });

/**
 * A traveller reading their own booking during a server render.
 *
 * The email is not decoration: references come from a sequence and are
 * trivially enumerable, so the reference alone is not a credential.
 */
export const getTransferBooking = (reference: string, email?: string) =>
  serverFetch<TransferBooking>(
    `/api/transfers/bookings/${reference}${toQueryString({ email })}`,
  );

export const getTransferCancellationQuote = (reference: string, email?: string) =>
  serverFetch<TransferCancellationQuote>(
    `/api/transfers/bookings/${reference}/cancellation-quote${toQueryString({ email })}`,
  );

export const amendTransferBooking = (reference: string, body: AmendTransferInput) =>
  apiFetch<TransferBooking>(`/api/transfers/bookings/${reference}`, { method: "PATCH", body });

export const cancelTransferBooking = (
  reference: string,
  body: { reason?: string; email?: string } = {},
) =>
  apiFetch<TransferBookingSummary & { cancellation: TransferCancellationQuote }>(
    `/api/transfers/bookings/${reference}/cancel`,
    { method: "POST", body },
  );

// --- admin -------------------------------------------------------------------

export interface AdminTransferBookingQuery {
  status?: string | string[];
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export const listAdminTransferBookings = (query: AdminTransferBookingQuery = {}) =>
  serverFetch<Paginated<TransferBookingSummary>>(
    `/api/admin/transfers/bookings${toQueryString(query)}`,
  );

export const getAdminTransferBooking = (reference: string) =>
  serverFetch<TransferBooking>(`/api/admin/transfers/bookings/${reference}`);

export const cancelTransferBookingAsAdmin = (reference: string, reason?: string) =>
  apiFetch<TransferBookingSummary & { cancellation: TransferCancellationQuote }>(
    `/api/admin/transfers/bookings/${reference}/cancel`,
    { method: "POST", body: reason ? { reason } : {} },
  );

export const listAdminTransferRoutes = (query: TransferRouteQuery = {}) =>
  serverFetch<Paginated<TransferRoute>>(`/api/admin/transfers/routes${toQueryString(query)}`);

export const getAdminTransferRoute = (id: string) =>
  serverFetch<TransferRouteWithChecklist>(`/api/admin/transfers/routes/${id}`);

export const listAdminTransferVehicles = () =>
  serverFetch<{ data: TransferVehicle[] }>("/api/admin/transfers/vehicles");

/** One class, with the staff-only fallback fare the editor needs. */
export const getAdminTransferVehicle = (id: string) =>
  serverFetch<TransferVehicle>(`/api/admin/transfers/vehicles/${id}`);

export const listAdminTransferPoints = (query: { search?: string } = {}) =>
  serverFetch<{ data: TransferPoint[] }>(`/api/admin/transfers/points${toQueryString(query)}`);

/**
 * The same two catalogues, read from the browser.
 *
 * The admin pickers search as an operator types, which cannot go through
 * `serverFetch` — that one reads `next/headers`. They are separate exports
 * rather than a flag on the calls above so a Server Component cannot pick the
 * browser variant by accident and lose its forwarded session.
 */
export const listAdminTransferPointsClient = (query: { search?: string } = {}) =>
  apiFetch<{ data: TransferPoint[] }>(`/api/admin/transfers/points${toQueryString(query)}`);

export const listAdminTransferRoutesClient = (query: TransferRouteQuery = {}) =>
  apiFetch<Paginated<TransferRoute>>(`/api/admin/transfers/routes${toQueryString(query)}`);

export const listAdminTransferExtras = () =>
  serverFetch<{ data: TransferExtra[] }>("/api/admin/transfers/extras");

export const listAdminTransferBlackouts = (query: { routeId?: string; vehicleId?: string } = {}) =>
  serverFetch<{ data: TransferBlackout[] }>(
    `/api/admin/transfers/blackouts${toQueryString(query)}`,
  );

/** The whole grid at once, so a half-applied set of prices cannot happen. */
export const setTransferRoutePrices = (
  id: string,
  prices: { vehicleId: string; oneWayCents: number; returnCents?: number | null }[],
) =>
  apiFetch<TransferRouteWithChecklist>(`/api/admin/transfers/routes/${id}/prices`, {
    method: "PUT",
    body: { prices },
  });

export const publishTransferRoute = (id: string) =>
  apiFetch<TransferRouteWithChecklist>(`/api/admin/transfers/routes/${id}/publish`, {
    method: "POST",
  });

export const unpublishTransferRoute = (id: string) =>
  apiFetch<TransferRoute>(`/api/admin/transfers/routes/${id}/unpublish`, { method: "POST" });

/**
 * Everything about a route except its fares and its stops, which have grids of
 * their own. `slug` is accepted by the server but deliberately absent here: it
 * is a public URL that is already indexed, and changing one belongs in a
 * redirect conversation rather than in a copy editor.
 */
export const updateTransferRoute = (
  id: string,
  body: Partial<{
    title: string | null;
    summary: string | null;
    description: string[];
    tier: TransferRouteTier;
    category: TransferRouteCategory;
    distanceKm: number;
    durationMinutes: number;
    heroImage: string | null;
    featured: boolean;
    status: TransferStatus;
  }>,
) => apiFetch<TransferRouteWithChecklist>(`/api/admin/transfers/routes/${id}`, {
  method: "PATCH",
  body,
});

/**
 * The bulk price editor.
 *
 * A filter is required — there is deliberately no way to reprice the whole
 * catalogue in one call, because a mis-click that did is not recoverable from
 * the panel.
 */
export const bulkPriceTransferRoutes = (body: {
  tier?: TransferRouteTier | TransferRouteTier[];
  category?: TransferRouteCategory | TransferRouteCategory[];
  routeIds?: string[];
  vehicleIds: string[];
  perKmCents?: number;
  flatCents?: number;
  minimumCents?: number;
  overwrite?: boolean;
}) =>
  apiFetch<{ routes: number; written: number; kept: number }>(
    "/api/admin/transfers/routes/prices",
    { method: "PUT", body },
  );

export const createTransferBlackout = (body: {
  routeId?: string;
  vehicleId?: string;
  from: string;
  to: string;
  reason?: string;
}) => apiFetch<TransferBlackout>("/api/admin/transfers/blackouts", { method: "POST", body });

export const deleteTransferBlackout = (id: string) =>
  apiFetch<void>(`/api/admin/transfers/blackouts/${id}`, { method: "DELETE" });

export const updateTransferVehicle = (
  id: string,
  body: Partial<TransferVehicleInput> & { status?: TransferStatus },
) => apiFetch<TransferVehicle>(`/api/admin/transfers/vehicles/${id}`, { method: "PATCH", body });

/* --- Catalogue maintenance ------------------------------------------------
 *
 * Everything below writes. Two conventions worth stating once, because they
 * are the difference between "delete" meaning what an operator expects and
 * meaning what the database can survive:
 *
 * A point, a vehicle class and an extra are all **retired, never removed**.
 * Routes reference points with `Restrict`, bookings reference all three for
 * reporting, and a support conversation six months later still has to be able
 * to say what the traveller bought. The panel says "retire" where the effect
 * is a status change, and the endpoints below name the verb the server offers.
 *
 * Prices never travel on a create: a vehicle class carries its fallback fare
 * because that fare *is* part of the class, but a route is priced through
 * `setTransferRoutePrices` afterwards, on a screen that shows the whole grid.
 */

export interface TransferPointInput {
  slug: string;
  name: string;
  kind: TransferPointKind;
  /** Airports only, and exactly three letters. Omitted rather than empty. */
  iataCode?: string;
  regionLabel: string;
  latitude: number;
  longitude: number;
  /** What the place search said, when the position came from it. */
  place?: PlaceRef | null;
  timezone?: string;
  popular?: boolean;
  image?: string | null;
}

export const getAdminTransferPoint = (id: string) =>
  serverFetch<TransferPoint>(`/api/admin/transfers/points/${id}`);

export const createTransferPoint = (body: TransferPointInput) =>
  apiFetch<TransferPoint>("/api/admin/transfers/points", { method: "POST", body });

/**
 * `iataCode` is nullable here where it is merely optional on the create input,
 * mirroring the two server schemas. An omitted key means "leave it alone", so
 * a point that has stopped being an airport needs a way to say "clear this",
 * and `null` is it.
 */
export const updateTransferPoint = (
  id: string,
  // `Omit` before the intersection, not alongside it: intersecting an
  // optional `string` with `string | null` narrows to `string` rather than
  // widening, so the nullable field has to replace the original outright.
  body: Omit<Partial<TransferPointInput>, "iataCode"> & {
    iataCode?: string | null;
    status?: TransferStatus;
  },
) => apiFetch<TransferPoint>(`/api/admin/transfers/points/${id}`, { method: "PATCH", body });

/**
 * Retires a point.
 *
 * `DELETE` is the verb the server offers and the one an admin reaches for, but
 * what happens is a status change to INACTIVE — routes hold this row with
 * `Restrict`, so a real delete would either fail or take history with it.
 * Reversible through `updateTransferPoint(id, { status: "ACTIVE" })`.
 */
export const retireTransferPoint = (id: string) =>
  apiFetch<TransferPoint>(`/api/admin/transfers/points/${id}`, { method: "DELETE" });

export interface TransferVehicleInput {
  slug: string;
  name: string;
  vehicleClass: TransferVehicleClass;
  body: TransferVehicleBody;
  kind: TransferKind;
  providerId: string;
  maxPassengers: number;
  maxLuggage: number;
  maxCabinBags: number;
  features: TransferFeature[];
  vehicleExample: string;
  summary: string;
  description: string[];
  included: string[];
  excluded: string[];
  pickupProcedure: string;
  perKmCents: number;
  /** Strictly positive — a minimum of zero lets the engine quote a free ride. */
  minimumFareCents: number;
  airportFeeCents: number;
  recommendedRank: number;
  b2cEnabled: boolean;
}

export const listAdminTransferProviders = () =>
  serverFetch<{ data: TransferProvider[] }>("/api/admin/transfers/providers");

export const createTransferVehicle = (body: TransferVehicleInput) =>
  apiFetch<TransferVehicle>("/api/admin/transfers/vehicles", { method: "POST", body });

/**
 * Archives a vehicle class.
 *
 * A `POST` rather than a `DELETE`, because that is what it is: the class stops
 * being sold and drops out of the public channel, and every booking that ever
 * chose it keeps resolving. Bookings hold the row.
 */
export const archiveTransferVehicle = (id: string) =>
  apiFetch<TransferVehicle>(`/api/admin/transfers/vehicles/${id}/archive`, { method: "POST" });

export interface TransferRouteInput {
  slug: string;
  fromPointId: string;
  toPointId: string;
  tier: TransferRouteTier;
  category: TransferRouteCategory;
  /** Both seeded from the coordinates when omitted, and overridable after. */
  distanceKm?: number;
  durationMinutes?: number;
  title?: string | null;
  summary?: string | null;
  featured?: boolean;
}

export const createTransferRoute = (body: TransferRouteInput) =>
  apiFetch<TransferRouteWithChecklist>("/api/admin/transfers/routes", { method: "POST", body });

/** Takes a route off sale for good. Bookings keep their frozen snapshot. */
export const archiveTransferRoute = (id: string) =>
  apiFetch<TransferRoute>(`/api/admin/transfers/routes/${id}/archive`, { method: "POST" });

export interface TransferExtraInput {
  code: string;
  name: string;
  description?: string | null;
  basis: TransferExtraBasis;
  /**
   * Minor units — except on a PERCENT extra, where the same column carries
   * basis points. The serialiser splits the two apart on the way out
   * (`priceCents` / `percentBps`); on the way in there is one field, and the
   * caller is responsible for sending the right kind of number for the basis.
   */
  priceCents: number;
  appliesToClasses: TransferVehicleClass[];
  position: number;
  isActive?: boolean;
}

/**
 * Creates or replaces an extra.
 *
 * The endpoint is an upsert keyed on `code`, so posting a code that already
 * exists overwrites that extra rather than failing. The panel checks the code
 * against the list it is already holding before calling this.
 */
export const createTransferExtra = (body: TransferExtraInput) =>
  apiFetch<TransferExtra>("/api/admin/transfers/extras", { method: "POST", body });

export const updateTransferExtra = (code: string, body: Partial<TransferExtraInput>) =>
  apiFetch<TransferExtra>(`/api/admin/transfers/extras/${code}`, { method: "PUT", body });

/** Retires an extra. Reversible through `updateTransferExtra(code, { isActive: true })`. */
export const retireTransferExtra = (code: string) =>
  apiFetch<TransferExtra>(`/api/admin/transfers/extras/${code}`, { method: "DELETE" });

// --- Partner --------------------------------------------------------------

/** A partner's own transfer bookings, scoped on the server by the session. */
export const listPartnerTransferBookings = (query: AdminTransferBookingQuery = {}) =>
  serverFetch<Paginated<TransferBookingSummary>>(
    `/api/partner/transfers/bookings${toQueryString(query)}`,
  );

/** One of them, with the accepted driver on each leg once there is one. */
export const getPartnerTransferBooking = (reference: string) =>
  serverFetch<TransferBooking>(`/api/partner/transfers/bookings/${encodeURIComponent(reference)}`);

/**
 * Who a partner may ask for at checkout, for the journey a quote token
 * describes. Called from the browser as the form loads; a POST because the
 * token is long, not because anything is written.
 */
export const listAvailableDrivers = (token: string) =>
  apiFetch<AvailableDrivers>("/api/partner/drivers/available", { method: "POST", body: { token } });
