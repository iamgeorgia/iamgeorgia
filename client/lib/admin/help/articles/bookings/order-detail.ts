import type { HelpArticle } from "../../types";

/**
 * One order at `/admin/orders/[reference]` (`(panel)/orders/[reference]/page.tsx`,
 * `OrderActions.tsx`, `OrderParts.tsx`). Encodes the four actions and their
 * guards: Confirm a part with no dialog; Decline a part through a modal whose
 * required reason the buyer and agency see word for word, and which cancels
 * the whole order when the part is required; Cancel a confirmed part via the
 * "Cancel this part" text link with charge, refund and forfeited discount;
 * and the two-step, irreversible Cancel order that emails the buyer. Also the
 * OrderStatus and OrderItemStatus values and the transitions the panel can make.
 */
export const article = {
  id: "bk-order-detail",
  title: "An order: confirming, declining and cancelling parts",
  summary: "Working the parts of one order — confirm or decline what is on request, cancel a confirmed part, or end the whole trip — and what each of those sends.",
  category: "bookings",
  routes: ["/admin/orders/[reference]"],
  keywords: ["ORD", "part", "item", "required part", "optional part", "decline", "confirm", "cancel this part", "clawback", "discount forfeited", "refund", "on request"],
  related: ["bk-orders-register", "bk-statuses-glossary", "rf-dangerous-actions", "pk-parts", "dp-who-is-told-what"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Orders", "[reference]"] },
    {
      type: "paragraph",
      text: "An order page is where the parts of one trip are worked. Each part is its own booking with its own reference and its own terms; the order ties them together. You can confirm or decline a part still on request, cancel a part already confirmed, or end the whole order.",
    },
    {
      type: "heading",
      id: "what-is-shown",
      text: "What is shown",
    },
    {
      type: "definitions",
      items: [
        { term: "Trip", description: "The package (linked), whether it was **From a package** or **Built to order**, the dates, the party, **N booked · M still live**, and **Answers due** when a deadline is running." },
        { term: "Parts", description: "One row per part with its status and the controls below." },
        { term: "Price", description: "Part, status, cost (staff only) and price per row; then any package discount or supplement, the total, cost, margin and any cancellation charge." },
        { term: "Buyer", description: "Lead guest, email, phone, requests, source and the partner where there is one." },
        { term: "Actions and Timeline", description: "The order-level controls, and the booked, confirmed, cancelled and completed dates with **Cancelled because** when a reason was recorded." },
      ],
    },
    {
      type: "paragraph",
      text: "While parts are pending, a warning line reads **N parts are waiting on a supplier — answer due by {date}**, or **answer was due {date}** once overdue. Their rooms and seats are already claimed; answer each one on its row.",
    },
    {
      type: "heading",
      id: "confirm-part",
      text: "Confirming a part",
    },
    {
      type: "steps",
      items: [
        "Find the row whose status is `REQUESTED`.",
        "Press the green **Confirm**. The part moves to `CONFIRMED` at once.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Confirm has no dialog",
      text: "The part is committed the moment you press **Confirm**. There is no second step, unlike **Decline**, so be sure of the row before you click.",
    },
    {
      type: "heading",
      id: "decline-part",
      text: "Declining a part",
    },
    {
      type: "steps",
      items: [
        "Press **Decline** on a `REQUESTED` row. A modal titled **Decline {part}** opens.",
        "Read the sentence above the reason box. It says which of two outcomes applies to this part — see the warning below.",
        "Type **Why it cannot run** — required, up to 500 characters. The buyer and the agency see it word for word.",
        "Press **Decline this part** for an optional part, or **Decline and cancel the order** for a required one.",
      ],
    },
    {
      type: "callout",
      tone: "danger",
      title: "Irreversible — and a required part takes the whole order with it",
      text: "Declining a required part cancels the entire order at no charge, because the failure is the supplier's, and releases every other part with it. Declining an optional part only drops that part, and the order's total shrinks to what survives. The button looks the same in both cases; only the modal's wording tells them apart.",
    },
    {
      type: "heading",
      id: "cancel-part",
      text: "Cancelling a confirmed part",
    },
    {
      type: "steps",
      items: [
        "Under a `CONFIRMED` row, press the small text link **Cancel this part**. A modal titled **Cancel {part}** opens.",
        "Read the quote: **Cancellation charge**, **Refund to the buyer** and, when it applies, **Discount forfeited** — the share of the package discount this part earned. If nothing is priced for cancellation the modal says so and cancelling charges nothing.",
        "Optionally type a **Reason** (up to 500 characters) and confirm.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Staff can drop a required part; a partner cannot",
      text: "For a required part the modal warns that a partner cannot drop it on its own, but you can. The rest of the trip stays sold, and its share of the package discount is forfeited — the **Discount forfeited** line is easy to miss.",
    },
    {
      type: "heading",
      id: "cancel-order",
      text: "Cancelling the whole order",
    },
    {
      type: "paragraph",
      text: "The Actions panel offers **Cancel order** while the order is `PENDING_CONFIRMATION`, `CONFIRMED` or `PARTIALLY_CANCELLED`. Above it sits the server's quote — **Cancelling now costs** and **Refund to the buyer** — or a line saying nothing here is priced for cancellation.",
    },
    {
      type: "steps",
      items: [
        "Press **Cancel order**. A block opens in place reading that this ends the whole trip, every part still live is released, and the charge above stands.",
        "Optionally type a **Reason** (up to 500 characters).",
        "Press **Cancel order** again to confirm, or **Keep**. The result reads **Cancelled. Every part still live has been released.**",
      ],
    },
    {
      type: "callout",
      tone: "danger",
      title: "Irreversible",
      text: "Ending an order cannot be undone. Every live part is released and the buyer is emailed.",
    },
    {
      type: "paragraph",
      text: "Once an order is `CANCELLED` or `COMPLETED` the Actions panel reads **Nothing further can be done to this order.**",
    },
    {
      type: "heading",
      id: "statuses",
      text: "Statuses and the moves the panel can make",
    },
    {
      type: "table",
      columns: ["Order status", "Meaning", "Reachable from the panel"],
      rows: [
        ["`PENDING_CONFIRMATION`", "A part is on request; its capacity is held.", "→ `CANCELLED` by cancelling the order, or by declining a required part."],
        ["`CONFIRMED`", "Every part is committed and the buyer has been told.", "→ `CANCELLED` by cancelling the order."],
        ["`PARTIALLY_CANCELLED`", "A part was dropped; the rest still runs.", "→ `CANCELLED` by cancelling the order."],
        ["`CANCELLED`", "Nothing survives.", "Terminal."],
        ["`COMPLETED`", "The trip has finished.", "Terminal; never set from the panel."],
      ],
    },
    {
      type: "table",
      columns: ["Part status", "Meaning", "Reachable from the panel"],
      rows: [
        ["`REQUESTED`", "On request with the supplier.", "→ `CONFIRMED` with **Confirm**; → `DECLINED` with **Decline**."],
        ["`CONFIRMED`", "Committed.", "→ `CANCELLED` with **Cancel this part** or by cancelling the order."],
        ["`DECLINED`", "The supplier could not run it.", "Terminal."],
        ["`CANCELLED`", "Dropped after confirmation.", "Terminal."],
        ["`COMPLETED`, `NO_SHOW`", "The part ran, or the guest never arrived.", "Never set from the panel."],
      ],
    },
    {
      type: "links",
      items: [
        { label: "Orders register", articleId: "bk-orders-register" },
        { label: "Booking and order statuses", articleId: "bk-statuses-glossary" },
        { label: "Who is told what", articleId: "dp-who-is-told-what" },
      ],
    },
  ],
} satisfies HelpArticle;
