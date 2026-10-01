import type { HelpArticle } from "../../types";

/**
 * The hotel bookings register at `/admin/bookings` (`(panel)/bookings/page.tsx`,
 * `BookingsBrowser.tsx`, `lib/admin/bookings.ts`). Encodes the four tiles —
 * including that "Value on this page" sums only the rows on screen — the
 * three URL-backed filters, the fixed page size of 25, the clock beside a
 * status with pending requirements, and that a bookmarked filter value the
 * register does not recognise is dropped without a word.
 */
export const article = {
  id: "bk-hotel-bookings-register",
  title: "Hotel bookings register",
  summary: "Every hotel reservation on the platform, newest first — the tiles, the filters, and what the register can and cannot tell you.",
  category: "bookings",
  roles: ["ADMIN"],
  routes: ["/admin/bookings"],
  keywords: ["hotel", "reservation", "stay", "BKG", "guest", "search", "filter", "arriving", "pending", "value on this page"],
  related: ["bk-hotel-booking-detail", "bk-statuses-glossary", "rf-search-filters", "gs-overview"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Hotel bookings"] },
    {
      type: "paragraph",
      text: "The register lists every hotel reservation, newest first, whatever its status. It is a reading and filtering screen: nothing can be changed here. Open a reference (`BKG-…`) to reach the booking itself, where cancelling and answering requirements live.",
    },
    {
      type: "callout",
      tone: "info",
      text: "The sidebar calls this screen **Hotel bookings**; the page heading reads **Bookings**. They are the same register.",
    },
    {
      type: "heading",
      id: "tiles",
      text: "The four tiles",
    },
    {
      type: "table",
      columns: ["Tile", "What it counts", "Worth knowing"],
      rows: [
        ["Confirmed", "Bookings in `CONFIRMED` — the hint reads **Rooms committed**.", "A count of the whole register, not of the page."],
        ["Arriving from today", "Confirmed stays whose check-in is today or later.", "A true count across the register."],
        ["All bookings", "Every booking, in every status.", "Also a register-wide count."],
        ["Value on this page", "The totals of the bookings shown on the current page, cancelled ones excluded.", "It is not a business total. It changes every time you page or filter."],
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Value on this page is exactly that",
      text: "The money tile adds up only the twenty-five rows in front of you. Paging to the next screen, or narrowing the filters, gives a different figure. Do not read it as revenue.",
    },
    {
      type: "heading",
      id: "filters",
      text: "Filtering the register",
    },
    {
      type: "steps",
      items: [
        "Type in the search box to match a reference, a guest name or an email address. The list refreshes a moment after you stop typing.",
        "Choose a status from the select: **All statuses**, Pending, Confirmed, Cancelled, Completed or No show.",
        "Set the **Arriving** date range to keep only bookings whose check-in falls between the two dates.",
        "Read the result line — **N bookings**, or **No bookings match these filters.** — and page with **Previous** and **Next**. The page size is fixed at 25 and the order is always newest first.",
      ],
    },
    {
      type: "paragraph",
      text: "Every filter lives in the address bar, so a filtered view can be bookmarked or pasted to a colleague.",
    },
    {
      type: "callout",
      tone: "info",
      title: "A filter the register does not recognise is dropped",
      text: "If a bookmarked address carries a status value the register does not know, that filter is ignored silently and the list shows every booking. Check the status select if a saved link seems to show too much.",
    },
    {
      type: "heading",
      id: "columns",
      text: "What each row shows",
    },
    {
      type: "list",
      items: [
        "**Reference** — the `BKG-…` reference, linked to the booking.",
        "**Guest**, **Property** and **Stay** — the lead guest, the hotel as booked, and the check-in to check-out dates.",
        "**Status** — the booking's status badge. A small clock with a count sits beside it when the booking has requirements the property has not yet answered; it is placed beside the status, not in place of it, because the booking itself is unchanged.",
        "**Total** — the amount charged for the stay.",
      ],
    },
    {
      type: "paragraph",
      text: "On a narrow screen the same rows render as cards. An empty page reads **Nothing to show.**",
    },
    {
      type: "links",
      items: [
        { label: "A hotel booking: cancelling and answering requirements", articleId: "bk-hotel-booking-detail" },
        { label: "Booking and order statuses", articleId: "bk-statuses-glossary" },
      ],
    },
  ],
} satisfies HelpArticle;
