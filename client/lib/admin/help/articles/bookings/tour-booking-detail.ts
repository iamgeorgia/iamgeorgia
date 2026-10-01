import type { HelpArticle } from "../../types";

/**
 * One tour booking at `/admin/tours/bookings/[reference]`
 * (`(panel)/tours/bookings/[reference]/page.tsx`, `TourBookingActions.tsx`).
 * Encodes the three status-gated actions: Confirm request (one click, no
 * dialog, sends the voucher), Decline request (required reason the agency
 * sees verbatim, seats released, emails), and Cancel booking on a CONFIRMED
 * booking (quote, optional reason, emails traveller and operator). A PENDING
 * booking can only be confirmed or declined. Plus the departure and
 * travellers panels and the TourBookingStatus values.
 */
export const article = {
  id: "bk-tour-booking-detail",
  title: "A tour booking: confirm, decline, cancel",
  summary: "Answering a request — confirm or decline — and cancelling a confirmed departure, with what each sends and what cannot be undone.",
  category: "bookings",
  roles: ["ADMIN"],
  routes: ["/admin/tours/bookings/[reference]"],
  keywords: ["TUR", "confirm request", "decline request", "voucher", "seats released", "travellers", "passport", "dietary", "meeting point", "cancel"],
  related: ["bk-tour-bookings-register", "bk-statuses-glossary", "rf-dangerous-actions", "tr-departures", "dp-who-is-told-what"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Tour bookings", "[reference]"] },
    {
      type: "paragraph",
      text: "A tour booking page is for two jobs: answering a request while it is `PENDING`, and cancelling a departure once it is `CONFIRMED`. The Actions panel offers only what the current status allows; a pending booking can be confirmed or declined and nothing else.",
    },
    {
      type: "heading",
      id: "what-is-shown",
      text: "What is shown",
    },
    {
      type: "definitions",
      items: [
        {
          term: "Departure",
          description: "The tour (linked), the option, the departure date and start time with its time zone, the party, the units claimed — **N seats** or **group** — the meeting point, the confirmation mode, **Answer due** while a request is open, and **Declined because** once one has been refused.",
        },
        {
          term: "Travellers",
          description: "One row per traveller: name (the lead is marked), type — Adult, Child or Infant with age — passport number and nationality, dietary needs, and price.",
        },
        { term: "Money and record", description: "Total and, for staff, the net figure and margin; then the placed, confirmed and cancelled dates and the source." },
      ],
    },
    {
      type: "paragraph",
      text: "While the booking is pending the Actions panel reads **Answer due by {date}. The seats are already claimed.**",
    },
    {
      type: "heading",
      id: "confirm",
      text: "Confirming a request",
    },
    {
      type: "steps",
      items: [
        "Check the departure and the travellers.",
        "Press **Confirm request**. The booking moves to `CONFIRMED` and the result reads **Confirmed. The voucher is on its way.**",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "One click, and the voucher is sent",
      text: "**Confirm request** has no dialog. The moment you press it the seats are committed and the traveller is emailed their voucher.",
    },
    {
      type: "heading",
      id: "decline",
      text: "Declining a request",
    },
    {
      type: "steps",
      items: [
        "Press **Decline request**. A block opens in place with a box titled **Why it cannot run**.",
        "Type the reason — required, up to 500 characters. The agency sees it word for word.",
        "Press **Decline**, or **Keep** to step back. The result reads **Declined. The seats are released and nothing is charged.**",
      ],
    },
    {
      type: "callout",
      tone: "danger",
      title: "Irreversible",
      text: "Declining releases the seats and emails the traveller and the agency with your reason quoted. It cannot be undone: the booking becomes `CANCELLED` and the Actions panel closes.",
    },
    {
      type: "heading",
      id: "cancel",
      text: "Cancelling a confirmed booking",
    },
    {
      type: "paragraph",
      text: "**Cancel booking** appears only once the booking is `CONFIRMED`; it is hidden while a request is pending. Above it sits the quote — **Cancelling now costs** and **Refund to traveller**.",
    },
    {
      type: "steps",
      items: [
        "Read the quote.",
        "Press **Cancel booking**. Optionally type a **Reason** (up to 500 characters).",
        "Press **Cancel booking** again to confirm, or **Keep**. The result reads **Cancelled. The seats are released.**",
      ],
    },
    {
      type: "callout",
      tone: "danger",
      title: "Irreversible",
      text: "Cancelling releases the seats, emails the traveller and the tour operator, and cannot be undone. Any charge follows the terms frozen at booking.",
    },
    {
      type: "paragraph",
      text: "Once the booking is `CANCELLED`, `COMPLETED` or `NO_SHOW` the panel reads **Nothing further can be done to this booking.**",
    },
    {
      type: "heading",
      id: "statuses",
      text: "Statuses",
    },
    {
      type: "table",
      columns: ["Status", "Meaning", "Reachable from the panel"],
      rows: [
        ["`PENDING`", "A request; seats claimed, operator yet to confirm.", "→ `CONFIRMED` with **Confirm request**; → `CANCELLED` with **Decline request**."],
        ["`CONFIRMED`", "Seats committed and the voucher sent.", "→ `CANCELLED` with **Cancel booking**."],
        ["`CANCELLED`", "Seats released.", "Terminal."],
        ["`COMPLETED`", "The departure has run.", "Never set from the panel."],
        ["`NO_SHOW`", "The traveller never arrived.", "Never set from the panel."],
      ],
    },
    {
      type: "links",
      items: [
        { label: "Tour bookings register", articleId: "bk-tour-bookings-register" },
        { label: "Booking and order statuses", articleId: "bk-statuses-glossary" },
        { label: "Who is told what", articleId: "dp-who-is-told-what" },
      ],
    },
  ],
} satisfies HelpArticle;
