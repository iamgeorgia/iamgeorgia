import type { HelpArticle } from "../../types";

/**
 * How every register in the panel is searched, filtered and paged. Encodes
 * the `…QueryFromParams` readers (filters live in the address, unknown
 * values are dropped silently), the per-register search fields, filters and
 * page sizes, the 300–350 ms debounce, the three pagination widgets, the
 * card lists below `lg`, the transfer bookings register's missing
 * Previous/Next, and the presentational top-bar search box.
 */
export const article = {
  id: "rf-search-filters",
  title: "Search, filters, paging and bookmarks",
  summary:
    "Every register keeps its search, filters and page in the address, so a view can be bookmarked or shared — and each register has its own set of them.",
  category: "reference",
  roles: ["ADMIN", "DISPATCHER"],
  keywords: ["search", "filter", "pagination", "page", "bookmark", "url", "address", "query", "debounce", "next page", "previous"],
  related: ["gs-sidebar-and-top-bar", "bk-transfer-bookings-register", "dp-dispatch-board", "rf-troubleshooting"],
  blocks: [
    {
      type: "paragraph",
      text: "A register is a list screen: bookings, hotels, routes, drivers and the rest. Each one takes what you type in its search box and choose in its filters and writes it into the page address — `?search=`, `?status=`, `?from=` and `?to=`, `?page=`. The list you are looking at is therefore the address you are looking at. Copy it into a message and a colleague opens the same view; bookmark it and it is there tomorrow.",
    },
    {
      type: "heading",
      id: "typing",
      text: "Typing in a search box",
    },
    {
      type: "paragraph",
      text: "A search box waits about a third of a second after you stop typing before it asks the server, so the list does not flicker on every keystroke. There is no search button and nothing to press. Rows come back in the order the server decides — newest first for bookings, soonest pick-up first for transfers, tree order for destinations — and no register offers a sort control.",
    },
    {
      type: "heading",
      id: "registers",
      text: "What each register searches and filters",
    },
    {
      type: "table",
      columns: ["Register", "Search matches", "Filters", "Rows per page"],
      rows: [
        ["Hotel bookings", "Reference, guest name or email", "**Status**; **Arriving** from and to", "25"],
        ["Orders", "Reference, buyer name or email", "**Travelling** from and to; status chips (several at once) with an **On request** chip that carries the global pending count", "25"],
        ["Tour bookings", "Reference, traveller name or email", "**Status**; **Departing** from and to", "25"],
        ["Transfer bookings", "No search box", "No filters, and no **Previous** / **Next** — change the page by editing `?page=` in the address", "Shown as `Page X of Y · N bookings`"],
        ["Dispatch", "Reference or passenger", "**From** and **To** dates; status (**Every status** or one of the ten leg states). No default window: with the dates empty the board shows every leg", "50"],
        ["Destinations", "Name or slug", "**Type**; **Featured**", "50"],
        ["Hotels", "Name, slug or address", "**Status**; **Property type**", "25"],
        ["Tours", "Title, slug or region", "**Status**; **Category**", "25"],
        ["Packages", "Name or slug", "**Status**; **Kosher**", "25"],
        ["Services", "Name or slug", "**Status**; **Category**; a **Kosher only** chip", "25"],
        ["Partners and Applications", "Company name, Partner ID, registration number or email", "Status chips; type chips; a **Clear filters** link", "20"],
        ["Routes", "A route, or either end of one", "**Tier**; **Category**", "25"],
        ["Pick-up points", "A place, a region or an airport code", "None; retired points are listed greyed out", "Whole list, not paged"],
        ["Vehicle classes", "No search box", "None", "Whole list, not paged"],
        ["Fleet", "Make, model or plate", "Status", "25"],
        ["Drivers", "Name, phone or email", "Verification; active or deactivated", "Paged"],
        ["Ratings", "No search box", "Tabs: **Waiting for a look**, **Published**, **Rejected**", "25"],
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Three ways of writing the same thing",
      text: "Some registers end with `Showing a–b of N`, some with `Page X of Y`, and some with `Page X of Y · N items`. They mean the same thing; the difference is only in the wording.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "A bookmark can quietly lose its filter",
      text: "A register ignores any value in the address it does not recognise — a status that has been renamed, a filter typed by hand — and shows the unfiltered list without saying so. If a bookmarked view shows more than you expect, look at the filters before you trust the count.",
    },
    {
      type: "heading",
      id: "counts",
      text: "Counts that are not what they look like",
    },
    {
      type: "list",
      items: [
        "On the Orders register the **On request** chip shows the pending count for the whole platform, whatever the table is filtered to.",
        "On the Hotel bookings register **Value on this page** sums the rows in front of you, so it changes when you turn the page or filter. It is not a business total.",
        "On the Overview, **Arriving soon** is the length of a five-row list, not a count; it reads `5` however many arrivals there are.",
        "On the Routes register the **Unpriced** figure is counted from the first hundred routes only and is shown with a plus sign.",
      ],
    },
    {
      type: "heading",
      id: "small-screens",
      text: "On a phone or a narrow window",
    },
    {
      type: "paragraph",
      text: "Below a certain width a register's table is replaced by a stacked list of cards carrying the same rows, so nothing is hidden by a horizontal scroll. The Packages register is the exception and keeps its table. Some columns are hidden on narrower screens even on a desktop; the row's link still opens the full record.",
    },
    {
      type: "callout",
      tone: "info",
      title: "The search box in the top bar",
      text: "The box at the top of every screen, labelled **Search bookings, partners…**, is not connected to anything and does nothing when you type in it. Use the search box on the register you are looking at. The notification bell beside it is also only a display.",
    },
  ],
} satisfies HelpArticle;
