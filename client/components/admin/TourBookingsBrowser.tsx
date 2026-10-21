"use client";

import Link from "next/link";
import { Clock } from "lucide-react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { PaymentCell, PaymentStatusBadge } from "./PaymentStatusBadge";
import { TourBookingStatusBadge } from "./StatusBadge";
import { BookingFilters } from "./filters/BookingFilters";
import { Pager } from "./filters/Pager";
import { useFilterUrl } from "./filters/useFilterUrl";
import { formatInstant } from "@/lib/admin/bookings";
import { TOUR_BOOKING_STATUSES, formatDeparture, tourBookingStatusLabels } from "@/lib/admin/tours";
import { formatMoney } from "@/lib/money";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { TourBookingStatus, TourBookingSummary } from "@/types/tour";

/**
 * The tour booking register — shared by the admin queue and the partner
 * portal, which differ in where a row links to and in which filters are
 * theirs to use (a partner cannot filter by partner or by manager).
 *
 * Filters live in the URL, and nothing is filtered locally. An on-request
 * booking shows its deadline under the reference: that is the number an
 * operator is racing.
 */

const columns: Column[] = [
  { label: "Reference" },
  { label: "Traveller" },
  { label: "Tour", hideBelow: "lg" },
  { label: "Departure", hideBelow: "md" },
  { label: "Status" },
  { label: "Payment", hideBelow: "xl" },
  { label: "Total", align: "end" },
];

export function TourBookingsBrowser({
  data,
  total,
  page,
  totalPages,
  basePath,
  caption = "Tour bookings",
  today,
  showPartner = false,
  showManager = false,
  keep = [],
}: {
  data: TourBookingSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Where a reference links: the admin detail or the portal page. */
  basePath: string;
  caption?: string;
  /** `YYYY-MM-DD` from the server render. */
  today: string;
  showPartner?: boolean;
  showManager?: boolean;
  /** URL keys that are navigation rather than filters: the portal's `product` tab. */
  keep?: readonly string[];
}) {
  const localePath = useLocalePath();
  const url = useFilterUrl();

  return (
    <div>
      <BookingFilters
        url={url}
        statuses={TOUR_BOOKING_STATUSES.map((value) => ({ value, label: tourBookingStatusLabels[value] }))}
        statusLabel={(status) => tourBookingStatusLabels[status as TourBookingStatus] ?? status}
        dateLabel="Departing"
        searchPlaceholder="Reference, traveller name or email"
        searchLabel="Search tour bookings"
        today={today}
        showPartner={showPartner}
        showManager={showManager}
        keep={keep}
      />

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {total === 0 ? "No bookings match these filters." : `${total} booking${total === 1 ? "" : "s"}`}
      </p>

      <div className={cn("mt-4 transition-opacity", url.pending && "opacity-60")}>
        <div className="hidden rounded-sm border border-line bg-surface lg:block">
          <DataTable columns={columns} caption={caption}>
            {data.length === 0 ? (
              <EmptyRow colSpan={columns.length} message="Nothing to show." />
            ) : (
              data.map((booking) => (
                <Row key={booking.reference}>
                  <Cell>
                    <Link
                      href={localePath(`${basePath}/${booking.reference}`)}
                      className="font-medium text-ink underline-offset-4 hover:underline"
                    >
                      {booking.reference}
                    </Link>
                    {booking.status === "PENDING" && booking.requestDeadlineAt && (
                      <span className="mt-0.5 flex items-center gap-1 text-[0.75rem] text-warning-text">
                        <Clock size={11} aria-hidden />
                        by {formatInstant(booking.requestDeadlineAt)}
                      </span>
                    )}
                  </Cell>
                  <Cell>
                    {booking.leadTravellerName}
                    {booking.partner && (
                      <span className="block text-[0.75rem] text-muted">{booking.partner.name}</span>
                    )}
                    {!booking.partner && booking.desk?.customer && (
                      <span className="block text-[0.75rem] text-muted">{booking.desk.customer.name}</span>
                    )}
                  </Cell>
                  <Cell hideBelow="lg">
                    {booking.tour.title ?? "—"}
                    {booking.option && <span className="block text-[0.75rem] text-muted">{booking.option.name}</span>}
                  </Cell>
                  <Cell hideBelow="md">{formatDeparture(booking.date, booking.endDate)}</Cell>
                  <Cell>
                    <TourBookingStatusBadge status={booking.status} />
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
          {data.length === 0 && <li className="py-12 text-center text-[0.875rem] text-muted">Nothing to show.</li>}
          {data.map((booking) => (
            <li key={booking.reference} className="rounded-sm border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={localePath(`${basePath}/${booking.reference}`)}
                  className="font-medium text-ink underline-offset-4 hover:underline"
                >
                  {booking.reference}
                </Link>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <TourBookingStatusBadge status={booking.status} />
                  <PaymentStatusBadge status={booking.payment.status} />
                </div>
              </div>
              <p className="mt-2 text-[0.875rem] text-body">{booking.leadTravellerName}</p>
              <p className="text-[0.8125rem] text-muted">{booking.tour.title}</p>
              <p className="mt-1 text-[0.8125rem] text-muted">{formatDeparture(booking.date, booking.endDate)}</p>
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
