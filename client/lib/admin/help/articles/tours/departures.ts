import type { HelpArticle } from "../../types";

/**
 * `/admin/tours/[slug]/departures` (`TourCalendarManager.tsx`). Option and
 * window in the URL; the grid is read-only; the range editor's fields and
 * limits; 409 naming the dates when capacity would drop below what is
 * booked; the no-option empty state; capacity on a future departure as a
 * publish blocker.
 */
export const article = {
  id: "tr-departures",
  title: "Departures and capacity",
  summary: "Setting how many seats or groups each option has on each date, in ranges rather than one cell at a time.",
  category: "tours",
  roles: ["ADMIN"],
  routes: ["/admin/tours/[slug]/departures"],
  keywords: ["capacity", "seats", "groups", "calendar", "availability", "blocked", "apply to range", "departure", "sold out", "overbooked"],
  related: ["tr-options-prices", "tr-publish-checklist", "tr-hub", "ht-inventory-pricing"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Tours", "[tour]", "Departures"] },
    {
      type: "paragraph",
      text: "Departures are capacity by date. The screen shows one option over one window of dates — both are part of the page address, so a bookmark returns to the same view — and changes are made to a range of dates at once, never to a single cell.",
    },
    { type: "heading", id: "reading-the-grid", text: "Reading the grid" },
    {
      type: "paragraph",
      text: "The grid is read-only. It shows, for each date in the window, how many units the option has, how many are blocked and how many are booked. To change it you use the range editor beside it. Until the tour has an option the screen reads **Add an option first — there is nothing to put on a calendar yet.**",
    },
    { type: "heading", id: "setting-capacity", text: "Setting capacity for a range" },
    {
      type: "steps",
      items: [
        "Choose the option, and the window if the dates you want are outside it.",
        "Set **From** and **To**, and untick any weekday the change should skip.",
        "Enter the seats or groups — the total units, 0 to 10000. The placeholder reads `keep`; leave it blank to change nothing about the total.",
        "Enter blocked units, 0 to 10000, for capacity to hold back from sale, and a note of up to 300 characters if the dates need one.",
        "Press **Apply to range**. Every matching date in the range takes the new values.",
      ],
    },
    {
      type: "paragraph",
      text: "For an option priced per group the units are groups; for one priced per person they are seats. A shared option with 12 seats on every Saturday from June to September is one application of the editor.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Capacity cannot drop below what is already booked",
      text: "If the total on any date in the range would fall under the seats already sold, the server refuses the whole change and names the dates. Cancel or move those bookings first, or leave those dates out of the range.",
    },
    {
      type: "callout",
      tone: "info",
      text: "Capacity on at least one future departure is a publish blocker. A tour with options and prices but an empty calendar will not go on sale.",
    },
  ],
} satisfies HelpArticle;
