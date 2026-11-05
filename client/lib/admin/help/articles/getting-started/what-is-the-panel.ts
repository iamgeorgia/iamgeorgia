import type { HelpArticle } from "../../types";

/**
 * The opening page of the manual. Frames the panel as the back office of a
 * B2B-first booking platform, names the three sidebar groups, and says
 * plainly that the panel is English-only (`admin/layout.tsx`).
 */
export const article = {
  id: "gs-what-is-the-panel",
  title: "What the admin panel is",
  summary:
    "The back office for bookings, inventory and partners — where the platform's staff work, as opposed to what travellers and agencies see.",
  category: "getting-started",
  keywords: ["introduction", "overview", "back office", "b2b", "trade", "english"],
  related: ["gs-roles", "gs-sidebar-and-top-bar", "gs-quick-start-admin", "gs-quick-start-dispatcher"],
  blocks: [
    {
      type: "paragraph",
      text: "I'am Georgia sells hotel stays, tours, private transfers and packages that combine them. Travellers book on the public site; travel agencies book through their own partner portal; drivers see their jobs in a driver panel. This panel is the fourth surface — the one where the platform's own staff keep the catalogue right, answer the requests that hold capacity, and put drivers on cars.",
    },
    {
      type: "heading",
      id: "three-groups",
      text: "Four groups of screens",
    },
    {
      type: "definitions",
      items: [
        {
          term: "Operations",
          description:
            "The overview and the four registers — hotel bookings, transfer bookings, tour bookings and orders — plus the dispatch board. These are the screens where something is waiting for a decision.",
        },
        {
          term: "Inventory",
          description:
            "Destinations, hotels, the transfers catalogue and fleet, tours, packages and services. This is catalogue maintenance: it changes less often, and only administrators change it.",
        },
        {
          term: "Network",
          description:
            "Partners — the supplier companies and agencies — and the queue of applications waiting for approval.",
        },
        {
          term: "People",
          description:
            "The staff accounts (super admins only) and the audit log — who did what, and when.",
        },
      ],
    },
    {
      type: "heading",
      id: "trade-first",
      text: "Everything is trade-only until somebody says otherwise",
    },
    {
      type: "paragraph",
      text: "A new hotel, tour, package, service or vehicle class is sold to signed-in partners only. Each one carries a separate **Public sale (B2C)** switch that puts it in front of anonymous visitors on the public site. Publishing and going public are two different decisions, and this manual keeps them apart.",
    },
    {
      type: "callout",
      tone: "info",
      title: "The panel is in English",
      text: "The public site is translated into Georgian, Russian and Hebrew; the panel is not. Opening it under `/ka/admin` or `/he/admin` mirrors the layout for right-to-left reading but every word stays English. Dates are written the British way — day, month, year.",
    },
    {
      type: "heading",
      id: "where-next",
      text: "Where to go next",
    },
    {
      type: "links",
      items: [
        { label: "Administrator and Dispatcher — what each role sees", articleId: "gs-roles" },
        { label: "Finding your way — the sidebar and the top bar", articleId: "gs-sidebar-and-top-bar" },
        { label: "Quick start for administrators", articleId: "gs-quick-start-admin" },
        { label: "Quick start for dispatchers", articleId: "gs-quick-start-dispatcher" },
        { label: "Dangerous actions — the do-not list", articleId: "rf-dangerous-actions" },
      ],
    },
  ],
} satisfies HelpArticle;
