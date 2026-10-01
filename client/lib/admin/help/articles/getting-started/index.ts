import type { HelpArticle } from "../../types";

import { article as accounts } from "./accounts";
import { article as overview } from "./overview";
import { article as quickStartAdmin } from "./quick-start-admin";
import { article as quickStartDispatcher } from "./quick-start-dispatcher";
import { article as roles } from "./roles";
import { article as sidebarAndTopBar } from "./sidebar-and-top-bar";
import { article as signingIn } from "./signing-in";
import { article as whatIsThePanel } from "./what-is-the-panel";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [
  whatIsThePanel,
  signingIn,
  roles,
  sidebarAndTopBar,
  accounts,
  overview,
  quickStartAdmin,
  quickStartDispatcher,
];
