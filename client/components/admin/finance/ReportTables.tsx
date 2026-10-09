import { AdminDefinitionList, AdminPanel } from "@/components/admin/AdminPage";
import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
import { formatPartnerDate } from "@/lib/admin/partners";
import { ageingBucketLabels } from "@/lib/admin/finance";
import { formatBps, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AgeingBucket, AgeingReport, FinanceSummary, MarginReport } from "@/types/finance";

/**
 * The finance reports' tables. Server components; the controls above them are
 * `ReportsView`.
 *
 * Every report is split by currency before it is drawn: one panel per
 * currency, and the only totals are inside a panel, over rows of the one
 * currency. Nothing here adds lari to dollars (owner decision).
 */

interface Period {
  from: string;
  to: string;
}

const periodWords = ({ from, to }: Period) =>
  from === to ? formatPartnerDate(from) : `${formatPartnerDate(from)} – ${formatPartnerDate(to)}`;

/** Rows grouped by currency, in alphabetical order of the code. */
function byCurrency<T extends { currency: string }>(rows: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.currency, [...(groups.get(row.currency) ?? []), row]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function EmptyReport({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-sm border border-dashed border-line p-8 text-center text-[0.875rem] text-muted">
      {children}
    </p>
  );
}

const sumOf = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);

// --- Summary -----------------------------------------------------------------------------

export function ReportSummary({ rows, period }: { rows: FinanceSummary["currencies"]; period: Period }) {
  if (rows.length === 0) {
    return <EmptyReport>Nothing is owed either way, and no money moved in this period.</EmptyReport>;
  }

  return (
    <div className="space-y-6">
      <p className="text-[0.8125rem] text-muted">
        Money moved {periodWords(period)} (Tbilisi days). What is owed and overdue is as of now, whatever the period.
      </p>

      {rows.map((row) => {
        const money = (cents: number) => formatMoney(cents, row.currency);

        return (
          <section key={row.currency} aria-label={row.currency} className="grid gap-4 lg:grid-cols-3">
            <AdminPanel title={`${row.currency} · Buyers owe us`} description="As of now.">
              <AdminDefinitionList
                items={[
                  { label: "Open bills", value: String(row.receivables.openCount) },
                  { label: "Owed to us", value: money(row.receivables.openCents) },
                  { label: "Of which overdue", value: <Late cents={row.receivables.overdueCents} currency={row.currency} /> },
                  { label: "Refunds due to buyers", value: money(row.receivables.refundDueCents) },
                ]}
              />
            </AdminPanel>
            <AdminPanel title={`${row.currency} · We owe suppliers`} description="As of now.">
              <AdminDefinitionList
                items={[
                  { label: "Bookings not fully paid", value: String(row.payables.openCount) },
                  { label: "We owe", value: money(row.payables.openCents) },
                  { label: "Of which late", value: <Late cents={row.payables.overdueCents} currency={row.currency} /> },
                  { label: "Due in the next 7 days", value: money(row.payables.dueThisWeekCents) },
                  { label: "Waiting for review", value: String(row.payables.needsReviewCount) },
                ]}
              />
            </AdminPanel>
            <AdminPanel title={`${row.currency} · Cash in the period`} description={periodWords(period)}>
              <AdminDefinitionList
                items={[
                  { label: "Received from buyers", value: money(row.cash.inCents) },
                  { label: "Paid to suppliers", value: money(row.cash.outCents) },
                  { label: "Refunds paid to buyers", value: money(row.cash.refundsOutCents) },
                  { label: "Refunds from suppliers", value: money(row.cash.refundsInCents) },
                ]}
              />
            </AdminPanel>
          </section>
        );
      })}
    </div>
  );
}

/** An overdue figure: emphasised when there is any, quiet when there is none. */
function Late({ cents, currency }: { cents: number; currency: string }) {
  return (
    <span className={cn("tabular-nums", cents > 0 && "text-error-text")}>{formatMoney(cents, currency)}</span>
  );
}

// --- Margin ------------------------------------------------------------------------------

const groupLabels: Record<MarginReport["groupBy"], string> = {
  product: "Product",
  supplier: "Supplier",
  partner: "Partner",
};

const marginBps = (marginCents: number, revenueCents: number) =>
  revenueCents > 0 ? Math.round((marginCents * 10_000) / revenueCents) : null;

