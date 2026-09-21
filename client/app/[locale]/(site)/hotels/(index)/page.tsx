import type { Metadata } from "next";
import { CalendarSearch } from "lucide-react";

import { StayResultCard } from "@/components/booking/StayResultCard";
import { StaySearchForm } from "@/components/booking/StaySearchForm";
import { HotelExplorer } from "@/components/hotels/HotelExplorer";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHero } from "@/components/ui/PageHero";
import { listPublicHotels, getPublicDestinationsCached, searchHotels } from "@/lib/api/search";
import { stayWindowIssue } from "@/lib/booking/errors";
import { adaptHotelSummary } from "@/lib/site/hotelAdapter";
import { nightsBetween, stayFromParams, stayToParams } from "@/lib/booking/stay";
import { formatStayDate } from "@/lib/booking/stay";
import { plural } from "@/lib/i18n/plural";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo/metadata";

/**
 * One indexable address for the catalogue, and only one.
 *
 * The dated form and the client-side filters both write to the query string,
 * and every combination of dates, party, destination and amenity is a distinct
 * URL over near-identical content — the facet explosion that buries a booking
 * site. A dated URL is a private search result and says `noindex, follow`; an
 * undated one is the catalogue and canonicalises to itself. Either way there is
 * exactly one `/hotels` in the index.
 */
export async function generateMetadata(
  props: PageProps<"/[locale]/hotels">,
): Promise<Metadata> {
  const [searchParams, { t }] = await Promise.all([props.searchParams, getI18n()]);

  return pageMetadata({
    path: "/hotels",
    title: t.hotels.metaTitle,
    description: t.hotels.metaDescription,
    index: Object.keys(searchParams).length === 0,
  });
}

/**
 * Two pages behind one route, and the difference is dates.
 *
 * Without them this browses the catalogue: what exists, at indicative prices,
 * filtered client-side. With them it becomes a real search — `/api/search`
 * returns only properties that can actually be sold for those exact dates and
 * that exact party, and every price on the page is a total somebody could be
 * charged. Conflating the two is how a site advertises rooms it cannot sell,
 * so the URL decides which one the visitor is looking at.
 *
 * Either way the API decides the channel from the session cookie: an anonymous
 * visitor sees B2C properties at the platform markup, a signed-in partner sees
 * the whole ACTIVE catalogue at their own rates.
 */
export default async function HotelsPage(props: PageProps<"/[locale]/hotels">) {
  const searchParams = await props.searchParams;
  const { t, locale, intlLocale, fill, path } = await getI18n();

  const stay = stayFromParams(searchParams);
  const requested = searchParams.destinationSlug;
  const destinationSlug = Array.isArray(requested) ? requested[0] : requested;

  /*
   * Both calls leave together.
   *
   * The destination list feeds the search form in the hero and is needed on
   * every path; the second call feeds the body and differs by branch. Awaited
   * one after the other they put two full API round-trips in front of the
   * first byte of the page — and the hero image is the LCP element, so that
   * latency lands squarely on it.
   *
   * The dated search is allowed to refuse a stay outright — a check-in already
   * past, a date beyond the booking horizon, a stay over the night cap. Those
   * are answers rather than failures, so the refusal is folded into the
   * resolved value here instead of rejecting the pair and taking the
   * destination list down with it.
   */
  const [{ data: destinationTree }, search, catalogue] = await Promise.all([
    getPublicDestinationsCached(),
    stay
      ? searchHotels({ ...stayToParams(stay), destinationSlug, locale, pageSize: 24 }).then(
          (page) => ({ page, issue: null }),
          (error: unknown) => {
            const issue = stayWindowIssue(error);
            if (!issue) throw error;
            return { page: null, issue };
          },
        )
      : null,
    stay ? null : listPublicHotels({ destinationSlug, pageSize: 50 }),
  ]);

  const flatDestinations = destinationTree.flatMap((root) => [root, ...root.children]);

  const hero = (
    <>
      <PageHero
        eyebrow={t.nav.hotels}
        title={t.hotels.heroTitle}
        description={t.hotels.heroDescription}
        image="/images/hotels/property-1.jpg"
        imageAlt={t.hotels.heroImageAlt}
      />
      <Container className="relative z-20 -mt-10 lg:-mt-14">
        <StaySearchForm
          value={stay}
          action="/hotels"
          destinations={flatDestinations.map((node) => ({ slug: node.slug, name: node.name }))}
          destinationSlug={destinationSlug}
        />
        {!stay && (
          <p className="type-caption mt-3 flex items-center gap-2 text-muted">
            <CalendarSearch size={14} className="shrink-0 text-brand-text" aria-hidden />
            {t.booking.search.datesRequired}
          </p>
        )}
      </Container>
    </>
  );

  // --- dated search -------------------------------------------------------
  if (stay) {
    /*
     * Each refusal wants different advice: "try a nearer date" is useless for
     * a stay that is merely full, and "shift it by a night" is useless for one
     * we do not sell that far out.
     */
    const { page, issue } = search!;

    if (issue) {
      return (
        <>
          {hero}
          <Container className="pt-12 pb-24 lg:pt-16 lg:pb-32">
            <EmptyState
              iconName="calendarSearch"
              title={t.booking.window.title}
              description={fill(t.booking.window[issue.key], { limit: issue.limit })}
              action={{ label: t.booking.results.browseCatalogue, href: path("/hotels") }}
            />
          </Container>
        </>
      );
    }

    const { data: results, total } = page;

    const nights = nightsBetween(stay.checkIn, stay.checkOut);
    const party = [
      plural(locale, stay.adults, t.units.adult),
      (stay.childAges?.length ?? 0) > 0
        ? plural(locale, stay.childAges!.length, t.units.child)
        : null,
      plural(locale, stay.rooms ?? 1, t.units.room),
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <>
        {hero}

        <Container className="pt-12 pb-24 lg:pt-16 lg:pb-32">
          <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-5">
            <h2 className="type-h3">
              {fill(t.booking.results.heading, {
                count: plural(locale, total, t.units.property),
              })}
            </h2>
            <p className="type-body-sm text-muted">
              {fill(t.booking.results.subheading, {
                stay: `${formatStayDate(stay.checkIn, intlLocale)} – ${formatStayDate(stay.checkOut, intlLocale)} · ${plural(locale, nights, t.units.night)}`,
                party,
              })}
            </p>
          </div>

          {results.length > 0 ? (
            <div className="mt-6 flex flex-col gap-5">
              {results.map((result) => (
                <StayResultCard
                  key={result.id}
                  result={result}
                  stay={stay}
                  nights={nights}
                />
              ))}
            </div>
          ) : (
            <div className="mt-6">
              <EmptyState
                iconName="calendarSearch"
                title={t.booking.results.emptyTitle}
                description={t.booking.results.emptyBody}
                action={{ label: t.booking.results.browseCatalogue, href: path("/hotels") }}
              />
            </div>
          )}
        </Container>
      </>
    );
  }

  // --- catalogue ----------------------------------------------------------
  const hotels = catalogue!.data.map(adaptHotelSummary);

  return (
    <>
      {hero}
      <HotelExplorer hotels={hotels} />
    </>
  );
}
