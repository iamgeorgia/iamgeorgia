import type { HelpArticle } from "../../types";

/**
 * The two panel roles. `ADMIN_ROLES` and `TRANSFER_OPS_ROLES` in
 * `server/middleware/auth.js` decide the split; `navigationFor(role)` in
 * `lib/admin/navigation.ts` keeps the sidebar honest about it. Also records
 * the two labelling quirks a reader will notice: "Operations" for ADMIN and
 * the zero badges a dispatcher sees.
 */
export const article = {
  id: "gs-roles",
  title: "Administrator and Dispatcher",
  summary:
    "Administrators see everything; dispatchers see the transfer operations screens and nothing that would answer 'not permitted'.",
  category: "getting-started",
  roles: ["ADMIN", "DISPATCHER"],
  keywords: ["role", "permission", "access", "dispatcher", "administrator", "super admin", "operations", "403", "forbidden"],
  related: ["gs-accounts", "gs-sidebar-and-top-bar", "rf-troubleshooting"],
  blocks: [
    {
      type: "paragraph",
      text: "Every staff account has one role. The role decides which screens the sidebar lists, and — separately and more importantly — which requests the server will answer. The sidebar is a courtesy; the server is the rule. Typing the address of a screen your role cannot use gives an empty page of refused requests, not a secret door.",
    },
    {
      type: "table",
      columns: ["Role", "Shown in the top bar as", "Can reach"],
      rows: [
        [
          "Administrator (`SUPER_ADMIN`)",
          "Administrator",
          "Every screen. Identical in every way to the role below — the two names exist for history, not for a difference in power.",
        ],
        [
          "Administrator (`ADMIN`)",
          "Operations",
          "Every screen. The label reads \"Operations\" although the role is a full administrator.",
        ],
        [
          "Dispatcher (`DISPATCHER`)",
          "Dispatcher",
          "Transfer bookings, Dispatch, Fleet, Drivers, Schedule and Ratings. Nothing else — not the fares, not partners, not the hotels.",
        ],
      ],
    },
    {
      type: "heading",
      id: "dispatcher",
      text: "What a dispatcher's panel looks like",
    },
    {
      type: "list",
      items: [
        "The sidebar lists only the six operations screens; the **Transfers** section shows its **Fleet & drivers** half and hides the catalogue half.",
        "There is no **Overview** link. Opening `/admin` directly sends a dispatcher straight to the dispatch board.",
        "A dispatcher may add and edit cars and drivers, and may take a car off the road or deactivate a driver, but only an administrator may **delete** one.",
        "A dispatcher can upload fleet photographs and driver documents, but cannot delete a file from the media library.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "A zero that means \"not permitted\"",
      text: "The count pills beside **Hotel bookings**, **Tour bookings**, **Orders** and **Applications** are figures a dispatcher is not allowed to read. Their sidebar does not list those screens, and anywhere a count would otherwise appear it shows `0`. That zero is not a statement that the queue is empty.",
    },
    {
      type: "heading",
      id: "other-roles",
      text: "Accounts that never reach this panel",
    },
    {
      type: "paragraph",
      text: "Partner users (an agency's or a supplier's staff) sign in to the partner portal at `/portal`; drivers sign in to the driver panel at `/driver`. If one of them signs in at the admin address they are sent to their own panel. Their accounts are created from inside this panel — see the article on accounts — but they never see it.",
    },
  ],
} satisfies HelpArticle;
