import type { HelpArticle } from "../../types";

/**
 * The hotels register at `/admin/hotels` (`hotels/page.tsx` and
 * `HotelsBrowser.tsx`): the three stat cards, search by name, slug or
 * address, the Status and Property type filters (nine types from
 * `lib/admin/hotels.ts`), the columns with the two server-derived kosher
 * badges, the From price, the card list below `lg`, and a page size of 25.
 */
export const article = {
  id: "ht-register",
  title: "Hotels register",
  summary: "Every property in one list: how to find one, what the kosher badges and the From price mean, and where to start a new one.",
  category: "hotels",
  routes: ["/admin/hotels"],
  keywords: ["properties", "property list", "search hotel", "status filter", "property type", "kosher badge", "from price", "on sale", "drafts"],
  related: ["ht-create", "ht-hub", "pb-statuses", "rf-search-filters"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Hotels"] },
    {
      type: "paragraph",
      text: "The register lists every property, whatever its status. Nothing is edited here: open a row to reach the property's hub, or press **Add property** to start a new one.",
    },
    { type: "heading", id: "cards", text: "The three cards" },
    {
      type: "table",
      columns: ["Card", "What it counts"],
      rows: [
        ["On sale", "Properties with status `ACTIVE` — visible in search and bookable."],
        ["Drafts", "Properties still being set up."],
        ["All properties", "Every property, including those off sale and archived."],
      ],
    },
    { type: "heading", id: "finding", text: "Finding a property" },
    {
      type: "steps",
      items: [
        "Type in **Search by name, slug or address**. The list updates as you type.",
        "Narrow with **Status** — All statuses, Draft, On sale, Off sale, Suspended, Archived.",
        "Narrow with **Property type** — Hotel, Boutique, Resort, Guesthouse, Lodge, Apartment, Chalet, Hostel or Villa.",
        "Page with **Previous** and **Next**; the foot reads `Page 1 of 4`. Twenty-five properties are shown a page.",
      ],
    },
    {
      type: "paragraph",
      text: "The line above the table gives the live count — `12 properties` — or **No properties match these filters.** An empty table reads **Nothing to show.**",
    },
    { type: "heading", id: "columns", text: "The columns" },
    {
      type: "table",
      columns: ["Column", "What it shows"],
      rows: [
        ["Property", "A thumbnail, the name, the star rating, the supplier, and any kosher badge."],
        ["Destination", "The place it is filed in."],
        ["Type", "One of the nine property types."],
        ["Status", "An icon and a word — Draft, On sale, Off sale, Suspended or Archived."],
        ["From", "The cheapest nightly rate the property currently carries."],
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "The kosher badges are earned, not ticked",
      text: "A green **Kosher** badge appears only when the property is certified — that is, it holds a verified, unexpired certificate for the whole property or its kitchen. A red **Kosher cert expired** badge means the certificate it relied on has lapsed. Neither can be set by hand; both follow the certificates on the property's Kosher screen.",
    },
    {
      type: "paragraph",
      text: "On a narrow screen the table becomes a stacked list of cards carrying the same facts.",
    },
    {
      type: "links",
      items: [
        { label: "Add property", href: "/admin/hotels/new" },
        { label: "Adding a property", articleId: "ht-create" },
        { label: "Kosher profile and certificates", articleId: "ht-kosher" },
      ],
    },
  ],
} satisfies HelpArticle;
