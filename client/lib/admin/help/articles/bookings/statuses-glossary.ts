import type { HelpArticle } from "../../types";

/**
 * The booking and order status glossary. Tables for HotelBookingStatus (with
 * the five operator hints from `lib/admin/bookings.ts` verbatim), OrderStatus
 * (hints from `lib/admin/orders.ts`), OrderItemStatus, TourBookingStatus and
 * TransferBookingStatus, each with the transitions the admin panel can
 * actually make. COMPLETED and NO_SHOW are never set from the panel for any
 * booking kind.
 */
export const article = {
  id: "bk-statuses-glossary",
  title: "Booking and order statuses",
  summary: "Every status a hotel booking, order, order part, tour booking or transfer booking can carry, what it means, and which moves the panel can make.",
  category: "bookings",
  roles: ["ADMIN", "DISPATCHER"],
  keywords: ["status", "PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW", "PENDING_CONFIRMATION", "PARTIALLY_CANCELLED", "REQUESTED", "DECLINED", "glossary"],
  related: ["dp-leg-statuses", "bk-transfer-booking-detail", "rf-glossary"],
  blocks: [
    {
      type: "paragraph",
      text: "Each kind of booking has its own small set of statuses. The tables below give each value, what it means, and which moves an operator can make from the panel. A move not listed is not available — the panel only ever offers what the server allows.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Completed and no-show are never set by hand",
      text: "For every booking kind, `COMPLETED` and `NO_SHOW` are reached by the passing of the dates or by the system, never from a button in the panel. Only cancellations, confirmations and declines are yours to make.",
    },
    {
      type: "heading",
      id: "hotel",
      text: "Hotel bookings",
    },
    {
      type: "table",
      columns: ["Status", "Hint shown on the booking", "From the panel"],
      rows: [
        ["`PENDING`", "Held but not yet confirmed.", "→ `CANCELLED` with **Cancel booking**."],
        ["`CONFIRMED`", "Rooms are committed and the guest has been told.", "→ `CANCELLED` with **Cancel booking**."],
        ["`CANCELLED`", "Rooms released. Any charge follows the terms agreed at booking.", "Terminal."],
        ["`COMPLETED`", "The stay has finished.", "Terminal."],
        ["`NO_SHOW`", "The guest never arrived.", "Terminal."],
      ],
    },
    {
      type: "paragraph",
      text: "A hotel booking's requirements carry their own status — `REQUESTED`, `CONFIRMED`, `DECLINED`, `WITHDRAWN` — and answering one never changes the booking's status.",
    },
    {
      type: "heading",
      id: "orders",
      text: "Orders",
    },
    {
      type: "table",
      columns: ["Status", "Hint shown on the register", "From the panel"],
      rows: [
        ["`PENDING_CONFIRMATION`", "A part is on request. Its capacity is held and nobody else can sell it.", "→ `CANCELLED` with **Cancel order**, or by declining a required part."],
        ["`CONFIRMED`", "Every part is committed and the buyer has been told.", "→ `CANCELLED` with **Cancel order**."],
        ["`PARTIALLY_CANCELLED`", "A part was dropped. The rest of the trip still runs.", "→ `CANCELLED` with **Cancel order**."],
        ["`CANCELLED`", "Nothing survives. Any charge follows the terms frozen at booking.", "Terminal."],
        ["`COMPLETED`", "The trip has finished.", "Terminal."],
      ],
    },
    {
      type: "heading",
      id: "order-parts",
      text: "Order parts",
    },
    {
      type: "table",
      columns: ["Status", "Meaning", "From the panel"],
      rows: [
        ["`REQUESTED`", "On request; the supplier has yet to answer.", "→ `CONFIRMED` with **Confirm**; → `DECLINED` with **Decline**."],
        ["`CONFIRMED`", "Committed.", "→ `CANCELLED` with **Cancel this part**, or by cancelling the order."],
        ["`DECLINED`", "The supplier could not run it. A required part declined cancels the whole order.", "Terminal."],
        ["`CANCELLED`", "Dropped after confirmation.", "Terminal."],
        ["`COMPLETED`", "The part ran.", "Terminal."],
        ["`NO_SHOW`", "The guest never arrived for it.", "Terminal."],
      ],
    },
    {
      type: "heading",
      id: "tours",
      text: "Tour bookings",
    },
    {
      type: "table",
      columns: ["Status", "Meaning", "From the panel"],
      rows: [
        ["`PENDING`", "A request; seats claimed, operator yet to confirm.", "→ `CONFIRMED` with **Confirm request**; → `CANCELLED` with **Decline request**."],
        ["`CONFIRMED`", "Seats committed and the voucher sent.", "→ `CANCELLED` with **Cancel booking**."],
        ["`CANCELLED`", "Seats released.", "Terminal."],
        ["`COMPLETED`", "The departure has run.", "Terminal."],
        ["`NO_SHOW`", "The traveller never arrived.", "Terminal."],
      ],
    },
    {
      type: "heading",
      id: "transfers",
      text: "Transfer bookings",
    },
    {
      type: "table",
      columns: ["Status", "Meaning", "Where it can go"],
      rows: [
        ["`PENDING`", "Sold but not yet confirmed.", "→ `CONFIRMED`, → `CANCELLED`."],
        ["`CONFIRMED`", "The journey is on; legs can be assigned.", "→ `CANCELLED`, → `COMPLETED`, → `NO_SHOW`."],
        ["`CANCELLED`", "The journey will not run.", "Terminal."],
        ["`COMPLETED`", "Every leg was driven.", "Terminal."],
        ["`NO_SHOW`", "The passenger never appeared.", "Terminal."],
      ],
    },
    {
      type: "paragraph",
      text: "A transfer booking has no status button of its own in the panel. Its legs are what you work — assign, mark as, unassign, cancel — and each leg has its own ten statuses, described in the leg statuses article.",
    },
    {
      type: "links",
      items: [
        { label: "Leg statuses and where they can go", articleId: "dp-leg-statuses" },
      ],
    },
  ],
} satisfies HelpArticle;
