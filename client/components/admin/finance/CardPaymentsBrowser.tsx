"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
import { labelClass } from "@/components/admin/FormControls";
import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PspPaymentStatus, StaffPayment } from "@/types/payments";

import {
  CardModeChip,
  CardPaymentStatusBadge,
  bookingHref,
  cardLabel,
  cardPaymentStatusLabels,
  needsAttention,
} from "./CardPaymentBadges";
import { formatFinanceDateTime } from "./PaymentFormat";

interface CardPaymentsBrowserProps {
  payments: StaffPayment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const STATUSES = Object.keys(cardPaymentStatusLabels) as PspPaymentStatus[];

const COLUMNS: Column[] = [
  { label: "Reference" },
  { label: "Booking" },
  { label: "Guest", hideBelow: "xl" },
  { label: "Amount", align: "end" },
  { label: "Status" },
  { label: "Card", hideBelow: "xl" },
  { label: "Created", hideBelow: "xl" },
  { label: "Completed", hideBelow: "xl" },
  { label: "", align: "end" },
];

/**
 * Card payments through the gateway, newest first, and their filters.
 *
 * Same arrangement as the payments register: the filters live in the address
 * and the server narrows, so "everything that mismatched this week" is a link.
 */
export function CardPaymentsBrowser({ payments, total, page, pageSize, totalPages }: CardPaymentsBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = useLocalePath();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const status = params.get("status") ?? "all";
  const mode = params.get("mode") ?? "all";
  const attention = params.get("attention") === "true";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }

    if (!("page" in changes)) next.delete("page");

