"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin, ShieldCheck, Utensils } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { KosherBadge } from "@/components/hotels/KosherBadge";
import { ScoreBadge, Stars } from "@/components/ui/Rating";
import { stayQueryString } from "@/lib/booking/stay";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type { SearchResult, StayQuery } from "@/types/booking";
import { cn } from "@/lib/utils";

interface StayResultCardProps {
  result: SearchResult;
  stay: StayQuery;
  nights: number;
  /** Load the photograph immediately — for cards in the first screen. */
  eager?: boolean;
}

/**
 * A dated search result — deliberately not the catalogue card.
 *
 * The catalogue says "from ₾240 a night" about a property in the abstract.
 * This says what *this* stay costs for *these* dates and this party, because
 * that figure came back from a search that only returns rooms it can actually
 * sell. Showing an indicative price on a dated search is how a site ends up
 * advertising a total it cannot honour at checkout.
 *
 * The stay travels on every link out of here, so choosing a property never
 * loses the dates the traveller has already given us.
 */
export function StayResultCard({ result, stay, nights, eager }: StayResultCardProps) {
  const { t, locale, intlLocale } = useI18n();
  const path = useLocalePath();

  const href = path(`/hotels/${result.slug}${stayQueryString(stay)}`);
  const { startingFrom } = result;
  const image = result.coverImage
    ? (result.coverImage.variants.find((variant) => variant.variant === "card")?.url ??
      result.coverImage.url)
    : null;

  return (
    <article className="group border border-line bg-surface transition-[border-color,box-shadow] duration-300 ease-(--ease-out-soft) hover:border-subtle hover:shadow-card">
      <div className="flex flex-col gap-5 p-4 sm:flex-row sm:gap-6 sm:p-5">
        <Link
          href={href}
          tabIndex={-1}
          aria-hidden
          className="relative aspect-4/3 w-full shrink-0 overflow-hidden rounded-sm bg-line sm:aspect-square sm:w-56 lg:w-64"
        >
          {image && (
            <Image
              src={image}
              alt=""
              fill
              loading={eager ? "eager" : undefined}
              sizes="(max-width: 640px) 90vw, 16rem"
              className="object-cover transition-transform duration-700 ease-(--ease-out-soft) group-hover:scale-[1.04]"
            />
          )}
        </Link>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <Stars count={result.starRating} />
            <span className="type-caption text-subtle">·</span>
            <span className="type-caption text-muted">{result.propertyType}</span>
          </div>

          <h3 className="type-h3 mt-2">
            <Link href={href} className="focus-visible:outline-offset-4">
              <span className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-400 ease-(--ease-out-soft) group-hover:bg-[length:100%_1px]">
                {result.name}
              </span>
            </Link>
          </h3>

          {result.destination && (
            <p className="type-caption mt-2 flex items-center gap-1.5 text-muted">
              <MapPin size={13} className="shrink-0" aria-hidden />
              {result.destination.name}
            </p>
          )}

          {result.shortDescription && (
            <p className="type-body-sm mt-3 line-clamp-2 text-body">{result.shortDescription}</p>
          )}

          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
            <li
              className={cn(
                "type-caption flex items-center gap-1.5",
                result.refundable ? "text-success" : "text-muted",
              )}
            >
              <ShieldCheck size={13} aria-hidden />
              {result.refundable
                ? t.booking.results.refundable
                : t.booking.results.nonRefundable}
            </li>
            {result.mealPlans.length > 0 && (
              <li className="type-caption flex items-center gap-1.5 text-muted">
                <Utensils size={13} aria-hidden />
                {result.mealPlans.slice(0, 2).join(" · ")}
              </li>
            )}
            <li className="type-caption text-muted">
              {fill(t.booking.results.ratesAvailable, { count: result.offerCount })}
            </li>
          </ul>

          {/*
           * Its own row rather than another chip in the list above.
           *
           * "Kosher certified · Chief Rabbinate of Georgia" is a different kind
           * of statement from "BB" or "3 rates available" — one of them is a
           * claim somebody checked — and sitting it among them would flatten
           * that difference at exactly the moment an agent is scanning.
           */}
          {result.kosher && (
            <div className="mt-3">
              <KosherBadge kosher={result.kosher} showAuthority />
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-4 sm:mt-auto">
            <ScoreBadge score={result.guestScore} reviewCount={result.reviewCount} size="sm" />

            <div className="flex items-end gap-5">
              <p className="text-end">
                <span className="type-h4 block text-ink tabular-nums">
                  {formatMoney(startingFrom.totalCents, startingFrom.currency, intlLocale)}
                </span>
                <span className="type-caption block text-muted">
                  {fill(t.booking.results.totalFor, {
                    nights: plural(locale, nights, t.units.night),
                  })}
                </span>
                <span className="type-caption block text-subtle">
                  {fill(t.booking.results.perNight, {
                    price: formatMoney(
                      startingFrom.perNightCents,
                      startingFrom.currency,
                      intlLocale,
                    ),
                  })}
                </span>
              </p>
              <Button href={href} size="sm">
                {t.booking.results.viewRooms}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
