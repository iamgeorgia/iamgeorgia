import { SafeImage } from "@/components/ui/SafeImage";
import Link from "next/link";
import { Clock, MapPin, ShieldCheck, Users } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Rating } from "@/components/ui/Rating";
import { formatInstant } from "@/lib/booking/stay";
import { plural } from "@/lib/i18n/plural";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import { tourImageUrl, tourStayQueryString, type TourStay } from "@/lib/tours/query";
import type { TourSearchResult } from "@/types/tour";

interface TourResultCardProps {
  result: TourSearchResult;
  stay: TourStay;
}

/**
 * One tour in dated results: the journey, and the cheapest departure that day
 * for exactly this party. The figure is a real total, never a "from".
 */
export async function TourResultCard({ result, stay }: TourResultCardProps) {
  const { t, locale, intlLocale, fill, path } = await getI18n();
  const image = tourImageUrl(result);
  const offer = result.cheapestOffer;
  const href = path(`/tours/${result.slug}${tourStayQueryString(stay)}`);

  const party = [
    plural(locale, stay.adults, t.units.adult),
    stay.childAges.length > 0 ? plural(locale, stay.childAges.length, t.units.child) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="grid gap-5 border border-line bg-surface p-4 sm:grid-cols-[16rem_1fr] sm:p-5 lg:grid-cols-[18rem_1fr_14rem]">
      <Link href={href} className="relative block aspect-4/3 overflow-hidden rounded-sm bg-line">
        {image && (
          <SafeImage
            src={image}
            alt={result.title}
            fill
            sizes="(max-width: 640px) 90vw, 18rem"
            className="object-cover"
          />
        )}
        <div className="absolute start-3 top-3">
          <Badge tone="light">{t.tours.categories[result.category]}</Badge>
        </div>
      </Link>

      <div className="min-w-0">
        <p className="type-eyebrow flex items-center gap-1.5 text-muted">
          <MapPin size={12} className="shrink-0" aria-hidden />
          {result.location}
        </p>
        <h3 className="type-h3 mt-2">
          <Link href={href} className="hover:underline underline-offset-4">
            {result.title}
          </Link>
        </h3>
        <p className="type-body-sm mt-2 text-muted line-clamp-2">{result.summary}</p>

        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          <li className="type-caption flex items-center gap-1.5 text-muted">
            <Clock size={13} aria-hidden />
            {result.durationLabel}
          </li>
          <li className="type-caption flex items-center gap-1.5 text-muted">
            <Users size={13} aria-hidden />
            {result.groupSize}
          </li>
          <li>
            <Rating value={result.rating} reviewCount={result.reviewCount} />
          </li>
        </ul>

        {offer && (
          <p className="type-caption mt-4 text-muted">
            {offer.option.name}
            {offer.departureTime && ` · ${fill(t.tours.availability.startsAt, { time: offer.departureTime })}`}
          </p>
        )}
      </div>

      <div className="flex flex-col justify-between gap-4 border-t border-line pt-4 sm:col-span-2 lg:col-span-1 lg:border-t-0 lg:border-s lg:pt-0 lg:ps-6">
        {offer ? (
          <div className="lg:text-end">
            <p className="type-h3 tabular-nums">
              {formatMoney(offer.quote.totals.totalCents, offer.quote.currency, intlLocale)}
            </p>
            <p className="type-caption text-muted">{fill(t.tours.availability.totalFor, { party })}</p>
            {offer.cancellation.freeUntil && (
              <p className="type-caption mt-2 flex items-start gap-1.5 text-success lg:justify-end">
                <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden />
                {fill(t.tours.availability.freeUntil, {
                  date: formatInstant(offer.cancellation.freeUntil, intlLocale),
                })}
              </p>
            )}
          </div>
        ) : (
          <p className="type-body-sm text-muted">{t.tours.results.emptyTitle}</p>
        )}

        <Link
          href={href}
          className="inline-flex h-11 items-center justify-center rounded-sm bg-brand px-6 text-[0.9375rem] font-semibold text-on-dark transition-colors hover:bg-brand-hover"
        >
          {t.tours.results.viewDepartures}
        </Link>
      </div>
    </article>
  );
}
