import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { BookingStatusBadge } from "@/components/admin/StatusBadge";
import { Container } from "@/components/ui/Container";
import { ApiError, serverFetch } from "@/lib/api/client";
import { isTermsOutdated } from "@/lib/partners/terms";
import { listPartnerBookings } from "@/lib/api/bookings";
import { listPartnerOrders } from "@/lib/api/orders";
import { formatStay } from "@/lib/admin/bookings";
import { formatCommission, formatPartnerDate } from "@/lib/admin/partners";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import type { Partner } from "@/types";
import type { BookingSummary } from "@/types/booking";
import type { Paginated } from "@/types/partner";

export const metadata: Metadata = { title: "Dashboard" };

interface DashboardResponse {
  partner: Partner;
  stats: { listings: number; bookings: number; upcoming: number; cancelled: number };
}

/**
 * The platform itself.
 *
 * The endpoint behind this is guarded by `requireApprovedPartner`, so a partner
 * in any other status gets a 403 carrying its status — which is the signal to
 * send them back to the page that explains it. The guard is the server's; this
 * only decides where to go when it refuses.
 *
 * The recent bookings below the tiles are the same list as `/portal/bookings`,
 * cut to a handful. A dashboard that only counts things makes a partner click
 * before they can see whether anything needs them.
 */
export default async function PortalDashboardPage() {
  const locale = await getLocale();
  const { path } = await getI18n();

  let data: DashboardResponse;

  try {
    data = await serverFetch<DashboardResponse>("/api/partner/dashboard");
  } catch (error) {
    // The owner has not accepted the current platform terms: that page is the only way on.
    if (error instanceof ApiError && error.status === 403 && isTermsOutdated(error)) {
      redirect(localePath(locale, "/portal/terms"));
    }
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      redirect(localePath(locale, error.status === 401 ? "/portal/sign-in" : "/portal"));
    }
    throw error;
  }

  const { partner, stats } = data;

  if (partner.terms?.outdated) redirect(localePath(locale, "/portal/terms"));

  // Only after the dashboard call has established the partner is through the
  // gate — an unapproved one is already redirected above.
  //
  // Guarded, because this list is the secondary panel: the dashboard above is
  // the page, and a partner should still see their numbers when the bookings
  // query is the one thing that fell over. Null renders as "could not load".
  //
  // Orders are counted off their own register: the dashboard endpoint predates
  // them and knows only about stays. Two queries for two totals is cheaper
  // than a second shape on the server, and a failure shows a dash rather than
  // taking the page down — the same treatment the list gets.
  //
  // The three reads are independent of each other, so they go out together;
  // each keeps its own fallback so one failing does not blank the others.
  const [recent, orders] = await Promise.all([
    listPartnerBookings({ pageSize: 5 }).catch((error: unknown): Paginated<BookingSummary> | null => {
      console.error("Portal recent bookings failed:", error);
      return null;
    }),
    Promise.all([
      listPartnerOrders({ pageSize: 1 }),
      listPartnerOrders({ status: "PENDING_CONFIRMATION", pageSize: 1 }),
    ]).then(
      ([all, awaiting]): { total: number; awaiting: number } | null => ({
        total: all.total,
        awaiting: awaiting.total,
      }),
      (error: unknown) => {
        console.error("Portal order counts failed:", error);
        return null;
      },
    ),
  ]);

  return (
    <Container className="py-12 sm:py-16">
      <p className="font-mono text-[0.8125rem] tracking-wide text-brand-text">{partner.reference}</p>
      <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">
        {partner.name}
      </h1>
      <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-muted">
        Your account is approved and active.
      </p>

      {/* Six tiles across three columns rather than four: the two order figures
          are always rendered, dashed when the count could not be read, so the
          row does not reflow depending on whether a request succeeded. */}
      <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: "Bookings", value: String(stats.bookings) },
          { label: "Arriving from today", value: String(stats.upcoming) },
          { label: "Orders", value: orders ? String(orders.total) : "—" },
          {
            label: "Orders awaiting confirmation",
            value: orders ? String(orders.awaiting) : "—",
          },
          { label: "Live listings", value: String(stats.listings) },
          { label: "Commission", value: formatCommission(partner.commissionRateBps) },
        ].map((item) => (
          <div key={item.label} className="rounded-sm border border-line bg-surface p-5">
            <dt className="text-[0.8125rem] text-muted">{item.label}</dt>
            <dd className="mt-2 font-display text-2xl text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-[0.8125rem] text-subtle">
        Partner since {formatPartnerDate(partner.review.approvedAt)}
        {stats.cancelled > 0 && ` · ${stats.cancelled} cancelled`}
      </p>

      <section className="mt-12">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-[1.5rem] text-ink">Recent bookings</h2>
          <Link
            href={path("/portal/bookings")}
            className="inline-flex items-center gap-1.5 text-[0.8125rem] text-muted transition-colors hover:text-ink"
          >
            All bookings
            <ArrowRight size={14} className="rtl:-scale-x-100" aria-hidden />
          </Link>
        </div>

        {recent === null ? (
          <p className="mt-5 rounded-sm border border-line bg-surface p-6 text-[0.875rem] text-muted">
            Recent bookings could not be loaded just now. Your figures above are current; open
            All bookings to try the list again.
          </p>
        ) : recent.total === 0 ? (
          <p className="mt-5 rounded-sm border border-line bg-surface p-6 text-[0.875rem] text-muted">
            Nothing booked yet. Anything you book while signed in appears here, and you can amend
            or cancel it from its own page.
          </p>
        ) : (
          /*
            A read-only cut of the list, not the filterable browser: the filters
            on that one write to the URL, and this page does not read the URL —
            a search box that silently does nothing is worse than no search box.
          */
          <ul className="mt-5 divide-y divide-line rounded-sm border border-line bg-surface">
            {recent.data.map((booking) => (
              <li key={booking.reference}>
                <Link
                  href={path(`/portal/bookings/${booking.reference}`)}
                  className="flex flex-wrap items-center gap-x-5 gap-y-2 p-4 transition-colors hover:bg-surface-soft"
                >
                  <span className="font-mono text-[0.8125rem] text-ink">{booking.reference}</span>
                  <span className="min-w-0 flex-1 text-[0.875rem] text-body">
                    {booking.leadGuestName}
                    <span className="block text-[0.8125rem] text-muted">
                      {booking.hotel.name} · {formatStay(booking.checkIn, booking.checkOut, booking.nights)}
                    </span>
                  </span>
                  <BookingStatusBadge status={booking.status} />
                  <span className="text-[0.875rem] font-medium text-ink tabular-nums">
                    {formatMoney(booking.totalCents, booking.currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Container>
  );
}
