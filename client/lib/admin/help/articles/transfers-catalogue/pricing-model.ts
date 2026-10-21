import type { HelpArticle } from "../../types";

/**
 * How a transfer fare is put together, drawn from `TransferPriceGrid.tsx`,
 * `TransferVehicleFields.tsx`, `TransferPointForm.tsx`, `TransferExtrasEditor.tsx`
 * and the bulk pricer in `route.service.js`. Encodes: curated grid first
 * (route × class × direction); otherwise the class's fallback fare from the
 * distance between the two points, `max(minimum, km × rate) + airport fee`;
 * return = twice one-way unless set; extras by basis; lari in, whole tetri
 * stored; the bulk pricer writing curated fares from a rule; and which screen
 * changes which figure.
 */
export const article = {
  id: "tc-pricing-model",
  title: "How a transfer fare is computed",
  summary: "Curated fare first, distance engine second, extras on top — and which screen changes which figure.",
  category: "transfers-catalogue",
  keywords: ["pricing", "fare", "price", "distance engine", "fallback", "per km", "minimum", "airport fee", "return", "tetri", "lari", "curated"],
  related: ["tc-route-editing", "tc-vehicle-classes", "tc-points", "tc-extras", "tc-routes-register"],
  blocks: [
    {
      type: "paragraph",
      text: "A transfer fare has two possible sources and one set of additions. Knowing which source a given journey uses tells you which screen to open when a price looks wrong.",
    },
    { type: "heading", id: "order", text: "The order of precedence" },
    {
      type: "steps",
      items: [
        "The route's own price grid is checked first: one fare per vehicle class and direction (one way or return), typed by hand on the route's page or written by the bulk pricer. If the class has a one-way fare on this route, that is the price.",
        "Otherwise the class's fallback fare applies, worked out from the distance between the route's two pick-up points: `max(minimum, km × rate) + airport fee`, using the class's own per-kilometre rate, minimum and airport fee.",
        "A return journey costs twice the one-way fare unless the grid holds a return fare of its own.",
        "Extras are added according to their basis: a fixed amount per booking, an amount per passenger, an amount per hour, or a share of the fare.",
      ],
    },
    {
      type: "paragraph",
      text: "Example: a 40 km route with no Comfort fare on its grid, a Comfort class priced at 2.50 per km with a minimum of 40 and an airport fee of 10, and one end an airport. One way is `max(40, 100) + 10` = 110 GEL; return is 220 GEL; a child seat charged at 15 per booking makes 235 GEL.",
    },
    { type: "heading", id: "money", text: "Money" },
    {
      type: "paragraph",
      text: "Every amount is typed in lari and stored as whole tetri, rounded. The bulk pricer writes curated one-way fares into route grids from a rule — a flat amount, or kilometres times a rate with a floor — so a route it has touched is priced by the grid, not the distance engine, from then on.",
    },
    { type: "heading", id: "which-screen", text: "Which screen changes which figure" },
    {
      type: "definitions",
      items: [
        {
          term: "Route page — Fares",
          description: "The curated grid for one route: one-way and return per class. Clearing a class's one-way fare sends that class back to the distance engine on this route.",
        },
        {
          term: "Vehicle class — Fallback fare",
          description: "Per km, Minimum and Airport fee for a class. Changes every unpriced journey in that class, on every route.",
        },
        {
          term: "Pick-up point — coordinates",
          description: "The pin fixes the distance. Moving it changes every unpriced journey through that point; curated fares are untouched.",
        },
        {
          term: "Extras",
          description: "What each add-on costs and how it is charged. Added on top of whichever fare applied.",
        },
        {
          term: "Routes register — Reprice in bulk",
          description: "Writes curated one-way fares to every route in a tier or category from one rule; with Overwrite ticked it replaces hand-set fares too.",
        },
      ],
    },
    {
      type: "links",
      items: [
        { label: "Editing a route: fares, details, stops, closed dates, archive", articleId: "tc-route-editing" },
        { label: "Vehicle classes", articleId: "tc-vehicle-classes" },
        { label: "Pick-up points", articleId: "tc-points" },
        { label: "Transfer extras", articleId: "tc-extras" },
      ],
    },
  ],
} satisfies HelpArticle;
