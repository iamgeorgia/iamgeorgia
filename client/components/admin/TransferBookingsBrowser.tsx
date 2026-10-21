"use client";

import Link from "next/link";

import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { TransferBookingStatusBadge } from "./DispatchBadges";
import { PaymentCell, PaymentStatusBadge } from "./PaymentStatusBadge";
import { BookingFilters } from "./filters/BookingFilters";
import { Pager } from "./filters/Pager";
import { useFilterUrl } from "./filters/useFilterUrl";
import { transferBookingStatusLabels } from "@/lib/admin/dispatch";
import { TRANSFER_BOOKING_STATUSES } from "@/lib/admin/transfers";
import { formatMoney } from "@/lib/money";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { TransferBookingStatus, TransferBookingSummary } from "@/types/transfer";

/**
 * The transfer bookings register.
 *
 * A separate register from the hotel one rather than a filter on it: the two
 * share no identifier space. Ordered by pick-up rather than by when it was
 * booked, because what an operator needs from this screen is which cars go
 * out next — so the sort's default here is the server's soonest-first.
 *
 * Shared by the admin register and the partner portal's Transfers tab, which
 * differ in where a row links and in which filters are theirs to use.
 */

const columns: Column[] = [
  { label: "Reference" },
  { label: "Passenger" },
  { label: "Journey", hideBelow: "lg" },
  { label: "Pick-up", hideBelow: "md" },
  { label: "Status" },
  { label: "Payment", hideBelow: "xl" },
  { label: "Total", align: "end" },
];

const PICKUP = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/** The pick-up instant as stored, read in UTC: the detail page shows it in the point's own zone. */
const formatPickupAt = (iso: string): string => PICKUP.format(new Date(iso));

export function TransferBookingsBrowser({
  data,
  total,
  page,
  totalPages,
  basePath = "/admin/transfers/bookings",
  caption = "Transfer bookings",
  today,
  showPartner = true,
  showManager = true,
  keep = [],
}: {
  data: TransferBookingSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Where a reference links: the admin detail or the portal page. */
  basePath?: string;
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
        statuses={TRANSFER_BOOKING_STATUSES.map((value) => ({ value, label: transferBookingStatusLabels[value] }))}
        statusLabel={(status) => transferBookingStatusLabels[status as TransferBookingStatus] ?? status}
        dateLabel="Pick-up"
        searchPlaceholder="Reference, passenger name or email"
        searchLabel="Search transfer bookings"
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
          <DataTable caption={caption} columns={columns}>
            {data.length === 0 ? (
              <EmptyRow colSpan={columns.length} message="Nothing to show." />
            ) : (
              data.map((booking) => (
                <Row key={booking.reference}>
                  <Cell>
                    <Link
                      href={localePath(`${basePath}/${booking.reference}`)}
                      className="font-medium text-ink tabular-nums underline-offset-4 hover:underline"
                    >
                      {booking.reference}
                    </Link>
                  </Cell>
                  <Cell>
                    <span className="text-ink">{booking.leadPassengerName}</span>
                    <span className="type-caption mt-0.5 block break-all text-subtle">
                      {booking.partner?.name ?? booking.desk?.customer?.name ?? booking.leadPassengerEmail}
                    </span>
                  </Cell>
                  <Cell hideBelow="lg">
                    {booking.from} → {booking.to}
                    <span className="type-caption mt-0.5 block text-subtle">
                      {booking.vehicleName}
                      {booking.tripType === "RETURN" ? " · return" : ""}
                    </span>
                  </Cell>
                  <Cell hideBelow="md" className="tabular-nums">
                    {formatPickupAt(booking.pickupAt)}
                  </Cell>
                  <Cell>
                    <TransferBookingStatusBadge status={booking.status} />
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
                  <TransferBookingStatusBadge status={booking.status} />
                  <PaymentStatusBadge status={booking.payment.status} />
                </div>
              </div>
              <p className="mt-2 text-[0.875rem] text-body">{booking.leadPassengerName}</p>
              <p className="text-[0.8125rem] text-muted">
                {booking.from} → {booking.to}
              </p>
              <p className="mt-1 text-[0.8125rem] text-muted">{formatPickupAt(booking.pickupAt)}</p>
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
