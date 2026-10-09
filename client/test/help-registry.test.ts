import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  HELP_ROUTE_EXEMPTIONS,
  helpArticles,
  helpCategories,
  helpForPath,
  quickStartFor,
} from "../lib/admin/help";
import { helpRoutePatterns, matchHelpRoute } from "../lib/admin/help/routes";
import { buildHelpSearchIndex, searchHelp } from "../lib/admin/help/search";
import { adminNavigation, adminSectionItems, isAdminNavSection, navigationFor } from "../lib/admin/navigation";

/**
 * Keeps the manual honest against the page tree.
 *
 * The registry is data, so most of what could go wrong with it is a matter
 * of cross-references: an article naming a section it does not have, a
 * `related` id nobody has written, two articles claiming one screen — and,
 * the one that matters most as the panel grows, a screen with no help at
 * all. Every `page.tsx` under the panel must resolve to an article, or be
 * listed as exempt, or this fails in CI.
 */

const CLIENT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PANEL_ROOT = join(CLIENT_ROOT, "app", "[locale]", "(admin)", "admin", "(panel)");

const CATEGORY_PREFIX: Record<string, string> = {
  "getting-started": "gs",
  bookings: "bk",
  dispatch: "dp",
  destinations: "ds",
  hotels: "ht",
  tours: "tr",
  packages: "pk",
  services: "sv",
  "transfers-catalogue": "tc",
  "fleet-drivers": "fd",
  partners: "pt",
  people: "pp",
  media: "md",
  publishing: "pb",
  reference: "rf",
};

/** Every panel screen as a canonical route pattern, from the folder tree. */
function panelRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const segments = relative(PANEL_ROOT, dir)
          .split(sep)
          .filter((segment) => segment && !segment.startsWith("("));
        routes.push(["/admin", ...segments].join("/"));
      }
    }
  };
  walk(PANEL_ROOT);
  return routes.sort();
}

const byId = new Map(helpArticles.map((article) => [article.id, article]));
const categoryIds = new Set(helpCategories.map((category) => category.id));

/**
 * What a dispatcher's session carries — `ROLE_CAPABILITIES.DISPATCHER` in
 * `server/lib/permissions.js`. Written out rather than imported because the
 * client never holds the role table; a change there shows up here as a test
 * to update, which is the point.
 */
const DISPATCHER_CAPABILITIES = ["catalogue.read", "dispatch.read", "dispatch.write", "notifications.read"];

/** Every screen the sidebar offers a dispatcher. */
const opsRoutes = new Set(
  navigationFor(DISPATCHER_CAPABILITIES).flatMap((group) =>
    group.entries.flatMap((entry) =>
      (isAdminNavSection(entry) ? adminSectionItems(entry) : [entry]).map((item) => item.href),
    ),
  ),
);

