import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { BookingDetail } from "@/components/booking/BookingDetail";
import { CancelBooking } from "@/components/booking/CancelBooking";
import { PrintButton } from "@/components/booking/PrintButton";
import { OrderManageView } from "@/components/packages/OrderManageView";
import { PortalBookingEditor } from "@/components/partners/PortalBookingEditor";
import { PortalTourBookingEditor } from "@/components/partners/PortalTourBookingEditor";
import { PortalTransferBooking } from "@/components/partners/PortalTransferBooking";
import { CancelTourBooking } from "@/components/tours/CancelTourBooking";
import { TourBookingDetail } from "@/components/tours/TourBookingDetail";
import { getPartnerOrder } from "@/lib/api/orders";
import { getPartnerTourBooking, getTourCancellationQuote } from "@/lib/api/tours";
import { getPartnerTransferBooking } from "@/lib/api/transfers";
import { Container } from "@/components/ui/Container";
import { getCancellationQuote, getPartnerBooking } from "@/lib/api/bookings";
import { ApiError } from "@/lib/api/client";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { homePathFor } from "@/types/auth";
import type { Booking, CancellationQuote } from "@/types/booking";
import type { Order } from "@/types/order";
import type { TourBooking, TourCancellationQuote } from "@/types/tour";
import type { TransferBooking } from "@/types/transfer";

export async function generateMetadata(
  props: PageProps<"/[locale]/portal/bookings/[reference]">,
): Promise<Metadata> {
  const { reference } = await props.params;

  // One company's commercial record. Never indexed, like the rest of the B2B
  // surface.
  return { title: reference, robots: { index: false, follow: false } };
}

/**
 * One booking, and the two things a partner may do to it.
 *
 * The record itself is the same component the guest sees, because it *is* the
 * same record — everything on it was frozen at confirmation, so a partner and
 * their traveller are never reading two different accounts of what was sold.
 *
 * The two actions are deliberately unequal in weight. Amending corrects the
 * paperwork and changes nothing about the sale; cancelling releases the rooms
 * and may cost money, so it sits apart with its price stated before the button.
 * Moving dates is neither — it is a cancellation and a new booking, and the
 * editor says so rather than leaving a partner hunting for a date field.
 */
