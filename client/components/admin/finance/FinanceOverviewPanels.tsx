import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AdminPanel } from "@/components/admin/AdminPage";
import { formatAuditTime } from "@/lib/admin/audit";
import { dueInWords, paymentKindLabel, productLabels } from "@/lib/admin/finance";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Payable, Payment, Receivable } from "@/types/finance";

/**
 * The three short lists under the finance overview's cards: what we must pay
 * soon, what buyers should already have paid, and the latest money moved.
 *
 * Server components. Rows link with `prefetch={false}` — each detail page reads
 * its record, and prefetching eight of them per panel would spend the panel's
 * shared rate limit before anyone clicked.
 */

type PathFn = (href: string) => string;

const viewAllClass =
  "inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-text transition-colors hover:text-brand-hover";

const rowClass =
  "flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface-soft/60";

function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  return (
    <Link href={href} prefetch={false} className={viewAllClass}>
      {label}
      <ArrowRight size={14} className="rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}

/** The amount on the right, and how far off (or late) its date is. */
function AmountAndDue({
  amount,
  due,
  late,
}: {
  amount: string;
  due: string | null;
  late: boolean;
}) {
  return (
    <span className="shrink-0 text-end">
      <span className="block text-[0.875rem] font-medium text-ink tabular-nums">{amount}</span>
      {due && (
        <span className={cn("block text-[0.75rem]", late ? "font-medium text-error-text" : "text-muted")}>
          {due}
        </span>
      )}
    </span>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-10 text-center text-[0.875rem] text-muted">{children}</p>;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const SETTLEABLE = new Set(["OPEN", "PARTIAL"]);

/**
 * What falls due on the payable's next date. The list is filtered on the
 * payable's `nextDueAt`, so the instalment on that date is the one being
 * asked for; the payable's whole outstanding is the fallback.
 */
const dueNow = (payable: Payable) =>
  payable.instalments.find(
    (instalment) => SETTLEABLE.has(instalment.status) && instalment.dueAt === payable.nextDueAt,
  )?.outstandingCents ?? payable.outstandingCents;

export function FinanceOverviewPayables({
  payables,
  total,
  now,
  path,
}: {
  payables: Payable[];
  total: number;
  now: Date;
  path: PathFn;
}) {
  return (
    <AdminPanel
      title="Supplier payments due"
      description={
        payables.length > 0
          ? `${plural(total, "payment", "payments")} late or due in the next 7 days, earliest date first.`
          : "Nothing due to suppliers in the next 7 days."
      }
      action={<ViewAll href={path("/admin/finance/payables")} />}
      bodyClassName="p-0"
    >
      {payables.length === 0 ? (
        <EmptyNote>Nothing late, nothing due this week.</EmptyNote>
      ) : (
        <ul className="divide-y divide-line">
          {payables.map((payable) => (
            <li key={payable.id}>
              <Link href={path(`/admin/finance/payables/${payable.id}`)} prefetch={false} className={rowClass}>
                <span className="min-w-0">
                  <span className="block text-[0.875rem] font-medium text-ink">{payable.bookingReference}</span>
                  <span className="block truncate text-[0.75rem] text-muted">
                    {payable.supplier?.name ?? "Our own inventory"} · {productLabels[payable.product]}
                  </span>
                </span>
                <AmountAndDue
                  amount={formatMoney(dueNow(payable), payable.currency)}
                  due={dueInWords(payable.nextDueAt, now)}
                  late={Boolean(payable.nextDueAt) && new Date(payable.nextDueAt!).getTime() < now.getTime()}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}

export function FinanceOverviewReceivables({
  receivables,
  total,
  now,
  path,
}: {
  receivables: Receivable[];
  total: number;
  now: Date;
  path: PathFn;
}) {
  return (
    <AdminPanel
      title="Overdue from buyers"
      description={
        receivables.length > 0
          ? `${plural(total, "bill", "bills")} past the due date, longest late first.`
          : "Every buyer is up to date."
      }
      action={<ViewAll href={path("/admin/finance/receivables?overdue=true")} />}
      bodyClassName="p-0"
    >
      {receivables.length === 0 ? (
        <EmptyNote>No bill is past its due date.</EmptyNote>
      ) : (
        <ul className="divide-y divide-line">
          {receivables.map((receivable) => (
            <li key={receivable.id}>
              <Link
                href={path(`/admin/finance/receivables/${receivable.id}`)}
                prefetch={false}
                className={rowClass}
              >
                <span className="min-w-0">
                  <span className="block text-[0.875rem] font-medium text-ink">{receivable.reference}</span>
                  <span className="block truncate text-[0.75rem] text-muted">
                    {receivable.debtor.partner?.name ?? receivable.debtor.name}
                  </span>
                </span>
                <AmountAndDue
                  amount={formatMoney(receivable.outstandingCents, receivable.currency)}
                  due={dueInWords(receivable.dueAt, now)}
                  late
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}

export function FinanceOverviewPayments({ payments, path }: { payments: Payment[]; path: PathFn }) {
  return (
    <AdminPanel
      title="Recent payments"
      description={payments.length > 0 ? "Money in and out, newest first." : "No payment recorded yet."}
      action={<ViewAll href={path("/admin/finance/payments")} />}
      bodyClassName="p-0"
    >
      {payments.length === 0 ? (
        <EmptyNote>Payments appear here as soon as one is recorded.</EmptyNote>
      ) : (
        <ul className="divide-y divide-line">
          {payments.map((payment) => {
            const who =
              payment.counterparty.partner?.name ?? payment.counterparty.name ?? payment.counterparty.email;
            const sign = payment.direction === "OUT" ? "−" : "+";

            return (
              <li key={payment.id}>
                <Link href={path(`/admin/finance/payments/${payment.id}`)} prefetch={false} className={rowClass}>
                  <span className="min-w-0">
                    <span className="block text-[0.875rem] font-medium text-ink">
                      {paymentKindLabel(payment.direction, payment.kind)}
                    </span>
                    <span className="block truncate text-[0.75rem] text-muted">
                      {[who, payment.reference].filter(Boolean).join(" · ") || "No counterparty named"}
                    </span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="block text-[0.875rem] font-medium text-ink tabular-nums">
                      {sign}
                      {formatMoney(payment.amountCents, payment.currency)}
                    </span>
                    <span className="block text-[0.75rem] text-muted">{formatAuditTime(payment.paidAt).date}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AdminPanel>
  );
}
