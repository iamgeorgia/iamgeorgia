import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";

import {
  instalmentKindLabels,
  paymentMethodLabels,
  productLabels,
  settlementStatusLabels,
  settlementStatusTone,
  dueInWords,
} from "@/lib/admin/finance";
import { dateTimeFormat } from "@/lib/intl";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Paginated } from "@/types/partner";
import type {
  PartnerStatement,
  SettlementStatus,
  SettlementSubject,
  SupplierStatementPayable,
} from "@/types/finance";

/**
 * A partner's statement: what it owes us, booking by booking, and — for a
 * supplier — what we owe it.
 *
 * A Server Component: nothing here is interactive beyond links, and rendering
 * "5 days late" once on the server means the browser never disagrees with it
 * on hydration. Every figure is the server's (`outstandingCents`, the balances
 * per currency); nothing is added up here, and two currencies are never
 * shown as one total.
 */

export type StatementFilter = "open" | "paid" | "all";

const FILTERS: { key: StatementFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

const TONES: Record<(typeof settlementStatusTone)[SettlementStatus], string> = {
  neutral: "bg-surface-soft text-muted",
  positive: "bg-success/12 text-success",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
  info: "bg-info/12 text-info",
};

// Pinned to Tbilisi so every reader sees the same calendar day.
const formatDate = (iso: string) =>
  dateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Tbilisi" }).format(
    new Date(iso),
  );

function StatusPill({ status }: { status: SettlementStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        TONES[settlementStatusTone[status]],
      )}
    >
      {settlementStatusLabels[status]}
    </span>
  );
}

/** Where a partner opens the booking behind a line. Services have no portal page. */
const subjectHref = (subject: SettlementSubject | null): string | null =>
  subject && subject.kind !== "SERVICE" ? `/portal/bookings/${subject.reference}` : null;

