import Link from "next/link";
import { Banknote, HandCoins, ReceiptText } from "lucide-react";

import { SettlementStatusBadge } from "@/components/admin/finance/SettlementStatusBadge";
import { LinkPager } from "@/components/partners/LinkPager";
import { PortalEmpty, PortalPanel } from "@/components/partners/PortalPage";
import {
  instalmentKindLabels,
  paymentMethodLabels,
  productLabels,
  settlementStatusLabels,
  dueInWords,
} from "@/lib/admin/finance";
import { dateTimeFormat } from "@/lib/intl";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Paginated } from "@/types/partner";
import type { PartnerStatement, SettlementSubject, SupplierStatementPayable } from "@/types/finance";

/**
 * A partner's statement: what it owes us, booking by booking, and — for a
 * supplier — what we owe it. Three panels, so the finance page can lead with
 * the balance and put the lists beneath it.
 *
 * Server Components: nothing here is interactive beyond links, and rendering
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

// Pinned to Tbilisi so every reader sees the same calendar day.
const formatDate = (iso: string) =>
  dateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Tbilisi" }).format(
    new Date(iso),
  );

/** Where a partner opens the booking behind a line. Services have no portal page. */
const subjectHref = (subject: SettlementSubject | null): string | null =>
  subject && subject.kind !== "SERVICE" ? `/portal/bookings/${subject.reference}` : null;

/** What the company owes, one block per currency it was billed in. */
export function BalancePanel({ statement, className }: { statement: PartnerStatement; className?: string }) {
  const balances = statement.balances.filter(
    (row) => row.outstandingCents !== 0 || row.overdueCents !== 0 || row.creditCents > 0,
  );

  return (
    <PortalPanel
      title="Balance"
      icon={Banknote}
      description="What your company owes for its bookings, in each currency it was billed in."
      className={className}
    >
      {balances.length === 0 ? (
        <p className="text-[0.875rem] text-body">Nothing is owed at the moment.</p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {balances.map((row) => (
              <li key={row.currency} className="rounded-sm border border-line p-4">
                <p className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">{row.currency}</p>
                <p className="mt-1 text-[1.375rem] leading-tight font-semibold text-ink tabular-nums">
                  {formatMoney(row.outstandingCents, row.currency)}
                </p>
                <p className="text-[0.75rem] text-muted">Outstanding</p>
                <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[0.8125rem]">
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
          {balances.some((row) => row.creditCents > 0) && (
            <p className="mt-4 text-[0.75rem] leading-relaxed text-subtle">
              &ldquo;We owe you&rdquo; is money you paid for bookings that were later cancelled or
              reduced. Our finance team refunds it or sets it against your next bookings.
            </p>
          )}
        </>
      )}
    </PortalPanel>
  );
}

/** The bookings the company is billed for, soonest due first, with the Open / Paid / All switch. */
export function StatementPanel({
  statement,
  filter,
  path,
  hrefFor,
}: {
  statement: PartnerStatement;
  filter: StatementFilter;
  /** Locale-prefixes a path. */
  path: (href: string) => string;
  /** The page's URL with these query changes applied. */
  hrefFor: (changes: Record<string, string | null>) => string;
}) {
  const now = new Date();

  return (
    <PortalPanel
      id="statement"
      title="Bookings billed"
      icon={ReceiptText}
      description={
        statement.total === 0
          ? "No bookings match this filter."
          : <bdi>{`${statement.total} ${statement.total === 1 ? "booking" : "bookings"}, soonest due first.`}</bdi>
      }
      action={
        <nav aria-label="Filter by status" className="flex gap-1 rounded-sm bg-surface-soft p-1">
          {FILTERS.map((item) => (
            <Link
              key={item.key}
              href={hrefFor({ status: item.key === "open" ? null : item.key, page: null })}
              aria-current={filter === item.key ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center rounded-sm px-3 text-[0.8125rem] font-medium transition-colors",
                filter === item.key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      }
      bodyClassName=""
    >
      {statement.data.length === 0 ? (
        <PortalEmpty>
          {filter === "open"
            ? "Nothing is waiting to be paid. Bookings appear here as soon as they are billed."
            : "Nothing to show for this filter."}
        </PortalEmpty>
      ) : (
        <ul className="divide-y divide-line">
          {statement.data.map((row) => {
            const href = subjectHref(row.subject);
            const reference = row.subject?.reference ?? row.reference;
            const due = dueInWords(row.dueAt, now);
            const open = row.status === "OPEN" || row.status === "PARTIAL";
            const late = row.overdue && open;

            return (
              <li key={row.id} className="px-4 py-4 sm:px-5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                      {href ? (
                        <Link
                          href={path(href)}
                          className="font-mono text-[0.875rem] font-medium text-brand-text underline decoration-brand-text/30 underline-offset-4 transition-colors hover:decoration-current"
                        >
                          {reference}
                        </Link>
                      ) : (
                        <span className="font-mono text-[0.875rem] font-medium text-ink">{reference}</span>
                      )}
                      <SettlementStatusBadge status={row.status} overdue={row.overdue} />
                    </p>
                    <p className="mt-1.5 text-[0.8125rem] text-muted">
                      {row.dueAt ? (
                        <>
                          Due {formatDate(row.dueAt)}
                          {open && due && <span className={cn(late && "text-error-text")}> · {due}</span>}
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
                        "text-[1rem] font-semibold whitespace-nowrap tabular-nums",
                        late ? "text-error-text" : "text-ink",
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
                        <span className="text-body tabular-nums">
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

      <LinkPager
        page={statement.page}
        totalPages={statement.totalPages}
        label="Billed bookings pages"
        hrefFor={(page) => `${hrefFor({ page: page > 1 ? String(page) : null })}#statement`}
      />
    </PortalPanel>
  );
}

/** What we owe a supplier. Absent for an agency, which has nothing here. */
export function PayablesPanel({
  payables,
  hrefFor,
}: {
  payables: Paginated<SupplierStatementPayable>;
  hrefFor: (changes: Record<string, string | null>) => string;
}) {
  return (
    <PortalPanel
      id="payables"
      title="What we owe you"
      icon={HandCoins}
      description="Our payments to you for the bookings you supply, and when each part is due."
      bodyClassName=""
    >
      <ul className="divide-y divide-line">
        {payables.data.map((row) => (
          <li key={row.id} className="px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <span className="font-mono text-[0.875rem] font-medium text-ink">{row.bookingReference}</span>
                  <SettlementStatusBadge status={row.status} />
                </p>
                <p className="mt-1.5 text-[0.8125rem] text-muted">{productLabels[row.product]}</p>
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
                    <span>{instalment.dueAt ? `due ${formatDate(instalment.dueAt)}` : "no due date yet"}</span>
                    {instalment.paidCents > 0 && instalment.status !== "PAID" && (
                      <span className="tabular-nums">· {formatMoney(instalment.paidCents, row.currency)} paid</span>
                    )}
                    <span>· {settlementStatusLabels[instalment.status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <LinkPager
        page={payables.page}
        totalPages={payables.totalPages}
        label="Payables pages"
        hrefFor={(page) => `${hrefFor({ spage: page > 1 ? String(page) : null })}#payables`}
      />
    </PortalPanel>
  );
}
