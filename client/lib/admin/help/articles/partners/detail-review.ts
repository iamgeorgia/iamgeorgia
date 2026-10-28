import type { HelpArticle } from "../../types";

/**
 * `/admin/partners/[id]` (`partners/[id]/page.tsx`, `PartnerActions.tsx`,
 * `PartnerDangerZone.tsx`, server `partner.service.js` transitions and
 * `admin.partners.routes.js` notifications). Encodes: the panels (Company with
 * Partner ID and Commission, People with per-user states, Bank details only
 * for entitled viewers, Internal note, Invitations Live/Used/Withdrawn/Expired,
 * History with reasons, Status, Review, Completeness); Approve one click and
 * refused while incomplete; Reject with a required emailed reason and an
 * optional internal note; Suspend with a required reason, ending sessions,
 * emailing nothing; Reinstate from Suspended or Rejected; Send a new
 * invitation link with Copy link; delete by typing the Partner ID, removing
 * company, accounts, bank details and invitations, reference never reissued,
 * audit trail surviving, suspend suggested when approved.
 */
export const article = {
  id: "pt-detail-review",
  title: "A partner: review, invitations, history, delete",
  summary: "Reading a partner's page, approving, rejecting, suspending and reinstating, reissuing the invitation, and the one hard delete.",
  category: "partners",
  routes: ["/admin/partners/[id]"],
  keywords: ["approve", "reject", "suspend", "reinstate", "invitation", "resend", "copy link", "history", "audit", "completeness", "bank details", "people", "delete partner"],
  related: ["pt-lifecycle", "pt-applications", "pt-registering", "pt-register", "gs-accounts", "rf-dangerous-actions"],
  blocks: [
    { type: "where", path: ["Sidebar", "Network", "Partners", "[partner]"] },
    {
      type: "paragraph",
      text: "A partner's page is titled with the company name and its `PTR-…` reference. The main column holds the record; the sidebar holds the status, the review actions and the delete.",
    },
    { type: "heading", id: "panels", text: "The panels" },
    {
      type: "definitions",
      items: [
        { term: "Company", description: "The business details, the **Partner ID**, the **Commission** and any social links." },
        {
          term: "People",
          description: "Everyone who can sign in on behalf of this company, each marked **Password not set**, **Active** or **Disabled**, with a **Primary contact** pill. When empty it reads that nobody has an account yet and the invitation creates one when it is accepted.",
        },
        { term: "Bank details", description: "IBAN, SWIFT/BIC and bank, where they are on file." },
        { term: "Internal note", description: "What was typed at registration. Never shown to the partner." },
        { term: "Invitations", description: "Each link sent, when it expires and how often it was resent, marked **Live**, **Used**, **Withdrawn** or **Expired**." },
        { term: "History", description: "The audit trail for this partner, with the reason wherever one was given." },
        { term: "Status", description: "The current status in plain words, with who approved, rejected or suspended and when, the reason given to the partner, and any internal note." },
        { term: "Review", description: "The actions available from the current status." },
        { term: "Completeness", description: "What approval requires: legal entity, registration number, address, country, phone and email." },
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Note",
      text: "The Bank details panel appears only to viewers entitled to see it. If it is missing from your view, that does not mean there are no details on file.",
    },
    { type: "heading", id: "review", text: "Reviewing" },
    {
      type: "definitions",
      items: [
        {
          term: "Approve",
          description: "One click. Refused while the company is incomplete — see the Completeness panel. On success the partner is emailed and has full access; the panel reads that the partner has been emailed and now has full access.",
        },
        {
          term: "Reject",
          description: "Expands into **Reason, shown to the partner** (required — it is what the applicant is emailed) and **Internal note, never sent** (optional), then **Confirm rejection** or **Cancel**.",
        },
        {
          term: "Suspend",
          description: "Expands into a required reason. Every open session for this partner ends immediately. The partner is not emailed.",
        },
        { term: "Reinstate partner", description: "One click, from `SUSPENDED` or `REJECTED`, back to `APPROVED`. The partner is emailed as on approval." },
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "**Approve** asks for no confirmation: the email goes and access opens on the click. **Suspend** ends every open session at once and sends nothing — tell the partner yourself if they need to know why.",
    },
    { type: "heading", id: "invitations", text: "Sending a new invitation link" },
    {
      type: "paragraph",
      text: "**Send a new invitation link** is offered while the partner is `INVITED`, `REGISTRATION_IN_PROGRESS`, `PENDING_APPROVAL` or `REJECTED`. The new link is emailed to the main contact and shown on the page under **Registration link** with a **Copy link** button. If the panel says the link could not be emailed, send it yourself. Any earlier link stops working the moment a new one is issued.",
    },
    { type: "heading", id: "history", text: "History" },
    {
      type: "paragraph",
      text: "Every approval, rejection, suspension, reinstatement and reissued invitation is written to the trail under the account that did it, with the reason where one was given. The trail is not tied to the partner record, so it survives even deletion.",
    },
    { type: "heading", id: "delete", text: "Delete" },
    {
      type: "steps",
      items: [
        "Open the delete panel at the foot of the sidebar.",
        "Type the **Partner ID** exactly as shown, `PTR-…`. The server checks it and refuses anything else.",
        "Confirm. You return to the register.",
      ],
    },
    {
      type: "callout",
      tone: "danger",
      title: "Irreversible",
      text: "Deleting removes the company, its user accounts, its bank details and its invitations, and the Partner ID is never reissued. Only the audit trail survives. When the partner is approved the panel says so itself: suspending withdraws their access straight away and can be reversed — that is almost always what you want instead.",
    },
    {
      type: "links",
      items: [
        { label: "Partner statuses", articleId: "pt-lifecycle" },
        { label: "The applications queue", articleId: "pt-applications" },
      ],
    },
  ],
} satisfies HelpArticle;
