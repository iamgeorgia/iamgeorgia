import Image from "next/image";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { MapPin } from "lucide-react";

import { Reveal, RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { Stars } from "@/components/ui/Rating";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { listPublicHotels } from "@/lib/api/search";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import { adaptHotelSummary } from "@/lib/site/hotelAdapter";
import type { HotelSummary } from "@/types/catalogue";

const LIMIT = 4;

/**
 * The homepage's hotel rail, from the live catalogue.
 *
 * Featured properties first, topped up from the rest of the catalogue — the
 * same shape as `SignatureTours`. The API sorts featured properties to the
 * front unconditionally, so one page of four is the whole answer: no second
 * call, no waterfall. Guarded: a rail that cannot load renders nothing rather
 * than a fixture, because a card that links to a property which does not
 * exist is worse than no card.
 *
 * `unstable_rethrow` first, so the catch never swallows Next's own
 * dynamic-usage signal (the session cookie is read inside `serverFetch`).
 */
export async function FeaturedHotels() {
  const { t, path, locale, intlLocale } = await getI18n();

  let hotels: HotelSummary[] = [];

  try {
    const { data } = await listPublicHotels({ locale, pageSize: LIMIT });
    hotels = data;
  } catch (error) {
    unstable_rethrow(error);
    console.error("Featured hotels failed:", error);
  }

  if (hotels.length === 0) return null;

  return (
    <section className="bg-surface-earth py-16 sm:py-24 lg:py-32">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow={t.home.hotels.eyebrow}
            title={t.home.hotels.title}
            description={t.home.hotels.description}
            action={{ label: t.actions.allHotels, href: path("/hotels") }}
          />
        </Reveal>

        <RevealGroup className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {hotels.map((hotel) => {
            // The listing's adapter, so the card rendition and destination
            // name are resolved exactly as they are on /hotels.
            const view = adaptHotelSummary(hotel);
            const href = path(`/hotels/${hotel.slug}`);

            return (
              <RevealItem key={hotel.id}>
                <article className="group flex h-full flex-col border border-line bg-surface transition-[border-color,box-shadow] duration-300 ease-(--ease-out-soft) hover:border-subtle hover:shadow-card">
                  <Link
                    href={href}
                    tabIndex={-1}
                    aria-hidden
                    className="relative aspect-4/3 overflow-hidden bg-line"
                  >
                    {view.image && (
                      <Image
                        src={view.image}
                        alt=""
                        fill
                        sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 22vw"
                        className="object-cover transition-transform duration-700 ease-(--ease-out-soft) group-hover:scale-[1.04]"
                      />
                    )}
                  </Link>

                  <div className="flex flex-1 flex-col gap-y-0 p-5 [&>p:last-child]:mt-5">
                    {hotel.starRating > 0 && <Stars count={hotel.starRating} />}

                    <h3 className="type-h4 mt-2">
                      <Link href={href} className="focus-visible:outline-offset-4">
                        <span className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-400 ease-(--ease-out-soft) group-hover:bg-[length:100%_1px]">
                          {hotel.name}
                        </span>
                      </Link>
                    </h3>

                    {view.location && (
                      <p className="type-caption mt-2 flex items-center gap-1.5 text-muted">
                        <MapPin size={13} className="shrink-0" aria-hidden />
                        {view.location}
                      </p>
                    )}

                    {hotel.priceFrom && (
                      <p className="mt-auto flex flex-wrap items-baseline gap-x-1.5 border-t border-line pt-4">
                        <span className="type-caption text-muted">{t.common.from}</span>
                        <span className="type-h4 text-ink">
                          {formatMoney(hotel.priceFrom.amountCents, hotel.priceFrom.currency, intlLocale, {
                            maximumFractionDigits: 0,
                            minimumFractionDigits: 0,
                          })}
                        </span>
                        <span className="type-caption text-muted">{t.common.perNight}</span>
                      </p>
                    )}
                  </div>
                </article>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </Container>
    </section>
  );
}

/** The rail's silhouette while the catalogue answers, so the hero ships first. */
export function FeaturedHotelsFallback() {
  return (
    <section className="bg-surface-earth py-16 sm:py-24 lg:py-32">
      <Container>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-5 h-10 w-2/3 max-w-lg" />
        <Skeleton className="mt-4 h-3 w-1/2 max-w-md" />

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: LIMIT }, (_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      </Container>
    </section>
  );
}
