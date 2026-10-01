import type { HelpArticle } from "../../types";

import { article as create } from "./create";
import { article as detailsPricing } from "./details-pricing";
import { article as hub } from "./hub";
import { article as kosher } from "./kosher";
import { article as parts } from "./parts";
import { article as previewQuote } from "./preview-quote";
import { article as publishChecklist } from "./publish-checklist";
import { article as register } from "./register";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [
  register,
  create,
  hub,
  parts,
  detailsPricing,
  previewQuote,
  kosher,
  publishChecklist,
];
