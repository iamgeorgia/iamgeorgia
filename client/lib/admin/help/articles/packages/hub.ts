import type { HelpArticle } from "../../types";

/**
 * The package hub at `/admin/packages/[slug]` with `PackageActions.tsx`.
 * Six tiles; the Package definition list; the Parts table; the Publishing
 * panel whose toggles fire at once, whose Archive has no confirmation and
 * whose Delete appears only while DRAFT and has none either (409
 * `HAS_ORDERS`); the two footnotes; the Kosher eligibility panel re-checked
 * on every load.
 */
export const article = {
  id: "pk-hub",
  title: "The package hub, publishing and kosher eligibility",
  summary: "Where every part of a package is reached from, what the Publishing panel does without asking, and how to read the kosher eligibility panel.",
  category: "packages",
  routes: ["/admin/packages/[slug]"],
  keywords: ["publish", "take off sale", "archive", "delete", "feature", "featured", "sell to the public", "b2c", "status", "kosher eligibility", "cannot be sold as kosher", "worth knowing", "tiles"],
  related: ["pk-publish-checklist", "pk-parts", "pk-details-pricing", "pk-preview-quote", "pk-kosher", "md-images", "pb-translations", "pb-statuses", "rf-dangerous-actions"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Packages", "[package]"] },
    {
      type: "paragraph",
      text: "The hub is the package's front door: the facts, the parts, the **Publishing** panel and the kosher verdict on one screen. Every editing screen is one tile away.",
    },
    { type: "heading", id: "tiles", text: "The six tiles" },
    {
      type: "definitions",
      items: [
        { term: "Parts", description: "The slots the package is assembled from — hotel stays, transfers, tours and services." },
        { term: "Details & pricing", description: "The words, the party limits, the travel and on-sale windows and the price adjustment." },
        { term: "Preview a quote", description: "The real quote engine run on any date, draft or not." },
        { term: "Kosher", description: "The kosher rules the package is sold under, if any." },
        { term: "Images", description: "The gallery and the cover." },
        { term: "Translations", description: "Georgian, Russian and Hebrew versions of the name, summary and description." },
      ],
    },
    { type: "heading", id: "package", text: "The Package list" },
    {
      type: "paragraph",
      text: "The **Package** list gives the Slug, Destination, Nights, Currency, Time zone, Party, Travel window, On sale window, Adjustment and the From price marked **(sampled)** — the figure a daily job wrote, not a live quote.",
    },
    { type: "heading", id: "parts-table", text: "The Parts table" },
    {
      type: "paragraph",
      text: "One row per slot: **#**, **Slot**, **Type**, **Pinned to** (the hotel, tour, service or route the slot names, if any) and **Day**, which reads `arrival` for day 0, `+n` for a later day, and `· Nn` for the nights of a hotel stay. Until there is a slot it reads **No slots yet. A package needs at least one required part before it can be published.**",
    },
    { type: "heading", id: "publishing", text: "Publishing" },
    {
      type: "steps",
      items: [
        "Clear the checklist in the **Publishing** panel; the footnote reads **Publishing unlocks once the checklist above is clear.**",
        "Press **Publish**. The package becomes `ACTIVE`. If the server still finds something missing the panel reads **Not ready to publish: …**.",
        "Press **Take off sale** to pause it as `INACTIVE`; **Publish** brings it back.",
      ],
    },
    {
      type: "paragraph",
      text: "Two toggles sit in the same panel: **Sell to the public** opens the package to anonymous visitors, and **Feature** puts it on the homepage. When a package is featured but not `ACTIVE` the panel adds **Featured, but not on sale — nothing will show it until it is published.**",
    },
    {
      type: "callout",
      tone: "warning",
      title: "The toggles fire at once",
      text: "**Sell to the public** and **Feature** take effect the moment they are clicked, with no confirmation.",
    },
    { type: "heading", id: "kosher-eligibility", text: "Kosher eligibility" },
    {
      type: "paragraph",
      text: "The **Kosher eligibility** panel in the sidebar checks every fixed hotel in the package against its live certificates each time this page loads. Blockers appear under **Cannot be sold as kosher**; things that will not stop a sale but that a buyer would want to know appear under **Worth knowing**. A blocker here is either fixed at the hotel or overridden, with a date and a reason, on the **Kosher** screen.",
    },
    { type: "heading", id: "archive-delete", text: "Archive and Delete" },
    {
      type: "callout",
      tone: "danger",
      title: "Archive has no confirmation at all",
      text: "One click on **Archive** closes the package for good — no browser prompt, no un-archive. Hotels and tours ask first; packages do not. Use **Take off sale** when the pause might end.",
    },
    {
      type: "callout",
      tone: "danger",
      title: "Delete has no confirmation either",
      text: "**Delete** is shown only while the package is `DRAFT`, and one click removes it. The server refuses when orders exist against it, but a draft has none, so nothing stands between the click and the deletion.",
    },
    {
      type: "links",
      items: [
        { label: "Getting a package on sale", articleId: "pk-publish-checklist" },
        { label: "Package kosher rules", articleId: "pk-kosher" },
        { label: "Dangerous actions", articleId: "rf-dangerous-actions" },
      ],
    },
  ],
} satisfies HelpArticle;
