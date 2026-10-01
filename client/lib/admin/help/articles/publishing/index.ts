import type { HelpArticle } from "../../types";

import { article as b2cVsTrade } from "./b2c-vs-trade";
import { article as checklists } from "./checklists";
import { article as slugsAndSeo } from "./slugs-and-seo";
import { article as statuses } from "./statuses";
import { article as translations } from "./translations";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [statuses, checklists, b2cVsTrade, slugsAndSeo, translations];
