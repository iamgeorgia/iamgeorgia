import { CircleCheck, Clock } from "lucide-react";

import { BookingSteps } from "@/components/booking/BookingSteps";
import { PrintButton } from "@/components/booking/PrintButton";
import { TourBookingDetail } from "@/components/tours/TourBookingDetail";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { formatStayDate } from "@/lib/booking/stay";
import { getI18n } from "@/lib/i18n/server";
import type { TourBooking } from "@/types/tour";

/**
 * A tour booking, one step after it was made.
 *
 * Two headlines, because two things can have happened: an instant option is
 * booked, an on-request one is *requested* and the operator has two days to
 * answer. Telling a traveller they are booked when the guide has not yet said
 * yes is the one thing this page must never do.
 */
export async function TourConfirmationView({ booking }: { booking: TourBooking }) {
  const { t, intlLocale, fill, path } = await getI18n();
  const requested = booking.status === "PENDING";
  const steps = requested ? t.tours.confirmation.requestedSteps : t.tours.confirmation.whatNextSteps;

  const manageHref = path(
    `/booking/manage/${booking.reference}?email=${encodeURIComponent(booking.leadTravellerEmail)}`,
  );

  return (
    <Container className="pt-10 pb-24 lg:pb-32">
      <BookingSteps current="confirm" labels={t.tours.checkout.steps} />

      <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <span
          className={
            requested
              ? "flex size-14 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning-text"
              : "flex size-14 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"
          }
        >
          {requested ? <Clock size={26} aria-hidden /> : <CircleCheck size={26} aria-hidden />}
        </span>
        <div className="min-w-0">
          <h1 className="type-h1">
            {requested ? t.tours.confirmation.requestedTitle : t.tours.confirmation.title}
          </h1>
          <p className="type-body-lg mt-2 text-muted">
            {fill(requested ? t.tours.confirmation.requestedSubtitle : t.tours.confirmation.subtitle, {
              tour: booking.tourSnapshot.title,
              date: formatStayDate(booking.date, intlLocale),
            })}
          </p>
        </div>
      </div>

      <p className="type-body mt-6 text-body">
        {fill(t.tours.confirmation.emailedTo, { email: booking.leadTravellerEmail })}
      </p>
      <p className="type-caption mt-1.5 text-subtle">{t.tours.confirmation.referenceHint}</p>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="min-w-0 lg:col-span-8">
          <TourBookingDetail booking={booking} />
        </div>

        <aside className="lg:col-span-4">
          <div className="border border-line bg-surface p-6 shadow-card lg:sticky lg:top-36">
            <h2 className="type-h4">{t.tours.confirmation.whatNext}</h2>
            <ol className="mt-4 space-y-3">
              {([steps.one, steps.two, steps.three] as const).map((step, index) => (
                <li key={step} className="type-body-sm flex gap-3 text-body">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-[0.6875rem] font-semibold tabular-nums text-muted">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>

            <div className="mt-6 flex flex-col gap-3">
              <Button href={manageHref} fullWidth>
                {t.tours.confirmation.manageBooking}
              </Button>
              <PrintButton label={t.booking.confirmation.print} />
            </div>
          </div>
        </aside>
      </div>
    </Container>
  );
}
