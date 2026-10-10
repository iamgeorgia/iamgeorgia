import type { Metadata } from "next";
import { redirect } from "next/navigation";

import Link from "next/link";

import { TourBookingsBrowser } from "@/components/admin/TourBookingsBrowser";
import { PortalBookingsBrowser } from "@/components/partners/PortalBookingsBrowser";
import { PortalOrdersBrowser } from "@/components/partners/PortalOrdersBrowser";
import { Container } from "@/components/ui/Container";
import { bookingQueryFromParams } from "@/lib/admin/bookings";
import { tourBookingQueryFromParams } from "@/lib/admin/tours";
import { listPartnerBookings } from "@/lib/api/bookings";
import { listPartnerOrders } from "@/lib/api/orders";
import { listPartnerTourBookings } from "@/lib/api/tours";
import { orderQueryFromParams } from "@/lib/packages/orders";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { homePathFor } from "@/types/auth";

export const metadata: Metadata = { title: "Bookings" };

const PRODUCTS = ["hotels", "tours", "orders"] as const;
type Product = (typeof PRODUCTS)[number];

const intro: Record<Product, string> = {
  hotels:
    "Every stay you have booked, newest first. Open one to correct the guest details or to cancel it.",
  tours:
    "Every departure you have booked, newest first. Open one to correct the traveller details or to cancel it.",
  // An order is the whole trip, so the sentence has to name the two different
  // cancellations a partner has: the trip, or one optional part of it.
  orders:
    "Every trip you have booked as a package, newest first. Open one to see each part and its own reference, to drop an optional part, or to cancel the whole trip.",
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
  // Several registers behind one page, because a BKG reference is not a TUR
  // one and neither is an ORD: separate endpoints, separate shapes, separate
  // detail screens. Read through the list rather than a chain of ternaries so
  // an unknown `?product=` falls back to hotels instead of rendering nothing.
  const requested = Array.isArray(params.product) ? params.product[0] : params.product;
  const product = PRODUCTS.includes(requested as Product) ? (requested as Product) : "hotels";

  const tabs = [
    { key: "hotels", label: "Hotels", href: "/portal/bookings" },
    { key: "tours", label: "Tours", href: "/portal/bookings?product=tours" },
    { key: "orders", label: "Orders", href: "/portal/bookings?product=orders" },
  ] as const;

  // Only the open tab is fetched: the other registers are a click away and
  // paying for all of them on every render buys nothing.
  const hotels =
    product === "hotels" ? await listPartnerBookings(bookingQueryFromParams(params)) : null;
  const tours =
    product === "tours" ? await listPartnerTourBookings(tourBookingQueryFromParams(params)) : null;
  const orders = product === "orders" ? await listPartnerOrders(orderQueryFromParams(params)) : null;

  return (
    <Container className="py-12 sm:py-16">
      <h1 className="font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">Bookings</h1>
      <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-muted">{intro[product]}</p>

      <nav aria-label="Product" className="mt-8 flex gap-1 border-b border-line">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={path(tab.href)}
            aria-current={product === tab.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-[0.8125rem] font-medium transition-colors",
              product === tab.key ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-8">
        {tours && (
          <TourBookingsBrowser {...tours} basePath="/portal/bookings" caption="Your tour bookings" />
        )}
        {orders && <PortalOrdersBrowser {...orders} />}
        {hotels && <PortalBookingsBrowser {...hotels} />}
      </div>
    </Container>
  );
}
