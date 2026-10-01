import type { HelpArticle } from "../../types";

/**
 * The chrome around every screen: the sidebar's groups, sections and count
 * pills (`lib/admin/navigation.ts`), and the top bar (`AdminShell.tsx`) —
 * including the two controls that do nothing yet, which a new reader will
 * otherwise try.
 */
export const article = {
  id: "gs-sidebar-and-top-bar",
  title: "Finding your way: the sidebar and the top bar",
  summary:
    "What the groups and count pills in the sidebar mean, what the top bar holds, and which two controls are not wired up yet.",
  category: "getting-started",
  roles: ["ADMIN", "DISPATCHER"],
  keywords: ["navigation", "menu", "sidebar", "badge", "count", "pill", "notifications", "bell", "search box", "mobile"],
  related: ["gs-roles", "gs-overview", "rf-search-filters"],
  blocks: [
    {
      type: "heading",
      id: "sidebar",
      text: "The sidebar",
    },
    {
      type: "paragraph",
      text: "The dark column on the left lists every screen your role can open, in three titled groups. **Transfers** is a section rather than a link: it folds open to show two short lists, **Catalogue** (routes, pick-up points, vehicle classes, extras) and **Fleet & drivers** (fleet, drivers, schedule, ratings). Click the section's title to collapse or expand it; opening one of its screens expands it again so the screen you are on is never hidden.",
    },
    {
      type: "paragraph",
      text: "On a narrow screen the sidebar becomes a drawer behind the menu button at the start of the top bar. Choosing a screen closes it.",
    },
    {
      type: "heading",
      id: "badges",
      text: "The count pills",
    },
    {
      type: "paragraph",
      text: "An orange number beside a screen is a queue: records on that screen waiting for a decision. It is the number to look at before clicking anything.",
    },
    {
      type: "table",
      columns: ["Beside", "Counts"],
      rows: [
        ["Hotel bookings", "Hotel bookings whose status is still pending."],
        ["Tour bookings", "On-request tour bookings the operator has not yet answered. The seats are already claimed."],
        ["Orders", "Orders with at least one part still waiting for a supplier's answer. Rooms and seats are held meanwhile."],
        ["Dispatch", "Legs with no driver on them yet."],
        ["Applications", "Partner applications waiting for approval."],
      ],
    },
    {
      type: "paragraph",
      text: "A collapsed **Transfers** section shows the total of the pills it is hiding, so folding it away never loses a queue.",
    },
    {
      type: "callout",
      tone: "info",
      text: "The sidebar says **Hotel bookings**; the screen it opens is titled **Bookings**. They are the same register.",
    },
    {
      type: "heading",
      id: "top-bar",
      text: "The top bar",
    },
    {
      type: "definitions",
      items: [
        {
          term: "Search box",
          description:
            "Not connected to anything yet. Typing in it does nothing. Each register has its own search field above its table — use those.",
        },
        {
          term: "Bell",
          description:
            "Shows a dot when hotel bookings or partner applications are waiting, but clicking it does nothing. The sidebar pills carry the same information and do lead somewhere.",
        },
        {
          term: "Account menu",
          description:
            "Your initials, name and role. Opens to show your email address and the **Sign out** item.",
        },
        {
          term: "Help",
          description:
            "Every screen has a **Help** button beside its title. It opens the page of this manual written for that screen, without leaving the screen.",
        },
      ],
    },
    {
      type: "heading",
      id: "public-site",
      text: "Back to the public site",
    },
    {
      type: "paragraph",
      text: "**View public site** at the bottom of the sidebar opens the site travellers see, in the same language you are using the panel in. You stay signed in; the public site simply does not show that you are.",
    },
  ],
} satisfies HelpArticle;
