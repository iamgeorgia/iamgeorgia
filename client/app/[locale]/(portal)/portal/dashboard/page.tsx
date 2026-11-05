import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  CalendarClock,
  Hourglass,
  Inbox,
  Package,
  Percent,
  Store,
} from "lucide-react";

import { BookingStatusBadge, PartnerStatusBadge } from "@/components/admin/StatusBadge";
import { PortalDeadlinesPanel } from "@/components/partners/PortalDeadlinesPanel";
import {
  PortalContainer,
  PortalEmpty,
  PortalFacts,
  PortalPageHeader,
  PortalPanel,
  PortalStat,
} from "@/components/partners/PortalPage";
import { Button } from "@/components/ui/Button";
import { ApiError, serverFetch } from "@/lib/api/client";
import { isTermsOutdated } from "@/lib/partners/terms";
import { listPartnerBookings } from "@/lib/api/bookings";
import { listPartnerOrders } from "@/lib/api/orders";
import { bookingFiltersToSearch, presetFilters } from "@/lib/admin/bookingFilters";
import { formatStay } from "@/lib/admin/bookings";
import { todayISO } from "@/lib/admin/dates";
import { formatCommission, formatPartnerDate, partnerKindLabels } from "@/lib/admin/partners";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import { can } from "@/types/auth";
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
 * Read top to bottom, the page answers what a partner signs in to ask: how
 * the account stands (the figures, each opening the register behind it),
 * what is about to fall due (the deadlines, when there are any), and what
 * was booked last. The recent bookings are the same list as
 * `/portal/bookings`, cut to a handful: a dashboard that only counts things
 * makes a partner click before they can see whether anything needs them.
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
  // Guarded, because this list is the secondary panel: the figures above are
  // the page, and a partner should still see their numbers when the bookings
  // query is the one thing that fell over. Null renders as "could not load".
  //
  // Orders are counted off their own register: the dashboard endpoint predates
  // them and knows only about stays. Two queries for two totals is cheaper
  // than a second shape on the server, and a failure shows a dash rather than
  // taking the page down — the same treatment the list gets.
  //
  // The reads are independent of each other, so they go out together; each
  // keeps its own fallback so one failing does not blank the others. The
  // session is the layout's, already cached for this request.
  const [recent, orders, session] = await Promise.all([
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
    getSession(),
  ]);

  const today = todayISO();
  const mayReadFinance = can(session, "partner.statement.read");

  // Each figure opens the register it counts, filtered the way the count is.
  const tiles = [
    {
      label: "Bookings",
      value: String(stats.bookings),
      icon: CalendarCheck,
      href: path("/portal/bookings"),
    },
    {
      label: "Arriving from today",
      value: String(stats.upcoming),
      icon: CalendarClock,
      href: path(`/portal/bookings${bookingFiltersToSearch(presetFilters("upcoming", today))}`),
    },
    {
      label: "Orders",
      value: orders ? String(orders.total) : "—",
      icon: Package,
      href: path("/portal/bookings?product=orders"),
    },
    {
      label: "Orders awaiting confirmation",
      value: orders ? String(orders.awaiting) : "—",
      icon: Hourglass,
      href: path("/portal/bookings?product=orders&status=PENDING_CONFIRMATION"),
      tone: orders && orders.awaiting > 0 ? ("attention" as const) : undefined,
    },
    { label: "Live listings", value: String(stats.listings), icon: Store },
    {
      label: "Commission",
      value: partner.commissionRateBps === undefined ? "—" : formatCommission(partner.commissionRateBps),
      icon: Percent,
      href: mayReadFinance ? path("/portal/finance") : undefined,
    },
  ];

  return (
    <PortalContainer>
      <PortalPageHeader
        title={partner.name}
        meta={
          <>
            <PartnerStatusBadge status={partner.status} />
            <span className="text-[0.8125rem] text-muted">
              {partnerKindLabels[partner.kind]} · Partner since {formatPartnerDate(partner.review.approvedAt)}
            </span>
          </>
        }
        actions={
          <>
            <Button href={path("/portal/bookings")} variant="outline">
              All bookings
            </Button>
            <Button href={path("/")}>
              Book on the site
              <ArrowUpRight size={15} className="rtl:-scale-x-100" aria-hidden />
            </Button>
          </>
        }
      />

      {/* Six tiles, always: the two order figures are dashed when the count
          could not be read, so the grid does not reflow depending on whether
          a request succeeded. Two across on a phone, three on a tablet and a
          laptop, one row of six once there is room for it. */}
      <section aria-labelledby="dashboard-figures">
        <h2 id="dashboard-figures" className="sr-only">
          Your figures
        </h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
          {tiles.map((tile) => (
            <PortalStat key={tile.label} {...tile} />
          ))}
        </ul>
      </section>

      {/* What falls due in the next two weeks. Renders nothing when nothing
          does, and nothing when the read fails; streamed, so it never holds
          the figures above. */}
      <Suspense fallback={null}>
        <div className="mt-6 empty:hidden">
          <PortalDeadlinesPanel />
        </div>
      </Suspense>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <PortalPanel
          title="Recent bookings"
          description="Your latest hotel stays. Open one to amend the guest details or cancel it."
          action={
            <Link
              href={path("/portal/bookings")}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-sm px-2 text-[0.8125rem] font-medium text-brand-text transition-colors hover:bg-surface-soft"
            >
              All bookings
              <ArrowRight size={14} className="rtl:-scale-x-100" aria-hidden />
            </Link>
          }
          bodyClassName=""
          className="lg:col-span-2"
        >
          {recent === null ? (
            <PortalEmpty>
              Recent bookings could not be loaded just now. Your figures above are current; open All
              bookings to try the list again.
            </PortalEmpty>
          ) : recent.total === 0 ? (
            <PortalEmpty icon={Inbox} title="Nothing booked yet">
              Anything you book while signed in appears here, and you can amend or cancel it from its
              own page.
            </PortalEmpty>
          ) : (
            /*
              A read-only cut of the list, not the filterable browser: the filters
              on that one write to the URL, and this page does not read the URL —
              a search box that silently does nothing is worse than no search box.
            */
            <ul className="divide-y divide-line">
              {recent.data.map((booking) => (
                <li key={booking.reference}>
                  <Link
                    href={path(`/portal/bookings/${booking.reference}`)}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-surface-soft/60 sm:px-5"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="font-mono text-[0.8125rem] font-medium text-ink">{booking.reference}</span>
                        <BookingStatusBadge status={booking.status} />
                      </span>
                      <span className="mt-1.5 block truncate text-[0.875rem] font-medium text-ink">
                        {booking.leadGuestName}
                      </span>
                      <span className="block text-[0.8125rem] leading-snug text-muted">
                        {booking.hotel.name} · {formatStay(booking.checkIn, booking.checkOut, booking.nights)}
                      </span>
                    </span>
                    <span className="text-[0.9375rem] font-semibold whitespace-nowrap text-ink tabular-nums">
                      {formatMoney(booking.totalCents, booking.currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </PortalPanel>

        <PortalPanel title="Your account" className="self-start">
          <PortalFacts
            items={[
              { label: "Partner ID", value: <span className="font-mono">{partner.reference}</span> },
              { label: "Type", value: partnerKindLabels[partner.kind] },
              { label: "Partner since", value: formatPartnerDate(partner.review.approvedAt) },
              { label: "Cancelled bookings", value: String(stats.cancelled) },
              {
                label: "Platform terms",
                value: (
                  <Link
                    href={path("/portal/terms")}
                    className="text-brand-text underline-offset-4 hover:underline"
                  >
                    {partner.terms?.acceptedVersion ? `Version ${partner.terms.acceptedVersion}` : "View"}
                  </Link>
                ),
              },
            ]}
          />
        </PortalPanel>
      </div>
    </PortalContainer>
  );
}
