import type { HelpArticle } from "../../types";

import { article as assigningADriver } from "./assigning-a-driver";
import { article as dispatchBoard } from "./dispatch-board";
import { article as legStatuses } from "./leg-statuses";
import { article as ratings } from "./ratings";
import { article as schedule } from "./schedule";
import { article as whoIsToldWhat } from "./who-is-told-what";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [
  dispatchBoard,
  assigningADriver,
  legStatuses,
  schedule,
  ratings,
  whoIsToldWhat,
];
