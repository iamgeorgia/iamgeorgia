import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import {
  ApplicationsWidget,
  ApprovalsWidget,
  ArrivalsWidget,
  BookingApprovalsWidget,
  BookingFiguresWidget,
  DeadlinesWeekWidget,
  DispatchFiguresWidget,
  FinanceFiguresWidget,
  InvoiceErrorsWidget,
  LatestBookingsWidget,
  OverdueReceivablesWidget,
  PaymentsDueFigure,
  PaymentsDueWidget,
  PendingOrdersWidget,
  RecentPaymentsWidget,
  TourRequestsWidget,
  UnassignedLegsWidget,
} from "@/components/admin/dashboard/widgets";
import { QuickStartCard } from "@/components/admin/help/QuickStartCard";
import { dashboardFor, widgetsIn, type DashboardWidgetId, type PlacedWidget } from "@/lib/admin/dashboard";
import { addDaysISO, todayISO } from "@/lib/admin/dates";
import { defaultWindow } from "@/lib/admin/dispatch";
import { quickStartFor, quickStartTitle } from "@/lib/admin/help";
import { recentBookings, upcomingArrivals } from "@/lib/admin/metrics";
import { APPLICATION_STATUSES } from "@/lib/admin/partners";
import { getBookingSummary } from "@/lib/api/admin";
import { listApprovals } from "@/lib/api/approvals";
import { listBookingApprovals } from "@/lib/api/bookingApprovals";
import { listDeadlines } from "@/lib/api/deadlines";
import { listDispatchLegs } from "@/lib/api/dispatch";
import { getFinanceSummary, getPaymentsDue, listPayments, listReceivables } from "@/lib/api/finance";
import { listInvoices } from "@/lib/api/invoices";
import { listAdminOrders } from "@/lib/api/orders";
import { listPartners } from "@/lib/api/partners";
import { listAdminTourBookings } from "@/lib/api/tours";
import { requireScreen } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/types/auth";

/** How far ahead the queues look: the same week the sidebar badges and the reminders count. */
const WINDOW_DAYS = 7;

/**
 * The overview — everyone's landing page, and different for everyone.
 *
 * It is assembled from the widget registry (`lib/admin/dashboard.ts`): each
 * widget names the capability that shows it, so a dispatcher sees the board's
 * figures and the legs without a driver, a finance desk sees what is due and
 * what is overdue, a reservations desk its requests and arrivals, and
 * management the figures across all of it. Nothing is requested for a widget
 * the viewer will not see, and every request is one the server would answer
 * for this role — the registry's test checks that against the RBAC fixture.
 *
 * Two sections, in a fixed order: the queues the viewer can *act* on first,
 * because they are why most people open the panel, then the figures they
 * watch. Every figure is a request, so they all go out in one `Promise.all`;
 * a dashboard that fetches serially is a dashboard nobody waits for.
 */
