import Image from "next/image";
import Link from "next/link";
import { MapPin } from "lucide-react";

import { KosherBadge } from "./KosherBadge";
import { Badge } from "@/components/ui/Badge";
import { ScoreBadge, Stars } from "@/components/ui/Rating";
import type { Hotel } from "@/types";
import { cn, formatPrice } from "@/lib/utils";

interface HotelCardProps {
  hotel: Hotel;
  className?: string;
  /** Load the photograph immediately — for cards in the first screen. */
  eager?: boolean;
}

/** Vertical property card, used on the homepage and destination pages. */
export function HotelCard({ hotel, className, eager }: HotelCardProps) {
  return (
    <article className={cn("group flex h-full flex-col", className)}>
      <Link
        href={`/hotels/${hotel.slug}`}
        className="flex h-full flex-col focus-visible:outline-offset-8"
      >
        <div className="relative aspect-4/3 overflow-hidden rounded-sm bg-line">
          <Image
            src={hotel.image}
            alt={hotel.name}
            fill
            loading={eager ? "eager" : undefined}
            sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 30vw"
            className="object-cover transition-transform duration-700 ease-(--ease-out-soft) group-hover:scale-[1.04]"
          />
          <div className="absolute start-4 top-4">
            <Badge tone="light">{hotel.propertyType}</Badge>
          </div>
        </div>

        <div className="flex flex-1 flex-col pt-5">
          <div className="flex items-center gap-2">
            <Stars count={hotel.starRating} />
            <span className="type-caption flex items-center gap-1 text-muted">
              <MapPin size={12} className="shrink-0" aria-hidden />
              {hotel.location}
            </span>
          </div>

          <h3 className="type-h3 mt-2.5">
            <span className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-400 ease-(--ease-out-soft) group-hover:bg-[length:100%_1px]">
              {hotel.name}
            </span>
          </h3>

          <p className="type-body-sm mt-3 text-muted line-clamp-2">{hotel.summary}</p>

          {/* No authority here: a vertical card is narrow, and a truncated
              rabbinate name is worse than the label on its own. */}
          {hotel.kosher && (
            <div className="mt-3">
              <KosherBadge kosher={hotel.kosher} />
            </div>
          )}

          <div className="mt-auto flex items-end justify-between gap-4 border-t border-line pt-5">
            <ScoreBadge score={hotel.guestScore} reviewCount={hotel.reviewCount} size="sm" />
            <p className="text-end">
              <span className="type-caption block text-muted">From</span>
              <span className="type-h4 text-ink">{formatPrice(hotel.priceFrom)}</span>
              <span className="type-caption block text-muted">per night</span>
            </p>
          </div>
        </div>
      </Link>
    </article>
  );
}
