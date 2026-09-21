"use client";

import { Star } from "lucide-react";

import { fill } from "@/lib/i18n/fill";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { guestScoreLabel } from "@/lib/utils";

interface RatingProps {
  /** Out of 5. */
  value: number;
  reviewCount?: number;
  size?: "sm" | "md";
  tone?: "dark" | "light";
  className?: string;
}

/** Five-star rating used by tours and experiences. */
export function Rating({ value, reviewCount, size = "sm", tone = "dark", className }: RatingProps) {
  const { t } = useI18n();
  const starSize = size === "sm" ? 14 : 16;
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Star
        size={starSize}
        className={cn("shrink-0", tone === "light" ? "fill-on-dark text-on-dark" : "fill-accent-gold text-accent-gold")}
        aria-hidden
      />
      <span
        className={cn(
          "font-medium tabular-nums",
          size === "sm" ? "text-[0.8125rem]" : "text-sm",
          tone === "light" ? "text-on-dark" : "text-ink",
        )}
      >
        {value.toFixed(1)}
      </span>
      {reviewCount !== undefined && (
        <span
          className={cn(
            size === "sm" ? "text-[0.8125rem]" : "text-sm",
            tone === "light" ? "text-on-dark/70" : "text-muted",
          )}
        >
          ({reviewCount})
        </span>
      )}
      <span className="sr-only">
        {fill(t.a11y.ratedOutOf, { value: value.toFixed(1) })}
        {reviewCount !== undefined
          ? ` ${fill(t.a11y.fromReviews, { count: reviewCount })}`
          : ""}
      </span>
    </div>
  );
}

interface ScoreBadgeProps {
  /** Out of 10. */
  score: number;
  reviewCount?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Ten-point guest score used by hotels — the pattern travellers already know
 * from booking platforms: a solid score block beside a worded verdict.
 */
export function ScoreBadge({ score, reviewCount, size = "md", className }: ScoreBadgeProps) {
  const { t, locale } = useI18n();
  const box = {
    sm: "h-8 min-w-8 text-[0.8125rem]",
    md: "h-10 min-w-10 text-sm",
    lg: "h-12 min-w-12 text-base",
  }[size];

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span
        className={cn(
          // brand-600 rather than the logo orange: the numeral is small text, and
          // the deeper shade clears AA against white (4.5:1) while still reading
          // unmistakably as the brand.
          "flex items-center justify-center rounded-sm rounded-es-none bg-brand-600 px-2 font-semibold text-white tabular-nums",
          box,
        )}
      >
        {score.toFixed(1)}
      </span>
      <span className="leading-tight">
        <span className="block type-body-sm font-semibold text-ink">
          {t.hotels.scoreLabels[guestScoreLabel(score)]}
        </span>
        {reviewCount !== undefined && (
          <span className="block type-caption text-muted">
            {fill(t.hotels.reviewsCount, { count: reviewCount.toLocaleString(locale) })}
          </span>
        )}
      </span>
    </div>
  );
}

interface StarsProps {
  /** Official star classification, 1–5. */
  count: number;
  className?: string;
}

export function Stars({ count, className }: StarsProps) {
  const { t } = useI18n();

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={fill(t.a11y.starProperty, { count })}>
      {Array.from({ length: count }, (_, index) => (
        <Star key={index} size={13} className="fill-accent-gold text-accent-gold" aria-hidden />
      ))}
    </span>
  );
}
