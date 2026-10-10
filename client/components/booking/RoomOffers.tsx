"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertCircle, BedDouble, Check, ChevronDown, ShieldCheck, Users, XCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { createHold } from "@/lib/api/bookings";
import { bookingErrorKey } from "@/lib/booking/errors";
import {
  newIdempotencyKey,
  saveCheckoutDraft,
} from "@/lib/booking/checkoutSession";
import { formatNightDate, formatInstant } from "@/lib/booking/stay";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type { Offer, RoomAvailability, StayQuery } from "@/types/booking";
import { cn } from "@/lib/utils";
import { BookingErrorText } from "@/components/booking/BookingErrorText";

interface RoomOffersProps {
  hotelSlug: string;
  hotelName: string;
  stay: StayQuery;
  roomTypes: RoomAvailability[];
  /** Kosher facility codes this property offers, for the checkout picker. */
  requestableCodes?: string[];
}

/**
 * Live rates for one property, and the step that turns looking into booking.
 *
 * Everything here came from `/api/search/hotels/:slug` for the exact dates and
 * party in the URL, so every price is a real total for a room that could be
 * sold at the moment the page rendered. "Reserve" takes a hold before the guest
 * types a single character of their name — which is the difference between
 * losing a room during checkout and losing it during the search.
 *
 * The offer token is what carries the price. It is signed, so nothing on this
 * page can alter what the guest is charged; the server re-prices it anyway when
 * the hold is taken, and again when the booking is confirmed.
 */