export default async function AdminOverviewPage() {
  const session = await requireScreen();
  const { path } = await getI18n();
  const capabilities = session.user.capabilities ?? [];
  const placed = dashboardFor(capabilities);
  const shown = new Set<DashboardWidgetId>(placed.map((widget) => widget.id));
  const now = new Date();
  const today = todayISO();
  const window = defaultWindow(WINDOW_DAYS);

  // One request per figure, only for widgets on this viewer's screen. Two
  // widgets share the arrivals list, so it is read once.
  const wantsArrivals = shown.has("bookingFigures") || shown.has("arrivals");
  const wantsLegs = shown.has("unassignedLegs") || shown.has("dispatchFigures");

  const [
    bookingApprovals,
    tourRequests,
    pendingOrders,
    unassignedLegs,
    legsTotal,
    legsOffered,
    applications,
    paymentsDue,
    overdueReceivables,
    approvals,
    invoiceErrors,
    bookingSummary,
    arrivals,
    latest,
    financeSummary,
    recentPayments,
    deadlinesUpcoming,
    deadlinesOverdue,
  ] = await Promise.all([
    shown.has("bookingApprovals") ? listBookingApprovals({ pageSize: 5 }) : null,
    shown.has("tourRequests") ? listAdminTourBookings({ status: "PENDING", pageSize: 5 }) : null,
    shown.has("pendingOrders") ? listAdminOrders({ status: "PENDING_CONFIRMATION", pageSize: 5 }) : null,
    wantsLegs ? listDispatchLegs({ ...window, legStatus: "UNASSIGNED", pageSize: 5 }) : null,
    shown.has("dispatchFigures") ? listDispatchLegs({ ...window, pageSize: 1 }) : null,
    shown.has("dispatchFigures") ? listDispatchLegs({ ...window, legStatus: "ASSIGNED", pageSize: 1 }) : null,
    shown.has("applications") ? listPartners({ status: APPLICATION_STATUSES, pageSize: 4 }) : null,
    shown.has("paymentsDue") ? getPaymentsDue(WINDOW_DAYS) : null,
    shown.has("overdueReceivables") ? listReceivables({ overdue: "true", pageSize: 5 }) : null,
    shown.has("approvals") ? listApprovals({ status: "PENDING", pageSize: 5 }) : null,
    shown.has("invoiceErrors") ? listInvoices({ status: "ERROR", pageSize: 5 }) : null,
    shown.has("bookingFigures") ? getBookingSummary(30) : null,
    wantsArrivals ? upcomingArrivals(5) : null,
    shown.has("latestBookings") ? recentBookings(6) : null,
    shown.has("financeFigures") ? getFinanceSummary() : null,
    shown.has("recentPayments") ? listPayments({ pageSize: 5 }) : null,
    shown.has("deadlinesWeek")
      ? listDeadlines({ status: "OPEN", from: now.toISOString(), to: `${addDaysISO(today, WINDOW_DAYS)}T23:59:59.999Z`, sort: "soonest", pageSize: 500 })
      : null,
    shown.has("deadlinesWeek") ? listDeadlines({ status: "OPEN", to: now.toISOString(), pageSize: 1 }) : null,
  ]);

  const quickStart = quickStartFor(capabilities);

  /** The queue widgets, in registry order; null for one with nothing loaded. */
  const renderQueue = (widget: PlacedWidget): React.ReactNode => {
    switch (widget.id) {
      case "bookingApprovals":
        return bookingApprovals && <BookingApprovalsWidget key={widget.id} result={bookingApprovals} path={path} />;
      case "tourRequests":
        return tourRequests && <TourRequestsWidget key={widget.id} result={tourRequests} path={path} />;
      case "pendingOrders":
        return pendingOrders && <PendingOrdersWidget key={widget.id} result={pendingOrders} path={path} />;
      case "unassignedLegs":
        return unassignedLegs && <UnassignedLegsWidget key={widget.id} result={unassignedLegs} path={path} />;
      case "applications":
        return applications && <ApplicationsWidget key={widget.id} result={applications} path={path} />;
      case "paymentsDue":
        return (
          paymentsDue && (
            <PaymentsDueWidget
              key={widget.id}
              due={paymentsDue}
              canPay={can(session, "finance.payments.write")}
              now={now.toISOString()}
            />
          )
        );
      case "overdueReceivables":
        return (
          overdueReceivables && (
            <OverdueReceivablesWidget key={widget.id} result={overdueReceivables} now={now} path={path} />
          )
        );
      case "approvals":
        return approvals && <ApprovalsWidget key={widget.id} result={approvals} path={path} />;
      case "invoiceErrors":
        return invoiceErrors && <InvoiceErrorsWidget key={widget.id} result={invoiceErrors} path={path} />;
      default:
        return null;
    }
  };

  const decide = widgetsIn(placed, "decide");
  const watchQueues = widgetsIn(placed, "watch").filter((widget) => widget.acts);
  const tiles =
    (bookingSummary ? (can(session, "bookings.read") ? 3 : 2) : 0) +
    (paymentsDue && !shown.has("financeFigures") ? 1 : 0) +
    (legsTotal ? 3 : 0);

  return (
    <AdminContainer>
      <AdminPageHeader
        title={`Good morning, ${session.user.firstName ?? "there"}`}
        description={
          decide.length > 0
            ? "What needs a decision from you, then what is live and what is coming."
            : "What is live, what is arriving, and how the week looks."
        }
      />

      {/* The first-visit checklist, filtered to the screens this viewer can
          open. Dismissable, and remembered per browser; the help hub keeps
          an un-dismissable copy. */}
      {quickStart.length > 0 && (
        <div className="mt-8">
          <QuickStartCard title={quickStartTitle(capabilities)} steps={quickStart} dismissable />
        </div>
      )}

      {tiles > 0 && (
        <div className={`mt-8 grid gap-4 sm:grid-cols-2 ${tiles >= 5 ? "xl:grid-cols-5" : tiles === 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
          {bookingSummary && (
            <BookingFiguresWidget summary={bookingSummary} arrivals={arrivals?.length ?? 0} showValue />
          )}
          {paymentsDue && !shown.has("financeFigures") && <PaymentsDueFigure due={paymentsDue} />}
          {legsTotal && (
            <DispatchFiguresWidget
              total={legsTotal.total}
              unassigned={unassignedLegs?.total ?? 0}
              offered={legsOffered?.total ?? 0}
            />
          )}
        </div>
      )}

      {decide.length > 0 && (
        <section className="mt-8" aria-labelledby="overview-decide">
          <h2 id="overview-decide" className="text-[0.6875rem] font-semibold tracking-[0.16em] text-subtle uppercase">
            Needs a decision
          </h2>
          <div className="mt-3 grid gap-6 xl:grid-cols-2">{decide.map(renderQueue)}</div>
        </section>
      )}

      {financeSummary && (
        <section className="mt-8" aria-labelledby="overview-money">
          <h2 id="overview-money" className="text-[0.6875rem] font-semibold tracking-[0.16em] text-subtle uppercase">
            Who owes whom
          </h2>
          <div className="mt-3">
            <FinanceFiguresWidget summary={financeSummary} path={path} />
          </div>
        </section>
      )}

      {(latest || arrivals || watchQueues.length > 0 || recentPayments || deadlinesUpcoming) && (
        <section className="mt-8" aria-labelledby="overview-watch">
          <h2 id="overview-watch" className="text-[0.6875rem] font-semibold tracking-[0.16em] text-subtle uppercase">
            {decide.length > 0 ? "Keeping an eye on" : "Today"}
          </h2>
          <div className="mt-3 grid gap-6 xl:grid-cols-3">
            {latest && <LatestBookingsWidget bookings={latest} path={path} />}
            <div className="flex flex-col gap-6">
              {arrivals && shown.has("arrivals") && <ArrivalsWidget arrivals={arrivals} path={path} />}
              {deadlinesUpcoming && (
                <DeadlinesWeekWidget upcoming={deadlinesUpcoming} overdue={deadlinesOverdue?.total ?? 0} today={today} path={path} />
              )}
              {watchQueues.map(renderQueue)}
              {recentPayments && <RecentPaymentsWidget payments={recentPayments.data} path={path} />}
            </div>
          </div>
        </section>
      )}
    </AdminContainer>
  );
}
