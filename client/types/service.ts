import type { CancellationPolicy, Money } from "./catalogue";
import type {
  BookingApproval,
  BookingDesk,
  BookingPayment,
  BookingSource,
  CancellationWindow,
  SharedBookingFilters,
} from "./booking";
import type { ConfirmationMode } from "./tour";

/**
 * Services, mirroring `server/serializers/service.js`.
 *
 * A service is a priced thing with no inventory: kosher meal delivery,
 * Shabbat meals, a mashgiach, a guide, equipment. It is sold inside packages
 * in this release, so the client surface is deliberately small — a catalogue
 * for the admin panel and the summary an order item carries.
 *
 * Money is integer minor units with its currency beside it; dates are
 * `YYYY-MM-DD`. Staff-only fields are absent rather than null.
 */

export type ServiceStatus = "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";

export type ServiceCategory =
  | "KOSHER_MEAL_DELIVERY"
  | "SHABBAT_MEALS"
  | "MASHGIACH"
  | "SYNAGOGUE_TRANSFER"
  | "GUIDE"
  | "EQUIPMENT"
  | "OTHER";

/** What one unit of the service is, and therefore what the quantity means. */
export type ServiceBasis = "PER_PERSON" | "PER_GROUP" | "PER_DAY" | "PER_PERSON_PER_DAY";

export type ServiceBookingStatus =
  | "PENDING_APPROVAL"
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW";

export interface ServiceDestinationRef {
  id: string;
  slug: string;
  name: string;
  type: string;
  path: string;
}

export interface ServiceSummary {
  id: string;
  slug: string;
  name: string;
  category: ServiceCategory;
  basis: ServiceBasis;
  summary: string | null;
  isKosher: boolean;
  kosherAuthority: string | null;
  confirmationMode: ConfirmationMode;
  noticeHours: number;
  minQuantity: number;
  maxQuantity: number | null;
  currency: string;
  /** This viewer's own price for one unit of the basis. */
  unitPrice: Money;
  destination: ServiceDestinationRef | null;
  /** supplier or staff only */
  netCents?: number;
  sellCents?: number | null;
  /** staff only */
  status?: ServiceStatus;
  b2cEnabled?: boolean;
  supplier?: { id: string; name: string } | null;
  supplierId?: string | null;
  sortOrder?: number;
}

export interface Service extends ServiceSummary {
  description: string[];
  included: string[];
  timezone: string;
  cancellation: CancellationPolicy | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceWithChecklist extends Service {
  publishChecklist: { code: string; message: string }[];
}

export interface ServiceTranslation {
  locale: string;
  name: string | null;
  summary: string | null;
  description: string[];
  included: string[];
}

/** The child booking an order's SERVICE item points at. */
export interface ServiceBookingSummary {
  reference: string;
  status: ServiceBookingStatus;
  service: { id: string; slug: string | null; name: string | null; category: ServiceCategory | null };
  date: string;
  endDate: string;
  startAt: string | null;
  quantity: number;
  pax: number;
  days: number;
  leadName: string;
  currency: string;
  totalCents: number;
  confirmationMode: ConfirmationMode;
  requestDeadlineAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  declinedAt: string | null;
  /** The platform's yes: null on a booking that never needed one. */
  approval: BookingApproval | null;
  payment: BookingPayment;
  /** supplier or staff only */
  netTotalCents?: number;
  markupBps?: number;
  marginCents?: number;
  partner?: { id: string; reference: string; name: string } | null;
  /** staff with `partners.read` only: the buyer and the desk's own fields. */
  desk?: BookingDesk;
}

/** The service as it was when booked. A voucher reads this, not the live service. */
export interface ServiceSnapshot {
  id?: string;
  slug?: string;
  name?: string;
  category?: ServiceCategory;
  basis?: ServiceBasis;
  timezone?: string;
  supplierName?: string | null;
  [key: string]: unknown;
}

/** One service booking, whole (`GET /admin/services/bookings/:reference`). */
export interface ServiceBooking extends ServiceBookingSummary {
  serviceSnapshot: ServiceSnapshot;
  leadEmail: string;
  leadPhone: string | null;
  notes: string | null;
  cancellation: {
    freeUntil: string | null;
    windows: CancellationWindow[];
    cancelledAt: string | null;
    chargeCents: number | null;
    reason: string | null;
  };
  declineReason: string | null;
  source: BookingSource;
}

/**
 * What confirms a service booking (`POST /service-bookings`, and the
 * `booking` of a manual one). Note the absence of any amount.
 */
export interface ConfirmServiceBookingInput {
  serviceId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** 24-hour `HH:mm`. */
  time?: string;
  days?: number;
  quantity?: number;
  pax?: number;
  lead: { firstName: string; lastName: string; email: string; phone?: string };
  notes?: string;
  idempotencyKey?: string;
}

export interface ServiceBookingQuery extends SharedBookingFilters {
  status?: ServiceBookingStatus | ServiceBookingStatus[];
  serviceId?: string;
  partnerId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}
