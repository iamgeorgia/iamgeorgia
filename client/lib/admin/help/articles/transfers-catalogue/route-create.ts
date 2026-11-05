import type { HelpArticle } from "../../types";

/**
 * `/admin/transfers/routes/new` (`transfers/routes/new/page.tsx`,
 * `NewTransferRouteForm.tsx`). Encodes: the two-points gate, the field list
 * with its defaults (Tier 3, City, Airport when either end is an airport,
 * slug "from-to-to"), distance and journey time seeded from coordinates when
 * blank, same-ends refused, created as DRAFT with no fares, lands on the
 * route's page.
 */
export const article = {
  id: "tc-route-create",
  title: "Adding a route",
  summary: "Joining two pick-up points into a new route, which starts life as a draft with no fares.",
  category: "transfers-catalogue",
  routes: ["/admin/transfers/routes/new"],
  keywords: ["new route", "add route", "create route", "pick-up", "drop-off", "slug", "sales tier", "category", "distance", "journey time"],
  related: ["tc-points", "tc-route-editing", "tc-routes-register", "tc-pricing-model"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Routes", "Add a route"] },
    {
      type: "paragraph",
      text: "A route joins two pick-up points. Both ends must already be on file, so if you have fewer than two points in service the form is replaced by a warning and nothing can be created — add the points first.",
    },
    { type: "heading", id: "fields", text: "The form" },
    {
      type: "table",
      columns: ["Field", "What to enter", "Default"],
      rows: [
        ["Pick-up", "The starting point, from the points in service.", "Required"],
        ["Drop-off", "The destination. It cannot be the same point as the pick-up.", "Required"],
        ["Sales tier", "How prominently the route is sold.", "Tier 3"],
        ["Category", "Airport, City, Resort, Tourist route or Multi-stop.", "City; switches itself to Airport when either end is an airport"],
        ["Slug", "The public URL segment.", "Built from the two ends as `from-to-to`, until you edit it"],
        ["Distance (km)", "1 to 5000. Optional.", "Worked out from the two points' coordinates when left blank"],
        ["Journey time (minutes)", "Optional.", "Worked out from the coordinates when left blank"],
        ["Title", "The public name. Optional here; needed before publishing.", "—"],
        ["Summary", "One or two sentences. Optional here; needed before publishing.", "—"],
        ["Show on the transfers landing page", "Feature the route on the public transfers page.", "Off"],
      ],
    },
    { type: "heading", id: "creating", text: "Creating it" },
    {
      type: "steps",
      items: [
        "Choose the **Pick-up** and **Drop-off** points. Choosing the same point at both ends shows an inline error and the button stays disabled.",
        "Check the **Category** the form chose and change it if the journey is a resort or tourist route.",
        "Leave **Distance** and **Journey time** blank unless you know better figures than the map gives; the server fills them in from the coordinates.",
        "Press the create button. You land on the new route's page.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Note",
      text: "Created as a draft with no fares. Pricing is the next screen: the route stays `DRAFT` and cannot be published until at least one vehicle class has a fare.",
    },
    {
      type: "paragraph",
      text: "Example: Pick-up Tbilisi Airport, Drop-off Tbilisi. The category switches to Airport, the slug reads `tbilisi-airport-to-tbilisi`, and the distance is seeded from the two pins. Type a title and summary now, or on the route's page before publishing.",
    },
    {
      type: "links",
      items: [
        { label: "Editing a route: fares, details, stops, closed dates, archive", articleId: "tc-route-editing" },
        { label: "Pick-up points", articleId: "tc-points" },
      ],
    },
  ],
} satisfies HelpArticle;
