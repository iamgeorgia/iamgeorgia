import type { HelpArticle } from "../../types";

/**
 * `/admin/users` (`users/page.tsx`, `UsersBrowser`, `InviteUserModal`) and
 * `/admin/users/[id]` (`UserActions`, `UserDangerZone`). Encodes: the
 * `users.staff.manage` capability (SUPER_ADMIN only, others are sent to
 * `/admin`); the role table in `lib/admin/users.ts`; statuses as derived by
 * `statusOf` in `server/services/user.service.js`; activation link lifetime
 * from `activationTtlMs` in `server/config.js`; the SELF, NOT_ACTIVATED,
 * STILL_ACTIVE and LAST_SUPER_ADMIN refusals.
 */
export const article = {
  id: "pp-staff",
  title: "Staff accounts",
  summary: "Inviting colleagues into the panel, choosing their role, and retiring an account.",
  category: "people",
  roles: ["ADMIN"],
  routes: ["/admin/users", "/admin/users/[id]"],
  keywords: [
    "staff",
    "users",
    "invite",
    "role",
    "colleague",
    "new admin",
    "activation link",
    "resend",
    "deactivate",
    "reactivate",
    "delete account",
    "sign out everywhere",
    "super admin",
    "permissions",
  ],
  related: ["pp-audit-log", "gs-roles", "gs-accounts", "rf-dangerous-actions"],
  blocks: [
    { type: "where", path: ["Sidebar", "People", "Staff"] },
    {
      type: "paragraph",
      text: "**Staff** lists everyone who can sign in to this panel. From here you invite a colleague, decide what they may do, and switch an account off when they leave. Drivers and partner users are not here — they have their own pages.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Super admins only",
      text: "Only a super admin sees **Staff** in the sidebar. Anyone else who opens the address is sent back to the overview, and the server refuses their requests regardless.",
    },
    { type: "heading", id: "roles", text: "The roles" },
    {
      type: "table",
      columns: ["Role", "What they can do"],
      rows: [
        ["Super admin", "Everything, including this screen and the audit log."],
        ["Administrator", "Runs everything except the staff accounts."],
        ["Management", "Reads everything, margins included, and changes nothing."],
        ["Reservations", "Works the bookings — confirm, decline, cancel — without seeing margins."],
        ["Finance", "Reads bookings, partners, bank details and margins."],
        ["Dispatcher", "Fleet, drivers and dispatch only."],
      ],
    },
    { type: "heading", id: "inviting", text: "Inviting a colleague" },
    {
      type: "steps",
      items: [
        "Press **Invite staff** at the top of the list.",
        "Fill in their name and email, and choose a role. Position and phone are optional.",
        "Press **Send invitation**. They are emailed a link to choose a password.",
        "The same link is shown on screen with a **Copy link** button. If the email could not be sent the screen says so — copy the link and send it yourself.",
      ],
    },
    {
      type: "list",
      items: [
        "The link works for **48 hours**. Once they choose a password they can sign in.",
        "If it expires or goes astray, open their account and press **Send a new activation link**. The earlier link stops working.",
        "An invitation never makes a super admin. Invite them with another role and change it once they have signed in.",
        "An email address already in use is refused, and the form says so beside the field.",
      ],
    },
    { type: "heading", id: "statuses", text: "Statuses" },
    {
      type: "definitions",
      items: [
        { term: "Invited", description: "Invited, but no password chosen yet. The account cannot sign in." },
        { term: "Active", description: "Can sign in with the permissions of their role." },
        { term: "Deactivated", description: "Switched off. Cannot sign in, and every session has ended. Can be reactivated." },
      ],
    },
    { type: "heading", id: "changing-role", text: "Changing someone's role" },
    {
      type: "paragraph",
      text: "On their page, pick the new role and press **Change role to …**, then **Confirm change**. Every session they have open ends at once, so the new role takes effect the moment they sign in again. Use **Sign out everywhere** on its own when you only need to end their sessions — after a lost laptop, say — without changing anything else.",
    },
    { type: "heading", id: "deactivate-or-delete", text: "Deactivate or delete" },
    {
      type: "table",
      columns: ["What", "Deactivate", "Delete"],
      rows: [
        ["For", "An active account — someone who has left or should pause.", "An unused invitation, or an account already deactivated."],
        ["Effect", "Signed out everywhere; cannot sign in. Name stays on file.", "The account is removed. Bookings they made keep their record."],
        ["Undo", "**Reactivate account** — their old password works again.", "Not possible. Invite them again if needed."],
        ["Reason", "Optional, kept in the audit log.", "Type their email address to confirm."],
      ],
    },
    {
      type: "paragraph",
      text: "An invitation that was never used cannot be deactivated — delete it instead. An active account cannot be deleted — deactivate it first, so that removing someone is always two deliberate steps.",
    },
    { type: "heading", id: "rules", text: "Two rules the server enforces" },
    {
      type: "list",
      items: [
        "**Not your own account.** You cannot change your own role, deactivate or delete yourself. Your own page shows no actions and says why; ask another super admin.",
        "**Never the last super admin.** The last super admin who can sign in cannot be demoted, deactivated or deleted, so the panel always has someone who can manage staff.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      text: "Every invitation, role change, deactivation and delete is written to the audit log with who did it and when.",
    },
    {
      type: "links",
      items: [
        { label: "The audit log", articleId: "pp-audit-log" },
        { label: "What each role sees in the panel", articleId: "gs-roles" },
      ],
    },
  ],
} satisfies HelpArticle;
