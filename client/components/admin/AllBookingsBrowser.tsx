"use client";

import Link from "next/link";
import { AlertTriangle, ShieldQuestion } from "lucide-react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { PaymentStatusBadge } from "./PaymentStatusBadge";
import {
  BookingStatusBadge,
  OrderStatusBadge,
  ServiceBookingStatusBadge,
  TourBookingStatusBadge,
} from "./StatusBadge";
import { TransferBookingStatusBadge } from "./DispatchBadges";
import { BookingFilters } from "./filters/BookingFilters";
import { Pager } from "./filters/Pager";
import { useFilterUrl } from "./filters/useFilterUrl";
import {
  BOOKING_APPROVAL_PRODUCTS,
  approvalProductFilterLabels,
  approvalProductLabels,
} from "@/lib/admin/bookingApprovals";
import { bookingStatusLabels, formatInstant, formatStayDate } from "@/lib/admin/bookings";
import { transferBookingStatusLabels } from "@/lib/admin/dispatch";
import { orderStatusLabels } from "@/lib/admin/orders";
import { serviceBookingStatusLabels } from "@/lib/admin/services";
import { tourBookingStatusLabels } from "@/lib/admin/tours";
import type { IndexEntry } from "@/lib/api/bookingIndex";
import { formatMoney } from "@/lib/money";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { BookingApprovalProduct, HotelBookingStatus } from "@/types/booking";
import type { OrderStatus } from "@/types/order";
import type { ServiceBookingStatus } from "@/types/service";
import type { TourBookingStatus } from "@/types/tour";
import type { TransferBookingStatus } from "@/types/transfer";

/**
 * The register of every booking: hotels, transfers, tours, services and
 * orders in one list, from the booking index.
 *
 * This is the screen a desk opens with a name or an email and no idea which
 * register the booking is on. Each row says which product it is and links to
 * that product's own detail page; the filters are the shared kit with a
 * product chip row on top.
 *
 * The status chips are the union of every product's states, in the words
 * the products share. A row's badge, though, is the product's own — an
 * order's `PENDING_CONFIRMATION` reads "Awaiting answers" here exactly as it
 * does on the order register.
 */

