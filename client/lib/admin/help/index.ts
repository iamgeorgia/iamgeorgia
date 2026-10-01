import { articles as bookings } from "./articles/bookings";
import { articles as destinations } from "./articles/destinations";
import { articles as dispatch } from "./articles/dispatch";
import { articles as fleetDrivers } from "./articles/fleet-drivers";
import { articles as gettingStarted } from "./articles/getting-started";
import { articles as hotels } from "./articles/hotels";
import { articles as media } from "./articles/media";
import { articles as packages } from "./articles/packages";
import { articles as partners } from "./articles/partners";
import { articles as publishing } from "./articles/publishing";
import { articles as reference } from "./articles/reference";
import { articles as services } from "./articles/services";
import { articles as tours } from "./articles/tours";
import { articles as transfersCatalogue } from "./articles/transfers-catalogue";
import { helpCategories, helpCategoryById } from "./categories";
import { helpArticlePath, resolveHelpFallback, resolveHelpForPath } from "./routes";
import type {
  HelpArticle,
  HelpCategory,
  HelpCategoryId,
  HelpLinkTargets,
  HelpMatch,
  HelpRole,
} from "./types";

/**
 * The registry: every article, assembled from the category folders.
 *
 * Imported by the help pages on the server and, lazily, by the contextual
 * Help button in the browser — it is the one module both ask for an article
 * by id or by path. Kept free of React and of `@/` aliases so
 * `test/help-registry.test.ts` can load it under plain Node and check that
 * every screen in the page tree has a page in the manual.
 */

/** In the hub's category order; each folder's `index.ts` fixes the order within it. */
export const helpArticles: HelpArticle[] = [
  ...gettingStarted,
  ...bookings,
  ...dispatch,
  ...destinations,
  ...hotels,
  ...tours,
  ...packages,
  ...services,
  ...transfersCatalogue,
  ...fleetDrivers,
  ...partners,
  ...media,
  ...publishing,
  ...reference,
];

const byId = new Map(helpArticles.map((article) => [article.id, article]));

export const helpArticleById = (id: string): HelpArticle | undefined => byId.get(id);

/** Which of the two audiences a signed-in role reads as. */
export const helpRoleOf = (role: string): HelpRole => (role === "DISPATCHER" ? "DISPATCHER" : "ADMIN");

export const helpArticlesFor = (role: HelpRole): HelpArticle[] =>
  helpArticles.filter((article) => article.roles.includes(role));

export const helpCategoriesFor = (role: HelpRole): HelpCategory[] =>
  helpCategories.filter((category) => category.roles.includes(role));

export const helpArticlesIn = (category: HelpCategoryId, role: HelpRole): HelpArticle[] =>
  helpArticlesFor(role).filter((article) => article.category === category);

/**
 * Every article this one links to — its `related` list and the `articleId`s
 * in its link blocks — resolved to a title and a path, filtered to what the
 * reader may open. An id that resolves to nothing is dropped rather than
 * rendered as a dead link; the registry test reports it separately.
 */
export function helpLinkTargets(article: HelpArticle, role: HelpRole): HelpLinkTargets {
  const ids = new Set<string>(article.related ?? []);
  for (const block of article.blocks) {
    if (block.type !== "links") continue;
    for (const item of block.items) if (item.articleId) ids.add(item.articleId);
  }

  const targets: HelpLinkTargets = {};
  for (const id of ids) {
    const target = byId.get(id);
    if (!target || !target.roles.includes(role)) continue;
    targets[id] = { id, title: target.title, href: helpArticlePath({ article: target }) };
  }
  return targets;
}

/** The article for a canonical admin path, or null when none claims it. */
export const helpForPath = (canonical: string): HelpMatch | null =>
  resolveHelpForPath(helpArticles, canonical);

/** The area to open when no article claims the path. Always answers. */
export const helpFallbackForPath = (canonical: string): HelpCategory =>
  resolveHelpFallback(helpCategories, canonical);

export { helpCategories, helpCategoryById };
export { helpArticlePath };
export { HELP_ROUTE_EXEMPTIONS } from "./routes";
export { quickStartFor } from "./quickStart";
export type * from "./types";
