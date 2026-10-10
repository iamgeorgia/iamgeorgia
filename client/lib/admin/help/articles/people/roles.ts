import type { HelpArticle } from "../../types";

/**
 * `/admin/roles` (`roles/page.tsx`), `/admin/roles/new` (`NewRoleForm`) and
 * `/admin/roles/[key]` (`RoleEditor`), plus the Roles and Overrides panels on
 * `/admin/users/[id]` (`UserAccess`). Encodes: the `roles.manage` capability
 * (super admins); the server's refusals in `server/services/rbac/` — a built-in
 * role cannot be deleted, SUPER_ADMIN and DRIVER capabilities are fixed, a role
 * in use cannot be deleted, an account needs one built-in role, and nobody
 * hands out a capability they do not hold themselves (ROLE_ABOVE_CEILING).
 */
export const article = {
  id: "pp-roles",
  title: "Roles and permissions",
  summary: "What a role is, built-in versus custom roles, one-off overrides, and the rule that you can only hand out what you hold.",
  category: "people",
  roles: ["ADMIN"],
  routes: ["/admin/roles", "/admin/roles/new", "/admin/roles/[key]"],
  keywords: [
    "role",
    "roles",
    "permission",
    "capability",
    "custom role",
    "override",
    "grant",
    "withhold",
    "access",
    "ceiling",
    "built in",
  ],
  related: ["pp-staff", "gs-roles", "pp-audit-log"],
  blocks: [
    { type: "where", path: ["Sidebar", "People", "Roles"] },
    {
      type: "paragraph",
      text: "A **role** is a named set of things an account may do — read bookings, record payments, assign drivers. An account holds one or more roles, and what it can do is the sum of them. The sidebar and the server both follow from that, so changing a role changes what everyone who holds it can open.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Super admins only",
      text: "Only people who hold **Roles: manage** see this screen. The server refuses everyone else, whatever address they type.",
    },
    { type: "heading", id: "built-in", text: "Built-in and custom roles" },
    {
      type: "list",
      items: [
        "**Built-in roles** ship with the platform: Super admin, Administrator, Management, Tour operator, Accountant, Finance operator and Dispatcher for staff; Owner, Admin, Agent and Finance for partner teams. They are marked **Built in**. Their capabilities can be edited, but they cannot be deleted.",
        "**Super admin** always holds every platform capability and cannot be edited. **Driver** is fixed too.",
        "**Custom roles** are yours. Press **New role**, name it, choose whether it is for staff (**Platform**) or a partner's team (**Partner**), and tick what it may do. The key you give it cannot be changed afterwards, and neither can its side.",
      ],
    },
    { type: "heading", id: "editing", text: "Editing a role" },
    {
      type: "paragraph",
      text: "Open a role from the list, change its name, description or capabilities, and press **Save changes**. Accounts that hold it get the change the next time they sign in. Some capabilities are shown greyed out with a lock: they only ever come with a built-in role and cannot be added to a custom one.",
    },
    {
      type: "paragraph",
      text: "A custom role can be deleted once nobody holds it. If someone does, the page tells you how many — take the role off them first.",
    },
    { type: "heading", id: "giving-roles", text: "Giving someone roles" },
    {
      type: "steps",
      items: [
        "Open **Staff** and then the person.",
        "In the **Roles** panel, tick every role they should hold and press **Save roles**.",
        "Their open sessions end, so the new access applies when they sign in again.",
      ],
    },
    {
      type: "paragraph",
      text: "Every account needs **at least one built-in role** as its primary role. Custom roles add to it. The page below the roles shows **What this account can do**, the full list that results.",
    },
    { type: "heading", id: "overrides", text: "Overrides" },
    {
      type: "paragraph",
      text: "An **override** adds or removes a single capability for one account, outside its roles. Use it for a one-off — covering a colleague's holiday, or keeping someone out of the margins for a month. If two people need the same thing, make a role instead.",
    },
    {
      type: "definitions",
      items: [
        { term: "Grant", description: "Adds a capability the account's roles do not give." },
        { term: "Withhold", description: "Takes away a capability the account's roles do give." },
      ],
    },
    {
      type: "list",
      items: [
        "A **reason** is required and goes in the audit log.",
        "An optional **last day** ends the override on its own; without one it stays until you remove it.",
        "Press **Remove** next to an override to end it early.",
      ],
    },
    { type: "heading", id: "ceiling", text: "You can only hand out what you hold" },
    {
      type: "paragraph",
      text: "Nobody can give away more than they have. When you assign a role or grant a capability, the server checks that you hold every capability involved. If you do not, it refuses and lists what is missing. The pickers only offer what you are allowed to give, so you will usually never see the refusal — but it is why an administrator cannot make themselves, or anyone else, a super admin.",
    },
    {
      type: "callout",
      tone: "info",
      text: "You cannot change your own roles or overrides. Another super admin has to. Every role change, grant and removal is written to the audit log.",
    },
    {
      type: "links",
      items: [
        { label: "Staff accounts", articleId: "pp-staff" },
        { label: "What each role sees in the panel", articleId: "gs-roles" },
      ],
    },
  ],
} satisfies HelpArticle;
