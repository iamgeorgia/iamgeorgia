import type { HelpArticle } from "../../types";

/**
 * The transfer bookings register at `/admin/transfers/bookings`
 * (`(panel)/transfers/bookings/page.tsx`). Encodes the soonest-first order,
 * the three tiles with the per-currency Confirmed value, the absence of
 * search, filters and Previous/Next buttons (page 2 only via `?page=2`),
 * and that the Pick-up column shows UTC rather than the pick-up point's
 * local clock.
 */
export const article = {
  id: "bk-transfer-bookings-register",
  title: "Transfer bookings register",
  summary: "Every journey sold, soonest pick-up first — what the tiles count, how to reach the next page, and why the pick-up times here are not local.",
  category: "bookings",
  roles: ["ADMIN", "DISPATCHER"],
  routes: ["/admin/transfers/bookings"],
  keywords: ["TRF", "transfer", "journey", "passenger", "pick-up", "UTC", "page", "confirmed value", "currency"],
  related: ["bk-transfer-booking-detail", "dp-dispatch-board", "bk-statuses-glossary", "rf-troubleshooting"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Transfer bookings"] },
    {
      type: "paragraph",
      text: "The register lists every transfer booking (`TRF-…`), ordered by pick-up time so the journeys going out next sit at the top. It is a reading screen: to put a driver on a journey or move it along, use the dispatch board or open the booking.",
    },
    {
      type: "heading",
      id: "tiles",
      text: "The three tiles",
    },
    {
      type: "table",
      columns: ["Tile", "What it shows"],
      rows: [
        ["Bookings", "Every transfer booking."],
        ["Confirmed", "Bookings in `CONFIRMED`."],
        ["Confirmed value", "The total of confirmed bookings, in one currency. When bookings were sold in more than one, the largest is shown and the hint says how many others are not — lari and dollars are never added together."],
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
        "**Reference** — the `TRF-…` reference, linked to the booking.",
        "**Passenger** — the lead passenger and their email.",
        "**Journey** — from and to, the vehicle booked, and **· return** when a return leg was sold.",
        "**Pick-up** — the outbound pick-up date and time.",
        "**Status** and **Total**.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Pick-up times here are UTC",
      text: "The **Pick-up** column shows the time in UTC, not the clock at the pick-up point. For the local time use the dispatch board or the booking page, which both use the route's own time zone.",
    },
    {
      type: "heading",
      id: "paging",
      text: "Finding a booking and reaching the next page",
    },
    {
      type: "paragraph",
      text: "Unlike the other registers, this one has no search box and no filters. When there is more than one page a line reads **Page X of Y · N bookings**, but there are no **Previous** and **Next** buttons.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Page 2 is reached from the address bar",
      text: "Add `?page=2` to the end of the address — `/admin/transfers/bookings?page=2` — and press Enter. To find one booking quickly, search its reference or passenger on the dispatch board instead; each leg there links back to its booking.",
    },
    {
      type: "links",
      items: [
        { label: "A transfer booking and its legs", articleId: "bk-transfer-booking-detail" },
        { label: "The dispatch board", articleId: "dp-dispatch-board" },
      ],
    },
  ],
} satisfies HelpArticle;
