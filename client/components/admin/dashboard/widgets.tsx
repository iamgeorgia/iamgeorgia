import Link from "next/link";
import {
  ArrowUpRight,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import { AdminPanel } from "@/components/admin/AdminPage";
import { Cell, DataTable, EmptyRow, Row } from "@/components/admin/DataTable";
import { FinanceOverviewCurrency } from "@/components/admin/finance/FinanceOverviewCurrency";
import { FinanceOverviewPayments } from "@/components/admin/finance/FinanceOverviewPanels";
import { PaymentsDuePanel } from "@/components/admin/finance/PaymentsDuePanel";
import { StatCard } from "@/components/admin/StatCard";
import {
  ApprovalStatusBadge,
} from "@/components/admin/finance/ApprovalStatusBadge";
import { InvoiceStatusBadge } from "@/components/admin/finance/InvoiceStatusBadge";
import { BookingStatusBadge, PartnerStatusBadge } from "@/components/admin/StatusBadge";
import { approvalKindLabels } from "@/lib/admin/approvals";
import { CreateBookingButton } from "@/components/admin/CreateBookingButton";
import { approvalProductLabels, bookingApprovalHref } from "@/lib/admin/bookingApprovals";
import { formatInstant, formatStay, formatStayDate } from "@/lib/admin/bookings";
import { formatPickup, legStatusLabels } from "@/lib/admin/dispatch";
import { dueInWords, invoiceKindLabels } from "@/lib/admin/finance";
import { formatCompactMoney } from "@/lib/admin/metrics";
import { formatOrderDates, isRequestOverdue } from "@/lib/admin/orders";
import { formatPartnerDate, partnerKindLabels } from "@/lib/admin/partners";
import { formatDeparture } from "@/lib/admin/tours";
import type { BookingSummary as AdminBookingSummary } from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";
import { DeadlineKindBadge } from "@/components/admin/StatusBadge";
import { DEADLINE_KINDS, countByKind, deadlineDueWords, deadlineKindShortLabels, formatDeadlineInstant } from "@/lib/admin/deadlines";
import type { Approval } from "@/types/approval";
import type { Deadline } from "@/types/deadline";
import type { BookingApprovalRow, BookingSummary } from "@/types/booking";
import type { DispatchLeg } from "@/types/driver";
import type { FinanceSummary, Payment, PaymentsDue, Receivable } from "@/types/finance";
import type { Invoice } from "@/types/invoice";
import type { OrderSummary } from "@/types/order";
import type { Paginated, PartnerSummary } from "@/types/partner";
import type { TourBookingSummary } from "@/types/tour";

import { QueuePanel } from "./QueuePanel";

/**
 * The overview's widgets, one component per entry in `lib/admin/dashboard.ts`.
 *
 * Server components: the page loads each widget's data (only for the widgets
 * the viewer sees) and hands it in. Nothing here decides who sees what — the
 * registry did that — so a widget is just a view of its data.
 */

type PathFn = (href: string) => string;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// --- Queues ------------------------------------------------------------------

export function BookingApprovalsWidget({ result, path }: { result: Paginated<BookingApprovalRow>; path: PathFn }) {
  return (
    <QueuePanel
      title="Awaiting your approval"
      description={
        result.total > 0
          ? `${plural(result.total, "booking", "bookings")} held until somebody says yes, earliest deadline first.`
          : undefined
      }
      href={path("/admin/bookings/approvals")}
      linkLabel="Open the queue"
      empty="Nothing is waiting for approval."
      footer={<CreateBookingButton variant="secondary" />}
      rows={result.data.map((row) => ({
        key: `${row.product}-${row.id}`,
        href: path(bookingApprovalHref(row.product, row.reference)),
        title: row.title,
        subtitle: `${row.leadName}${row.partner ? ` · ${row.partner.name}` : ""} · ${approvalProductLabels[row.product]}`,
        value: formatMoney(row.totalCents, row.currency),
        note: row.deadlineAt
          ? `${row.overdue ? "Overdue since" : "Due"} ${formatInstant(row.deadlineAt)}`
          : row.reference,
        urgent: row.overdue,
      }))}
    />
  );
}

export function TourRequestsWidget({ result, path }: { result: Paginated<TourBookingSummary>; path: PathFn }) {
  return (
    <QueuePanel
      title="Tour requests"
      description={
        result.total > 0
          ? `${plural(result.total, "request", "requests")} holding seats until somebody answers.`
          : undefined
      }
      href={path("/admin/tours/bookings?status=PENDING")}
      empty="No tour request is waiting for an answer."
      rows={result.data.map((booking) => ({
        key: booking.reference,
        href: path(`/admin/tours/bookings/${booking.reference}`),
        title: booking.tour.title ?? booking.reference,
        subtitle: `${booking.leadTravellerName} · ${formatDeparture(booking.date, booking.endDate)}`,
        value: formatMoney(booking.totalCents, booking.currency),
        note: booking.reference,
      }))}
    />
  );
}

export function PendingOrdersWidget({ result, path }: { result: Paginated<OrderSummary>; path: PathFn }) {
  return (
    <QueuePanel
      title="Orders to confirm"
      description={
        result.total > 0 ? `${plural(result.total, "order", "orders")} on request, holding real capacity.` : undefined
      }
      href={path("/admin/orders?status=PENDING_CONFIRMATION")}
      empty="Every order has been answered."
      rows={result.data.map((order) => {
        const overdue = isRequestOverdue(order.requestDeadlineAt ?? null);
        return {
          key: order.reference,
          href: path(`/admin/orders/${order.reference}`),
          title: order.package.name ?? order.reference,
          subtitle: `${order.leadName} · ${formatOrderDates(order.startDate, order.endDate)}`,
          value: formatMoney(order.totalCents, order.currency),
          note: overdue ? "Past its answer-by time" : order.reference,
          urgent: overdue,
        };
      })}
    />
  );
}

export function UnassignedLegsWidget({ result, path }: { result: Paginated<DispatchLeg>; path: PathFn }) {
  return (
    <QueuePanel
      title="Legs without a driver"
      description={result.total > 0 ? `${plural(result.total, "leg", "legs")} in the next week, soonest first.` : undefined}
      href={path("/admin/transfers/dispatch?legStatus=UNASSIGNED")}
      linkLabel="Open the board"
      empty="Every leg this week has a driver."
      rows={result.data.map((leg) => ({
        key: leg.id,
        href: path(`/admin/transfers/bookings/${leg.booking.reference}`),
        title: `${leg.from} → ${leg.to}`,
        subtitle: `${leg.booking.leadPassengerName} · ${leg.booking.passengers} pax`,
        value: formatPickup(leg.pickupAt, leg.timezone),
        note: legStatusLabels[leg.status],
      }))}
    />
  );
}

export function ApplicationsWidget({ result, path }: { result: Paginated<PartnerSummary>; path: PathFn }) {
  return (
    <QueuePanel
      title="Partner applications"
      description={result.total > 0 ? "Oldest first — that is the order they should be worked." : undefined}
      href={path("/admin/partners/applications")}
      linkLabel="Review"
      empty="The queue is clear."
      rows={result.data.map((partner) => ({
        key: partner.id,
        href: path(`/admin/partners/${partner.id}`),
        title: partner.name,
        subtitle: `${partnerKindLabels[partner.kind]} · ${formatPartnerDate(partner.createdAt)}`,
        badge: <PartnerStatusBadge status={partner.status} />,
      }))}
    />
  );
}

export function PaymentsDueWidget({ due, canPay, now }: { due: PaymentsDue; canPay: boolean; now: string }) {
  return (
    <PaymentsDuePanel
      instalments={due.instalments ?? []}
      totals={due.totals.instalments ?? { overdue: 0, due: 0, outstandingByCurrency: {} }}
      days={due.days}
      now={now}
      canPay={canPay}
    />
  );
}

export function OverdueReceivablesWidget({
  result,
  now,
  path,
}: {
  result: Paginated<Receivable>;
  now: Date;
  path: PathFn;
}) {
  return (
    <QueuePanel
      title="Overdue from buyers"
      description={result.total > 0 ? `${plural(result.total, "bill", "bills")} past the due date, longest late first.` : undefined}
      href={path("/admin/finance/receivables?overdue=true")}
      empty="No bill is past its due date."
      rows={result.data.map((receivable) => ({
        key: receivable.id,
        href: path(`/admin/finance/receivables/${receivable.id}`),
        title: receivable.reference,
        subtitle: receivable.debtor.partner?.name ?? receivable.debtor.name,
        value: formatMoney(receivable.outstandingCents, receivable.currency),
        note: dueInWords(receivable.dueAt, now),
        urgent: true,
      }))}
    />
  );
}

export function ApprovalsWidget({ result, path }: { result: Paginated<Approval>; path: PathFn }) {
  return (
    <QueuePanel
      title="Approvals waiting"
      description={result.total > 0 ? `${plural(result.total, "request", "requests")} need a second person.` : undefined}
      href={path("/admin/finance/approvals?status=PENDING")}
      empty="Nothing is waiting for a decision."
      rows={result.data.map((approval) => ({
        key: approval.id,
        href: path(`/admin/finance/approvals/${approval.id}`),
        title: approvalKindLabels[approval.kind],
        subtitle: `${approval.requestedBy?.fullName ?? "Someone"} · ${approval.summary}`,
        value:
          approval.amountCents !== null && approval.currency
            ? formatMoney(approval.amountCents, approval.currency)
            : null,
        badge: <ApprovalStatusBadge status={approval.status} />,
      }))}
    />
  );
}

export function InvoiceErrorsWidget({ result, path }: { result: Paginated<Invoice>; path: PathFn }) {
  return (
    <QueuePanel
      title="Invoices that failed to issue"
      description={result.total > 0 ? "The provider refused these; each says why." : undefined}
      href={path("/admin/finance/invoices?status=ERROR")}
      empty="Every document reached the provider."
      rows={result.data.map((invoice) => ({
        key: invoice.id,
        href: path(`/admin/finance/invoices/${invoice.id}`),
        title: `${invoiceKindLabels[invoice.kind]} · ${invoice.receivable.reference}`,
        subtitle: invoice.syncError ?? invoice.buyer.name ?? null,
        value: formatMoney(invoice.totalCents, invoice.currency),
        badge: <InvoiceStatusBadge status={invoice.status} />,
      }))}
    />
  );
}

// --- Figures -----------------------------------------------------------------

export function BookingFiguresWidget({
  summary,
  arrivals,
  showValue,
}: {
  summary: AdminBookingSummary;
  arrivals: number;
  /** D1: the booked value is shown to whoever reads bookings; left here as a switch. */
  showValue: boolean;
}) {
  // The API sums per currency, largest first. The tile shows the leading one
  // and says so when there is more than one, rather than adding lari to
  // dollars and printing a number that is nothing.
  const [leading, ...otherCurrencies] = summary.recent.byCurrency;
  const monthValue = leading ?? { amountCents: 0, currency: "GEL" };
  const monthHint =
    otherCurrencies.length > 0
      ? `In ${monthValue.currency}; ${otherCurrencies.length} more ${otherCurrencies.length === 1 ? "currency" : "currencies"} not shown`
      : "Cancellations excluded";

  return (
    <>
      <StatCard label="Active bookings" value={String(summary.activeCount)} icon={CheckCircle2} hint="Confirmed or pending stays" />
      {showValue && (
        <StatCard
          label={`Booked, last ${summary.recent.days} days`}
          value={formatCompactMoney(monthValue.amountCents, monthValue.currency)}
          icon={Wallet}
          hint={monthHint}
        />
      )}
      <StatCard label="Arriving soon" value={String(arrivals)} icon={CalendarCheck} hint="Next confirmed check-ins" />
    </>
  );
}

export function PaymentsDueFigure({ due }: { due: PaymentsDue }) {
  const totals = due.totals.instalments;
  if (!totals) return null;
  return (
    <StatCard
      label="Supplier payments due"
      value={String(totals.overdue + totals.due)}
      icon={ArrowUpRight}
      hint={totals.overdue > 0 ? `${totals.overdue} late · ${totals.due} due this week` : `Due in the next ${due.days} days; none late`}
    />
  );
}

export function DispatchFiguresWidget({
  total,
  unassigned,
  offered,
}: {
  total: number;
  unassigned: number;
  offered: number;
}) {
  return (
    <>
      <StatCard label="Legs this week" value={String(total)} icon={CalendarClock} hint="Next 7 days" />
      <StatCard label="Need a driver" value={String(unassigned)} icon={UserPlus} />
      <StatCard label="Waiting for an answer" value={String(offered)} icon={Users} hint="Offered, not yet accepted" />
    </>
  );
}

export function FinanceFiguresWidget({ summary, path }: { summary: FinanceSummary; path: PathFn }) {
  if (summary.currencies.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-line p-8 text-center text-[0.875rem] text-muted">
        Nothing is owed either way yet. Figures appear here once a booking is confirmed.
      </p>
    );
  }
  return (
    <div className="space-y-8">
      {summary.currencies.map((figures) => (
        <FinanceOverviewCurrency
          key={figures.currency}
          figures={figures}
          reviewHref={path("/admin/finance/payables?needsReview=true")}
        />
      ))}
    </div>
  );
}

