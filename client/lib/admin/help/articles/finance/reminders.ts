import type { HelpArticle } from "../../types";

/**
 * Supplier payment reminders (`server/services/finance/reminder.service.js`,
 * the `FINANCE_*` notification kinds and the `finance*` email templates).
 * Encodes: the schedule (7, 3, 1, 0 calendar days, then overdue daily),
 * who is told and by which channel, what stops a reminder, the receipt an
 * agency gets, the "Supplier payments due" panel and the Payables badge, and
 * the environment settings behind all of it. No screen of its own — the
 * settings are environment-only — so it claims no route.
 */
export const article = {
  id: "fn-reminders",
  title: "Supplier payment reminders",
  summary: "When the finance desk is reminded about an instalment, who hears, what stops it, and the settings behind the schedule.",
  category: "finance",
  keywords: [
    "reminder",
    "due",
    "overdue",
    "late",
    "alert",
    "7 days",
    "mailbox",
    "FINANCE_OPS_EMAIL",
    "receipt",
    "payments due",
    "badge",
    "chase",
  ],
  related: ["fn-payables", "fn-receivables", "fn-payments", "gs-notifications"],
  blocks: [
    { type: "where", path: ["Sidebar", "Finance", "Finance overview"] },
    {
      type: "paragraph",
      text: "Every supplier instalment has a due date from the supplier's payment terms. The platform watches those dates and reminds the finance desk before each one — in the bell and by email — so a deposit is never missed because nobody opened the payables list that week. Nothing is paid automatically: a reminder is a nudge to make the payment and record it.",
    },
    { type: "heading", id: "schedule", text: "The schedule" },
    {
      type: "table",
      columns: ["When", "What arrives"],
      rows: [
        ["7 days before the due day", "**Payment due in 7 days** — the first reminder"],
        ["3 days before", "A second reminder"],
        ["The day before", "A third"],
        ["On the due day, in the morning", "**Due today**"],
        ["Once the due time has passed", "**Overdue** — repeated every day while the instalment stays unpaid"],
      ],
    },
    {
      type: "paragraph",
      text: "Days are counted on the calendar in the supplier's own time: a balance due at 10:00 on the 17th is \"due today\" from midnight on the 17th in Tbilisi, and \"7 days away\" from midnight on the 10th. Each reminder fires once per instalment. A payable created late — a booking confirmed four days before its deposit is due — gets one reminder for the nearest point on the schedule, not four at once.",
    },
    { type: "heading", id: "who", text: "Who hears, and how" },
    {
      type: "list",
      items: [
        "In the bell: every active member of staff whose role reads payables — Finance, Management and the administrators. Each notice links to the payable.",
        "By email: the shared finance mailbox, when one is configured. The email carries the supplier, the booking, the amount still outstanding and the due date, and a button to the payable. It never carries bank details.",
        "A buyer's bill that passes its due date is reported the same way — bell and mailbox — and the agency that owes it is sent a courteous reminder with a link to its statement, then again each day while it stays unpaid. A guest who booked without an account is not chased automatically; those bills are settled at the property or by hand.",
      ],
    },
    { type: "heading", id: "stopping", text: "What stops a reminder" },
    {
      type: "paragraph",
      text: "Recording the payment. The moment an instalment is paid — from its payable's page, from the **Supplier payments due** panel on the finance overview, or as part of a larger payment on the Payments screen — every later reminder for it is cancelled, including one already on its way. Writing a payable off or setting its amount to zero does the same. Reading the notice does not: a reminder you have read is still a payment that needs making.",
    },
    { type: "heading", id: "receipts", text: "Receipts to agencies" },
    {
      type: "paragraph",
      text: "When Finance records money received from an agency, the agency is sent a receipt by email and in its portal: the amount, the day it was received, the bookings it was applied to and anything left on account. Nothing is sent for money going out to a supplier, or for a payment Finance records against a guest.",
    },
    { type: "heading", id: "queue", text: "The queue on screen" },
    {
      type: "list",
      items: [
        "**Supplier payments due** on the finance overview lists the instalments late or due in the next seven days, earliest first, with **Mark paid** on each row. It shows exactly the rows the reminders are sent about.",
        "The **Payables** entry in the sidebar carries the same count as a badge, and the overview's **Supplier payments due** card shows it to anyone who reads payables.",
        "A reminder that could not be delivered after several attempts — the mail relay was down for a day — is kept rather than lost, and an administrator can send it again from the outbox's failed list.",
      ],
    },
    { type: "heading", id: "settings", text: "Settings" },
    {
      type: "paragraph",
      text: "The schedule is set in the server's environment, not on a screen. Changing a value and restarting the server is enough; the change applies to every instalment from then on, and a new offset reaches instalments already inside its window at the next sweep.",
    },
    {
      type: "definitions",
      items: [
        { term: "`FINANCE_REMINDER_OFFSET_DAYS`", description: "Calendar days before the due day on which to remind, comma-separated. Default `7,3,1,0`." },
        { term: "`FINANCE_OVERDUE_REPEAT_DAYS`", description: "How often an overdue alert repeats while the money is still owed. Default `1` (daily); `0` alerts once only." },
        { term: "`FINANCE_OPS_EMAIL`", description: "The shared finance mailbox every reminder is also emailed to. Unset, reminders are in-app only." },
        { term: "`FINANCE_REMINDER_SWEEP_INTERVAL_MS`", description: "How often the server checks the clock. Default ten minutes; a reminder can be late by at most this." },
      ],
    },
    {
      type: "callout",
      tone: "warning",
      text: "The first time the reminders run on a database with old payables in it, everything already inside the window is reminded about at once. Expect a burst of notices on the day the feature goes live, and nothing unusual after.",
    },
    {
      type: "links",
      items: [
        { label: "Payables: what we owe suppliers", articleId: "fn-payables" },
        { label: "The bell: your notifications", articleId: "gs-notifications" },
      ],
    },
  ],
} satisfies HelpArticle;
