import { AdminPanel } from "@/components/admin/AdminPage";
import { Cell, DataTable, Row, type Column } from "@/components/admin/DataTable";
import { commissionByCurrency, rateWords } from "@/lib/admin/commission";
import { formatPartnerDate } from "@/lib/admin/partners";
import { formatBps, formatMoney } from "@/lib/money";
import type { CommissionReport } from "@/types/finance-controls";

/**
 * The commission report: what was sold, what it was worth after commission,
 * and the commission itself. One panel per currency, as on the other reports;
 * nothing here adds two currencies together.
 */

const GROUP_LABELS: Record<CommissionReport["groupBy"], string> = {
  product: "Product",
  partner: "Partner",
};

export function ReportCommission({
  report,
  period,
}: {
  report: CommissionReport;
  period: { from: string; to: string };
}) {
  const groups = commissionByCurrency(report.rows);
  const columns: Column[] = [
    { label: GROUP_LABELS[report.groupBy] },
    { label: "Bookings", align: "end" },
    { label: "Sold", align: "end" },
    { label: "Net", align: "end" },
    { label: "Commission", align: "end" },
    { label: "Commission %", align: "end" },
    { label: "Agreed rate", align: "end", hideBelow: "md" },
  ];
  const days =
    period.from === period.to
      ? formatPartnerDate(period.from)
      : `${formatPartnerDate(period.from)} – ${formatPartnerDate(period.to)}`;

  return (
    <div className="space-y-6">
      <p className="text-[0.8125rem] text-muted">
        Bookings confirmed {days} (Tbilisi days). Sold is the price the buyer was quoted, net is what is left after the
        partner&apos;s commission, and the agreed rate shows a range where it changed between bookings.
      </p>

      {groups.length === 0 ? (
        <p className="rounded-sm border border-dashed border-line p-8 text-center text-[0.875rem] text-muted">
          No commission was earned in this period.
        </p>
      ) : (
        groups.map(([currency, rows]) => (
          <AdminPanel key={currency} title={currency} bodyClassName="p-0">
            <DataTable columns={columns} caption={`Commission by ${GROUP_LABELS[report.groupBy].toLowerCase()}, ${currency}`}>
              {rows.map((row) => (
                <Row key={`${row.key}-${row.currency}`}>
                  <Cell className="font-medium text-ink">{row.label}</Cell>
                  <Cell align="end" className="tabular-nums">{row.bookings}</Cell>
                  <Cell align="end" className="tabular-nums">{formatMoney(row.sellCents, currency)}</Cell>
                  <Cell align="end" className="tabular-nums">{formatMoney(row.netCents, currency)}</Cell>
                  <Cell align="end" className="tabular-nums">{formatMoney(row.commissionCents, currency)}</Cell>
                  <Cell align="end" className="tabular-nums">
                    {row.commissionBps === null ? "—" : formatBps(row.commissionBps)}
                  </Cell>
                  <Cell align="end" hideBelow="md" className="tabular-nums">{rateWords(row.rateBps)}</Cell>
                </Row>
              ))}
            </DataTable>
          </AdminPanel>
        ))
      )}
    </div>
  );
}
