import { articles as bookings } from "./articles/bookings";
import { articles as destinations } from "./articles/destinations";
import { articles as dispatch } from "./articles/dispatch";
import { articles as fleetDrivers } from "./articles/fleet-drivers";
import { articles as gettingStarted } from "./articles/getting-started";
import { articles as hotels } from "./articles/hotels";
import { articles as media } from "./articles/media";
import { articles as packages } from "./articles/packages";
import { articles as finance } from "./articles/finance";
import { articles as partners } from "./articles/partners";
import { articles as people } from "./articles/people";
import { articles as publishing } from "./articles/publishing";
import { articles as reference } from "./articles/reference";
import { articles as services } from "./articles/services";
import { articles as tours } from "./articles/tours";
import { articles as transfersCatalogue } from "./articles/transfers-catalogue";
import { canOpenPattern } from "../access";
import { adminGroupItems, adminNavigation, canOpen } from "../navigation";
import { helpCategories, helpCategoryById } from "./categories";
import { helpArticlePath, resolveHelpFallback, resolveHelpForPath } from "./routes";
import type {
  HelpArticle,
  HelpCategory,
  HelpCategoryId,
  HelpLinkTargets,
  HelpMatch,
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
  ...finance,
  ...people,
  ...media,
  ...publishing,
  ...reference,
];

const byId = new Map(helpArticles.map((article) => [article.id, article]));

export const helpArticleById = (id: string): HelpArticle | undefined => byId.get(id);

/**
 * Who may read an article: whoever is offered the screen it explains.
 *
 * Resolved from the article's `routes`: each pattern is matched to the
 * sidebar item it sits under (the longest `href` that prefixes it), and the
 * article is readable when any of those items is offered to the viewer —
 * the same rule that puts the screen in their sidebar. A pattern no sidebar
 * item claims (a detail page under a redirect, a terms screen) falls back to
 * the screen table. An article with no routes is background reading and is
 * open to everyone.
 */
const navItems = adminNavigation.flatMap(adminGroupItems).filter((item) => item.href !== "/admin");

const itemFor = (pattern: string) =>
  navItems
    .filter((item) => pattern === item.href || pattern.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

const patternOffered = (pattern: string, capabilities: readonly string[]): boolean => {
  const item = itemFor(pattern);
  return item ? canOpen(item, capabilities) : canOpenPattern(capabilities, pattern);
};

export const helpReadable = (article: HelpArticle, capabilities: readonly string[]): boolean =>
  !article.routes?.length ||
  article.routes.some((route) => patternOffered(typeof route === "string" ? route : route.pattern, capabilities));

export const helpArticlesFor = (capabilities: readonly string[]): HelpArticle[] =>
  helpArticles.filter((article) => helpReadable(article, capabilities));

/** The areas with at least one article this viewer may read, in hub order. */
export const helpCategoriesFor = (capabilities: readonly string[]): HelpCategory[] => {
  const readable = helpArticlesFor(capabilities);
  return helpCategories.filter((category) => readable.some((article) => article.category === category.id));
};

export const helpArticlesIn = (category: HelpCategoryId, capabilities: readonly string[]): HelpArticle[] =>
  helpArticlesFor(capabilities).filter((article) => article.category === category);

/**
 * Every article this one links to — its `related` list and the `articleId`s
 * in its link blocks — resolved to a title and a path, filtered to what the
 * reader may open. An id that resolves to nothing is dropped rather than
 * rendered as a dead link; the registry test reports it separately.
 */
export function helpLinkTargets(article: HelpArticle, capabilities: readonly string[]): HelpLinkTargets {
  const ids = new Set<string>(article.related ?? []);
  for (const block of article.blocks) {
    if (block.type !== "links") continue;
    for (const item of block.items) if (item.articleId) ids.add(item.articleId);
  }

  const targets: HelpLinkTargets = {};
  for (const id of ids) {
    const target = byId.get(id);
    if (!target || !helpReadable(target, capabilities)) continue;
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
export { quickStartFor, quickStartTitle } from "./quickStart";
export type * from "./types";
