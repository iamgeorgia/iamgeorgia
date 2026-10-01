import type { HelpArticle } from "../../types";

/**
 * The tour publish checklist from `tour.service.js` as the Publishing panel
 * on the hub shows it: eight items, a 422 rendered as "Not ready to publish:
 * …". Publishing is distinct from the Public sale switch; Take off sale is
 * reversible and Archive is not.
 */
export const article = {
  id: "tr-publish-checklist",
  title: "Getting a tour on sale",
  summary: "The eight things a tour must have before Publish will work, in the order you would naturally do them.",
  category: "tours",
  roles: ["ADMIN"],
  keywords: ["publish", "checklist", "not ready to publish", "go live", "on sale", "blocker", "cover", "capacity", "price sheet"],
  related: ["tr-hub", "tr-details-itinerary", "tr-options-prices", "tr-departures", "md-images", "pb-checklists"],
  blocks: [
    {
      type: "paragraph",
      text: "The **Publishing** panel on the tour's hub lists what is still missing and keeps **Publish** disabled until the list is empty. If you reach the button and the server still finds a gap, the panel reads **Not ready to publish: …** with the missing items. These are the eight, in working order.",
    },
    { type: "heading", id: "the-eight-items", text: "The eight items" },
    {
      type: "steps",
      items: [
        "A summary — on **Details & itinerary**.",
        "A description — on **Details & itinerary**.",
        "A meeting point — on **Details & itinerary**.",
        "At least one itinerary day — on **Details & itinerary**.",
        "A cover: either an editorial image path on **Details & itinerary** or an uploaded cover on **Images**. Once anything is uploaded, only the upload counts.",
        "At least one active option — on **Options & prices**, with its **On sale** box ticked.",
        "A price sheet with tiers — a season on that option with at least one tier in it.",
        "Capacity on at least one future departure — on **Departures**, applied to a date that has not passed.",
      ],
    },
    { type: "heading", id: "publishing-and-public-sale", text: "Publishing is not the same as public sale" },
    {
      type: "paragraph",
      text: "**Publish** makes the tour `ACTIVE`: visible in search and bookable by trade partners. Whether anonymous visitors can also book it is the separate **Public sale (B2C)** switch in the same panel, which is off by default.",
    },
    { type: "heading", id: "coming-off-sale", text: "Coming off sale" },
    {
      type: "paragraph",
      text: "**Take off sale** sets the tour `INACTIVE`. It stays editable, existing bookings are unaffected, and **Publish** brings it back once the checklist is clear again.",
    },
    {
      type: "callout",
      tone: "danger",
      title: "Archive is not the reversible one",
      text: "**Archive** closes the tour for good after a single browser prompt. There is no un-archive. When in doubt, take it off sale instead.",
    },
    {
      type: "links",
      items: [
        { label: "The tour hub, publishing and statuses", articleId: "tr-hub" },
        { label: "Publish checklists across the panel", articleId: "pb-checklists" },
      ],
    },
  ],
} satisfies HelpArticle;