describe("help registry", () => {
  it("has unique, well-formed ids prefixed by their category", () => {
    const seen = new Set<string>();
    for (const article of helpArticles) {
      assert.match(article.id, /^[a-z]{2}-[a-z0-9]+(-[a-z0-9]+)*$/, `${article.id} is not kebab-case`);
      assert.ok(!seen.has(article.id), `${article.id} is declared twice`);
      seen.add(article.id);
      assert.ok(categoryIds.has(article.category), `${article.id} names unknown category ${article.category}`);
      assert.equal(
        article.id.slice(0, 2),
        CATEGORY_PREFIX[article.category],
        `${article.id} should be prefixed ${CATEGORY_PREFIX[article.category]}-`,
      );
    }
  });

  it("has a summary, keywords, blocks and at least one role on every article", () => {
    for (const article of helpArticles) {
      assert.ok(article.title.trim().length > 0, `${article.id} has no title`);
      assert.ok(article.summary.trim().length > 0, `${article.id} has no summary`);
      assert.ok(article.keywords.length >= 3, `${article.id} has fewer than three keywords`);
      assert.ok(article.blocks.length >= 1, `${article.id} has no blocks`);
      assert.ok(article.roles.length >= 1, `${article.id} has no roles`);
      assert.ok(
        helpCategories.find((category) => category.id === article.category)!.roles.some((role) => article.roles.includes(role)),
        `${article.id} is in a category none of its roles can read`,
      );
    }
  });

  it("resolves every related id and link target to an article one of its roles can read", () => {
    for (const article of helpArticles) {
      const ids = new Set(article.related ?? []);
      for (const block of article.blocks) {
        if (block.type === "links") for (const item of block.items) if (item.articleId) ids.add(item.articleId);
      }
      for (const id of ids) {
        const target = byId.get(id);
        assert.ok(target, `${article.id} links to ${id}, which does not exist`);
        assert.ok(
          target.roles.some((role) => article.roles.includes(role)),
          `${article.id} links to ${id}, which none of its readers may open`,
        );
        assert.notEqual(id, article.id, `${article.id} links to itself`);
      }
    }
  });

  it("uses unique heading ids, and points every route section at one of them", () => {
    for (const article of helpArticles) {
      const headings = article.blocks.flatMap((block) => (block.type === "heading" ? [block.id] : []));
      assert.equal(new Set(headings).size, headings.length, `${article.id} repeats a heading id`);
      for (const heading of headings) {
        assert.match(heading, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${article.id} heading id "${heading}" is not kebab-case`);
      }
      for (const { pattern, section } of helpRoutePatterns(article)) {
        assert.match(pattern, /^\/admin(\/(\[[a-z]+\]|[a-z0-9-]+))*$/, `${article.id} route "${pattern}" is malformed`);
        if (section) assert.ok(headings.includes(section), `${article.id} maps ${pattern} to missing section #${section}`);
      }
    }
  });

  it("never lets two articles claim the same screen", () => {
    const claims = new Map<string, string>();
    for (const article of helpArticles) {
      for (const { pattern } of helpRoutePatterns(article)) {
        const other = claims.get(pattern);
        assert.ok(!other || other === article.id, `${pattern} is claimed by both ${other} and ${article.id}`);
        claims.set(pattern, article.id);
      }
    }
  });

  it("has an article for every screen in the panel, and no route without a screen", () => {
    const screens = panelRoutes();
    const exempt = new Set(HELP_ROUTE_EXEMPTIONS);

    for (const screen of screens) {
      if (exempt.has(screen)) continue;
      assert.ok(helpForPath(screen), `no help article claims ${screen} — write one or list it in HELP_ROUTE_EXEMPTIONS`);
    }

    const screenSet = new Set(screens);
    for (const article of helpArticles) {
      for (const { pattern } of helpRoutePatterns(article)) {
        assert.ok(screenSet.has(pattern), `${article.id} claims ${pattern}, which has no page.tsx`);
      }
    }
  });

  it("gives every screen a dispatcher can open an article a dispatcher can read", () => {
    // The Help button resolves by path, so on an ops screen it must land on
    // an article the dispatcher is allowed to see. The reverse is fine: a
    // shared article (images, documents) may also claim admin-only screens.
    for (const article of helpArticles) {
      for (const { pattern } of helpRoutePatterns(article)) {
        const ops = [...opsRoutes].some((href) => pattern === href || pattern.startsWith(`${href}/`));
        if (!ops) continue;
        assert.ok(
          article.roles.includes("DISPATCHER"),
          `${article.id} claims ${pattern}, which a dispatcher can open, but a dispatcher cannot read it`,
        );
      }
    }
  });

  it("starts every 'where' path at the sidebar and names a real group and screen", () => {
    const groups = new Map(adminNavigation.map((group) => [group.title, group]));
    const check = (owner: string, path: string[]) => {
      if (path[0] !== "Sidebar") return; // A path may name something else, e.g. the browser.
      const group = groups.get(path[1]);
      assert.ok(group, `${owner}: "${path[1]}" is not a sidebar group`);
      const labels = group.entries.map((entry) => entry.label);
      assert.ok(labels.includes(path[2]), `${owner}: "${path[2]}" is not in the ${path[1]} group`);
    };
    for (const article of helpArticles) {
      for (const block of article.blocks) if (block.type === "where") check(article.id, block.path);
    }
    for (const role of ["ADMIN", "DISPATCHER"] as const) {
      for (const step of quickStartFor(role)) {
        check(`quick start ${role}/${step.id}`, step.where);
        assert.ok(byId.get(step.articleId), `quick start ${role}/${step.id} names missing article ${step.articleId}`);
      }
    }
  });

  it("matches routes segment by segment", () => {
    assert.ok(matchHelpRoute("/admin/hotels/[slug]/rooms", "/admin/hotels/abc123/rooms"));
    assert.ok(!matchHelpRoute("/admin/hotels/[slug]", "/admin/hotels/abc123/rooms"));
    assert.ok(!matchHelpRoute("/admin/hotels/[slug]", "/admin/hotels"));
    assert.ok(matchHelpRoute("/admin", "/admin"));
  });

  it("finds the obvious article for an obvious query", () => {
    const index = buildHelpSearchIndex(helpArticles);
    const hits = searchHelp(index, "sign in password", "ADMIN");
    assert.ok(hits.length > 0, "no hits for a query the manual certainly answers");
    assert.equal(hits[0].entry.id, "gs-signing-in");
  });
});
