import type { HelpArticle } from "../../types";

import { article as applications } from "./applications";
import { article as detailReview } from "./detail-review";
import { article as lifecycle } from "./lifecycle";
import { article as register } from "./register";
import { article as registering } from "./registering";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [
  register,
  applications,
  registering,
  detailReview,
  lifecycle,
];
