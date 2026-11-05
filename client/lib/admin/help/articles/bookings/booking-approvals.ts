import type { HelpArticle } from "../../types";

/**
 * The approval queue at `/admin/bookings/approvals` (`(panel)/bookings/
 * approvals/page.tsx`, `BookingApprovalsBrowser.tsx`, `lib/admin/
 * bookingApprovals.ts`). Encodes owner decision OD1 — every booking waits for
 * an operator's yes — the product chips, the Overdue toggle, the two
 * decisions and what each one sets in motion, and the three refusals.
 */
export const article = {
  id: "bk-booking-approvals",
  title: "Booking approvals",
  summary: "Every new booking waits for a yes from the platform before it is confirmed. This is the queue, and what approving or rejecting sets in motion.",
  category: "bookings",
  routes: ["/admin/bookings/approvals"],
  keywords: ["approve", "reject", "approval", "PENDING_APPROVAL", "AWAITING_APPROVAL", "queue", "deadline", "overdue", "credit limit", "yes"],
  related: ["bk-statuses-glossary", "bk-hotel-booking-detail", "bk-order-detail", "bk-orders-register"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Booking approvals"] },
    {
      type: "paragraph",
      text: "A booking made on the site or by a partner is not confirmed the moment it is made. It is held — rooms, seats, a car — in `PENDING_APPROVAL`, and it waits here until somebody says yes. Nothing is owed and no supplier has been told. This one queue covers all four registers and the orders, so the oldest deadline is always at the top whatever product it belongs to.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Who sees this screen",
      text: "Only a role holding **Bookings: approve** is offered the queue, and the same capability is checked again by the server on each decision. A partner can be set to **confirm at once** on its payment terms, in which case its bookings never appear here.",
    },
    {
      type: "heading",
      id: "filters",
      text: "Reading the queue",
    },
    {
      type: "steps",
      items: [
        "Type in the search box to match a reference, a buyer name or an email address.",
        "Pick a product chip — **Hotels**, **Transfers**, **Tours**, **Services** or **Orders** — to see one register, or **All** for everything.",
        "Switch on **Overdue only** to keep the rows whose answer deadline has passed. An overdue row is tinted red across its width and its deadline is printed in red.",
        "Page with **Previous** and **Next**; the page size is fixed at 25.",
      ],
    },
    {
      type: "list",
      items: [
        "**Reference** — the booking's own reference, linked to its detail page, with a small product label beside it. A service booking has no detail page yet, so its reference is shown as text.",
        "**Booking** — the property, route, tour, service or package, and the dates.",
        "**Buyer** — the lead guest and, where there is one, the partner.",
        "**Requested** — how long ago the booking was made.",
        "**Deadline** — when the platform's answer is due. Reminders go out before it; once it passes the row is overdue.",
      ],
    },
    {
      type: "heading",
      id: "approve",
      text: "Approving",
    },
    {
      type: "paragraph",
      text: "**Approve** opens a confirmation. Saying yes confirms the booking, tells the supplier — or, for an on-request product, sends the supplier the request — and raises the invoice to the buyer. An order is approved as a whole: its parts cannot be approved one at a time, and a part opened on its own register says so.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "The credit limit is checked here",
      text: "For a partner on credit, approving is the moment its exposure grows. If the booking would take the partner past its limit the server refuses with **This would take … past its credit limit**, and the booking stays in the queue until Finance raises the limit or the partner pays something down.",
    },
    {
      type: "heading",
      id: "reject",
      text: "Rejecting",
    },
    {
      type: "paragraph",
      text: "**Reject** asks for a reason, which is required: the buyer and the agency read it word for word. Whatever was held is released at no charge, the booking moves to `CANCELLED`, and nothing is invoiced.",
    },
    {
      type: "heading",
      id: "refusals",
      text: "When a decision is refused",
    },
    {
      type: "table",
      columns: ["Message", "What happened"],
      rows: [
        ["Somebody has already answered this one", "Another operator approved or rejected it first, or the buyer withdrew. The page refreshes to show which."],
        ["The booking changed while you were deciding", "Its status moved under you — a cancellation, usually. Read the row again before deciding."],
        ["This booking is part of an order", "Open the order and decide there; its parts go together."],
        ["This would take … past its credit limit", "Approving would exceed the partner's credit. See Finance → Receivables and the partner's terms."],
      ],
    },
    {
      type: "heading",
      id: "elsewhere",
      text: "The same decision on a detail page",
    },
    {
      type: "paragraph",
      text: "Every booking and order detail page carries an **Approval** panel with the same two buttons while the booking is waiting, and afterwards records who decided, when, and why. Beside it a **Payment** panel says whether the bill the approval raised has been paid.",
    },
    {
      type: "links",
      items: [
        { label: "Booking and order statuses", articleId: "bk-statuses-glossary" },
        { label: "An order: confirming, declining and cancelling parts", articleId: "bk-order-detail" },
      ],
    },
  ],
} satisfies HelpArticle;
