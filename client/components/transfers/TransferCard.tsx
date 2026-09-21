"use client";

import Link from "next/link";
import { BadgeCheck, Briefcase, Check, Clock, Users } from "lucide-react";

import { featureIcons } from "./featureIcons";
import { VehicleIllustration } from "./VehicleIllustration";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Rating } from "@/components/ui/Rating";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n } from "@/lib/i18n/provider";
import { formatDuration, type TransferQuery } from "@/lib/transfers/query";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { TransferOffer } from "@/types/transfer";

interface TransferCardProps {
  offer: TransferOffer;
  query: TransferQuery;
  /** Locale-prefixed detail URL, already carrying the search query. */
  href: string;
  /** Marks the option the traveller has already chosen. */
  selected?: boolean;
  /** Passed down rather than read here, so a server render formats identically. */
  intlLocale?: string;
  className?: string;
}

/**
 * A single priced option.
 *
 * Ordered the way a traveller reads it: what the vehicle is, whether it fits
 * the party, how long it takes, who is driving — and only then the price, which
 * with the CTA is the one block allowed to shout. Three features are shown; the
 * rest live on the details page, because a card that lists everything is a card
 * nobody compares.
 */
export function TransferCard({ offer, query, href, selected, className }: TransferCardProps) {
  const { t, locale, intlLocale } = useI18n();
  const { vehicle, quote } = offer;
  const perPerson = quote.perSeat;
  const total = quote.totals.totalCents;
  const currency = quote.currency;
  const passengers = Math.max(1, query.adults + query.children);
  // The per-seat figure the card leads with. The server has already multiplied
  // it into the total, so this divides back out rather than re-deriving a fare.
  const perSeatCents = perPerson ? Math.round(total / passengers) : total;
  const durationMinutes = quote.legs.reduce(
    (longest, leg) => Math.max(longest, leg.durationMinutes),
    0,
  );
  const isReturn = query.type === "return";

  return (
    <article
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group relative border bg-surface transition-[border-color,box-shadow] duration-300 ease-(--ease-out-soft)",
        selected
          ? "border-brand shadow-card"
          : "border-line hover:border-subtle hover:shadow-card",
        className,
      )}
    >
      {selected && (
        <p className="type-caption flex items-center gap-1.5 border-b border-brand/30 bg-brand-soft px-4 py-2 font-medium text-brand-text sm:px-5">
          <Check size={14} aria-hidden />
          {t.transfers.card.selected}
        </p>
      )}

      <div className="flex flex-col gap-5 p-4 sm:flex-row sm:gap-6 sm:p-5">
        <div className="flex shrink-0 items-center justify-center rounded-sm bg-surface-earth/60 px-4 py-6 text-ink sm:w-48 lg:w-56">
          <VehicleIllustration vehicleClass={vehicle.body} className="max-w-44" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="outline">{t.transfers.vehicleClasses[vehicle.body]}</Badge>
            <Badge tone={vehicle.kind === "PRIVATE" ? "brand" : "neutral"}>
              {vehicle.kind === "PRIVATE" ? t.transfers.kinds.private : t.transfers.kinds.shared}
            </Badge>
          </div>

          <h3 className="type-h3 mt-3">
            <Link href={href} className="focus-visible:outline-offset-4">
              <span className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-400 ease-(--ease-out-soft) group-hover:bg-[length:100%_1px]">
                {vehicle.name}
              </span>
            </Link>
          </h3>

          <p className="type-caption mt-1.5 text-muted">{vehicle.vehicleExample}</p>

          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            <li className="type-body-sm flex items-center gap-1.5 text-body">
              <Users size={15} className="shrink-0 text-subtle" aria-hidden />
              {fill(t.transfers.card.upToPassengers, {
                count: plural(locale, vehicle.maxPassengers, t.units.passenger),
              })}
            </li>
            <li className="type-body-sm flex items-center gap-1.5 text-body">
              <Briefcase size={15} className="shrink-0 text-subtle" aria-hidden />
              {plural(locale, vehicle.maxLuggage, t.units.largeBag)}
            </li>
            <li className="type-body-sm flex items-center gap-1.5 text-body">
              <Clock size={15} className="shrink-0 text-subtle" aria-hidden />
              {fill(t.common.approx, {
                value: formatDuration(durationMinutes, {
                  hour: t.common.hourShort,
                  minute: t.common.minuteShort,
                }),
              })}
            </li>
          </ul>

          <ul className="mt-3.5 flex flex-wrap gap-x-4 gap-y-2">
            {vehicle.features.slice(0, 3).map((feature) => {
              const Icon = featureIcons[feature];
              return (
                <li key={feature} className="type-caption flex items-center gap-1.5 text-muted">
                  <Icon size={13} className="shrink-0 text-success" aria-hidden />
                  {t.transfers.features[feature]}
                </li>
              );
            })}
          </ul>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-4 sm:mt-auto">
            <div className="min-w-0">
              <p className="type-body-sm flex items-center gap-1.5 font-medium text-ink">
                {vehicle.provider?.name}
                {vehicle.provider?.verified && (
                  <span className="inline-flex items-center gap-1 text-success">
                    <BadgeCheck size={14} aria-hidden />
                    <span className="type-caption font-normal">{t.transfers.card.verified}</span>
                  </span>
                )}
              </p>
              {vehicle.provider && (
                <Rating
                  value={vehicle.provider.rating}
                  reviewCount={vehicle.provider.reviewCount}
                  className="mt-1.5"
                />
              )}
            </div>

            <div className="flex items-end gap-5">
              <p className="text-end">
                <span className="type-caption block text-muted">
                  {perPerson ? t.transfers.card.fromPerPerson : t.common.total}
                </span>
                <span className="type-h3 block text-ink tabular-nums">
                  {formatMoney(perPerson ? perSeatCents : total, currency, intlLocale)}
                </span>
                <span className="type-caption block text-muted">
                  {perPerson
                    ? fill(t.transfers.card.forYourParty, {
                        price: formatMoney(total, currency, intlLocale),
                      })
                    : isReturn
                      ? t.transfers.card.bothJourneys
                      : t.transfers.card.allTaxes}
                </span>
              </p>
              <Button href={href} size="md">
                {t.actions.select}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
