"use client";

import Image from "next/image";
import Link from "next/link";
import { Clock, Users } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Rating } from "@/components/ui/Rating";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { tourImageUrl } from "@/lib/tours/query";
import type { TourSummary } from "@/types/tour";
import { cn } from "@/lib/utils";

interface TourCardProps {
  tour: TourSummary;
  /** `feature` gives the card a wider image and larger type. */
  variant?: "default" | "feature";
  /** Appended to the link, so a card in dated results keeps the date. */
  query?: string;
  className?: string;
  /** Load the photograph immediately — for cards in the first screen. */
  eager?: boolean;
}

/**
 * A tour in a grid, from the live catalogue.
 *
 * The price is the indicative "from" the API derives from the cheapest active
 * price sheet — never a quote. A tour with no price sheet yet shows no figure
 * at all rather than a made-up one.
 */
export function TourCard({ tour, variant = "default", query = "", className, eager }: TourCardProps) {
  const { t, intlLocale } = useI18n();
  const path = useLocalePath();
  const isFeature = variant === "feature";
  const image = tourImageUrl(tour);

  return (
    <article className={cn("group", className)}>
      <Link href={path(`/tours/${tour.slug}${query}`)} className="block focus-visible:outline-offset-8">
        <div
          className={cn(
            "relative overflow-hidden rounded-sm bg-line",
            isFeature ? "aspect-4/3 lg:aspect-16/10" : "aspect-4/3",
          )}
        >
          {image && (
            <Image
              src={image}
              alt={tour.title}
              fill
              loading={eager ? "eager" : undefined}
              sizes={isFeature ? "(max-width: 1024px) 100vw, 60vw" : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"}
              className="object-cover transition-transform duration-700 ease-(--ease-out-soft) group-hover:scale-[1.04]"
            />
          )}
          <div className="absolute start-4 top-4">
            <Badge tone="light">{t.tours.categories[tour.category]}</Badge>
          </div>
        </div>

        <div className={cn("pt-5", isFeature && "lg:pt-7")}>
          <p className="type-eyebrow text-muted">{tour.location}</p>
          <h3 className={cn("mt-3", isFeature ? "type-h2" : "type-h3")}>
            <span className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-400 ease-(--ease-out-soft) group-hover:bg-[length:100%_1px]">
              {tour.title}
            </span>
          </h3>
          <p className={cn("mt-3 text-muted line-clamp-2", isFeature ? "type-body-lg" : "type-body-sm")}>
            {tour.summary}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-muted">
            <span className="flex items-center gap-1.5 type-caption">
              <Clock size={14} aria-hidden />
              {tour.durationLabel}
            </span>
            <span className="flex items-center gap-1.5 type-caption">
              <Users size={14} aria-hidden />
              {tour.groupSize}
            </span>
          </div>

          <div className="mt-5 flex items-end justify-between gap-4 border-t border-line pt-4">
            <Rating value={tour.rating} reviewCount={tour.reviewCount} />
            {tour.priceFrom && (
              <p className="text-end">
                <span className="type-caption block text-muted">{t.common.from}</span>
                <span className="type-h4 text-ink">
                  {formatMoney(tour.priceFrom.amountCents, tour.priceFrom.currency, intlLocale, {
                    maximumFractionDigits: 0,
                  })}
                </span>
              </p>
            )}
          </div>
        </div>
      </Link>
    </article>
  );
}
