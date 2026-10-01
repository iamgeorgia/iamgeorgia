import type { HelpArticle } from "../../types";

/**
 * `/admin/partners/applications` (`partners/applications/page.tsx`, the same
 * `PartnersBrowser` scoped to PENDING_APPROVAL and REGISTRATION_IN_PROGRESS).
 * Encodes: the two stat cards and their hints; oldest first as the working
 * order; the sidebar badge; open a row to review.
 */
export const article = {
  id: "pt-applications",
  title: "The applications queue",
  summary: "Partners waiting for a decision, and the ones still filling in their registration.",
  category: "partners",
  roles: ["ADMIN"],
  routes: ["/admin/partners/applications"],
  keywords: ["applications", "pending approval", "awaiting decision", "review", "queue", "registration in progress", "invitee"],
  related: ["pt-detail-review", "pt-register", "pt-lifecycle", "gs-overview"],
  blocks: [
    { type: "where", path: ["Sidebar", "Network", "Applications"] },
    {
      type: "paragraph",
      text: "The applications queue is the partners register with its status chips locked to `PENDING_APPROVAL` and `REGISTRATION_IN_PROGRESS`. Nothing else about it differs: the same search, the same type chips, the same columns. The **Applications** item in the sidebar carries a badge with the number waiting.",
    },
    { type: "heading", id: "cards", text: "The two cards" },
    {
      type: "table",
      columns: ["Card", "What it counts"],
      rows: [
        ["Awaiting your decision", "Applications that are complete and submitted — `PENDING_APPROVAL`."],
        ["Still being filled in", "Invitees who have opened their link but not yet finished — `REGISTRATION_IN_PROGRESS`."],
      ],
    },
    { type: "heading", id: "working", text: "Working the queue" },
    {
      type: "steps",
      items: [
        "Work oldest first: the earliest application has waited longest for an answer.",
        "Open a row. The partner's page shows the company, its people, its completeness and the review actions.",
        "Approve, reject or leave it, as described in the review article.",
      ],
    },
    {
      type: "paragraph",
      text: "An application still being filled in can be approved as well, provided the company details are complete; usually it is better to wait for the invitee to finish.",
    },
    {
      type: "links",
      items: [
        { label: "A partner: review, invitations, history, delete", articleId: "pt-detail-review" },
        { label: "Partner statuses", articleId: "pt-lifecycle" },
      ],
    },
  ],
} satisfies HelpArticle;
