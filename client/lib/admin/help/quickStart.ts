import type { QuickStartStep } from "./types";

/**
 * The first things a new operator should do, in the order the panel itself
 * requires them.
 *
 * One list, not one per role: every step names the capability that makes it
 * the reader's, and `quickStartFor` keeps the steps the viewer can act on. An
 * administrator's steps follow the dependency chain the create forms enforce
 * — a hotel needs a destination, a car needs a supplier and a class, dispatch
 * needs both a car and a driver. A dispatcher is left with their day: the
 * board, an assignment, a leg's statuses, a diary, the ratings queue. A
 * finance desk gets the money steps. Each step names the screen to open and
 * the article that explains it.
 */
const STEPS: QuickStartStep[] = [
  {
    id: "destination",
    title: "Create a destination",
    summary: "A country first, then the city inside it. Everything else is filed inside one.",
    href: "/admin/destinations/new",
    articleId: "ds-editing",
    where: ["Sidebar", "Inventory", "Destinations", "Add destination"],
    capability: "catalogue.write",
  },
  {
    id: "hotel",
    title: "Add a hotel and reach its hub",
    summary: "Name it, place it, choose its supplier. It is created as a draft nobody can see.",
    href: "/admin/hotels/new",
    articleId: "ht-create",
    where: ["Sidebar", "Inventory", "Hotels", "Add property"],
    capability: "catalogue.write",
  },
  {
    id: "rooms",
    title: "Rooms and rate plans",
    summary: "One room type sold with two boards is one room and two rate plans — never two rooms.",
    href: "/admin/hotels",
    articleId: "ht-rooms-rates",
    where: ["Sidebar", "Inventory", "Hotels", "[property]", "Rooms & rates"],
    capability: ["catalogue.write", "pricing.write"],
  },
  {
    id: "inventory",
    title: "Inventory and nightly prices",
    summary: "How many rooms are on sale each night, and the supplier's net price for them.",
    href: "/admin/hotels",
    articleId: "ht-inventory-pricing",
    where: ["Sidebar", "Inventory", "Hotels", "[property]", "Inventory & pricing"],
    capability: "pricing.write",
  },
  {
    id: "content",
    title: "Images, details and location",
    summary: "A cover image, the descriptions and policies guests read, and a pin on the map.",
    href: "/admin/hotels",
    articleId: "ht-details-location",
    where: ["Sidebar", "Inventory", "Hotels", "[property]", "Images"],
    capability: "catalogue.write",
  },
  {
    id: "publish",
    title: "Publish the property",
    summary: "The checklist in the Publishing panel says what is still missing. Publish unlocks when it is clear.",
    href: "/admin/hotels",
    articleId: "ht-publish-checklist",
    where: ["Sidebar", "Inventory", "Hotels", "[property]", "Publishing"],
    capability: "catalogue.write",
  },
  {
    id: "transfers",
    title: "Set up transfers",
    summary: "A supplier partner, then a vehicle class, a car, a driver, and the link between them.",
    href: "/admin/partners/new",
    articleId: "pt-registering",
    where: ["Sidebar", "Network", "Partners", "Add a partner"],
    capability: "partners.write",
  },
  {
    id: "desk",
    title: "Take a booking at the desk",
    summary: "A booking by phone, by email or in person, for a partner or a customer without an account.",
    href: "/admin/bookings/new",
    articleId: "bk-desk-create-booking",
    where: ["Sidebar", "Operations", "Hotel bookings", "Create booking"],
    capability: "bookings.write",
  },
  {
    id: "queue",
    title: "Answer a queue",
    summary: "Orders on request, tour requests and partner applications hold capacity until somebody answers.",
    href: "/admin/orders",
    articleId: "bk-order-detail",
    where: ["Sidebar", "Operations", "Orders"],
    capability: "bookings.write",
  },
  {
    id: "board",
    title: "Read the board",
    summary: "Every leg, soonest first, with who is on it and what happens next.",
    href: "/admin/transfers/dispatch",
    articleId: "dp-dispatch-board",
    where: ["Sidebar", "Operations", "Dispatch"],
    capability: "dispatch.write",
  },
  {
    id: "assign",
    title: "Assign a driver",
    summary: "Who is free, which car, and whether the driver has already said yes by phone.",
    href: "/admin/transfers/dispatch",
    articleId: "dp-assigning-a-driver",
    where: ["Sidebar", "Operations", "Dispatch", "Assign"],
    capability: "dispatch.write",
  },
  {
    id: "statuses",
    title: "Move a leg through its day",
    summary: "On the way, at the pick-up, passenger on board, completed — and what each one tells the partner.",
    href: "/admin/transfers/dispatch",
    articleId: "dp-leg-statuses",
    where: ["Sidebar", "Operations", "Dispatch", "Mark as…"],
    capability: "dispatch.write",
  },
  {
    id: "schedule",
    title: "Check a diary and block time",
    summary: "A driver's or a car's jobs and days off, read from the same view dispatch uses to refuse a clash.",
    href: "/admin/transfers/schedule",
    articleId: "dp-schedule",
    where: ["Sidebar", "Inventory", "Transfers", "Schedule"],
    capability: "dispatch.write",
  },
  {
    id: "fleet",
    title: "Keep fleet and drivers current",
    summary: "Cars on and off the road, documents, verification, and the login link a driver needs.",
    href: "/admin/transfers/drivers",
    articleId: "fd-driver-detail",
    where: ["Sidebar", "Inventory", "Transfers", "Drivers"],
    capability: "dispatch.write",
  },
  {
    id: "ratings",
    title: "Moderate ratings",
    summary: "Scores count at once; the words wait for a look before a partner sees them.",
    href: "/admin/transfers/ratings",
    articleId: "dp-ratings",
    where: ["Sidebar", "Inventory", "Transfers", "Ratings"],
    capability: "dispatch.write",
  },
  {
    id: "payables",
    title: "Pay what is due this week",
    summary: "Supplier instalments late or due soon, and the form that records the payment.",
    href: "/admin/finance/payables",
    articleId: "fn-payables",
    where: ["Sidebar", "Finance", "Payables"],
    capability: "finance.payments.write",
  },
  {
    id: "receivables",
    title: "Chase what buyers owe",
    summary: "Bills past their due date, and how a payment is matched to them.",
    href: "/admin/finance/receivables?overdue=true",
    articleId: "fn-receivables",
    where: ["Sidebar", "Finance", "Receivables"],
    capability: "finance.payments.write",
  },
  {
    id: "approvals",
    title: "Decide a refund or a write-off",
    summary: "Money changes somebody asked for wait here for a second person.",
    href: "/admin/finance/approvals",
    articleId: "fn-approvals",
    where: ["Sidebar", "Finance", "Approvals"],
    capability: ["finance.refunds.approve", "finance.adjustments.approve"],
  },
  {
    id: "reports",
    title: "Read the week's figures",
    summary: "What is owed either way, the margin, and the ageing of the debts — per currency.",
    href: "/admin/finance/reports",
    articleId: "fn-reports",
    where: ["Sidebar", "Finance", "Reports"],
    capability: "finance.reports.read",
  },
];

const holds = (needed: string | string[] | undefined, capabilities: readonly string[]): boolean => {
  if (!needed) return true;
  return (Array.isArray(needed) ? needed : [needed]).some((capability) => capabilities.includes(capability));
};

/** The steps this viewer can act on, in the order the panel needs them. */
export function quickStartFor(capabilities: readonly string[]): QuickStartStep[] {
  return STEPS.filter((step) => holds(step.capability, capabilities));
}

/**
 * The card's heading, from what the viewer does rather than from a role
 * name: a custom role with the dispatcher's capabilities gets the
 * dispatcher's title.
 */
export function quickStartTitle(capabilities: readonly string[]): string {
  const has = (...names: string[]) => names.some((name) => capabilities.includes(name));
  if (has("catalogue.write")) return "Quick start for administrators";
  if (has("finance.payments.write", "finance.refunds.approve")) return "Quick start for the finance desk";
  if (has("bookings.write")) return "Quick start for the bookings desk";
  if (has("dispatch.write")) return "Quick start for dispatchers";
  return "Quick start";
}