    const search = next.toString();
    startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname));
  };

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (query === current) return;

    const timer = setTimeout(() => apply({ q: query.trim() || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const activeFilters = [
    status !== "all",
    mode !== "all",
    attention,
    Boolean(from),
    Boolean(to),
    query.trim() !== "",
  ].filter(Boolean).length;

  const chip = (selected: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors",
      selected
        ? "border-ink bg-ink text-on-dark"
        : "border-line bg-surface text-body hover:border-ink/40 hover:text-ink",
    );

  const chips = (key: string, current: string, options: { value: string; label: string }[]) => (
    <div className="flex flex-wrap gap-2">
      {[{ value: "all", label: "All" }, ...options].map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => apply({ [key]: option.value })}
          aria-pressed={current === option.value}
          className={chip(current === option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  const legend = "mb-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase";
  const href = (payment: StaffPayment) => path(`/admin/finance/card-payments/${payment.id}`);

  const bookingCell = (payment: StaffPayment) => {
    const target = bookingHref(payment);
    const label = payment.bookingReference ?? "—";
    return target ? (
      <Link href={path(target)} prefetch={false} className="font-mono text-[0.8125rem] text-brand-text underline-offset-4 hover:underline">
        {label}
      </Link>
    ) : (
      <span className="font-mono text-[0.8125rem]">{label}</span>
    );
  };

  const attentionMark = (payment: StaffPayment) =>
    needsAttention(payment) && (
      <span className="inline-flex items-center gap-1 text-[0.75rem] font-medium text-warning-text">
        <AlertTriangle size={13} aria-hidden />
        Needs attention
      </span>
    );

  return (
    <section className="mt-8">
      <div className="rounded-sm border border-line bg-surface p-4 sm:p-5">
        <FilterDisclosure
          count={Math.max(0, activeFilters - (query.trim() !== "" ? 1 : 0))}
          lead={
            <div className="relative min-w-[16rem] flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Reference, booking or guest email"
                aria-label="Search card payments"
                className="h-11 w-full rounded-sm border border-line bg-background ps-9 pe-3 text-sm text-ink transition-colors focus:border-ink focus:outline-none"
              />
            </div>
          }
        >
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <fieldset>
              <legend className={legend}>Status</legend>
              {chips(
                "status",
                status,
                STATUSES.map((value) => ({ value, label: cardPaymentStatusLabels[value] })),
              )}
            </fieldset>
            <fieldset>
              <legend className={legend}>Mode</legend>
              {chips("mode", mode, [
                { value: "LIVE", label: "Live" },
                { value: "TEST", label: "Test" },
              ])}
            </fieldset>
            <fieldset>
              <legend className={legend}>Attention</legend>
              <button
                type="button"
                aria-pressed={attention}
                onClick={() => apply({ attention: attention ? null : "true" })}
                className={chip(attention)}
              >
                Needs attention only
              </button>
            </fieldset>
          </div>

          <div className="mt-4 grid gap-3 sm:max-w-md sm:grid-cols-2">
            <label className="block min-w-0">
              <span className={labelClass}>Created from</span>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => apply({ from: event.target.value || null })}
                className="mt-1.5 h-10 w-full rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-ink focus:border-ink focus:outline-none"
              />
            </label>
            <label className="block min-w-0">
              <span className={labelClass}>Created to</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => apply({ to: event.target.value || null })}
                className="mt-1.5 h-10 w-full rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-ink focus:border-ink focus:outline-none"
              />
            </label>
          </div>
        </FilterDisclosure>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <p aria-live="polite" className={cn("text-[0.8125rem] text-muted", pending && "opacity-50")}>
            {total === 1 ? "1 card payment" : `${total} card payments`}
            {activeFilters > 0 && " matching your filters"}
          </p>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                apply({ q: null, status: null, mode: null, attention: null, from: null, to: null });
              }}
              className="inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
            >
              <X size={13} aria-hidden />
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className={cn("mt-5 transition-opacity", pending && "opacity-60")}>
        <div className="hidden lg:block">
          <DataTable columns={COLUMNS} caption="Card payments">
            {payments.length === 0 && (
              <EmptyRow
                colSpan={COLUMNS.length}
                message={
                  activeFilters > 0
                    ? "No card payments match your filters."
                    : "No card payments yet. They appear here as guests pay by card."
                }
              />
            )}

            {payments.map((payment) => (
              <Row key={payment.id}>
                <Cell className="whitespace-nowrap">
                  <Link
                    href={href(payment)}
                    prefetch={false}
                    className="font-mono text-[0.8125rem] font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {payment.reference}
                  </Link>
                  <span className="mt-1 block">
                    <CardModeChip mode={payment.mode} />
                  </span>
                </Cell>
                <Cell>{bookingCell(payment)}</Cell>
                <Cell hideBelow="xl">
                  <span className="break-all">{payment.debtorEmail ?? "—"}</span>
                </Cell>
                <Cell align="end" className="font-medium whitespace-nowrap text-ink tabular-nums">
                  {formatMoney(payment.amountCents, payment.currency)}
                </Cell>
                <Cell>
                  <CardPaymentStatusBadge status={payment.status} />
                  <span className="mt-1 block">{attentionMark(payment)}</span>
                </Cell>
                <Cell hideBelow="xl" className="whitespace-nowrap">
                  {cardLabel(payment) ?? <span className="text-subtle">—</span>}
                </Cell>
                <Cell hideBelow="xl" className="whitespace-nowrap">
                  {formatFinanceDateTime(payment.createdAt)}
                </Cell>
                <Cell hideBelow="xl" className="whitespace-nowrap">
                  {formatFinanceDateTime(payment.completedAt)}
                </Cell>
                <Cell align="end">
                  <Link
                    href={href(payment)}
                    prefetch={false}
                    className="inline-flex items-center gap-1 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
                  >
                    Open
                    <ChevronRight size={14} className="rtl:-scale-x-100" aria-hidden />
                  </Link>
                </Cell>
              </Row>
            ))}
          </DataTable>
        </div>

        <ul className="space-y-3 lg:hidden">
          {payments.length === 0 && (
            <li className="rounded-sm border border-line bg-surface p-6 text-center text-[0.8125rem] text-muted">
              {activeFilters > 0 ? "No card payments match your filters." : "No card payments yet."}
            </li>
          )}

          {payments.map((payment) => (
            <li key={payment.id}>
              <Link
                href={href(payment)}
                prefetch={false}
                className="block rounded-sm border border-line bg-surface p-4 transition-colors hover:border-ink/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[0.8125rem] font-medium text-ink">{payment.reference}</p>
                    <p className="mt-0.5 truncate text-[0.75rem] text-muted">
                      {payment.bookingReference ?? "—"} · {payment.debtorEmail ?? "no email"}
                    </p>
                  </div>
                  <p className="shrink-0 text-end text-[0.875rem] font-medium text-ink tabular-nums">
                    {formatMoney(payment.amountCents, payment.currency)}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <CardPaymentStatusBadge status={payment.status} />
                  <CardModeChip mode={payment.mode} />
                  {attentionMark(payment)}
                </div>
                <p className="mt-3 truncate text-[0.8125rem] text-muted">
                  {formatFinanceDateTime(payment.createdAt)}
                  {cardLabel(payment) ? ` · ${cardLabel(payment)}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => apply({ page: String(page - 1) })}
            className="h-10 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body transition-colors hover:border-ink/40 disabled:opacity-40"
          >
            Previous
          </button>
          <p className="text-[0.8125rem] text-muted">
            Page {page} of {totalPages}
            <span className="sr-only">, {pageSize} per page</span>
          </p>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => apply({ page: String(page + 1) })}
            className="h-10 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body transition-colors hover:border-ink/40 disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
