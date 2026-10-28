"use client";

import Link from "next/link";
import { Clock } from "lucide-react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
import { PaymentCell, PaymentStatusBadge } from "@/components/admin/PaymentStatusBadge";
import { BookingFilters } from "@/components/admin/filters/BookingFilters";
import { Pager } from "@/components/admin/filters/Pager";
import { useFilterUrl } from "@/components/admin/filters/useFilterUrl";
import { Badge } from "@/components/ui/Badge";
import { formatInstant, formatStayDate } from "@/lib/booking/stay";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUSES } from "@/lib/packages/orders";
import { cn } from "@/lib/utils";
import type { OrderStatus, OrderSummary } from "@/types/order";

/**
 * A partner's own trips.
 *
 * The same URL-driven filtering as the hotel and tour registers beside it,
 * through the shared filter kit, so a partner with four thousand orders
 * costs what one with four costs, and a filtered view survives a reload.
 *
 * An order is not one booking, and the register has to say so: `pendingCount`
 * is parts the operator has not answered yet, and those hold real capacity
 * against a deadline. That line sits under the reference in the warning tone
 * for the same reason the tour register puts its deadline there — it is what a
 * partner is scanning the list for.
 *
 * Statuses read out of `t.orders.status` rather than a local English map: the
 * detail view a row leads to is built entirely from that dictionary, and two
 * spellings of PARTIALLY_CANCELLED either side of a click is not a difference
 * a partner should have to reconcile. The chrome around them stays English,
 * as the rest of the portal is.
 */

const TONES: Record<OrderStatus, "neutral" | "outline" | "nature"> = {
  PENDING_APPROVAL: "outline",
  PENDING_CONFIRMATION: "outline",
  CONFIRMED: "nature",
  PARTIALLY_CANCELLED: "neutral",
  CANCELLED: "neutral",
  COMPLETED: "neutral",
};

const columns: Column[] = [
  { label: "Reference" },
  { label: "Lead traveller" },
  { label: "Package", hideBelow: "xl" },
  { label: "Dates" },
  { label: "Party", hideBelow: "xl" },
  { label: "Status" },
  { label: "Payment", hideBelow: "xl" },
  { label: "Total", align: "end" },
];

export function PortalOrdersBrowser({
  data,
  total,
  page,
  totalPages,
  today,
}: {
  data: OrderSummary[];
  total: number;
  page: number;
  totalPages: number;
  /** `YYYY-MM-DD` from the server render. */
  today: string;
}) {
  const path = useLocalePath();
  const { t, locale, intlLocale } = useI18n();
  const url = useFilterUrl();

  const dates = (order: OrderSummary) =>
    `${formatStayDate(order.startDate, intlLocale)} – ${formatStayDate(order.endDate, intlLocale)}`;

  const party = (order: OrderSummary) =>
    [
      plural(locale, order.adults, t.units.adult),
      order.childAges.length > 0 ? plural(locale, order.childAges.length, t.units.child) : null,
    ]
      .filter(Boolean)
      .join(" · ");

  /** Parts still with an operator, and the deadline they are racing. */
  const awaiting = (order: OrderSummary) =>
    order.pendingCount === 0 ? null : (
      <span className="mt-0.5 flex items-center gap-1 text-[0.75rem] text-warning-text">
        <Clock size={11} aria-hidden />
        {fill(t.orders.manage.awaitingShort, { count: order.pendingCount })}
        {order.requestDeadlineAt && ` · ${formatInstant(order.requestDeadlineAt, intlLocale)}`}
      </span>
    );

  return (
    <div>
      <BookingFilters
        url={url}
        statuses={ORDER_STATUSES.map((value) => ({ value, label: t.orders.status[value] }))}
        statusLabel={(status) => t.orders.status[status as OrderStatus] ?? status}
        dateLabel="Starting"
        searchPlaceholder="Reference, traveller name or email"
        searchLabel="Search your orders"
        today={today}
        keep={["product"]}
        excludePresets={["upcoming"]}
      />

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {total === 0 ? "No orders match these filters." : `${total} order${total === 1 ? "" : "s"}`}
      </p>

      <div className={cn("mt-4 transition-opacity", url.pending && "opacity-60")}>
        {/* Desktop: a real table. Below lg the same rows render as cards. */}
        <div className="hidden rounded-sm border border-line bg-surface lg:block">
          <DataTable columns={columns} caption="Your orders">
            {data.length === 0 ? (
              <EmptyRow colSpan={columns.length} message="Nothing to show." />
            ) : (
              data.map((order) => (
                <Row key={order.reference}>
                  <Cell>
                    <Link
                      href={path(`/portal/bookings/${order.reference}`)}
                      className="font-medium text-ink underline-offset-4 hover:underline"
                    >
                      {order.reference}
                    </Link>
                    {awaiting(order)}
                  </Cell>
                  <Cell>{order.leadName}</Cell>
                  <Cell hideBelow="xl">
                    {order.package.name ?? "—"}
                    <span className="block text-[0.75rem] text-muted">
                      {order.itemCount} {order.itemCount === 1 ? "part" : "parts"}
                    </span>
                  </Cell>
                  <Cell>{dates(order)}</Cell>
                  <Cell hideBelow="xl">{party(order)}</Cell>
                  <Cell>
                    <Badge tone={TONES[order.status]}>{t.orders.status[order.status]}</Badge>
                  </Cell>
                  <Cell hideBelow="xl">
                    <PaymentCell payment={order.payment} />
                  </Cell>
                  <Cell align="end" className="tabular-nums">
                    {formatMoney(order.totalCents, order.currency, intlLocale)}
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
          {data.map((order) => (
            <li key={order.reference} className="rounded-sm border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={path(`/portal/bookings/${order.reference}`)}
                  className="font-medium text-ink underline-offset-4 hover:underline"
                >
                  {order.reference}
                </Link>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={TONES[order.status]}>{t.orders.status[order.status]}</Badge>
                  <PaymentStatusBadge status={order.payment.status} />
                </div>
              </div>
              {awaiting(order)}
              <p className="mt-2 text-[0.875rem] text-body">{order.leadName}</p>
              <p className="text-[0.8125rem] text-muted">{order.package.name ?? "—"}</p>
              <p className="mt-1 text-[0.8125rem] text-muted">
                {dates(order)} · {party(order)}
              </p>
              <p className="mt-2 font-medium text-ink tabular-nums">
                {formatMoney(order.totalCents, order.currency, intlLocale)}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={(next) => url.apply({ page: String(next) })} />
    </div>
  );
}
