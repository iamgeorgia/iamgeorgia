import type { HelpArticle } from "../../types";

/**
 * The deadline calendar at `/admin/deadlines` (`(panel)/deadlines/page.tsx`,
 * `components/admin/deadlines/*`, `MonthGrid.tsx`, `lib/admin/deadlines.ts`)
 * and the Deadlines panel on every booking page
 * (`BookingDeadlinesPanel.tsx`). Encodes the three kinds, the colours, the
 * three views and their URL, the permission rule per kind — and that a
 * payment deadline moved by a requester becomes an approval request.
 */
export const article = {
  id: "bk-deadlines-calendar",
  title: "The deadline calendar: payments, cancellation windows and confirmations",
  summary: "Every date a booking is waiting on, by day; what each colour means; and who may move which deadline.",
  category: "bookings",
  routes: ["/admin/deadlines"],
  keywords: ["deadline", "calendar", "due", "overdue", "free cancellation", "cancellation window", "confirmation", "answer by", "approval deadline", "move", "reschedule", "month", "week", "day", "reminder"],
  related: ["bk-reminder-schedule", "bk-booking-approvals", "fn-receivables", "bk-statuses-glossary"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Deadlines"] },
    {
      type: "paragraph",
      text: "Every booking carries up to three deadlines, and the calendar shows them all, across every product, by the day they fall on in the booking's own time zone. The same three rows appear in the **Deadlines** panel on each booking's page, so the calendar is for seeing the week and the panel is for working one booking.",
    },
    {
      type: "heading",
      id: "the-three-kinds",
      text: "The three kinds",
    },
    {
      type: "definitions",
      items: [
        { term: "Payment due", description: "The receivable's due date — when the bill becomes late. Blue. A child of an order has none: the order's bill is what is paid." },
        { term: "Free cancellation ends", description: "The last moment the booking can be cancelled free of charge, read off the cancellation terms frozen at confirmation (the earliest room's, on a hotel). Amber." },
        { term: "Confirmation due", description: "When the platform must approve the booking, or — once approved and sent on request — when the supplier must answer. Orange. The dialog says which of the two it is waiting on." },
      ],
    },
    {
      type: "paragraph",
      text: "A deadline is `OPEN` until it is met, missed, or cancelled with its booking. An open one past its moment turns red and carries a warning triangle; the **Overdue** counter at the top counts those. `MET` and `CANCELLED` rows are struck through and keep their place on the calendar as a record.",
    },
    {
      type: "heading",
      id: "views-and-filters",
      text: "Views, filters and the address",
    },
    {
      type: "list",
      items: [
        "**Month** is a grid, Monday first, weekends tinted. A cell shows up to three chips and folds the rest behind **+N more**; clicking the day number opens that day. The arrow keys walk the grid, Enter opens the day.",
        "**Week** lists seven days with their chips; **Day** lists one day in full, with the lead name and the status beside each row. On a phone the calendar opens on the week.",
        "**Kind**, **Status**, **Product**, **Partner** and **Manager** narrow every view. The view, the day and the filters are all in the address, so a filtered month is a link that can be sent to a colleague.",
        "A window holds at most 500 rows; the calendar says so when there are more, and a shorter view or a narrower filter shows the rest.",
      ],
    },
    {
      type: "heading",
      id: "moving-a-deadline",
      text: "Moving a deadline",
    },
    {
      type: "steps",
      items: [
        "Click a chip. The dialog shows the due moment in the booking's zone, a link to the booking, and the history of every move.",
        "Choose **Edit deadline**, enter the new date and time — in the booking's own time zone, which the form names — and a reason. The reason is required: it goes into the history and the audit log.",
        "**Move deadline** writes the truth first, then the row: a payment deadline moves the receivable's due date; a free-cancellation deadline rewrites the frozen cancellation terms, so what cancelling costs follows the new date; a confirmation deadline moves the approval or answer-by stamp the overdue sweeps read.",
      ],
    },
    {
      type: "table",
      columns: ["Kind", "Who may move it", "What happens"],
      rows: [
        ["Free cancellation ends", "`bookings.deadlines.write`", "Applied at once. The cancellation terms of every live room change with it."],
        ["Confirmation due", "`bookings.deadlines.write`", "Applied at once. A cleared overdue alert fires again at the new moment."],
        ["Payment due", "`finance.adjustments.execute`", "Applied at once, through the receivable."],
        ["Payment due", "`finance.adjustments.request`", "Becomes a due-date approval request on the receivable; the dialog says **Sent for approval** and nothing moves until a second person approves it."],
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "A moved deadline is marked as the hand's",
      text: "Once moved, the row reads **Moved by hand** and keeps its history. The system still rebuilds the row when the booking changes — a cancelled booking closes all three — but it does not quietly put the date back.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Closed deadlines stay closed",
      text: "A met or cancelled deadline cannot be moved (the server answers `DEADLINE_CLOSED`). A missed one can be given a new date, which reopens it.",
    },
    {
      type: "links",
      items: [
        { label: "Reminder schedule", articleId: "bk-reminder-schedule" },
        { label: "Open the calendar", href: "/admin/deadlines" },
      ],
    },
  ],
} satisfies HelpArticle;
