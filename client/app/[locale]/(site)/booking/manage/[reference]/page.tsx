import type { Metadata } from "next";

import { BookingDetail } from "@/components/booking/BookingDetail";
import { BookingLookupForm } from "@/components/booking/BookingLookupForm";
import { CancelBooking } from "@/components/booking/CancelBooking";
import { PrintButton } from "@/components/booking/PrintButton";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { OrderManageView } from "@/components/packages/OrderManageView";
import { TourManageView } from "@/components/tours/TourManageView";
import { getCancellationQuote, getGuestBooking } from "@/lib/api/bookings";
import { ApiError } from "@/lib/api/client";
import { getGuestOrder } from "@/lib/api/orders";
import { getGuestTourBooking } from "@/lib/api/tours";
import { getI18n } from "@/lib/i18n/server";
import type { Booking, CancellationQuote } from "@/types/booking";
import type { Order } from "@/types/order";
import type { TourBooking } from "@/types/tour";

/** A TUR reference is a tour booking: a separate record with its own page. */
const isTourReference = (reference: string) => reference.toUpperCase().startsWith("TUR-");

/** An ORD reference is a package order: four bookings under one roof. */
const isOrderReference = (reference: string) => reference.toUpperCase().startsWith("ORD-");

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();

  return {
    title: t.booking.manage.metaTitle,
    // One guest's record, reachable only with their email. Never indexed.
    robots: { index: false, follow: false },
  };
}

/** Null for anything the caller is not entitled to see, without saying which. */
const loadBooking = async (reference: string, email: string | null): Promise<Booking | null> => {
  if (!email) return null;

  try {
    return await getGuestBooking(reference, email);
  } catch (error) {
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

/**
 * What cancelling would cost right now.
 *
 * Priced by the server off the schedule frozen onto the booking. A booking
 * already cancelled or completed has no quote, and that is not an error.
 */
const loadQuote = async (
  reference: string,
  email: string,
): Promise<CancellationQuote | null> => {
  try {
    return await getCancellationQuote(reference, email);
  } catch {
    return null;
  }
};

/**
 * A guest's own booking: what they bought, and the one action they can take on
 * it. Everything shown is the snapshot taken at confirmation, so the record
 * does not drift as the property edits its listing.
 */
export default async function ManageBookingPage(
  props: PageProps<"/[locale]/booking/manage/[reference]">,
) {
  const { reference } = await props.params;
  const searchParams = await props.searchParams;
  const { t, path } = await getI18n();

  const requested = searchParams.email;
  const email = (Array.isArray(requested) ? requested[0] : requested) ?? null;

  const tour = isTourReference(reference);
  const order = isOrderReference(reference);
  const [booking, tourBooking, orderRecord] = await Promise.all([
    tour || order ? null : loadBooking(reference, email),
    tour ? loadTourBooking(reference, email) : null,
    order ? loadOrder(reference, email) : null,
  ]);

  if (orderRecord && email) {
    return <OrderManageView order={orderRecord} email={email} />;
  }

  if (tourBooking && email) {
    return <TourManageView booking={tourBooking} email={email} />;
  }

  if (!booking || !email) {
    return (
      <Container className="pt-8 pb-24 lg:pb-32">
        <Breadcrumbs
          items={[
            { label: t.common.home, href: path("/") },
            { label: t.booking.manage.crumb, href: path("/booking/manage") },
          ]}
        />
        <h1 className="type-h1 mt-6">{t.booking.manage.notFoundTitle}</h1>
        <div className="mt-8">
          <BookingLookupForm reference={reference} email={email ?? ""} notFound />
        </div>
      </Container>
    );
  }

  const quote =
    booking.status === "CONFIRMED" || booking.status === "PENDING"
      ? await loadQuote(reference, email)
      : null;

  // The friendliest deadline across the rooms still standing — what the guest
  // is actually watching when they ask "how long can I decide for".
  const freeUntil = booking.bookingRooms
    .filter((room) => room.status === "CONFIRMED")
    .map((room) => room.cancellation.freeUntil)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;

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

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="min-w-0 lg:col-span-8">
          <BookingDetail booking={booking} />
        </div>

        <aside className="lg:col-span-4">
          <div className="flex flex-col gap-5 lg:sticky lg:top-36">
            <CancelBooking
              reference={booking.reference}
              email={email}
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
