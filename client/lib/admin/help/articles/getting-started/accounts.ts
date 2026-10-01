import type { HelpArticle } from "../../types";

/**
 * Who creates which account. There is no user-management screen in the
 * panel: staff accounts come from `server/scripts/create-admin.js` (always
 * SUPER_ADMIN), dispatchers have no documented path at all, drivers get a
 * login from `DriverAccount.tsx`, partner users from an invitation
 * (`PartnerRegistrationForm.tsx`, `PartnerActions.tsx`). Link lifetimes from
 * `server/config.js`.
 */
export const article = {
  id: "gs-accounts",
  title: "Accounts: who creates them, and where",
  summary:
    "The panel has no users screen. Staff accounts are made by the developer; driver and partner logins are issued from the driver and partner pages.",
  category: "getting-started",
  roles: ["ADMIN"],
  keywords: ["user", "users", "create account", "new admin", "invite", "activation link", "expired link", "resend", "deactivate"],
  related: ["gs-signing-in", "gs-roles", "fd-driver-detail", "pt-registering"],
  blocks: [
    {
      type: "callout",
      tone: "warning",
      title: "There is no user-management screen",
      text: "Nothing in the sidebar lists staff accounts or lets you add one. An administrator account is created by the developer with a command on the server, and a dispatcher account has no self-service path at all — ask the developer for either. Do not share one login between two people: every cancellation, assignment and approval is written to the audit trail under the account that did it.",
    },
    {
      type: "heading",
      id: "who-makes-what",
      text: "Who makes what",
    },
    {
      type: "table",
      columns: ["Account", "Created by", "Where"],
      rows: [
        ["Administrator", "The developer", "A command on the server. It prints a one-time password or emails an activation link."],
        ["Dispatcher", "The developer", "No screen or command exists yet; it is set directly in the database."],
        [
          "Driver",
          "An administrator or dispatcher",
          "The **Login** panel on the driver's page: **Create login and send the link**. The driver can be dispatched to by phone before they have a login.",
        ],
        [
          "Partner user",
          "An administrator",
          "Registering the partner sends the first invitation; **Send a new invitation link** on the partner's page issues another. Accepting the invitation creates the user.",
        ],
      ],
    },
    {
      type: "heading",
      id: "links",
      text: "Activation and invitation links",
    },
    {
      type: "list",
      items: [
        "A link is emailed **and** shown on screen with a **Copy link** button. If the email fails the screen says so — copy the link and send it yourself.",
        "Issuing a new link stops the previous one working, for drivers and partners alike.",
        "An activation link (choose a password) lives for **48 hours**. A partner's registration link has its own expiry, shown beside it on the partner's page.",
        "Activation signs the person straight in to their own panel — the driver panel or the partner portal, never this one.",
      ],
    },
    {
      type: "heading",
      id: "ending-access",
      text: "Ending someone's access",
    },
    {
      type: "definitions",
      items: [
        { term: "A driver", description: "**Deactivate driver** on their page ends the login and every open session at once, and can send their upcoming jobs back to dispatch." },
        { term: "A partner", description: "**Suspend** on the partner's page ends every open session for every user of that company. It is reversible with **Reinstate**." },
        { term: "A staff account", description: "The developer deactivates it. The next request that account makes is refused." },
      ],
    },
  ],
} satisfies HelpArticle;
