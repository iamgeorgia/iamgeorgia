import { serverFetch } from "./client";
import { toQueryString } from "./query";
import type {
  BookingApproval,
  BookingApprovalProduct,
  BookingPaymentStatus,
  BookingSource,
  SharedBookingFilters,
} from "@/types/booking";
import type { CustomerKind } from "@/types/customer";
import type { Paginated } from "@/types/partner";

/**
 * The register of every booking (`GET /admin/bookings/all`, and the
 * partner's own `/partner/bookings/all`): one list across hotels, transfers,
 * tours, services and orders, read from the booking index the services keep
 * in step with every status, money and desk change. Mirrors `toIndexEntry`
 * in `server/services/booking/index.service.js`.
 */

export interface IndexEntry {
  product: BookingApprovalProduct;
  id: string;
  reference: string;
  /** The product's own status word: a hotel `CONFIRMED`, an order `PENDING_CONFIRMATION`. */
  status: string;
  /** A sub-kind, where the product has one (an order's PACKAGE | CUSTOM). */
  kind: string | null;
  /** The property, route, tour, service or package name. */
  title: string;
  leadName: string;
  leadEmail: string;
  partnerId: string | null;
  customerId: string | null;
  assignedManagerUserId: string | null;
  /** The names behind the three ids, looked up once per page and never denormalised into the index. */
  partner: { id: string; name: string } | null;
  customer: { id: string; name: string; kind: CustomerKind } | null;
  assignedManager: { id: string; name: string } | null;
  /** The order a child belongs to; null for a standalone booking and for the order itself. */
  order: { id: string; reference: string } | null;
  destinationId: string | null;
  /** `YYYY-MM-DD`. */
  startDate: string;
  endDate: string;
  /** The ISO instant the service starts, where one is known. */
  startAt: string | null;
  currency: string;
  totalCents: number;
  payment: {
    status: BookingPaymentStatus;
    receivableId: string | null;
    dueAt: string | null;
    paidCents: number | null;
  };
  approval: Pick<BookingApproval, "state" | "deadlineAt" | "overdue"> | null;
  source: BookingSource;
  /** The admin detail page, canonical and unprefixed. */
  href: string;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
}

export interface BookingIndexQuery extends SharedBookingFilters {
  product?: BookingApprovalProduct | BookingApprovalProduct[];
  status?: string | string[];
  partnerId?: string;
  from?: string;
  to?: string;
  search?: string;
  /** Also list the children of orders beside their order. */
  children?: boolean;
  page?: number;
  pageSize?: number;
}

export const listAllBookings = (query: BookingIndexQuery = {}) =>
  serverFetch<Paginated<IndexEntry>>(`/api/admin/bookings/all${toQueryString(query)}`);

/** The partner's own, same shape; `href` still names the admin page and is not for the portal. */
export const listPartnerAllBookings = (query: BookingIndexQuery = {}) =>
  serverFetch<Paginated<IndexEntry>>(`/api/partner/bookings/all${toQueryString(query)}`);
