import { ChartColumn, Gauge } from "lucide-react";

import { PortalFacts, PortalPanel } from "@/components/partners/PortalPage";
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

export function CreditCard({ credit, className }: { credit: CreditPosition; className?: string }) {
  const hasLimit = credit.limitCents !== null && credit.currency !== null;
  const money = (cents: number | null) =>
    cents === null || !credit.currency ? "—" : formatMoney(cents, credit.currency);
  const over = credit.availableCents !== null && credit.availableCents < 0;

  return (
    <PortalPanel
      title="Credit"
      icon={Gauge}
      description="How much your company can have open with us at once."
      className={className}
    >
      {hasLimit ? (
        <>
          <PortalFacts
            items={[
              { label: "Your limit", value: <span className="tabular-nums">{money(credit.limitCents)}</span> },
              { label: "Used", value: <span className="tabular-nums">{money(credit.outstandingCents)}</span> },
              {
                label: "Available",
                value: (
                  <span className={cn("tabular-nums", over && "text-error-text")}>{money(credit.availableCents)}</span>
                ),
              },
            ]}
          />
          <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted">
            {credit.mode === "BLOCK"
              ? "A booking that would go past your limit is refused until open invoices are settled."
              : "A booking that would go past your limit still goes through, and we are told."}
          </p>
        </>
      ) : (
        <p className="text-[0.875rem] text-body">No limit set.</p>
      )}
    </PortalPanel>
  );
}

type CommissionRow = CommissionReport["rows"][number];

const productLabel = (row: CommissionRow): string =>
  productLabels[row.key as keyof typeof productLabels] ?? (row.key === "ORDER" ? "Package" : row.label);

/** The rate as configured, else the effective commission, else nothing. */
const rateLabel = (row: CommissionRow): string =>
  rateWords(row.rateBps) !== "—"
    ? rateWords(row.rateBps)
    : row.commissionBps === null
      ? "—"
      : formatBps(row.commissionBps);

export function CommissionTable({ report }: { report: CommissionReport }) {
  const groups = commissionByCurrency(report.rows);

  return (
    <PortalPanel
      title="Your bookings this period"
      icon={ChartColumn}
      description={`Bookings confirmed ${formatDate(report.from)} – ${formatDate(report.to)}: what was sold, what you pay us after your commission, and your rate for each product.`}
    >
      {groups.length === 0 ? (
        <p className="text-[0.875rem] text-body">No bookings were confirmed in this period.</p>
      ) : (
        <div className="space-y-6">
          {groups.map(([currency, rows]) => (
            <div key={currency}>
              <p className="mb-2 text-[0.75rem] font-semibold tracking-wide text-muted uppercase">{currency}</p>

              {/* A phone gets one block per product: five columns do not fit
                  in 20rem, and a table that scrolls sideways hides the two
                  figures a partner opened this for. */}
              <ul className="divide-y divide-line sm:hidden">
                {rows.map((row) => (
                  <li key={`${row.key}-${row.currency}`} className="py-3 first:pt-1">
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-ink">{productLabel(row)}</span>
                      <span className="text-[0.8125rem] text-muted tabular-nums">
                        <bdi>
                          {row.bookings} {row.bookings === 1 ? "booking" : "bookings"}
                        </bdi>
                      </span>
                    </p>
                    <dl className="mt-2 grid grid-cols-3 gap-3 text-[0.8125rem]">
                      <div className="min-w-0">
                        <dt className="text-[0.75rem] text-muted">Sold</dt>
                        <dd className="mt-0.5 text-ink tabular-nums wrap-anywhere">{formatMoney(row.sellCents, currency)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[0.75rem] text-muted">Net</dt>
                        <dd className="mt-0.5 text-ink tabular-nums wrap-anywhere">{formatMoney(row.netCents, currency)}</dd>
                      </div>
                      <div className="min-w-0 text-end">
                        <dt className="text-[0.75rem] text-muted">Your rate</dt>
                        <dd className="mt-0.5 text-ink tabular-nums">{rateLabel(row)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>

              {/* `contain-inline-size` keeps the table's width from sizing the
                  panel and the page while the layout settles. */}
              <div className="relative hidden overflow-x-auto contain-inline-size sm:block">
                <table className="w-full min-w-[30rem] border-collapse text-start text-[0.875rem]">
                  <caption className="sr-only">Your bookings by product, {currency}</caption>
                  <thead>
                    <tr className="border-b border-line text-[0.75rem] font-semibold tracking-wide text-muted uppercase">
                      <th scope="col" className="py-2 pe-3 text-start">Product</th>
                      <th scope="col" className="px-3 py-2 text-end whitespace-nowrap">Bookings</th>
                      <th scope="col" className="px-3 py-2 text-end whitespace-nowrap">Sold</th>
                      <th scope="col" className="px-3 py-2 text-end whitespace-nowrap">Net</th>
                      <th scope="col" className="py-2 ps-3 text-end whitespace-nowrap">Your rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((row) => (
                      <tr key={`${row.key}-${row.currency}`}>
                        <th scope="row" className="py-3 pe-3 text-start font-medium text-ink">
                          {productLabel(row)}
                        </th>
                        <td className="px-3 py-3 text-end tabular-nums">{row.bookings}</td>
                        <td className="px-3 py-3 text-end whitespace-nowrap tabular-nums">{formatMoney(row.sellCents, currency)}</td>
                        <td className="px-3 py-3 text-end whitespace-nowrap tabular-nums">{formatMoney(row.netCents, currency)}</td>
                        <td className="py-3 ps-3 text-end tabular-nums">{rateLabel(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </PortalPanel>
  );
}
