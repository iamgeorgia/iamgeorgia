"use client";

import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Globe2,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { createTourHold } from "@/lib/api/tours";
import { bookingErrorKey } from "@/lib/booking/errors";
import { newIdempotencyKey, saveTourCheckoutDraft } from "@/lib/booking/checkoutSession";
import { formatInstant, formatNightDate, formatStayDate } from "@/lib/booking/stay";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type { TourStay } from "@/lib/tours/query";
import type {
  TourAvailability,
  TourOfferAvailable,
  TourOfferUnavailable,
  TourOption,
} from "@/types/tour";
import { cn } from "@/lib/utils";
import { BookingErrorText } from "@/components/booking/BookingErrorText";

interface TourDeparturesProps {
  tour: { slug: string; title: string; durationLabel: string; durationDays: number };
  stay: TourStay;
  availability: TourAvailability;
}

/** "English, Georgian" in the reader's language, from ISO codes. */
const languageNames = (codes: string[], intlLocale: string): string => {
  try {
    const names = new Intl.DisplayNames([intlLocale], { type: "language" });

    return codes.map((code) => names.of(code) ?? code).join(", ");
  } catch {
    return codes.join(", ").toUpperCase();
  }
};

/**
 * Every option of a tour, priced for every departure in the window.
 *
 * Everything here came from `/api/search/tours/:slug` for the exact date,
 * window and party in the URL, so every figure is a real total for seats that
 * could be sold at the moment the page rendered. A date that exists but cannot
 * be sold is shown with its reason rather than left out: a calendar with a
 * sold-out Saturday on it is more useful than one with a gap.
 *
 * "Reserve" takes a hold before the traveller types a single character of
 * their name — the difference between losing a seat during checkout and
 * losing it during the search.
 */
