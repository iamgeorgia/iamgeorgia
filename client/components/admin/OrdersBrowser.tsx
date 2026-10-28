"use client";

import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { PaymentCell, PaymentStatusBadge } from "./PaymentStatusBadge";
import { OrderStatusBadge } from "./StatusBadge";
import { BookingFilters } from "./filters/BookingFilters";
import { Pager } from "./filters/Pager";
import { useFilterUrl } from "./filters/useFilterUrl";
import {
  ORDER_STATUSES,
  formatOrderDates,
  formatOrderParty,
  isRequestOverdue,
  orderStatusHints,
  orderStatusLabels,
} from "@/lib/admin/orders";
import { formatInstant } from "@/lib/admin/bookings";
import { formatMoney } from "@/lib/money";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { OrderStatus, OrderSummary } from "@/types/order";

/**
 * The order register — one row per package sold, whatever it is made of.
 *
 * Filters live in the URL and nothing is filtered locally, so a filtered view
 * is shareable and the server keeps doing the paging. Status is multi-select
 * because the two queues an operator actually works — the requests and the
 * live trips — are each more than one state.
 *
 * The on-request queue is the reason this screen exists, so its chip is the
 * first and carries the queue's size: those orders hold rooms and seats that
 * nobody else can sell until somebody answers.
 */

