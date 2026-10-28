import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { BookingActions } from "@/components/admin/BookingActions";
import { BookingApprovalPanel } from "@/components/admin/BookingApprovalPanel";
import { BookingDeadlinesPanel } from "@/components/admin/BookingDeadlinesPanel";
import { BookingDeskPanel } from "@/components/admin/BookingDeskPanel";
import { BookingPaymentPanel } from "@/components/admin/BookingPaymentPanel";
import { BookingRequests } from "@/components/admin/BookingRequests";
import { BookingStatusBadge } from "@/components/admin/StatusBadge";
import { Cell, DataTable, Row } from "@/components/admin/DataTable";
import { getAdminBooking } from "@/lib/api/bookings";
import { ApiError } from "@/lib/api/client";
import { bookingSourceLabel, formatInstant, formatStay, formatStayDate, guestTitleLabel } from "@/lib/admin/bookings";
import { formatMoney, formatBps } from "@/lib/money";
import { getI18n } from "@/lib/i18n/server";
import { quoteFromSchedule } from "@/lib/admin/cancellation";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Booking" };

/**
 * One booking.
 *
 * Almost everything here comes from the **snapshot** taken at confirmation, not
 * from the live hotel: the property may have been renamed, the room retired and
 * the cancellation policy tightened since, and none of that may change what
 * this guest was sold. The only live thing on the page is the status.
 *
 * Deliberately no `generateStaticParams`: a booking is private, changes on
 * cancellation, and is only ever read by a signed-in operator.
 */
