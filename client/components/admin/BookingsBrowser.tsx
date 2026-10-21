"use client";

import Link from "next/link";
import { Clock } from "lucide-react";

import { BookingStatusBadge } from "./StatusBadge";
import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { PaymentCell, PaymentStatusBadge } from "./PaymentStatusBadge";
import { BookingFilters } from "./filters/BookingFilters";
import { Pager } from "./filters/Pager";
import { useFilterUrl } from "./filters/useFilterUrl";
import {
  BOOKING_STATUSES,
  bookingStatusHints,
  bookingStatusLabels,
  formatStay,
  formatStayDate,
} from "@/lib/admin/bookings";
import { formatMoney } from "@/lib/money";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { BookingSummary, HotelBookingStatus } from "@/types/booking";

/**
 * The hotel bookings register.
 *
 * Filters live in the URL, not in component state, so a filtered view is
 * shareable, survives a reload and carries into the browser's history. The
 * component never filters locally — it writes to the URL and lets the Server
 * Component above it re-render, which is the same pattern `PartnersBrowser`
 * established and the reason a hundred thousand bookings will not have to be
 * shipped to the browser to search them. The filter row itself is the shared
 * kit (`filters/BookingFilters`): only the statuses and the date column's
 * name are this register's own.
 */

const columns: Column[] = [
  { label: "Reference" },
  { label: "Guest" },
  { label: "Property", hideBelow: "lg" },
  { label: "Stay", hideBelow: "md" },
  { label: "Status" },
  { label: "Payment", hideBelow: "xl" },
  { label: "Total", align: "end" },
];

export function BookingsBrowser({
  data,
  total,
  page,
  totalPages,
  lockedStatuses,
  today,
  showPartner = true,
  showManager = true,
}: {
  data: BookingSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Set on a fixed queue, where the status filter is not the operator's to change. */
  lockedStatuses?: HotelBookingStatus[];
  /** `YYYY-MM-DD` from the server render. */
  today: string;
  showPartner?: boolean;
  showManager?: boolean;
}) {
  const localePath = useLocalePath();
  const url = useFilterUrl();

  return (
    <div>
      <BookingFilters
        url={url}
        statuses={lockedStatuses ? [] : BOOKING_STATUSES.map((value) => ({ value, label: bookingStatusLabels[value] }))}
        statusLabel={(status) => bookingStatusLabels[status as HotelBookingStatus] ?? status}
        statusHints={bookingStatusHints}
        dateLabel="Arriving"
        searchPlaceholder="Reference, guest name or email"
        searchLabel="Search bookings"
        today={today}
        showPartner={showPartner}
        showManager={showManager}
      />

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {total === 0
          ? "No bookings match these filters."
          : `${total} booking${total === 1 ? "" : "s"}`}
      </p>

      <div className={cn("mt-4 transition-opacity", url.pending && "opacity-60")}>
        {/* Desktop: a real table. Below lg the same rows render as cards. */}
        <div className="hidden rounded-sm border border-line bg-surface lg:block">
          <DataTable columns={columns} caption="Hotel bookings">
            {data.length === 0 ? (
              <EmptyRow colSpan={columns.length} message="Nothing to show." />
            ) : (
              data.map((booking) => (
                <Row key={booking.reference}>
                  <Cell>
                    <Link
                      href={localePath(`/admin/bookings/${booking.reference}`)}
                      className="font-medium text-ink underline-offset-4 hover:underline"
                    >
                      {booking.reference}
                    </Link>
                  </Cell>
                  <Cell>
                    {booking.leadGuestName}
                    {booking.partner && (
                      <span className="block text-[0.75rem] text-muted">{booking.partner.name}</span>
                    )}
                    {!booking.partner && booking.desk?.customer && (
                      <span className="block text-[0.75rem] text-muted">{booking.desk.customer.name}</span>
                    )}
                  </Cell>
                  <Cell hideBelow="lg">{booking.hotel.name}</Cell>
                  <Cell hideBelow="md">
                    {formatStay(booking.checkIn, booking.checkOut, booking.nights)}
                  </Cell>
                  <Cell>
                    <BookingStatusBadge status={booking.status} />
                    {/* Beside the status, never instead of it. The booking is
                        confirmed; it is a requirement that is outstanding, and
                        conflating the two would put a perfectly good
                        reservation in doubt. */}
                    {booking.requestsPending > 0 && (
                      <span className="ms-2 inline-flex items-center gap-1 text-[0.75rem] text-muted">
                        <Clock size={12} aria-hidden />
                        {booking.requestsPending}
                      </span>
                    )}
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
          {data.length === 0 && <li className="py-12 text-center text-muted">Nothing to show.</li>}
          {data.map((booking) => (
            <li key={booking.reference} className="rounded-sm border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={localePath(`/admin/bookings/${booking.reference}`)}
                  className="font-medium text-ink underline-offset-4 hover:underline"
                >
                  {booking.reference}
                </Link>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-2">
                    <BookingStatusBadge status={booking.status} />
                    {booking.requestsPending > 0 && (
                      <span className="inline-flex items-center gap-1 text-[0.75rem] text-muted">
                        <Clock size={12} aria-hidden />
                        {booking.requestsPending}
                      </span>
                    )}
                  </span>
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
