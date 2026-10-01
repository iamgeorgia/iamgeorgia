import type { HelpArticle } from "../../types";

import { article as extras } from "./extras";
import { article as points } from "./points";
import { article as pricingModel } from "./pricing-model";
import { article as routeCreate } from "./route-create";
import { article as routeEditing } from "./route-editing";
import { article as routesRegister } from "./routes-register";
import { article as vehicleClasses } from "./vehicle-classes";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [
  routesRegister,
  routeCreate,
  routeEditing,
  points,
  vehicleClasses,
  extras,
  pricingModel,
];
