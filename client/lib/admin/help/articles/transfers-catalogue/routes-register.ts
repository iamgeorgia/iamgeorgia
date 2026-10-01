import type { HelpArticle } from "../../types";

/**
 * The routes register at `/admin/transfers/routes` (`transfers/routes/page.tsx`,
 * `TransferRoutesBrowser.tsx`) and the bulk pricer that sits above it
 * (`TransferBulkPricer.tsx`, server `route.service.js` bulk reprice). Encodes:
 * the Unpriced card samples the first 100 routes and reads "N+"; "Not priced"
 * in the From column; page size 25; the pricer needs a tier or a category and
 * has no "everything" option; the formula max(flat or km × rate, floor);
 * archived routes excluded; Overwrite destroys hand-set fares with no undo.
 */
export const article = {
  id: "tc-routes-register",
  title: "Routes register and the bulk pricer",
  summary: "Finding a transfer route, reading its starting fare and status, and repricing a whole tier or category from one rule.",
  category: "transfers-catalogue",
  roles: ["ADMIN"],
  routes: [{ pattern: "/admin/transfers/routes", section: "register" }],
  keywords: ["transfer routes", "reprice", "bulk", "unpriced", "not priced", "tier", "category", "per kilometre", "flat fare", "overwrite"],
  related: ["tc-route-create", "tc-route-editing", "tc-pricing-model", "tc-points", "rf-dangerous-actions"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Routes"] },
    {
      type: "paragraph",
      text: "A route is one journey between two pick-up points, sold with a fare per vehicle class. This register lists every route on file, shows what each one starts from, and carries the bulk pricer for writing fares to many routes at once.",
    },
    { type: "heading", id: "register", text: "The register" },
    {
      type: "table",
      columns: ["Card", "What it counts", "Worth knowing"],
      rows: [
        ["Routes", "Every route on file.", "Archived routes included."],
        ["Tier 1", "Routes on sales tier 1.", "The hint reads **The journeys the business runs on**."],
        ["Unpriced", "Routes with no fare at all.", "Shown as `N+`, because it only samples the first 100 routes. It is a floor, not a total."],
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Note",
      text: "The Unpriced card looks at the first hundred routes only, so `4+` may mean four or forty. To find every unpriced route, page through the register and look for **Not priced** in the From column.",
    },
    {
      type: "list",
      items: [
        "**Search a route, or either end of one** matches the route or the name of either pick-up point.",
        "**Tier** (Tier 1 to Tier 3) and **Category** (Airport, City, Resort, Tourist route, Multi-stop) narrow the list.",
        "Columns: Route (with a **via …** line when the route has stops), Tier, Category, Distance, From and Status.",
        "The From column shows the cheapest one-way fare. It reads **Not priced** when the route has no curated fare — never `0` or a dash.",
        "The status pill reads `ACTIVE`, `DRAFT`, `INACTIVE` or `ARCHIVED`.",
        "Twenty-five routes to a page, with **Previous** and **Next** underneath. Opening a row goes to the route's page.",
      ],
    },
    { type: "heading", id: "bulk-pricer", text: "Reprice in bulk" },
    {
      type: "paragraph",
      text: "**Reprice in bulk** opens a panel above the table that writes a curated one-way fare to every route matching a tier and/or a category, for the vehicle classes you tick. It is the fastest way to price a new tier, and the fastest way to flatten hand-set fares if used carelessly.",
    },
    {
      type: "steps",
      items: [
        "Press **Reprice in bulk**.",
        "Choose a **Tier**, a **Category**, or both. One of them is required — there is no option that means every route.",
        "Set **Charge** to **Per kilometre** or **Flat fare**, then type the **Amount (GEL)**. In per-kilometre mode you may also set a **Floor (GEL)**, the least any route will be priced at.",
        "Tick at least one vehicle-class chip.",
        "Leave **Overwrite fares that are already set** unticked unless you mean to replace fares someone typed by hand.",
        "Run it. The result line reads **Wrote N fares across M routes, leaving K already set**, or says nothing changed.",
      ],
    },
    {
      type: "paragraph",
      text: "Each written one-way fare is the flat amount, or the route's distance multiplied by the per-kilometre rate, and never less than the floor. Return fares are not written, so they stay at twice one-way. Archived routes are skipped.",
    },
    {
      type: "paragraph",
      text: "Example: Tier 2, Category Airport, Per kilometre, Amount 2, Floor 60, Economy ticked. A 25 km airport route gets an Economy one-way fare of 60 GEL (the floor); a 45 km one gets 90 GEL. Routes that already had an Economy fare are left alone and counted in **leaving K already set**.",
    },
    {
      type: "callout",
      tone: "danger",
      title: "Irreversible",
      text: "With **Overwrite fares that are already set** ticked, every hand-set fare on every matching route is replaced the moment you run it. There is no confirmation and no undo. Check the tier, the category and the chips before ticking it.",
    },
    {
      type: "links",
      items: [
        { label: "Adding a route", articleId: "tc-route-create" },
        { label: "How a transfer fare is computed", articleId: "tc-pricing-model" },
      ],
    },
  ],
} satisfies HelpArticle;
