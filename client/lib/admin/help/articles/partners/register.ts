import type { HelpArticle } from "../../types";

/**
 * `/admin/partners` (`partners/page.tsx`, `PartnersBrowser.tsx`). Encodes:
 * what a partner is (a supplier company with an immutable PTR-000001
 * reference; four kinds; a transfer supplier is a partner); the header
 * actions Applications (count pill) and Add a partner; four stat cards;
 * search, six Status chips, four Type chips, live count and Clear filters;
 * the columns; the card list below lg; page size 20; commission shown
 * (default 10 %) but not editable in the panel.
 */
export const article = {
  id: "pt-register",
  title: "Partners register",
  summary: "What a partner is, and how to find one by name, Partner ID, registration number or email, filtered by status and type.",
  category: "partners",
  routes: ["/admin/partners"],
  keywords: ["partner", "supplier", "agency", "PTR", "partner id", "hotel partner", "tour operator", "transport", "commission", "status", "type"],
  related: ["pt-applications", "pt-registering", "pt-detail-review", "pt-lifecycle", "tc-vehicle-classes"],
  blocks: [
    { type: "where", path: ["Sidebar", "Network", "Partners"] },
    {
      type: "paragraph",
      text: "A partner is a supplier company or agency on the network: a hotel, a tour operator, a transport company or an experience provider. Each has a public reference such as `PTR-000123` that never changes and is safe to quote over the phone. A transfer supplier is a partner — which is why the vehicle-class form tells you to add the supplier as a partner first.",
    },
    { type: "heading", id: "header", text: "Header actions" },
    {
      type: "list",
      items: [
        "**Applications** opens the queue of partners waiting for a decision. It carries a count pill whenever there are any.",
        "**Add a partner** opens the registration form.",
      ],
    },
    { type: "heading", id: "cards", text: "The four cards" },
    {
      type: "table",
      columns: ["Card", "What it counts"],
      rows: [
        ["Approved partners", "Companies with full access to the platform."],
        ["Awaiting review", "Applications waiting for a decision."],
        ["Invitations open", "Registration links sent but not yet opened."],
        ["On the network", "Partners matching the current view."],
      ],
    },
    { type: "heading", id: "finding", text: "Finding a partner" },
    {
      type: "list",
      items: [
        "The search box matches company name, Partner ID, registration number or email.",
        "The **Status** chips offer **All** and the six statuses: `INVITED`, `REGISTRATION_IN_PROGRESS`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `SUSPENDED`.",
        "The **Type** chips offer **All** and the four kinds: `HOTEL`, `TOUR_OPERATOR`, `TRANSPORT`, `EXPERIENCE`.",
        "A live count underneath reads how many partners match, and **Clear filters** resets everything.",
        "Twenty partners to a page.",
      ],
    },
    { type: "heading", id: "columns", text: "The columns" },
    {
      type: "paragraph",
      text: "Company (name and registration number), Partner ID, Type, Status, Contact, Location, Registered, and **Open**. On a narrow screen the table becomes a list of cards carrying the same facts.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Note",
      text: "A partner's commission is shown on its page — `10%` unless it was set otherwise — but there is no field for it anywhere in the panel. Changing it is a developer task.",
    },
    {
      type: "links",
      items: [
        { label: "The applications queue", articleId: "pt-applications" },
        { label: "Registering a partner", articleId: "pt-registering" },
        { label: "Partner statuses", articleId: "pt-lifecycle" },
      ],
    },
  ],
} satisfies HelpArticle;
