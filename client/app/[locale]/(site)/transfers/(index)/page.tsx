import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Briefcase, Clock, Users } from "lucide-react";

import { TransferSearch } from "@/components/transfers/TransferSearch";
import { TrustRow } from "@/components/transfers/TrustRow";
import { VehicleIllustration } from "@/components/transfers/VehicleIllustration";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { PageHero } from "@/components/ui/PageHero";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { plural } from "@/lib/i18n/plural";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  listTransferPointsCached,
  listTransferRoutesCached,
  listTransferVehicles,
} from "@/lib/api/transfers";
import { emptyQuery, formatDuration, serializeTransferQuery } from "@/lib/transfers/query";
import { formatMoney } from "@/lib/money";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();

  return pageMetadata({
    path: "/transfers",
    title: t.transfers.metaTitle,
    description: t.transfers.metaDescription,
  });
}

/**
 * The landing page reads the catalogue rather than carrying one.
 *
 * The routes shown here are whichever the operator has marked Tier 1 in the
 * panel, with the fare and journey time the panel set — so what a visitor sees
 * on the front page is what search will quote them, without a second list that
 * can drift out of step.
 *
 * The whole page is one render because all three reads are independent; running
 * them in sequence would be three round trips for one screen.
 *
 * The route and point lists are cached per call (`lib/api/transfers.ts`); the
 * vehicle list is channel-aware and read fresh. A segment-level `revalidate`
 * would do nothing here — the vehicle read forwards cookies.
 */

