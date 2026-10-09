import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarClock, ClipboardCheck } from "lucide-react";

import { StatCard } from "@/components/admin/StatCard";
import { formatMoney } from "@/lib/money";
import type { FinanceSummary } from "@/types/finance";

type CurrencyFigures = FinanceSummary["currencies"][number];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * One currency's row of headline cards on the finance overview.
 *
 * Exact amounts rather than the compact tile format: on a finance screen a
 * rounded "₾0 overdue" over forty tetri is a wrong answer, not a tidy one.
 * Every figure is "now" — the summary's period only applies to cash moved,
 * which this screen does not show.
 */
export function FinanceOverviewCurrency({
  figures,
  reviewHref,
}: {
  figures: CurrencyFigures;
  /** Locale-prefixed link to the payables flagged for review. */
  reviewHref: string;
}) {
  const { currency, receivables, payables } = figures;
  const headingId = `finance-${currency}`;

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="text-[0.75rem] font-semibold tracking-[0.1em] text-muted uppercase"
      >
        {currency}
      </h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <StatCard
          label="Owed to us"
          value={formatMoney(receivables.openCents, currency)}
          icon={ArrowDownLeft}
          className="h-full"
          hint={
            receivables.refundDueCents > 0
              ? `${plural(receivables.openCount, "open bill", "open bills")} · ${formatMoney(receivables.refundDueCents, currency)} to refund`
              : plural(receivables.openCount, "open bill", "open bills")
          }
        />
        <StatCard
          label="Overdue from buyers"
          value={formatMoney(receivables.overdueCents, currency)}
          icon={AlertTriangle}
          className="h-full"
          hint={receivables.overdueCents > 0 ? "Past the date it was due" : "Nothing late"}
        />
        <StatCard
          label="We owe suppliers"
          value={formatMoney(payables.openCents, currency)}
          icon={ArrowUpRight}
          className="h-full"
          hint={plural(payables.openCount, "booking not fully paid", "bookings not fully paid")}
        />
        <StatCard
          label="Due to suppliers this week"
          value={formatMoney(payables.dueThisWeekCents, currency)}
          icon={CalendarClock}
          className="h-full"
          hint={
            payables.overdueCents > 0
              ? `Plus ${formatMoney(payables.overdueCents, currency)} already late`
              : "Nothing late"
          }
        />
        <Link
          href={reviewHref}
          prefetch={false}
          className="group block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <StatCard
            label="Needs review"
            value={String(payables.needsReviewCount)}
            icon={ClipboardCheck}
            className="h-full transition-colors group-hover:border-ink/40"
            hint={
              payables.needsReviewCount > 0
                ? "Supplier payables a person should look at — open the list"
                : "Nothing waiting for a person to look at"
            }
          />
        </Link>
      </div>
    </section>
  );
}
