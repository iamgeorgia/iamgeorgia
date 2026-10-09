import type { HelpArticle } from "../../types";

/**
 * The staff roles. `ROLE_CAPABILITIES` in `server/lib/permissions.js` decides
 * what each one may do; the session carries the result as `capabilities`, and
 * `navigationFor(capabilities)` in `lib/admin/navigation.ts` keeps the sidebar
 * honest about it. Also records the zero badges a role sees for a queue it
 * does not work.
 */
export const article = {
  id: "gs-roles",
  title: "Staff roles",
  summary:
    "Six staff roles, from super admin to dispatcher: what each one sees, what each one may change, and who sees the money.",
  category: "getting-started",
  roles: ["ADMIN", "DISPATCHER"],
  keywords: [
    "role",
    "permission",
    "access",
    "dispatcher",
    "administrator",
    "super admin",
    "management",
    "reservations",
    "finance",
    "capability",
    "margin",
    "403",
    "forbidden",
  ],
  related: ["gs-accounts", "pp-staff", "gs-sidebar-and-top-bar", "rf-troubleshooting"],
  blocks: [
    {
      type: "paragraph",
      text: "Every staff account has one role. The role decides which screens the sidebar lists, and — separately and more importantly — which requests the server will answer. The sidebar is a courtesy; the server is the rule. Typing the address of a screen your role cannot use gives refused requests, not a secret door.",
    },
    {
      type: "table",
      columns: ["Role", "Reads", "May change", "Sees net, markup and margin"],
      rows: [
        [
          "Super admin",
          "Everything",
          "Everything, and is the only role that invites, changes and removes staff accounts",
          "Yes",
        ],
        ["Administrator", "Everything", "Everything except staff accounts", "Yes"],
        [
          "Management",
          "Everything an administrator reads, the audit log included",
          "Nothing",
          "Yes",
        ],
        [
          "Reservations",
          "The catalogue, every booking and order, the partners, the dispatch board",
          "Bookings and orders: confirms and declines requests, cancels",
          "No — sees which agency booked, never what we earn",
        ],
        [
          "Finance",
          "The catalogue, every booking and order, the partners and their bank details, pricing rules, the audit log",
          "Nothing yet; payments and invoices arrive with the finance screens",
          "Yes",
        ],
        [
          "Dispatcher",
          "Transfer bookings, dispatch, fleet, drivers, schedule and ratings",
          "Cars, drivers and assignments",
          "No",
        ],
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Which role to give someone",
      text: "Give the narrowest role that lets the person do their job. Someone answering booking requests is **Reservations**; someone checking the numbers is **Finance** or **Management**; someone running the cars is **Dispatcher**. **Administrator** is for the people who run the catalogue and the partners.",
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
        "A dispatcher can read a booking but cannot cancel or change it — that is the reservations desk's job.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "A zero that means \"not your queue\"",
      text: "A count pill shows `0` for a queue your role does not work — a dispatcher's **Hotel bookings** and **Applications**, a finance user's **Dispatch**. That zero is not a statement that the queue is empty.",
    },
    {
      type: "heading",
      id: "other-roles",
      text: "Accounts that never reach this panel",
    },
    {
      type: "paragraph",
      text: "Partner users (an agency's or a supplier's staff) sign in to the partner portal at `/portal`, where the company's owner manages its own team; drivers sign in to the driver panel at `/driver`. If one of them signs in at the admin address they are sent to their own panel.",
    },
  ],
} satisfies HelpArticle;