export default async function TransfersPage() {
  const { t, path, locale, intlLocale, fill } = await getI18n();

  const [routeList, vehicleList, pointList] = await Promise.all([
    listTransferRoutesCached({ tier: "TIER_1", locale, pageSize: 6 }),
    listTransferVehicles({ locale }),
    listTransferPointsCached({ popular: true, locale }),
  ]);

  const sampleQuery = { ...emptyQuery, adults: 2, children: 0, luggage: 2 };

  const routes = routeList.data.map((route) => {
    const query = { ...sampleQuery, from: route.from.slug, to: route.to.slug };

    return {
      id: route.id,
      fromName: route.from.name,
      toName: route.to.name,
      // The route's own summary, translated with it, rather than a note kept in
      // a parallel list that has to be edited in four files whenever a route
      // is added.
      note: route.summary ?? "",
      durationMinutes: route.durationMinutes,
      startingFromCents: route.startingFromCents,
      href: `${path("/transfers/search")}?${serializeTransferQuery(query)}`,
    };
  });

  /** Four classes across the size range, so the fleet reads as a spread. */
  const fleet = [...vehicleList.data]
    .sort((a, b) => a.maxPassengers - b.maxPassengers)
    .filter((vehicle, index, all) => all.findIndex((v) => v.body === vehicle.body) === index)
    .slice(0, 4);

  return (
    <>
      <PageHero
        eyebrow={t.transfers.hero.eyebrow}
        title={t.transfers.hero.title}
        description={t.transfers.hero.description}
        image="/images/destinations/gudauri-2.jpg"
        imageAlt={t.transfers.hero.imageAlt}
        size="tall"
      />

      {/* The search widget overlaps the hero, matching the hotels index. The
          overlap has to stay inside the hero's own bottom padding (56px, 64px
          at lg) or it crops the last line of the description. */}
      <Container className="relative z-20 -mt-10 lg:-mt-12">
        <TransferSearch suggestions={pointList.data} />
      </Container>

      <Container className="pt-16 pb-20 lg:pt-24 lg:pb-24">
        <Reveal>
          <SectionHeading
            eyebrow={t.transfers.intro.eyebrow}
            title={t.transfers.intro.title}
            description={t.transfers.intro.description}
          />
        </Reveal>
        <Reveal delay={0.1}>
          <TrustRow className="mt-12 lg:mt-14" />
        </Reveal>
      </Container>

      <section className="border-y border-line bg-surface-earth/50 py-20 lg:py-24">
        <Container>
          <Reveal>
            <SectionHeading
              eyebrow={t.transfers.routes.eyebrow}
              title={t.transfers.routes.title}
              description={t.transfers.routes.description}
            />
          </Reveal>

          <ul className="mt-12 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {routes.map((route, index) => (
              <li key={route.id}>
                <Reveal delay={Math.min(index, 3) * 0.06}>
                  <Link
                    href={route.href}
                    className="group flex h-full flex-col justify-between gap-5 border border-line bg-surface p-5 transition-[border-color,box-shadow] duration-300 ease-(--ease-out-soft) hover:border-subtle hover:shadow-card"
                  >
                    <div>
                      <p className="type-h4 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>{route.fromName}</span>
                        <ArrowRight
                          size={15}
                          className="shrink-0 text-brand-text rtl:-scale-x-100"
                          aria-hidden
                        />
                        <span className="sr-only"> {t.a11y.to} </span>
                        <span>{route.toName}</span>
                      </p>
                      <p className="type-caption mt-2 text-muted">{route.note}</p>
                    </div>

                    <div className="flex items-end justify-between gap-4 border-t border-line pt-4">
                      <p className="type-caption flex items-center gap-1.5 text-muted">
                        <Clock size={13} aria-hidden />
                        {fill(t.common.approx, {
                          value: formatDuration(route.durationMinutes, {
                            hour: t.common.hourShort,
                            minute: t.common.minuteShort,
                          }),
                        })}
                      </p>
                      {route.startingFromCents !== null && (
                        <p className="text-end">
                          <span className="type-caption block text-muted">{t.common.from}</span>
                          <span className="type-h4 tabular-nums">
                            {formatMoney(route.startingFromCents, "GEL", intlLocale)}
                          </span>
                        </p>
                      )}
                    </div>
                  </Link>
                </Reveal>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <Container className="py-20 lg:py-24">
        <Reveal>
          <SectionHeading
            eyebrow={t.transfers.fleet.eyebrow}
            title={t.transfers.fleet.title}
            description={t.transfers.fleet.description}
          />
        </Reveal>

        <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {fleet.map((vehicle, index) => (
            <li key={vehicle.id}>
              <Reveal delay={Math.min(index, 3) * 0.06}>
                <div className="flex aspect-4/3 items-center justify-center rounded-sm bg-surface-earth/70 p-6 text-ink">
                  <VehicleIllustration vehicleClass={vehicle.body} className="max-w-48" />
                </div>
                {/* The class name is the one link a crawler has into the
                    vehicle page from an indexable page — the search results
                    that otherwise lead there are kept out of the index. */}
                <h3 className="type-h4 mt-5">
                  <Link
                    href={path(`/transfers/${vehicle.slug}`)}
                    className="transition-colors hover:text-brand-text"
                  >
                    {vehicle.name}
                  </Link>
                </h3>
                <p className="type-caption mt-1 text-muted">
                  {t.transfers.vehicleClasses[vehicle.body]} · {vehicle.vehicleExample}
                </p>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  <li className="type-caption flex items-center gap-1.5 text-body">
                    <Users size={13} className="text-subtle" aria-hidden />
                    {fill(t.transfers.fleet.upTo, {
                      count: plural(locale, vehicle.maxPassengers, t.units.passenger),
                    })}
                  </li>
                  <li className="type-caption flex items-center gap-1.5 text-body">
                    <Briefcase size={13} className="text-subtle" aria-hidden />
                    {plural(locale, vehicle.maxLuggage, t.units.largeBag)}
                  </li>
                </ul>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>

      <section className="border-t border-line bg-ink py-20 text-on-dark lg:py-24">
        <Container>
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <h2 className="type-h2 text-on-dark text-balance">{t.transfers.how.title}</h2>
              <p className="type-body-lg mt-5 text-on-dark/75">{t.transfers.how.body}</p>
            </Reveal>

            <Reveal delay={0.1}>
              <ol className="space-y-8">
                {t.transfers.how.steps.map((step, index) => (
                  <li key={step.title} className="flex gap-5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-on-dark/25 text-sm font-semibold tabular-nums">
                      {index + 1}
                    </span>
                    <span>
                      <span className="type-h4 block text-on-dark">{step.title}</span>
                      <span className="type-body-sm mt-1.5 block text-on-dark/70">
                        {step.body}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>

          <p className="type-caption mt-16 border-t border-on-dark/15 pt-6 text-on-dark/50">
            {t.transfers.how.disclaimer}
          </p>
        </Container>
      </section>
    </>
  );
}
