import type { HelpArticle } from "../../types";

/**
 * One hotel booking at `/admin/bookings/[id]` (`(panel)/bookings/[id]/page.tsx`,
 * `BookingActions.tsx`, `BookingRequests.tsx`, `lib/admin/cancellation.ts`).
 * Encodes the two things an operator can do — cancel, and answer a
 * requirement — and the facts around them: the live quote read off the
 * frozen schedule, the inline two-step confirm, the internal-only reason,
 * the emails to guest and property, the Confirm-with-no-dialog asymmetry,
 * the required decline reason the agency sees, and that the cancellation
 * terms panel shows the first room's windows only.
 */
export const article = {
  id: "bk-hotel-booking-detail",
  title: "A hotel booking: cancelling and answering requirements",
  summary: "What one booking shows, how to cancel it and what that sends, and how to confirm or decline a requirement the guest asked for.",
  category: "bookings",
  roles: ["ADMIN"],
  routes: ["/admin/bookings/[id]"],
  keywords: ["cancel", "refund", "cancellation terms", "requirement", "kosher", "shabbat", "decline", "confirm", "supplier cost", "margin", "rooms released"],
  related: ["bk-hotel-bookings-register", "bk-statuses-glossary", "rf-dangerous-actions", "dp-who-is-told-what"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Hotel bookings", "[reference]"] },
    {
      type: "paragraph",
      text: "A booking page is the reservation as it was sold — a snapshot frozen at confirmation — plus the two things an operator may do to it: cancel it, or answer a requirement the guest asked the property for. There is deliberately no **Confirm** and no **Mark completed** button: a booking is confirmed the moment it is made, and completion follows from the dates.",
    },
    {
      type: "heading",
      id: "what-is-shown",
      text: "What is shown",
    },
    {
      type: "definitions",
      items: [
        { term: "Stay", description: "Check in, check out, nights, rooms, the property's own in-from and out-by times, and the time zone." },
        {
          term: "Room panels",
          description: "One per booked room: board, beds, guests, **Free cancellation until** or **Non-refundable**, and the nightly breakdown. Staff also see a Cost column beside the Price.",
        },
        {
          term: "Cancellation terms",
          description: "The windows frozen at confirmation — From, Until, Charge — with **Booking made** and **After check-in** as the open ends. A later change to the hotel's policy does not apply to this booking.",
        },
        { term: "Guest", description: "Name, email, phone and any notes." },
        { term: "Requirements", description: "The structured requests the guest made, one row each. The panel is absent when the booking has none." },
        {
          term: "Money",
          description: "Total, tax included and payable at property where they apply, and — for staff — **Supplier cost** and **Margin**. A cancellation charge appears once one has been set.",
        },
        { term: "Property as booked", description: "The hotel, address, phone and stars as they stood at booking. The hotel name links to the property." },
        { term: "Record", description: "Placed, confirmed and cancelled dates, the source, and who booked — a partner or **Direct guest**." },
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Cancellation terms show the first room only",
      text: "The terms panel lists the windows of room 1. On a booking with several rooms under different policies, check each room panel's **Free cancellation until** before quoting a refund.",
    },
    {
      type: "heading",
      id: "cancel",
      text: "Cancelling the booking",
    },
    {
      type: "paragraph",
      text: "The Actions panel offers **Cancel booking** only while the booking is `PENDING` or `CONFIRMED`. Above the button sits a live quote read off the frozen schedule: **Cancelling now costs** and **Refund to guest**. It needs no round trip — the terms travel with the booking.",
    },
    {
      type: "steps",
      items: [
        "Read the quote. The charge is capped at each room's own subtotal.",
        "Press **Cancel booking**. A red-bordered block opens in place, reading that this releases the rooms back on sale and cannot be undone.",
        "Optionally type a **Reason (optional, kept internally)**. The guest never sees it.",
        "Press **Confirm cancellation**, or **Keep it** to step back.",
        "The result reads **Cancelled. … is chargeable under the terms agreed at booking.** or **Cancelled in full. Nothing is chargeable.**",
      ],
    },
    {
      type: "callout",
      tone: "danger",
      title: "Irreversible",
      text: "Cancelling releases the rooms at once, emails the guest and the property, and cannot be undone anywhere in the panel. The confirm step is an inline block rather than a dialog, so take care on a small screen.",
    },
    {
      type: "callout",
      tone: "info",
      text: "The reason box is optional and internal. Nothing you write in it reaches the guest or the property — the emails carry only the fact of the cancellation and the charge.",
    },
    {
      type: "heading",
      id: "requirements",
      text: "Answering a requirement",
    },
    {
      type: "paragraph",
      text: "Each requirement — a kosher kitchen, a Shabbat lift, a mikveh nearby and the like — is a row with its own status: **Awaiting the property** (`REQUESTED`), **Confirmed**, **Not available** (`DECLINED`) or **Withdrawn**. Buttons appear only while a row is still awaiting an answer. Answering never changes the booking's own status.",
    },
    {
      type: "steps",
      items: [
        "To confirm, press **Confirm** on the row. It applies at once.",
        "To decline, press **Decline**; a box titled **Why it cannot be done** opens. Type the reason — up to 500 characters — and submit. The button stays disabled until something is written.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Confirm is one click",
      text: "**Confirm** has no dialog: the requirement is marked confirmed the moment you press it. **Decline** asks for a reason because the agency sees it on the booking — a refusal with no reason is one they cannot pass on.",
    },
    {
      type: "callout",
      tone: "info",
      text: "An answered requirement offers no further buttons, so it cannot be re-answered from the panel. Check the row before pressing.",
    },
    {
      type: "links",
      items: [
        { label: "Hotel bookings register", articleId: "bk-hotel-bookings-register" },
        { label: "Booking and order statuses", articleId: "bk-statuses-glossary" },
        { label: "Who is told what", articleId: "dp-who-is-told-what" },
      ],
    },
  ],
} satisfies HelpArticle;
