"use client";

import { ArrowRight, ShieldCheck } from "lucide-react";

import { VehicleIllustration } from "./VehicleIllustration";
import { Badge } from "@/components/ui/Badge";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n } from "@/lib/i18n/provider";
import {
  formatDuration,
  formatJourneyDate,
  luggageSummary,
  passengerSummary,
  type TransferQuery,
} from "@/lib/transfers/query";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { TransferOffer, TransferPoint } from "@/types/transfer";

interface TransferBookingSummaryProps {
  offer: TransferOffer;
  query: TransferQuery;
  /** The two ends, resolved by whoever fetched the quote. */
  from?: TransferPoint | null;
  to?: TransferPoint | null;
  /** Rendered under the total — the page's primary action. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The priced summary of one chosen transfer.
 *
 * Shared by the details page, checkout and confirmation so the figure a
 * traveller sees never changes shape between screens — the commonest way a
 * booking flow loses someone's trust is a total that looks different on the
 * next page.
 */
export function TransferBookingSummary({
  offer,
  query,
  from,
  to,
  children,
  className,
}: TransferBookingSummaryProps) {
  const { t, locale, intlLocale } = useI18n();
  const { vehicle, quote } = offer;

  const passengers = Math.max(1, query.adults + query.children);
  const perPerson = quote.perSeat;
  const currency = quote.currency;
  const total = quote.totals.totalCents;

  // Every figure below is read off the server's answer rather than recomputed.
  // The outbound leg is the line the summary leads with; a return adds a second.
  const outbound = quote.legs[0];
  const back = quote.legs[1] ?? null;
  const durationMinutes = outbound?.durationMinutes ?? 0;
  const distanceKm = outbound?.distanceKm ?? 0;
  const perSeatCents = perPerson ? Math.round(total / (passengers * quote.legs.length)) : 0;

  return (
    <div className={cn("border border-line bg-surface shadow-card", className)}>
      <div className="flex items-center gap-4 border-b border-line p-5">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-sm bg-surface-earth/60 text-ink">
          <VehicleIllustration vehicleClass={vehicle.body} className="max-w-12" />
        </span>
        <div className="min-w-0">
          <h2 className="type-h4 truncate">{vehicle.name}</h2>
          <p className="type-caption mt-1 text-muted">
            {t.transfers.vehicleClasses[vehicle.body]} · {vehicle.provider?.name}
          </p>
        </div>
        <Badge tone={vehicle.kind === "PRIVATE" ? "brand" : "neutral"} className="ms-auto shrink-0">
          {vehicle.kind === "PRIVATE" ? t.transfers.kinds.private : t.transfers.kinds.shared}
        </Badge>
      </div>

      <dl className="divide-y divide-line px-5">
        <div className="py-3.5">
          <dt className="type-caption text-muted">{t.transfers.summary.route}</dt>
          <dd className="type-body-sm mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-ink">
            <span>{from?.name ?? outbound?.from ?? "—"}</span>
            <ArrowRight size={14} className="text-brand-text rtl:-scale-x-100" aria-hidden />
            <span className="sr-only"> {t.a11y.to} </span>
            <span>{to?.name ?? outbound?.to ?? "—"}</span>
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-4 py-3.5">
          <dt className="type-caption text-muted">{t.transfers.summary.pickUp}</dt>
          <dd className="type-body-sm text-end font-medium text-ink">
            {formatJourneyDate(query.date, intlLocale)}
            {query.time && ` · ${query.time}`}
          </dd>
        </div>

        {query.type === "return" && (
          <div className="flex items-baseline justify-between gap-4 py-3.5">
            <dt className="type-caption text-muted">{t.transfers.summary.returnPickUp}</dt>
            <dd className="type-body-sm text-end font-medium text-ink">
              {formatJourneyDate(query.returnDate, intlLocale)}
              {query.returnTime && ` · ${query.returnTime}`}
            </dd>
          </div>
        )}

        <div className="flex items-baseline justify-between gap-4 py-3.5">
          <dt className="type-caption text-muted">{t.transfers.summary.journeyTime}</dt>
          <dd className="type-body-sm text-end font-medium text-ink">
            {fill(t.common.approx, {
              value: formatDuration(durationMinutes, {
                hour: t.common.hourShort,
                minute: t.common.minuteShort,
              }),
            })}{" "}
            · {fill(t.transfers.detail.kmByRoad, { count: distanceKm })}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-4 py-3.5">
          <dt className="type-caption text-muted">{t.transfers.summary.passengers}</dt>
          <dd className="type-body-sm text-end font-medium text-ink">
            {passengerSummary(query, locale, t.units)}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-4 py-3.5">
          <dt className="type-caption text-muted">{t.transfers.summary.luggage}</dt>
          <dd className="type-body-sm text-end font-medium text-ink">
            {luggageSummary(query, locale, t.units)}
          </dd>
        </div>
      </dl>

      <dl className="space-y-2.5 border-t border-line px-5 py-5">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="type-body-sm text-muted">
            {perPerson
              ? fill(t.transfers.summary.perPersonLine, {
                  price: formatMoney(perSeatCents, currency, intlLocale),
                  passengers: plural(locale, passengers, t.units.passenger),
                })
              : fill(t.transfers.summary.perJourney, { name: vehicle.name })}
          </dt>
          <dd className="type-body-sm tabular-nums">
            {formatMoney(outbound?.sellCents ?? 0, currency, intlLocale)}
          </dd>
        </div>

        {back && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="type-body-sm text-muted">{t.transfers.summary.returnJourney}</dt>
            <dd className="type-body-sm tabular-nums">
              {formatMoney(back.sellCents, currency, intlLocale)}
            </dd>
          </div>
        )}

        <div className="flex items-baseline justify-between gap-4">
          <dt className="type-body-sm text-muted">{t.transfers.summary.tollsTaxes}</dt>
          <dd className="type-body-sm text-success">{t.common.included}</dd>
        </div>

        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3.5">
          <dt className="type-h4">{t.common.total}</dt>
          <dd className="type-h4 tabular-nums">{formatMoney(total, currency, intlLocale)}</dd>
        </div>
      </dl>

      {children && <div className="px-5 pb-5">{children}</div>}

      <p className="type-caption flex items-start gap-2 border-t border-line px-5 py-4 text-muted">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-text" aria-hidden />
        {vehicle.cancellation?.description}
      </p>
    </div>
  );
}
