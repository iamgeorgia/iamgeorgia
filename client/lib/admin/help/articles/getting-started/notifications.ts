import type { HelpArticle } from "../../types";

/**
 * `/admin/notifications` (`(panel)/notifications/page.tsx`) and the bell in
 * the top bar (`NotificationBell`). Encodes: what arrives in-app and for
 * whom, that rows are personal, the dropdown versus the page and its tabs,
 * mark read / mark all, that the counts refresh on their own, and where a
 * row leads. Read by dispatchers too — their bell carries assignment and
 * no-show notices.
 */
export const article = {
  id: "gs-notifications",
  title: "The bell: your notifications",
  summary: "What the bell in the top bar collects, who gets what, and how to clear it.",
  category: "getting-started",
  routes: ["/admin/notifications"],
  keywords: ["bell", "unread", "alert", "reminder", "notice", "mark as read", "overdue", "tabs", "approval", "deadline"],
  related: ["gs-sidebar-and-top-bar", "fn-reminders"],
  blocks: [
    { type: "where", path: ["Sidebar", "Notifications"] },
    {
      type: "paragraph",
      text: "The bell at the top right collects the things the platform wants a person to know about: a booking waiting for approval, a supplier payment coming due, a bill a buyer has not paid, a driver who declined a job, a request nobody has answered. The number on it is how many you have not read, and the same number sits on **Notifications** in the sidebar, just under the overview. Open the bell for the latest few; **See all notifications**, or the sidebar entry, opens the full page.",
    },
    { type: "heading", id: "tabs", text: "The tabs" },
    {
      type: "paragraph",
      text: "The page sorts every notice onto one of six tabs, each showing how many of its notices you have not read: **Bookings** (new and changed bookings, requests left unanswered), **Dispatch** (drivers, legs and no-shows), **Finance** (payments received, invoices issued, credit warnings), **Approvals** (bookings waiting for a yes, and the answer), **Deadlines** (payments due or overdue) and **System**. **All** shows everything together. **Unread only** hides what you have read; the sort puts the newest, the oldest or the unread first.",
    },
    { type: "heading", id: "who-gets-what", text: "Who gets what" },
    {
      type: "paragraph",
      text: "Notifications are personal: each one is addressed to you, and nobody else's appears in your list. What you receive follows your role — the same rule that decides which screens you can open.",
    },
    {
      type: "table",
      columns: ["You receive…", "If your role…"],
      rows: [
        ["Supplier payment reminders and overdue alerts, buyers' overdue bills", "Reads payables — Finance, Management and the administrators"],
        ["Driver answers, no-shows, unassigned legs, overdue requests", "Works dispatch or runs the operation — Dispatchers and the administrators"],
        ["Nothing in the bell yet", "The reservations desk: its queues are the badges in the sidebar"],
      ],
    },
    { type: "heading", id: "reading", text: "Reading and clearing" },
    {
      type: "list",
      items: [
        "An unread notice is bold with a coloured edge. **Open** goes to the thing it is about — the payable, the receivable, the booking or the order — and marks the notice read on the way.",
        "**Mark read** on a row clears that one without opening it. **Mark all read** at the top clears the tab you are looking at, or every tab from **All**; the numbers on the bell and in the sidebar drop with it.",
        "The counts on the bell, the sidebar and the tabs refresh on their own about once a minute while the panel is open, and at once after you mark anything read — nothing needs reloading.",
        "Reading a notice changes nothing else. A payment reminder you have read is still a payment that needs making — the reminder stops only when the payment is recorded.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      text: "The same notices also go out by email to the shared finance mailbox and to the operations mailbox, so nothing depends on somebody being signed in. The bell is the copy that follows you around the panel.",
    },
    {
      type: "links",
      items: [
        { label: "Supplier payment reminders: the schedule", articleId: "fn-reminders" },
        { label: "The sidebar and the top bar", articleId: "gs-sidebar-and-top-bar" },
      ],
    },
  ],
} satisfies HelpArticle;
