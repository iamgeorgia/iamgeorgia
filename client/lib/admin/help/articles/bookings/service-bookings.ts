import type { HelpArticle } from "../../types";

/**
 * The service bookings register at `/admin/services/bookings` and one
 * booking's page (`ServiceBookingsBrowser.tsx`, `ServiceBookingActions.tsx`).
 */
export const article = {
  id: "bk-service-bookings",
  title: "Service bookings",
  summary: "Kosher meals, guides, a mashgiach, equipment — booked on their own or as the part of an order — and the requests a supplier has yet to answer.",
  category: "bookings",
  routes: ["/admin/services/bookings", "/admin/services/bookings/[reference]"],
  keywords: ["service", "SVC", "kosher meal", "mashgiach", "guide", "on request", "confirm", "decline", "cancel"],
  related: ["bk-finding-bookings", "bk-booking-approvals", "bk-statuses-glossary", "sv-services"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Service bookings"] },
    {
      type: "paragraph",
      text: "A service is a priced thing with no inventory: a kosher meal delivered, Shabbat meals, a mashgiach, a guide, equipment. An `SVC` reference is one of them booked — on its own at the desk or by a partner, or as the part of an order. The register uses the same filters as every other (see *Finding bookings*); its own date column is the service date.",
    },
    {
      type: "heading",
      id: "register",
      text: "Reading the register",
    },
    {
      type: "list",
      items: [
        "**Reference** — linked to the booking's page. An on-request booking shows the supplier's answer deadline under it.",
        "**Lead** — the person the booking is for, and the partner or customer beneath.",
        "**Service** — the service as it was when booked, and its category.",
        "**Date** — the service date, or the range for a multi-day service, with the party and the quantity.",
        "**Status**, **Payment**, **Total** — as on every register.",
      ],
    },
    {
      type: "heading",
      id: "detail",
      text: "One service booking",
    },
    {
      type: "paragraph",
      text: "The page reads the snapshot taken at confirmation — the service's name, basis and supplier as they were — beside the lead's details, the price (cost and margin for whoever may see them) and the cancellation terms frozen at confirmation. The **Approval**, **Payment** and **Desk** panels are the same as on every booking.",
    },
    {
      type: "heading",
      id: "actions",
      text: "Answering a request, and cancelling",
    },
    {
      type: "list",
      items: [
        "A service sold **on request** is written `PENDING` once the platform has approved it, with a 48-hour deadline. **Confirm request** makes it a booking and tells the buyer; **Decline request** needs a reason the buyer reads word for word, and charges nothing. Both need **Bookings: handle**.",
        "**Cancel booking** on a confirmed service charges whatever the terms frozen at confirmation say; the figure is shown before the button. It needs **Bookings: cancel**.",
        "A booking still waiting for the platform's approval can only be **withdrawn** here, at no charge. Approving is the queue's job.",
      ],
    },
    {
      type: "links",
      items: [
        { label: "Finding bookings", articleId: "bk-finding-bookings" },
        { label: "Booking approvals", articleId: "bk-booking-approvals" },
        { label: "The service catalogue", articleId: "sv-services" },
      ],
    },
  ],
} satisfies HelpArticle;
