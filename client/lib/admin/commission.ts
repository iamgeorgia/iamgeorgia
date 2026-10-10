import { formatBps } from "@/lib/money";
import type { CommissionRow } from "@/types/finance-controls";

/** A commission rate for display: one figure, a range where it varied, or a dash. */
export const rateWords = (rate: CommissionRow["rateBps"]): string => {
  if (rate === null) return "—";
  if (typeof rate === "number") return formatBps(rate);
  return rate.min === rate.max ? formatBps(rate.min) : `${formatBps(rate.min)} – ${formatBps(rate.max)}`;
};

/** Rows grouped by currency, in alphabetical order of the code. */
export function commissionByCurrency(rows: CommissionRow[]): [string, CommissionRow[]][] {
  const groups = new Map<string, CommissionRow[]>();
  for (const row of rows) groups.set(row.currency, [...(groups.get(row.currency) ?? []), row]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
