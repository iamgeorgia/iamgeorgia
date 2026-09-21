"use client";

import { CalendarDays, Clock, ShieldCheck, Users, XCircle } from "lucide-react";

import type { TourCheckoutDraft } from "@/lib/booking/checkoutSession";
import { formatInstant, formatStayDate } from "@/lib/booking/stay";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";

interface TourCheckoutSummaryProps {
  /** Null when this tab has lost its draft; the hold itself is unaffected. */
  draft: TourCheckoutDraft | null;
}

/**
 * What is being bought, beside the form that buys it.
 *
 * Every figure comes from the offer the server priced and the hold it took —
 * nothing here is arithmetic on this page.
 */
export function TourCheckoutSummary({ draft }: TourCheckoutSummaryProps) {
  const { t, locale, intlLocale } = useI18n();

  if (!draft) {
    return (
      <div className="border border-line bg-surface p-6 shadow-card">
        <h2 className="type-h4">{t.tours.checkout.summary}</h2>
        <p className="type-body-sm mt-3 text-muted">{t.tours.checkout.partialDraft}</p>
      </div>
    );
  }

  const { hold, offer, option, tourTitle, durationLabel, stay } = draft;
  const { quote } = offer;
  const currency = quote.currency;
  const freeUntil = offer.cancellation.freeUntil;
  const multiDay = offer.endDate !== offer.date;

  const party = [
    plural(locale, stay.adults, t.units.adult),
    stay.childAges.length > 0 ? plural(locale, stay.childAges.length, t.units.child) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="border border-line bg-surface shadow-card">
      <div className="border-b border-line p-6">
        <h2 className="type-h4">{t.tours.checkout.summary}</h2>
        <p className="type-body mt-3 font-medium text-ink">{tourTitle}</p>
        <p className="type-caption mt-1 text-muted">{durationLabel}</p>

        <dl className="mt-4 space-y-2.5">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="type-caption flex items-center gap-1.5 text-muted">
              <CalendarDays size={13} aria-hidden />
              {t.tours.checkout.departure}
            </dt>
            <dd className="type-body-sm text-end">
              {formatStayDate(hold.date, intlLocale)}
              {multiDay && ` – ${formatStayDate(offer.endDate, intlLocale)}`}
            </dd>
          </div>
          {offer.departureTime && (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="type-caption flex items-center gap-1.5 text-muted">
                <Clock size={13} aria-hidden />
                {t.tours.availability.heading}
              </dt>
              <dd className="type-body-sm">{offer.departureTime}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4">
            <dt className="type-caption flex items-center gap-1.5 text-muted">
              <Users size={13} aria-hidden />
              {t.tours.checkout.travellers}
            </dt>
            <dd className="type-body-sm text-end">{party}</dd>
          </div>
        </dl>
      </div>

      <div className="border-b border-line p-6">
        <p className="type-caption text-muted">{t.tours.checkout.option}</p>
        <p className="type-body-sm mt-1 font-medium text-ink">{hold.optionName ?? option.name}</p>
        <p className="type-caption mt-1 text-muted">{t.tours.optionKinds[option.kind]}</p>

        <p className="type-body-sm mt-3 flex items-start gap-2">
          {freeUntil ? (
            <>
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
              <span className="text-success">
                {fill(t.tours.availability.freeUntil, { date: formatInstant(freeUntil, intlLocale) })}
              </span>
            </>
          ) : (
            <>
              <XCircle size={15} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
              <span className="text-muted">{t.tours.availability.nonRefundable}</span>
            </>
          )}
        </p>
      </div>

      <div className="p-6">
        <dl className="space-y-2.5">
          {quote.lines.map((line) => (
            <div key={line.travellerType} className="flex items-baseline justify-between gap-4">
              <dt className="type-caption text-muted">
                {option.pricingBasis === "PER_GROUP"
                  ? t.tours.availability.lines.GROUP
                  : `${line.count} × ${t.tours.availability.lines[line.travellerType]}`}
              </dt>
              <dd className="type-caption tabular-nums">
                {formatMoney(line.sellCents, currency, intlLocale)}
              </dd>
            </div>
          ))}

          <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3.5">
            <dt className="type-h4">{t.tours.checkout.total}</dt>
            <dd className="type-h4 tabular-nums">
              {formatMoney(quote.totals.totalCents, currency, intlLocale)}
            </dd>
          </div>
        </dl>

        {option.confirmationMode === "ON_REQUEST" && (
          <p className="type-caption mt-4 rounded-sm border border-warning/30 bg-warning/5 px-4 py-3 text-warning-text">
            {t.tours.checkout.onRequestNotice}
          </p>
        )}
      </div>
    </div>
  );
}
