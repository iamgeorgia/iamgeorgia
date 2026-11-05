import type { HelpArticle } from "../../types";

/**
 * Rooms & rates at `/admin/hotels/[slug]/rooms` (`RoomsManager.tsx`): the
 * room-type form (Name, Code, Sleeps, Max adults, Max children), the beds
 * rows with eight bed types, the rate-plan form (Offer name, Board,
 * Cancellation, Payment) with hotel-owned templates marked "(this hotel)",
 * and the two browser-confirmed archives. The package-slot consequence of
 * archiving a room comes from `EntityPicker.tsx` keeping unresolvable ids.
 */
export const article = {
  id: "ht-rooms-rates",
  title: "Rooms and rate plans",
  summary: "A room type is what a guest sleeps in; a rate plan is one way of selling it. How to add both, and what archiving them does.",
  category: "hotels",
  routes: ["/admin/hotels/[slug]/rooms"],
  keywords: ["room type", "rate plan", "board", "breakfast", "half board", "all inclusive", "beds", "occupancy", "sleeps", "cancellation policy", "payment policy", "archive room"],
  related: ["ht-inventory-pricing", "ht-hub", "ht-publish-checklist", "pk-parts"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Hotels", "[property]", "Rooms & rates"] },
    {
      type: "paragraph",
      text: "One room sold with two boards and two cancellation terms is one room and four rate plans — never four rooms. The room type describes the physical room; each rate plan is a way of selling it, with its own board, cancellation terms and payment terms. Prices are set per rate plan on the calendar, not here.",
    },
    { type: "heading", id: "rooms", text: "Adding a room type" },
    {
      type: "table",
      columns: ["Field", "Rule"],
      rows: [
        ["Name", "Required — as a guest would read it, for example Deluxe Double."],
        ["Code", "A short code, unique within this property."],
        ["Sleeps (max occupancy)", "1 to 30. The most people the room takes."],
        ["Max adults", "1 to 30."],
        ["Max children", "0 to 30."],
      ],
    },
    {
      type: "steps",
      items: ["Fill the **New room** form and save it.", "Under the room, add its beds and save them.", "Add at least one rate plan to the room."],
    },
    { type: "heading", id: "beds", text: "Beds" },
    {
      type: "paragraph",
      text: "Each row is a quantity and a bed type — Single, Twin, Double, Queen, King, Sofa bed, Bunk or Futon — with a quantity from 1 to 20. Press **Save beds** when the rows describe the room.",
    },
    { type: "heading", id: "rate-plans", text: "Adding a rate plan" },
    {
      type: "table",
      columns: ["Field", "Rule"],
      rows: [
        ["Offer name", "Required. The plan's code is derived from it."],
        ["Board", "`RO`, `BB`, `HB`, `HB+`, `FB`, `FB+`, `AI` or `UAI` — room only through ultra all-inclusive."],
        ["Cancellation", "A cancellation policy template."],
        ["Payment", "A payment policy template."],
      ],
    },
    {
      type: "paragraph",
      text: "Platform templates are listed by name; templates that belong to this property carry **(this hotel)** after the name.",
    },
    { type: "heading", id: "example", text: "An example" },
    {
      type: "paragraph",
      text: "A Deluxe Double sold with breakfast or without, each either refundable or non-refundable, is one room type with four rate plans: `BB` flexible, `BB` non-refundable, `RO` flexible, `RO` non-refundable. Each of the four gets its own nightly price on the calendar.",
    },
    { type: "heading", id: "archiving", text: "Archiving a room or a rate plan" },
    {
      type: "paragraph",
      text: "**Archive** on a room asks **Archive [name]? Its bookings stay readable.** On a rate plan it asks **Archive the \"[name]\" rate?** Both change the status rather than deleting anything — bookings already made against them stay readable.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Soft, but final from the panel",
      text: "Nothing in the panel restores an archived room or rate plan. Once the browser confirmation is accepted it stops selling and stays that way.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Packages that pin the room keep pointing at it",
      text: "A package slot that pins this room type or rate plan does not lose the reference when it is archived; it keeps a constraint that can no longer be satisfied. Check the packages that name the property after archiving.",
    },
    {
      type: "links",
      items: [
        { label: "Inventory and nightly prices", articleId: "ht-inventory-pricing" },
        { label: "Package parts", articleId: "pk-parts" },
      ],
    },
  ],
} satisfies HelpArticle;
