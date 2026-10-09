import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarCheck, CheckCircle2, Handshake, Wallet } from "lucide-react";

import { AdminContainer, AdminPageHeader, AdminPanel } from "@/components/admin/AdminPage";
import { Cell, DataTable, EmptyRow, Row } from "@/components/admin/DataTable";
import { QuickStartCard } from "@/components/admin/help/QuickStartCard";
import { StatCard } from "@/components/admin/StatCard";
import { quickStartFor } from "@/lib/admin/help";
import { BookingStatusBadge, PartnerStatusBadge } from "@/components/admin/StatusBadge";
import { listPartners } from "@/lib/api/partners";
import { getSession } from "@/lib/auth/session";
import { can } from "@/types/auth";
import { APPLICATION_STATUSES, formatPartnerDate, partnerKindLabels } from "@/lib/admin/partners";
import { formatStay, formatStayDate } from "@/lib/admin/bookings";
import { formatCompactMoney, recentBookings, upcomingArrivals } from "@/lib/admin/metrics";
import { getBookingSummary } from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";

/**
 * The overview.
 *
 * Everything on it is a live record now — bookings joined partners in being
 * real. Every figure is a request, so they all go out in one `Promise.all`;
 * a dashboard that fetches serially is a dashboard nobody waits for.
 *
 * The chart of bookings-by-month went with the mock ledger it drew from. A
 * truthful replacement needs a server-side aggregate over booking history, and
 * an empty chart over three days of real data would be worse than none.
 */
export default async function AdminOverviewPage() {
  // Every figure on this screen is a booking or a partner. A role that reads
  // neither — a dispatcher — starts its day on the board instead.
  const session = await getSession();

  if (!can(session, "bookings.read")) {
    redirect(localePath(await getLocale(), "/admin/transfers/dispatch"));
  }

  const { path } = await getI18n();

  const [applications, approved, summary, arrivals, recent] = await Promise.all([
    listPartners({ status: APPLICATION_STATUSES, pageSize: 4 }),
    listPartners({ status: "APPROVED", pageSize: 1 }),
    getBookingSummary(30),
    upcomingArrivals(5),
    recentBookings(6),
  ]);

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
    <AdminContainer>
      <AdminPageHeader
        title={`Good morning, ${session?.user.firstName ?? "there"}`}
        description="What is live, what is arriving, and what needs a decision."
      />

      {/* The first-visit checklist. Dismissable, and remembered per browser;
          the help hub keeps an un-dismissable copy. */}
      <div className="mt-8">
        <QuickStartCard role="ADMIN" steps={quickStartFor("ADMIN")} dismissable />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active bookings"
          value={String(summary.activeCount)}
          icon={CheckCircle2}
          hint="Confirmed or pending stays"
        />
        <StatCard
          label="Booked, last 30 days"
          value={formatCompactMoney(monthValue.amountCents, monthValue.currency)}
          icon={Wallet}
          hint={monthHint}
        />
        <StatCard
          label="Arriving soon"
          value={String(arrivals.length)}
          icon={CalendarCheck}
          hint="Next confirmed check-ins"
        />
        <StatCard
          label="Partner applications"
          value={String(applications.total)}
          icon={Handshake}
          hint={`${approved.total} partners approved`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <AdminPanel
          title="Latest bookings"
          description="Newest first, across every property."
          className="xl:col-span-2"
          action={
            <Link
              href={path("/admin/bookings")}
              className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-text transition-colors hover:text-brand-hover"
            >
              View all
              <ArrowRight size={14} className="rtl:-scale-x-100" aria-hidden />
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
            {recent.length === 0 ? (
              <EmptyRow colSpan={5} message="No bookings yet." />
            ) : (
              recent.map((booking) => (
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
                  <Cell hideBelow="md">
                    {formatStay(booking.checkIn, booking.checkOut, booking.nights)}
                  </Cell>
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

        <div className="flex flex-col gap-6">
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
                      className="flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface-soft/60"
                    >
                      <span>
                        <span className="block text-[0.875rem] font-medium text-ink">
                          {booking.leadGuestName}
                        </span>
                        <span className="block text-[0.75rem] text-muted">
                          {booking.hotel.name}
                        </span>
                      </span>
                      <span className="text-end text-[0.75rem] text-muted">
                        {formatStayDate(booking.checkIn)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </AdminPanel>

          <AdminPanel
            title="Partner applications"
            description={
              applications.total > 0
                ? "Oldest first — that is the order they should be worked."
                : "The queue is clear."
            }
            action={
              <Link
                href={path("/admin/partners/applications")}
                className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-text transition-colors hover:text-brand-hover"
              >
                Review
                <ArrowRight size={14} className="rtl:-scale-x-100" aria-hidden />
              </Link>
            }
            bodyClassName="p-0"
          >
            {applications.data.length > 0 && (
              <ul className="divide-y divide-line">
                {applications.data.map((partner) => (
                  <li key={partner.id}>
                    <Link
                      href={path(`/admin/partners/${partner.id}`)}
                      className="flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface-soft/60"
                    >
                      <span>
                        <span className="block text-[0.875rem] font-medium text-ink">
                          {partner.name}
                        </span>
                        <span className="block text-[0.75rem] text-muted">
                          {partnerKindLabels[partner.kind]} · {formatPartnerDate(partner.createdAt)}
                        </span>
                      </span>
                      <PartnerStatusBadge status={partner.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </AdminPanel>
        </div>
      </div>
    </AdminContainer>
  );
}
