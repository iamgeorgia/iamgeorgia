import type { HelpArticle } from "../../types";

/**
 * `/admin/finance` (`finance/page.tsx`, `FinanceOverviewCurrency`,
 * `FinanceOverviewPanels`, reading `GET /api/admin/finance/reports/summary`
 * and the payables, receivables and payments lists). Encodes: the
 * `finance.payables.read` guard (others are sent to `/admin`); one row of
 * cards per currency, never summed; "due this week" excluding what is already
 * late; the three lists and their filters; the roles holding the finance
 * read capabilities in `server/lib/permissions.js`.
 */
export const article = {
  id: "fn-overview",
  title: "The finance overview",
  summary: "Open money per currency at a glance, and what needs attention.",
  category: "finance",
  roles: ["ADMIN"],
  routes: ["/admin/finance"],
  keywords: [
    "finance",
    "money",
    "accounts",
    "owed to us",
    "we owe",
    "overdue",
    "due this week",
    "needs review",
    "dashboard",
    "balance",
  ],
  related: ["fn-payables", "fn-receivables", "fn-payments", "fn-reports"],
  blocks: [
    { type: "where", path: ["Sidebar", "Finance", "Finance overview"] },
    {
      type: "paragraph",
      text: "The finance overview answers two questions first thing in the morning: who owes us money, and whom do we owe. Every figure on it is as of the moment the page was opened — reload it to see payments recorded since.",
    },
    { type: "heading", id: "who-sees-finance", text: "Who sees Finance" },
    {
      type: "paragraph",
      text: "Super admins, administrators, management and finance. Administrators and management can read every finance screen but cannot record a payment or change an amount; finance and super admins can — running the company and keeping its books are two jobs on purpose. Reservations and dispatchers do not see the Finance group in the sidebar, and the server refuses them if they type the address.",
    },
    { type: "heading", id: "per-currency", text: "One row per currency" },
    {
      type: "paragraph",
      text: "Each currency the platform holds money in gets its own row of cards, headed by its code — `GEL`, `USD`, `EUR`. Amounts in different currencies are never added together anywhere in Finance: a total of lari and dollars would be a number that means nothing.",
    },
    { type: "heading", id: "cards", text: "What each card means" },
    {
      type: "definitions",
      items: [
        { term: "Owed to us", description: "Everything buyers — agencies and guests — still owe on bills that are open or part paid. Underneath: how many bills, and any money we owe back to buyers who paid more than they now owe." },
        { term: "Overdue from buyers", description: "The part of **Owed to us** whose due date has passed." },
        { term: "We owe suppliers", description: "Everything still to pay hotels, transfer operators, guides and other suppliers, and how many bookings that covers." },
        { term: "Due to suppliers this week", description: "Supplier instalments falling due in the next seven days. What is already late is not in this figure; it is shown underneath as “already late”." },
        { term: "Needs review", description: "Supplier amounts Finance has to decide by hand — usually a supplier with no payment terms, or a cancellation whose terms say “decide by hand”. Click the card to open those payables." },
      ],
    },
    { type: "heading", id: "panels", text: "The three lists" },
    {
      type: "definitions",
      items: [
        { term: "Supplier payments due", description: "Up to eight supplier payables whose next instalment is late or due in the next seven days, earliest date first. Each shows the booking reference, the supplier, the amount due on that date and how far off it is — late ones in red. Click one to open it and pay it." },
        { term: "Overdue from buyers", description: "Up to eight bills past their due date, longest late first, with what is still owed. Click one to open it, or **View all** for every overdue bill." },
        { term: "Recent payments", description: "The last five payments recorded, in or out. A `+` is money received, a `−` money paid out." },
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Nothing here changes anything",
      text: "The overview only reads. Payments are recorded on the payable, the bill or the Payments screen.",
    },
    {
      type: "links",
      items: [
        { label: "Payables: what we owe suppliers", articleId: "fn-payables" },
        { label: "Receivables: what buyers owe us", articleId: "fn-receivables" },
        { label: "Payments", articleId: "fn-payments" },
        { label: "Finance reports", articleId: "fn-reports" },
      ],
    },
  ],
} satisfies HelpArticle;
