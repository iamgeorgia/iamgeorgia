"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
import { dueInWords, settlementStatusLabels } from "@/lib/admin/finance";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Receivable, SettlementStatus } from "@/types/finance";

import {
  FINANCE_CURRENCIES,
  formatFinanceDate,
  receivableDebtorName,
  receivableSubjectLine,
} from "./PaymentFormat";
import { SettlementStatusBadge } from "./SettlementStatusBadge";

interface ReceivablesBrowserProps {
  receivables: Receivable[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** The partner the list is narrowed to from a link, named for the chip. */
  partnerName?: string | null;
}

const STATUSES: SettlementStatus[] = ["OPEN", "PARTIAL", "PAID", "WAIVED", "VOID"];

const COLUMNS: Column[] = [
  { label: "Reference" },
  { label: "Who owes" },
  { label: "Owed", align: "end", hideBelow: "xl" },
  { label: "Outstanding", align: "end" },
  { label: "Status" },
  { label: "Due" },
  { label: "", align: "end" },
];

const isOpen = (receivable: Receivable) => receivable.status === "OPEN" || receivable.status === "PARTIAL";

/**
 * What buyers owe us, and its filters.
 *
 * The same URL-state arrangement as the staff and partner lists: filters live
 * in the address and the server narrows, so "everything overdue in USD" is a
 * link a colleague can open, and the search reaches every record.
 */
export function ReceivablesBrowser({
  receivables,
  total,
  page,
  pageSize,
  totalPages,
  partnerName,
}: ReceivablesBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = useLocalePath();
  const [pending, startTransition] = useTransition();
  // One clock for the whole render, so two rows due the same day say the same thing.
  const [now] = useState(() => new Date());

  const [query, setQuery] = useState(params.get("q") ?? "");
  const statuses = (params.get("status") ?? "")
    .split(",")
    .filter((value): value is SettlementStatus => STATUSES.includes(value as SettlementStatus));
  const overdue = params.get("overdue") === "true";
  const guests = params.get("guests") === "true";
  const currency = params.get("currency") ?? "";
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

  const toggleStatus = (status: SettlementStatus) => {
    const next = statuses.includes(status) ? statuses.filter((value) => value !== status) : [...statuses, status];
    apply({ status: next.length ? next.join(",") : null });
  };

  const activeFilters = [
    statuses.length > 0,
    overdue,
    guests,
    currency !== "",
    partner !== "",
    query.trim() !== "",
  ].filter(Boolean).length;

  const chip = (selected: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors",
      selected
        ? "border-ink bg-ink text-on-dark"
        : "border-line bg-surface text-body hover:border-ink/40 hover:text-ink",
    );

  const href = (receivable: Receivable) => path(`/admin/finance/receivables/${receivable.id}`);

  const due = (receivable: Receivable) => {
    if (!receivable.dueAt) return <span className="text-subtle">No due date</span>;
    const late = receivable.overdue && isOpen(receivable);

    return (
      <>
        <span className={cn("block whitespace-nowrap", late ? "font-medium text-error-text" : "text-body")}>
          {formatFinanceDate(receivable.dueAt)}
        </span>
        {isOpen(receivable) && (
          <span className={cn("block text-[0.75rem]", late ? "text-error-text" : "text-muted")}>
            {dueInWords(receivable.dueAt, now)}
          </span>
        )}
      </>
    );
  };

  const debtorMeta = (receivable: Receivable) =>
    receivable.debtor.partner ? receivable.debtor.partner.reference : receivable.debtor.email || "Guest";

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
            placeholder="Reference, name or email"
            aria-label="Search receivables"
            className="h-11 w-full rounded-sm border border-line bg-background ps-9 pe-3 text-sm text-ink transition-colors focus:border-ink focus:outline-none"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
          <fieldset>
            <legend className="mb-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
              Status
            </legend>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => apply({ status: null })}
                aria-pressed={statuses.length === 0}
                className={chip(statuses.length === 0)}
              >
                All
              </button>
              {STATUSES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleStatus(value)}
                  aria-pressed={statuses.includes(value)}
                  className={chip(statuses.includes(value))}
                >
                  {settlementStatusLabels[value]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
              Show
            </legend>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => apply({ overdue: overdue ? null : "true" })}
                aria-pressed={overdue}
                className={chip(overdue)}
              >
                Overdue only
              </button>
              <button
                type="button"
                onClick={() => apply({ guests: guests ? null : "true", partner: null })}
                aria-pressed={guests}
                className={chip(guests)}
              >
                Guests only
              </button>
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
              Currency
            </legend>
            <div className="flex flex-wrap gap-2">
              {(["all", ...FINANCE_CURRENCIES] as const).map((value) => {
                const selected = value === "all" ? currency === "" : currency === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => apply({ currency: value })}
                    aria-pressed={selected}
                    className={chip(selected)}
                  >
                    {value === "all" ? "All" : value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        {partner && (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Narrowed to">
            <li>
              <button
                type="button"
                onClick={() => apply({ partner: null })}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink bg-ink px-3 py-1.5 text-[0.8125rem] text-on-dark"
              >
                Owed by {partnerName ?? "one partner"}
                <X size={13} aria-label="Remove" />
              </button>
            </li>
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <p aria-live="polite" className={cn("text-[0.8125rem] text-muted", pending && "opacity-50")}>
            {total === 1 ? "1 receivable" : `${total} receivables`}
            {activeFilters > 0 && " matching your filters"}
          </p>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                apply({ q: null, status: null, overdue: null, guests: null, currency: null, partner: null });
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
          <DataTable columns={COLUMNS} caption="Receivables">
            {receivables.length === 0 && (
              <EmptyRow colSpan={COLUMNS.length} message="Nothing owed matches your filters." />
            )}

            {/* No prefetch: each detail page reads its record, and a prefetch
                per row would spend the panel's shared rate limit. */}
            {receivables.map((receivable) => (
              <Row key={receivable.id}>
                <Cell>
                  <Link
                    href={href(receivable)}
                    prefetch={false}
                    className="font-mono text-[0.8125rem] font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {receivable.reference}
                  </Link>
                  <span className="block text-[0.75rem] text-muted">
                    {receivableSubjectLine(receivable) ?? "—"}
                  </span>
                </Cell>
                <Cell>
                  <span className="block text-ink">{receivableDebtorName(receivable)}</span>
                  <span className="block text-[0.75rem] text-muted">{debtorMeta(receivable)}</span>
                </Cell>
                <Cell align="end" hideBelow="xl" className="tabular-nums whitespace-nowrap">
                  {formatMoney(receivable.amountCents, receivable.currency)}
                </Cell>
                <Cell align="end" className="tabular-nums whitespace-nowrap">
                  <span className="font-medium text-ink">
                    {formatMoney(receivable.outstandingCents, receivable.currency)}
                  </span>
                  {receivable.refundDueCents > 0 && (
                    <span className="block text-[0.75rem] text-warning-text">
                      {formatMoney(receivable.refundDueCents, receivable.currency)} to refund
                    </span>
                  )}
                </Cell>
                <Cell>
                  <SettlementStatusBadge status={receivable.status} overdue={receivable.overdue} />
                </Cell>
                <Cell>{due(receivable)}</Cell>
                <Cell align="end">
                  <Link
                    href={href(receivable)}
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
          {receivables.length === 0 && (
            <li className="rounded-sm border border-line bg-surface p-6 text-center text-[0.8125rem] text-muted">
              Nothing owed matches your filters.
            </li>
          )}

          {receivables.map((receivable) => (
            <li key={receivable.id}>
              <Link
                href={href(receivable)}
                prefetch={false}
                className="block rounded-sm border border-line bg-surface p-4 transition-colors hover:border-ink/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{receivableDebtorName(receivable)}</p>
                    <p className="mt-0.5 truncate font-mono text-[0.75rem] text-muted">
                      {receivable.reference}
                    </p>
                  </div>
                  <SettlementStatusBadge status={receivable.status} overdue={receivable.overdue} />
                </div>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 text-[0.8125rem]">{due(receivable)}</div>
                  <p className="text-end tabular-nums">
                    <span className="block font-medium text-ink">
                      {formatMoney(receivable.outstandingCents, receivable.currency)}
                    </span>
                    <span className="block text-[0.75rem] text-muted">
                      of {formatMoney(receivable.amountCents, receivable.currency)}
                    </span>
                  </p>
                </div>
                {receivableSubjectLine(receivable) && (
                  <p className="mt-2 truncate text-[0.75rem] text-muted">{receivableSubjectLine(receivable)}</p>
                )}
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
