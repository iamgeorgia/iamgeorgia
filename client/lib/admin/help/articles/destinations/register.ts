import type { HelpArticle } from "../../types";

/**
 * The destinations register at `/admin/destinations` (`destinations/page.tsx`
 * and `DestinationsBrowser.tsx`): the three stat cards, search by name or
 * slug, the Type and Featured filters, the columns including the Hotels and
 * Children counts and the "Not placed" marker, tree order, a page size of 50,
 * and the two empty states. Destinations carry no status — only Featured.
 */
export const article = {
  id: "ds-register",
  title: "Destinations register",
  summary:
    "The tree of places every hotel, tour and package is filed inside: how to find one, what the columns say, and why there is no status column.",
  category: "destinations",
  routes: ["/admin/destinations"],
  keywords: ["places", "country", "region", "city", "resort", "tree", "featured", "not placed", "coordinates", "children"],
  related: ["ds-editing", "ht-create", "pb-b2c-vs-trade"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Destinations"] },
    {
      type: "paragraph",
      text: "Destinations are the tree everything else is filed inside. A country sits at the root; regions, cities and resorts sit inside it; and a hotel, tour or package cannot be created until the place it belongs to exists. The register is a reading screen — to change a place, open it.",
    },
    { type: "heading", id: "cards", text: "The three cards" },
    {
      type: "table",
      columns: ["Card", "What it counts"],
      rows: [
        ["Places on the map", "Every destination, of any type."],
        ["Countries", "The roots of the tree. As the hint says: everything below inherits their country code."],
        ["Featured", "Places with **Featured** ticked."],
      ],
    },
    { type: "heading", id: "finding", text: "Finding a place" },
    {
      type: "steps",
      items: [
        "Type in **Search a place by name or slug**. The list narrows as you type.",
        "Narrow further with **Type** (All types, Country, Region, City, Resort) and **Featured** (Featured and not, Featured only, Not featured).",
        "Page with **Previous** and **Next** at the foot. Fifty places are shown a page, and the footer reads `Showing 1–50 of 132`.",
      ],
    },
    { type: "heading", id: "columns", text: "The columns" },
    {
      type: "table",
      columns: ["Column", "What it shows"],
      rows: [
        ["Place", "The name, a star when it is featured, and underneath it the ancestry and slug. Rows are indented by their depth in the tree."],
        ["Type", "Country, Region, City or Resort."],
        ["Country", "The two-letter country code."],
        ["Hotels", "How many hotels are filed in this place."],
        ["Children", "How many destinations sit inside it."],
        ["Coordinates", "Latitude and longitude — or `Not placed`, in warning colour, when the place has no pin yet."],
      ],
    },
    {
      type: "paragraph",
      text: "Rows arrive in tree order: each country followed by everything inside it, so the list reads like an outline rather than alphabetically. There is no sorting by column. Narrow screens hide the Type, Country, Children and Coordinates columns first.",
    },
    {
      type: "callout",
      tone: "info",
      title: "No status",
      text: "A destination is never draft, on sale or archived — it has no status at all. The only flag is **Featured**, and since the public destinations section is retired, even that changes nothing a visitor can see today.",
    },
    { type: "heading", id: "empty", text: "When the list is empty" },
    {
      type: "list",
      items: [
        "With filters on: **No destinations match those filters.** Clear the search, the type or the featured filter.",
        "With nothing filed at all: **No destinations yet. Add a country first — everything else is filed inside one.** Create the country before anything else.",
      ],
    },
    {
      type: "links",
      items: [
        { label: "Add destination", href: "/admin/destinations/new" },
        { label: "Creating and editing a destination", articleId: "ds-editing" },
      ],
    },
  ],
} satisfies HelpArticle;
