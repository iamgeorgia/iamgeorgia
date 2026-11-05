import type { HelpArticle } from "../../types";

/**
 * The tours register at `/admin/tours` (`ToursBrowser.tsx`). Search over
 * title, slug and region; Status and Category filters; the six columns; the
 * card list below `lg`; page size 25. The From column is the cheapest adult
 * sell across active options, which is not what the same column means on the
 * hotels or packages registers.
 */
export const article = {
  id: "tr-register",
  title: "Tours register",
  summary: "Finding a tour, reading its row, and what the From price on this screen actually is.",
  category: "tours",
  routes: ["/admin/tours"],
  keywords: ["tour list", "find a tour", "search tours", "filter", "category", "status", "from price", "public", "b2c"],
  related: ["tr-create", "tr-hub", "rf-search-filters", "pb-statuses"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Tours"] },
    {
      type: "paragraph",
      text: "The register lists every tour on the platform, twenty-five to a page. Open a row to reach the tour's hub; **Add tour** at the top starts a new one.",
    },
    { type: "heading", id: "finding-a-tour", text: "Finding a tour" },
    {
      type: "list",
      items: [
        "The search box matches the title, the slug or the region.",
        "**Status** narrows the list to Draft, On sale, Off sale or Archived.",
        "**Category** narrows it to adventure, culture, wine, nature or city.",
        "The line above the table gives the count, or reads **No tours match these filters.** when nothing does. An empty page inside the table reads **Nothing to show.**",
      ],
    },
    { type: "heading", id: "columns", text: "The columns" },
    {
      type: "table",
      columns: ["Column", "What it shows"],
      rows: [
        ["Tour", "A thumbnail, the title, the star rating and the supplier. **· Public** is appended when the tour is switched on for public sale."],
        ["Destination", "The destination the tour is filed under."],
        ["Category", "One of the five categories."],
        ["Length", "The length as a traveller reads it."],
        ["Status", "`DRAFT`, `ACTIVE`, `INACTIVE` or `ARCHIVED`, as an icon and a word."],
        ["From", "The cheapest adult selling price across the tour's active options."],
      ],
    },
    {
      type: "callout",
      tone: "info",
      text: "From means something different on each register. Here it is the cheapest adult sell across active options; on the hotels register it is the cheapest nightly rate, and on the packages register it is a sampled price a nightly job writes. The three columns look identical.",
    },
    {
      type: "paragraph",
      text: "On a narrow screen the table gives way to a stacked list of cards carrying the same facts.",
    },
  ],
} satisfies HelpArticle;
