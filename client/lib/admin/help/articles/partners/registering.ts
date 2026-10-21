import type { HelpArticle } from "../../types";

/**
 * `/admin/partners/new` (`PartnerRegistrationForm.tsx`, server
 * `admin.partners.routes.js` create). Encodes: the three modes; the business
 * fields required only outside invite mode; the main contact with the link
 * bound to its email; bank details all or nothing; the internal note never
 * shown; the success screen with the reference, a Registration or Password
 * link block, Copy link shown whether or not the email went out, Back to
 * partners and Add another.
 */
export const article = {
  id: "pt-registering",
  title: "Registering a partner",
  summary: "Sending a registration link, creating the account yourself, or creating and approving in one go — and what the success screen gives you.",
  category: "partners",
  routes: ["/admin/partners/new"],
  keywords: ["new partner", "add partner", "invite", "registration link", "password link", "copy link", "bank details", "IBAN", "main contact", "internal note"],
  related: ["pt-register", "pt-detail-review", "pt-lifecycle", "gs-accounts"],
  blocks: [
    { type: "where", path: ["Sidebar", "Network", "Partners", "Add a partner"] },
    {
      type: "paragraph",
      text: "One form registers a partner in any of three ways. Which one you choose decides how much you type now and whether the partner has access the moment you finish.",
    },
    { type: "heading", id: "modes", text: "The three modes" },
    {
      type: "table",
      columns: ["Mode", "What happens", "Status afterwards"],
      rows: [
        [
          "**Send a registration link**",
          "A secure single-use link is emailed to the main contact. They complete the company details and choose a password; the application comes back to you for approval.",
          "`INVITED`",
        ],
        [
          "**Create the account now**",
          "You enter everything. They receive a link to set a password, and the application waits for your approval.",
          "`PENDING_APPROVAL`",
        ],
        [
          "**Create and approve at once**",
          "For a company already vetted offline. They receive a password link and have full access straight away.",
          "`APPROVED`",
        ],
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "**Create and approve at once** gives full access to the platform the moment you save — nothing is reviewed later. Use it only for a company you have already checked.",
    },
    { type: "heading", id: "fields", text: "The fields" },
    {
      type: "definitions",
      items: [
        {
          term: "The business",
          description: "**Trading name**, **Partner type**, **Registered legal entity**, **Registration number**, **Legal address**, **City**, **Country** (two-letter code, `GE` by default), **Company phone**, **Company email** and **Website**. Only the trading name is needed when sending a registration link; every field is required in the other two modes.",
        },
        {
          term: "Main contact",
          description: "**First name**, **Last name**, **Position**, **Phone** and **Email**. The link is bound to this address and can only be completed from it.",
        },
        {
          term: "Bank details",
          description: "**IBAN**, **SWIFT/BIC** and **Bank**. Optional, but all or nothing — a half-filled set is refused.",
        },
        { term: "Internal note", description: "Never shown to the partner." },
      ],
    },
    {
      type: "paragraph",
      text: "Errors from the server land on the field concerned; a conflict that has no field, such as an email already on the network, appears at the top of the form.",
    },
    { type: "heading", id: "after", text: "After saving" },
    {
      type: "paragraph",
      text: "The form is replaced by a success screen: a green tick, **{name} is on the network**, the new `PTR-…` reference, and a grey block headed **Registration link** (when you sent one) or **Password link** (in the other two modes) with the URL and a **Copy link** button. **Back to partners** returns to the register; **Add another** clears the form.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Note",
      text: "The link is shown whether or not the email went out. If the screen says it could not be emailed, copy the link and send it to the contact yourself; the record already exists.",
    },
    {
      type: "paragraph",
      text: "Example: a hotel you have met and vetted. Choose **Create and approve at once**, fill in every business field, the main contact and the bank details, and save. The success screen shows a **Password link**; the hotel signs in as soon as they have used it.",
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
