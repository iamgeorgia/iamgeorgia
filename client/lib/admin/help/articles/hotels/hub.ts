import type { HelpArticle } from "../../types";

/**
 * The property hub at `/admin/hotels/[slug]` (`hotels/[slug]/page.tsx`,
 * `HotelActions.tsx`, `HotelStatusBadge.tsx`): the six tiles, the Property,
 * Room types and Recent bookings panels, the Publishing panel with its
 * checklist and buttons. The five `HotelStatus` meanings are quoted from
 * `lib/admin/hotels.ts`; the button behaviour — Publish gated on the
 * checklist, Take off sale without confirm, the one-click B2C switch, the
 * browser-confirmed and terminal Archive, the always-visible Delete refused
 * only by a booking — from `HotelActions.tsx` and `hotel.service.js`. The
 * segment accepts an id or a slug and every link uses the id.
 */
export const article = {
  id: "ht-hub",
  title: "The property hub, publishing and statuses",
  summary: "The screen a property is run from: the six tiles, the publishing panel, what each status means, and which buttons can be undone.",
  category: "hotels",
  routes: ["/admin/hotels/[slug]"],
  keywords: ["property page", "publish", "take off sale", "archive", "delete hotel", "status", "draft", "on sale", "off sale", "suspended", "b2c", "public sale", "checklist"],
  related: ["ht-publish-checklist", "pb-statuses", "pb-b2c-vs-trade", "ht-rooms-rates", "rf-dangerous-actions"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Hotels", "[property]"] },
    {
      type: "paragraph",
      text: "Open a property from the register and you land on its hub. Everything about the property is reached from here, and the sidebar is where it is published, taken off sale, archived or deleted.",
    },
    { type: "heading", id: "tiles", text: "The six tiles and the panels" },
    {
      type: "table",
      columns: ["Tile", "What it opens"],
      rows: [
        ["Rooms & rates", "Room types, their beds, and the rate plans sold on each."],
        ["Inventory & pricing", "The calendar: how many rooms are open on each night and what each night costs."],
        ["Images", "The gallery and the room galleries."],
        ["Details & policies", "Check-in and check-out, descriptions, policies and house rules, amenities."],
        ["Location", "Street address, postal code and the map pin."],
        ["Kosher", "The kosher profile, certificates and their documents."],
      ],
    },
    {
      type: "definitions",
      items: [
        { term: "Property", description: "The facts as created: type, rating, destination, supplier and so on." },
        {
          term: "Room types",
          description: "Room, Sleeps, Rate plans and Status for each room type. Until one exists it reads **No rooms yet. A property needs one before it can be published.**",
        },
        { term: "Recent bookings", description: "The latest bookings against this property." },
        { term: "Publishing", description: "In the sidebar under the cover image: the status, the publish checklist, and the action buttons." },
      ],
    },
    { type: "heading", id: "publishing", text: "Publishing" },
    {
      type: "paragraph",
      text: "The **Publishing** panel lists what is still missing before the property can go on sale. **Publish** appears while the property is a draft or off sale and stays disabled until that list is empty. If the server still finds something missing it answers with the full list, shown as **Not ready to publish: address; coordinates; …**",
    },
    {
      type: "steps",
      items: [
        "Work through the checklist until the panel shows nothing missing.",
        "Press **Publish**. The status becomes `ACTIVE` — On sale.",
        "To stop selling without losing anything, press **Take off sale**. The status becomes `INACTIVE`, the message reads **Taken off sale. Existing bookings are unaffected.**, and **Publish** brings it back. No confirmation is asked either way.",
      ],
    },
    { type: "heading", id: "statuses", text: "The five statuses" },
    {
      type: "table",
      columns: ["Status", "Label", "Meaning"],
      rows: [
        ["`DRAFT`", "Draft", "Being set up. Invisible everywhere, including search."],
        ["`ACTIVE`", "On sale", "Visible in search and bookable."],
        ["`INACTIVE`", "Off sale", "Temporarily off sale. Still editable, invisible to guests."],
        ["`SUSPENDED`", "Suspended", "Taken off sale by the platform."],
        ["`ARCHIVED`", "Archived", "Closed permanently. Bookings against it remain readable."],
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Suspended is not yours to set",
      text: "No button in the panel produces `SUSPENDED`. It is applied by the platform, and the register's status filter lists it only so that a suspended property can be found.",
    },
    { type: "heading", id: "b2c", text: "Public sale (B2C)" },
    {
      type: "paragraph",
      text: "Every property is sold to trade partners by default. The **Public sale (B2C)** switch in the Publishing panel opens it to anonymous visitors on the public site as well. It is separate from the status: a draft with the switch on still shows nowhere, and a property on sale with the switch off is bookable by partners only.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "One click, no confirmation",
      text: "The switch flips the moment it is pressed. On a property that is on sale, turning it on exposes the property to the public immediately.",
    },
    { type: "heading", id: "archive-delete", text: "Archive and delete" },
    {
      type: "paragraph",
      text: "**Archive** is offered on any property that is not already archived. The browser asks **Archive [name]? This is permanent.** — and it is: an archived property refuses every edit and there is no way to bring it back. Bookings against it stay readable.",
    },
    {
      type: "callout",
      tone: "danger",
      title: "Archive is irreversible",
      text: "There is no un-archive. If the property may sell again one day, use **Take off sale** instead — that is the reversible way to stop selling.",
    },
    {
      type: "paragraph",
      text: "**Delete** is always in the panel, even on a property that is on sale. The browser asks once — **Delete [name] and its images for good? This cannot be undone.** — and then the property, its images, its room types, its rate plans and its prices and inventory are gone and the register opens. The only thing that stops it is an existing booking: then the delete is refused.",
    },
    {
      type: "callout",
      tone: "danger",
      title: "Delete is irreversible and only a booking prevents it",
      text: "A live property without a booking can be destroyed with one confirmation. Images the property shared with nothing else are deleted with it.",
    },
    {
      type: "callout",
      tone: "info",
      title: "The address bar shows an id, not the slug",
      text: "Every link in the panel opens a property by its id, so the admin URL never contains the slug. Pasting a slug into the address instead of the id also works.",
    },
    {
      type: "links",
      items: [
        { label: "Getting a hotel on sale", articleId: "ht-publish-checklist" },
        { label: "Draft, on sale, off sale, archived (and suspended)", articleId: "pb-statuses" },
        { label: "Public sale (B2C) vs trade-only", articleId: "pb-b2c-vs-trade" },
      ],
    },
  ],
} satisfies HelpArticle;
