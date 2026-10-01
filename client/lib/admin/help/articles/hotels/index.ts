import type { HelpArticle } from "../../types";

import { article as create } from "./create";
import { article as detailsLocation } from "./details-location";
import { article as hub } from "./hub";
import { article as inventoryPricing } from "./inventory-pricing";
import { article as kosher } from "./kosher";
import { article as publishChecklist } from "./publish-checklist";
import { article as register } from "./register";
import { article as roomsRates } from "./rooms-rates";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [
  register,
  create,
  hub,
  roomsRates,
  inventoryPricing,
  detailsLocation,
  kosher,
  publishChecklist,
];
