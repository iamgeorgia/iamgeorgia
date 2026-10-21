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

/** The tab a notice sits on. Stamped on the row by the server when it is written. */
export type NotificationCategory = "BOOKING" | "DISPATCH" | "FINANCE" | "APPROVAL" | "DEADLINE" | "SYSTEM";

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  "BOOKING",
  "DISPATCH",
  "FINANCE",
  "APPROVAL",
  "DEADLINE",
  "SYSTEM",
];

export const notificationCategoryLabels: Record<NotificationCategory, string> = {
  BOOKING: "Bookings",
  DISPATCH: "Dispatch",
  FINANCE: "Finance",
  APPROVAL: "Approvals",
  DEADLINE: "Deadlines",
  SYSTEM: "System",
};

/** The tab's name, or "System" for a row stamped with something this build does not know. */
export const notificationCategoryLabel = (category: string | null | undefined): string =>
  notificationCategoryLabels[category as NotificationCategory] ?? notificationCategoryLabels.SYSTEM;

export const isNotificationCategory = (value: unknown): value is NotificationCategory =>
  typeof value === "string" && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);

export type NotificationSort = "newest" | "oldest" | "unreadFirst";

export const NOTIFICATION_SORTS: readonly NotificationSort[] = ["newest", "oldest", "unreadFirst"];

export const notificationSortLabels: Record<NotificationSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  unreadFirst: "Unread first",
};

export const isNotificationSort = (value: unknown): value is NotificationSort =>
  typeof value === "string" && (NOTIFICATION_SORTS as readonly string[]).includes(value);

export interface AppNotification {
  id: string;
  kind: string;
  /** Which tab the notice belongs on. */
  category: NotificationCategory;
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
  /**
   * The path to open, decided by the server for the panel that asked, or
   * null when the notice is only news. Undefined only on a row served before
   * the server wrote links — `hrefFor` falls back to the client table then.
   */
  href?: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationQuery {
  unread?: "true" | "false";
  category?: NotificationCategory;
  /** One or more kinds; an unknown kind matches nothing. */
  kind?: string | string[];
  sort?: NotificationSort;
  page?: number;
  pageSize?: number;
}

export type NotificationPage = Paginated<AppNotification> & {
  unreadCount: number;
  unreadByCategory: Record<NotificationCategory, number>;
};

export interface UnreadSummary {
  unreadCount: number;
  byCategory: Record<NotificationCategory, number>;
}

export const NO_UNREAD: UnreadSummary = {
  unreadCount: 0,
  byCategory: { BOOKING: 0, DISPATCH: 0, FINANCE: 0, APPROVAL: 0, DEADLINE: 0, SYSTEM: 0 },
};

const BASES: Record<NotificationScope, string> = {
  admin: "/api/admin/notifications",
  partner: "/api/partner/notifications",
  driver: "/api/driver/notifications",
};

/** Server Components read the list with the request's cookies forwarded. */
export const listNotifications = (scope: NotificationScope, query: NotificationQuery = {}) =>
  serverFetch<NotificationPage>(`${BASES[scope]}${toQueryString(query)}`);

/**
 * The bell's number with its per-tab split. The driver panel has no such
 * route — its bell reads the count off the list — so the scope is narrowed.
 */
export const getUnreadSummary = (scope: Exclude<NotificationScope, "driver">) =>
  serverFetch<UnreadSummary>(`${BASES[scope]}/unread-count`);

/** Just the number, for the callers that paint one badge. */
export const getUnreadCount = async (scope: Exclude<NotificationScope, "driver">) =>
  (await getUnreadSummary(scope)).unreadCount;

/** The same summary from the browser, for the shells that poll it. */
export const fetchUnreadSummary = (scope: Exclude<NotificationScope, "driver">) =>
  apiFetch<UnreadSummary>(`${BASES[scope]}/unread-count`);

/** The bell's dropdown reads from the browser. */
export const fetchNotifications = (scope: NotificationScope, query: NotificationQuery = {}) =>
  apiFetch<NotificationPage>(`${BASES[scope]}${toQueryString(query)}`);

export const markNotificationRead = (scope: NotificationScope, id: string) =>
  apiFetch<AppNotification>(`${BASES[scope]}/${encodeURIComponent(id)}/read`, { method: "POST" });

/** Marks one tab read when a category is given, otherwise everything. */
export const markAllNotificationsRead = (scope: NotificationScope, category?: NotificationCategory) =>
  apiFetch<{ count: number }>(`${BASES[scope]}/read-all`, {
    method: "POST",
    body: category ? { category } : {},
  });

/** The page the bell lists everything on, per panel. */
export const notificationsPath: Record<NotificationScope, string> = {
  admin: "/admin/notifications",
  partner: "/portal/notifications",
  driver: "/driver/notifications",
};

/**
 * Where a notice leads: the server's word when it gave one, else the table
 * below for a row served before links were written on the server.
 */
export const hrefFor = (scope: NotificationScope, notification: AppNotification): string | null =>
  notification.href === undefined ? notificationHref(scope, notification) : notification.href;

/**
 * Where a notice leads, as a canonical path, or null when it is only news.
 *
 * The fallback table. The server now decides the path per panel and sends
 * it as `href`; this stays for rows that predate that, and mirrors the
 * server's own table for the entities that existed then.
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

/** The browser's URL state: which tab, unread only, the order and the page. */
export interface NotificationBrowseState {
  category?: NotificationCategory;
  unread: boolean;
  sort: NotificationSort;
  page: number;
}

const readParam = (params: Record<string, string | string[] | undefined>, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Reads the browser's state out of the URL. Anything unrecognised is dropped
 * rather than rejected — a stale bookmark shows every tab, not an error.
 */
export function notificationBrowseStateFromParams(
  params: Record<string, string | string[] | undefined>,
): NotificationBrowseState {
  const category = readParam(params, "category");
  const sort = readParam(params, "sort");
  const page = Number.parseInt(readParam(params, "page") ?? "", 10);

  return {
    category: isNotificationCategory(category) ? category : undefined,
    unread: readParam(params, "unread") === "true",
    sort: isNotificationSort(sort) ? sort : "newest",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** The browser's page size: a screen of notices, not the bell's handful. */
export const NOTIFICATIONS_PAGE_SIZE = 25;

/** The list request a browser state asks the server for. */
export const notificationQueryFor = (state: NotificationBrowseState): NotificationQuery => ({
  category: state.category,
  unread: state.unread ? "true" : undefined,
  sort: state.sort,
  page: state.page,
  pageSize: NOTIFICATIONS_PAGE_SIZE,
});
