import type { HelpArticle } from "../../types";

/**
 * The filter kit every register shares
 * (`components/admin/filters/`, `lib/admin/bookingFilters.ts`): the quick
 * views, the shared filters, the active chips, and the sort.
 */
export const article = {
  id: "bk-finding-bookings",
  title: "Finding bookings",
  summary: "The register of every booking, the quick views, and the filters every register shares: payment, source, partner, manager, created date and sort.",
  category: "bookings",
  routes: ["/admin/bookings/all"],
  keywords: ["all bookings", "search", "filter", "preset", "quick view", "payment status", "overdue", "source", "manager", "sort", "created", "register"],
  related: ["bk-desk-create-booking", "bk-booking-approvals", "bk-statuses-glossary"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "All bookings"] },
    {
      type: "paragraph",
      text: "The product registers — hotel, transfer, tour, service, orders — are where a booking is *worked*. the search box and filters above each register are how one is *found*.",
    },
    {
      type: "heading",
      id: "quick-views",
      text: "Quick views",
    },
    {
      type: "paragraph",
      text: "The row of views above the filters is the handful an operator opens most. A view *replaces* the filters rather than adding to them, so **Overdue payments** means exactly that whatever was narrowed before. The same views appear on every register, reading the same keys, so a bookmark of one works on another.",
    },
    {
      type: "table",
      columns: ["View", "What it sets"],
      rows: [
        ["All bookings", "Nothing: everything on the register, newest first."],
        ["Pending approval", "Approval `PENDING` — held until somebody says yes."],
        ["Awaiting payment", "Payment `UNPAID` or `PARTIAL`, soonest due date first."],
        ["Confirmed", "Status `CONFIRMED`."],
        ["Upcoming arrivals", "Confirmed, service date from today, soonest first."],
        ["Overdue payments", "Payment `OVERDUE`, soonest due date first."],
        ["Recently created", "Created in the last seven days, newest first."],
      ],
    },
    {
      type: "heading",
      id: "filters",
      text: "The filters every register shares",
    },
    {
      type: "list",
      items: [
        "**Search** matches a reference, a name, an email, the property or tour, the partner and the customer. On the product registers it matches that register's own fields.",
        "**Dates** are the register's own column — Arriving on hotels, Pick-up on transfers, Departing on tours, Travelling on orders — with Today, 7 days and 30 days shortcuts looking forward.",
        "**Status** chips are the register's own states; several can be on at once. On All bookings the chips are the union of every product's states, and a row still wears its own product's badge.",
        "**Payment** reads the bill behind the booking (or behind its order): no bill yet, unpaid, partially paid, overdue, paid, waived, void.",
        "**Approval** keeps the rows still waiting for the platform's yes, or only the ones past their deadline.",
        "**Source** is where the booking came from: the website, a partner, the panel, or — for a booking taken at the desk — phone, email, an external agency or in person.",
        "**Partner** and **Manager** pick one company or one member of staff. On a phone the two sit behind the **Filters** button with a count of how many are on.",
        "**Created** is when the booking was made, with the same three shortcuts looking back.",
        "**Sort** is the register's own default until changed: newest first on most, soonest pick-up on transfers.",
      ],
    },
    {
      type: "paragraph",
      text: "Everything that is narrowing the list shows as a chip under the filters. Click a chip to drop that one filter, or **Clear filters** to drop them all. The filters live in the address bar, so a narrowed view can be bookmarked, shared with a colleague, and survives a reload.",
    },
    {
      type: "heading",
      id: "columns",
      text: "Reading the register of every booking",
    },
    {
      type: "list",
      items: [
        "**Type** — the product, as a small label.",
        "**Reference** — linked to the product's own page. A part of an order says which order under it; a booking still waiting for approval says so in amber, or in red once the deadline has passed.",
        "**Booking** — the property, route, tour, service or package, and the dates.",
        "**Buyer** — the lead name and email, and a link to the partner or the customer the booking was made for.",
        "**Status** and **Payment** — the product's own badge, and the bill's state with its due date while money is owed.",
        "**Total** — what the buyer pays, the desk's adjustment included.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Parts of an order",
      text: "An order's parts are folded under their order, so a trip with four parts is one row. Add `children=true` to the address to list the parts beside their order.",
    },
    {
      type: "links",
      items: [
        { label: "Creating a booking at the desk", articleId: "bk-desk-create-booking" },
        { label: "Booking and order statuses", articleId: "bk-statuses-glossary" },
        { label: "Open the register", href: "/admin/bookings/all" },
      ],
    },
  ],
} satisfies HelpArticle;
