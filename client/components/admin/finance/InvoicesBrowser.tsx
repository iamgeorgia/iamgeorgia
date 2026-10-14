"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
import { invoiceKindLabels, invoiceStatusLabels } from "@/lib/admin/finance";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Invoice, InvoiceKind, InvoiceStatus } from "@/types/invoice";

import { formatFinanceDate } from "./PaymentFormat";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";

interface InvoicesBrowserProps {
  invoices: Invoice[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** The partner the list is narrowed to from a link, named for the chip. */
  partnerName?: string | null;
}

const KINDS: InvoiceKind[] = ["PROFORMA", "VAT", "ADVANCE", "FINAL", "CORRECTION"];
const STATUSES: InvoiceStatus[] = ["DRAFT", "ISSUED", "SENT", "PAID", "PARTIAL", "CANCELLED", "ERROR"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const COLUMNS: Column[] = [
  { label: "Number" },
  { label: "Addressed to" },
  { label: "Amount", align: "end" },
  { label: "Status" },
  { label: "Issued" },
  { label: "", align: "end" },
];

const legend = "mb-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase";
const dateInput =
  "h-10 rounded-sm border border-line bg-background px-3 text-sm text-ink transition-colors focus:border-ink focus:outline-none";

/**
 * The invoices list and its filters, kept in the address like the receivables
 * list so a filtered view is a link a colleague can open.
 */
export function InvoicesBrowser({ invoices, total, page, pageSize, totalPages, partnerName }: InvoicesBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = useLocalePath();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const kind = params.get("kind") ?? "";
  const statuses = (params.get("status") ?? "")
    .split(",")
    .filter((value): value is InvoiceStatus => STATUSES.includes(value as InvoiceStatus));
  const guests = params.get("guests") === "true";
  const partner = params.get("partner") ?? "";
  const fromParam = params.get("from") ?? "";
  const toParam = params.get("to") ?? "";
  const from = DAY.test(fromParam) ? fromParam : "";
  const to = DAY.test(toParam) ? toParam : "";

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

  const toggleStatus = (status: InvoiceStatus) => {
    const next = statuses.includes(status) ? statuses.filter((value) => value !== status) : [...statuses, status];
    apply({ status: next.length ? next.join(",") : null });
  };

  const activeFilters = [
    kind !== "",
    statuses.length > 0,
    guests,
    partner !== "",
    from !== "",
    to !== "",
    query.trim() !== "",
  ].filter(Boolean).length;

  const chip = (selected: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors",
      selected
        ? "border-ink bg-ink text-on-dark"
        : "border-line bg-surface text-body hover:border-ink/40 hover:text-ink",
    );

  const href = (invoice: Invoice) => path(`/admin/finance/invoices/${invoice.id}`);
  const buyerName = (invoice: Invoice) => invoice.buyer.name || invoice.receivable.debtor?.name || "Guest";

  const reference = (invoice: Invoice) =>
    invoice.receivable.reference ? (
      <Link
        href={path(`/admin/finance/receivables/${invoice.receivable.id}`)}
        prefetch={false}
        className="font-mono text-[0.75rem] text-brand-text underline-offset-4 hover:underline"
      >
        {invoice.receivable.reference}
      </Link>
    ) : null;

  const failed = (invoice: Invoice) =>
    invoice.status === "ERROR" ? <span className="block text-[0.75rem] text-error-text">see reason</span> : null;

  const issued = (invoice: Invoice) => (invoice.issueDate ? formatFinanceDate(invoice.issueDate) : "—");

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
            placeholder="Invoice number or booking reference"
            aria-label="Search invoices"
            className="h-11 w-full rounded-sm border border-line bg-background ps-9 pe-3 text-sm text-ink transition-colors focus:border-ink focus:outline-none"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
          <fieldset>
            <legend className={legend}>Kind</legend>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => apply({ kind: null })}
                aria-pressed={kind === ""}
                className={chip(kind === "")}
              >
                All
              </button>
              {KINDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => apply({ kind: kind === value ? null : value })}
                  aria-pressed={kind === value}
                  className={chip(kind === value)}
                >
                  {invoiceKindLabels[value]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={legend}>Status</legend>
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
                  {invoiceStatusLabels[value]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={legend}>Issued between</legend>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => apply({ from: event.target.value || null })}
                aria-label="Issued from"
                className={dateInput}
              />
              <span className="text-[0.8125rem] text-muted">and</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => apply({ to: event.target.value || null })}
                aria-label="Issued until"
                className={dateInput}
              />
            </div>
          </fieldset>

          <fieldset>
            <legend className={legend}>Show</legend>
            <div className="flex flex-wrap gap-2">
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
        </div>

        {partner && (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Narrowed to">
            <li>
              <button
                type="button"
                onClick={() => apply({ partner: null })}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink bg-ink px-3 py-1.5 text-[0.8125rem] text-on-dark"
              >
                Addressed to {partnerName ?? "one partner"}
                <X size={13} aria-label="Remove" />
              </button>
            </li>
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <p aria-live="polite" className={cn("text-[0.8125rem] text-muted", pending && "opacity-50")}>
            {total === 1 ? "1 invoice" : `${total} invoices`}
            {activeFilters > 0 && " matching your filters"}
          </p>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                apply({ q: null, kind: null, status: null, guests: null, partner: null, from: null, to: null });
              }}
              className="inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
            >
              <X size={13} aria-hidden />
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Link
          href={path("/admin/finance/invoices/sync-events")}
          prefetch={false}
          className="inline-flex items-center gap-1 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
        >
          Unmatched reports
          <ChevronRight size={14} className="rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>

      <div className={cn("mt-2 transition-opacity", pending && "opacity-60")}>
        <div className="hidden lg:block">
          <DataTable columns={COLUMNS} caption="Invoices">
            {invoices.length === 0 && <EmptyRow colSpan={COLUMNS.length} message="No invoices match your filters." />}

            {invoices.map((invoice) => (
              <Row key={invoice.id}>
                <Cell>
                  <Link
                    href={href(invoice)}
                    prefetch={false}
                    className={cn(
                      "underline-offset-4 hover:underline",
                      invoice.number ? "font-mono text-[0.8125rem] font-medium text-ink" : "text-[0.8125rem] text-muted",
                    )}
                  >
                    {invoice.number ?? "—"}
                  </Link>
                  <span className="block text-[0.75rem] text-muted">
                    {invoice.number
                      ? invoiceKindLabels[invoice.kind]
                      : `${invoiceKindLabels[invoice.kind]} · not issued yet`}
                  </span>
                </Cell>
                <Cell>
                  <span className="block text-ink">{buyerName(invoice)}</span>
                  {reference(invoice)}
                </Cell>
                <Cell align="end" className="font-medium whitespace-nowrap text-ink tabular-nums">
                  {formatMoney(invoice.totalCents, invoice.currency)}
                </Cell>
                <Cell>
                  <InvoiceStatusBadge status={invoice.status} />
                  {failed(invoice)}
                </Cell>
                <Cell className="whitespace-nowrap">{issued(invoice)}</Cell>
                <Cell align="end">
                  <Link
                    href={href(invoice)}
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
          {invoices.length === 0 && (
            <li className="rounded-sm border border-line bg-surface p-6 text-center text-[0.8125rem] text-muted">
              No invoices match your filters.
            </li>
          )}

          {invoices.map((invoice) => (
            <li key={invoice.id} className="rounded-sm border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={href(invoice)}
                    prefetch={false}
                    className="block truncate font-mono text-[0.875rem] font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {invoice.number ?? "Not issued yet"}
                  </Link>
                  <p className="mt-0.5 text-[0.75rem] text-muted">{invoiceKindLabels[invoice.kind]}</p>
                </div>
                <div className="text-end">
                  <InvoiceStatusBadge status={invoice.status} />
                  {failed(invoice)}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 text-[0.8125rem]">
                  <p className="truncate text-ink">{buyerName(invoice)}</p>
                  {reference(invoice)}
                </div>
                <p className="text-end tabular-nums">
                  <span className="block font-medium text-ink">{formatMoney(invoice.totalCents, invoice.currency)}</span>
                  <span className="block text-[0.75rem] text-muted">Issued {issued(invoice)}</span>
                </p>
              </div>
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
