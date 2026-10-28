import type { HelpArticle } from "../../types";

/**
 * The hotel publish checklist from `hotel.service.js` (twelve items in the
 * order the server checks them), the 422 rendered by `HotelActions.tsx` as
 * "Not ready to publish: …", Publish versus the Public sale (B2C) switch,
 * and the reversible Take off sale against the terminal Archive.
 */
export const article = {
  id: "ht-publish-checklist",
  title: "Getting a hotel on sale",
  summary: "The twelve things a property needs before Publish unlocks, in the order to do them, and what the buttons around Publish do.",
  category: "hotels",
  keywords: ["publish", "checklist", "not ready to publish", "go live", "on sale", "missing", "blockers", "cover image", "take off sale"],
  related: ["ht-hub", "ht-details-location", "ht-rooms-rates", "ht-kosher", "pb-checklists"],
  blocks: [
    {
      type: "paragraph",
      text: "A property is published from the **Publishing** panel on its hub. **Publish** stays disabled until the checklist in the panel is empty, and the server checks the same list again when the button is pressed. Work through the items in this order — each later one depends on an earlier screen being done.",
    },
    { type: "heading", id: "checklist", text: "The checklist" },
    {
      type: "steps",
      items: [
        "A street address — on **Location**.",
        "Coordinates: both latitude and longitude — on **Location**.",
        "A short description — on **Details & policies**.",
        "A full description — on **Details & policies**.",
        "Complete policies — on **Details & policies**.",
        "Check-in and check-out times — on **Details & policies**.",
        "At least one amenity ticked — on **Details & policies**.",
        "At least one image — on **Images**.",
        "A cover image. The first upload becomes the cover unless another is chosen — on **Images**.",
        "At least one active room type — on **Rooms & rates**.",
        "At least one active rate plan on an active room — on **Rooms & rates**.",
        "A verified kosher certificate, if the kosher level is `PARTIAL` or `FULL` — on **Kosher**. Lower levels skip this item.",
      ],
    },
    { type: "heading", id: "message", text: "When the server still says no" },
    {
      type: "paragraph",
      text: "If anything is still missing when **Publish** is pressed, nothing changes and the panel shows the full list in one line: **Not ready to publish: address; coordinates; cover image.** Each item names the screen to go back to. Publish is also refused when the property is already on sale, or is suspended or archived.",
    },
    { type: "heading", id: "after", text: "After publishing" },
    {
      type: "definitions",
      items: [
        {
          term: "Publish",
          description: "Sets the status to `ACTIVE` — On sale. Trade partners can find and book the property.",
        },
        {
          term: "Public sale (B2C)",
          description: "A separate switch. Publishing alone sells to partners only; turn this on as well to sell to anonymous visitors on the public site. One click, no confirmation.",
        },
        {
          term: "Take off sale",
          description: "`ACTIVE` to `INACTIVE`. Reversible with **Publish**, no confirmation asked, existing bookings unaffected.",
        },
        {
          term: "Archive",
          description: "Closes the property permanently. The browser asks once.",
        },
      ],
    },
    {
      type: "callout",
      tone: "danger",
      title: "Archive cannot be undone",
      text: "There is no un-archive and an archived property refuses edits. To pause sales, use **Take off sale** — never Archive.",
    },
    {
      type: "links",
      items: [
        { label: "The property hub, publishing and statuses", articleId: "ht-hub" },
        { label: "Publish checklists at a glance", articleId: "pb-checklists" },
      ],
    },
  ],
} satisfies HelpArticle;
