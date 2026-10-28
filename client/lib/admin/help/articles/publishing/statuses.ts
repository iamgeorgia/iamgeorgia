import type { HelpArticle } from "../../types";

/**
 * The lifecycle shared by hotels, tours, packages and services. Status
 * meanings from `lib/admin/hotels.ts` (reused verbatim by tours, packages
 * and services, whose enums lack SUSPENDED); the buttons and whether each
 * asks for confirmation from `HotelActions.tsx`, `TourActions.tsx`,
 * `PackageActions.tsx` (no confirm on Archive) and `ServiceActions.tsx`.
 * Archive is terminal for all four — no un-archive endpoint exists; routes
 * and vehicle classes are the exception, where archive restores as a draft.
 * SUSPENDED is platform-set and no panel button produces it.
 */
export const article = {
  id: "pb-statuses",
  title: "Draft, on sale, off sale, archived (and suspended)",
  summary: "What each status means on the public site, which buttons move a record between them, which ask for confirmation, and the one move that can never be undone.",
  category: "publishing",
  keywords: ["status", "lifecycle", "draft", "active", "inactive", "archived", "suspended", "publish", "take off sale", "archive", "un-archive", "restore"],
  related: ["pb-checklists", "pb-b2c-vs-trade", "ht-hub", "tr-hub", "pk-hub", "sv-services", "rf-dangerous-actions"],
  blocks: [
    {
      type: "paragraph",
      text: "Hotels, tours, packages and services share one lifecycle. A record starts as a draft, is published when its checklist is clear, can be taken off sale and put back, and is archived when it is finished with. The status badge shows an icon and a word, never colour alone.",
    },
    { type: "heading", id: "meanings", text: "What each status means" },
    {
      type: "table",
      columns: ["Status", "Label", "Meaning"],
      rows: [
        ["`DRAFT`", "Draft", "Being set up. Invisible everywhere, including search."],
        ["`ACTIVE`", "On sale", "Visible in search and bookable."],
        ["`INACTIVE`", "Off sale", "Temporarily off sale. Still editable, invisible to guests."],
        ["`SUSPENDED`", "Suspended", "Taken off sale by the platform. Hotels only."],
        ["`ARCHIVED`", "Archived", "Closed permanently. Bookings against it remain readable."],
      ],
    },
    {
      type: "paragraph",
      text: "Hotels have all five. Tours, packages and services have the same four without `SUSPENDED`. Destinations have no status at all — only a Featured flag.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Suspended cannot be set from the panel",
      text: "No button produces `SUSPENDED`. It is applied by the platform. The status filter on the hotels register lists it only so a suspended property can be found.",
    },
    { type: "heading", id: "buttons", text: "The buttons and their confirmations" },
    {
      type: "table",
      columns: ["Button", "Moves", "Hotel", "Tour", "Package", "Service"],
      rows: [
        ["**Publish**", "`DRAFT` or `INACTIVE` to `ACTIVE`", "Disabled until the checklist is clear", "Same", "Same", "Same"],
        ["**Take off sale**", "`ACTIVE` to `INACTIVE`", "No confirmation", "No confirmation", "No confirmation", "No confirmation"],
        ["**Archive**", "Anything to `ARCHIVED`", "Browser confirm", "Browser confirm", "**None** — one click", "Browser confirm"],
      ],
    },
    {
      type: "paragraph",
      text: "The archive confirmations say what they mean: **Archive [name]? This is permanent.** for a hotel or tour, and **Archive [name]? Packages that name it stop selling it.** for a service. A package archives with no dialog at all.",
    },
    {
      type: "callout",
      tone: "danger",
      title: "Archive is permanent",
      text: "There is no un-archive for hotels, tours, packages or services — no button, and no request the panel could make. An archived record refuses edits and stays archived; a service's panel spells it out: archiving is final. If a record may sell again, use **Take off sale**.",
    },
    {
      type: "paragraph",
      text: "**Take off sale** is the reversible way to stop selling: the record keeps everything, disappears from guests, and **Publish** brings it back without going through the checklist again unless something has changed.",
    },
    { type: "heading", id: "exceptions", text: "Routes and vehicle classes" },
    {
      type: "paragraph",
      text: "Transfer routes and vehicle classes are the exception to the rule above: archiving one is not terminal, and restoring it brings it back as a draft to be published again.",
    },
    {
      type: "links",
      items: [
        { label: "Publish checklists at a glance", articleId: "pb-checklists" },
        { label: "Public sale (B2C) vs trade-only", articleId: "pb-b2c-vs-trade" },
        { label: "Dangerous actions", articleId: "rf-dangerous-actions" },
      ],
    },
  ],
} satisfies HelpArticle;
