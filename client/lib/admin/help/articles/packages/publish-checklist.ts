import type { HelpArticle } from "../../types";

/**
 * The package publish checklist from `package.service.js` as the Publishing
 * panel shows it: four items, a 422 rendered as "Not ready to publish: …".
 * Publish is distinct from Sell to the public; Archive and Delete carry no
 * confirmation on this entity.
 */
export const article = {
  id: "pk-publish-checklist",
  title: "Getting a package on sale",
  summary: "The four things a package must have before Publish will work, and the two buttons beside it that do not ask first.",
  category: "packages",
  roles: ["ADMIN"],
  keywords: ["publish", "checklist", "not ready to publish", "go live", "on sale", "blocker", "cover", "required slot", "adjustment"],
  related: ["pk-hub", "pk-parts", "pk-details-pricing", "pk-preview-quote", "md-images", "pb-checklists"],
  blocks: [
    {
      type: "paragraph",
      text: "The **Publishing** panel on the package's hub lists what is missing and keeps **Publish** disabled until the list is empty. If the server still finds a gap when you press it, the panel reads **Not ready to publish: …** with the items. There are four.",
    },
    { type: "heading", id: "the-four-items", text: "The four items" },
    {
      type: "steps",
      items: [
        "A summary — on **Details & pricing**.",
        "At least one slot with **Required** ticked — on **Parts**. A package made only of optional parts cannot be sold.",
        "A cover: either an editorial image path on **Details & pricing** or an uploaded cover on **Images**. Once anything is uploaded, only the upload counts.",
        "If the **Adjustment** kind is anything other than **No adjustment**, a **Value** above 0.",
      ],
    },
    {
      type: "paragraph",
      text: "The checklist does not run a quote. A package can pass all four and still return nothing to a traveller because a slot never resolves — run **Preview a quote** before and after publishing.",
    },
    { type: "heading", id: "publishing-and-public-sale", text: "Publishing is not the same as public sale" },
    {
      type: "paragraph",
      text: "**Publish** makes the package `ACTIVE`: visible and bookable by trade partners. Whether anonymous visitors can also buy it is the separate **Sell to the public** toggle in the same panel.",
    },
    {
      type: "callout",
      tone: "danger",
      title: "Archive and Delete do not ask",
      text: "In the same panel, **Archive** closes the package for good with no prompt and no un-archive, and **Delete** — shown only on a `DRAFT` — removes it with no prompt either. **Take off sale** is the reversible one.",
    },
    {
      type: "links",
      items: [
        { label: "The package hub, publishing and kosher eligibility", articleId: "pk-hub" },
        { label: "Publish checklists across the panel", articleId: "pb-checklists" },
      ],
    },
  ],
} satisfies HelpArticle;
