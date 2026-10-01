import type { HelpArticle } from "../../types";

/**
 * The Overview at `/admin` (`(panel)/page.tsx`). Every tile explained, with
 * the three caveats the code itself carries: "Arriving soon" is the length of
 * a five-row list, the money tile shows one currency, and the greeting is
 * always "Good morning".
 */
export const article = {
  id: "gs-overview",
  title: "The Overview",
  summary: "What each tile and panel on the landing screen means, and which figures are not quite what they look like.",
  category: "getting-started",
  roles: ["ADMIN"],
  routes: ["/admin"],
  keywords: ["dashboard", "home", "landing", "stat", "tile", "active bookings", "arriving", "revenue", "good morning"],
  related: ["bk-hotel-bookings-register", "pt-applications", "gs-sidebar-and-top-bar"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Overview"] },
    {
      type: "paragraph",
      text: "The Overview is a reading screen: what is live, what is arriving, and what needs a decision. Nothing on it can be changed; every panel links to the register where the work is done. A dispatcher never sees it — their day starts on the dispatch board.",
    },
    {
      type: "heading",
      id: "tiles",
      text: "The four tiles",
    },
    {
      type: "table",
      columns: ["Tile", "What it counts", "Worth knowing"],
      rows: [
        ["Active bookings", "Hotel bookings that are confirmed or still pending.", "Hotel bookings only — tours, transfers and orders have their own registers."],
        [
          "Booked, last 30 days",
          "The total of hotel bookings placed in the last thirty days, cancellations excluded.",
          "Shown in one currency. When bookings were made in more than one, the tile shows the largest and says how many others it is not showing — it never adds lari to dollars.",
        ],
        [
          "Arriving soon",
          "Confirmed stays checking in from today.",
          "Capped at five: this is the length of the list in the panel below, not a true count. Once five or more guests are arriving it reads 5 for good.",
        ],
        ["Partner applications", "Applications waiting for a decision.", "The hint underneath gives the number of partners already approved."],
      ],
    },
    {
      type: "heading",
      id: "panels",
      text: "The three panels",
    },
    {
      type: "definitions",
      items: [
        { term: "Latest bookings", description: "The six newest hotel bookings. **View all** opens the register." },
        { term: "Arriving next", description: "Up to five confirmed check-ins, soonest first." },
        {
          term: "Partner applications",
          description: "The four oldest applications — oldest first, because that is the order they should be worked. **Review** opens the queue.",
        },
      ],
    },
    {
      type: "callout",
      tone: "info",
      text: "The greeting says **Good morning** at every hour of the day. It is not reading the clock.",
    },
  ],
} satisfies HelpArticle;
