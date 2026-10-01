import type { HelpArticle } from "../../types";

import { article as commonTasksAdmin } from "./common-tasks-admin";
import { article as commonTasksDispatcher } from "./common-tasks-dispatcher";
import { article as dangerousActions } from "./dangerous-actions";
import { article as glossary } from "./glossary";
import { article as searchFilters } from "./search-filters";
import { article as troubleshooting } from "./troubleshooting";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [
  searchFilters,
  commonTasksAdmin,
  commonTasksDispatcher,
  troubleshooting,
  dangerousActions,
  glossary,
];