/** Every status word any product uses, once, in lifecycle order. */
const ALL_STATUSES: { value: string; label: string }[] = [
  { value: "PENDING_APPROVAL", label: "Awaiting approval" },
  { value: "PENDING", label: "Pending" },
  { value: "PENDING_CONFIRMATION", label: "Awaiting answers" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PARTIALLY_CANCELLED", label: "Partly cancelled" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "NO_SHOW", label: "No show" },
];

const statusLabel = (status: string): string => ALL_STATUSES.find((entry) => entry.value === status)?.label ?? status;

function StatusBadgeFor({ product, status }: { product: BookingApprovalProduct; status: string }) {
  switch (product) {
    case "HOTEL":
      return status in bookingStatusLabels ? <BookingStatusBadge status={status as HotelBookingStatus} /> : <>{status}</>;
    case "TRANSFER":
      return status in transferBookingStatusLabels ? (
        <TransferBookingStatusBadge status={status as TransferBookingStatus} />
      ) : (
        <>{status}</>
      );
    case "TOUR":
      return status in tourBookingStatusLabels ? <TourBookingStatusBadge status={status as TourBookingStatus} /> : <>{status}</>;
    case "SERVICE":
      return status in serviceBookingStatusLabels ? (
        <ServiceBookingStatusBadge status={status as ServiceBookingStatus} />
      ) : (
        <>{status}</>
      );
    case "ORDER":
      return status in orderStatusLabels ? <OrderStatusBadge status={status as OrderStatus} /> : <>{status}</>;
  }
}

function ProductPill({ product }: { product: BookingApprovalProduct }) {
  return (
    <span className="inline-flex rounded-full bg-surface-soft px-2 py-0.5 text-[0.6875rem] font-medium tracking-wide text-muted uppercase">
      {approvalProductLabels[product]}
    </span>
  );
}

/** "Tamar Gelashvili" → "TG"; one word gives its first two letters. */
export const initialsOfName = (name: string | null | undefined): string => {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

/** "1 – 4 Jun 2027", or the one day when the service starts and ends together. */
const formatWhen = (entry: IndexEntry): string =>
  entry.endDate && entry.endDate !== entry.startDate
    ? `${formatStayDate(entry.startDate)} – ${formatStayDate(entry.endDate)}`
    : formatStayDate(entry.startDate);

const columns: Column[] = [
  { label: "Type" },
  { label: "Reference" },
  { label: "Booking" },
  { label: "Buyer", hideBelow: "lg" },
  { label: "Status" },
  { label: "Payment", hideBelow: "xl" },
  { label: "Total", align: "end" },
  { label: "Created", hideBelow: "xl" },
];

export function AllBookingsBrowser({
  data,
  total,
  page,
  totalPages,
  today,
  basePath,
  showPartner = true,
  showManager = true,
  keep = [],
  unlinkedProducts,
}: {
  data: IndexEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** `YYYY-MM-DD` from the server render. */
  today: string;
  /**
   * Where a row links. Omitted, each row opens the admin page the index
   * names; the portal passes its own base and every product lands there.
   */
  basePath?: string;
  showPartner?: boolean;
  showManager?: boolean;
  keep?: readonly string[];
  /** Products with no detail page where `basePath` leads: their references show as text. */
  unlinkedProducts?: readonly BookingApprovalProduct[];
}) {
  const localePath = useLocalePath();
  const url = useFilterUrl();

  const hrefFor = (entry: IndexEntry) =>
    unlinkedProducts?.includes(entry.product) ? null : localePath(basePath ? `${basePath}/${entry.reference}` : entry.href);

  const reference = (entry: IndexEntry, className: string) => {
    const href = hrefFor(entry);
    return href ? (
      <Link href={href} prefetch={false} className={cn(className, "underline-offset-4 hover:underline")}>
        {entry.reference}
      </Link>
    ) : (
      <span className={className}>{entry.reference}</span>
    );
  };

  // The names come with the row, looked up once per page on the server; the
  // ids are what the links need. The manager is a two-letter chip with the
  // full name on hover, so the column stays one line wide.
  const buyer = (entry: IndexEntry) => (
    <span className="flex items-start justify-between gap-2">
      <span className="min-w-0">
        {entry.leadName}
        <span className="block truncate text-[0.75rem] text-muted">{entry.leadEmail}</span>
        {showPartner && entry.partner && (
          <Link
            href={localePath(`/admin/partners/${entry.partner.id}`)}
            prefetch={false}
            className="block truncate text-[0.75rem] text-brand-text underline-offset-4 hover:underline"
          >
            {entry.partner.name}
          </Link>
        )}
        {showPartner && entry.customer && (
          <Link
            href={localePath(`/admin/customers/${entry.customer.id}`)}
            prefetch={false}
            className="block truncate text-[0.75rem] text-brand-text underline-offset-4 hover:underline"
          >
            {entry.customer.name}
            {entry.customer.kind === "COMPANY" ? <span className="text-muted"> · company</span> : null}
          </Link>
        )}
      </span>
      {showManager && entry.assignedManager && (
        <span
          title={`Manager: ${entry.assignedManager.name ?? "Unnamed"}`}
          aria-label={`Manager: ${entry.assignedManager.name ?? "Unnamed"}`}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-soft text-[0.6875rem] font-semibold text-ink"
        >
          {initialsOfName(entry.assignedManager.name)}
        </span>
      )}
    </span>
  );

  const payment = (entry: IndexEntry) => {
    const owed = entry.payment.status === "UNPAID" || entry.payment.status === "PARTIAL" || entry.payment.status === "OVERDUE";
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <PaymentStatusBadge status={entry.payment.status} />
        {owed && entry.payment.dueAt && (
          <span className={cn("text-[0.75rem]", entry.payment.status === "OVERDUE" ? "font-medium text-error-text" : "text-muted")}>
            {entry.payment.status === "OVERDUE" ? "was due " : "due "}
            {formatInstant(entry.payment.dueAt)}
          </span>
        )}
      </span>
    );
  };

  const approval = (entry: IndexEntry) =>
    entry.approval?.state === "PENDING" ? (
      <span
        className={cn(
          "mt-0.5 flex items-center gap-1 text-[0.75rem]",
          entry.approval.overdue ? "font-medium text-error-text" : "text-warning-text",
        )}
      >
        {entry.approval.overdue ? <AlertTriangle size={11} aria-hidden /> : <ShieldQuestion size={11} aria-hidden />}
        {entry.approval.overdue ? "approval overdue" : "awaiting approval"}
      </span>
    ) : null;

  return (
    <div>
      <BookingFilters
        url={url}
        products={BOOKING_APPROVAL_PRODUCTS.map((product) => ({ value: product, label: approvalProductFilterLabels[product] }))}
        productLabel={(product) => approvalProductLabels[product as BookingApprovalProduct] ?? product}
        statuses={ALL_STATUSES}
        statusLabel={statusLabel}
        dateLabel="Service date"
        searchPlaceholder="Reference, name, email, property, partner or customer"
        searchLabel="Search every booking"
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
          <DataTable columns={columns} caption="Every booking">
            {data.length === 0 ? (
              <EmptyRow colSpan={columns.length} message="Nothing to show." />
            ) : (
              data.map((entry) => (
                <Row key={`${entry.product}-${entry.id}`}>
                  <Cell>
                    <ProductPill product={entry.product} />
                  </Cell>
                  <Cell>
                    {reference(entry, "font-medium text-ink")}
                    {entry.order && (
                      <span className="block text-[0.75rem] text-muted">in {entry.order.reference}</span>
                    )}
                    {approval(entry)}
                  </Cell>
                  <Cell>
                    <span className="block max-w-[18rem] truncate">{entry.title}</span>
                    <span className="block text-[0.75rem] text-muted">{formatWhen(entry)}</span>
                  </Cell>
                  <Cell hideBelow="lg">{buyer(entry)}</Cell>
                  <Cell>
                    <StatusBadgeFor product={entry.product} status={entry.status} />
                  </Cell>
                  <Cell hideBelow="xl">{payment(entry)}</Cell>
                  <Cell align="end" className="tabular-nums">
                    {formatMoney(entry.totalCents, entry.currency)}
                  </Cell>
                  <Cell hideBelow="xl" className="text-[0.8125rem] text-muted tabular-nums">
                    {formatInstant(entry.createdAt)}
                  </Cell>
                </Row>
              ))
            )}
          </DataTable>
        </div>

        <ul className="flex flex-col gap-3 lg:hidden">
          {data.length === 0 && <li className="py-12 text-center text-[0.875rem] text-muted">Nothing to show.</li>}
          {data.map((entry) => (
            <li key={`${entry.product}-${entry.id}`} className="rounded-sm border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <ProductPill product={entry.product} />
                  {reference(entry, "ms-2 font-medium text-ink")}
                </span>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadgeFor product={entry.product} status={entry.status} />
                  <PaymentStatusBadge status={entry.payment.status} />
                </div>
              </div>
              <p className="mt-2 text-[0.875rem] text-body">{entry.title}</p>
              <p className="text-[0.8125rem] text-muted">
                {entry.leadName} · {formatWhen(entry)}
              </p>
              {showPartner && (entry.partner || entry.customer) && (
                <p className="text-[0.8125rem] text-brand-text">{entry.partner?.name ?? entry.customer?.name}</p>
              )}
              <p className="mt-2 font-medium text-ink tabular-nums">{formatMoney(entry.totalCents, entry.currency)}</p>
            </li>
          ))}
        </ul>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={(next) => url.apply({ page: String(next) })} />
    </div>
  );
}
