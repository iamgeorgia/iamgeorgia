import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowRight, Clock, MapPin, Route as RouteIcon } from "lucide-react";

import { TransferSearch } from "@/components/transfers/TransferSearch";
import { TrustRow } from "@/components/transfers/TrustRow";
import { Reveal } from "@/components/motion/Reveal";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { PageHero } from "@/components/ui/PageHero";
import { ApiError } from "@/lib/api/client";
import {
  getTransferRouteCached,
  listTransferPointsCached,
  listTransferRoutesForBuild,
} from "@/lib/api/transfers";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney, toMajorUnits } from "@/lib/money";
import { JsonLd, ORGANIZATION_ID, breadcrumbSchema } from "@/lib/seo/jsonLd";
import { pageMetadata } from "@/lib/seo/metadata";
import { emptyQuery, formatDuration, serializeTransferQuery } from "@/lib/transfers/query";

/**
 * A route landing page.
 *
 * This is what the route catalogue is *for*. A search result set has nothing to
 * offer an index — it is one traveller's query — but "Tbilisi Airport to
 * Gudauri transfer" is a thing people search for, and there are a few hundred
 * such pairs. Each gets a URL, translated copy and a price.
 *
 * Nothing here reads the session: the route and the point list are public and
 * fetched without cookies, so the page is prerendered and revalidated on a
 * timer rather than rendered per request. `generateStaticParams` names Tier 1
 * and Tier 2 for the build; Tier 3 is the long tail, rendered on first visit
 * and kept. The fetches themselves are cached for the same period in
 * `lib/api/transfers.ts`, so the two figures should move together.
 */
export const revalidate = 600;
export const dynamicParams = true;

/**
 * The route, or nothing. Memoised per request so `generateMetadata` and the
 * page share one read — the fetch itself cannot be deduplicated because every
 * call carries a timeout signal.
 */