export function TourDepartures({ tour, stay, availability }: TourDeparturesProps) {
  const router = useRouter();
  const path = useLocalePath();
  const { t, locale, intlLocale } = useI18n();

  /** The offer being held. Doubles as "a request is in flight". */
  const [holding, setHolding] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<keyof typeof t.booking.errors | null>(null);
  const [openBreakdown, setOpenBreakdown] = useState<string | null>(null);

  const reserve = async (option: TourOption, offer: TourOfferAvailable) => {
    setErrorKey(null);
    setHolding(offer.token);

    try {
      const hold = await createTourHold(offer.token);

      // The summary on the next page wants the price lines and the terms;
      // only the hold token itself can travel in the URL.
      saveTourCheckoutDraft({
        holdToken: hold.token,
        hold,
        offer,
        option: {
          id: option.id,
          code: option.code,
          name: option.name,
          kind: option.kind,
          pricingBasis: option.pricingBasis,
          confirmationMode: option.confirmationMode,
        },
        tourSlug: tour.slug,
        tourTitle: tour.title,
        durationLabel: tour.durationLabel,
        stay,
        idempotencyKey: newIdempotencyKey(),
      });

      router.push(path(`/tours/checkout?hold=${encodeURIComponent(hold.token)}`));
    } catch (error) {
      // The seats went, or moved price, between rendering and clicking. Both
      // are ordinary on a popular departure and neither loses anything typed.
      setErrorKey(bookingErrorKey(error));
      setHolding(null);
      router.refresh();
    }
  };

  const party = [
    plural(locale, stay.adults, t.units.adult),
    stay.childAges.length > 0 ? plural(locale, stay.childAges.length, t.units.child) : null,
  ]
    .filter(Boolean)
    .join(" · ");

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

      {availability.options.map(({ option, dates }) => {
        const cancellation = option.cancellation;
        const sellable = dates.filter((offer) => offer.available);

        return (
          <article key={option.id} className="border border-line bg-surface">
            <div className="p-5">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="type-h4">{option.name}</h3>
                <Badge tone={option.kind === "PRIVATE" ? "brand" : "neutral"}>
                  {t.tours.optionKinds[option.kind]}
                </Badge>
              </div>

              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                <li className="type-caption flex items-center gap-1.5 text-muted">
                  <Users size={13} aria-hidden />
                  {option.minPax === option.maxPax
                    ? option.maxPax
                    : `${option.minPax}–${option.maxPax}`}{" "}
                  {plural(locale, option.maxPax, t.units.traveller)}
                </li>
                {option.startTime && (
                  <li className="type-caption flex items-center gap-1.5 text-muted">
                    <Clock size={13} aria-hidden />
                    {fill(t.tours.availability.startsAt, { time: option.startTime })}
                  </li>
                )}
                {option.languages.length > 0 && (
                  <li className="type-caption flex items-center gap-1.5 text-muted">
                    <Globe2 size={13} aria-hidden />
                    {fill(t.tours.availability.languages, {
                      languages: languageNames(option.languages, intlLocale),
                    })}
                  </li>
                )}
                <li className="type-caption flex items-center gap-1.5 text-muted">
                  <CheckCircle2
                    size={13}
                    className={option.confirmationMode === "INSTANT" ? "text-success" : "text-warning-text"}
                    aria-hidden
                  />
                  {option.confirmationMode === "INSTANT"
                    ? t.tours.availability.instant
                    : t.tours.availability.onRequest}
                </li>
              </ul>

              {cancellation?.description && (
                <p className="type-caption mt-3 text-muted">{cancellation.description}</p>
              )}
            </div>

            {dates.length === 0 ? (
              <p className="type-body-sm border-t border-line px-5 py-4 text-muted">
                {t.tours.availability.emptyBody}
              </p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {dates.map((offer) => (
                  <li key={offer.date}>
                    {offer.available ? (
                      <AvailableRow
                        option={option}
                        offer={offer}
                        multiDay={tour.durationDays > 1}
                        party={party}
                        busy={holding !== null}
                        pending={holding === offer.token}
                        breakdownOpen={openBreakdown === offer.token}
                        onToggleBreakdown={() =>
                          setOpenBreakdown((current) =>
                            current === offer.token ? null : offer.token,
                          )
                        }
                        onReserve={() => reserve(option, offer)}
                      />
                    ) : (
                      <UnavailableRow offer={offer} />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {dates.length > 0 && sellable.length === 0 && (
              <p className="type-caption border-t border-line px-5 py-3 text-muted">
                {t.tours.availability.emptyBody}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

interface AvailableRowProps {
  option: TourOption;
  offer: TourOfferAvailable;
  multiDay: boolean;
  party: string;
  busy: boolean;
  pending: boolean;
  breakdownOpen: boolean;
  onToggleBreakdown: () => void;
  onReserve: () => void;
}

/** One departure that can be sold: the date, what it costs, and Reserve. */
function AvailableRow({
  option,
  offer,
  multiDay,
  party,
  busy,
  pending,
  breakdownOpen,
  onToggleBreakdown,
  onReserve,
}: AvailableRowProps) {
  const { t, locale, intlLocale } = useI18n();
  const { quote } = offer;
  const { currency } = quote;
  const adultLine = quote.lines.find((line) => line.travellerType === "ADULT");
  const perPerson = option.pricingBasis === "PER_PERSON" && adultLine ? adultLine.unitSellCents : null;
  const freeUntil = offer.cancellation.freeUntil;
  const scarce = option.unitKind === "SEAT" ? offer.availableUnits <= 4 : offer.availableUnits <= 1;

  return (
    // Side by side only from `xl`: on a tour page this row sits in seven
    // twelfths of the layout, and at 1024px a 15rem price column left the
    // departure details about 220px.
    <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="min-w-0">
        <p className="type-body-sm font-medium text-ink">
          {formatNightDate(offer.date, intlLocale)}
          {multiDay && ` – ${formatStayDate(offer.endDate, intlLocale)}`}
          {offer.departureTime && (
            <span className="type-caption ms-2 font-normal text-muted">
              {fill(t.tours.availability.startsAt, { time: offer.departureTime })}
            </span>
          )}
        </p>

        <p className="type-body-sm mt-2 flex items-start gap-2">
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

        {scarce && (
          <p className="type-caption mt-2 font-medium text-warning-text">
            {option.unitKind === "SEAT"
              ? offer.availableUnits === 1
                ? t.tours.availability.lastSeat
                : fill(t.tours.availability.seatsLeft, {
                    count: plural(locale, offer.availableUnits, t.units.seat),
                  })
              : fill(t.tours.availability.groupsLeft, { count: offer.availableUnits })}
          </p>
        )}

        <button
          type="button"
          onClick={onToggleBreakdown}
          aria-expanded={breakdownOpen}
          className="type-caption mt-2 inline-flex items-center gap-1 text-brand-text underline-offset-4 hover:underline"
        >
          {breakdownOpen ? t.tours.availability.hideBreakdown : t.tours.availability.showBreakdown}
          <ChevronDown
            size={13}
            className={cn("transition-transform", breakdownOpen && "rotate-180")}
            aria-hidden
          />
        </button>

        {breakdownOpen && (
          <dl className="mt-3 divide-y divide-line border-y border-line">
            {quote.lines.map((line) => (
              <div
                key={line.travellerType}
                className="flex items-baseline justify-between gap-6 py-2"
              >
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
          </dl>
        )}
      </div>

      <div className="flex flex-col justify-between gap-4 border-t border-line pt-4 xl:border-t-0 xl:border-s xl:pt-0 xl:ps-6">
        <div className="text-end">
          <p className="type-h3 tabular-nums">
            {formatMoney(quote.totals.totalCents, currency, intlLocale)}
          </p>
          <p className="type-caption text-muted">
            {fill(t.tours.availability.totalFor, { party })}
          </p>
          <p className="type-caption mt-1 text-subtle">
            {perPerson !== null
              ? fill(t.tours.availability.perPerson, {
                  price: formatMoney(perPerson, currency, intlLocale),
                })
              : t.tours.availability.wholeGroup}
          </p>
        </div>

        <Button fullWidth onClick={onReserve} disabled={busy}>
          {pending ? t.tours.availability.holding : t.tours.availability.reserve}
        </Button>
      </div>
    </div>
  );
}

/** A departure that exists but cannot be sold to this party, and why. */
function UnavailableRow({ offer }: { offer: TourOfferUnavailable }) {
  const { t, intlLocale } = useI18n();

  const hint = (): string => {
    switch (offer.reason) {
      case "PARTY_SIZE":
        return fill(t.tours.availability.reasonHints.PARTY_SIZE, {
          min: offer.minPax ?? 1,
          max: offer.maxPax ?? "—",
        });
      case "TOO_SOON":
        return fill(t.tours.availability.reasonHints.TOO_SOON, { hours: offer.noticeHours ?? 24 });
      case "BEYOND_HORIZON":
        return fill(t.tours.availability.reasonHints.BEYOND_HORIZON, {
          date: offer.bookableUntil ? formatStayDate(offer.bookableUntil, intlLocale) : "—",
        });
      default:
        return t.tours.availability.reasonHints[offer.reason];
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
      <p className="type-body-sm text-muted">
        {formatNightDate(offer.date, intlLocale)}
        {offer.departureTime && (
          <span className="type-caption ms-2 text-subtle">
            {fill(t.tours.availability.startsAt, { time: offer.departureTime })}
          </span>
        )}
      </p>
      <p className="type-caption flex items-center gap-2 text-muted">
        <span className="rounded-full border border-line px-2.5 py-0.5 font-medium text-body">
          {t.tours.availability.reasons[offer.reason]}
        </span>
        <span className="hidden sm:inline">{hint()}</span>
      </p>
    </div>
  );
}
