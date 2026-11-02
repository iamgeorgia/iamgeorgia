import type { Metadata } from "next";
import { CircleCheck } from "lucide-react";

import { BookingDetail } from "@/components/booking/BookingDetail";
import { BookingSteps } from "@/components/booking/BookingSteps";
import { PaymentStatusPanel } from "@/components/booking/PaymentStatusPanel";
import { PrintButton } from "@/components/booking/PrintButton";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { OrderConfirmationView } from "@/components/packages/OrderConfirmationView";
import { TourConfirmationView } from "@/components/tours/TourConfirmationView";
import { getGuestBooking } from "@/lib/api/bookings";
import { ApiError } from "@/lib/api/client";
import { getGuestOrder } from "@/lib/api/orders";
import { getGuestTourBooking } from "@/lib/api/tours";
import { formatStayDate } from "@/lib/booking/stay";
import { getI18n } from "@/lib/i18n/server";
import type { Booking } from "@/types/booking";
import type { Order } from "@/types/order";
import type { TourBooking } from "@/types/tour";

/** A TUR reference is a tour booking: a separate record with its own page. */
const isTourReference = (reference: string) => reference.toUpperCase().startsWith("TUR-");

/** An ORD reference is a package order: four bookings under one roof. */
const isOrderReference = (reference: string) => reference.toUpperCase().startsWith("ORD-");

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();

  return {
    title: t.booking.confirmation.metaTitle,
    // One guest's record, reachable only with their email. Never indexed.
    robots: { index: false, follow: false },
  };
}

/**
 * A booking, one step after it was made.
 *
 * The email in the query is not decoration: references come from a sequence and
 * are trivially enumerable, so the reference alone is not a credential. The
 * server enforces that (`guestLookupSchema`); this page simply carries what the
 * confirmation just proved the visitor knows.
 */
const loadBooking = async (reference: string, email: string | null): Promise<Booking | null> => {
  if (!email) return null;

  try {
    return await getGuestBooking(reference, email);
  } catch (error) {
    // A mistyped reference and a reference belonging to someone else must look
    // identical from out here, or the difference becomes an enumeration oracle.
    if (error instanceof ApiError && [400, 403, 404].includes(error.status)) return null;
    throw error;
  }
};

const loadTourBooking = async (reference: string, email: string | null): Promise<TourBooking | null> => {
  if (!email) return null;

  try {
    return await getGuestTourBooking(reference, email);
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404].includes(error.status)) return null;
    throw error;
  }
};

const loadOrder = async (reference: string, email: string | null): Promise<Order | null> => {
  if (!email) return null;

  try {
    return await getGuestOrder(reference, email);
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404].includes(error.status)) return null;
    throw error;
  }
};

export default async function BookingConfirmationPage(
  props: PageProps<"/[locale]/booking/confirmation/[reference]">,
) {
  const { reference } = await props.params;
  const searchParams = await props.searchParams;
  const { t, intlLocale, fill, path } = await getI18n();

  const requested = searchParams.email;
  const email = (Array.isArray(requested) ? requested[0] : requested) ?? null;

  const notFoundView = (
    <Container className="py-20">
      <EmptyState
        iconName="searchX"
        title={t.booking.confirmation.notFoundTitle}
        description={t.booking.confirmation.notFoundBody}
        action={{ label: t.booking.manage.title, href: path("/booking/manage") }}
      />
    </Container>
  );

  if (isOrderReference(reference)) {
    const order = await loadOrder(reference, email);

    return order ? <OrderConfirmationView order={order} /> : notFoundView;
  }

  if (isTourReference(reference)) {
    const tourBooking = await loadTourBooking(reference, email);

    return tourBooking ? <TourConfirmationView booking={tourBooking} /> : notFoundView;
  }

  const booking = await loadBooking(reference, email);

  if (!booking) {
    return (
      <Container className="py-20">
        <EmptyState
          iconName="searchX"
          title={t.booking.confirmation.notFoundTitle}
          description={t.booking.confirmation.notFoundBody}
          action={{ label: t.booking.manage.title, href: path("/booking/manage") }}
        />
      </Container>
    );
  }

  const manageHref = path(
    `/booking/manage/${booking.reference}?email=${encodeURIComponent(booking.leadGuestEmail)}`,
  );

  return (
    <Container className="pt-10 pb-24 lg:pb-32">
      <BookingSteps current="confirm" />

      <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
          <CircleCheck size={26} aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="type-h1">{t.booking.confirmation.title}</h1>
          <p className="type-body-lg mt-2 text-muted">
            {fill(t.booking.confirmation.subtitle, {
              hotel: booking.hotelSnapshot.name,
              date: formatStayDate(booking.checkIn, intlLocale),
            })}
          </p>
        </div>
      </div>

      <p className="type-body mt-6 text-body">
        {fill(t.booking.confirmation.emailedTo, { email: booking.leadGuestEmail })}
      </p>
      <p className="type-caption mt-1.5 text-subtle">{t.booking.confirmation.referenceHint}</p>

      <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="min-w-0 lg:col-span-8">
          <PaymentStatusPanel
            payment={booking.payment}
            reference={booking.reference}
            email={booking.leadGuestEmail}
            currency={booking.currency}
            className="mb-8 border border-line bg-surface p-6"
          />
          <BookingDetail booking={booking} />
        </div>

        <aside className="lg:col-span-4">
          <div className="border border-line bg-surface p-6 shadow-card lg:sticky lg:top-36">
            <h2 className="type-h4">{t.booking.confirmation.whatNext}</h2>
            <ol className="mt-4 space-y-3">
              {(
                [
                  t.booking.confirmation.whatNextSteps.one,
                  t.booking.confirmation.whatNextSteps.two,
                  t.booking.confirmation.whatNextSteps.three,
                ] as const
              ).map((step, index) => (
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
                {t.booking.confirmation.manageBooking}
              </Button>
              <PrintButton label={t.booking.confirmation.print} />
            </div>
          </div>
        </aside>
      </div>
    </Container>
  );
}
