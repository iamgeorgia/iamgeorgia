import type { HelpArticle } from "../../types";

import { article as documents } from "./documents";
import { article as images } from "./images";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [images, documents];
