"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Clock, Search } from "lucide-react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
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
 * The same URL-driven filtering as the hotel and tour registers beside it, so
 * a partner with four thousand orders costs what one with four costs, and a
 * filtered view survives a reload.
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
  { label: "Total", align: "end" },
];

export function PortalOrdersBrowser({
  data,
  total,
  page,
  totalPages,
}: {
  data: OrderSummary[];
  total: number;
  page: number;
  totalPages: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = useLocalePath();
  const { t, locale, intlLocale } = useI18n();
  const [pending, startTransition] = useTransition();

  const [search, setSearch] = useState(params.get("search") ?? "");

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }

    // A changed filter invalidates the page number, but not the tab: dropping
    // `product` here would throw the partner back to the hotel register.
    if (!("page" in changes)) next.delete("page");

    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  };

  // Debounced, so typing a reference does not fire a request per keystroke.
  useEffect(() => {
    const current = params.get("search") ?? "";
    if (search === current) return;

    const timer = setTimeout(() => apply({ search: search || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const status = params.get("status") ?? "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const field =
    "h-10 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink";

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
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[15rem] flex-1">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-subtle"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Reference, traveller name or email"
            aria-label="Search your orders"
            className={cn(field, "w-full ps-9")}
          />
        </div>

        <select
          value={status}
          onChange={(event) => apply({ status: event.target.value })}
          aria-label="Filter by status"
          className={field}
        >
          <option value="all">All statuses</option>
          {ORDER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t.orders.status[value]}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-[0.8125rem] text-muted">
          Starting
          <input
            type="date"
            value={from}
            onChange={(event) => apply({ from: event.target.value || null })}
            aria-label="Starting on or after"
            className={field}
          />
          <span aria-hidden>–</span>
          <input
            type="date"
            value={to}
            onChange={(event) => apply({ to: event.target.value || null })}
            aria-label="Starting on or before"
            className={field}
          />
        </label>
      </div>

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {total === 0 ? "No orders match these filters." : `${total} order${total === 1 ? "" : "s"}`}
      </p>

      <div className={cn("mt-4 transition-opacity", pending && "opacity-60")}>
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
                <Badge tone={TONES[order.status]}>{t.orders.status[order.status]}</Badge>
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

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => apply({ page: String(page - 1) })}
            className="inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft disabled:pointer-events-none disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-[0.8125rem] text-muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => apply({ page: String(page + 1) })}
            className="inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft disabled:pointer-events-none disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
