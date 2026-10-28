import { apiFetch, serverFetch } from "./client";
import { actAsInit, type ActAsOptions } from "./manualBookings";
import { toQueryString, type QueryValue } from "./query";
import type { CancellationQuote } from "@/types/booking";
import type { Paginated } from "@/types/partner";
import type {
  Service,
  ServiceBooking,
  ServiceBookingQuery,
  ServiceBookingSummary,
  ServiceCategory,
  ServiceStatus,
  ServiceSummary,
  ServiceTranslation,
  ServiceWithChecklist,
} from "@/types/service";

/**
 * The service catalogue.
 *
 * Services are sold inside packages in this release, so there is no public
 * checkout for one and no booking call here: the admin register keeps the
 * catalogue, and a package component points at an entry in it.
 */

export interface ServiceQuery extends Record<string, QueryValue> {
  search?: string;
  destinationSlug?: string;
  destinationId?: string;
  category?: ServiceCategory | ServiceCategory[];
  /**
   * The server names this filter `isKosher`. Sending `kosher` would be
   * stripped as an unknown key rather than refused — a filter that silently
   * does nothing, which is worse than one that errors.
   */
  isKosher?: boolean;
  locale?: string;
  page?: number;
  pageSize?: number;
}

export const listPublicServices = (query: ServiceQuery = {}) =>
  serverFetch<Paginated<ServiceSummary>>(`/api/services${toQueryString(query)}`);

export const getPublicService = (slug: string, query: { locale?: string } = {}) =>
  serverFetch<Service>(`/api/services/${slug}${toQueryString(query)}`);

/** The catalogue from the browser, for the desk: what this buyer may book, at their price. */
export const listPublicServicesClient = (query: ServiceQuery = {}, options: ActAsOptions = {}) =>
  apiFetch<Paginated<ServiceSummary>>(`/api/services${toQueryString(query)}`, actAsInit(options));

// --- service bookings (admin) ----------------------------------------------

export const listAdminServiceBookings = (query: ServiceBookingQuery = {}) =>
  serverFetch<Paginated<ServiceBookingSummary>>(`/api/admin/services/bookings${toQueryString(query)}`);

export const getAdminServiceBooking = (reference: string) =>
  serverFetch<ServiceBooking>(`/api/admin/services/bookings/${reference}`);

export const getAdminServiceCancellationQuote = (reference: string) =>
  serverFetch<CancellationQuote>(`/api/admin/services/bookings/${reference}/cancellation-quote`);

/** The operator's yes to an on-request service booking. */
export const confirmServiceRequest = (reference: string) =>
  apiFetch<ServiceBooking>(`/api/admin/services/bookings/${reference}/confirm`, { method: "POST" });

/** The operator's no. The reason is required; the buyer reads it. */
export const declineServiceRequest = (reference: string, reason: string) =>
  apiFetch<ServiceBooking>(`/api/admin/services/bookings/${reference}/decline`, {
    method: "POST",
    body: { reason },
  });

export const cancelServiceBookingAsAdmin = (reference: string, reason?: string) =>
  apiFetch<ServiceBookingSummary & { cancellation: CancellationQuote }>(
    `/api/admin/services/bookings/${reference}/cancel`,
    { method: "POST", body: reason ? { reason } : {} },
  );

// --- admin ------------------------------------------------------------------

export interface AdminServiceQuery extends ServiceQuery {
  status?: ServiceStatus | ServiceStatus[];
  supplierId?: string;
}

export const listServices = (query: AdminServiceQuery = {}) =>
  serverFetch<Paginated<ServiceSummary>>(`/api/admin/services${toQueryString(query)}`);

/** The same call from the browser, for the component builder's picker. */
export const listServicesClient = (query: AdminServiceQuery = {}) =>
  apiFetch<Paginated<ServiceSummary>>(`/api/admin/services${toQueryString(query)}`);

export const getService = (id: string) =>
  serverFetch<ServiceWithChecklist>(`/api/admin/services/${id}`);

export interface ServiceInput {
  slug: string;
  name: string;
  category: ServiceCategory;
  basis: "PER_PERSON" | "PER_GROUP" | "PER_DAY" | "PER_PERSON_PER_DAY";
  netCents: number;
  sellCents?: number | null;
  currency?: string;
  timezone?: string;
  destinationId?: string | null;
  supplierId?: string | null;
  cancellationPolicyId: string;
  noticeHours?: number;
  minQuantity?: number;
  maxQuantity?: number | null;
  confirmationMode?: "INSTANT" | "ON_REQUEST";
  isKosher?: boolean;
  kosherAuthority?: string | null;
  summary?: string;
  description?: string[];
  included?: string[];
  b2cEnabled?: boolean;
  sortOrder?: number;
}

export const createService = (body: ServiceInput) =>
  apiFetch<ServiceWithChecklist>("/api/admin/services", { method: "POST", body });

export const updateService = (id: string, body: Partial<ServiceInput>) =>
  apiFetch<ServiceWithChecklist>(`/api/admin/services/${id}`, { method: "PATCH", body });

export const publishService = (id: string) =>
  apiFetch<ServiceWithChecklist>(`/api/admin/services/${id}/publish`, { method: "POST" });

export const unpublishService = (id: string) =>
  apiFetch<ServiceWithChecklist>(`/api/admin/services/${id}/unpublish`, { method: "POST" });

export const archiveService = (id: string, reason?: string) =>
  apiFetch<ServiceWithChecklist>(`/api/admin/services/${id}/archive`, {
    method: "POST",
    body: reason ? { reason } : {},
  });

/** 409 `HAS_BOOKINGS` once one was sold, `IN_PACKAGE` while a slot names it. */
export const deleteService = (id: string) =>
  apiFetch<void>(`/api/admin/services/${id}`, { method: "DELETE" });

export const listServiceTranslations = (id: string) =>
  serverFetch<{ data: ServiceTranslation[] }>(`/api/admin/services/${id}/translations`);

export const setServiceTranslation = (
  id: string,
  locale: string,
  body: { name?: string | null; summary?: string | null; description?: string[]; included?: string[] },
) => apiFetch<ServiceTranslation>(`/api/admin/services/${id}/translations/${locale}`, {
  method: "PUT",
  body,
});
