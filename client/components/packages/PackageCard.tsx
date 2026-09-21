"use client";

import Image from "next/image";
import Link from "next/link";
import { Layers, MapPin, Moon } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { fill } from "@/lib/i18n/fill";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { packageImageUrl } from "@/lib/packages/query";
import type { PackageSummary } from "@/types/package";
import { cn } from "@/lib/utils";

interface PackageCardProps {
  pkg: PackageSummary;
  /** `feature` gives the card a wider image and larger type. */
  variant?: "default" | "feature";
  /** Appended to the link, so a card in dated results keeps the dates. */
  query?: string;
  className?: string;
  /** Load the photograph immediately — for cards in the first screen. */
  eager?: boolean;
}

/**
 * A package in a grid.
 *
 * The price is the indicative "from" the server samples a few dates ahead for,
 * never a quote — hence the caption under it. A package that has never priced
 * shows no figure rather than a made-up one, exactly as a tour with no price
 * sheet does.
 */
export function PackageCard({
  pkg,
  variant = "default",
  query = "",
  className,
  eager,
}: PackageCardProps) {
  const { t, intlLocale } = useI18n();
  const path = useLocalePath();
  const isFeature = variant === "feature";
  const image = packageImageUrl(pkg);

  return (
    <article className={cn("group", className)}>
      <Link
        href={path(`/packages/${pkg.slug}${query}`)}
        className="block focus-visible:outline-offset-8"
      >
        <div
          className={cn(
            "relative overflow-hidden rounded-sm bg-line",
            isFeature ? "aspect-4/3 lg:aspect-16/10" : "aspect-4/3",
          )}
        >
          {image && (
            <Image
              src={image}
              alt={pkg.name}
              fill
              loading={eager ? "eager" : undefined}
              sizes={
                isFeature
                  ? "(max-width: 1024px) 100vw, 60vw"
                  : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              }
              className="object-cover transition-transform duration-700 ease-(--ease-out-soft) group-hover:scale-[1.04]"
            />
          )}
          {pkg.kosher && (
            <div className="absolute start-4 top-4">
              <Badge tone="light">{t.packages.kosher.badge}</Badge>
            </div>
          )}
        </div>

        <div className="pt-4">
          <div className="type-caption flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            {pkg.destination && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={13} className="shrink-0" aria-hidden />
                {pkg.destination.name}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Moon size={13} aria-hidden />
              {fill(t.packages.nights, { count: pkg.nights })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Layers size={13} aria-hidden />
              {fill(t.packages.componentCount, { count: pkg.componentCount })}
            </span>
          </div>

          <h3
            className={cn(
              "mt-2 text-ink transition-colors group-hover:text-brand-text",
              isFeature ? "type-h3" : "type-h4",
            )}
          >
            {pkg.name}
          </h3>

          {pkg.summary && (
            <p className={cn("mt-2 text-body", isFeature ? "type-body" : "type-body-sm")}>
              {pkg.summary}
            </p>
          )}

          {pkg.priceFrom && (
            <p className="mt-3">
              <span className="type-caption text-muted">{t.packages.from} </span>
              <span className="type-h4 text-ink">
                {formatMoney(pkg.priceFrom.amountCents, pkg.priceFrom.currency, intlLocale)}
              </span>
              <span className="type-caption text-muted"> {t.packages.perTrip}</span>
            </p>
          )}
        </div>
      </Link>
    </article>
  );
}