export default async function PortalBookingPage(
  props: PageProps<"/[locale]/portal/bookings/[reference]">,
) {
  const session = await getSession();
  const locale = await getLocale();
  const { t, path } = await getI18n();

  if (!session) redirect(localePath(locale, "/portal/sign-in"));

  if (!session.partner) {
    redirect(localePath(locale, homePathFor(session)));
  }

  if (session.partner.status !== "APPROVED") {
    redirect(localePath(locale, "/portal"));
  }

  const { reference } = await props.params;

  // A TRF reference is a transfer, a separate record with its own screen:
  // the journey as sold, each leg's progress, and the driver once accepted.
  if (reference.toUpperCase().startsWith("TRF-")) {
    let transfer: TransferBooking;

    try {
      transfer = await getPartnerTransferBooking(reference);
    } catch (error) {
      if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
      throw error;
    }

    return (
      <Container className="py-12 sm:py-16">
        <Link
          href={path("/portal/bookings")}
          className="inline-flex items-center gap-2 text-[0.8125rem] text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={15} className="rtl:-scale-x-100" aria-hidden />
          All bookings
        </Link>
        <h1 className="mt-5 font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">
          {transfer.route.fromName} → {transfer.route.toName}
        </h1>
        <p className="mt-2 font-mono text-[0.8125rem] tracking-wide text-brand-text">{transfer.reference}</p>
        <div className="mt-10 max-w-3xl">
          <PortalTransferBooking booking={transfer} driverPath={(id) => path(`/portal/drivers/${id}`)} />
        </div>
      </Container>
    );
  }

  // A TUR reference is a tour booking: the same frozen record the traveller
  // sees, the paperwork editor, and cancellation priced off the frozen terms.
  if (reference.toUpperCase().startsWith("TUR-")) {
    let tour: TourBooking;

    try {
      tour = await getPartnerTourBooking(reference);
    } catch (error) {
      if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
      throw error;
    }

    let tourQuote: TourCancellationQuote | null = null;

    if (tour.status === "CONFIRMED" || tour.status === "PENDING") {
      try {
        tourQuote = await getTourCancellationQuote(reference);
      } catch {
        tourQuote = null;
      }
    }

    return (
      <Container className="py-12 sm:py-16">
        <Link
          href={path("/portal/bookings?product=tours")}
          className="inline-flex items-center gap-2 text-[0.8125rem] text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={15} className="rtl:-scale-x-100" aria-hidden />
          All bookings
        </Link>
        <h1 className="mt-5 font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">
          {tour.tourSnapshot.title}
        </h1>
        <p className="mt-2 font-mono text-[0.8125rem] tracking-wide text-brand-text">{tour.reference}</p>

        <div className="mt-10 grid gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="min-w-0 lg:col-span-8">
            <TourBookingDetail booking={tour} />
            <div className="mt-8">
              <PortalTourBookingEditor booking={tour} />
            </div>
          </div>

          <aside className="min-w-0 lg:col-span-4">
            <div className="flex flex-col gap-5 lg:sticky lg:top-8">
              <CancelTourBooking
                reference={tour.reference}
                status={tour.status}
                quote={tourQuote}
                freeUntil={tour.cancellation.freeUntil}
              />
              <PrintButton label={t.booking.confirmation.print} />
            </div>
          </aside>
        </div>
      </Container>
    );
  }

  // An ORD reference is the whole trip: the hotel, the transfer, the tour and
  // the service booked as one. The children have their own references and
  // their own pages, but they are only cancellable through the order, so this
  // renders the same view the buyer gets rather than a portal-only variant.
  if (reference.toUpperCase().startsWith("ORD-")) {
    let order: Order;

    try {
      order = await getPartnerOrder(reference);
    } catch (error) {
      if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
      throw error;
    }

    // No email: the session proves whose trip this is, and the server stops
    // looking at the address for a partner. The base path carries the tab so
    // the trail returns to the register the partner came from.
    return <OrderManageView order={order} basePath="/portal/bookings?product=orders" />;
  }

  let booking: Booking;

  try {
    booking = await getPartnerBooking(reference);
  } catch (error) {
    // A reference belonging to another company answers 404, not 403, so a
    // partner cannot probe the sequence for what exists. Rendering the same
    // not-found page keeps that promise on this side too.
    if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
    throw error;
  }

  /**
   * What cancelling would cost right now, read off the schedule frozen onto the
   * booking. A booking already cancelled or finished has no quote, and that is
   * not an error.
   */
  let quote: CancellationQuote | null = null;

  if (booking.status === "CONFIRMED" || booking.status === "PENDING") {
    try {
      quote = await getCancellationQuote(reference);
    } catch {
      quote = null;
    }
  }

  // The friendliest deadline across the rooms still standing — what a partner
  // is actually watching when they ask how long they can decide for.
  const freeUntil =
    booking.bookingRooms
      .filter((room) => room.status === "CONFIRMED")
      .map((room) => room.cancellation.freeUntil)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;

  return (
    <Container className="py-12 sm:py-16">
      <Link
        href={path("/portal/bookings")}
        className="inline-flex items-center gap-2 text-[0.8125rem] text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft size={15} className="rtl:-scale-x-100" aria-hidden />
        All bookings
      </Link>

      <h1 className="mt-5 font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">
        {booking.hotel.name}
      </h1>
      <p className="mt-2 font-mono text-[0.8125rem] tracking-wide text-brand-text">
        {booking.reference}
      </p>

      <div className="mt-10 grid gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="min-w-0 lg:col-span-8">
          <BookingDetail booking={booking} />

          <div className="mt-8">
            <PortalBookingEditor booking={booking} />
          </div>
        </div>

        <aside className="min-w-0 lg:col-span-4">
          <div className="flex flex-col gap-5 lg:sticky lg:top-8">
            {/* No email: the session already proves whose booking this is, and
                the server stops looking at the address entirely for a partner. */}
            <CancelBooking
              reference={booking.reference}
              status={booking.status}
              quote={quote}
              freeUntil={freeUntil}
            />
            <PrintButton label={t.booking.confirmation.print} />
          </div>
        </aside>
      </div>
    </Container>
  );
}