export default async function AdminBookingPage({
  params,
}: PageProps<"/[locale]/admin/bookings/[id]">) {
  await requireScreen();
  const { id } = await params;
  const { path } = await getI18n();

  let booking;

  try {
    booking = await getAdminBooking(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const snapshot = booking.hotelSnapshot;
  // Read off the frozen schedule rather than asking the server again: the
  // windows travel with the booking precisely so this is arithmetic.
  const quote = quoteFromSchedule(booking);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Bookings", href: path("/admin/bookings") },
          { label: booking.reference },
        ]}
      />

      <AdminPageHeader
        title={booking.reference}
        description={`${snapshot.name} · ${formatStay(booking.checkIn, booking.checkOut, booking.nights)}`}
        actions={<BookingStatusBadge status={booking.status} />}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 flex flex-col gap-6 lg:col-span-2">
          <AdminPanel title="Stay">
            <AdminDefinitionList
              items={[
                { label: "Check in", value: formatStayDate(booking.checkIn) },
                { label: "Check out", value: formatStayDate(booking.checkOut) },
                { label: "Nights", value: String(booking.nights) },
                { label: "Rooms", value: String(booking.rooms) },
                {
                  label: "Property times",
                  value:
                    snapshot.checkIn.from || snapshot.checkOut.until
                      ? `In from ${snapshot.checkIn.from ?? "—"}, out by ${snapshot.checkOut.until ?? "—"}`
                      : "—",
                },
                { label: "Time zone", value: snapshot.timezone },
              ]}
            />
          </AdminPanel>

          {booking.bookingRooms.map((room, index) => (
            <AdminPanel
              key={room.id}
              title={booking.bookingRooms.length > 1 ? `Room ${index + 1}` : "Room"}
              description={`${room.roomTypeName} · ${room.ratePlanName}`}
            >
              <AdminDefinitionList
                items={[
                  { label: "Board", value: `${room.mealPlan.name} (${room.mealPlan.code})` },
                  { label: "Beds", value: room.bedConfiguration ?? "—" },
                  {
                    label: "Guests",
                    value: `${room.adults} ${room.adults === 1 ? "adult" : "adults"}${
                      room.childAges.length > 0
                        ? `, ${room.childAges.length} child (${room.childAges.join(", ")})`
                        : ""
                    }`,
                  },
                  {
                    label: "Free cancellation until",
                    value: room.cancellation.freeUntil
                      ? formatInstant(room.cancellation.freeUntil)
                      : "Non-refundable",
                  },
                ]}
              />

              <div className="mt-5">
                <h4 className="text-[0.75rem] font-semibold tracking-[0.1em] text-muted uppercase">
                  Nightly breakdown
                </h4>
                <div className="mt-2 rounded-sm border border-line">
                  <DataTable
                    columns={[
                      { label: "Night" },
                      ...(room.netSubtotalCents !== undefined
                        ? [{ label: "Cost", align: "end" as const }]
                        : []),
                      { label: "Price", align: "end" },
                    ]}
                    caption={`Nightly prices for ${room.roomTypeName}`}
                  >
                    {room.nights.map((night) => (
                      <Row key={night.date}>
                        <Cell>{formatStayDate(night.date)}</Cell>
                        {night.netCents !== undefined && (
                          <Cell align="end" className="tabular-nums text-muted">
                            {formatMoney(night.netCents, booking.currency)}
                          </Cell>
                        )}
                        <Cell align="end" className="tabular-nums">
                          {formatMoney(night.sellCents, booking.currency)}
                        </Cell>
                      </Row>
                    ))}
                  </DataTable>
                </div>
              </div>

              {room.guests.length > 0 && (
                <ul className="mt-5 flex flex-wrap gap-2">
                  {room.guests.map((guest, guestIndex) => (
                    <li
                      key={`${guest.firstName}-${guestIndex}`}
                      className="rounded-full bg-surface-soft px-3 py-1 text-[0.75rem] text-body"
                    >
                      {guestTitleLabel(guest.title)}
                      {guest.firstName} {guest.lastName}
                      {guest.isLead && <span className="text-muted"> · lead</span>}
                      {guest.age !== null && <span className="text-muted"> · age {guest.age}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </AdminPanel>
          ))}

          <AdminPanel
            title="Cancellation terms"
            description="Frozen at confirmation. A later change to the hotel's policy does not apply to this booking."
          >
            <div className="rounded-sm border border-line">
              <DataTable
                columns={[{ label: "From" }, { label: "Until" }, { label: "Charge", align: "end" }]}
                caption="Cancellation windows"
              >
                {booking.bookingRooms[0]?.cancellation.windows.map((window, index) => (
                  <Row key={index}>
                    <Cell>{window.fromAt ? formatInstant(window.fromAt) : "Booking made"}</Cell>
                    <Cell>{window.toAt ? formatInstant(window.toAt) : "After check-in"}</Cell>
                    <Cell align="end" className="tabular-nums">
                      {formatMoney(window.chargeCents, booking.currency)}
                    </Cell>
                  </Row>
                ))}
              </DataTable>
            </div>
          </AdminPanel>
        </div>

        <div className="flex flex-col gap-6">
          <AdminPanel title="Guest">
            <AdminDefinitionList
              items={[
                { label: "Name", value: booking.leadGuestName },
                {
                  label: "Email",
                  value: (
                    <a
                      href={`mailto:${booking.leadGuestEmail}`}
                      className="text-ink underline-offset-4 hover:underline"
                    >
                      {booking.leadGuestEmail}
                    </a>
                  ),
                },
                { label: "Phone", value: booking.leadGuestPhone ?? "—" },
                { label: "Notes", value: booking.specialRequests ?? "—" },
              ]}
            />
          </AdminPanel>

          {/* Structured requirements, each answered on its own. Renders nothing
              when the booking carries none, which is every booking made before
              they existed. */}
          <BookingRequests booking={booking} />

          <AdminPanel title="Money">
            <AdminDefinitionList
              items={[
                {
                  label: "Total",
                  value: formatMoney(booking.totalCents, booking.currency),
                },
                ...(booking.taxIncludedCents > 0
                  ? [
                      {
                        label: "Tax included",
                        value: formatMoney(booking.taxIncludedCents, booking.currency),
                      },
                    ]
                  : []),
                ...(booking.payableAtPropertyCents > 0
                  ? [
                      {
                        label: "Payable at property",
                        value: formatMoney(booking.payableAtPropertyCents, booking.currency),
                      },
                    ]
                  : []),
                // Absent, not null, for anyone without permission — so this
                // block simply does not render rather than showing blanks.
                ...(booking.netTotalCents !== undefined
                  ? [
                      {
                        label: "Supplier cost",
                        value: formatMoney(booking.netTotalCents, booking.currency),
                      },
                      {
                        label: "Margin",
                        value: `${formatMoney(booking.marginCents ?? 0, booking.currency)} · ${formatBps(booking.markupBps ?? 0)}`,
                      },
                    ]
                  : []),
                ...(booking.cancellationChargeCents !== null
                  ? [
                      {
                        label: "Cancellation charge",
                        value: formatMoney(booking.cancellationChargeCents, booking.currency),
                      },
                    ]
                  : []),
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Property as booked">
            <AdminDefinitionList
              items={[
                {
                  label: "Hotel",
                  value: (
                    <Link
                      href={path(`/admin/hotels/${snapshot.id}`)}
                      className="text-ink underline-offset-4 hover:underline"
                    >
                      {snapshot.name}
                    </Link>
                  ),
                },
                { label: "Address", value: snapshot.address ?? "—" },
                { label: "Phone", value: snapshot.phone ?? "—" },
                { label: "Stars", value: "★".repeat(snapshot.starRating) },
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Record">
            <AdminDefinitionList
              items={[
                { label: "Placed", value: formatInstant(booking.createdAt) },
                { label: "Confirmed", value: formatInstant(booking.confirmedAt) },
                ...(booking.cancelledAt
                  ? [{ label: "Cancelled", value: formatInstant(booking.cancelledAt) }]
                  : []),
                { label: "Source", value: bookingSourceLabel(booking.source) },
                ...(booking.partner
                  ? [{ label: "Booked by", value: booking.partner.name }]
                  : booking.desk?.customer
                    ? [{ label: "Booked for", value: booking.desk.customer.name }]
                    : [{ label: "Booked by", value: "Direct guest" }]),
              ]}
            />
          </AdminPanel>

          {/* The platform's own gate, before any supplier is asked. Renders
              nothing on a booking that never needed it. */}
          <BookingApprovalPanel
            product="HOTEL"
            reference={booking.reference}
            approval={booking.approval}
            partnerName={booking.partner?.name ?? null}
          />

          <BookingPaymentPanel payment={booking.payment} currency={booking.currency} />

          <BookingDeadlinesPanel
            product="HOTEL"
            reference={booking.reference}
            lastDate={booking.checkOut}
          />

          {/* The desk's fields: staff who may see the buyer only. */}
          <BookingDeskPanel product="HOTEL" reference={booking.reference} desk={booking.desk} currency={booking.currency} />

          <AdminPanel title="Actions">
            <BookingActions booking={booking} quote={quote} />
          </AdminPanel>
        </div>
      </div>
    </AdminContainer>
  );
}
