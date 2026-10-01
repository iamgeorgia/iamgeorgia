import type { HelpRole, QuickStartStep } from "./types";

/**
 * The first things a new operator should do, in the order the panel itself
 * requires them.
 *
 * An administrator's list follows the dependency chain the create forms
 * enforce — a hotel needs a destination, a car needs a supplier and a class,
 * dispatch needs both a car and a driver. A dispatcher's list is their day:
 * the board, an assignment, a leg's statuses, a diary, the ratings queue.
 * Each step names the screen to open and the article that explains it.
 */

const ADMIN_STEPS: QuickStartStep[] = [
  {
    id: "destination",
    title: "Create a destination",
    summary: "A country first, then the city inside it. Everything else is filed inside one.",
    href: "/admin/destinations/new",
    articleId: "ds-editing",
    where: ["Sidebar", "Inventory", "Destinations", "Add destination"],
  },
  {
    id: "hotel",
    title: "Add a hotel and reach its hub",
    summary: "Name it, place it, choose its supplier. It is created as a draft nobody can see.",
    href: "/admin/hotels/new",
    articleId: "ht-create",
    where: ["Sidebar", "Inventory", "Hotels", "Add property"],
  },
  {
    id: "rooms",
    title: "Rooms and rate plans",
    summary: "One room type sold with two boards is one room and two rate plans — never two rooms.",
    href: "/admin/hotels",
    articleId: "ht-rooms-rates",
    where: ["Sidebar", "Inventory", "Hotels", "[property]", "Rooms & rates"],
  },
  {
    id: "inventory",
    title: "Inventory and nightly prices",
    summary: "How many rooms are on sale each night, and the supplier's net price for them.",
    href: "/admin/hotels",
    articleId: "ht-inventory-pricing",
    where: ["Sidebar", "Inventory", "Hotels", "[property]", "Inventory & pricing"],
  },
  {
    id: "content",
    title: "Images, details and location",
    summary: "A cover image, the descriptions and policies guests read, and a pin on the map.",
    href: "/admin/hotels",
    articleId: "ht-details-location",
    where: ["Sidebar", "Inventory", "Hotels", "[property]", "Images"],
  },
  {
    id: "publish",
    title: "Publish the property",
    summary: "The checklist in the Publishing panel says what is still missing. Publish unlocks when it is clear.",
    href: "/admin/hotels",
    articleId: "ht-publish-checklist",
    where: ["Sidebar", "Inventory", "Hotels", "[property]", "Publishing"],
  },
  {
    id: "transfers",
    title: "Set up transfers",
    summary: "A supplier partner, then a vehicle class, a car, a driver, and the link between them.",
    href: "/admin/partners/new",
    articleId: "pt-registering",
    where: ["Sidebar", "Network", "Partners", "Add a partner"],
  },
  {
    id: "queue",
    title: "Answer a queue",
    summary: "Orders on request, tour requests and partner applications hold capacity until somebody answers.",
    href: "/admin/orders",
    articleId: "bk-order-detail",
    where: ["Sidebar", "Operations", "Orders"],
  },
];

const DISPATCHER_STEPS: QuickStartStep[] = [
  {
    id: "board",
    title: "Read the board",
    summary: "Every leg, soonest first, with who is on it and what happens next.",
    href: "/admin/transfers/dispatch",
    articleId: "dp-dispatch-board",
    where: ["Sidebar", "Operations", "Dispatch"],
  },
  {
    id: "assign",
    title: "Assign a driver",
    summary: "Who is free, which car, and whether the driver has already said yes by phone.",
    href: "/admin/transfers/dispatch",
    articleId: "dp-assigning-a-driver",
    where: ["Sidebar", "Operations", "Dispatch", "Assign"],
  },
  {
    id: "statuses",
    title: "Move a leg through its day",
    summary: "On the way, at the pick-up, passenger on board, completed — and what each one tells the partner.",
    href: "/admin/transfers/dispatch",
    articleId: "dp-leg-statuses",
    where: ["Sidebar", "Operations", "Dispatch", "Mark as…"],
  },
  {
    id: "schedule",
    title: "Check a diary and block time",
    summary: "A driver's or a car's jobs and days off, read from the same view dispatch uses to refuse a clash.",
    href: "/admin/transfers/schedule",
    articleId: "dp-schedule",
    where: ["Sidebar", "Inventory", "Transfers", "Schedule"],
  },
  {
    id: "fleet",
    title: "Keep fleet and drivers current",
    summary: "Cars on and off the road, documents, verification, and the login link a driver needs.",
    href: "/admin/transfers/drivers",
    articleId: "fd-driver-detail",
    where: ["Sidebar", "Inventory", "Transfers", "Drivers"],
  },
  {
    id: "ratings",
    title: "Moderate ratings",
    summary: "Scores count at once; the words wait for a look before a partner sees them.",
    href: "/admin/transfers/ratings",
    articleId: "dp-ratings",
    where: ["Sidebar", "Inventory", "Transfers", "Ratings"],
  },
];

export function quickStartFor(role: HelpRole): QuickStartStep[] {
  return role === "DISPATCHER" ? DISPATCHER_STEPS : ADMIN_STEPS;
}
