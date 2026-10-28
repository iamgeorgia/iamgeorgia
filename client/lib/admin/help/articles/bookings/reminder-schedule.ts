import type { HelpArticle } from "../../types";

/**
 * The reminder schedule at `/admin/settings/reminders`
 * (`(panel)/settings/reminders/page.tsx`, `ReminderPoliciesEditor.tsx`,
 * `PUT /admin/settings/reminder-policies`). Encodes the platform row per
 * kind, the per-partner override, the offsets/channels/recipients, and that
 * the platform row is switched off rather than removed.
 */
export const article = {
  id: "bk-reminder-schedule",
  title: "Reminder schedule: who is told before a deadline",
  summary: "The platform's reminder rows per deadline kind, a partner's own override, and what the offsets, channels and recipients mean.",
  category: "bookings",
  routes: ["/admin/settings/reminders"],
  keywords: ["reminder", "notification", "email", "in-app", "offset", "days before", "partner override", "policy", "schedule", "settings", "guest", "staff"],
  related: ["bk-deadlines-calendar", "fn-reminders", "dp-who-is-told-what"],
  blocks: [
    { type: "where", path: ["Sidebar", "Settings", "Reminders"] },
    {
      type: "paragraph",
      text: "Before a deadline on the calendar falls due, the people who can do something about it are reminded. This screen sets the schedule: one **platform** row per deadline kind, and — where one partner needs something different — an override that applies to that partner's bookings alone.",
    },
    {
      type: "heading",
      id: "what-a-row-says",
      text: "What a row says",
    },
    {
      type: "definitions",
      items: [
        { term: "Days before", description: "The offsets, as chips: `7, 3, 1, 0` reminds a week before, three days before, the day before and on the day. Counted in calendar days in the booking's own time zone. Several offsets that come due together send one reminder, the nearest." },
        { term: "Channels", description: "**In-app** puts it on the bell; **Email** sends it. Both can be on." },
        { term: "Recipients", description: "**Staff** — the finance desk for a payment, the bookings desk for the rest; **Partner** — the partner's portal users and its contact address; **Guest** — the guest or desk customer, by email." },
        { term: "Enabled", description: "A switched-off row sends nothing. The platform row cannot be removed, only switched off; a partner override can be removed, after which the partner follows the platform row again." },
      ],
    },
    {
      type: "heading",
      id: "partner-overrides",
      text: "Partner overrides",
    },
    {
      type: "steps",
      items: [
        "Choose the partner in the **Partner** picker. The table then shows the platform rows and, under them, that partner's overrides.",
        "**Add override** on a kind copies the platform row as a starting point; change what differs and save.",
        "**Remove override** returns the partner to the platform schedule. The audit log records every change as `REMINDER_POLICY_UPDATED`.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "A reminder says nothing once the deadline is closed",
      text: "The sweep claims each (deadline, offset) once and re-reads the row before sending; a payment made or a booking cancelled in between sends nothing. A deadline past its moment is marked `MISSED` by the same sweep.",
    },
    {
      type: "links",
      items: [
        { label: "The deadline calendar", articleId: "bk-deadlines-calendar" },
        { label: "Supplier payment reminders", articleId: "fn-reminders" },
      ],
    },
  ],
} satisfies HelpArticle;
