import type { HelpArticle } from "../../types";

/**
 * Driver ratings at `/admin/transfers/ratings` (`(panel)/transfers/ratings/page.tsx`,
 * `RatingsQueue.tsx`, `server/services/transfer/rating.service.js`). Encodes
 * the three tabs, the card contents, the one-click reversible Publish and
 * Reject, that the score counts before moderation and that rejecting removes
 * it from the average too (the subtitle understates this), no note field, no
 * email, and the 30-day rating window.
 */
export const article = {
  id: "dp-ratings",
  title: "Driver ratings moderation",
  summary: "Reading what passengers wrote about a driver, publishing or rejecting it, and what that does to the driver's average.",
  category: "dispatch",
  roles: ["ADMIN", "DISPATCHER"],
  routes: ["/admin/transfers/ratings"],
  keywords: ["rating", "review", "comment", "stars", "publish", "reject", "moderation", "average", "waiting for a look"],
  related: ["fd-driver-detail", "dp-dispatch-board", "dp-who-is-told-what"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Ratings"] },
    {
      type: "paragraph",
      text: "After a completed leg the passenger — or the partner, or operations on their behalf — may rate the driver within 30 days: a score out of five and, optionally, words. The score goes straight to the driver's record. The words wait here for a look before anyone else sees them.",
    },
    {
      type: "heading",
      id: "queue",
      text: "The queue",
    },
    {
      type: "paragraph",
      text: "Three tabs: **Waiting for a look** (the default, ratings in `PENDING`), **Published** and **Rejected**, with a count of ratings on the right. The list pages 25 at a time; an empty tab reads **Nothing here.**",
    },
    {
      type: "paragraph",
      text: "Each card shows the stars, the driver's name (linked to their page), the booking reference (linked), the comment in quotes, and a line saying where it came from — **Passenger** with their email, **Partner** with its name, or **Operations** with the staff member's name — the date, and once moderated, who published or rejected it.",
    },
    {
      type: "heading",
      id: "moderating",
      text: "Publishing or rejecting",
    },
    {
      type: "steps",
      items: [
        "Read the comment on the card.",
        "Press **Publish** to make the words visible on the driver's record, or **Reject** to keep them off it.",
        "The card moves to the matching tab. Changed your mind? A published rating still offers **Reject**, and a rejected one still offers **Publish**.",
      ],
    },
    {
      type: "paragraph",
      text: "Both buttons act on one click with no confirmation, and both are reversible at any time. There is no box for a moderation note, and nobody — neither the driver nor the passenger — is emailed when a rating is published or rejected.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Rejecting removes the score as well",
      text: "The screen's subtitle says scores go straight to the driver's average, and they do — a new rating counts before anyone has looked at it. But rejecting a rating takes its score out of the average too, not just its words. Reject a rating for what it says, knowing the number goes with it.",
    },
    {
      type: "links",
      items: [
        { label: "A driver's page", articleId: "fd-driver-detail" },
        { label: "Who is told what", articleId: "dp-who-is-told-what" },
      ],
    },
  ],
} satisfies HelpArticle;
