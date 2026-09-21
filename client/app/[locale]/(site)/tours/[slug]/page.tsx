import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { Check, Clock, Gauge, MapPin, Minus, Users } from "lucide-react";

import { MobileBookingBar } from "@/components/booking/MobileBookingBar";
import { CompleteYourTrip } from "@/components/packages/CompleteYourTrip";
import { RelatedTours } from "@/components/tours/RelatedTours";
import { TourDepartures } from "@/components/tours/TourDepartures";
import { TourPanel } from "@/components/tours/TourPanel";
import { TourSearchForm } from "@/components/tours/TourSearchForm";
import { Accordion } from "@/components/ui/Accordion";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { MediaGallery } from "@/components/ui/MediaGallery";
import { Rating } from "@/components/ui/Rating";
import { ShareSave } from "@/components/ui/ShareSave";
import { ApiError } from "@/lib/api/client";
import { getPublicTour, getTourAvailability } from "@/lib/api/tours";
import { formatStayDate } from "@/lib/booking/stay";
import { plural } from "@/lib/i18n/plural";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney, roundToWholeUnits } from "@/lib/money";
import { JsonLd, breadcrumbSchema, tourSchema } from "@/lib/seo/jsonLd";
import { notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { redirectToCanonicalSlug } from "@/lib/seo/slug";
import { socialImage } from "@/lib/seo/social";
import { cheapestTourOffer, tourStayFromParams, tourWindowFor, type TourStay } from "@/lib/tours/query";
import type { GalleryImage } from "@/types/common";
import type { Tour, TourAvailability, TourCategory } from "@/types/tour";

/**
 * Landscape-led tours carry the green accent instead of the brand orange, so
 * the category chip reads as terrain rather than as a promotion.
 */
const NATURE_CATEGORIES = new Set<TourCategory>(["nature", "adventure"]);

/**
 * Live from the API, which decides the channel: a trade-only tour is a 404 on
 * this page for an anonymous visitor and a normal page for a signed-in
 * partner. No static params — the catalogue changes under this route, and a
 * prerendered shell would bake a gated tour's content into the HTML before
 * the gate ever ran.
 */
const loadTour = cache(async (slug: string, locale: string): Promise<Tour | null> => {
  try {
    return await getPublicTour(slug, { locale });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
});

/**
 * Every departure in the two weeks from the chosen date, priced for the party.
 *
 * A window the server refuses (a date far in the past, say) is an empty
 * answer rather than an error: the page still renders the tour and the
 * picker, and the panel says nothing runs.
 */
const loadAvailability = async (
  slug: string,
  stay: TourStay,
  locale: string,
): Promise<TourAvailability | null> => {
  try {
    return await getTourAvailability(slug, {
      ...tourWindowFor(stay),
      adults: stay.adults,
      childAges: stay.childAges,
      locale,
    });
  } catch (error) {
    if (error instanceof ApiError && [400, 404, 409].includes(error.status)) return null;
    throw error;
  }
};

/** The gallery: the editorial frames, or the uploaded images once there are any. */
const galleryOf = (tour: Tour): GalleryImage[] =>
  tour.images.length > 0
    ? tour.images.map((image) => ({ src: image.url, alt: image.altText ?? tour.title }))
    : tour.gallery;

export async function generateMetadata(props: PageProps<"/[locale]/tours/[slug]">): Promise<Metadata> {
  const [{ slug }, { t, locale }] = await Promise.all([props.params, getI18n()]);
  const tour = await loadTour(slug, locale);
  if (!tour) return notFoundMetadata(t.tours.notFound);

  /*
   * The canonical is the clean journey URL: the dated variants a visitor
   * arrives with — `?date=…&adults=2` — consolidate onto one address instead of
   * splitting the page across a calendar.
   *
   * The card image is the uploaded cover, then the first uploaded photograph,
   * then the editorial frame, in a format every link-preview crawler reads.
   */
  return pageMetadata({
    path: `/tours/${tour.slug}`,
    title: tour.title,
    description: tour.summary,
    image: socialImage([tour.coverImage, tour.images[0], tour.image, tour.gallery[0]?.src]),
    imageAlt: `${tour.title}, ${tour.location}`,
  });
}

export default async function TourDetailPage(props: PageProps<"/[locale]/tours/[slug]">) {
  const [{ slug }, searchParams, { t, path, locale, intlLocale, fill }] = await Promise.all([
    props.params,
    props.searchParams,
    getI18n(),
  ]);

  // The date the visitor arrived with, if any. Everything bookable on this
  // page hangs off it; without it the page is a brochure, and says so.
  const stay = tourStayFromParams(searchParams);
  const [tour, availability] = await Promise.all([
    loadTour(slug, locale),
    stay ? loadAvailability(slug, stay, locale) : null,
  ]);
  if (!tour) notFound();
  // An id or a differently-cased slug resolves on the API; the page answers
  // with a permanent redirect to the one public address.
  redirectToCanonicalSlug(slug, tour.slug, path(`/tours/${tour.slug}`), searchParams);

  const cheapest = cheapestTourOffer(availability);
  const hasDepartures = (availability?.options ?? []).some((entry) => entry.dates.length > 0);
  const window = stay ? tourWindowFor(stay) : null;
  const party = stay
    ? [
        plural(locale, stay.adults, t.units.adult),
        stay.childAges.length > 0 ? plural(locale, stay.childAges.length, t.units.child) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const facts = [
    { icon: Clock, label: t.tours.duration, value: tour.durationLabel },
    { icon: Users, label: t.tours.groupSize, value: tour.groupSize },
    { icon: Gauge, label: t.tours.difficulty, value: t.tours.difficulties[tour.difficulty] },
    { icon: MapPin, label: t.tours.region, value: tour.location },
  ];

  /* One trail, rendered twice — as the visible breadcrumb and as the
     `BreadcrumbList` a crawler reads, so the two cannot drift apart. */
  const crumbs = [
    { name: t.common.home, href: path("/") },
    { name: t.nav.tours, href: path("/tours") },
    { name: tour.title },
  ];

  /*
   * The price the page shows, from the same integer cents it formats.
   *
   * With a date that is the cheapest live quote and the departure is known to
   * be sellable; without one it is the indicative "from" figure and nothing is
   * claimed about availability, because an undated page has not asked.
   */
  const offer = cheapest
    ? {
        priceCents: cheapest.quote.totals.totalCents,
        currency: cheapest.quote.currency,
        url: path(`/tours/${tour.slug}`),
        available: true,
      }
    : tour.priceFrom
      ? {
          // Rounded to whole lari, because that is how the panel prints it.
          priceCents: roundToWholeUnits(tour.priceFrom.amountCents, tour.priceFrom.currency),
          currency: tour.priceFrom.currency,
          url: path(`/tours/${tour.slug}`),
          ...(stay ? { available: hasDepartures } : {}),
        }
      : null;

  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema(crumbs),
          tourSchema({
            name: tour.title,
            description: tour.summary,
            url: path(`/tours/${tour.slug}`),
            images: galleryOf(tour)
              .slice(0, 6)
              .map((image) => image.src),
            location: tour.location,
            durationDays: tour.durationDays,
            // The day-by-day the page renders, and no more.
            itinerary: tour.itinerary.map((day) => ({
              name: day.title,
              description: day.description,
            })),
            // The five-star figure beside the title, only when reviews exist.
            rating:
              tour.reviewCount > 0
                ? { value: tour.rating, count: tour.reviewCount, best: 5 }
                : null,
            offer,
            locale,
          }),
        ]}
      />

      <Container className="pt-8 pb-6">
        <Breadcrumbs
          items={crumbs.map((crumb) => ({ label: crumb.name, href: crumb.href }))}
        />

        <div className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={NATURE_CATEGORIES.has(tour.category) ? "nature" : "brand"}>
                {t.tours.categories[tour.category]}
              </Badge>
              <Rating value={tour.rating} reviewCount={tour.reviewCount} size="md" />
            </div>
            <h1 className="type-h1 mt-4 max-w-3xl text-balance">{tour.title}</h1>
            <p className="type-body mt-3 flex items-center gap-2 text-muted">
              <MapPin size={15} className="shrink-0" aria-hidden />
              {tour.location}
            </p>
          </div>

          <ShareSave
            title={tour.title}
            text={tour.location}
            url={path(`/tours/${tour.slug}`)}
            className="shrink-0"
          />
        </div>
      </Container>

      <Container>
        <MediaGallery images={galleryOf(tour)} label={tour.title} priority />
      </Container>

      {/* The control the whole page hangs off: on a tour page the first
          question is "when does it run, and what does it cost us". */}
      <Container className="pt-8">
        <div id="tour-search" className="scroll-mt-36">
          <TourSearchForm value={stay} action={`/tours/${tour.slug}`} minAge={tour.minAge} />
        </div>
      </Container>

      <Container className="pt-14 pb-24 lg:pt-16 lg:pb-32">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="min-w-0 lg:col-span-7 xl:col-span-8">
            <dl className="grid grid-cols-2 gap-6 border-y border-line py-7 sm:grid-cols-4">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="type-caption flex items-center gap-1.5 text-muted">
                    <fact.icon size={14} aria-hidden />
                    {fact.label}
                  </dt>
                  <dd className="type-h4 mt-2">{fact.value}</dd>
                </div>
              ))}
            </dl>

            <section className="pt-12">
              <h2 className="type-h2">{t.tours.about}</h2>
              <div className="mt-6 space-y-5">
                {tour.description.map((paragraph) => (
                  <p key={paragraph.slice(0, 40)} className="type-body-lg text-body">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>

            {tour.highlights.length > 0 && (
              <section className="pt-14">
                <h2 className="type-h3">{t.tours.highlights}</h2>
                <ul className="mt-6 grid gap-3.5 sm:grid-cols-2">
                  {tour.highlights.map((highlight) => (
                    <li key={highlight} className="flex gap-3">
                      <Check size={17} className="mt-0.5 shrink-0 text-brand-text" aria-hidden />
                      <span className="type-body-sm text-body">{highlight}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* --- the bookable part ------------------------------------- */}
            <section id="departures" className="scroll-mt-36 pt-14">
              <h2 className="type-h2">{t.tours.availability.heading}</h2>

              {stay && window ? (
                <>
                  <p className="type-body mt-3 text-muted">
                    {fill(t.tours.availability.windowFor, {
                      from: formatStayDate(window.from, intlLocale),
                      to: formatStayDate(window.to, intlLocale),
                      party,
                    })}
                  </p>

                  <div className="mt-8">
                    {availability && hasDepartures ? (
                      <TourDepartures
                        tour={{
                          slug: tour.slug,
                          title: tour.title,
                          durationLabel: tour.durationLabel,
                          durationDays: tour.durationDays,
                        }}
                        stay={stay}
                        availability={availability}
                      />
                    ) : (
                      <EmptyState
                        iconName="calendarSearch"
                        title={t.tours.availability.emptyTitle}
                        description={t.tours.availability.emptyBody}
                        action={{ label: t.tours.results.browseCatalogue, href: path("/tours") }}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="mt-8">
                  <EmptyState
                    iconName="calendarSearch"
                    title={t.tours.availability.noDatesTitle}
                    description={t.tours.availability.noDatesBody}
                  />
                </div>
              )}
            </section>

            {tour.itinerary.length > 0 && (
              <section className="pt-14">
                <h2 className="type-h3">{t.tours.itinerary}</h2>
                <Accordion
                  className="mt-6"
                  items={tour.itinerary.map((day) => ({
                    id: `day-${day.day}`,
                    meta:
                      tour.durationDays > 1
                        ? fill(t.tours.day, { n: day.day })
                        : t.tours.itineraryLabel,
                    title: day.title,
                    content: (
                      <div className="space-y-4">
                        <p className="type-body text-body">{day.description}</p>
                        <dl className="flex flex-wrap gap-x-10 gap-y-2">
                          {day.meals.length > 0 && (
                            <div>
                              <dt className="type-caption text-muted">{t.tours.mealsIncluded}</dt>
                              <dd className="type-body-sm mt-0.5">
                                {day.meals.map((meal) => t.tours.mealNames[meal]).join(", ")}
                              </dd>
                            </div>
                          )}
                          {day.accommodation && day.accommodation !== "—" && (
                            <div>
                              <dt className="type-caption text-muted">{t.tours.overnight}</dt>
                              <dd className="type-body-sm mt-0.5">{day.accommodation}</dd>
                            </div>
                          )}
                        </dl>
                      </div>
                    ),
                  }))}
                />
              </section>
            )}

            {(tour.included.length > 0 || tour.excluded.length > 0) && (
              <section className="grid gap-10 pt-14 sm:grid-cols-2">
                <div>
                  <h2 className="type-h3">{t.tours.included}</h2>
                  <ul className="mt-5 space-y-3">
                    {tour.included.map((item) => (
                      <li key={item} className="flex gap-3">
                        <Check size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
                        <span className="type-body-sm text-body">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h2 className="type-h3">{t.tours.excluded}</h2>
                  <ul className="mt-5 space-y-3">
                    {tour.excluded.map((item) => (
                      <li key={item} className="flex gap-3">
                        <Minus size={16} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
                        <span className="type-body-sm text-muted">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            <section className="mt-14 border-t border-line pt-10">
              <h2 className="type-h3">{t.tours.meetingPoint}</h2>
              <p className="type-body mt-4 text-body">{tour.meetingPoint}</p>
              {tour.meetingTime && (
                <p className="type-body-sm mt-2 text-muted">
                  {fill(t.tours.manage.meetingTime, { time: tour.meetingTime })}
                </p>
              )}
            </section>

            {tour.importantInfo.length > 0 && (
              <section className="mt-12 rounded-sm bg-surface-soft/70 p-7 lg:p-8">
                <h2 className="type-h3">{t.tours.importantInfo}</h2>
                <ul className="mt-5 space-y-3">
                  {tour.importantInfo.map((item) => (
                    <li key={item} className="type-body-sm flex gap-3 text-body">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-brand" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="lg:col-span-5 xl:col-span-4">
            <div className="lg:sticky lg:top-36">
              <TourPanel tour={tour} stay={stay} cheapest={cheapest} />
            </div>
          </aside>
        </div>
      </Container>

      {/* Mobile booking bar — the pattern travellers expect on a phone. */}
      <MobileBookingBar
        caption={t.common.from}
        price={
          cheapest
            ? formatMoney(cheapest.quote.totals.totalCents, cheapest.quote.currency, intlLocale)
            : tour.priceFrom
              ? formatMoney(tour.priceFrom.amountCents, tour.priceFrom.currency, intlLocale, {
                  maximumFractionDigits: 0,
                })
              : "—"
        }
        note={!cheapest && tour.priceFrom ? t.tours.perPerson : undefined}
        href={stay ? "#departures" : "#tour-search"}
        action={stay ? t.tours.results.viewDepartures : t.tours.availability.noDatesTitle}
      />

      {/* Both rails depend on a second API call and stream in rather than
          holding the journey behind them. The cross-sell needs a real date to
          price against, so it appears only once the visitor has chosen one. */}
      {stay && (
        <Suspense fallback={null}>
          <CompleteYourTrip
            tour={tour.slug}
            checkIn={stay.date}
            adults={stay.adults}
            childAges={stay.childAges}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <RelatedTours
          destinationSlug={tour.destination?.slug}
          category={tour.category}
          excludeSlug={tour.slug}
        />
      </Suspense>
    </>
  );
}
