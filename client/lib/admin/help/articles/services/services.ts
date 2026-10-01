import type { HelpArticle } from "../../types";

/**
 * `/admin/services` (`ServicesBrowser.tsx` + `NewServiceForm.tsx`). What a
 * service is; the register's search, Status and Category selects and the
 * **Kosher only** chip; the six columns; card list below `lg`; page size 25.
 * Creation is an inline panel on the same screen — the only entity without
 * a `/new` route — blocked until a cancellation template exists, landing on
 * `/admin/services/{id}` on success. The basis field is the one that
 * mis-prices, and the BasisExplainer is the only defence.
 */
export const article = {
  id: "sv-services",
  title: "Services register and creating one",
  summary: "What a service is, how to find one, and how a new one is created on the same screen without a page of its own.",
  category: "services",
  roles: ["ADMIN"],
  routes: [{ pattern: "/admin/services", section: "register" }],
  keywords: ["service", "extra", "mashgiach", "guide", "equipment", "kosher meal", "new service", "create service", "basis", "per person", "per day", "per unit", "kosher only"],
  related: ["sv-editing", "pk-parts", "rf-search-filters", "pb-statuses"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Services"] },
    { type: "heading", id: "what-a-service-is", text: "What a service is" },
    {
      type: "paragraph",
      text: "The screen's own words: **Priced extras with no inventory — kosher meals, a mashgiach, a guide, equipment. Sold inside packages.** A service has no calendar, no departures and no gallery, so it has no hub and no sub-screens: the register, an inline create panel and one editing page are the whole of it.",
    },
    { type: "heading", id: "register", text: "The register" },
    {
      type: "list",
      items: [
        "The search box matches the name or the slug.",
        "**Status** and **Category** are selects; **Kosher only** is a chip beside them that narrows the list to services under kosher supervision.",
        "Twenty-five rows to a page. On a narrow screen the table becomes a stacked list of cards.",
      ],
    },
    {
      type: "table",
      columns: ["Column", "What it shows"],
      rows: [
        ["Service", "The name, the slug, **· Kosher** when it is under supervision, and the supplier."],
        ["Category", "One of the seven categories."],
        ["Priced", "The basis — what one unit is."],
        ["Per unit", "The price you would pay as the viewer, then `net …`, then **· fixed** when a fixed sell is set."],
        ["Confirmation", "Instant or on request."],
        ["Status", "`DRAFT`, `ACTIVE`, `INACTIVE` or `ARCHIVED`, as an icon and a word."],
      ],
    },
    { type: "heading", id: "create", text: "Creating a service" },
    {
      type: "paragraph",
      text: "**New service** does not open a new page. It opens a panel titled **A new service** on the register itself — the only entity in the panel created this way. The fields are the same as on the editing page.",
    },
    {
      type: "steps",
      items: [
        "Press **New service**.",
        "Fill in the name, summary, basis, net price and cancellation terms at least; the rest can wait for the editing page.",
        "Read the line under the basis before you go on — it says what four travellers over three days would buy.",
        "Save. On success you land on the service's own page, where translations, publishing and deletion live.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "No cancellation template, no services",
      text: "Creation is blocked entirely until at least one cancellation template exists on the platform; the panel says so in place of the form. The template pool is the one tours use.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "The basis is the field that mis-prices",
      text: "The price is the price of one unit, and the four bases disagree about what a unit is. A mashgiach at ₾400 **Per day** and one at ₾400 **Per person, per day** are an order of magnitude apart on the same booking. The live explainer — **Four travellers over three days buy N units …** — is the only thing on the screen that says so; read it before saving.",
    },
    {
      type: "links",
      items: [{ label: "Editing, translating, publishing and deleting a service", articleId: "sv-editing" }],
    },
  ],
} satisfies HelpArticle;
