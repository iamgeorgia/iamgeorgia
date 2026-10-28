import type { HelpArticle } from "../../types";

/**
 * The orders register at `/admin/orders` (`(panel)/orders/page.tsx`,
 * `OrdersBrowser.tsx`, `lib/admin/orders.ts`). Encodes the three tiles, the
 * multi-select status chips with the global "On request" count, the
 * Travelling date range, overdue highlighting, the five OrderStatus hints
 * verbatim, and the fixed page size of 25.
 */
export const article = {
  id: "bk-orders-register",
  title: "Orders register",
  summary: "Packages sold whole, and the parts of them still waiting for a supplier's answer — how to read and filter the on-request queue.",
  category: "bookings",
  routes: ["/admin/orders"],
  keywords: ["ORD", "package", "on request", "pending confirmation", "overdue", "deadline", "buyer", "travelling", "chips", "margin"],
  related: ["bk-order-detail", "bk-statuses-glossary", "pk-register", "rf-search-filters"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Orders"] },
    {
      type: "paragraph",
      text: "An order (`ORD-…`) is a whole trip — hotel, transfer, tour and service parts — bought as one thing, usually from a package. The register exists mainly for the on-request queue: parts whose rooms and seats are already claimed while a supplier has yet to answer. Nothing is changed here; open a reference to work its parts.",
    },
    {
      type: "heading",
      id: "tiles",
      text: "The three tiles",
    },
    {
      type: "table",
      columns: ["Tile", "What it counts"],
      rows: [
        ["Awaiting your answer", "Orders in `PENDING_CONFIRMATION` — **Rooms and seats claimed, supplier yet to answer**."],
        ["Confirmed", "Orders in `CONFIRMED`."],
        ["All orders", "Every order, in every status."],
      ],
    },
    {
      type: "heading",
      id: "filters",
      text: "Filtering the register",
    },
    {
      type: "steps",
      items: [
        "Type in the search box to match a reference, a buyer name or an email address.",
        "Set the **Travelling** date range to keep only orders whose trip falls between the two dates.",
        "Pick status chips. They multi-select: the highlighted **On request** chip first, then a divider, then **All**, Confirmed, Partly cancelled, Cancelled and Completed. Selecting exactly one status prints its hint beneath the chips.",
        "Page with **Previous** and **Next**; the page size is fixed at 25.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "The On request count is global",
      text: "The number on the **On request** chip is the count of every order awaiting an answer, whatever search or dates are set. The table beneath it is filtered; the chip is not.",
    },
    {
      type: "heading",
      id: "status-hints",
      text: "What each status means",
    },
    {
      type: "table",
      columns: ["Status", "Hint shown on the screen"],
      rows: [
        ["`PENDING_CONFIRMATION`", "A part is on request. Its capacity is held and nobody else can sell it."],
        ["`CONFIRMED`", "Every part is committed and the buyer has been told."],
        ["`PARTIALLY_CANCELLED`", "A part was dropped. The rest of the trip still runs."],
        ["`CANCELLED`", "Nothing survives. Any charge follows the terms frozen at booking."],
        ["`COMPLETED`", "The trip has finished."],
      ],
    },
    {
      type: "heading",
      id: "columns",
      text: "What each row shows",
    },
    {
      type: "list",
      items: [
        "**Reference** — the `ORD-…` reference, with the answer deadline underneath when a part is on request: amber **by {date}** while there is time, red **overdue {date}** once it has passed. An overdue row is tinted red across its width.",
        "**Trip** — the package name, or **Built to order**, and the number of parts.",
        "**Buyer** — the lead guest and, where there is one, the partner.",
        "**Travelling** and **Party** — the dates and the number of people.",
        "**Status** — the order's badge, with a clock and a count beside it when parts are still pending.",
        "**Margin** — shown only when the data carries it — and **Total**.",
      ],
    },
    {
      type: "links",
      items: [
        { label: "An order: confirming, declining and cancelling parts", articleId: "bk-order-detail" },
        { label: "Booking and order statuses", articleId: "bk-statuses-glossary" },
      ],
    },
  ],
} satisfies HelpArticle;
