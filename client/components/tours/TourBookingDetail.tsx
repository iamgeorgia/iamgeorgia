import { Clock, Mail, MapPin, Phone, ShieldCheck, Users, XCircle } from "lucide-react";

import { formatInstant, formatStayDate } from "@/lib/booking/stay";
import { plural } from "@/lib/i18n/plural";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import type { TourBooking, TourBookingStatus } from "@/types/tour";
import { cn } from "@/lib/utils";

interface TourBookingDetailProps {
  booking: TourBooking;
}

/**
 * A tour booking as the traveller's own record of it.
 *
 * Everything is read from the snapshot the server froze at confirmation, not
 * from the live tour: the option name, the meeting point, the cancellation
 * tiers and every figure. A voucher printed after the operator renamed the
 * option still describes what was sold.
 */
export async function TourBookingDetail({ booking }: TourBookingDetailProps) {
  const { t, locale, intlLocale, fill } = await getI18n();
  const { tourSnapshot: snapshot, currency } = booking;
  const multiDay = booking.endDate !== booking.date;
  const departureTime =
    snapshot.option?.departureTime ?? snapshot.option?.startTime ?? snapshot.meetingTime ?? null;

  const statusTone: Record<TourBookingStatus, string> = {
    PENDING_APPROVAL: "border-warning/40 bg-warning/10 text-warning-text",
    PENDING: "border-warning/40 bg-warning/10 text-warning-text",
    CONFIRMED: "border-success/40 bg-success/10 text-success",
    CANCELLED: "border-error/40 bg-error/10 text-error-text",
    COMPLETED: "border-line bg-surface-soft text-body",
    NO_SHOW: "border-line bg-surface-soft text-muted",
  };

  /*
   * The tiers worth listing are the ones that cost something *and* start
   * somewhere. A window that charges nothing is the free tier, already stated
   * above; an open-ended one with no `fromAt` is a non-refundable rate
   * expressed as a single all-time window.
   */
  const chargedWindows = booking.cancellation.windows.filter(
    (window) => window.chargeCents > 0 && window.fromAt !== null,
  );

  const party = [
    plural(locale, booking.adults, t.units.adult),
    booking.childAges.length > 0 ? plural(locale, booking.childAges.length, t.units.child) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-8">
      <section className="border border-line bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-5 border-b border-line p-6">
          <div className="min-w-0">
            <p className="type-caption text-muted">{t.tours.manage.reference}</p>
            <p className="type-h3 mt-1 tabular-nums">{booking.reference}</p>
            <p className="type-caption mt-2 text-subtle">
              {fill(t.tours.manage.bookedOn, { date: formatInstant(booking.createdAt, intlLocale) })}
            </p>
          </div>

          <span
            className={cn(
              "inline-flex items-center rounded-full border px-3 py-1 text-[0.6875rem] font-semibold tracking-[0.12em] uppercase",
              statusTone[booking.status],
            )}
          >
            {t.tours.status[booking.status]}
          </span>
        </div>

        {/* Where an on-request booking stands. A pending request is a normal
            state, so it is stated rather than coloured as a problem. */}
        {booking.status === "PENDING" && booking.requestDeadlineAt && (
          <p className="type-body-sm flex items-start gap-2 border-b border-line bg-warning/5 px-6 py-4 text-warning-text">
            <Clock size={15} className="mt-0.5 shrink-0" aria-hidden />
            {fill(t.tours.manage.awaiting, {
              date: formatInstant(booking.requestDeadlineAt, intlLocale),
            })}
          </p>
        )}
        {booking.declinedAt && (
          <p className="type-body-sm border-b border-line bg-error/5 px-6 py-4 text-error-text">
            {fill(t.tours.manage.declined, { reason: booking.declineReason ?? "—" })}
          </p>
        )}

        <div className="grid gap-6 p-6 sm:grid-cols-2">
          <div>
            <p className="type-caption text-muted">{t.tours.manage.tour}</p>
            <p className="type-body mt-1 font-medium text-ink">{snapshot.title}</p>
            {snapshot.location && (
              <p className="type-body-sm mt-2 flex items-start gap-2 text-muted">
                <MapPin size={14} className="mt-0.5 shrink-0" aria-hidden />
                {snapshot.location}
              </p>
            )}
            {booking.option && (
              <p className="type-caption mt-2 text-subtle">
                {t.tours.manage.option}: {booking.option.name}
              </p>
            )}
          </div>

          <div>
            <p className="type-caption text-muted">{t.tours.manage.departure}</p>
            <p className="type-body mt-1 font-medium text-ink">
              {formatStayDate(booking.date, intlLocale)}
              {multiDay && ` – ${formatStayDate(booking.endDate, intlLocale)}`}
            </p>
            <p className="type-body-sm mt-2 flex items-center gap-2 text-muted">
              <Users size={14} className="shrink-0" aria-hidden />
              {party}
            </p>
            {departureTime && (
              <p className="type-caption mt-2 text-subtle">
                {fill(t.tours.manage.meetingTime, { time: departureTime })}
              </p>
            )}
          </div>

          {snapshot.meetingPoint && (
            <div>
              <p className="type-caption text-muted">{t.tours.manage.meetingPoint}</p>
              <p className="type-body-sm mt-1 text-body">{snapshot.meetingPoint}</p>
            </div>
          )}

          <div>
            <p className="type-caption text-muted">{t.tours.manage.leadTraveller}</p>
            <p className="type-body-sm mt-1 text-ink">{booking.leadTravellerName}</p>
            <p className="type-body-sm mt-1.5 flex items-center gap-2 text-muted">
              <Mail size={14} className="shrink-0" aria-hidden />
              {booking.leadTravellerEmail}
            </p>
            {booking.leadTravellerPhone && (
              <p className="type-body-sm mt-1.5 flex items-center gap-2 text-muted">
                <Phone size={14} className="shrink-0" aria-hidden />
                {booking.leadTravellerPhone}
              </p>
            )}
          </div>

          {booking.pickupNote && (
            <div>
              <p className="type-caption text-muted">{t.tours.manage.pickupNote}</p>
              <p className="type-body-sm mt-1 text-body">{booking.pickupNote}</p>
            </div>
          )}

          <div>
            <p className="type-caption text-muted">{t.tours.manage.specialRequests}</p>
            <p className="type-body-sm mt-1 text-body">
              {booking.specialRequests ?? t.tours.manage.noRequests}
            </p>
          </div>
        </div>
      </section>

      {/* --- who is travelling ------------------------------------------- */}
      {booking.travellers.length > 0 && (
        <section className="border border-line bg-surface">
          <div className="border-b border-line px-6 py-4">
            <h2 className="type-h3">{t.tours.manage.travellers}</h2>
          </div>
          <ul className="divide-y divide-line">
            {booking.travellers.map((traveller) => (
              <li key={traveller.id} className="flex flex-wrap items-baseline justify-between gap-3 px-6 py-3.5">
                <span className="type-body-sm text-ink">
                  {traveller.firstName} {traveller.lastName}
                  <span className="type-caption ms-2 text-muted">
                    {t.tours.availability.lines[traveller.type]}
                    {traveller.age !== null && ` · ${traveller.age}`}
                    {traveller.nationality && ` · ${traveller.nationality}`}
                  </span>
                </span>
                {traveller.dietary && (
                  <span className="type-caption text-muted">{traveller.dietary}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- what was bought ---------------------------------------------- */}
      <section>
        <h2 className="type-h3">{t.tours.manage.priceTitle}</h2>

        <article className="mt-5 border border-line bg-surface p-5">
          <dl className="space-y-2.5">
            {booking.priceLines.map((line) => (
              <div key={line.travellerType} className="flex items-baseline justify-between gap-4">
                <dt className="type-body-sm text-muted">
                  {snapshot.option?.pricingBasis === "PER_GROUP"
                    ? t.tours.availability.lines.GROUP
                    : `${line.count} × ${t.tours.availability.lines[line.travellerType]}`}
                </dt>
                <dd className="type-body-sm tabular-nums">
                  {formatMoney(line.sellCents, currency, intlLocale)}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 border-t border-line pt-4">
            <p className="type-caption text-muted">{t.tours.manage.cancellationTerms}</p>

            <p className="type-body-sm mt-1.5 flex items-start gap-2">
              {booking.cancellation.freeUntil ? (
                <>
                  <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
                  <span className="text-success">
                    {fill(t.tours.manage.freeUntil, {
                      date: formatInstant(booking.cancellation.freeUntil, intlLocale),
                    })}
                  </span>
                </>
              ) : (
                <>
                  <XCircle size={15} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
                  <span className="text-muted">
                    {booking.cancellation.summary ?? t.tours.manage.nonRefundable}
                  </span>
                </>
              )}
            </p>

            {chargedWindows.length > 0 && (
              <ul className="mt-2 space-y-1">
                {chargedWindows.map((window, index) => (
                  <li key={index} className="type-caption text-muted">
                    {fill(t.tours.manage.thenCharge, {
                      date: formatInstant(window.fromAt, intlLocale),
                      amount: formatMoney(window.chargeCents, currency, intlLocale),
                    })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>
      </section>

      {/* --- money -------------------------------------------------------- */}
      <section className="border border-line bg-surface p-6">
        <dl className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="type-h4">{t.tours.manage.total}</dt>
            <dd className="type-h4 tabular-nums">
              {formatMoney(booking.totalCents, currency, intlLocale)}
            </dd>
          </div>

          {booking.cancellation.chargeCents !== null && (
            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3.5">
              <dt className="type-body-sm text-error-text">{t.tours.manage.cancellationCharge}</dt>
              <dd className="type-body-sm tabular-nums text-error-text">
                {formatMoney(booking.cancellation.chargeCents, currency, intlLocale)}
              </dd>
            </div>
          )}
        </dl>

        {booking.cancelledAt && (
          <p className="type-caption mt-4 text-error-text">
            {fill(t.tours.manage.cancelledOn, {
              date: formatInstant(booking.cancelledAt, intlLocale),
            })}
          </p>
        )}
      </section>
    </div>
  );
}
