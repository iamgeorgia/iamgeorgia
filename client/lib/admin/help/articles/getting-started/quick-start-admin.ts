import type { HelpArticle } from "../../types";

/**
 * The administrator's first day, in the order the panel's own dependencies
 * impose. Mirrors `quickStart.ts`; the checklist card on the Overview and the
 * hub draws from that file, this article is the reading version.
 */
export const article = {
  id: "gs-quick-start-admin",
  title: "Quick start for administrators",
  summary: "The eight things to learn first, in the order the panel requires them — from a destination to a published hotel, a working transfer network and an answered queue.",
  category: "getting-started",
  keywords: ["quick start", "first day", "onboarding", "checklist", "tutorial", "begin", "new admin"],
  related: ["gs-what-is-the-panel", "rf-common-tasks-admin", "rf-dangerous-actions"],
  blocks: [
    {
      type: "paragraph",
      text: "The panel will not let you do things out of order: a hotel cannot exist without a destination, a car cannot exist without a supplier and a vehicle class, and dispatch has nobody to offer a job to until a driver is linked to a car. Follow the list once and the rest of the manual is reference.",
    },
    {
      type: "steps",
      items: [
        "**Create a destination.** A country first — everything below it inherits the country code — then the city or region inside it. `Sidebar → Inventory → Destinations → Add destination`.",
        "**Add a hotel.** Name, slug, type, stars, destination and supplier. It is created as a draft and takes you to its hub, the screen every other hotel screen hangs off.",
        "**Rooms and rate plans.** A room type is what a guest sleeps in; a rate plan is the terms it is sold on. One room with two boards is one room and two rate plans.",
        "**Inventory and nightly prices.** How many rooms are on sale each night and the supplier's net price. Prices are net: the selling price is derived from the buyer's markup.",
        "**Images, details and location.** At least one image and a cover; the descriptions, policies, check-in times and amenities; a pin on the map. Every one of these is a publishing blocker.",
        "**Publish.** The Publishing panel on the hub lists what is still missing. When the list is empty, **Publish** unlocks. Decide separately whether to open **Public sale (B2C)**.",
        "**Set up transfers.** Register the transport company as a partner, then a vehicle class, then a car, then a driver, then tick the car on the driver's page. Verify the driver and issue their login.",
        "**Answer a queue.** Orders on request, tour requests and partner applications all hold something — rooms, seats, a company's patience — until somebody answers them.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Read the do-not list before your first afternoon",
      text: "Several buttons in the panel act the moment they are clicked, with no confirmation, and several actions cannot be undone. The list of them is short and worth ten minutes.",
    },
    {
      type: "links",
      items: [
        { label: "Dangerous actions — the do-not list", articleId: "rf-dangerous-actions" },
        { label: "Common tasks for administrators", articleId: "rf-common-tasks-admin" },
        { label: "Getting a hotel on sale — the checklist", articleId: "ht-publish-checklist" },
      ],
    },
  ],
} satisfies HelpArticle;
