/**
 * What the overview is made of, and who sees which part.
 *
 * The overview is one screen for every staff role, so it has to be built from
 * pieces that each know who they are for. Each widget names the capability
 * that shows it — the same one the server asks for on the endpoint it reads,
 * so nothing is requested for a widget the viewer will not see — and, where
 * it is a queue, the capability that lets the viewer *act* on it. Widgets the
 * viewer can act on come first, under "Needs a decision"; the rest are the
 * figures they watch.
 *
 * `endpoint` is the server route the widget's loader calls, as the RBAC
 * matrix fixture names it. `test/dashboard-widgets.test.ts` checks, for every
 * seeded role, that each widget shown to it reads a route the fixture says it
 * reaches: a widget can never be a page of 403s in disguise.
 *
 * Kept free of React and of `@/` aliases so the test can load it under plain
 * Node; the page maps ids to loaders and components.
 */

export type DashboardWidgetId =
  | "bookingApprovals"
  | "tourRequests"
  | "pendingOrders"
  | "unassignedLegs"
  | "applications"
  | "paymentsDue"
  | "overdueReceivables"
  | "approvals"
  | "invoiceErrors"
  | "bookingFigures"
  | "arrivals"
  | "latestBookings"
  | "financeFigures"
  | "dispatchFigures"
  | "recentPayments"
  | "deadlinesWeek";

export type DashboardSection = "decide" | "watch";

export interface DashboardWidget {
  id: DashboardWidgetId;
  /** Any one of these shows the widget and permits its request. */
  capability: string | string[];
  /**
   * Any one of these makes the widget a queue the viewer can work: it then
   * sits under "Needs a decision". Absent for a figure that is only watched.
   */
  acts?: string | string[];
  /** The server routes the loader reads, as the RBAC fixture names them. */
  endpoints: string[];
}

const anyOf = (needed: string | string[] | undefined, held: readonly string[]): boolean => {
  if (!needed) return false;
  return (Array.isArray(needed) ? needed : [needed]).some((capability) => held.includes(capability));
};

/** In display order within each section. */
export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  // --- Queues ----------------------------------------------------------------
  // First: every booking passes through it before anything else can happen.
  {
    id: "bookingApprovals",
    capability: "bookings.approve",
    acts: "bookings.approve",
    endpoints: ["GET /api/admin/booking-approvals"],
  },
  {
    id: "tourRequests",
    capability: "bookings.read",
    acts: "bookings.write",
    endpoints: ["GET /api/admin/tours/bookings"],
  },
  {
    id: "pendingOrders",
    capability: "bookings.read",
    acts: "bookings.write",
    endpoints: ["GET /api/admin/orders"],
  },
  {
    id: "unassignedLegs",
    capability: "dispatch.read",
    acts: "dispatch.write",
    endpoints: ["GET /api/admin/transfers/dispatch/legs"],
  },
  {
    id: "applications",
    capability: "partners.read",
    acts: "partners.write",
    endpoints: ["GET /api/admin/partners"],
  },
  {
    id: "paymentsDue",
    capability: "finance.payables.read",
    acts: "finance.payments.write",
    endpoints: ["GET /api/admin/finance/due"],
  },
  {
    id: "overdueReceivables",
    capability: "finance.receivables.read",
    acts: ["finance.payments.write", "finance.refunds.request", "finance.adjustments.request"],
    endpoints: ["GET /api/admin/finance/receivables"],
  },
  {
    id: "approvals",
    capability: ["finance.refunds.approve", "finance.adjustments.approve"],
    acts: ["finance.refunds.approve", "finance.adjustments.approve"],
    endpoints: ["GET /api/admin/approvals"],
  },
  {
    id: "invoiceErrors",
    capability: "invoices.read",
    acts: "invoices.write",
    endpoints: ["GET /api/admin/invoices"],
  },

  // --- Figures ---------------------------------------------------------------
  {
    id: "bookingFigures",
    capability: "bookings.read",
    endpoints: ["GET /api/admin/bookings/summary", "GET /api/admin/bookings"],
  },
  { id: "arrivals", capability: "bookings.read", endpoints: ["GET /api/admin/bookings"] },
  { id: "latestBookings", capability: "bookings.read", endpoints: ["GET /api/admin/bookings"] },
  {
    id: "financeFigures",
    capability: "finance.reports.read",
    endpoints: ["GET /api/admin/finance/reports/summary"],
  },
  {
    id: "dispatchFigures",
    capability: "dispatch.read",
    endpoints: ["GET /api/admin/transfers/dispatch/legs"],
  },
  {
    id: "recentPayments",
    capability: "finance.payments.read",
    endpoints: ["GET /api/admin/finance/payments"],
  },
  // The week's deadlines, by kind, for whoever reads bookings. No `acts`:
  // moving one is a per-kind decision made in the calendar's own dialog.
  {
    id: "deadlinesWeek",
    capability: "bookings.read",
    endpoints: ["GET /api/admin/deadlines"],
  },
];

export interface PlacedWidget extends DashboardWidget {
  section: DashboardSection;
}

/**
 * The widgets one account sees, each placed in its section. A queue the
 * viewer merely reads is still shown, as a figure, not as work. Display
 * order within a section is the table's.
 */
export function dashboardFor(capabilities: readonly string[]): PlacedWidget[] {
  return DASHBOARD_WIDGETS.filter((widget) => anyOf(widget.capability, capabilities)).map((widget) => ({
    ...widget,
    section: anyOf(widget.acts, capabilities) ? "decide" : "watch",
  }));
}

export const widgetsIn = (placed: PlacedWidget[], section: DashboardSection): PlacedWidget[] =>
  placed.filter((widget) => widget.section === section);
