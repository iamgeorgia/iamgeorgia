import type { HelpArticle } from "../../types";

/**
 * The tour hub at `/admin/tours/[slug]` and its `TourActions.tsx` sidebar.
 * Five tiles, the options table and its empty state, **View live page** only
 * while ACTIVE; the four statuses; Publish gated on the checklist, Take off
 * sale, Archive (browser confirm, terminal), Delete (browser confirm, 409
 * `HAS_BOOKINGS`, removes images); the two switches with no confirmation and
 * the missing warning for Featured-without-Published.
 */
export const article = {
  id: "tr-hub",
  title: "The tour hub, publishing and statuses",
  summary: "Where every part of a tour is reached from, what each status means, and which buttons in the Publishing panel cannot be undone.",
  category: "tours",
  roles: ["ADMIN"],
  routes: ["/admin/tours/[slug]"],
  keywords: ["publish", "take off sale", "archive", "delete", "featured", "public sale", "b2c", "status", "on sale", "off sale", "view live page", "tiles"],
  related: ["tr-publish-checklist", "tr-options-prices", "tr-departures", "tr-details-itinerary", "md-images", "pb-translations", "pb-statuses", "rf-dangerous-actions"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Tours", "[tour]"] },
    {
      type: "paragraph",
      text: "The hub is the tour's front door. It shows the facts at a glance, lists the options, and holds the **Publishing** panel where the tour goes on and off sale. Every editing screen is one tile away.",
    },
    { type: "heading", id: "tiles", text: "The five tiles" },
    {
      type: "definitions",
      items: [
        { term: "Options & prices", description: "The ways the tour is sold, each with its own seasons and price tiers." },
        { term: "Departures", description: "Capacity by date for each option." },
        { term: "Details & itinerary", description: "The words, the age limits, the lists and the day-by-day itinerary." },
        { term: "Images", description: "The gallery and the cover." },
        { term: "Translations", description: "Georgian, Russian and Hebrew versions of the text." },
      ],
    },
    {
      type: "paragraph",
      text: "The header carries **View live page** only while the tour is `ACTIVE`. Below the tiles, the options table lists each option with its Kind, Priced, Confirmation and Pax; until there is one it reads **No options yet. A tour needs one before it can be published.**",
    },
    { type: "heading", id: "publishing", text: "Publishing" },
    {
      type: "steps",
      items: [
        "Work through the checklist shown in the **Publishing** panel. **Publish** stays disabled until it is empty.",
        "Press **Publish**. The tour becomes `ACTIVE`. If the server still finds something missing it answers **Not ready to publish: …** and lists the items.",
        "To pause sales, press **Take off sale**. The tour becomes `INACTIVE`, stays editable, and can be published again the same way.",
      ],
    },
    { type: "heading", id: "statuses", text: "Statuses" },
    {
      type: "table",
      columns: ["Status", "Label", "Meaning"],
      rows: [
        ["`DRAFT`", "Draft", "Being set up. Invisible everywhere, including search."],
        ["`ACTIVE`", "On sale", "Visible in search and bookable."],
        ["`INACTIVE`", "Off sale", "Temporarily off sale. Still editable, invisible to travellers."],
        ["`ARCHIVED`", "Archived", "Closed permanently. Bookings against it remain readable."],
      ],
    },
    { type: "heading", id: "switches", text: "The two switches" },
    {
      type: "list",
      items: [
        "**Public sale (B2C)** lets anonymous visitors book the tour. Off, it sells only to trade partners.",
        "**Featured** puts the tour **On the homepage rail**.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Neither switch asks for confirmation",
      text: "Each one takes effect the moment it is clicked. Switching **Public sale (B2C)** on exposes an `ACTIVE` tour to the public at once.",
    },
    {
      type: "callout",
      tone: "info",
      text: "**Featured** on a tour that is not `ACTIVE` shows it nowhere, and this screen does not say so — the packages hub warns about the same combination; this one does not.",
    },
    { type: "heading", id: "archive-delete", text: "Archive and Delete" },
    {
      type: "paragraph",
      text: "Both live in the **Publishing** panel beside **Publish**, and **Delete** is shown even while the tour is on sale.",
    },
    {
      type: "callout",
      tone: "danger",
      title: "Archive is permanent",
      text: "The browser asks once — **Archive … ? This is permanent.** — and there is no un-archive. An archived tour cannot be edited or put back on sale; its bookings stay readable. Use **Take off sale** when the pause might end.",
    },
    {
      type: "callout",
      tone: "danger",
      title: "Delete removes the tour and its images",
      text: "The browser asks once — **Delete … and its images for good? This cannot be undone.** — then the tour, its options, seasons, departures and uploaded images are gone and you are returned to the register. The server refuses the moment any booking exists, so a tour that has ever sold can only be archived.",
    },
    {
      type: "links",
      items: [
        { label: "Getting a tour on sale", articleId: "tr-publish-checklist" },
        { label: "Dangerous actions", articleId: "rf-dangerous-actions" },
      ],
    },
  ],
} satisfies HelpArticle;
