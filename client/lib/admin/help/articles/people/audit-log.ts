import type { HelpArticle } from "../../types";

/**
 * `/admin/audit` (`audit/page.tsx` + `AuditBrowser`, reading
 * `GET /api/admin/audit`). Encodes: the `audit.read` roles; what the server
 * records (`recordAudit` call sites, `server/lib/audit.js`); append-only rows
 * and the `actorEmail` snapshot; the filters and their URL keys; Tbilisi time
 * for display and for whole-day date filters; when a row links (`auditEntityHref`).
 */
export const article = {
  id: "pp-audit-log",
  title: "The audit log",
  summary: "Every change made on the platform, every sign-in and every look at bank details — who, what and when.",
  category: "people",
  routes: ["/admin/audit"],
  keywords: [
    "audit",
    "audit trail",
    "history",
    "log",
    "who changed",
    "who cancelled",
    "sign-in history",
    "failed sign-in",
    "login attempts",
    "bank details viewed",
    "activity",
  ],
  related: ["pp-staff", "pt-detail-review", "gs-roles"],
  blocks: [
    { type: "where", path: ["Sidebar", "People", "Audit log"] },
    {
      type: "paragraph",
      text: "The audit log is the platform's memory: one row for every change anyone made, newest first. It answers the questions that come after something went wrong — who cancelled this booking, who changed that price, who opened a partner's bank details — and it answers them the same way a month later.",
    },
    { type: "heading", id: "who-can-read", text: "Who can read it" },
    {
      type: "paragraph",
      text: "Super admins, administrators, management and finance. Reservations and dispatchers do not see the item in the sidebar, and the server refuses them if they type the address. The log is read-only for everyone, super admins included: there is nothing on the screen that changes anything.",
    },
    { type: "heading", id: "what-is-recorded", text: "What gets recorded" },
    {
      type: "list",
      items: [
        "**Every change** — creating, editing, publishing, archiving and deleting across hotels, tours, packages, services, transfers, destinations, partners, staff, cars and drivers; every booking and order made, amended, confirmed, cancelled or completed; every driver assignment and trip status.",
        "**Every look at a partner's bank details**, and every link issued to a private document such as a driver's licence or a hotel contract. Reading is recorded here because reading is the risk.",
        "**Sign-ins and sign-outs**, including “Signed out everywhere” when someone's sessions are ended for them.",
        "**Failed sign-ins** against an existing account. **Details** says why: `bad_password`, `not_activated` or `inactive`. An email address with no account behind it leaves no row.",
        "**What the platform does by itself** — a room or tour hold expiring, a pick-up reminder going out, a kosher certificate nearing its expiry. These rows show `system` as the person.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Entries are permanent",
      text: "A row is never edited and never deleted, by anyone. When a staff account is deleted its rows stay: each row keeps a copy of the email address it was written under, so the log still says who acted. Such rows show the email with “Account since removed” underneath.",
    },
    { type: "heading", id: "reading-a-row", text: "Reading a row" },
    {
      type: "table",
      columns: ["Column", "What it shows"],
      rows: [
        ["When", "The date and the time to the second, in Tbilisi time."],
        ["Who", "The person's name and email, the email alone for a removed account, or `system`."],
        ["Action", "What happened, in words — “Hotel booking cancelled”, “Role changed”, “Bank details viewed”."],
        ["What", "The kind of record it happened to. **Open** goes to that record's screen, when it has one and your role can see it; deleted records have no **Open**. **History** narrows the log to that one record."],
        ["Summary", "One sentence written at the time, usually naming the record — a booking reference, a hotel's name. **Details** unfolds whatever else was kept: the reason given, the fields edited, a role before and after."],
      ],
    },
    {
      type: "paragraph",
      text: "On a phone the same rows show as cards, one per entry.",
    },
    { type: "heading", id: "filtering", text: "Filtering" },
    {
      type: "definitions",
      items: [
        { term: "Search", description: "Matches the summary text and the person's email address, or a record's exact ID. Typing a booking reference is the fastest way to a booking's story." },
        { term: "Type", description: "One kind of record: hotel booking, partner, person, car, and so on." },
        { term: "Action", description: "One kind of event, grouped by area — for example “Failed sign-in” under “Sign-ins and accounts”." },
        { term: "Person", description: "Click a name in the **Who** column to see only what that person did. A chip above the table shows the filter; its × removes it." },
        { term: "Record", description: "**History** on any row shows everything that happened to that one record, oldest change at the bottom." },
        { term: "Dates", description: "Whole days in Tbilisi time, both ends included. Leave either end empty for an open range." },
      ],
    },
    {
      type: "paragraph",
      text: "Filters combine, and **Clear filters** removes them all. They live in the page address, so a filtered view can be bookmarked or pasted to a colleague who can read the log.",
    },
    { type: "heading", id: "common-questions", text: "Common questions" },
    {
      type: "definitions",
      items: [
        { term: "Who cancelled this booking?", description: "Type the booking reference into **Search**. The cancellation row names the person who did it; **Details** carries whatever was kept with it, such as the reason given." },
        { term: "Who has looked at a partner's bank details?", description: "Set **Action** to “Bank details viewed”; add **Type** “Partner” and use **History** on one of the rows to narrow to a single partner." },
        { term: "Is someone trying to guess a password?", description: "Set **Action** to “Failed sign-in”. Several rows for one account in a short time are worth a call to its owner; a super admin can deactivate a staff account from the Staff screen." },
        { term: "What did a colleague do yesterday?", description: "Click their name in **Who**, then set both dates to yesterday." },
        { term: "Everything that happened to one hotel", description: "**History** on a hotel row shows the hotel's own changes. Its rooms, rate plans and documents are recorded as their own types, so also search the hotel's name — their summaries name it." },
      ],
    },
    {
      type: "links",
      items: [
        { label: "Staff accounts", articleId: "pp-staff" },
        { label: "A partner: review, invitations, history, delete", articleId: "pt-detail-review" },
        { label: "Roles and what they can do", articleId: "gs-roles" },
      ],
    },
  ],
} satisfies HelpArticle;
