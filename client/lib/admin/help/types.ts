/**
 * The shape of the admin help content.
 *
 * Help is data, not markup: an article is a list of typed blocks, and one
 * renderer (`components/admin/help/HelpBlocks.tsx`) decides how each block
 * looks. That keeps eighty articles in one voice, lets `tsc` reject a typo in
 * a category id, makes every sentence greppable, and lets the same article
 * render on a page and inside a dialog without a second copy.
 *
 * Two constraints on everything under `lib/admin/help/`, so the registry can
 * be loaded by plain Node in `test/help-registry.test.ts`:
 *
 * 1. Relative imports only, and `import type` for anything from this file —
 *    Node strips types but does not resolve an alias, and a type-only import
 *    written as a value import would ask the runtime for an export that does
 *    not exist.
 * 2. No `enum`, no `namespace`, no parameter properties — the parts of
 *    TypeScript that need a transform rather than an erasure.
 */

/**
 * Who may read what is not written on the articles. An article is readable by
 * whoever is offered the screen it explains — resolved from its `routes`
 * against the navigation and screen tables by `helpReadable` in `index.ts` —
 * and an article with no routes (a glossary, the roles chapter) by everyone.
 * That way a role made in the Roles editor reads exactly the manual for the
 * screens it can open, with nothing to maintain here.
 */

export type HelpCategoryId =
  | "getting-started"
  | "bookings"
  | "dispatch"
  | "destinations"
  | "hotels"
  | "tours"
  | "packages"
  | "services"
  | "transfers-catalogue"
  | "fleet-drivers"
  | "partners"
  | "people"
  | "finance"
  | "media"
  | "publishing"
  | "reference";

/**
 * Icons by name rather than by import. A lucide component is a `forwardRef`
 * object that cannot cross the server/client boundary, and the registry must
 * stay loadable without React at all. `HelpCategoryList` owns the lookup.
 */
export type HelpIconName =
  | "compass"
  | "calendarCheck"
  | "radio"
  | "globe"
  | "bedDouble"
  | "map"
  | "boxes"
  | "conciergeBell"
  | "route"
  | "car"
  | "handshake"
  | "image"
  | "send"
  | "bookOpen"
  | "circleHelp"
  | "shieldAlert"
  | "users"
  | "wallet";

export interface HelpCategory {
  id: HelpCategoryId;
  title: string;
  /** One sentence under the title on the hub. */
  summary: string;
  iconName: HelpIconName;
  /**
   * Canonical admin paths whose screens fall back to this category when no
   * article claims them. A prefix matches the path itself and anything under
   * it; `/admin` on its own matches only exactly.
   */
  pathPrefixes: string[];
}

/** Note, Careful, Irreversible — each ships an icon and a word, never colour alone. */
export type CalloutTone = "info" | "warning" | "danger";

/**
 * One piece of an article.
 *
 * Text in any block may carry two inline forms and nothing else: `**bold**`
 * for the label of a control as it appears on screen, and `` `code` `` for a
 * status value, a URL or a reference. `HelpInline` interprets those two and
 * renders everything else verbatim, so content can never inject markup.
 */
export type HelpBlock =
  | { type: "paragraph"; text: string }
  /** A section heading. Its `id` is what a route's `section` and a hash link point at. */
  | { type: "heading"; id: string; text: string }
  /** Numbered — things done in order. */
  | { type: "steps"; items: string[] }
  /** Bulleted — things that are true together. */
  | { type: "list"; items: string[] }
  | { type: "callout"; tone: CalloutTone; title?: string; text: string }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "definitions"; items: { term: string; description: string }[] }
  /** How to reach the screen: `["Sidebar", "Inventory", "Hotels", "Images"]`. */
  | { type: "where"; path: string[] }
  /** Links out — to a screen (`href`, canonical path) or to another article (`articleId`). */
  | { type: "links"; items: { label: string; href?: string; articleId?: string }[] }
  /**
   * Reserved for a screenshot pipeline. Rendered as nothing today, so an
   * article can carry one before the image exists without breaking.
   */
  | { type: "figure"; src: string; alt: string; caption?: string };

/**
 * A route the article is the contextual help for. A string maps the whole
 * article; the object form lands the reader on one of its `heading` ids.
 * Patterns use the page tree's own bracket form: `/admin/hotels/[slug]/rooms`.
 */
export type HelpRoute = string | { pattern: string; section: string };

export interface HelpArticle {
  /** Kebab-case, prefixed with the category's short code: `ht-kosher`. */
  id: string;
  title: string;
  /** One sentence, shown in lists, in search results and under the title. */
  summary: string;
  category: HelpCategoryId;
  routes?: HelpRoute[];
  /** Words a reader might type that the title does not contain. */
  keywords: string[];
  /** Ids of articles worth reading next. */
  related?: string[];
  blocks: HelpBlock[];
}

/** What a path resolves to: an article, possibly opened at one of its sections. */
export interface HelpMatch {
  article: HelpArticle;
  section?: string;
}

/**
 * Where a link to another article goes. Resolved by the registry before an
 * article is rendered, so the renderer — a client component — never has to
 * carry the registry itself to turn an id into a title and a path.
 */
export interface HelpLinkTarget {
  id: string;
  title: string;
  /** Canonical, unprefixed: the renderer runs it through `useLocalePath()`. */
  href: string;
}

export type HelpLinkTargets = Record<string, HelpLinkTarget>;

/** One row of a role's Quick Start checklist. */
export interface QuickStartStep {
  id: string;
  title: string;
  summary: string;
  /** The screen to open — a canonical admin path. */
  href: string;
  articleId: string;
  where: string[];
  /** Any one of these makes the step the reader's; absent means everyone. */
  capability?: string | string[];
}
