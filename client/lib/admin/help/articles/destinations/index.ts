import type { HelpArticle } from "../../types";

import { article as editing } from "./editing";
import { article as register } from "./register";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [register, editing];
