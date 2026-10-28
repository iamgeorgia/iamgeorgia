"use client";

import Link from "next/link";
import { Clock } from "lucide-react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { PaymentCell, PaymentStatusBadge } from "./PaymentStatusBadge";
import { ServiceBookingStatusBadge } from "./StatusBadge";
import { BookingFilters } from "./filters/BookingFilters";
import { Pager } from "./filters/Pager";
import { useFilterUrl } from "./filters/useFilterUrl";
import { formatInstant } from "@/lib/admin/bookings";
import {
  SERVICE_BOOKING_STATUSES,
  formatServiceDates,
  serviceBookingStatusLabels,
  serviceCategoryLabels,
} from "@/lib/admin/services";
import { formatMoney } from "@/lib/money";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { ServiceBookingStatus, ServiceBookingSummary } from "@/types/service";

/**
 * The service bookings register: a kosher meal, a guide, a mashgiach booked
 * on its own (or as the part of an order), and the on-request ones the
 * supplier has yet to answer. Filters live in the URL, through the shared kit.
 */

const columns: Column[] = [
  { label: "Reference" },
  { label: "Lead" },
  { label: "Service", hideBelow: "lg" },
  { label: "Date", hideBelow: "md" },
  { label: "Status" },
  { label: "Payment", hideBelow: "xl" },
  { label: "Total", align: "end" },
];

export function ServiceBookingsBrowser({
  data,
  total,
  page,
  totalPages,
  today,
  basePath = "/admin/services/bookings",
  showPartner = true,
  showManager = true,
}: {
  data: ServiceBookingSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** `YYYY-MM-DD` from the server render. */
  today: string;
  basePath?: string;
  showPartner?: boolean;
  showManager?: boolean;
}) {
  const localePath = useLocalePath();
  const url = useFilterUrl();

  return (
    <div>
      <BookingFilters
        url={url}
        statuses={SERVICE_BOOKING_STATUSES.map((value) => ({ value, label: serviceBookingStatusLabels[value] }))}
        statusLabel={(status) => serviceBookingStatusLabels[status as ServiceBookingStatus] ?? status}
        dateLabel="Service date"
        searchPlaceholder="Reference, lead name or email"
        searchLabel="Search service bookings"
        today={today}
        showPartner={showPartner}
        showManager={showManager}
      />

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {total === 0 ? "No bookings match these filters." : `${total} booking${total === 1 ? "" : "s"}`}
      </p>

      <div className={cn("mt-4 transition-opacity", url.pending && "opacity-60")}>
        <div className="hidden rounded-sm border border-line bg-surface lg:block">
          <DataTable columns={columns} caption="Service bookings">
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
                    {booking.leadName}
                    {booking.partner && <span className="block text-[0.75rem] text-muted">{booking.partner.name}</span>}
                    {!booking.partner && booking.desk?.customer && (
                      <span className="block text-[0.75rem] text-muted">{booking.desk.customer.name}</span>
                    )}
                  </Cell>
                  <Cell hideBelow="lg">
                    {booking.service.name ?? "—"}
                    {booking.service.category && (
                      <span className="block text-[0.75rem] text-muted">{serviceCategoryLabels[booking.service.category]}</span>
                    )}
                  </Cell>
                  <Cell hideBelow="md">
                    {formatServiceDates(booking.date, booking.endDate, booking.days)}
                    <span className="block text-[0.75rem] text-muted">
                      {booking.pax} {booking.pax === 1 ? "person" : "people"} · qty {booking.quantity}
                    </span>
                  </Cell>
                  <Cell>
                    <ServiceBookingStatusBadge status={booking.status} />
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
                  <ServiceBookingStatusBadge status={booking.status} />
                  <PaymentStatusBadge status={booking.payment.status} />
                </div>
              </div>
              <p className="mt-2 text-[0.875rem] text-body">{booking.leadName}</p>
              <p className="text-[0.8125rem] text-muted">{booking.service.name}</p>
              <p className="mt-1 text-[0.8125rem] text-muted">{formatServiceDates(booking.date, booking.endDate, booking.days)}</p>
              <p className="mt-2 font-medium text-ink tabular-nums">{formatMoney(booking.totalCents, booking.currency)}</p>
            </li>
          ))}
        </ul>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={(next) => url.apply({ page: String(next) })} />
    </div>
  );
}
