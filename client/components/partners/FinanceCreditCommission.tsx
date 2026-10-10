import { commissionByCurrency, rateWords } from "@/lib/admin/commission";
import { productLabels } from "@/lib/admin/finance";
import { dateTimeFormat } from "@/lib/intl";
import { formatBps, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CommissionReport, CreditPosition } from "@/types/finance-controls";

/**
 * A partner's credit position and what its bookings earned it, for the top of
 * the finance page. Server components; every figure is the server's and two
 * currencies are never added together.
 */

// Pinned to Tbilisi so every reader sees the same calendar day.
const formatDate = (iso: string) =>
  dateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Tbilisi" }).format(
    new Date(iso),
  );

export function CreditCard({ credit }: { credit: CreditPosition }) {
  const hasLimit = credit.limitCents !== null && credit.currency !== null;
  const money = (cents: number | null) =>
    cents === null || !credit.currency ? "—" : formatMoney(cents, credit.currency);
  const over = credit.availableCents !== null && credit.availableCents < 0;

  return (
    <section className="rounded-sm border border-line bg-surface p-5 sm:p-6">
      <h2 className="font-display text-[1.25rem] text-ink">Credit</h2>
      <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">
        How much your company can have open with us at once.
      </p>

      {hasLimit ? (
        <>
          <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-sm border border-line p-4">
              <dt className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">Your limit</dt>
              <dd className="mt-1.5 text-[1.125rem] font-medium text-ink tabular-nums">{money(credit.limitCents)}</dd>
            </div>
            <div className="rounded-sm border border-line p-4">
              <dt className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">Used</dt>
              <dd className="mt-1.5 text-[1.125rem] font-medium text-ink tabular-nums">{money(credit.outstandingCents)}</dd>
            </div>
            <div className="rounded-sm border border-line p-4">
              <dt className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">Available</dt>
              <dd className={cn("mt-1.5 text-[1.125rem] font-medium tabular-nums", over ? "text-error-text" : "text-ink")}>
                {money(credit.availableCents)}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted">
            {credit.mode === "BLOCK"
              ? "A booking that would go past your limit is refused until open invoices are settled."
              : "A booking that would go past your limit still goes through, and we are told."}
          </p>
        </>
      ) : (
        <p className="mt-5 text-[0.875rem] text-body">No limit set.</p>
      )}
    </section>
  );
}

export function CommissionTable({ report }: { report: CommissionReport }) {
  const groups = commissionByCurrency(report.rows);

  return (
    <section className="rounded-sm border border-line bg-surface p-5 sm:p-6">
      <h2 className="font-display text-[1.25rem] text-ink">Your bookings this period</h2>
      <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">
        Bookings confirmed {formatDate(report.from)} – {formatDate(report.to)}: what was sold, what you pay us after your
        commission, and your rate for each product.
      </p>

      {groups.length === 0 ? (
        <p className="mt-5 text-[0.875rem] text-body">No bookings were confirmed in this period.</p>
      ) : (
        <div className="mt-5 space-y-6">
          {groups.map(([currency, rows]) => (
            <div key={currency}>
              <p className="mb-2 text-[0.75rem] font-semibold tracking-wide text-muted uppercase">{currency}</p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-start text-[0.875rem]">
                  <caption className="sr-only">Your bookings by product, {currency}</caption>
                  <thead>
                    <tr className="border-b border-line text-[0.75rem] font-semibold tracking-wide text-muted uppercase">
                      <th scope="col" className="py-2 pe-3 text-start">Product</th>
                      <th scope="col" className="px-3 py-2 text-end">Bookings</th>
                      <th scope="col" className="px-3 py-2 text-end">Sold</th>
                      <th scope="col" className="px-3 py-2 text-end">Net</th>
                      <th scope="col" className="py-2 ps-3 text-end">Your rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((row) => (
                      <tr key={`${row.key}-${row.currency}`}>
                        <th scope="row" className="py-3 pe-3 text-start font-medium text-ink">
                          {productLabels[row.key as keyof typeof productLabels] ?? (row.key === "ORDER" ? "Package" : row.label)}
                        </th>
                        <td className="px-3 py-3 text-end tabular-nums">{row.bookings}</td>
                        <td className="px-3 py-3 text-end tabular-nums">{formatMoney(row.sellCents, currency)}</td>
                        <td className="px-3 py-3 text-end tabular-nums">{formatMoney(row.netCents, currency)}</td>
                        <td className="py-3 ps-3 text-end tabular-nums">
                          {rateWords(row.rateBps) !== "—"
                            ? rateWords(row.rateBps)
                            : row.commissionBps === null
                              ? "—"
                              : formatBps(row.commissionBps)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