export function OrdersBrowser({
  data,
  total,
  page,
  totalPages,
  pendingTotal,
  basePath = "/admin/orders",
  today,
  showPartner = true,
  showManager = true,
}: {
  data: OrderSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Every order awaiting an answer, not just the ones on this page. */
  pendingTotal: number;
  /** Where a reference links: the admin detail or the portal page. */
  basePath?: string;
  /** `YYYY-MM-DD` from the server render. */
  today: string;
  showPartner?: boolean;
  showManager?: boolean;
}) {
  const localePath = useLocalePath();
  const url = useFilterUrl();

  // Margin is on the summary for staff and absent for everyone else, so the
  // column follows the data rather than a role flag the browser would have to
  // be told about.
  const showMargin = data.some((order) => typeof order.marginCents === "number");

  const columns: Column[] = [
    { label: "Reference" },
    { label: "Trip" },
    { label: "Buyer", hideBelow: "lg" },
    { label: "Travelling", hideBelow: "md" },
    { label: "Party", hideBelow: "xl" },
    { label: "Status" },
    { label: "Payment", hideBelow: "xl" },
    ...(showMargin ? [{ label: "Margin", align: "end" as const, hideBelow: "xl" as const }] : []),
    { label: "Total", align: "end" },
  ];

  const now = new Date();

  return (
    <div>
      <BookingFilters
        url={url}
        statuses={[
          // The queue first, with its size, in the warning tone.
          { value: "PENDING_CONFIRMATION", label: "On request", count: pendingTotal, urgent: true },
          ...ORDER_STATUSES.filter((status) => status !== "PENDING_CONFIRMATION").map((value) => ({
            value,
            label: orderStatusLabels[value],
          })),
        ]}
        statusLabel={(status) => orderStatusLabels[status as OrderStatus] ?? status}
        statusHints={orderStatusHints}
        dateLabel="Travelling"
        searchPlaceholder="Reference, buyer name or email"
        searchLabel="Search orders"
        today={today}
        showPartner={showPartner}
        showManager={showManager}
      />

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {total === 0 ? "No orders match these filters." : `${total} order${total === 1 ? "" : "s"}`}
      </p>

      <div className={cn("mt-4 transition-opacity", url.pending && "opacity-60")}>
        {/* Desktop: a real table. Below lg the same rows render as cards. */}
        <div className="hidden rounded-sm border border-line bg-surface lg:block">
          <DataTable columns={columns} caption="Orders">
            {data.length === 0 ? (
              <EmptyRow colSpan={columns.length} message="Nothing to show." />
            ) : (
              data.map((order) => {
                const overdue = isRequestOverdue(order.requestDeadlineAt, now);

                return (
                  <Row key={order.reference} className={cn(overdue && "bg-error/5")}>
                    <Cell>
                      <Link
                        href={localePath(`${basePath}/${order.reference}`)}
                        className="font-medium text-ink underline-offset-4 hover:underline"
                      >
                        {order.reference}
                      </Link>
                      {order.pendingCount > 0 && order.requestDeadlineAt && (
                        <span
                          className={cn(
                            "mt-0.5 flex items-center gap-1 text-[0.75rem]",
                            overdue ? "font-medium text-error-text" : "text-warning-text",
                          )}
                        >
                          {overdue ? (
                            <AlertTriangle size={11} aria-hidden />
                          ) : (
                            <Clock size={11} aria-hidden />
                          )}
                          {overdue ? "overdue " : "by "}
                          {formatInstant(order.requestDeadlineAt)}
                        </span>
                      )}
                    </Cell>
                    <Cell>
                      {order.package.name ?? "Built to order"}
                      <span className="block text-[0.75rem] text-muted">
                        {order.itemCount} {order.itemCount === 1 ? "part" : "parts"}
                      </span>
                    </Cell>
                    <Cell hideBelow="lg">
                      {order.leadName}
                      {order.partner && (
                        <span className="block text-[0.75rem] text-muted">{order.partner.name}</span>
                      )}
                      {!order.partner && order.desk?.customer && (
                        <span className="block text-[0.75rem] text-muted">{order.desk.customer.name}</span>
                      )}
                    </Cell>
                    <Cell hideBelow="md">{formatOrderDates(order.startDate, order.endDate)}</Cell>
                    <Cell hideBelow="xl">
                      {formatOrderParty(order.adults, order.childAges, order.rooms)}
                    </Cell>
                    <Cell>
                      <OrderStatusBadge status={order.status} />
                      {/* Beside the status, never instead of it: the order is
                          booked, and it is the parts that are outstanding. */}
                      {order.pendingCount > 0 && (
                        <span className="ms-2 inline-flex items-center gap-1 text-[0.75rem] text-muted">
                          <Clock size={12} aria-hidden />
                          {order.pendingCount}
                        </span>
                      )}
                    </Cell>
                    <Cell hideBelow="xl">
                      <PaymentCell payment={order.payment} />
                    </Cell>
                    {showMargin && (
                      <Cell align="end" hideBelow="xl" className="tabular-nums text-muted">
                        {typeof order.marginCents === "number"
                          ? formatMoney(order.marginCents, order.currency)
                          : "—"}
                      </Cell>
                    )}
                    <Cell align="end" className="tabular-nums">
                      {formatMoney(order.totalCents, order.currency)}
                    </Cell>
                  </Row>
                );
              })
            )}
          </DataTable>
        </div>

        <ul className="flex flex-col gap-3 lg:hidden">
          {data.length === 0 && (
            <li className="py-12 text-center text-[0.875rem] text-muted">Nothing to show.</li>
          )}
          {data.map((order) => {
            const overdue = isRequestOverdue(order.requestDeadlineAt, now);

            return (
              <li
                key={order.reference}
                className={cn(
                  "rounded-sm border border-line bg-surface p-4",
                  overdue && "border-error/40",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={localePath(`${basePath}/${order.reference}`)}
                    className="font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {order.reference}
                  </Link>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <OrderStatusBadge status={order.status} />
                    <PaymentStatusBadge status={order.payment.status} />
                  </div>
                </div>
                <p className="mt-2 text-[0.875rem] text-body">
                  {order.package.name ?? "Built to order"}
                </p>
                <p className="text-[0.8125rem] text-muted">{order.leadName}</p>
                <p className="mt-1 text-[0.8125rem] text-muted">
                  {formatOrderDates(order.startDate, order.endDate)}
                </p>
                {order.pendingCount > 0 && (
                  <p
                    className={cn(
                      "mt-2 flex items-center gap-1.5 text-[0.75rem]",
                      overdue ? "font-medium text-error-text" : "text-warning-text",
                    )}
                  >
                    {overdue ? (
                      <AlertTriangle size={12} aria-hidden />
                    ) : (
                      <Clock size={12} aria-hidden />
                    )}
                    {order.pendingCount} awaiting an answer
                    {order.requestDeadlineAt &&
                      ` · ${overdue ? "overdue " : "by "}${formatInstant(order.requestDeadlineAt)}`}
                  </p>
                )}
                <p className="mt-2 font-medium text-ink tabular-nums">
                  {formatMoney(order.totalCents, order.currency)}
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={(next) => url.apply({ page: String(next) })} />
    </div>
  );
}
