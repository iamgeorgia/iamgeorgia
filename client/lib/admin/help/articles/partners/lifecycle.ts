import type { HelpArticle } from "../../types";

/**
 * Partner statuses and transitions, from `schema.prisma` PartnerStatus,
 * `partner.service.js` (transition table) and `admin.partners.routes.js`
 * (notifyDecision). Encodes: the six statuses and what the partner can do in
 * each; approve from pending or in progress, reject likewise, suspend from
 * approved, reactivate from suspended or rejected, resend from invited,
 * in progress, pending or rejected; approve and reinstate email
 * partnerApproved, reject emails partnerRejected, suspend emails nothing.
 */
export const article = {
  id: "pt-lifecycle",
  title: "Partner statuses",
  summary: "The six statuses a partner moves through, which action takes it where, and which of them send an email.",
  category: "partners",
  roles: ["ADMIN"],
  keywords: ["status", "invited", "registration in progress", "pending approval", "approved", "rejected", "suspended", "transition", "email"],
  related: ["pt-detail-review", "pt-applications", "pt-registering", "pt-register", "pb-statuses"],
  blocks: [
    {
      type: "paragraph",
      text: "A partner is always in exactly one of six statuses. The status decides what the partner can do, which review actions the page offers, and whether the application shows in the queue.",
    },
    { type: "heading", id: "statuses", text: "The six statuses" },
    {
      type: "table",
      columns: ["Status", "Meaning", "What the partner can do"],
      rows: [
        ["`INVITED`", "A registration link has been sent and not yet opened.", "Open the link and start filling in the company."],
        ["`REGISTRATION_IN_PROGRESS`", "The invitee has opened the link and is still filling in the form.", "Finish and submit; nothing else."],
        ["`PENDING_APPROVAL`", "The application is complete and waiting for a decision.", "Set their password from the link, but not sign in to the portal."],
        ["`APPROVED`", "On the network with full access.", "Everything the portal offers."],
        ["`REJECTED`", "Turned down, with the reason emailed.", "Nothing, until reinstated or re-invited."],
        ["`SUSPENDED`", "Access withdrawn; every open session ended.", "Nothing, until reinstated."],
      ],
    },
    { type: "heading", id: "transitions", text: "Transitions" },
    {
      type: "table",
      columns: ["Action", "From", "To"],
      rows: [
        ["**Approve**", "`PENDING_APPROVAL`, `REGISTRATION_IN_PROGRESS`", "`APPROVED`"],
        ["**Reject**", "`PENDING_APPROVAL`, `REGISTRATION_IN_PROGRESS`", "`REJECTED`"],
        ["**Suspend**", "`APPROVED`", "`SUSPENDED`"],
        ["**Reinstate partner**", "`SUSPENDED`, `REJECTED`", "`APPROVED`"],
        ["**Send a new invitation link**", "`INVITED`, `REGISTRATION_IN_PROGRESS`, `PENDING_APPROVAL`, `REJECTED`", "Unchanged — a fresh link, the old one withdrawn"],
      ],
    },
    {
      type: "paragraph",
      text: "Registering a partner starts it at `INVITED` (registration link), `PENDING_APPROVAL` (create the account now) or `APPROVED` (create and approve at once).",
    },
    { type: "heading", id: "emails", text: "Which actions email the partner" },
    {
      type: "table",
      columns: ["Action", "Email"],
      rows: [
        ["Approve", "Yes — the approval notice."],
        ["Reinstate partner", "Yes — the same approval notice."],
        ["Reject", "Yes — the rejection, carrying the reason you typed."],
        ["Suspend", "No. Nothing is sent."],
        ["Send a new invitation link", "Yes — the link, and it is shown on screen too."],
      ],
    },
    {
      type: "links",
      items: [
        { label: "A partner: review, invitations, history, delete", articleId: "pt-detail-review" },
        { label: "Registering a partner", articleId: "pt-registering" },
      ],
    },
  ],
} satisfies HelpArticle;
