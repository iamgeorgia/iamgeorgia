import type { HelpArticle } from "../../types";

/**
 * Who creates which account. Staff accounts are invited from the Staff screen
 * (`(panel)/users`, super admins only; `server/routes/admin.users.routes.js`),
 * the very first super admin from `server/scripts/create-admin.js`; drivers
 * get a login from `DriverAccount.tsx`; a partner's first user from an
 * invitation (`PartnerRegistrationForm.tsx`, `PartnerActions.tsx`), and the
 * rest of its team from the portal's Team page. Link lifetimes from
 * `server/config.js`.
 */
export const article = {
  id: "gs-accounts",
  title: "Accounts: who creates them, and where",
  summary:
    "Staff are invited from the Staff screen by a super admin; drivers get a login from their page; a partner's first user is invited here, the rest of its team by the partner itself.",
  category: "getting-started",
  keywords: ["user", "users", "create account", "new admin", "invite", "activation link", "expired link", "resend", "deactivate", "team"],
  related: ["pp-staff", "gs-signing-in", "gs-roles", "fd-driver-detail", "pt-registering"],
  blocks: [
    {
      type: "callout",
      tone: "info",
      title: "One person, one account",
      text: "Do not share one login between two people: every cancellation, assignment and approval is written to the audit log under the account that did it. Invite each colleague with the role their job needs.",
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
        [
          "Staff — administrator, management, reservations, finance, dispatcher",
          "A super admin",
          "**People → Staff → Invite staff**. The very first super admin is made by the developer with a command on the server.",
        ],
        [
          "Driver",
          "An administrator or dispatcher",
          "The **Login** panel on the driver's page: **Create login and send the link**. The driver can be dispatched to by phone before they have a login.",
        ],
        [
          "A partner's first user (its owner)",
          "An administrator",
          "Registering the partner sends the first invitation; **Send a new invitation link** on the partner's page issues another. Accepting the invitation creates the user.",
        ],
        [
          "The rest of a partner's team",
          "The partner's owner or admin",
          "The **Team** page in their portal. Nobody on the platform side needs to do anything.",
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
        "Issuing a new link stops the previous one working, for staff, drivers and partners alike.",
        "An activation link (choose a password) lives for **48 hours**. A partner's registration link has its own expiry, shown beside it on the partner's page.",
        "After choosing a password, the person signs in to their own panel — staff here, drivers in the driver panel, partners in the portal.",
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
        {
          term: "A staff account",
          description: "A super admin presses **Deactivate** on the account in **People → Staff**. Every open session ends at once and the next request is refused; **Reactivate** undoes it.",
        },
        {
          term: "A driver",
          description: "**Deactivate driver** on their page ends the login and every open session at once, and can send their upcoming jobs back to dispatch.",
        },
        {
          term: "A partner",
          description: "**Suspend** on the partner's page ends every open session for every user of that company. It is reversible with **Reinstate**. One person at a partner is switched off by the partner's own owner, on their **Team** page.",
        },
      ],
    },
  ],
} satisfies HelpArticle;
