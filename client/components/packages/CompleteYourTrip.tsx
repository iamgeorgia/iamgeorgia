import Link from "next/link";
import { ArrowRight, CarFront, Layers } from "lucide-react";

import { Container } from "@/components/ui/Container";
import { SafeImage } from "@/components/ui/SafeImage";
import { ApiError } from "@/lib/api/client";
import { getRecommendations } from "@/lib/api/packages";
import { formatStayDate } from "@/lib/booking/stay";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import { packageImageUrl } from "@/lib/packages/query";
import { tourImageUrl } from "@/lib/tours/query";
import type { Recommendations } from "@/types/package";

interface CompleteYourTripProps {
  /** Exactly one of these. The rail is built around whichever is given. */
  hotel?: string;
  tour?: string;
  checkIn: string;
  checkOut?: string;
  adults: number;
  childAges?: number[];
}

/**
 * "Complete your trip": what goes with the thing being looked at.
 *
 * Every card here is a real offer the server priced for these exact dates and
 * this exact party, through the same engines that would take the booking — so
 * a price shown is a price bookable, and anything that could not be priced is
 * simply absent rather than shown greyed out.
 *
 * The whole rail is optional decoration on someone else's page, so a failure
 * renders nothing at all. A hotel page must not 500 because the transfer
 * catalogue has no airport near the property.
 */
export async function CompleteYourTrip(props: CompleteYourTripProps) {
  const { t, path, locale, intlLocale, fill } = await getI18n();

  let recommendations: Recommendations | null = null;

  try {
    recommendations = await getRecommendations({
      hotel: props.hotel,
      tour: props.tour,
      checkIn: props.checkIn,
      checkOut: props.checkOut,
      adults: props.adults,
      childAges: props.childAges,
      locale,
    });
  } catch (error) {
    // A 4xx here means the anchor or the dates were not quotable, which is a
    // reason to show no rail rather than to break the page around it.
    if (!(error instanceof ApiError)) throw error;
  }

  if (!recommendations) return null;

  const { transfers, tours, packages } = recommendations;
  const legs = [transfers.arrival, transfers.departure].filter(
    (leg): leg is NonNullable<typeof leg> => leg !== null,
  );

  if (legs.length === 0 && tours.length === 0 && packages.length === 0) return null;

  return (
    <section className="border-t border-line py-16 lg:py-20">
      <Container>
        <h2 className="type-h3">{t.packages.heroTitle}</h2>
        <p className="type-body-sm mt-2 max-w-2xl text-muted">{t.packages.heroDescription}</p>

        {/* --- transfers ------------------------------------------------- */}
        {legs.length > 0 && (
          <div className="mt-8">
            <h3 className="type-caption font-semibold tracking-wide text-muted uppercase">
              {t.nav.transfers}
            </h3>
            {/* `grid-cols-1` is `minmax(0, 1fr)`. Without it the phone layout
                ran on one implicit `auto` track, which grows to the min-content
                of its widest item — and a `truncate` line's min-content is the
                whole untruncated route name, so the page scrolled sideways. */}
            <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {legs.map((leg) => (
                <li key={`${leg.from.id}-${leg.to.id}-${leg.date}`} className="min-w-0">
                  <Link
                    href={path(
                      `/transfers?from=${leg.from.slug}&to=${leg.to.slug}&date=${leg.date}&adults=${props.adults}`,
                    )}
                    className="group flex items-center gap-3 border border-line bg-surface p-4 transition-colors hover:border-ink"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-soft text-brand-text">
                      <CarFront size={17} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="type-body-sm block truncate text-ink">
                        {leg.from.name} → {leg.to.name}
                      </span>
                      <span className="type-caption block text-muted">
                        {formatStayDate(leg.date, intlLocale)} · {leg.offer.vehicle.name}
                      </span>
                    </span>
                    <span className="type-body-sm shrink-0 tabular-nums text-ink">
                      {formatMoney(
                        leg.offer.quote.totals.totalCents,
                        leg.offer.quote.currency,
                        intlLocale,
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* --- tours ------------------------------------------------------ */}
        {tours.length > 0 && (
          <div className="mt-8">
            <h3 className="type-caption font-semibold tracking-wide text-muted uppercase">
              {t.nav.tours}
            </h3>
            <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tours.slice(0, 3).map((tour) => {
                const image = tourImageUrl(tour);
                const offer = tour.cheapestOffer;

                return (
                  <li key={tour.id}>
                    <Link
                      href={path(
                        `/tours/${tour.slug}?date=${offer?.date ?? props.checkIn}&adults=${props.adults}`,
                      )}
                      className="group block"
                    >
                      {/* Through the optimiser like every other tour card, so a
                          phone gets a resized WebP rather than the original
                          photograph; lazy by default, as the rail is far below
                          the fold. */}
                      <span className="relative block aspect-4/3 overflow-hidden rounded-sm bg-line">
                        {image && (
                          <SafeImage
                            src={image}
                            alt=""
                            fill
                            sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 30vw"
                            className="object-cover transition-transform duration-700 ease-(--ease-out-soft) group-hover:scale-[1.04]"
                          />
                        )}
                      </span>
                      <span className="type-body-sm mt-3 block text-ink transition-colors group-hover:text-brand-text">
                        {tour.title}
                      </span>
                      {offer && (
                        <span className="type-caption mt-1 block text-muted">
                          {formatStayDate(offer.date, intlLocale)} ·{" "}
                          {formatMoney(
                            offer.quote.totals.totalCents,
                            offer.quote.currency,
                            intlLocale,
                          )}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* --- packages --------------------------------------------------- */}
        {packages.length > 0 && (
          <div className="mt-8">
            <h3 className="type-caption font-semibold tracking-wide text-muted uppercase">
              {t.nav.packages}
            </h3>
            <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {packages.slice(0, 3).map((pkg) => {
                const image = packageImageUrl(pkg);

                return (
                  <li key={pkg.id} className="min-w-0">
                    <Link
                      href={path(
                        `/packages/${pkg.slug}?startDate=${pkg.quote.startDate}&adults=${props.adults}`,
                      )}
                      className="group flex h-full flex-col border border-line bg-surface p-4 transition-colors hover:border-ink"
                    >
                      <span className="flex items-center gap-2">
                        <Layers size={15} className="shrink-0 text-brand-text" aria-hidden />
                        <span className="type-body-sm truncate text-ink">{pkg.name}</span>
                      </span>
                      <span className="type-caption mt-1.5 block text-muted">
                        {fill(t.packages.nights, { count: pkg.nights })} ·{" "}
                        {formatStayDate(pkg.quote.startDate, intlLocale)}
                      </span>
                      <span className="type-body-sm mt-auto pt-3 tabular-nums text-ink">
                        {formatMoney(pkg.quote.totalCents, pkg.quote.currency, intlLocale)}
                      </span>
                      {image && <span className="sr-only">{pkg.name}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Link
              href={path("/packages")}
              className="type-body-sm mt-4 inline-flex items-center gap-1.5 text-brand-text underline-offset-4 hover:underline"
            >
              {t.packages.crumb}
              <ArrowRight size={14} aria-hidden className="rtl:-scale-x-100" />
            </Link>
          </div>
        )}
      </Container>
    </section>
  );
}
