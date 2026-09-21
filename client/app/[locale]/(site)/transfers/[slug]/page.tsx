import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Briefcase, Check, Clock, Info, MapPin, Route, Users, X } from "lucide-react";

import { MobileBookingBar } from "@/components/booking/MobileBookingBar";
import { featureIcons } from "@/components/transfers/featureIcons";
import { TransferBookingSummary } from "@/components/transfers/TransferBookingSummary";
import { TransferGallery } from "@/components/transfers/TransferGallery";
import { TransferJourneyBar } from "@/components/transfers/TransferJourneyBar";
import { TransferSteps } from "@/components/transfers/TransferSteps";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Rating } from "@/components/ui/Rating";
import { ShareSave } from "@/components/ui/ShareSave";
import { ApiError } from "@/lib/api/client";
import { getTransferVehicle, quoteTransfers } from "@/lib/api/transfers";
import { getI18n } from "@/lib/i18n/server";
import { JsonLd, breadcrumbSchema, transferServiceSchema } from "@/lib/seo/jsonLd";
import { notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { redirectToCanonicalSlug } from "@/lib/seo/slug";
import {
  formatDuration,
  paramsFromSearchParams,
  parseTransferQuery,
  serializeTransferQuery,
} from "@/lib/transfers/query";
import { formatMoney } from "@/lib/money";
import type { TransferOffer, TransferQuoteResult, TransferVehicle } from "@/types/transfer";

/**
 * A vehicle class — and, when the URL carries a journey, a quote for it.
 *
 * Two pages behind one route. Bare, `/transfers/standard-sedan` is a brochure
 * for the class: what it seats, what it carries, what is included, how pick-up
 * works. That is real, stable content and is indexed as such. With a journey
 * in the query string it is one traveller's quote, which is not — every dated
 * variant canonicalises to the bare address, so the index holds one page per
 * class and none per query.
 *
 * Deliberately not prerendered: a price for a specific route, date and party
 * is not something to serve from a cache built at deploy time.
 */

/**
 * The class, or nothing. A trade-only class 404s for an anonymous visitor
 * because the endpoint will not return it, which is a stronger guarantee than
 * a flag checked here would be.
 */
const loadVehicle = cache(async (slug: string, locale: string): Promise<TransferVehicle | null> => {
  try {
    return await getTransferVehicle(slug, locale);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
});

export async function generateMetadata(
  props: PageProps<"/[locale]/transfers/[slug]">,
): Promise<Metadata> {
  const [{ slug }, { t, locale, fill }] = await Promise.all([props.params, getI18n()]);
  const vehicle = await loadVehicle(slug, locale);
  if (!vehicle) return notFoundMetadata(t.transfers.detail.notFound);

  /*
   * No image is passed: the class is shown as a drawing rather than a
   * photograph, for the reason set out in `VehicleIllustration`, and a link
   * preview gets the brand card instead of a picture of a car nobody promised.
   */
  return pageMetadata({
    path: `/transfers/${vehicle.slug}`,
    title: fill(t.transfers.detail.metaTitle, { name: vehicle.name }),
    description: vehicle.summary,
    imageAlt: `${vehicle.name} — ${t.transfers.vehicleClasses[vehicle.body]}`,
  });
}

export default async function TransferDetailPage(
  props: PageProps<"/[locale]/transfers/[slug]">,
) {
  const [{ slug }, searchParams, { t, path, locale, intlLocale, fill }] = await Promise.all([
    props.params,
    props.searchParams,
    getI18n(),
  ]);

  const query = parseTransferQuery(paramsFromSearchParams(searchParams));

  // The class read is what decides whether the page exists.
  const vehicle = await loadVehicle(slug, locale);
  if (!vehicle) notFound();
  // An id or a differently-cased slug resolves on the API; the page answers
  // with a permanent redirect to the one public address.
  redirectToCanonicalSlug(slug, vehicle.slug, path(`/transfers/${vehicle.slug}`), searchParams);

  let result: TransferQuoteResult | null = null;

  if (query.from && query.to && query.from !== query.to && query.date && query.time) {
    try {
      result = await quoteTransfers({
        from: query.from,
        to: query.to,
        date: query.date,
        time: query.time,
        tripType: query.type === "return" ? "RETURN" : "ONE_WAY",
        returnDate: query.type === "return" ? query.returnDate : undefined,
        returnTime: query.type === "return" ? query.returnTime : undefined,
        adults: query.adults,
        children: query.children,
        luggage: query.luggage,
        cabinBags: query.cabinBags,
        locale,
      });
    } catch (error) {
      // A journey we cannot run leaves the page describing the vehicle without
      // a price, which is the honest thing to show.
      if (!(error instanceof ApiError)) throw error;
    }
  }

  const offer: TransferOffer | null =
    result?.offers.find((entry) => entry.vehicle.slug === slug) ?? null;
  const quote = offer?.quote ?? null;
  const from = result?.from ?? null;
  const to = result?.to ?? null;
  const currency = quote?.currency ?? vehicle.currency;
  const passengers = Math.max(1, query.adults + query.children);

  const journeyQuery = serializeTransferQuery(query);
  const backHref = `${path("/transfers/search")}?${journeyQuery}&selected=${vehicle.slug}`;
  const continueHref = `${path("/transfers/booking")}?${journeyQuery}&offer=${vehicle.slug}`;

  const duration = quote
    ? formatDuration(quote.legs[0]?.durationMinutes ?? 0, {
        hour: t.common.hourShort,
        minute: t.common.minuteShort,
      })
    : null;

  /**
   * The heading names the journey when we know it, and the vehicle when we do
   * not — a traveller who arrived from a search wants to see their own route
   * confirmed, and one who landed here cold needs to know what the page is.
   */
  const title =
    from && to
      ? fill(t.transfers.detail.titleRoute, {
          kind:
            vehicle.kind === "PRIVATE"
              ? t.transfers.detail.kindPrivate
              : t.transfers.detail.kindShared,
          from: from.name,
          to: to.name,
        })
      : fill(t.transfers.detail.titleFallback, {
          name: vehicle.name,
          kind:
            vehicle.kind === "PRIVATE"
              ? t.transfers.detail.kindPrivateLower
              : t.transfers.detail.kindSharedLower,
        });

  const keyFacts = [
    {
      icon: MapPin,
      label: t.transfers.detail.pickUp,
      value: from?.name ?? t.transfers.detail.notSelected,
    },
    {
      icon: MapPin,
      label: t.transfers.detail.destination,
      value: to?.name ?? t.transfers.detail.notSelected,
    },
    {
      icon: Clock,
      label: t.transfers.detail.journeyTime,
      value: duration ? fill(t.common.approx, { value: duration }) : "—",
    },
    {
      icon: Route,
      label: t.transfers.detail.distance,
      value: quote ? fill(t.transfers.detail.kmByRoad, { count: quote.legs[0]?.distanceKm ?? 0 }) : "—",
    },
    {
      icon: Users,
      label: t.transfers.detail.vehicle,
      value: `${t.transfers.vehicleClasses[vehicle.body]} · ${vehicle.vehicleExample}`,
    },
    {
      icon: Users,
      label: t.transfers.detail.passengers,
      value: quote
        ? fill(t.transfers.detail.upToTravelling, {
            max: vehicle.maxPassengers,
            count: passengers,
          })
        : fill(t.transfers.detail.upTo, { max: vehicle.maxPassengers }),
    },
    {
      icon: Briefcase,
      label: t.transfers.detail.luggage,
      value: fill(t.transfers.detail.luggageValue, {
        large: vehicle.maxLuggage,
        cabin: vehicle.maxCabinBags,
      }),
    },
  ];

  /*
   * The site's trail, for the `BreadcrumbList` a crawler reads. The visible
   * breadcrumb adds one more step when the visitor came from a search — a way
   * back to their own results — which is navigation for that visitor, not a
   * level of the site, and so is left out of the markup.
   */
  const crumbs = [
    { name: t.common.home, href: path("/") },
    { name: t.nav.transfers, href: path("/transfers") },
    { name: vehicle.name },
  ];

  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema(crumbs),
          transferServiceSchema({
            name: vehicle.name,
            description: vehicle.summary,
            url: path(`/transfers/${vehicle.slug}`),
            providerName: vehicle.provider?.name ?? null,
            locale,
          }),
        ]}
      />

      <Container className="pt-8 pb-6">
        <Breadcrumbs
          items={[
            { label: t.common.home, href: path("/") },
            { label: t.nav.transfers, href: path("/transfers") },
            ...(quote ? [{ label: t.transfers.results.title, href: backHref }] : []),
            { label: vehicle.name },
          ]}
        />

        <TransferSteps current={2} className="mt-6" />

        <div className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={vehicle.kind === "PRIVATE" ? "brand" : "neutral"}>
                {vehicle.kind === "PRIVATE"
                  ? t.transfers.kinds.privateTransfer
                  : t.transfers.kinds.sharedTransfer}
              </Badge>
              <Badge tone="outline">{t.transfers.vehicleClasses[vehicle.body]}</Badge>
            </div>
            <h1 className="type-h1 mt-4 text-balance">{title}</h1>
            {vehicle.provider && (
              <div className="type-body-sm mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                <span className="font-medium text-ink">{vehicle.provider.name}</span>
                <Rating
                  value={vehicle.provider.rating}
                  reviewCount={vehicle.provider.reviewCount}
                />
                <span>·</span>
                <span>
                  {fill(t.transfers.detail.yearsOperating, {
                    count: vehicle.provider.yearsActive,
                  })}
                </span>
              </div>
            )}
          </div>

          <div className="shrink-0">
            <ShareSave
              title={vehicle.name}
              text={t.transfers.vehicleClasses[vehicle.body]}
              url={path(`/transfers/${vehicle.slug}`)}
            />
          </div>
        </div>
      </Container>

      {quote && (
        <Container className="pb-6">
          <TransferJourneyBar query={query} />
        </Container>
      )}

      <Container className="pb-28 lg:pb-32">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-12 xl:gap-16">
          <div className="min-w-0 lg:col-span-8">
            <TransferGallery vehicle={vehicle} from={from} to={to} />

            <section className="mt-12">
              <h2 className="type-h2">{t.transfers.detail.keyInformation}</h2>
              <dl className="mt-6 grid gap-x-8 sm:grid-cols-2">
                {keyFacts.map((fact) => (
                  <div
                    key={fact.label}
                    className="flex gap-3 border-b border-line py-3.5"
                  >
                    <fact.icon
                      size={16}
                      className="mt-0.5 shrink-0 text-brand-text"
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <dt className="type-caption text-muted">{fact.label}</dt>
                      <dd className="type-body-sm mt-0.5 font-medium text-ink">
                        {fact.value}
                      </dd>
                    </div>
                  </div>
                ))}
              </dl>
            </section>

            <section className="mt-14 border-t border-line pt-12">
              <h2 className="type-h2">{t.transfers.detail.about}</h2>
              <p className="type-body-lg mt-5 text-body">{vehicle.summary}</p>
              <div className="mt-5 space-y-5">
                {vehicle.description.map((paragraph) => (
                  <p key={paragraph.slice(0, 40)} className="type-body text-body">
                    {paragraph}
                  </p>
                ))}
              </div>

              <h3 className="type-h4 mt-10">{t.transfers.detail.onBoard}</h3>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {vehicle.features.map((feature) => {
                  const Icon = featureIcons[feature];
                  return (
                    <li key={feature} className="flex items-center gap-2.5">
                      <Icon size={16} className="shrink-0 text-brand-text" aria-hidden />
                      <span className="type-body-sm text-body">
                        {t.transfers.features[feature]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="mt-14 border-t border-line pt-12">
              <div className="grid gap-10 sm:grid-cols-2 sm:gap-12">
                <div>
                  <h2 className="type-h3">{t.transfers.detail.included}</h2>
                  <ul className="mt-5 space-y-3">
                    {vehicle.included.map((item) => (
                      <li key={item} className="flex gap-3">
                        <Check size={17} className="mt-0.5 shrink-0 text-success" aria-hidden />
                        <span className="type-body-sm text-body">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h2 className="type-h3">{t.transfers.detail.excluded}</h2>
                  <ul className="mt-5 space-y-3">
                    {vehicle.excluded.map((item) => (
                      <li key={item} className="flex gap-3">
                        <X size={17} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
                        <span className="type-body-sm text-muted">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section className="mt-14 border-t border-line pt-12">
              <h2 className="type-h2">{t.transfers.detail.howPickupWorks}</h2>
              <p className="type-body mt-5 text-body">{vehicle.pickupProcedure}</p>

              <div className="mt-8 flex gap-3.5 rounded-sm bg-surface-soft p-5">
                <Info size={18} className="mt-0.5 shrink-0 text-brand-text" aria-hidden />
                <div>
                  <h3 className="type-h4">{t.transfers.detail.beforeTheDay}</h3>
                  <p className="type-body-sm mt-2 text-body">
                    {t.transfers.detail.beforeTheDayBody}
                  </p>
                </div>
              </div>

              <h3 className="type-h4 mt-10">{t.transfers.detail.cancellation}</h3>
              <p className="type-body-sm mt-3 text-body">{vehicle.cancellation?.description}</p>
              <p className="type-caption mt-3 text-subtle">
                {fill(t.transfers.detail.cancellationNote, {
                  provider: vehicle.provider?.name ?? vehicle.name,
                })}
              </p>
            </section>
          </div>

          <aside className="lg:col-span-4">
            <div className="lg:sticky lg:top-36">
              {quote ? (
                <>
                  <TransferBookingSummary offer={offer!} query={query} from={from} to={to}>
                    <Button href={continueHref} size="lg" fullWidth>
                      {t.actions.continue}
                    </Button>
                    <Button href={backHref} variant="ghost" fullWidth className="mt-2">
                      {t.transfers.detail.backToResults}
                    </Button>
                  </TransferBookingSummary>
                  <p className="type-caption mt-4 text-center text-subtle">
                    {t.transfers.detail.noPaymentStep}
                  </p>
                </>
              ) : (
                <div className="border border-line bg-surface p-6 shadow-card">
                  <h2 className="type-h4">{t.transfers.detail.priceThis}</h2>
                  <p className="type-body-sm mt-3 text-muted">
                    {t.transfers.detail.priceThisBody}
                  </p>
                  <Button href={path("/transfers")} size="lg" fullWidth className="mt-6">
                    {t.transfers.detail.startSearch}
                  </Button>
                </div>
              )}
            </div>
          </aside>
        </div>
      </Container>

      {/* Mobile action bar — the same pattern as the hotel detail page. */}
      {quote && (
        <MobileBookingBar
          caption={t.common.total}
          price={formatMoney(quote.totals.totalCents, currency, intlLocale)}
          href={continueHref}
          action={t.actions.continue}
        />
      )}
    </>
  );
}