export function ReportMargin({ report, period }: { report: MarginReport; period: Period }) {
  const groups = byCurrency(report.rows);
  const columns: Column[] = [
    { label: groupLabels[report.groupBy] },
    { label: "Bookings", align: "end" },
    { label: "Revenue", align: "end" },
    { label: "Cost", align: "end" },
    { label: "Margin", align: "end" },
    { label: "Margin %", align: "end" },
  ];

  return (
    <div className="space-y-6">
      <p className="text-[0.8125rem] text-muted">
        Bookings confirmed {periodWords(period)} (Tbilisi days). Revenue is what the buyer owes for them now — the
        full price, or the cancellation charge — and cost is what suppliers are owed for them now.
      </p>

      {groups.length === 0 ? (
        <EmptyReport>No booking was confirmed in this period.</EmptyReport>
      ) : (
        groups.map(([currency, rows]) => {
          const totals = {
            bookings: sumOf(rows, (row) => row.bookings),
            revenueCents: sumOf(rows, (row) => row.revenueCents),
            costCents: sumOf(rows, (row) => row.costCents),
            marginCents: sumOf(rows, (row) => row.marginCents),
          };

          return (
            <AdminPanel key={currency} title={currency} bodyClassName="p-0">
              <DataTable columns={columns} caption={`Margin by ${groupLabels[report.groupBy].toLowerCase()}, ${currency}`}>
                {rows.map((row) => (
                  <Row key={row.key}>
                    <Cell className="font-medium text-ink">{row.label}</Cell>
                    <Cell align="end" className="tabular-nums">{row.bookings}</Cell>
                    <Cell align="end" className="tabular-nums">{formatMoney(row.revenueCents, currency)}</Cell>
                    <Cell align="end" className="tabular-nums">{formatMoney(row.costCents, currency)}</Cell>
                    <Cell align="end" className={cn("tabular-nums", row.marginCents < 0 && "text-error-text")}>
                      {formatMoney(row.marginCents, currency)}
                    </Cell>
                    <Cell align="end" className="tabular-nums">
                      {row.marginBps === null ? "—" : formatBps(row.marginBps)}
                    </Cell>
                  </Row>
                ))}
                {rows.length > 1 && (
                  <TotalRow
                    cells={[
                      String(totals.bookings),
                      formatMoney(totals.revenueCents, currency),
                      formatMoney(totals.costCents, currency),
                      formatMoney(totals.marginCents, currency),
                      (() => {
                        const bps = marginBps(totals.marginCents, totals.revenueCents);
                        return bps === null ? "—" : formatBps(bps);
                      })(),
                    ]}
                    negative={[false, false, false, totals.marginCents < 0, false]}
                  />
                )}
              </DataTable>
            </AdminPanel>
          );
        })
      )}
    </div>
  );
}

function TotalRow({ cells, negative = [] }: { cells: string[]; negative?: boolean[] }) {
  return (
    <tr className="border-t-2 border-line bg-surface-soft/40">
      <th scope="row" className="px-4 py-3.5 text-start text-[0.875rem] font-semibold text-ink">
        Total
      </th>
      {cells.map((cell, index) => (
        <td
          key={index}
          className={cn(
            "px-4 py-3.5 text-end text-[0.875rem] font-semibold text-ink tabular-nums",
            negative[index] && "text-error-text",
          )}
        >
          {cell}
        </td>
      ))}
    </tr>
  );
}

// --- Ageing ------------------------------------------------------------------------------

/**
 * How loud a bucket is. Lateness is carried by the column heading's words as
 * well as by colour, so the emphasis is a second signal, never the only one.
 */
const bucketTone: Record<AgeingBucket, string> = {
  current: "",
  d1_30: "font-medium text-warning-text",
  d31_60: "font-medium text-error-text",
  d61_90: "font-semibold text-error-text",
  d90_plus: "font-semibold text-error-text",
};

export function ReportAgeing({ report }: { report: AgeingReport }) {
  const groups = byCurrency(report.rows);
  const buckets = report.buckets;
  const columns: Column[] = [
    { label: report.side === "payables" ? "Supplier" : "Buyer" },
    ...buckets.map((bucket) => ({ label: ageingBucketLabels[bucket], align: "end" as const })),
    { label: "Total", align: "end" },
  ];

  const amount = (cents: number, currency: string) => (cents === 0 ? "—" : formatMoney(cents, currency));

  return (
    <div className="space-y-6">
      <p className="text-[0.8125rem] text-muted">
        {report.side === "payables"
          ? "What we owe each supplier and not yet paid, by how late it is today."
          : "What each buyer owes us and has not yet paid, by how late it is today."}{" "}
        Days are counted from the date each amount was due.
      </p>

      {groups.length === 0 ? (
        <EmptyReport>
          {report.side === "payables" ? "Nothing is owed to any supplier." : "No buyer owes us anything."}
        </EmptyReport>
      ) : (
        groups.map(([currency, rows]) => (
          <AdminPanel key={currency} title={currency} bodyClassName="p-0">
            <DataTable
              columns={columns}
              caption={`${report.side === "payables" ? "Payables" : "Receivables"} ageing, ${currency}`}
            >
              {rows.length === 0 ? (
                <EmptyRow colSpan={columns.length} message="Nothing open." />
              ) : (
                rows.map((row) => (
                  <Row key={row.key}>
                    <Cell className="font-medium text-ink">{row.label}</Cell>
                    {buckets.map((bucket) => (
                      <Cell
                        key={bucket}
                        align="end"
                        className={cn("tabular-nums whitespace-nowrap", row[bucket] > 0 ? bucketTone[bucket] : "text-subtle")}
                      >
                        {amount(row[bucket], currency)}
                      </Cell>
                    ))}
                    <Cell align="end" className="font-medium whitespace-nowrap text-ink tabular-nums">
                      {formatMoney(row.totalCents, currency)}
                    </Cell>
                  </Row>
                ))
              )}
              {rows.length > 1 && (
                <TotalRow
                  cells={[
                    ...buckets.map((bucket) => amount(sumOf(rows, (row) => row[bucket]), currency)),
                    formatMoney(sumOf(rows, (row) => row.totalCents), currency),
                  ]}
                />
              )}
            </DataTable>
          </AdminPanel>
        ))
      )}
    </div>
  );
}
