"use client";

import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "../DataTable";
import {
  PAYABLE_CURRENCIES,
  PAYABLE_PRODUCTS,
  PAYABLE_STATUS_FILTERS,
  formatPayableDate,
  isPayableLate,
  type PayableStatusFilter,
} from "./PayableFormat";
import { PayableStatusBadge } from "./PayableStatusBadge";
import { dueInWords, productLabels, reviewReasonLabels, settlementStatusLabels } from "@/lib/admin/finance";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Payable } from "@/types/finance";

interface PayablesBrowserProps {
  payables: Payable[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const COLUMNS: Column[] = [
  { label: "Booking" },
  { label: "Supplier" },
  { label: "Owed", align: "end" },
  { label: "Outstanding", align: "end" },
  { label: "Status" },
  { label: "Next due" },
  { label: "", align: "end" },
];

const statusFilterLabel = (value: PayableStatusFilter | "all") =>
  value === "all" ? "All" : value === "unsettled" ? "Still to pay" : settlementStatusLabels[value];

/**
 * The payables table and its filters.
 *
 * Same arrangement as the staff and partners registers: the filters live in
 * the URL and the server does the narrowing, so a filtered view is a link and
 * the reference search reaches every payable rather than the twenty on screen.
 * Every amount is shown in the payable's own currency; nothing here adds two
 * payables together.
 */
export function PayablesBrowser({ payables, total, page, pageSize, totalPages }: PayablesBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = useLocalePath();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const status = params.get("status") ?? "all";
  const product = params.get("product") ?? "all";
  const currency = params.get("currency") ?? "all";
  const review = params.get("review") === "1";
  const platform = params.get("platform") === "1";

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }

    // A narrower filter makes the old page number meaningless.
    if (!("page" in changes)) next.delete("page");

    const search = next.toString();
    startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname));
  };

  // Debounced: one navigation per pause in typing, not one per keystroke.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (query === current) return;

    const timer = setTimeout(() => apply({ q: query.trim() || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const activeFilters = [
    status !== "all",
    product !== "all",
    currency !== "all",
    review,
    platform,
    query.trim() !== "",
  ].filter(Boolean).length;

  const chip = (selected: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors",
      selected
        ? "border-ink bg-ink text-on-dark"
        : "border-line bg-surface text-body hover:border-ink/40 hover:text-ink",
    );

  const field =
    "h-10 w-full rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink sm:w-auto";

  const href = (payable: Payable) => path(`/admin/finance/payables/${payable.id}`);

  const supplierName = (payable: Payable) => payable.supplier?.name ?? "Platform";

  const nextDue = (payable: Payable) => {
    if (!payable.nextDueAt) {
      return <span className="text-subtle">{payable.outstandingCents > 0 ? "No date" : "—"}</span>;
    }

    const late = isPayableLate(payable);

    return (
      <>
        <span className={cn("block", late ? "text-error-text" : "text-body")}>
          {formatPayableDate(payable.nextDueAt, payable.timezone)}
        </span>
        <span className={cn("block text-[0.75rem]", late ? "font-medium text-error-text" : "text-muted")}>
          {dueInWords(payable.nextDueAt)}
        </span>
      </>
    );
  };

  const reviewFlag = (payable: Payable) =>
    payable.needsReview ? (
      <span className="mt-1 inline-flex items-center gap-1 text-[0.75rem] font-medium text-warning-text">
        <AlertTriangle size={12} className="shrink-0" aria-hidden />
        {payable.reviewReason ? (reviewReasonLabels[payable.reviewReason] ?? "Needs review") : "Needs review"}
      </span>
    ) : null;

  return (
    <section className="mt-8">
      <div className="rounded-sm border border-line bg-surface p-4 sm:p-5">
        <FilterDisclosure
          count={Math.max(0, activeFilters - (query.trim() !== "" ? 1 : 0))}
          lead={
          <div className="relative min-w-0 flex-1 sm:min-w-[16rem]">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Booking reference"
              aria-label="Search payables by booking reference"
              className="h-10 w-full rounded-sm border border-line bg-background ps-9 pe-3 text-sm text-ink transition-colors focus:border-ink focus:outline-none"
            />
          </div>
          }
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <select
              value={product}
              onChange={(event) => apply({ product: event.target.value })}
              aria-label="Filter by product"
              className={field}
            >
              <option value="all">All products</option>
              {PAYABLE_PRODUCTS.map((value) => (
                <option key={value} value={value}>
                  {productLabels[value]}
                </option>
              ))}
            </select>

            <select
              value={currency}
              onChange={(event) => apply({ currency: event.target.value })}
              aria-label="Filter by currency"
              className={field}
            >
              <option value="all">All currencies</option>
              {PAYABLE_CURRENCIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
            <fieldset>
              <legend className="mb-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
                Status
              </legend>
              <div className="flex flex-wrap gap-2">
                {(["all", ...PAYABLE_STATUS_FILTERS] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => apply({ status: value })}
                    aria-pressed={status === value}
                    className={chip(status === value)}
                  >
                    {statusFilterLabel(value)}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
                Show only
              </legend>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => apply({ review: review ? null : "1" })}
                  aria-pressed={review}
                  className={chip(review)}
                >
                  Needs review
                </button>
                <button
                  type="button"
                  onClick={() => apply({ platform: platform ? null : "1" })}
                  aria-pressed={platform}
                  className={chip(platform)}
                >
                  Platform inventory only
                </button>
              </div>
            </fieldset>
          </div>
        </FilterDisclosure>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <p aria-live="polite" className={cn("text-[0.8125rem] text-muted", pending && "opacity-50")}>
            {total === 1 ? "1 payable" : `${total} payables`}
            {activeFilters > 0 && " matching your filters"}
          </p>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                apply({ q: null, status: null, product: null, currency: null, review: null, platform: null });
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
          <DataTable columns={COLUMNS} caption="Supplier payables">
            {payables.length === 0 && (
              <EmptyRow colSpan={COLUMNS.length} message="No payables match your filters." />
            )}

            {/* No prefetch: a prefetch per row would spend the panel's shared rate limit. */}
            {payables.map((payable) => (
              <Row key={payable.id}>
                <Cell>
                  <Link
                    href={href(payable)}
                    prefetch={false}
                    className="font-mono text-[0.8125rem] font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {payable.bookingReference}
                  </Link>
                  <span className="block text-[0.75rem] text-muted">{productLabels[payable.product]}</span>
                  {reviewFlag(payable)}
                </Cell>
                <Cell>
                  <span className={payable.supplier ? "text-body" : "text-muted"}>{supplierName(payable)}</span>
                </Cell>
                <Cell align="end" className="tabular-nums">
                  {formatMoney(payable.amountCents, payable.currency)}
                  {payable.refundDueCents > 0 && (
                    <span className="block text-[0.75rem] text-warning-text">
                      {formatMoney(payable.refundDueCents, payable.currency)} to come back
                    </span>
                  )}
                </Cell>
                <Cell align="end" className="font-medium tabular-nums text-ink">
                  {formatMoney(payable.outstandingCents, payable.currency)}
                </Cell>
                <Cell>
                  <PayableStatusBadge status={payable.status} />
                </Cell>
                <Cell>{nextDue(payable)}</Cell>
                <Cell align="end">
                  <Link
                    href={href(payable)}
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
          {payables.length === 0 && (
            <li className="rounded-sm border border-line bg-surface p-6 text-center text-[0.8125rem] text-muted">
              No payables match your filters.
            </li>
          )}

          {payables.map((payable) => {
            const late = isPayableLate(payable);

            return (
              <li key={payable.id}>
                <Link
                  href={href(payable)}
                  prefetch={false}
                  className="block rounded-sm border border-line bg-surface p-4 transition-colors hover:border-ink/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[0.8125rem] font-medium text-ink">
                        {payable.bookingReference}
                      </p>
                      <p className="mt-0.5 truncate text-[0.75rem] text-muted">
                        {productLabels[payable.product]} · {supplierName(payable)}
                      </p>
                    </div>
                    <PayableStatusBadge status={payable.status} />
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.8125rem]">
                    <div className="min-w-0">
                      <dt className="text-[0.75rem] text-muted">Outstanding</dt>
                      <dd className="font-medium tabular-nums text-ink">
                        {formatMoney(payable.outstandingCents, payable.currency)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[0.75rem] text-muted">Owed</dt>
                      <dd className="tabular-nums text-body">{formatMoney(payable.amountCents, payable.currency)}</dd>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <dt className="text-[0.75rem] text-muted">Next due</dt>
                      <dd className={late ? "text-error-text" : "text-body"}>
                        {payable.nextDueAt
                          ? `${formatPayableDate(payable.nextDueAt, payable.timezone)} · ${dueInWords(payable.nextDueAt)}`
                          : payable.outstandingCents > 0
                            ? "No date"
                            : "—"}
                      </dd>
                    </div>
                  </dl>

                  {payable.refundDueCents > 0 && (
                    <p className="mt-2 text-[0.75rem] text-warning-text">
                      {formatMoney(payable.refundDueCents, payable.currency)} to come back from the supplier
                    </p>
                  )}
                  {reviewFlag(payable)}
                </Link>
              </li>
            );
          })}
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
