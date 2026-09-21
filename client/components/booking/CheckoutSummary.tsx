"use client";

import { CalendarDays, ShieldCheck, Users, XCircle } from "lucide-react";

import type { CheckoutDraft } from "@/lib/booking/checkoutSession";
import { formatInstant, formatNightDate, formatStayDate } from "@/lib/booking/stay";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";

interface CheckoutSummaryProps {
  /** Null when this tab has lost its draft; the hold itself is unaffected. */
  draft: CheckoutDraft | null;
  nights: number;
}

/**
 * What is being bought, beside the form that buys it.
 *
 * Every figure comes from the offer the server priced and the hold it took —
 * nothing here is arithmetic on this page. The taxes and the amount payable at
 * the property are broken out rather than folded into one number, because the
 * one complaint a hotel desk cannot answer is "nobody told me there was more
 * to pay".
 */
export function CheckoutSummary({ draft, nights }: CheckoutSummaryProps) {
  const { t, locale, intlLocale } = useI18n();

  if (!draft) {
    return (
      <div className="border border-line bg-surface p-6 shadow-card">
        <h2 className="type-h4">{t.booking.checkout.summary}</h2>
        <p className="type-body-sm mt-3 text-muted">{t.booking.checkout.partialDraft}</p>
      </div>
    );
  }

  const { hold, offer, hotelName, stay } = draft;
  const totals = offer.quote.totals;
  const currency = offer.quote.currency;
  const cancellation = offer.terms.cancellation;
  const refundable = cancellation.refundable !== false && cancellation.freeUntil;

  const party = [
    plural(locale, stay.adults, t.units.adult),
    (stay.childAges?.length ?? 0) > 0 ? plural(locale, stay.childAges!.length, t.units.child) : null,
    plural(locale, hold.rooms, t.units.room),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="border border-line bg-surface shadow-card">
      <div className="border-b border-line p-6">
        <h2 className="type-h4">{t.booking.checkout.summary}</h2>
        <p className="type-body mt-3 font-medium text-ink">{hotelName}</p>

        <dl className="mt-4 space-y-2.5">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="type-caption flex items-center gap-1.5 text-muted">
              <CalendarDays size={13} aria-hidden />
              {t.booking.search.checkIn}
            </dt>
            <dd className="type-body-sm">{formatStayDate(hold.checkIn, intlLocale)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="type-caption flex items-center gap-1.5 text-muted">
              <CalendarDays size={13} aria-hidden />
              {t.booking.search.checkOut}
            </dt>
            <dd className="type-body-sm">{formatStayDate(hold.checkOut, intlLocale)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="type-caption flex items-center gap-1.5 text-muted">
              <Users size={13} aria-hidden />
              {t.booking.search.guests}
            </dt>
            <dd className="type-body-sm text-end">{party}</dd>
          </div>
        </dl>
      </div>

      <div className="border-b border-line p-6">
        <p className="type-caption text-muted">{t.booking.checkout.room}</p>
        <p className="type-body-sm mt-1 font-medium text-ink">
          {hold.roomTypeName ?? offer.name}
        </p>
        <p className="type-caption mt-2 text-muted">{t.booking.checkout.rate}</p>
        <p className="type-body-sm mt-1">{hold.ratePlanName ?? offer.name}</p>

        {offer.terms.mealPlan && (
          <p className="type-body-sm mt-3 text-body">{offer.terms.mealPlan.name}</p>
        )}

        <p className="type-body-sm mt-3 flex items-start gap-2">
          {refundable ? (
            <>
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
              <span className="text-success">
                {fill(t.booking.availability.freeUntil, {
                  date: formatInstant(cancellation.freeUntil, intlLocale),
                })}
              </span>
            </>
          ) : (
            <>
              <XCircle size={15} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
              <span className="text-muted">
                {cancellation.description ?? t.booking.availability.nonRefundable}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="p-6">
        <dl className="space-y-2.5">
          {offer.quote.nights.map((night) => (
            <div key={night.date} className="flex items-baseline justify-between gap-4">
              <dt className="type-caption text-muted">{formatNightDate(night.date, intlLocale)}</dt>
              <dd className="type-caption tabular-nums">
                {formatMoney(night.sellCents, currency, intlLocale)}
              </dd>
            </div>
          ))}

          {totals.taxIncludedCents > 0 && (
            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
              <dt className="type-caption text-muted">{t.booking.checkout.taxesIncluded}</dt>
              <dd className="type-caption tabular-nums">
                {formatMoney(totals.taxIncludedCents, currency, intlLocale)}
              </dd>
            </div>
          )}

          <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3.5">
            <dt className="type-h4">
              {t.booking.checkout.total}
              <span className="type-caption ms-2 font-normal text-muted">
                {plural(locale, nights, t.units.night)}
              </span>
            </dt>
            <dd className="type-h4 tabular-nums">
              {formatMoney(totals.totalCents, currency, intlLocale)}
            </dd>
          </div>
        </dl>

        {totals.payableAtPropertyCents > 0 && (
          <div className="mt-4 rounded-sm border border-line bg-surface-soft/60 px-4 py-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="type-caption text-muted">{t.booking.checkout.payAtProperty}</span>
              <span className="type-body-sm font-medium tabular-nums">
                {formatMoney(totals.payableAtPropertyCents, currency, intlLocale)}
              </span>
            </div>
            <p className="type-caption mt-1.5 text-subtle">
              {t.booking.checkout.payAtPropertyHint}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
