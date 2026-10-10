import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { ReportAgeing, ReportMargin, ReportSummary } from "@/components/admin/finance/ReportTables";
import { ReportCommission } from "@/components/admin/finance/CommissionTables";
import { ReportsView, type ReportKind } from "@/components/admin/finance/ReportsView";
import { getAgeingReport, getFinanceSummary, getMarginReport, reportCsvUrl } from "@/lib/api/finance";
import { commissionCsvUrl, getCommissionReport } from "@/lib/api/finance-controls";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { can } from "@/types/auth";
import type { AgeingReport, MarginReport } from "@/types/finance";

export const metadata: Metadata = { title: "Finance reports" };

type Params = Record<string, string | string[] | undefined>;

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` that is a real calendar day, or undefined. */
const calendarDay = (value: string | undefined) => {
  if (!value || !DAY.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : undefined;
};

/** The Tbilisi calendar day an instant falls on, as `YYYY-MM-DD`. */
const TBILISI_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tbilisi",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const tbilisiDay = (instant: string) => {
  const parsed = new Date(instant);
  return Number.isNaN(parsed.getTime()) ? instant.slice(0, 10) : TBILISI_DAY.format(parsed);
};

/**
 * Reads the report and its filters out of the URL. Like the other register
 * screens, anything unrecognised is dropped rather than sent — the server
 * answers 400 to a malformed day or currency, and a hand-edited address should
 * show the default report rather than an error page.
 */
function reportQueryFromParams(params: Params) {
  const report = single(params.report);
  const groupBy = single(params.groupBy);
  const side = single(params.side);
  const currency = single(params.currency)?.trim().toUpperCase();

  let from = calendarDay(single(params.from));
  let to = calendarDay(single(params.to));
  // A range typed backwards is still a range; plain days compare in calendar order.
  if (from && to && from > to) [from, to] = [to, from];

  return {
    report: (report === "margin" || report === "ageing" || report === "commission" ? report : "summary") as ReportKind,
    from,
    to,
    groupBy: (groupBy === "supplier" || groupBy === "partner" ? groupBy : "product") as MarginReport["groupBy"],
    side: (side === "payables" ? "payables" : "receivables") as AgeingReport["side"],
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined,
  };
}

/**
 * The finance reports: a period summary, margin by product, supplier or
 * partner, and the ageing of open money.
 *
 * The controls live in the address (`ReportsView`), and this page reads the one
 * report they name. The summary is always read as well, without a currency
 * filter: its currencies are the options in the currency picker, and on the
 * summary tab filtering its rows here is the same answer as asking again.
 * Nothing on the screen adds two currencies together (owner decision).
 */
export default async function AdminFinanceReportsPage({
  searchParams,
}: PageProps<"/[locale]/admin/finance/reports">) {
  const session = await getSession();

  if (!can(session, "finance.reports.read")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const query = reportQueryFromParams(await searchParams);
  const canReadCommission = can(session, "finance.commission.read");
  // A hand-typed commission link without the capability shows the summary instead.
  if (query.report === "commission" && !canReadCommission) query.report = "summary";
  // Commission is grouped by partner or product only; there is no supplier side to it.
  const commissionGroup = query.groupBy === "partner" ? "partner" : "product";
  const period = { from: query.from, to: query.to };

  const [summary, margin, ageing, commission] = await Promise.all([
    getFinanceSummary(period),
    query.report === "margin"
      ? getMarginReport({ ...period, currency: query.currency, groupBy: query.groupBy })
      : null,
    query.report === "ageing" ? getAgeingReport({ side: query.side, currency: query.currency }) : null,
    query.report === "commission"
      ? getCommissionReport({ ...period, currency: query.currency, groupBy: commissionGroup })
      : null,
  ]);

  // The picker offers every currency the platform holds money in, plus any a
  // report row or the address names, so the current choice is always listed.
  const currencies = [
    ...new Set([
      ...summary.currencies.map((row) => row.currency),
      ...(margin?.rows ?? []).map((row) => row.currency),
      ...(ageing?.rows ?? []).map((row) => row.currency),
      ...(commission?.rows ?? []).map((row) => row.currency),
      ...(query.currency ? [query.currency] : []),
    ]),
  ].sort();

  // The period as the server applied it — the defaults when the address names none.
  const shownPeriod = margin ?? commission ?? summary;
  const periodDays = { from: tbilisiDay(shownPeriod.from), to: tbilisiDay(shownPeriod.to) };

  const csvQuery: Record<string, string | undefined> =
    query.report === "ageing"
      ? { side: query.side, currency: query.currency }
      : query.report === "margin"
        ? { ...period, currency: query.currency, groupBy: query.groupBy }
        : { ...period, currency: query.currency };
  const csvHref = !can(session, "finance.export")
    ? null
    : query.report === "commission"
      ? commissionCsvUrl({ ...period, currency: query.currency, groupBy: commissionGroup })
      : reportCsvUrl(query.report, csvQuery);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Finance reports"
        description="Money moved in a period, the margin on what was confirmed, and how late open money is — always one currency at a time."
      />

      <ReportsView
        report={query.report}
        from={query.from ?? ""}
        to={query.to ?? ""}
        periodFrom={periodDays.from}
        periodTo={periodDays.to}
        groupBy={query.report === "commission" ? commissionGroup : query.groupBy}
        side={query.side}
        currency={query.currency ?? ""}
        currencies={currencies}
        csvHref={csvHref}
        canReadCommission={canReadCommission}
      />

      <div className="mt-6">
        {query.report === "summary" && (
          <ReportSummary
            rows={summary.currencies.filter((row) => !query.currency || row.currency === query.currency)}
            period={periodDays}
          />
        )}
        {margin && <ReportMargin report={margin} period={periodDays} />}
        {ageing && <ReportAgeing report={ageing} />}
        {commission && <ReportCommission report={commission} period={periodDays} />}
      </div>
    </AdminContainer>
  );
}