export function RoomOffers({
  hotelSlug,
  hotelName,
  stay,
  roomTypes,
  requestableCodes,
}: RoomOffersProps) {
  const router = useRouter();
  const path = useLocalePath();
  const { t, locale, intlLocale } = useI18n();

  /** The offer being held. Doubles as "a request is in flight". */
  const [holding, setHolding] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<keyof typeof t.booking.errors | null>(null);
  const [openBreakdown, setOpenBreakdown] = useState<string | null>(null);

  const reserve = async (offer: Offer) => {
    setErrorKey(null);
    setHolding(offer.token);

    try {
      const hold = await createHold(offer.token);

      // The summary panel on the next page wants the nightly lines and the
      // terms; only the hold token itself can travel in the URL.
      saveCheckoutDraft({
        holdToken: hold.token,
        hold,
        offer,
        hotelSlug,
        hotelName,
        stay,
        requestableCodes,
        idempotencyKey: newIdempotencyKey(),
      });

      router.push(path(`/booking/checkout?hold=${encodeURIComponent(hold.token)}`));
    } catch (error) {
      // The room went, or moved price, between rendering and clicking. Both are
      // ordinary on a busy property and neither loses anything the guest typed.
      setErrorKey(bookingErrorKey(error));
      setHolding(null);
      router.refresh();
    }
  };

  const bookable = roomTypes.filter((roomType) => roomType.offers.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {errorKey && (
        <p
          role="alert"
          className="flex items-start gap-2.5 rounded-sm border border-error/30 bg-error/5 px-4 py-3 text-sm text-error-text"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <BookingErrorText errorKey={errorKey} />
        </p>
      )}

      {bookable.map((roomType) => (
        <article key={roomType.id} className="border border-line bg-surface">
          <div className="grid gap-5 p-4 sm:grid-cols-[13rem_1fr] sm:p-5">
            <div className="relative aspect-4/3 overflow-hidden rounded-sm bg-line">
              {roomType.coverImage && (
                <Image
                  src={roomType.coverImage.url}
                  alt={roomType.name}
                  fill
                  sizes="(max-width: 640px) 90vw, 13rem"
                  className="object-cover"
                />
              )}
            </div>

            <div className="min-w-0">
              <h3 className="type-h4">{roomType.name}</h3>

              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                <li className="type-caption flex items-center gap-1.5 text-muted">
                  <Users size={13} aria-hidden />
                  {fill(t.booking.availability.sleeps, { count: roomType.occupancy.max })}
                </li>
                {roomType.bedGroups[0] && (
                  <li className="type-caption flex items-center gap-1.5 text-muted">
                    <BedDouble size={13} aria-hidden />
                    {roomType.bedGroups[0].beds
                      .map((bed) => `${bed.quantity} × ${bed.name}`)
                      .join(" + ")}
                  </li>
                )}
              </ul>
            </div>
          </div>

          <ul className="divide-y divide-line border-t border-line">
            {roomType.offers.map((offer) => (
              <li key={offer.token}>
                <OfferRow
                  offer={offer}
                  locale={locale}
                  intlLocale={intlLocale}
                  t={t}
                  busy={holding !== null}
                  pending={holding === offer.token}
                  breakdownOpen={openBreakdown === offer.token}
                  onToggleBreakdown={() =>
                    setOpenBreakdown((current) => (current === offer.token ? null : offer.token))
                  }
                  onReserve={() => reserve(offer)}
                />
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

interface OfferRowProps {
  offer: Offer;
  locale: Parameters<typeof plural>[0];
  intlLocale: string;
  t: ReturnType<typeof useI18n>["t"];
  busy: boolean;
  pending: boolean;
  breakdownOpen: boolean;
  onToggleBreakdown: () => void;
  onReserve: () => void;
}

/** One rate plan: what it includes, what it costs, what cancelling costs. */
function OfferRow({
  offer,
  locale,
  intlLocale,
  t,
  busy,
  pending,
  breakdownOpen,
  onToggleBreakdown,
  onReserve,
}: OfferRowProps) {
  const { quote, terms } = offer;
  const { currency } = quote;
  const nights = quote.totals.nights;
  const perNight = Math.round(quote.totals.totalCents / Math.max(nights, 1));
  const refundable = terms.cancellation.refundable !== false && terms.cancellation.freeUntil;

  return (
    <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="min-w-0">
        <p className="type-body-sm font-medium text-ink">{offer.name}</p>

        <ul className="mt-3 space-y-1.5">
          {terms.mealPlan && (
            <li className="type-body-sm flex items-center gap-2 text-body">
              <Check size={15} className="shrink-0 text-success" aria-hidden />
              {terms.mealPlan.name}
            </li>
          )}

          <li className="type-body-sm flex items-start gap-2">
            {refundable ? (
              <>
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
                <span className="text-success">
                  {fill(t.booking.availability.freeUntil, {
                    date: formatInstant(terms.cancellation.freeUntil, intlLocale),
                  })}
                </span>
              </>
            ) : (
              <>
                <XCircle size={15} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
                <span className="text-muted">
                  {terms.cancellation.description ?? t.booking.availability.nonRefundable}
                </span>
              </>
            )}
          </li>

          {offer.occupancy.extraBedsNeeded > 0 && (
            <li className="type-caption text-muted">
              {fill(t.booking.availability.extraBeds, { count: offer.occupancy.extraBedsNeeded })}
            </li>
          )}
        </ul>

        {offer.availableUnits <= 3 && (
          <p className="type-caption mt-3 font-medium text-warning-text">
            {offer.availableUnits === 1
              ? t.booking.availability.lastRoom
              : fill(t.booking.availability.unitsLeft, { count: offer.availableUnits })}
          </p>
        )}

        <button
          type="button"
          onClick={onToggleBreakdown}
          aria-expanded={breakdownOpen}
          className="type-caption mt-3 inline-flex items-center gap-1 text-brand-text underline-offset-4 hover:underline"
        >
          {breakdownOpen
            ? t.booking.availability.hideBreakdown
            : t.booking.availability.showBreakdown}
          <ChevronDown
            size={13}
            className={cn("transition-transform", breakdownOpen && "rotate-180")}
            aria-hidden
          />
        </button>

        {breakdownOpen && (
          <dl className="mt-3 divide-y divide-line border-y border-line">
            {quote.nights.map((night) => (
              <div key={night.date} className="flex items-baseline justify-between gap-6 py-2">
                <dt className="type-caption text-muted">{formatNightDate(night.date, intlLocale)}</dt>
                <dd className="type-caption tabular-nums">
                  {formatMoney(night.sellCents, currency, intlLocale)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="flex flex-col justify-between gap-4 border-t border-line pt-4 lg:border-t-0 lg:border-s lg:pt-0 lg:ps-6">
        <div className="text-end">
          <p className="type-h3 tabular-nums">
            {formatMoney(quote.totals.totalCents, currency, intlLocale)}
          </p>
          <p className="type-caption text-muted">
            {fill(t.booking.availability.totalForStay, {
              nights: plural(locale, nights, t.units.night),
            })}
          </p>
          <p className="type-caption mt-1 text-subtle">
            {fill(t.booking.results.perNight, {
              price: formatMoney(perNight, currency, intlLocale),
            })}
          </p>
          {quote.totals.taxIncludedCents > 0 && (
            <p className="type-caption mt-1 text-subtle">{t.booking.availability.taxesIncluded}</p>
          )}
          {quote.totals.payableAtPropertyCents > 0 && (
            <p className="type-caption mt-1 text-warning-text">
              {fill(t.booking.availability.payAtProperty, {
                amount: formatMoney(quote.totals.payableAtPropertyCents, currency, intlLocale),
              })}
            </p>
          )}
        </div>

        <Button fullWidth onClick={onReserve} disabled={busy}>
          {pending ? t.booking.availability.holding : t.booking.availability.reserve}
        </Button>
      </div>
    </div>
  );
}
