"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
import { labelClass } from "@/components/admin/FormControls";
import { paymentKindLabel, paymentMethodLabels } from "@/lib/admin/finance";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Payment, PaymentMethod } from "@/types/finance";

import { FINANCE_CURRENCIES, counterpartyName, formatFinanceDate } from "./PaymentFormat";

interface PaymentsBrowserProps {
  payments: Payment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const METHODS = Object.keys(paymentMethodLabels) as PaymentMethod[];

const COLUMNS: Column[] = [
  { label: "Paid on" },
  { label: "What" },
  { label: "Counterparty" },
  { label: "Amount", align: "end" },
  { label: "Method", hideBelow: "xl" },
  { label: "Reference", hideBelow: "xl" },
  { label: "", align: "end" },
];

/** Money in reads as a plus, money out as a minus — direction, never colour alone. */
function Amount({ payment }: { payment: Payment }) {
  const Icon = payment.direction === "IN" ? ArrowDownLeft : ArrowUpRight;

  return (
    <>
      <span className="inline-flex items-center gap-1 font-medium text-ink tabular-nums whitespace-nowrap">
        <Icon
          size={13}
          className={payment.direction === "IN" ? "text-success" : "text-muted"}
          aria-label={payment.direction === "IN" ? "In" : "Out"}
        />
        {formatMoney(payment.amountCents, payment.currency)}
      </span>
      {payment.unallocatedCents > 0 && (
        <span className="block text-[0.75rem] whitespace-nowrap text-warning-text">
          {formatMoney(payment.unallocatedCents, payment.currency)} unallocated
        </span>
      )}
    </>
  );
}

/**
 * Every recorded money movement, newest first, and its filters.
 *
 * The URL-state arrangement of the other lists: the filters live in the
 * address and the server narrows, so "card payments in October" is a link.
 * The date range is kept as plain Tbilisi days and becomes instants on the
 * server page.
 */
export function PaymentsBrowser({ payments, total, page, pageSize, totalPages }: PaymentsBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = useLocalePath();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const direction = params.get("direction") ?? "all";
  const kind = params.get("kind") ?? "all";
  const method = params.get("method") ?? "all";
  const currency = params.get("currency") ?? "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const partner = params.get("partner") ?? "";

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
    direction !== "all",
    kind !== "all",
    method !== "all",
    currency !== "all",
    Boolean(from),
    Boolean(to),
    Boolean(partner),
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
  const href = (payment: Payment) => path(`/admin/finance/payments/${payment.id}`);

  return (
    <section className="mt-8">
      <div className="rounded-sm border border-line bg-surface p-4 sm:p-5">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Reference or name"
            aria-label="Search payments"
            className="h-11 w-full rounded-sm border border-line bg-background ps-9 pe-3 text-sm text-ink transition-colors focus:border-ink focus:outline-none"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
          <fieldset>
            <legend className={legend}>Direction</legend>
            {chips("direction", direction, [
              { value: "IN", label: "Money in" },
              { value: "OUT", label: "Money out" },
            ])}
          </fieldset>
          <fieldset>
            <legend className={legend}>Kind</legend>
            {chips("kind", kind, [
              { value: "PAYMENT", label: "Payments" },
              { value: "REFUND", label: "Refunds" },
            ])}
          </fieldset>
          <fieldset>
            <legend className={legend}>Method</legend>
            {chips(
              "method",
              method,
              METHODS.map((value) => ({ value, label: paymentMethodLabels[value] })),
            )}
          </fieldset>
          <fieldset>
            <legend className={legend}>Currency</legend>
            {chips(
              "currency",
              currency,
              FINANCE_CURRENCIES.map((value) => ({ value, label: value })),
            )}
          </fieldset>
        </div>

        <div className="mt-4 grid gap-3 sm:max-w-md sm:grid-cols-2">
          <label className="block min-w-0">
            <span className={labelClass}>Paid from</span>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => apply({ from: event.target.value || null })}
              className="mt-1.5 h-10 w-full rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-ink focus:border-ink focus:outline-none"
            />
          </label>
          <label className="block min-w-0">
            <span className={labelClass}>Paid to</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => apply({ to: event.target.value || null })}
              className="mt-1.5 h-10 w-full rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-ink focus:border-ink focus:outline-none"
            />
          </label>
        </div>

        {partner && (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Narrowed to">
            <li>
              <button
                type="button"
                onClick={() => apply({ partner: null })}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink bg-ink px-3 py-1.5 text-[0.8125rem] text-on-dark"
              >
                One partner only
                <X size={13} aria-label="Remove" />
              </button>
            </li>
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <p aria-live="polite" className={cn("text-[0.8125rem] text-muted", pending && "opacity-50")}>
            {total === 1 ? "1 payment" : `${total} payments`}
            {activeFilters > 0 && " matching your filters"}
          </p>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                apply({
                  q: null,
                  direction: null,
                  kind: null,
                  method: null,
                  currency: null,
                  from: null,
                  to: null,
                  partner: null,
                });
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
          <DataTable columns={COLUMNS} caption="Payments">
            {payments.length === 0 && (
              <EmptyRow colSpan={COLUMNS.length} message="No payments match your filters." />
            )}

            {payments.map((payment) => (
              <Row key={payment.id}>
                <Cell className="whitespace-nowrap">
                  <Link
                    href={href(payment)}
                    prefetch={false}
                    className="font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {formatFinanceDate(payment.paidAt)}
                  </Link>
                </Cell>
                <Cell>{paymentKindLabel(payment.direction, payment.kind)}</Cell>
                <Cell>
                  <span className="block text-ink">{counterpartyName(payment)}</span>
                  {payment.counterparty.partner?.reference && (
                    <span className="block text-[0.75rem] text-muted">{payment.counterparty.partner.reference}</span>
                  )}
                </Cell>
                <Cell align="end">
                  <Amount payment={payment} />
                </Cell>
                <Cell hideBelow="xl">{paymentMethodLabels[payment.method]}</Cell>
                <Cell hideBelow="xl">
                  {payment.reference ? (
                    <span className="break-all">{payment.reference}</span>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
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
              No payments match your filters.
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
                    <p className="truncate font-medium text-ink">{counterpartyName(payment)}</p>
                    <p className="mt-0.5 text-[0.75rem] text-muted">
                      {paymentKindLabel(payment.direction, payment.kind)}
                    </p>
                  </div>
                  <p className="shrink-0 text-end text-[0.875rem]">
                    <Amount payment={payment} />
                  </p>
                </div>
                <p className="mt-3 truncate text-[0.8125rem] text-muted">
                  {formatFinanceDate(payment.paidAt)}
                  {" · "}
                  {paymentMethodLabels[payment.method]}
                  {payment.reference ? ` · ${payment.reference}` : ""}
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
