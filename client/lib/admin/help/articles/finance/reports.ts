import type { HelpArticle } from "../../types";

/**
 * `/admin/finance/reports` (`finance/reports/page.tsx`, `ReportsView`,
 * `ReportTables`, reading `GET /api/admin/finance/reports/{summary,margin,ageing}`).
 * Encodes: the `finance.reports.read` guard; the URL keys `report`, `from`,
 * `to`, `groupBy`, `side`, `currency`; the 30-day default period in Tbilisi
 * days; revenue and cost as defined in `server/services/finance/report.service.js`;
 * the five ageing buckets; CSV behind `finance.export`, recorded by
 * `recordExport` in the audit log.
 */
export const article = {
  id: "fn-reports",
  title: "Finance reports",
  summary: "The summary, margin and ageing reports, per currency, and exporting them.",
  category: "finance",
  routes: ["/admin/finance/reports"],
  keywords: [
    "finance",
    "money",
    "accounts",
    "report",
    "margin",
    "profit",
    "revenue",
    "cost",
    "ageing",
    "aging",
    "overdue",
    "csv",
    "export",
    "excel",
    "spreadsheet",
  ],
  related: ["fn-overview", "fn-payables", "fn-receivables", "fn-payments"],
  blocks: [
    { type: "where", path: ["Sidebar", "Finance", "Reports"] },
    {
      type: "paragraph",
      text: "Three reports over the same records the rest of Finance shows. Pick one with the buttons at the top; the controls under them change with the report. Every choice is kept in the page address, so a report — say, margin by supplier for September in lari — can be bookmarked or pasted to a colleague who can read Finance.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Always one currency at a time",
      text: "Every report is split by currency, one panel each, and totals are only ever over one currency. Choose a currency to see just that one, or **All currencies** for a panel per currency.",
    },
    { type: "heading", id: "periods", text: "Periods" },
    {
      type: "paragraph",
      text: "The summary and the margin report cover a period: whole days in Tbilisi time, both ends included. With no dates chosen it is the last 30 days, up to and including today. **Last 30 days** next to the dates goes back to that default. The ageing report has no period — it is always “as of now”.",
    },
    { type: "heading", id: "summary", text: "Summary" },
    {
      type: "paragraph",
      text: "Per currency, three panels. **Buyers owe us** and **We owe suppliers** are as of now, whatever the period: open bills and payables, what is overdue or late, refunds owed back to buyers, what falls due to suppliers in the next seven days and how many payables wait for review. **Cash in the period** is the money that actually moved between the two dates: received from buyers, paid to suppliers, refunds paid to buyers and refunds received from suppliers.",
    },
    { type: "heading", id: "margin", text: "Margin" },
    {
      type: "paragraph",
      text: "The bookings confirmed in the period, grouped by **Product**, **Supplier** or **Partner** (the agency that bought), with what we made on them.",
    },
    {
      type: "definitions",
      items: [
        { term: "Revenue", description: "What the buyer owes for those bookings now — the full price, or only the cancellation charge if a booking was cancelled. A part of a package counts at its own product's price." },
        { term: "Cost", description: "What the suppliers are owed for those bookings now, after any cancellation." },
        { term: "Margin", description: "Revenue minus cost. Shown in red when it is below zero." },
        { term: "Margin %", description: "Margin as a share of revenue. A dash when there is no revenue to divide by." },
      ],
    },
    {
      type: "paragraph",
      text: "Because both figures are “now”, a margin for last month can change if a booking from last month is cancelled or an amount is corrected today.",
    },
    { type: "heading", id: "ageing", text: "Ageing" },
    {
      type: "paragraph",
      text: "Open money per buyer (**Owed to us**) or per supplier (**We owe**), split by how late it is today, counted from the date each amount was due. The later columns are drawn louder so the worst debts stand out.",
    },
    {
      type: "table",
      columns: ["Column", "What it holds"],
      rows: [
        ["Not yet due", "Owed, but its due date has not come."],
        ["1–30 days", "Up to a month late."],
        ["31–60 days", "One to two months late."],
        ["61–90 days", "Two to three months late."],
        ["Over 90 days", "More than three months late — worth a call today."],
        ["Total", "Everything still open for that buyer or supplier."],
      ],
    },
    { type: "heading", id: "export", text: "Downloading a CSV" },
    {
      type: "paragraph",
      text: "**Download CSV** saves the report on screen, with the same period, grouping, side and currency, as a file that opens in Excel or Google Sheets. Amounts in the file are plain numbers in the row's currency. The button only shows for roles allowed to export.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Exports are recorded",
      text: "Every download is written to the audit log with who exported which report and with what filters. A CSV leaves the panel's protection once it is on someone's computer — keep it where client money figures belong.",
    },
    {
      type: "links",
      items: [
        { label: "The finance overview", articleId: "fn-overview" },
        { label: "Payables: what we owe suppliers", articleId: "fn-payables" },
        { label: "Receivables: what buyers owe us", articleId: "fn-receivables" },
        { label: "Payments", articleId: "fn-payments" },
      ],
    },
  ],
} satisfies HelpArticle;
