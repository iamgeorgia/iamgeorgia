import { apiFetch, serverFetch } from "./client";
import { toQueryString } from "./query";
import type { Paginated } from "@/types/partner";

/**
 * The bell, wherever it hangs.
 *
 * Three panels read the same `Notification` rows through three routers —
 * `/admin/notifications`, `/partner/notifications`, `/driver/notifications`
 * — each scoped on the session by the server. The scope here only picks the
 * router; what comes back is one person's notices in every case.
 */

export type NotificationScope = "admin" | "partner" | "driver";

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** Deep-link data. Which keys are present depends on the kind. */
  payload: {
    assignmentId?: string;
    legId?: string;
    bookingReference?: string;
    orderReference?: string;
    payableId?: string;
    instalmentId?: string;
    receivableId?: string;
    paymentId?: string;
    reference?: string | null;
    score?: number;
    [key: string]: unknown;
  };
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationQuery {
  unread?: "true" | "false";
  page?: number;
  pageSize?: number;
}

export type NotificationPage = Paginated<AppNotification> & { unreadCount: number };

const BASES: Record<NotificationScope, string> = {
  admin: "/api/admin/notifications",
  partner: "/api/partner/notifications",
  driver: "/api/driver/notifications",
};

/** Server Components read the list with the request's cookies forwarded. */
export const listNotifications = (scope: NotificationScope, query: NotificationQuery = {}) =>
  serverFetch<NotificationPage>(`${BASES[scope]}${toQueryString(query)}`);

export const getUnreadCount = async (scope: NotificationScope) =>
  (await serverFetch<{ unreadCount: number }>(`${BASES[scope]}/unread-count`)).unreadCount;

/** The bell's dropdown reads from the browser. */
export const fetchNotifications = (scope: NotificationScope, query: NotificationQuery = {}) =>
  apiFetch<NotificationPage>(`${BASES[scope]}${toQueryString(query)}`);

export const markNotificationRead = (scope: NotificationScope, id: string) =>
  apiFetch<AppNotification>(`${BASES[scope]}/${encodeURIComponent(id)}/read`, { method: "POST" });

export const markAllNotificationsRead = (scope: NotificationScope) =>
  apiFetch<{ count: number }>(`${BASES[scope]}/read-all`, { method: "POST" });

/** The page the bell lists everything on, per panel. */
export const notificationsPath: Record<NotificationScope, string> = {
  admin: "/admin/notifications",
  partner: "/portal/notifications",
  driver: "/driver/notifications",
};

/**
 * Where a notice leads, as a canonical path, or null when it is only news.
 *
 * Decided here rather than stored on the row: the server writes an entity
 * and a payload, and which screen shows that entity depends on which panel
 * the reader is in — a receivable is a detail page to Finance and the
 * statement to the agency that owes it.
 */
export function notificationHref(scope: NotificationScope, notification: AppNotification): string | null {
  const { payload, entityType, entityId } = notification;

  switch (scope) {
    case "driver":
      return payload.assignmentId ? `/driver/assignments/${payload.assignmentId}` : null;

    case "partner":
      if (entityType === "Receivable" || entityType === "PaymentRecord") return "/portal/finance";
      if (payload.bookingReference) return `/portal/bookings/${payload.bookingReference}`;
      return null;

    case "admin":
      switch (entityType) {
        case "SupplierPayable":
          return entityId ? `/admin/finance/payables/${entityId}` : null;
        case "Receivable":
          return entityId ? `/admin/finance/receivables/${entityId}` : null;
        case "PaymentRecord":
          return entityId ? `/admin/finance/payments/${entityId}` : null;
        case "TourBooking":
          return payload.bookingReference ? `/admin/tours/bookings/${payload.bookingReference}` : null;
        case "Order":
          return payload.orderReference ? `/admin/orders/${payload.orderReference}` : null;
        case "TransferAssignment":
        case "TransferBookingLeg":
          return payload.bookingReference ? `/admin/transfers/bookings/${payload.bookingReference}` : null;
        default:
          return null;
      }
  }
}
