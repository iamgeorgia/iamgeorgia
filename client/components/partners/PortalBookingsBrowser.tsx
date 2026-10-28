"use client";

import Link from "next/link";

import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
import { PaymentCell, PaymentStatusBadge } from "@/components/admin/PaymentStatusBadge";
import { BookingStatusBadge } from "@/components/admin/StatusBadge";
import { BookingFilters } from "@/components/admin/filters/BookingFilters";
import { Pager } from "@/components/admin/filters/Pager";
import { useFilterUrl } from "@/components/admin/filters/useFilterUrl";
import {
  BOOKING_STATUSES,
  bookingStatusLabels,
  formatStay,
  formatStayDate,
} from "@/lib/admin/bookings";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { BookingSummary, HotelBookingStatus } from "@/types/booking";

/**
 * A partner's own hotel bookings.
 *
 * The same URL-driven filtering the admin register uses, through the same
 * filter kit, and for the same reason: nothing is filtered in the browser,
 * so a partner with four thousand bookings costs exactly what one with four
 * costs. A partner has no partner or manager filter — every row is theirs —
 * and the `product` tab survives a preset, since it is navigation.
 */

const columns: Column[] = [
  { label: "Reference" },
  { label: "Guest" },
  { label: "Property", hideBelow: "xl" },
  { label: "Stay" },
  { label: "Status" },
  { label: "Payment", hideBelow: "xl" },
  { label: "Total", align: "end" },
];

export function PortalBookingsBrowser({
  data,
  total,
  page,
  totalPages,
  today,
}: {
  data: BookingSummary[];
  total: number;
  page: number;
  totalPages: number;
  /** `YYYY-MM-DD` from the server render. */
  today: string;
}) {
  const path = useLocalePath();
  const url = useFilterUrl();

  return (
    <div>
      <BookingFilters
        url={url}
        statuses={BOOKING_STATUSES.map((value) => ({ value, label: bookingStatusLabels[value] }))}
        statusLabel={(status) => bookingStatusLabels[status as HotelBookingStatus] ?? status}
        dateLabel="Arriving"
        searchPlaceholder="Reference, guest name or email"
        searchLabel="Search your bookings"
        today={today}
        keep={["product"]}
      />

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {total === 0
          ? "No bookings match these filters."
          : `${total} booking${total === 1 ? "" : "s"}`}
      </p>

      <div className={cn("mt-4 transition-opacity", url.pending && "opacity-60")}>
        {/* Desktop: a real table. Below lg the same rows render as cards. */}
        <div className="hidden rounded-sm border border-line bg-surface lg:block">
          <DataTable columns={columns} caption="Your bookings">
            {data.length === 0 ? (
              <EmptyRow colSpan={columns.length} message="Nothing to show." />
            ) : (
              data.map((booking) => (
                <Row key={booking.reference}>
                  <Cell>
                    <Link
                      href={path(`/portal/bookings/${booking.reference}`)}
                      className="font-medium text-ink underline-offset-4 hover:underline"
                    >
                      {booking.reference}
                    </Link>
                  </Cell>
                  <Cell>{booking.leadGuestName}</Cell>
                  <Cell hideBelow="xl">{booking.hotel.name}</Cell>
                  <Cell>{formatStay(booking.checkIn, booking.checkOut, booking.nights)}</Cell>
                  <Cell>
                    <BookingStatusBadge status={booking.status} />
                  </Cell>
                  <Cell hideBelow="xl">
                    <PaymentCell payment={booking.payment} />
                  </Cell>
                  <Cell align="end" className="tabular-nums">
                    {formatMoney(booking.totalCents, booking.currency)}
                  </Cell>
                </Row>
              ))
            )}
          </DataTable>
        </div>

        <ul className="flex flex-col gap-3 lg:hidden">
          {data.length === 0 && (
            <li className="py-12 text-center text-[0.875rem] text-muted">Nothing to show.</li>
          )}
          {data.map((booking) => (
            <li key={booking.reference} className="rounded-sm border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={path(`/portal/bookings/${booking.reference}`)}
                  className="font-medium text-ink underline-offset-4 hover:underline"
                >
                  {booking.reference}
                </Link>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <BookingStatusBadge status={booking.status} />
                  <PaymentStatusBadge status={booking.payment.status} />
                </div>
              </div>
              <p className="mt-2 text-[0.875rem] text-body">{booking.leadGuestName}</p>
              <p className="text-[0.8125rem] text-muted">{booking.hotel.name}</p>
              <p className="mt-1 text-[0.8125rem] text-muted">
                {formatStayDate(booking.checkIn)} · {booking.nights}{" "}
                {booking.nights === 1 ? "night" : "nights"} · {booking.rooms}{" "}
                {booking.rooms === 1 ? "room" : "rooms"}
              </p>
              <p className="mt-2 font-medium text-ink tabular-nums">
                {formatMoney(booking.totalCents, booking.currency)}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={(next) => url.apply({ page: String(next) })} />
    </div>
  );
}
