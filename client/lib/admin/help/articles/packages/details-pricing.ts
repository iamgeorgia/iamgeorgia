import type { HelpArticle } from "../../types";

/**
 * `/admin/packages/[slug]/details` (`PackageDetailsEditor.tsx`). The words,
 * the editorial image, the Party fieldset with its ranges, the two windows,
 * and the Adjustment whose Value field changes unit and label with the kind
 * (`lib/admin/packages.ts`). One save; no slug field.
 */
export const article = {
  id: "pk-details-pricing",
  title: "Details, party, windows and adjustment",
  summary: "The package's words, who it can be sold to, when it can be travelled and sold, and the discount or fixed price laid over its parts.",
  category: "packages",
  routes: ["/admin/packages/[slug]/details"],
  keywords: ["description", "nights", "editorial image", "party", "adults", "children", "travellers", "travel window", "on sale window", "adjustment", "discount", "fixed price", "per traveller", "required parts", "applies to"],
  related: ["pk-create", "pk-parts", "pk-preview-quote", "pk-publish-checklist", "md-images"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Packages", "[package]", "Details & pricing"] },
    {
      type: "paragraph",
      text: "Four groups of fields, one **Save** button. The tick that reads **Saved** clears the moment you edit anything again, so it always tells you whether what is on screen is what is stored.",
    },
    { type: "heading", id: "words-and-image", text: "Words and image" },
    {
      type: "table",
      columns: ["Field", "What it wants"],
      rows: [
        ["Name", "As on the create form."],
        ["Nights", "1 to 60. Every slot's day is measured against it."],
        ["Summary", "A sentence or two for cards and search."],
        ["Description", "One paragraph per line."],
        ["Editorial image", "**A path under /public. The gallery cover wins over it once one exists.**"],
      ],
    },
    { type: "heading", id: "party", text: "Party" },
    {
      type: "list",
      items: [
        "**Minimum adults** 1 to 60.",
        "**Maximum adults** 0 to 60.",
        "**Maximum children** 0 to 30.",
        "**Maximum travellers** 0 to 90.",
      ],
    },
    { type: "heading", id: "windows", text: "Windows" },
    {
      type: "paragraph",
      text: "**Travel from** and **Travel until** bound the dates a traveller may start the package. **On sale from** and **On sale until** bound the dates on which it can be bought. Outside either window the engine returns nothing, whatever the status says.",
    },
    { type: "heading", id: "adjustment", text: "Adjustment" },
    {
      type: "paragraph",
      text: "The adjustment is what the package does to the sum of its parts. **Kind** is one of **No adjustment**, **Percentage discount**, **Fixed package price** or **Fixed price per traveller**; **Value** is the figure; **Applies to** chooses **Required parts only** or **Every part, optional included**.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "The Value field changes meaning with the kind",
      text: "Its label reads **Discount (%)** for a percentage discount and **Price (…)** in the package's currency for either fixed kind. A 10 typed under one kind and then switched to the other is a 10 % discount or a ten-lari package — check the label before you save.",
    },
    {
      type: "paragraph",
      text: "For example, **Percentage discount**, **10**, **Required parts only** takes ten per cent off the hotel and the tour but leaves an optional mashgiach service at full price.",
    },
    {
      type: "callout",
      tone: "info",
      text: "There is no slug field. The public URL was fixed when the package was created.",
    },
  ],
} satisfies HelpArticle;
