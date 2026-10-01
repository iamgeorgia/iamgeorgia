import type { HelpArticle } from "../../types";

/**
 * `/admin/packages/[slug]/components` (`PackageComponentsBuilder.tsx`).
 * The set is saved whole and re-validated together; at most 20 slots; the
 * common fields and the per-type ones; pickers exclude archived products,
 * badge drafts and keep an id they cannot resolve; a rejected save returns a
 * problem per slot via `problemLabel`; a pinned hotel that is deleted turns
 * the slot into "any hotel here" because the FK is SetNull.
 */
export const article = {
  id: "pk-parts",
  title: "Parts (slots)",
  summary: "How a package is assembled from hotel stays, transfers, tours and services, and why the whole set is saved and checked together.",
  category: "packages",
  roles: ["ADMIN"],
  routes: ["/admin/packages/[slug]/components"],
  keywords: ["slot", "slots", "components", "parts", "hotel stay", "transfer", "tour", "service", "required", "day", "board", "room types", "rate plans", "route", "vehicle class", "quantity", "save parts", "problem"],
  related: ["pk-hub", "pk-preview-quote", "pk-details-pricing", "pk-publish-checklist", "ht-rooms-rates", "tr-options-prices", "sv-services", "tc-routes-register"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Packages", "[package]", "Parts"] },
    {
      type: "paragraph",
      text: "A package is a list of slots, each filled from the catalogue when a traveller asks for a quote: a hotel stay, a transfer, a tour or a service. This screen builds that list.",
    },
    { type: "heading", id: "how-saving-works", text: "How saving works" },
    {
      type: "paragraph",
      text: "The panel says it in one line: **Saved whole: the set is replaced and re-validated together.** There is no per-slot save. **Save parts** sends every slot at once; the server checks all of them and either writes the whole set or writes nothing. A package can hold up to 20 slots.",
    },
    {
      type: "steps",
      items: [
        "Add a slot and give it a **Label** and a **Type**.",
        "Set its **Day** — 0 for arrival, up to the package's number of nights — and tick **Required** if a quote must fail when this slot cannot be filled.",
        "Fill in the fields for its type, described below.",
        "Use the arrows to reorder and the remove button to drop a slot; nothing changes until you save.",
        "Press **Save parts**.",
      ],
    },
    { type: "heading", id: "slot-types", text: "The four slot types" },
    {
      type: "definitions",
      items: [
        {
          term: "Hotel stay",
          description:
            "**Nights** (1 up to the package's nights), **Time of day**, a **Hotel** picker whose placeholder **Any hotel here** means any hotel at the destination, then **Room types**, **Rate plans** and **Board** codes (`RO`, `BB`, `HB`, `HB_PLUS`, `FB`, `FB_PLUS`, `AI`, `UAI`) to narrow what the engine may pick.",
        },
        {
          term: "Transfer",
          description:
            "**From** (**Any pick-up**), **To** (**Any drop-off**), **Route** (**No fixed route**), **Trip type** one way or return, and vehicle-class checkboxes. A slot needs a route, or both a start and an end point.",
        },
        { term: "Tour", description: "A **Tour** picker, required, and an **Options** checklist to limit which of its options may be used." },
        { term: "Service", description: "A **Service** picker, required, and a **Quantity** rule: one for the booking, one per traveller, or one per room." },
      ],
    },
    {
      type: "paragraph",
      text: "For example, a three-night Tbilisi package might be: day 0, a transfer from the airport with no fixed route; day 0, a three-night hotel stay at any hotel here on `BB`; day 1, a required wine tour; day 2, a mashgiach service, one for the booking.",
    },
    {
      type: "callout",
      tone: "info",
      text: "The pickers hide archived products but keep one that is already chosen, and they show drafts with a badge. A slot pinned to a draft hotel or tour will not resolve until that product is on sale.",
    },
    { type: "heading", id: "problems", text: "When a save is refused" },
    {
      type: "paragraph",
      text: "A rejected save lists one problem per slot, under that slot. The common ones: **Falls outside the package's own dates** (the day or the nights run past the package's length), **Needs both a start and an end point, or a route** (a transfer slot with one end), **The tour has no option this slot allows** (every option ticked is off sale or gone), **Not on sale** (the pinned product is not `ACTIVE`) and **Wrong currency** (the product is priced in a currency other than the package's). Fix the named slot and save again; nothing was written.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Deleting a pinned hotel silently loosens the slot",
      text: "If a hotel a slot is pinned to is deleted, the slot is not blocked and not flagged — it quietly becomes any hotel at the destination. Check the **Pinned to** column on the hub after deleting a hotel or tour that packages may name.",
    },
    {
      type: "links",
      items: [
        { label: "Preview a quote", articleId: "pk-preview-quote" },
        { label: "Getting a package on sale", articleId: "pk-publish-checklist" },
      ],
    },
  ],
} satisfies HelpArticle;
