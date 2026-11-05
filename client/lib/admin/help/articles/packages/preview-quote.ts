import type { HelpArticle } from "../../types";

/**
 * `/admin/packages/[slug]/preview` (`PackagePreviewQuote.tsx`). The real
 * engine run as staff on a draft; inputs with their defaults and ranges;
 * children's ages hard-coded to 8; the output lines and the per-slot
 * resolution with reason labels from `slotReasonLabels`.
 */
export const article = {
  id: "pk-preview-quote",
  title: "Preview a quote",
  summary: "Running the real quote engine on a package, on a draft, on any date — and reading a slot that did not resolve.",
  category: "packages",
  routes: ["/admin/packages/[slug]/preview"],
  keywords: ["quote", "preview", "test", "price", "margin", "net", "sell", "resolve", "reason", "sold out", "no price", "start date", "rooms"],
  related: ["pk-parts", "pk-details-pricing", "pk-register", "pk-hub"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Packages", "[package]", "Preview a quote"] },
    {
      type: "paragraph",
      text: "The screen says what it is: **The real engine, run as staff, on any date. Works on a draft — which is the point.** It is the same code a traveller's search runs, with the difference that it will quote a `DRAFT` and shows you why each slot resolved the way it did.",
    },
    { type: "heading", id: "running-a-preview", text: "Running a preview" },
    {
      type: "steps",
      items: [
        "Set a **Start date**. It defaults to three weeks from today and cannot be in the past.",
        "Set **Adults** (1 to 60), **Children** (0 to 20) and **Rooms** (1 to 9).",
        "Run the quote and read the lines below.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      text: "Every child in the preview is eight years old. A hotel or tour with different prices for infants or older children will not show that difference here.",
    },
    { type: "heading", id: "reading-the-result", text: "Reading the result" },
    {
      type: "definitions",
      items: [
        { term: "Parts (sell)", description: "What the traveller would pay for the parts, before the adjustment." },
        { term: "Parts (net)", description: "What the suppliers would be paid." },
        { term: "Discount / Supplement", description: "What the package's adjustment adds or takes off." },
        { term: "Margin", description: "Sell after adjustment, less net." },
      ],
    },
    {
      type: "paragraph",
      text: "Below the totals, each slot is listed with what the engine picked for it — the hotel and rate plan, the tour option, the route — and its price. A slot that did not resolve carries a reason instead.",
    },
    { type: "heading", id: "slot-that-did-not-resolve", text: "A slot that did not resolve" },
    {
      type: "table",
      columns: ["Reason", "What to look at"],
      rows: [
        ["Sold out", "Capacity on that date, on the hotel's calendar or the tour's departures."],
        ["No price for that date", "The hotel's rates or the tour's seasons — nothing covers the start date."],
        ["Not on sale", "The pinned product's status, or the option's **On sale** box."],
        ["Too soon, Beyond horizon", "The product's notice hours or booking horizon against the start date."],
        ["Party size", "The option's smallest and largest party, or the room's occupancy, against the party you entered."],
        ["Route closed, Unavailable, Excluded", "The transfer route, or the product's own availability rules."],
        ["Wrong currency", "The product is priced in another currency than the package."],
        ["No longer exists", "The product the slot names has been deleted; re-pin it on **Parts**."],
      ],
    },
    {
      type: "paragraph",
      text: "A required slot that does not resolve means no quote on that date, which is also why the register's From column can be blank on an `ACTIVE` package. Try a different start date to tell a one-day gap from a broken slot.",
    },
  ],
} satisfies HelpArticle;
