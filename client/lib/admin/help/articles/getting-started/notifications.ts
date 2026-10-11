import type { HelpArticle } from "../../types";

/**
 * `/admin/notifications` (`(panel)/notifications/page.tsx`) and the bell in
 * the top bar (`NotificationBell`). Encodes: what arrives in-app and for
 * whom, that rows are personal, the dropdown versus the page, mark read /
 * mark all, and where a row leads. Read by dispatchers too — their bell
 * carries assignment and no-show notices.
 */
export const article = {
  id: "gs-notifications",
  title: "The bell: your notifications",
  summary: "What the bell in the top bar collects, who gets what, and how to clear it.",
  category: "getting-started",
  roles: ["ADMIN", "DISPATCHER"],
  routes: ["/admin/notifications"],
  keywords: ["bell", "unread", "alert", "reminder", "notice", "mark as read", "overdue"],
  related: ["gs-sidebar-and-top-bar", "fn-reminders"],
  blocks: [
    { type: "where", path: ["Top bar", "Bell", "View all notifications"] },
    {
      type: "paragraph",
      text: "The bell at the top right collects the things the platform wants a person to know about: a supplier payment coming due, a bill a buyer has not paid, a driver who declined a job, a request nobody has answered. The number on it is how many you have not read. Open it for the latest few; **View all notifications** opens the full list, newest first.",
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
        "An unread notice is bold with a coloured edge. Click its title to go to the thing it is about — the payable, the receivable, the booking or the order.",
        "The tick on a row marks that one as read without opening it. **Mark all as read** clears the whole list; the number on the bell drops to zero.",
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
