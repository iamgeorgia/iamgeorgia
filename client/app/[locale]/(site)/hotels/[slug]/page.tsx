import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { Check, MapPin, Navigation } from "lucide-react";

import { MobileBookingBar } from "@/components/booking/MobileBookingBar";
import { RoomOffers } from "@/components/booking/RoomOffers";
import { StayPanel } from "@/components/booking/StayPanel";
import { StaySearchForm } from "@/components/booking/StaySearchForm";
import { HotelAmenities } from "@/components/hotels/HotelAmenities";
import { HotelLanguages } from "@/components/hotels/HotelLanguages";
import { HotelPolicies } from "@/components/hotels/HotelPolicies";
import { HotelReviews } from "@/components/hotels/HotelReviews";
import { HotelSectionNav } from "@/components/hotels/HotelSectionNav";
import { KosherPanel } from "@/components/hotels/KosherPanel";
import { RelatedHotels } from "@/components/hotels/RelatedHotels";
import { CompleteYourTrip } from "@/components/packages/CompleteYourTrip";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { MediaGallery } from "@/components/ui/MediaGallery";
import { ScoreBadge, Stars } from "@/components/ui/Rating";
import { ShareSave } from "@/components/ui/ShareSave";
import { ApiError } from "@/lib/api/client";
import { getHotelAvailability, getPublicHotel } from "@/lib/api/search";
import { can } from "@/types/auth";
import {
  formatStayDate,
  nightsBetween,
  stayFromParams,
  stayToParams,
} from "@/lib/booking/stay";
import { getSession } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/plural";
import { JsonLd, breadcrumbSchema, hotelSchema } from "@/lib/seo/jsonLd";
import { notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { redirectToCanonicalSlug } from "@/lib/seo/slug";
import { socialImage } from "@/lib/seo/social";
import { formatMoney } from "@/lib/money";
import { formatPrice } from "@/lib/utils";
import { adaptHotelDetail } from "@/lib/site/hotelAdapter";
import { facilityViews } from "@/lib/hotels/facilities";
import { staffLanguages } from "@/lib/hotels/languages";
import { stayWindowIssue, type StayWindowIssue } from "@/lib/booking/errors";
import type { HotelAvailability, Offer, StayQuery } from "@/types/booking";

/**
 * Live from the API, which decides the channel: a B2B-only property is a 404
 * on this page for an anonymous visitor and a normal page for a signed-in
 * partner. No static params — the catalogue changes under this route.
 *
 * In the page's locale, as the availability call and the catalogue already
 * ask: the server merges its translations — prose and amenity names — over
 * the English record and falls back to English field by field.
 */
const loadHotel = cache(async (slug: string, locale: string) => {
  try {
    return await getPublicHotel(slug, { locale });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
});

/**
 * What can be sold here, on these dates, to this party.
 *
 * Three outcomes, and the page says something different for each. A property
 * that has simply sold out is an empty answer rather than an error — a normal
 * state on a busy weekend. A stay the platform refuses outright (past, beyond
 * the booking horizon, over the night cap) is a `refused` answer, because
 * "try a different date" is the wrong advice there. Anything else is a real
 * failure and is left to the error boundary.
 */
type AvailabilityResult =
  | { kind: "available"; availability: HotelAvailability }
  | { kind: "empty" }
  | { kind: "refused"; issue: NonNullable<StayWindowIssue> };

const loadAvailability = async (
  slug: string,
  stay: StayQuery,
  locale: string,
): Promise<AvailabilityResult> => {
  try {
    return {
      kind: "available",
      availability: await getHotelAvailability(slug, { ...stayToParams(stay), locale }),
    };
  } catch (error) {
    const issue = stayWindowIssue(error);
    if (issue) return { kind: "refused", issue };

    if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
      return { kind: "empty" };
    }
    throw error;
  }
};

/** The cheapest thing anyone could actually book, for the sidebar. */
const cheapestOffer = (availability: HotelAvailability | null): Offer | null =>
  availability?.roomTypes
    .flatMap((roomType) => roomType.offers)
    .reduce<Offer | null>(
      (best, offer) =>
        best === null || offer.quote.totals.totalCents < best.quote.totals.totalCents ? offer : best,
      null,
    ) ?? null;

export async function generateMetadata(props: PageProps<"/[locale]/hotels/[slug]">): Promise<Metadata> {
  const [{ slug }, { t, locale }] = await Promise.all([props.params, getI18n()]);
  const api = await loadHotel(slug, locale);
  if (!api) return notFoundMetadata(t.hotels.notFound);

  const hotel = adaptHotelDetail(api);

  /*
   * The canonical is the clean property URL, so the dated variants a visitor
   * arrives with — `?checkIn=…&adults=2` — all consolidate onto one address
   * rather than splitting the page's authority across a date range.
   *
   * The card image is the cover, then the first gallery photograph, in a
   * format every link-preview crawler can read; the brand card only when the
   * property has no photograph at all.
   */
  return pageMetadata({
    path: `/hotels/${hotel.slug}`,
    title: hotel.name,
    description: hotel.summary,
    image: socialImage([api.coverImage, api.images[0], hotel.image]),
    imageAlt: `${hotel.name}, ${hotel.location}`,
  });
}

export default async function HotelDetailPage(props: PageProps<"/[locale]/hotels/[slug]">) {
  const { slug } = await props.params;
  const searchParams = await props.searchParams;
  const { t, locale, intlLocale, fill, path } = await getI18n();

  // The dates the visitor arrived with, if any. Everything bookable on this
  // page hangs off them; without them the page is a brochure, and says so.
  // Availability depends only on the slug and the stay, not on the hotel
  // response, so the two requests run in parallel; a missing property answers
  // "empty" on the availability side and 404s here regardless.
  const stay = stayFromParams(searchParams);
  // `getSession` is React-cached, so the layout and this page share one call.
  // It decides one thing here: whether a certificate scan is offered at all.
  // The certification *facts* are shown to everyone, because they are what the
  // traveller is deciding on.
  const [api, result, session] = await Promise.all([
    loadHotel(slug, locale),
    stay ? loadAvailability(slug, stay, locale) : null,
    getSession(),
  ]);
  if (!api) notFound();
  // An id or a differently-cased slug resolves on the API; the page answers
  // with a permanent redirect to the one public address.
  redirectToCanonicalSlug(slug, api.slug, path(`/hotels/${api.slug}`), searchParams);

  // The server's rule (`isTrade`): the booking desks, or an approved partner.
  // A driver, a dispatcher or a partner still under review is not trade.
  const isTrade = can(session, "bookings.read") || session?.partner?.status === "APPROVED";

  /**
   * What an agency may ask this property for at checkout.
   *
   * Its own kosher facilities, plus a kosher meal — which the server accepts
   * for any property that offers kosher services at all, because one that
   * serves kosher food can be asked for a kosher meal whether or not anybody
   * remembered to tick the box.
   *
   * Empty for a property with no kosher profile, so the picker never appears.
   */
  const requestableCodes = api.kosher?.offersKosher
    ? [...new Set([...(api.kosher.features ?? []), "kosherMealOnRequest"])]
    : [];

  const hotel = adaptHotelDetail(api);

  /*
   * Every facility the API sent, labelled once for the grid and the JSON-LD
   * alike, so the two cannot describe different properties.
   *
   * The grid leaves out what the kosher panel below already lists — the same
   * facility twice on one page reads as two — but only when that panel is
   * actually drawn; otherwise those rows belong here. The structured data
   * keeps them: they are on the page either way.
   */
  const allFacilities = facilityViews(t, hotel.facilities ?? []);
  const kosherPanelCodes = new Set(api.kosher?.offersKosher ? (api.kosher.features ?? []) : []);
  const facilities = allFacilities.filter((facility) => !kosherPanelCodes.has(facility.code));
  const languages = staffLanguages(hotel.languages, intlLocale);
  const destination = api.destination
    ? { slug: api.destination.slug, name: api.destination.name }
    : null;
  const availability = result?.kind === "available" ? result.availability : null;
  const refused = result?.kind === "refused" ? result.issue : null;
  const bookableRooms = availability?.roomTypes.filter((room) => room.offers.length > 0) ?? [];
  const cheapest = cheapestOffer(availability);
  const nights = stay ? nightsBetween(stay.checkIn, stay.checkOut) : 0;
  const stayRange = stay
    ? `${formatStayDate(stay.checkIn, intlLocale)} – ${formatStayDate(stay.checkOut, intlLocale)} · ${plural(locale, nights, t.units.night)}`
    : "";

  /*
   * One trail, rendered twice: as the visible breadcrumb and as the
   * `BreadcrumbList` a crawler reads. Building both from the same array is what
   * keeps the markup from describing a navigation the page does not have.
   *
   * The destination is deliberately unlinked. `/destinations/:slug` was retired
   * and answers 404, and a breadcrumb into a 404 is a dead internal link on
   * every property page.
   */
  const crumbs = [
    { name: t.common.home, href: path("/") },
    { name: t.nav.hotels, href: path("/hotels") },
    ...(destination ? [{ name: destination.name }] : []),
    { name: hotel.name },
  ];

  /*
   * What the page is actually selling, at the price the page actually shows.
   *
   * Dated, that is the cheapest live quote in its own currency. Undated, it is
   * the indicative "from" figure — and it is passed in the whole lari units
   * `formatPrice` renders rather than the API's exact cents, because a marked-up
   * ₾189.50 beside a visible ₾190 is precisely the discrepancy that costs a
   * rich result.
   *
   * `available` is only asserted when the page ran a dated check: an undated
   * brochure page has no idea whether a room is free, and saying `InStock`
   * anyway is a claim nobody verified.
   */
  const offer = cheapest
    ? {
        priceCents: cheapest.quote.totals.totalCents,
        currency: cheapest.quote.currency,
        url: path(`/hotels/${hotel.slug}`),
        available: true,
      }
    : hotel.priceFrom > 0
      ? {
          priceCents: hotel.priceFrom * 100,
          currency: "GEL",
          url: path(`/hotels/${hotel.slug}`),
          ...(stay ? { available: bookableRooms.length > 0 } : {}),
        }
      : null;

  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema(crumbs),
          hotelSchema({
            name: hotel.name,
            description: hotel.summary,
            url: path(`/hotels/${hotel.slug}`),
            images: hotel.gallery.slice(0, 6).map((image) => image.src),
            starRating: hotel.starRating,
            address: hotel.address || null,
            locality: destination?.name ?? null,
            latitude: api.latitude,
            longitude: api.longitude,
            telephone: api.phone,
            amenities: [...new Set(allFacilities.map((facility) => facility.label))],
            checkIn: api.checkIn.from,
            checkOut: api.checkOut.until,
            // The ten-point guest score the badge shows, and only when there
            // are reviews behind it — an invented rating is a manual action.
            rating:
              hotel.reviewCount > 0
                ? { value: hotel.guestScore, count: hotel.reviewCount, best: 10 }
                : null,
            // The rows the page renders, with the API's ISO dates rather than
            // the "March 2024" the component displays.
            // Capped: every review is already in the markup, and the JSON-LD
            // would otherwise double the HTML for a well-reviewed property.
            reviews: (api.reviews ?? []).slice(0, 10).map((review) => ({
              author: review.author,
              datePublished: review.date,
              score: review.score,
              title: review.title,
              body: review.body,
            })),
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
              <Badge tone="outline">{hotel.propertyType}</Badge>
              <Stars count={hotel.starRating} />
            </div>
            <h1 className="type-h1 mt-4 text-balance">{hotel.name}</h1>
            <p className="type-body-sm mt-3 flex items-center gap-2 text-muted">
              <MapPin size={15} className="shrink-0" aria-hidden />
              {hotel.address}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-6">
            <ScoreBadge score={hotel.guestScore} reviewCount={hotel.reviewCount} />
            <ShareSave
              title={hotel.name}
              text={hotel.location}
              url={path(`/hotels/${hotel.slug}`)}
            />
          </div>
        </div>
      </Container>

      <Container>
        <MediaGallery images={hotel.gallery} label={hotel.name} preload />
      </Container>

      {/* The control the whole page hangs off. It sits above the fold of the
          content, not buried in the sidebar, because on a property page the
          first question is "can I have it on my dates". */}
      <Container className="pt-8">
        <div id="stay-search" className="scroll-mt-36">
          <StaySearchForm value={stay} action={`/hotels/${hotel.slug}`} />
        </div>
      </Container>

      {/* The section nav shares a container with the sections it points at:
          `sticky` can only travel within its parent, and in a container of its
          own it had nowhere to go and scrolled away with the page. */}
      <Container className="pt-8 pb-28 lg:pb-32">
        <HotelSectionNav
          hasKosher={Boolean(api.kosher?.offersKosher)}
          hasAmenities={facilities.length > 0 || languages.length > 0}
        />

        <div className="mt-12 grid gap-12 lg:grid-cols-12 lg:gap-12 xl:gap-16">
          <div className="min-w-0 lg:col-span-8">
            <section id="overview" className="scroll-mt-36">
              <h2 className="type-h2">{t.hotels.about}</h2>
              <p className="type-body-lg mt-5 text-body">{hotel.summary}</p>
              <div className="mt-5 space-y-5">
                {hotel.description.map((paragraph) => (
                  <p key={paragraph.slice(0, 40)} className="type-body text-body">
                    {paragraph}
                  </p>
                ))}
              </div>

              <ul className="mt-8 grid gap-3.5 sm:grid-cols-2">
                {hotel.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-3">
                    <Check size={17} className="mt-0.5 shrink-0 text-brand-text" aria-hidden />
                    <span className="type-body-sm text-body">{highlight}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/*
             * Facilities, then the languages the staff speak — each drawn only
             * when it has something in it. Languages alone do not earn the
             * Facilities heading: they stand as their own block instead.
             */}
            {(facilities.length > 0 || languages.length > 0) && (
              <section id="amenities" className="mt-16 scroll-mt-36 border-t border-line pt-12">
                {facilities.length > 0 && (
                  <>
                    <h2 className="type-h2">{t.hotels.facilities}</h2>
                    <div className="mt-8">
                      <HotelAmenities facilities={facilities} />
                    </div>
                  </>
                )}
                {languages.length > 0 && (
                  <div className={facilities.length > 0 ? "mt-10" : undefined}>
                    <HotelLanguages
                      heading={t.hotels.staffSpeaks}
                      languages={languages}
                      level={facilities.length > 0 ? 3 : 2}
                    />
                  </div>
                )}
              </section>
            )}

            {/*
             * Kosher, between the facilities and the map.
             *
             * Rendered from `api` rather than from the adapted fixture shape:
             * this section is new, so there is nothing to adapt it to, and the
             * adapter exists to keep *old* components working rather than to
             * flatten new data on the way to new ones.
             *
             * `isTrade` decides only whether a certificate scan is offered. The
             * certification *facts* — authority, scope, validity — are shown to
             * everyone, because they are what the traveller is deciding on.
             */}
            {api.kosher?.offersKosher && (
              <section id="kosher" className="mt-16 scroll-mt-36 border-t border-line pt-12">
                <KosherPanel
                  kosher={api.kosher}
                  nearby={api.nearby}
                  isTrade={isTrade}
                />
              </section>
            )}

            <section id="location" className="mt-16 scroll-mt-36 border-t border-line pt-12">
              <h2 className="type-h2">{t.hotels.location}</h2>
              <p className="type-body mt-4 flex items-center gap-2 text-body">
                <MapPin size={16} className="shrink-0 text-brand-text" aria-hidden />
                {hotel.address}
              </p>

              {/* No map service is wired to the public hotel page; the address carries the location. */}
              <div className="mt-6 flex items-center justify-center rounded-sm border border-dashed border-line bg-surface-earth/50 px-6 py-14 text-center">
                <div>
                  <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-background text-brand-text">
                    <Navigation size={18} aria-hidden />
                  </span>
                  <p className="type-body-sm mt-4 text-muted">{t.hotels.mapPlaceholder}</p>
                </div>
              </div>

              <h3 className="type-h4 mt-10">{t.hotels.whatsNearby}</h3>
              <dl className="mt-4 divide-y divide-line border-y border-line">
                {hotel.nearby.map((place) => (
                  <div key={place.name} className="flex items-baseline justify-between gap-6 py-3.5">
                    <dt className="type-body-sm text-body">
                      {place.name}
                      <span className="type-caption ms-2 text-subtle">{place.type}</span>
                    </dt>
                    <dd className="type-body-sm shrink-0 font-medium tabular-nums">
                      {place.distance}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* --- the bookable part ------------------------------------- */}
            <section id="rooms" className="mt-16 scroll-mt-36 border-t border-line pt-12">
              <h2 className="type-h2">{t.booking.availability.heading}</h2>

              {stay ? (
                <>
                  {!refused && (
                    <p className="type-body mt-3 text-muted">
                      {fill(t.booking.availability.ratesFor, { stay: stayRange })}
                    </p>
                  )}

                  <div className="mt-8">
                    {bookableRooms.length > 0 ? (
                      <RoomOffers
                        hotelSlug={hotel.slug}
                        hotelName={hotel.name}
                        stay={stay}
                        requestableCodes={requestableCodes}
                        roomTypes={bookableRooms}
                      />
                    ) : (
                      <EmptyState
                        iconName="calendarSearch"
                        title={
                          refused ? t.booking.window.title : t.booking.availability.emptyTitle
                        }
                        description={
                          refused
                            ? fill(t.booking.window[refused.key], { limit: refused.limit })
                            : t.booking.availability.emptyBody
                        }
                        action={{ label: t.booking.results.browseCatalogue, href: path("/hotels") }}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="mt-8">
                  <EmptyState
                    iconName="calendarSearch"
                    title={t.booking.availability.noDatesTitle}
                    description={t.booking.availability.noDatesBody}
                  />
                </div>
              )}
            </section>

            <section id="reviews" className="mt-16 scroll-mt-36 border-t border-line pt-12">
              <h2 className="type-h2">{t.hotels.guestReviews}</h2>
              <div className="mt-8">
                <HotelReviews
                  guestScore={hotel.guestScore}
                  reviewCount={hotel.reviewCount}
                  categoryScores={hotel.categoryScores}
                  reviews={hotel.reviews}
                />
              </div>
            </section>

            <section id="policies" className="mt-16 scroll-mt-36 border-t border-line pt-12">
              <h2 className="type-h2">{t.hotels.policies}</h2>
              <div className="mt-8">
                <HotelPolicies policies={hotel.policies} />
              </div>
            </section>
          </div>

          <aside className="lg:col-span-4">
            <div className="lg:sticky lg:top-36">
              <StayPanel
                guestScore={hotel.guestScore}
                reviewCount={hotel.reviewCount}
                priceFrom={hotel.priceFrom}
                stay={stay}
                cheapest={cheapest}
                refused={refused}
              />
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
            : formatPrice(hotel.priceFrom, intlLocale)
        }
        note={cheapest ? `· ${plural(locale, nights, t.units.night)}` : t.common.perNightShort}
        href={stay ? "#rooms" : "#stay-search"}
        action={stay ? t.hotels.seeRooms : t.booking.availability.selectDates}
      />

      {/* Both rails depend on a second API call and stream in rather than
          holding the property behind them. The cross-sell needs real dates to
          price against, so it appears only once the visitor has chosen some —
          undated it would be a rail of prices nobody could book. */}
      {stay && (
        <Suspense fallback={null}>
          <CompleteYourTrip
            hotel={hotel.slug}
            checkIn={stay.checkIn}
            checkOut={stay.checkOut}
            adults={stay.adults}
            childAges={stay.childAges}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <RelatedHotels destinationSlug={destination?.slug} excludeSlug={hotel.slug} />
      </Suspense>
    </>
  );
}
