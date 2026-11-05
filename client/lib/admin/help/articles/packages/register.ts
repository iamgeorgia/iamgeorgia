import type { HelpArticle } from "../../types";

/**
 * The packages register at `/admin/packages` (`PackagesBrowser.tsx`).
 * Search over name and slug; Status and Kosher filters; six columns; page
 * size 25; no card list on small screens. The From column is the sampled
 * indicative price the daily sweeper writes, never a live quote.
 */
export const article = {
  id: "pk-register",
  title: "Packages register",
  summary: "Finding a package, reading its row, and why the From column is a sample rather than a quote.",
  category: "packages",
  routes: ["/admin/packages"],
  keywords: ["package list", "find a package", "search packages", "filter", "kosher", "status", "from price", "sampled", "nights", "parts", "featured"],
  related: ["pk-create", "pk-hub", "pk-preview-quote", "rf-search-filters", "pb-statuses"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Packages"] },
    {
      type: "paragraph",
      text: "The register lists every package, twenty-five to a page, with the count in the footer as **Page X of Y · N packages**. Open a row to reach the package's hub; **Add package** at the top starts a new one.",
    },
    { type: "heading", id: "finding-a-package", text: "Finding a package" },
    {
      type: "list",
      items: [
        "The search box matches the name or the slug.",
        "**Status** narrows the list to one of the four statuses.",
        "**Kosher** narrows it to kosher packages only, or to those that are not.",
        "When nothing matches, the table reads **No packages match those filters.**",
      ],
    },
    { type: "heading", id: "columns", text: "The columns" },
    {
      type: "table",
      columns: ["Column", "What it shows"],
      rows: [
        ["Package", "The cover thumbnail, the name with a star when the package is featured, and the slug."],
        ["Destination", "The destination the package is filed under."],
        ["Nights", "The package length."],
        ["Parts", "How many slots the package has."],
        ["Status", "`DRAFT`, `ACTIVE`, `INACTIVE` or `ARCHIVED`, as an icon and a word."],
        ["From", "A sampled indicative price."],
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "From is a sample, not a quote",
      text: "A daily sweeper runs the quote engine on each package and writes the figure it found. A blank is normal on a draft. A blank on an `ACTIVE` package is worth noticing: the sweeper found no date on which every part resolved, and the **Preview a quote** screen will tell you why.",
    },
    {
      type: "paragraph",
      text: "Unlike the hotels, tours and services registers, this one has no stacked card list on a narrow screen — the table scrolls sideways instead.",
    },
  ],
} satisfies HelpArticle;
