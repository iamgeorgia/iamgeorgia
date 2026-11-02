import { PrintButton } from "@/components/booking/PrintButton";
import { CancelTourBooking } from "@/components/tours/CancelTourBooking";
import { PaymentStatusPanel } from "@/components/booking/PaymentStatusPanel";
import { TourBookingDetail } from "@/components/tours/TourBookingDetail";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { getTourCancellationQuote } from "@/lib/api/tours";
import { getI18n } from "@/lib/i18n/server";
import type { TourBooking, TourCancellationQuote } from "@/types/tour";

/**
 * A guest's own tour booking: what they bought, and the one action they can
 * take on it. The cancellation quote is priced by the server off the schedule
 * frozen onto the booking; a booking already cancelled or completed has none.
 */
export async function TourManageView({ booking, email }: { booking: TourBooking; email: string }) {
  const { t, path } = await getI18n();

  let quote: TourCancellationQuote | null = null;

  if (booking.status === "CONFIRMED" || booking.status === "PENDING") {
    try {
      quote = await getTourCancellationQuote(booking.reference, email);
    } catch {
      quote = null;
    }
  }

  return (
    <Container className="pt-8 pb-24 lg:pb-32">
      <Breadcrumbs
        items={[
          { label: t.common.home, href: path("/") },
          { label: t.booking.manage.crumb, href: path("/booking/manage") },
          { label: booking.reference },
        ]}
      />

      <h1 className="type-h1 mt-6">{t.booking.manage.metaTitle}</h1>

      <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="min-w-0 lg:col-span-8">
          <PaymentStatusPanel
            payment={booking.payment}
            reference={booking.reference}
            email={email}
            currency={booking.currency}
            className="mb-8 border border-line bg-surface p-6"
          />
          <TourBookingDetail booking={booking} />
        </div>

        <aside className="lg:col-span-4">
          <div className="flex flex-col gap-5 lg:sticky lg:top-36">
            <CancelTourBooking
              reference={booking.reference}
              email={email}
              status={booking.status}
              quote={quote}
              freeUntil={booking.cancellation.freeUntil}
            />
            <PrintButton label={t.booking.confirmation.print} />
          </div>
        </aside>
      </div>
    </Container>
  );
}
