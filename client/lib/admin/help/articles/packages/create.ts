import type { HelpArticle } from "../../types";

/**
 * `/admin/packages/new` (`NewPackageForm.tsx`). Five fields with their
 * hints verbatim; the slug is capped at 80 characters by the form's own
 * slugify; **Create draft** lands on the hub; no later package screen has a
 * slug field and there is no redirect table.
 */
export const article = {
  id: "pk-create",
  title: "Adding a package",
  summary: "The create form: five fields, two of which — the slug and the nights — are harder to change than they look.",
  category: "packages",
  roles: ["ADMIN"],
  routes: ["/admin/packages/new"],
  keywords: ["new package", "create package", "add package", "slug", "nights", "destination", "summary", "draft"],
  related: ["pk-hub", "pk-parts", "pk-details-pricing", "pk-publish-checklist", "pb-slugs-and-seo"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Packages", "Add package"] },
    {
      type: "paragraph",
      text: "A package starts as a `DRAFT` with a name, an address, a home destination and a length. Its parts, prices, windows and images are assembled afterwards on the hub.",
    },
    { type: "heading", id: "fields", text: "The fields" },
    {
      type: "table",
      columns: ["Field", "What it wants"],
      rows: [
        ["Name", "Required."],
        ["Slug", "Filled in from the name as you type, capped at 80 characters. The hint reads: **The public URL. Changing it later breaks any link already shared.**"],
        ["Destination", "Required. The hint reads: **A slot with no hotel of its own searches here.**"],
        ["Nights", "1 to 60, default 3. The hint reads: **Slot day offsets are measured against it.**"],
        ["Summary", "A sentence or two for cards and search."],
      ],
    },
    { type: "heading", id: "creating-the-draft", text: "Creating the draft" },
    {
      type: "steps",
      items: [
        "Enter the name and choose the destination — **Create draft** stays disabled until both are set.",
        "Check the slug and the number of nights.",
        "Press **Create draft**. You land on the package's hub.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Get the slug right now",
      text: "No later package screen has a slug field, and there is no redirect from an old address to a new one. A link shared to the wrong slug would simply stop working.",
    },
    {
      type: "callout",
      tone: "info",
      text: "The nights can be changed later on **Details & pricing**, but every slot's day is an offset from arrival measured against that number, so shortening a package can push a slot outside its own dates.",
    },
  ],
} satisfies HelpArticle;
