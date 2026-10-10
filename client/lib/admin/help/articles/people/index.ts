import type { HelpArticle } from "../../types";

import { article as auditLog } from "./audit-log";
import { article as roles } from "./roles";
import { article as staff } from "./staff";

/** In reading order — the hub lists a category's articles as given here. */
export const articles: HelpArticle[] = [staff, roles, auditLog];
