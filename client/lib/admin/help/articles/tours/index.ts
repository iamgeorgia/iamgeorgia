import type { HelpArticle } from "../../types";

import { article as create } from "./create";
import { article as departures } from "./departures";
import { article as detailsItinerary } from "./details-itinerary";
import { article as hub } from "./hub";
import { article as optionsPrices } from "./options-prices";
import { article as publishChecklist } from "./publish-checklist";
import { article as register } from "./register";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [
  register,
  create,
  hub,
  optionsPrices,
  departures,
  detailsItinerary,
  publishChecklist,
];
