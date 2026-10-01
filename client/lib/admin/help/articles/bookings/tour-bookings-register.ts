import type { HelpArticle } from "../../types";

/**
 * The tour bookings register at `/admin/tours/bookings`
 * (`(panel)/tours/bookings/page.tsx`, `TourBookingsBrowser.tsx`). Encodes
 * the three tiles, the search / status / Departing filters, the deadline
 * line under on-request rows, and the fixed page size of 25.
 */
export const article = {
  id: "bk-tour-bookings-register",
  title: "Tour bookings register",
  summary: "Every departure sold and the requests still waiting for an answer — the tiles, the filters and what each row shows.",
  category: "bookings",
  roles: ["ADMIN"],
  routes: ["/admin/tours/bookings"],
  keywords: ["TUR", "tour", "departure", "traveller", "request", "awaiting", "departing", "seats", "on request"],
  related: ["bk-tour-booking-detail", "bk-statuses-glossary", "tr-departures", "rf-search-filters"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Tour bookings"] },
    {
      type: "paragraph",
      text: "The register lists every tour booking (`TUR-…`). Its point is the on-request queue: bookings whose seats are already claimed while the operator has yet to confirm. Nothing is changed here — open a reference to answer a request or cancel a confirmed departure.",
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
        ["Awaiting your answer", "Bookings in `PENDING` — **Seats claimed, operator yet to confirm**."],
        ["Confirmed", "Bookings in `CONFIRMED`."],
        ["All tour bookings", "Every booking, in every status."],
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
        "Type in the search box to match a reference, a traveller name or an email address.",
        "Choose a status from the select: **All statuses**, or one of Pending, Confirmed, Cancelled, Completed and No show.",
        "Set the **Departing** date range to keep only bookings whose departure falls between the two dates.",
        "Page with **Previous** and **Next**. The page size is fixed at 25.",
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
        "**Reference** — the `TUR-…` reference, linked to the booking. On an on-request row the answer deadline appears beneath it.",
        "**Traveller** — the lead traveller.",
        "**Tour** and **Departure** — the tour booked and the departure date.",
        "**Status** — the booking's badge.",
        "**Total** — the amount charged.",
      ],
    },
    {
      type: "links",
      items: [
        { label: "A tour booking: confirm, decline, cancel", articleId: "bk-tour-booking-detail" },
        { label: "Booking and order statuses", articleId: "bk-statuses-glossary" },
      ],
    },
  ],
} satisfies HelpArticle;
