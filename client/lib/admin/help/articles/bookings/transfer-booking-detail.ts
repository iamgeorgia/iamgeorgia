import type { HelpArticle } from "../../types";

/**
 * One transfer booking at `/admin/transfers/bookings/[reference]`
 * (`(panel)/transfers/bookings/[reference]/page.tsx`). Encodes the Dispatch
 * panel — one row per leg with the board's own `LegActions` — the sold-as
 * snapshot rendered in the route's time zone, the absence of a
 * whole-booking cancel control, and the TransferBookingStatus values with
 * the moves the machine allows.
 */
export const article = {
  id: "bk-transfer-booking-detail",
  title: "A transfer booking and its legs",
  summary: "One journey as sold, with a dispatch row for each leg — the same controls as the board — and what the booking's own status can do.",
  category: "bookings",
  routes: ["/admin/transfers/bookings/[reference]"],
  keywords: ["TRF", "leg", "outbound", "return", "assign", "driver", "snapshot", "vehicle", "route", "time zone"],
  related: ["dp-dispatch-board", "dp-assigning-a-driver", "dp-leg-statuses", "bk-transfer-bookings-register", "bk-statuses-glossary"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Transfer bookings", "[reference]"] },
    {
      type: "paragraph",
      text: "A transfer booking page shows one journey as it was sold, and the operational state of each of its legs. A one-way booking has a single outbound leg; a booking with a return has two. The legs are what get a driver and a car, and what move through the day — the booking is the commercial wrapper around them.",
    },
    {
      type: "heading",
      id: "dispatch-panel",
      text: "The Dispatch panel",
    },
    {
      type: "paragraph",
      text: "One row per leg: **Outbound** or **Return** with its local pick-up time, the leg's status badge, the driver and car assigned, and the leg's actions. The rows come from the dispatch board itself, so the actions are exactly the board's — **Assign** or **Reassign**, **Mark as…**, **Unassign** and **Cancel leg** — and behave as described in the dispatch board article. When nothing is left to dispatch the panel reads **No legs to dispatch.**",
    },
    {
      type: "heading",
      id: "as-sold",
      text: "The booking as sold",
    },
    {
      type: "list",
      items: [
        "**Route** — from and to, with times shown in the route's own time zone.",
        "**Vehicle** — the class booked, as it was named at the time.",
        "**Money** — the total, and for staff the net figure and margin.",
      ],
    },
    {
      type: "paragraph",
      text: "These are snapshots frozen at booking. A later change to the route or the vehicle class in the catalogue does not alter what is shown here.",
    },
    {
      type: "callout",
      tone: "info",
      title: "No whole-booking cancel here",
      text: "The page has no control that cancels the booking as a whole. Legs are cancelled one at a time with **Cancel leg** in the Dispatch panel; the booking stays until every leg is done.",
    },
    {
      type: "heading",
      id: "statuses",
      text: "Booking statuses",
    },
    {
      type: "table",
      columns: ["Status", "Meaning", "Where it can go"],
      rows: [
        ["`PENDING`", "Sold but not yet confirmed.", "→ `CONFIRMED` or → `CANCELLED`."],
        ["`CONFIRMED`", "The journey is on. Legs can be assigned only from here.", "→ `CANCELLED`, → `COMPLETED` or → `NO_SHOW`."],
        ["`CANCELLED`", "The journey will not run.", "Terminal."],
        ["`COMPLETED`", "Every leg was driven.", "Terminal."],
        ["`NO_SHOW`", "The passenger never appeared.", "Terminal."],
      ],
    },
    {
      type: "paragraph",
      text: "The panel offers no button for these moves; the booking's status follows from what happens to its legs. Leg statuses are described in their own article.",
    },
    {
      type: "links",
      items: [
        { label: "The dispatch board", articleId: "dp-dispatch-board" },
        { label: "Assigning or reassigning a driver", articleId: "dp-assigning-a-driver" },
        { label: "Leg statuses and where they can go", articleId: "dp-leg-statuses" },
      ],
    },
  ],
} satisfies HelpArticle;
