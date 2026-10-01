import type { HelpArticle } from "../../types";

/**
 * `/admin/tours/new` (`NewTourForm.tsx`). Every field with its rule, hint or
 * default; **Create draft** lands on the hub. The slug is auto-derived here
 * and has no field on any later tour screen (`TourDetailsEditor.tsx` has
 * none), and there is no redirect table, so it is effectively fixed at
 * creation.
 */
export const article = {
  id: "tr-create",
  title: "Adding a tour",
  summary: "The create form: what each field wants, what it defaults to, and why the slug deserves a second look before you press Create draft.",
  category: "tours",
  roles: ["ADMIN"],
  routes: ["/admin/tours/new"],
  keywords: ["new tour", "create tour", "add tour", "slug", "region", "difficulty", "length", "group size", "supplier", "draft"],
  related: ["tr-hub", "tr-details-itinerary", "tr-publish-checklist", "pb-slugs-and-seo"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Tours", "Add tour"] },
    {
      type: "paragraph",
      text: "A new tour starts as a `DRAFT` with the facts that never change about it. Prices, departures, images and the itinerary come later, on the hub. Nothing here is visible to anyone until the tour is published.",
    },
    { type: "heading", id: "fields", text: "The fields" },
    {
      type: "table",
      columns: ["Field", "What it wants"],
      rows: [
        ["Title", "Required."],
        ["Slug", "Required. Filled in from the title as you type; lowercase letters, numbers and hyphens."],
        ["Region", "Required. The hint says it: **As a traveller would say it — “Kazbegi, Khevi”.**"],
        ["Destination", "Required. The destination the tour is filed under."],
        ["Category", "Defaults to `culture`. Also adventure, wine, nature and city."],
        ["Difficulty", "Easy, Moderate or Challenging."],
        ["Length in days", "1 to 60, default 1. Changing it also rewrites the length label."],
        ["Length as a traveller reads it", "Required. The words shown on the public page, for example “Full day”."],
        ["Group size", "Required, default **2–8 travellers**. Words only — the hint reminds you that capacity is set per option."],
        ["Supplier", "An approved tour-operator partner."],
        ["Summary", "Required, up to 600 characters."],
        ["Meeting point", "Required, up to 500 characters."],
      ],
    },
    { type: "heading", id: "creating-the-draft", text: "Creating the draft" },
    {
      type: "steps",
      items: [
        "Fill in the required fields — the title, slug, region, destination, length label, group size, summary and meeting point.",
        "Check the slug once more.",
        "Press **Create draft**. You land on the tour's hub, where the tiles lead to everything else.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "The slug cannot be changed later from the panel",
      text: "No later tour screen has a slug field, and there is no redirect from an old slug to a new one. The slug you create with is the public URL for good.",
    },
    {
      type: "callout",
      tone: "info",
      text: "The slug is derived from Latin letters only. A Georgian or Cyrillic title produces nothing, so type the slug by hand for those.",
    },
  ],
} satisfies HelpArticle;