export function FinanceStatement({
  statement,
  payables,
  filter,
  path,
  hrefFor,
}: {
  statement: PartnerStatement;
  /** What we owe this partner as a supplier; null or empty for an agency. */
  payables: Paginated<SupplierStatementPayable> | null;
  filter: StatementFilter;
  /** Locale-prefixes a path. */
  path: (href: string) => string;
  /** The page's URL with these query changes applied. */
  hrefFor: (changes: Record<string, string | null>) => string;
}) {
  const now = new Date();
  const balances = statement.balances.filter(
    (row) => row.outstandingCents !== 0 || row.overdueCents !== 0 || row.creditCents > 0,
  );

  return (
    <div className="mt-10 space-y-6">
      <section className="rounded-sm border border-line bg-surface p-5 sm:p-6">
        <h2 className="font-display text-[1.25rem] text-ink">Balance</h2>
        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">
          What your company owes for its bookings, in each currency it was billed in.
        </p>

        {balances.length === 0 ? (
          <p className="mt-5 text-[0.875rem] text-body">Nothing is owed at the moment.</p>
        ) : (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {balances.map((row) => (
              <li key={row.currency} className="rounded-sm border border-line p-4">
                <p className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">{row.currency}</p>
                <dl className="mt-2 space-y-1.5 text-[0.875rem]">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">Outstanding</dt>
                    <dd className="font-medium text-ink tabular-nums">
                      {formatMoney(row.outstandingCents, row.currency)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">Overdue</dt>
                    <dd
                      className={cn(
                        "tabular-nums",
                        row.overdueCents > 0 ? "font-semibold text-error-text" : "text-body",
                      )}
                    >
                      {formatMoney(row.overdueCents, row.currency)}
                    </dd>
                  </div>
                  {row.creditCents > 0 && (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted">We owe you</dt>
                      <dd className="font-medium text-success tabular-nums">
                        {formatMoney(row.creditCents, row.currency)}
                      </dd>
                    </div>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        )}
        {balances.some((row) => row.creditCents > 0) && (
          <p className="mt-4 text-[0.75rem] leading-relaxed text-subtle">
            &ldquo;We owe you&rdquo; is money you paid for bookings that were later cancelled or
            reduced. Our finance team refunds it or sets it against your next bookings.
          </p>
        )}
      </section>

      <section className="rounded-sm border border-line bg-surface">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="min-w-0">
            <h2 className="font-display text-[1.25rem] text-ink">Bookings</h2>
            <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">
              {statement.total === 0
                ? "No bookings match this filter."
                : `${statement.total} ${statement.total === 1 ? "booking" : "bookings"}, soonest due first.`}
            </p>
          </div>
          <nav aria-label="Filter by status" className="flex shrink-0 gap-1 rounded-sm bg-surface-soft p-1">
            {FILTERS.map((item) => (
              <Link
                key={item.key}
                href={hrefFor({ status: item.key === "open" ? null : item.key, page: null })}
                aria-current={filter === item.key ? "page" : undefined}
                className={cn(
                  "rounded-sm px-3 py-1.5 text-[0.8125rem] font-medium transition-colors",
                  filter === item.key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {statement.data.length > 0 && (
          <ul className="divide-y divide-line border-t border-line">
            {statement.data.map((row) => {
              const href = subjectHref(row.subject);
              const reference = row.subject?.reference ?? row.reference;
              const due = dueInWords(row.dueAt, now);
              const open = row.status === "OPEN" || row.status === "PARTIAL";

              return (
                <li key={row.id} className="p-5 sm:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        {href ? (
                          <Link
                            href={path(href)}
                            className="font-medium text-ink underline-offset-4 hover:underline"
                          >
                            {reference}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink">{reference}</span>
                        )}
                        <StatusPill status={row.status} />
                        {row.overdue && open && (
                          <span className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-error-text">
                            <AlertTriangle size={13} aria-hidden />
                            Overdue
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-[0.8125rem] text-muted">
                        {row.dueAt ? (
                          <>
                            Due {formatDate(row.dueAt)}
                            {open && due && (
                              <span className={cn(row.overdue && "text-error-text")}> · {due}</span>
                            )}
                          </>
                        ) : (
                          "No due date yet"
                        )}
                        {row.subject && row.subject.reference !== row.reference && ` · ${row.reference}`}
                      </p>
                    </div>
                    <p className="text-end">
                      <span className="block text-[0.6875rem] tracking-wide text-muted uppercase">Outstanding</span>
                      <span
                        className={cn(
                          "text-[1rem] font-semibold tabular-nums",
                          row.overdue && open ? "text-error-text" : "text-ink",
                        )}
                      >
                        {formatMoney(row.outstandingCents, row.currency)}
                      </span>
                    </p>
                  </div>

                  <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[0.8125rem]">
                    <div className="flex gap-1.5">
                      <dt className="text-muted">Owed</dt>
                      <dd className="text-body tabular-nums">{formatMoney(row.amountCents, row.currency)}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-muted">Paid</dt>
                      <dd className="text-body tabular-nums">{formatMoney(row.paidCents, row.currency)}</dd>
                    </div>
                    {row.refundDueCents > 0 && (
                      <div className="flex gap-1.5">
                        <dt className="text-muted">We owe you</dt>
                        <dd className="font-medium text-success tabular-nums">
                          {formatMoney(row.refundDueCents, row.currency)}
                        </dd>
                      </div>
                    )}
                  </dl>

                  {row.payments.length > 0 && (
                    <ul className="mt-3 space-y-1 border-s-2 border-line ps-3">
                      {row.payments.map((payment, index) => (
                        <li key={index} className="text-[0.8125rem] text-muted">
                          <span className="tabular-nums text-body">
                            {payment.amountCents < 0 ? "Refunded " : "Paid "}
                            {formatMoney(Math.abs(payment.amountCents), row.currency)}
                          </span>
                          {payment.paidAt && ` on ${formatDate(payment.paidAt)}`}
                          {payment.method && ` · ${paymentMethodLabels[payment.method]}`}
                          {payment.reference && ` · ${payment.reference}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <Pager
          page={statement.page}
          totalPages={statement.totalPages}
          hrefFor={(page) => hrefFor({ page: page > 1 ? String(page) : null })}
        />
      </section>

      {payables && payables.data.length > 0 && (
        <section className="rounded-sm border border-line bg-surface">
          <div className="p-5 sm:p-6">
            <h2 className="font-display text-[1.25rem] text-ink">What we owe you</h2>
            <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">
              Our payments to you for the bookings you supply, and when each part is due.
            </p>
          </div>

          <ul className="divide-y divide-line border-t border-line">
            {payables.data.map((row) => (
              <li key={row.id} className="p-5 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{row.bookingReference}</span>
                      <StatusPill status={row.status} />
                    </p>
                    <p className="mt-1 text-[0.8125rem] text-muted">{productLabels[row.product]}</p>
                  </div>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[0.8125rem]">
                    <div className="flex gap-1.5">
                      <dt className="text-muted">Amount</dt>
                      <dd className="text-body tabular-nums">{formatMoney(row.amountCents, row.currency)}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-muted">Paid</dt>
                      <dd className="text-body tabular-nums">{formatMoney(row.paidCents, row.currency)}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-muted">Still to pay</dt>
                      <dd className="font-medium text-ink tabular-nums">
                        {formatMoney(row.outstandingCents, row.currency)}
                      </dd>
                    </div>
                  </dl>
                </div>

                {row.instalments.length > 0 && (
                  <ul className="mt-3 space-y-1 border-s-2 border-line ps-3">
                    {row.instalments.map((instalment) => (
                      <li
                        key={instalment.sequence}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted"
                      >
                        <span className="text-body">
                          {instalmentKindLabels[instalment.kind]}{" "}
                          <span className="tabular-nums">{formatMoney(instalment.amountCents, row.currency)}</span>
                        </span>
                        <span>
                          {instalment.dueAt ? `due ${formatDate(instalment.dueAt)}` : "no due date yet"}
                        </span>
                        {instalment.paidCents > 0 && instalment.status !== "PAID" && (
                          <span className="tabular-nums">
                            · {formatMoney(instalment.paidCents, row.currency)} paid
                          </span>
                        )}
                        <span>· {settlementStatusLabels[instalment.status]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          <Pager
            page={payables.page}
            totalPages={payables.totalPages}
            hrefFor={(page) => hrefFor({ spage: page > 1 ? String(page) : null })}
          />
        </section>
      )}
    </div>
  );
}

function Pager({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const button =
    "inline-flex h-10 items-center gap-1 rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft";
  const disabled = "pointer-events-none opacity-40";

  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line p-5 sm:px-6" aria-label="Pagination">
      <Link
        href={hrefFor(Math.max(1, page - 1))}
        aria-disabled={page <= 1}
        tabIndex={page <= 1 ? -1 : undefined}
        className={cn(button, page <= 1 && disabled)}
      >
        <ChevronLeft size={15} aria-hidden className="rtl:-scale-x-100" />
        Previous
      </Link>
      <span className="text-[0.8125rem] text-muted">
        Page {page} of {totalPages}
      </span>
      <Link
        href={hrefFor(Math.min(totalPages, page + 1))}
        aria-disabled={page >= totalPages}
        tabIndex={page >= totalPages ? -1 : undefined}
        className={cn(button, page >= totalPages && disabled)}
      >
        Next
        <ChevronRight size={15} aria-hidden className="rtl:-scale-x-100" />
      </Link>
    </nav>
  );
}