export function RecentPaymentsWidget({ payments, path }: { payments: Payment[]; path: PathFn }) {
  return <FinanceOverviewPayments payments={payments} path={path} />;
}

export function ArrivalsWidget({ arrivals, path }: { arrivals: BookingSummary[]; path: PathFn }) {
  return (
    <AdminPanel
      title="Arriving next"
      description={arrivals.length > 0 ? "Confirmed stays, soonest first." : "No upcoming arrivals."}
      bodyClassName="p-0"
    >
      {arrivals.length > 0 && (
        <ul className="divide-y divide-line">
          {arrivals.map((booking) => (
            <li key={booking.reference}>
              <Link
                href={path(`/admin/bookings/${booking.reference}`)}
                prefetch={false}
                className="flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface-soft/60"
              >
                <span>
                  <span className="block text-[0.875rem] font-medium text-ink">{booking.leadGuestName}</span>
                  <span className="block text-[0.75rem] text-muted">{booking.hotel.name}</span>
                </span>
                <span className="text-end text-[0.75rem] text-muted">{formatStayDate(booking.checkIn)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}

export function LatestBookingsWidget({ bookings, path }: { bookings: BookingSummary[]; path: PathFn }) {
  return (
    <AdminPanel
      title="Latest bookings"
      description="Newest first, across every property."
      action={
        <Link
          href={path("/admin/bookings")}
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-text transition-colors hover:text-brand-hover"
        >
          View all
        </Link>
      }
      bodyClassName="p-0"
    >
      <DataTable
        columns={[
          { label: "Reference" },
          { label: "Guest" },
          { label: "Stay", hideBelow: "md" },
          { label: "Status" },
          { label: "Total", align: "end" },
        ]}
        caption="Latest bookings"
      >
        {bookings.length === 0 ? (
          <EmptyRow colSpan={5} message="No bookings yet." />
        ) : (
          bookings.map((booking) => (
            <Row key={booking.reference}>
              <Cell>
                <Link
                  href={path(`/admin/bookings/${booking.reference}`)}
                  className="font-medium text-ink underline-offset-4 hover:underline"
                >
                  {booking.reference}
                </Link>
              </Cell>
              <Cell>{booking.leadGuestName}</Cell>
              <Cell hideBelow="md">{formatStay(booking.checkIn, booking.checkOut, booking.nights)}</Cell>
              <Cell>
                <BookingStatusBadge status={booking.status} />
              </Cell>
              <Cell align="end" className="tabular-nums">
                {formatMoney(booking.totalCents, booking.currency)}
              </Cell>
            </Row>
          ))
        )}
      </DataTable>
    </AdminPanel>
  );
}

// --- Deadlines ---------------------------------------------------------------

/**
 * The week's deadlines: how many of each kind fall due in the next seven
 * days, how many are already late, and the five soonest. Links into the
 * calendar's week view.
 */
export function DeadlinesWeekWidget({
  upcoming,
  overdue,
  today,
  path,
}: {
  upcoming: Paginated<Deadline>;
  overdue: number;
  today: string;
  path: PathFn;
}) {
  const counts = countByKind(upcoming.data);
  return (
    <AdminPanel
      title="Deadlines this week"
      description={
        upcoming.total > 0
          ? `${plural(upcoming.total, "deadline", "deadlines")} in the next seven days${overdue > 0 ? `, ${overdue} already late` : ""}.`
          : overdue > 0
            ? `Nothing due this week, but ${plural(overdue, "deadline is", "deadlines are")} already late.`
            : undefined
      }
      action={
        <Link
          href={path("/admin/deadlines?view=week")}
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-text transition-colors hover:text-brand-hover"
        >
          Open calendar
          <ArrowUpRight size={14} className="rtl:-scale-x-100" aria-hidden />
        </Link>
      }
      bodyClassName="p-0"
    >
      <dl className="grid grid-cols-3 divide-x divide-line border-b border-line">
        {DEADLINE_KINDS.map((kind) => (
          <div key={kind} className="px-4 py-3">
            <dt className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">{deadlineKindShortLabels[kind]}</dt>
            <dd className="mt-1 font-display text-[1.5rem] leading-none text-ink tabular-nums">{counts[kind]}</dd>
          </div>
        ))}
      </dl>
      {upcoming.data.length === 0 ? (
        <p className="px-5 py-8 text-center text-[0.875rem] text-muted">Nothing falls due in the next seven days.</p>
      ) : (
        <ul className="divide-y divide-line">
          {upcoming.data.slice(0, 5).map((row) => (
            <li key={row.id}>
              <Link
                href={path(bookingApprovalHref(row.product, row.reference))}
                prefetch={false}
                className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-soft/60"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[0.875rem] text-ink">
                    {row.reference}
                    {row.title ? <span className="text-muted"> · {row.title}</span> : null}
                  </span>
                  <span className="block text-[0.75rem] text-muted">{formatDeadlineInstant(row.dueAt, row.timezone, false)}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <DeadlineKindBadge kind={row.kind} overdue={row.overdue} />
                  <span className="text-[0.75rem] text-muted">{deadlineDueWords(row, today)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}