const loadRoute = cache(async (slug: string, locale: string) => {
  try {
    return await getTransferRouteCached(slug, locale);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
});

export async function generateStaticParams() {
  try {
    const { data } = await listTransferRoutesForBuild({
      tier: ["TIER_1", "TIER_2"],
      pageSize: 100,
    });

    // Only the slug: `[locale]` sits above the root layout and Next expands it
    // itself, so returning it here would ask for the same page four times over.
    return data.map((route) => ({ slug: route.slug }));
  } catch {
    // A build without the API reachable should still succeed: every page here
    // renders on demand anyway, and failing the build over a prerender list
    // would make the API a build-time dependency it does not need to be.
    return [];
  }
}

export async function generateMetadata(
  props: PageProps<"/[locale]/transfers/routes/[slug]">,
): Promise<Metadata> {
  const [{ slug }, { t, locale, fill }] = await Promise.all([props.params, getI18n()]);

  const route = await loadRoute(slug, locale);
  if (!route) return { title: t.transfers.detail.notFound, robots: { index: false, follow: true } };

  const title =
    route.title ?? fill(t.transfers.routes.metaTitle, { from: route.from.name, to: route.to.name });

  return pageMetadata({
    path: `/transfers/routes/${slug}`,
    title,
    description:
      route.summary ??
      fill(t.transfers.routes.metaDescription, {
        from: route.from.name,
        to: route.to.name,
        distance: String(route.distanceKm),
      }),
    image: route.heroImage,
    imageAlt: title,
  });
}

export default async function TransferRoutePage(
  props: PageProps<"/[locale]/transfers/routes/[slug]">,
) {
  const [{ slug }, { t, path, locale, intlLocale, fill }] = await Promise.all([
    props.params,
    getI18n(),
  ]);

  const [route, { data: points }] = await Promise.all([
    loadRoute(slug, locale),
    listTransferPointsCached({ popular: true, locale }),
  ]);
  if (!route) notFound();

  const query = {
    ...emptyQuery,
    from: route.from.slug,
    to: route.to.slug,
    adults: 2,
    luggage: 2,
  };

  const searchHref = `${path("/transfers/search")}?${serializeTransferQuery(query)}`;

  const duration = formatDuration(route.durationMinutes, {
    hour: t.common.hourShort,
    minute: t.common.minuteShort,
  });

  /* One trail, rendered twice — visible breadcrumb and `BreadcrumbList`. */
  const crumbs = [
    { name: t.common.home, href: path("/") },
    { name: t.nav.transfers, href: path("/transfers") },
    { name: `${route.from.name} → ${route.to.name}` },
  ];

  /**
   * Structured data for the journey.
   *
   * `Offer` rather than `Product`: what is being sold is a service on a date,
   * and the price is a "from" figure that depends on the vehicle. Omitted
   * entirely when the route has no curated price, because a marked-up price
   * that the search then contradicts is worse than none.
   *
   * No `availability`. This page never checks whether a car can be had on a
   * date — the search does — so the `InStock` that used to sit here was an
   * unverified claim on every route in the catalogue. Saying nothing is both
   * honest and, for a rich result, no worse.
   *
   * `provider` references the `Organization` node the site layout already
   * emits, rather than restating the brand with a different name than the one
   * `constants/site.ts` holds.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Airport and intercity transfer",
    name: route.title ?? `${route.from.name} to ${route.to.name}`,
    description: route.summary ?? undefined,
    areaServed: { "@type": "Country", name: "Georgia" },
    provider: { "@id": ORGANIZATION_ID },
    ...(route.startingFromCents !== null
      ? {
          offers: {
            "@type": "Offer",
            price: toMajorUnits(route.startingFromCents, "GEL"),
            priceCurrency: "GEL",
          },
        }
      : {}),
  };

  return (
    <>
      <JsonLd data={[breadcrumbSchema(crumbs), jsonLd]} />

      <PageHero
        eyebrow={t.transfers.routes.eyebrow}
        title={route.title ?? `${route.from.name} → ${route.to.name}`}
        description={
          route.summary ??
          fill(t.transfers.routes.metaDescription, {
            from: route.from.name,
            to: route.to.name,
            distance: String(route.distanceKm),
          })
        }
        image={route.heroImage ?? "/images/destinations/gudauri-2.jpg"}
        imageAlt={t.transfers.hero.imageAlt}
      />

      <Container className="pt-8">
        <Breadcrumbs
          items={crumbs.map((crumb) => ({ label: crumb.name, href: crumb.href }))}
        />
      </Container>

      <Container className="relative z-20 pt-8">
        <TransferSearch initialQuery={query} suggestions={points} />
      </Container>

      <Container className="pt-16 pb-20 lg:pt-20 lg:pb-24">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="min-w-0 lg:col-span-7">
            <Reveal>
              <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-3">
                <Fact
                  icon={RouteIcon}
                  label={t.transfers.detail.distance}
                  value={fill(t.transfers.detail.kmByRoad, { count: route.distanceKm })}
                />
                <Fact
                  icon={Clock}
                  label={t.transfers.detail.journeyTime}
                  value={fill(t.common.approx, { value: duration })}
                />
                <Fact
                  icon={MapPin}
                  label={t.transfers.summary.pickUp}
                  value={route.from.region}
                />
              </dl>
            </Reveal>

            {route.description.length > 0 && (
              <Reveal delay={0.05}>
                <div className="mt-10 space-y-4">
                  {route.description.map((paragraph) => (
                    <p key={paragraph} className="type-body text-body">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </Reveal>
            )}

            {route.stops.length > 0 && (
              <Reveal delay={0.1}>
                <section className="mt-12">
                  <h2 className="type-h3">{t.transfers.routes.stopsTitle}</h2>
                  <ol className="mt-5 space-y-4">
                    <StopRow name={route.from.name} region={route.from.region} index={1} />
                    {route.stops.map((stop, index) => (
                      <StopRow
                        key={stop.id}
                        name={stop.point.name}
                        region={stop.point.region}
                        index={index + 2}
                        dwellMinutes={stop.dwellMinutes}
                        dwellLabel={t.transfers.routes.stopMinutes}
                        fill={fill}
                      />
                    ))}
                    <StopRow
                      name={route.to.name}
                      region={route.to.region}
                      index={route.stops.length + 2}
                    />
                  </ol>
                </section>
              </Reveal>
            )}

            <Reveal delay={0.15}>
              <TrustRow className="mt-14" />
            </Reveal>
          </div>

          <aside className="lg:col-span-5">
            <div className="lg:sticky lg:top-36">
              <div className="border border-line bg-surface p-6 shadow-card">
                <p className="type-h4 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{route.from.name}</span>
                  <ArrowRight
                    size={16}
                    className="shrink-0 text-brand-text rtl:-scale-x-100"
                    aria-hidden
                  />
                  <span className="sr-only"> {t.a11y.to} </span>
                  <span>{route.to.name}</span>
                </p>

                {route.startingFromCents !== null && (
                  <p className="mt-5">
                    <span className="type-caption block text-muted">{t.common.from}</span>
                    <span className="type-h2 block tabular-nums">
                      {formatMoney(route.startingFromCents, "GEL", intlLocale)}
                    </span>
                    <span className="type-caption block text-muted">
                      {t.transfers.card.allTaxes}
                    </span>
                  </p>
                )}

                <Button href={searchHref} size="lg" fullWidth className="mt-6">
                  {t.transfers.routes.seePrices}
                </Button>

                <p className="type-caption mt-4 text-subtle">{t.transfers.routes.priceNote}</p>
              </div>
            </div>
          </aside>
        </div>
      </Container>
    </>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="type-caption flex items-center gap-1.5 text-muted">
        <Icon size={13} aria-hidden />
        {label}
      </dt>
      <dd className="type-h4 mt-1.5">{value}</dd>
    </div>
  );
}

function StopRow({
  name,
  region,
  index,
  dwellMinutes,
  dwellLabel,
  fill,
}: {
  name: string;
  region: string;
  index: number;
  dwellMinutes?: number;
  dwellLabel?: string;
  fill?: (template: string, values: Record<string, string | number>) => string;
}) {
  return (
    <li className="flex gap-4">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-soft text-[0.8125rem] font-semibold text-brand-text tabular-nums">
        {index}
      </span>
      <span className="min-w-0">
        <span className="type-body-sm block font-medium text-ink">{name}</span>
        <span className="type-caption block text-muted">
          {region}
          {dwellMinutes && dwellMinutes > 0 && dwellLabel && fill
            ? ` · ${fill(dwellLabel, { count: dwellMinutes })}`
            : ""}
        </span>
      </span>
    </li>
  );
}
