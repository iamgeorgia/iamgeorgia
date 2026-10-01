import type { HelpArticle } from "../../types";

/**
 * Every admin action that sends an email or an in-app notice, and to whom —
 * the §5 table of the panel audit (`server/services/notifications/outbox.service.js`,
 * `server/lib/outbox.js`, the booking and dispatch services). Also the fact
 * that mail leaves through an outbox drained every few seconds and retried.
 */
export const article = {
  id: "dp-who-is-told-what",
  title: "Who is told what",
  summary: "For every action in the panel that sends something, who receives an email or an in-app notice — and which actions send nothing at all.",
  category: "dispatch",
  roles: ["ADMIN", "DISPATCHER"],
  keywords: ["email", "notification", "notice", "sent", "who receives", "driver", "partner", "guest", "buyer", "traveller", "outbox"],
  related: ["dp-dispatch-board", "dp-assigning-a-driver", "bk-transfer-booking-detail", "rf-dangerous-actions"],
  blocks: [
    {
      type: "paragraph",
      text: "Many actions in the panel tell somebody outside it. The table below lists each one, who hears about it and how — by email, by a notice inside their own panel, or both. Actions not listed send nothing.",
    },
    {
      type: "heading",
      id: "dispatch",
      text: "Dispatch",
    },
    {
      type: "table",
      columns: ["Action", "Who is told", "How"],
      rows: [
        ["Assign a leg (offer)", "The driver", "In-app **New transfer offered to you**, and an email with a link to their panel."],
        ["Assign with **Confirmed by phone** ticked", "Operations; the partner", "Operations in-app. The partner in-app and by email that a driver is assigned — the driver's phone number is included only when pick-up is within 24 hours."],
        ["Reassign", "The previous driver; the new driver", "The previous driver is told in-app and by email that the job was withdrawn. The new driver receives an offer as above."],
        ["Unassign", "The driver", "In-app and by email that the job was withdrawn."],
        ["Mark a leg `ARRIVED`, `ON_BOARD` or `COMPLETED`", "The partner", "In-app only — **The driver has arrived**, **Your passenger is on board**, **Transfer completed**. Other status moves tell nobody."],
        ["Cancel a leg", "Operations; the driver", "An in-app record for operations. The driver, if one was on it, through the withdrawal notice and email."],
      ],
    },
    {
      type: "heading",
      id: "bookings",
      text: "Bookings and orders",
    },
    {
      type: "table",
      columns: ["Action", "Who is told", "How"],
      rows: [
        ["Cancel a hotel booking", "The guest; the property", "Email to each. The internal reason is not included."],
        ["Confirm a tour request", "The traveller", "Email with the voucher."],
        ["Decline a tour request", "The traveller and the agency", "Email, with your reason quoted word for word."],
        ["Cancel a tour booking", "The traveller; the tour operator", "Email to each."],
        ["Decline an order part", "The buyer; the partner", "Email, with your reason word for word."],
        ["Cancel an order", "The buyer", "Email."],
      ],
    },
    {
      type: "heading",
      id: "people",
      text: "Drivers, partners and ratings",
    },
    {
      type: "table",
      columns: ["Action", "Who is told", "How"],
      rows: [
        ["Create or resend a driver login", "The driver", "Email with the activation link. The link is also shown in the panel to copy."],
        ["Approve or reject a partner", "The partner's primary contact", "Email."],
        ["Suspend a partner", "Nobody", "No email and no notice."],
        ["Publish or reject a rating", "Nobody", "No email and no notice."],
      ],
    },
    {
      type: "heading",
      id: "how-mail-leaves",
      text: "How mail leaves",
    },
    {
      type: "paragraph",
      text: "An email is not sent from the button you press. The action writes a message into an outbox, which is drained every few seconds; a message that fails to send is retried. So a mail arrives a moment after the action, and a brief mail outage delays it rather than losing it.",
    },
    {
      type: "links",
      items: [
        { label: "The dispatch board", articleId: "dp-dispatch-board" },
        { label: "Assigning or reassigning a driver", articleId: "dp-assigning-a-driver" },
      ],
    },
  ],
} satisfies HelpArticle;
