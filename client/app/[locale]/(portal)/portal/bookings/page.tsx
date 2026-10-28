import type { Metadata } from "next";
import { redirect } from "next/navigation";

import Link from "next/link";

import { AllBookingsBrowser } from "@/components/admin/AllBookingsBrowser";
import { TourBookingsBrowser } from "@/components/admin/TourBookingsBrowser";
import { TransferBookingsBrowser } from "@/components/admin/TransferBookingsBrowser";
import { PortalBookingsBrowser } from "@/components/partners/PortalBookingsBrowser";
import { PortalDeadlinesPanel } from "@/components/partners/PortalDeadlinesPanel";
import { PortalOrdersBrowser } from "@/components/partners/PortalOrdersBrowser";
import { Container } from "@/components/ui/Container";
import { BOOKING_APPROVAL_PRODUCTS } from "@/lib/admin/bookingApprovals";
import { bookingFiltersFromParams } from "@/lib/admin/bookingFilters";
import { bookingQueryFromParams } from "@/lib/admin/bookings";
import { todayISO } from "@/lib/admin/dates";
import { tourBookingQueryFromParams } from "@/lib/admin/tours";
import { transferBookingQueryFromParams } from "@/lib/admin/transfers";
import { listPartnerAllBookings } from "@/lib/api/bookingIndex";
import { listPartnerBookings } from "@/lib/api/bookings";
import { listPartnerOrders } from "@/lib/api/orders";
import { listPartnerTourBookings } from "@/lib/api/tours";
import { listPartnerTransferBookings } from "@/lib/api/transfers";
import { orderQueryFromParams } from "@/lib/packages/orders";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { homePathFor } from "@/types/auth";
import type { BookingApprovalProduct } from "@/types/booking";

export const metadata: Metadata = { title: "Bookings" };

const PRODUCTS = ["hotels", "transfers", "tours", "orders", "all"] as const;
type Product = (typeof PRODUCTS)[number];

const intro: Record<Product, string> = {
  hotels:
    "Every stay you have booked, newest first. Open one to correct the guest details or to cancel it.",
  transfers:
    "Every journey you have booked, soonest pick-up first. Open one to see the driver, the legs and the cancellation terms.",
  tours:
    "Every departure you have booked, newest first. Open one to correct the traveller details or to cancel it.",
  // An order is the whole trip, so the sentence has to name the two different
  // cancellations a partner has: the trip, or one optional part of it.
  orders:
    "Every trip you have booked as a package, newest first. Open one to see each part and its own reference, to drop an optional part, or to cancel the whole trip.",
  all: "Everything you have booked, whatever it is, in one list — for the moment you have a name and no reference.",
};

/**
 * Everything this partner has booked.
 *
 * `/api/partner/bookings` scopes the query to the caller's own company in the
 * `where` clause rather than filtering a wider result afterwards, so there is
 * no path by which one partner's list contains another's booking — the guard
 * is the query, not this page.
 *
 * Filtering is read out of the URL and applied on the server, which is why the
 * list survives a reload, can be shared with a colleague, and costs the same
 * for a partner with four thousand bookings as for one with four.
 */
export default async function PortalBookingsPage({
  searchParams,
}: PageProps<"/[locale]/portal/bookings">) {
  const session = await getSession();
  const locale = await getLocale();

  if (!session) redirect(localePath(locale, "/portal/sign-in"));

  if (!session.partner) {
    redirect(localePath(locale, homePathFor(session)));
  }

  // Unapproved partners are sent back to the page that explains where they
  // stand, exactly as the settings screen does.
  if (session.partner.status !== "APPROVED") {
    redirect(localePath(locale, "/portal"));
  }

  // A new version of the platform terms locks the portal until the owner accepts it.
  if (session.partner.terms?.outdated) {
    redirect(localePath(locale, "/portal/terms"));
  }

  const { path } = await getI18n();
  const params = await searchParams;
  const today = todayISO();
  // Several registers behind one page, because a BKG reference is not a TUR
  // one and neither is an ORD: separate endpoints, separate shapes, separate
  // detail screens. Read through the list rather than a chain of ternaries so
  // an unknown `?product=` falls back to hotels instead of rendering nothing.
  const requested = Array.isArray(params.product) ? params.product[0] : params.product;
  const product = PRODUCTS.includes(requested as Product) ? (requested as Product) : "hotels";

  const tabs = [
    { key: "hotels", label: "Hotels", href: "/portal/bookings" },
    { key: "transfers", label: "Transfers", href: "/portal/bookings?product=transfers" },
    { key: "tours", label: "Tours", href: "/portal/bookings?product=tours" },
    { key: "orders", label: "Orders", href: "/portal/bookings?product=orders" },
    { key: "all", label: "All", href: "/portal/bookings?product=all" },
  ] as const;

  // Only the open tab is fetched: the other registers are a click away and
  // paying for all of them on every render buys nothing.
  const hotels =
    product === "hotels" ? await listPartnerBookings(bookingQueryFromParams(params)) : null;
  const transfers =
    product === "transfers" ? await listPartnerTransferBookings(transferBookingQueryFromParams(params)) : null;
  const tours =
    product === "tours" ? await listPartnerTourBookings(tourBookingQueryFromParams(params)) : null;
  const orders = product === "orders" ? await listPartnerOrders(orderQueryFromParams(params)) : null;
  const all =
    product === "all"
      ? await (async () => {
          const { product: chosen, ...filters } = bookingFiltersFromParams(params, { products: BOOKING_APPROVAL_PRODUCTS });
          return listPartnerAllBookings({ ...filters, product: chosen as BookingApprovalProduct[] | undefined, pageSize: 25 });
        })()
      : null;

  return (
    <Container className="py-12 sm:py-16">
      <h1 className="font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">Bookings</h1>
      <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-muted">{intro[product]}</p>

      {/* The next two weeks' deadlines, above the registers; absent when there are none. */}
      <div className="mt-8">
        <PortalDeadlinesPanel />
      </div>

      <nav aria-label="Product" className="mt-8 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={path(tab.href)}
            aria-current={product === tab.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors",
              product === tab.key ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-8">
        {hotels && <PortalBookingsBrowser {...hotels} today={today} />}
        {transfers && (
          <TransferBookingsBrowser
            {...transfers}
            basePath="/portal/bookings"
            caption="Your transfer bookings"
            today={today}
            showPartner={false}
            showManager={false}
            keep={["product"]}
          />
        )}
        {tours && (
          <TourBookingsBrowser
            {...tours}
            basePath="/portal/bookings"
            caption="Your tour bookings"
            today={today}
            keep={["product"]}
          />
        )}
        {orders && <PortalOrdersBrowser {...orders} today={today} />}
        {all && (
          <AllBookingsBrowser
            {...all}
            basePath="/portal/bookings"
            today={today}
            showPartner={false}
            showManager={false}
            keep={["product"]}
            // The portal has no page for a service booked on its own.
            unlinkedProducts={["SERVICE"]}
          />
        )}
      </div>
    </Container>
  );
}
