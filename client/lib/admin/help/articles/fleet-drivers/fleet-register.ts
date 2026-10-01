import type { HelpArticle } from "../../types";

/**
 * `/admin/transfers/fleet` (`transfers/fleet/page.tsx`, `FleetBrowser.tsx`).
 * Encodes: the three stat cards with the Off the road hint; search by make,
 * model or plate; the four Status filter values; the five columns; page
 * size 25.
 */
export const article = {
  id: "fd-fleet-register",
  title: "Fleet register",
  summary: "Every physical car on file — searching by plate, filtering by whether it is on the road, and what each column shows.",
  category: "fleet-drivers",
  roles: ["ADMIN", "DISPATCHER"],
  routes: ["/admin/transfers/fleet"],
  keywords: ["fleet", "cars", "vehicles", "plate", "registration", "on the road", "off the road", "archived", "seats", "drivers"],
  related: ["fd-add-car", "fd-car-detail", "fd-drivers-register", "dp-assigning-a-driver", "rf-search-filters"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Fleet"] },
    {
      type: "paragraph",
      text: "The fleet is the set of real cars a driver can be sent out in. Each is sold as one vehicle class and operated by one supplier. This register is where a dispatcher checks what is on the road and an administrator adds or retires cars.",
    },
    { type: "heading", id: "cards", text: "The three cards" },
    {
      type: "table",
      columns: ["Card", "What it counts"],
      rows: [
        ["On the road", "Cars that are `ACTIVE` and can be dispatched."],
        ["Off the road", "Cars that are `DRAFT` or `INACTIVE` — in for service, or not yet started."],
        ["Archived", "Cars that have been retired from the fleet."],
      ],
    },
    { type: "heading", id: "finding", text: "Finding a car" },
    {
      type: "list",
      items: [
        "The search box matches make, model or registration plate. A plate is matched however it is spelt — spaces and dashes are ignored.",
        "**Status** narrows the list to **Not yet on the road**, **On the road**, **Off the road** or **Archived**.",
        "Twenty-five cars to a page.",
      ],
    },
    { type: "heading", id: "columns", text: "The columns" },
    {
      type: "definitions",
      items: [
        { term: "Car", description: "The main photograph as a thumbnail, make and model, then `plate · colour · year`." },
        { term: "Sold as", description: "The vehicle class the car is dispatched as, and the supplier that operates it." },
        { term: "Seats", description: "Passenger seats." },
        { term: "Drivers", description: "The drivers eligible to take this car, set from each driver's page." },
        { term: "Status", description: "`ACTIVE`, `DRAFT`, `INACTIVE` or `ARCHIVED` as a badge." },
      ],
    },
    {
      type: "paragraph",
      text: "Open a row to reach the car's page, where its details, photographs, documents and status are managed.",
    },
    {
      type: "links",
      items: [
        { label: "Adding a car", articleId: "fd-add-car" },
        { label: "A car: details, photographs, documents, status", articleId: "fd-car-detail" },
      ],
    },
  ],
} satisfies HelpArticle;
