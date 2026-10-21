import type {
  BookingApprovalProduct,
  BookingApprovalState,
  BookingPaymentStatus,
} from "@/types/booking";

/**
 * Display vocabulary for the booking approval queue and the approval and
 * payment blocks every booking now carries (owner decision OD1: every booking
 * waits for an operator's yes before it is confirmed).
 *
 * Kept free of React so the queue page, the detail panels and
 * `test/booking-approvals.test.ts` all read the same words and the same
 * links. The server fixes the states; this file only names them.
 */

// --- products ----------------------------------------------------------------

export const BOOKING_APPROVAL_PRODUCTS: BookingApprovalProduct[] = [
  "HOTEL",
  "TRANSFER",
  "TOUR",
  "SERVICE",
  "ORDER",
];

export const approvalProductLabels: Record<BookingApprovalProduct, string> = {
  HOTEL: "Hotel",
  TRANSFER: "Transfer",
  TOUR: "Tour",
  SERVICE: "Service",
  ORDER: "Order",
};

/** The product chips, plural, as the queue's filter row reads them. */
export const approvalProductFilterLabels: Record<BookingApprovalProduct, string> = {
  HOTEL: "Hotels",
  TRANSFER: "Transfers",
  TOUR: "Tours",
  SERVICE: "Services",
  ORDER: "Orders",
};

/**
 * Where a queue row opens, canonical and unprefixed — the product's own
 * detail page on its own register. The same paths the booking index sends
 * as `href`, so a row from either list lands on the same screen.
 */
export function bookingApprovalHref(product: BookingApprovalProduct, reference: string): string {
  switch (product) {
    case "HOTEL":
      return `/admin/bookings/${reference}`;
    case "TRANSFER":
      return `/admin/transfers/bookings/${reference}`;
    case "TOUR":
      return `/admin/tours/bookings/${reference}`;
    case "ORDER":
      return `/admin/orders/${reference}`;
    case "SERVICE":
      return `/admin/services/bookings/${reference}`;
  }
}

/** The register a product's bookings are listed on, canonical and unprefixed. */
export function bookingRegisterHref(product: BookingApprovalProduct): string {
  switch (product) {
    case "HOTEL":
      return "/admin/bookings";
    case "TRANSFER":
      return "/admin/transfers/bookings";
    case "TOUR":
      return "/admin/tours/bookings";
    case "ORDER":
      return "/admin/orders";
    case "SERVICE":
      return "/admin/services/bookings";
  }
}

// --- approval states ---------------------------------------------------------

export const approvalStateLabels: Record<BookingApprovalState, string> = {
  PENDING: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

/** What each state means for the operator, under the badge on a detail page. */
export const approvalStateHints: Record<BookingApprovalState, string> = {
  PENDING: "Waiting for the platform's yes. Rooms or seats are held; nothing is owed yet.",
  APPROVED: "The booking went ahead: the supplier was told and the bill was raised.",
  REJECTED: "The platform said no. Whatever was held has been released.",
  WITHDRAWN: "The buyer cancelled before anyone answered.",
};

// --- payment -----------------------------------------------------------------

export const PAYMENT_STATUSES: BookingPaymentStatus[] = [
  "NONE",
  "UNPAID",
  "PARTIAL",
  "OVERDUE",
  "PAID",
  "WAIVED",
  "VOID",
];

export const paymentStatusLabels: Record<BookingPaymentStatus, string> = {
  NONE: "No bill yet",
  UNPAID: "Unpaid",
  PARTIAL: "Partially paid",
  OVERDUE: "Overdue",
  PAID: "Paid",
  WAIVED: "Waived",
  VOID: "Void",
};

export type PaymentTone = "neutral" | "positive" | "attention" | "critical" | "info";

export const paymentStatusTones: Record<BookingPaymentStatus, PaymentTone> = {
  NONE: "neutral",
  UNPAID: "attention",
  PARTIAL: "info",
  OVERDUE: "critical",
  PAID: "positive",
  WAIVED: "neutral",
  VOID: "neutral",
};

// --- the queue's URL ---------------------------------------------------------

export interface BookingApprovalQuery {
  product?: BookingApprovalProduct;
  partnerId?: string;
  overdue?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

const read = (params: Record<string, string | string[] | undefined>, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Reads the queue's filters out of the URL. Anything unrecognised is dropped
 * rather than rejected — a stale bookmark shows the whole queue, not an error.
 */
export function bookingApprovalQueryFromParams(
  params: Record<string, string | string[] | undefined>,
): BookingApprovalQuery {
  const product = read(params, "product");
  const page = Number.parseInt(read(params, "page") ?? "", 10);

  return {
    product: BOOKING_APPROVAL_PRODUCTS.includes(product as BookingApprovalProduct)
      ? (product as BookingApprovalProduct)
      : undefined,
    partnerId: read(params, "partnerId") || undefined,
    overdue: read(params, "overdue") === "true" ? true : undefined,
    search: read(params, "search") || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: 25,
  };
}

/**
 * "2 hours ago", "3 days ago": how long a request has been waiting. Shown
 * next to the absolute time, never instead of it, and computed against an
 * injectable `now` so a server render and its hydration agree.
 */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}
