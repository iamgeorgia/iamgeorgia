import type { HelpArticle, HelpCategory, HelpMatch, HelpRoute } from "./types";

/**
 * Which article explains which screen.
 *
 * The contextual Help button on every page header asks this module what to
 * open for the path it is on. The answer comes from each article's `routes`,
 * written in the page tree's own bracket form, so the mapping reads like the
 * folder listing under `app/[locale]/(admin)/admin/(panel)/`.
 *
 * Paths arrive canonical — locale prefix already stripped, as the sidebar
 * does with `stripLocale(usePathname())` — so `/ka/admin/hotels/x` and
 * `/admin/hotels/x` resolve to the same article.
 */

/**
 * Screens that carry no Help button and need no article: a path that only
 * redirects, and the help pages themselves. Shared with the registry test so
 * the button and the coverage check can never disagree about the list.
 */
export const HELP_ROUTE_EXEMPTIONS: readonly string[] = [
  "/admin/transfers",
  "/admin/help",
  "/admin/help/[category]",
  "/admin/help/[category]/[article]",
];

const segmentsOf = (path: string): string[] => path.split("/").filter(Boolean);

const isParam = (segment: string): boolean => segment.startsWith("[") && segment.endsWith("]");

/**
 * `/admin/hotels/[slug]/rooms` matches `/admin/hotels/ckx…/rooms`: a
 * bracketed segment stands for exactly one non-empty segment, and the two
 * sides must have the same number of segments. A pattern never matches a
 * longer path — `/admin/hotels/[slug]` is not the help for the rooms screen.
 */
export function matchHelpRoute(pattern: string, canonical: string): boolean {
  const expected = segmentsOf(pattern);
  const actual = segmentsOf(canonical);
  if (expected.length !== actual.length) return false;
  return expected.every((segment, index) => isParam(segment) || segment === actual[index]);
}

const patternOf = (route: HelpRoute): string => (typeof route === "string" ? route : route.pattern);

const sectionOf = (route: HelpRoute): string | undefined =>
  typeof route === "string" ? undefined : route.section;

/** How specific a pattern is: the number of segments that are not parameters. */
const literalCount = (pattern: string): number =>
  segmentsOf(pattern).filter((segment) => !isParam(segment)).length;

/**
 * The article for a canonical admin path, or null when none claims it.
 *
 * When two patterns fit, the one with more literal segments wins —
 * `/admin/tours/bookings` over a hypothetical `/admin/tours/[slug]` — and
 * equal specificity falls back to declaration order. The registry test
 * refuses two articles claiming the same pattern, so a tie never decides
 * anything in practice.
 */
export function resolveHelpForPath(articles: HelpArticle[], canonical: string): HelpMatch | null {
  let best: { match: HelpMatch; score: number } | null = null;

  for (const article of articles) {
    for (const route of article.routes ?? []) {
      const pattern = patternOf(route);
      if (!matchHelpRoute(pattern, canonical)) continue;
      const score = literalCount(pattern);
      if (best === null || score > best.score) {
        best = { match: { article, section: sectionOf(route) }, score };
      }
    }
  }

  return best?.match ?? null;
}

/**
 * The area a path belongs to when no article claims it. Always answers with
 * something: the Help button must never open on nothing. The longest
 * matching prefix wins, so `/admin/transfers/fleet` finds "Fleet & drivers"
 * rather than whichever entry happened to list `/admin` first; `/admin` on
 * its own matches only the overview.
 */
export function resolveHelpFallback(categories: HelpCategory[], canonical: string): HelpCategory {
  let best: { category: HelpCategory; length: number } | null = null;

  for (const category of categories) {
    for (const prefix of category.pathPrefixes) {
      const hit =
        prefix === "/admin"
          ? canonical === "/admin"
          : canonical === prefix || canonical.startsWith(`${prefix}/`);
      if (hit && (best === null || prefix.length > best.length)) {
        best = { category, length: prefix.length };
      }
    }
  }

  return best?.category ?? categories[0];
}

/** Every pattern an article claims, with its section — for the test and the hub. */
export function helpRoutePatterns(article: HelpArticle): { pattern: string; section?: string }[] {
  return (article.routes ?? []).map((route) => ({ pattern: patternOf(route), section: sectionOf(route) }));
}

/** The article page for a match, as a canonical path with its section as the hash. */
export function helpArticlePath(match: HelpMatch): string {
  const base = `/admin/help/${match.article.category}/${match.article.id}`;
  return match.section ? `${base}#${match.section}` : base;
}
