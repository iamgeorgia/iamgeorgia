import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { SCREENS, canOpenPath, matchScreen, screenFor } from "../lib/admin/access";

/**
 * Keeps the screen table honest against the page tree.
 *
 * `requireScreen()` denies any path the table does not know, so a page added
 * without a rule would be unreachable for everyone. This turns that into a
 * test failure: every `page.tsx` under the panel must be claimed by exactly
 * one rule, and every rule must name a page that exists.
 */

const CLIENT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PANEL_ROOT = join(CLIENT_ROOT, "app", "[locale]", "(admin)", "admin", "(panel)");

function panelRoutes(dir = PANEL_ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...panelRoutes(full));
    else if (entry.name === "page.tsx") {
      const rel = relative(PANEL_ROOT, dir).split(sep).filter(Boolean).join("/");
      found.push(rel ? `/admin/${rel}` : "/admin");
    }
  }
  return found.sort();
}

describe("screen table", () => {
  const routes = panelRoutes();

  it("claims every panel page with exactly one rule", () => {
    for (const route of routes) {
      const claims = SCREENS.filter((rule) => rule.pattern === route);
      assert.equal(claims.length, 1, `${route} is claimed by ${claims.length} rules — add one to lib/admin/access.ts`);
    }
  });

  it("names no rule without a page", () => {
    const pages = new Set(routes);
    for (const rule of SCREENS) assert.ok(pages.has(rule.pattern), `${rule.pattern} has no page.tsx`);
  });

  it("resolves a concrete path to its most literal rule", () => {
    assert.equal(screenFor("/admin/tours/bookings")?.pattern, "/admin/tours/bookings");
    assert.equal(screenFor("/admin/tours/abc")?.pattern, "/admin/tours/[slug]");
    assert.equal(screenFor("/admin/hotels/x/rooms")?.pattern, "/admin/hotels/[slug]/rooms");
    assert.equal(screenFor("/admin/hotels/new")?.pattern, "/admin/hotels/new");
    assert.equal(screenFor("/admin/finance/invoices/sync-events")?.pattern, "/admin/finance/invoices/sync-events");
    assert.ok(matchScreen("/admin/hotels/[slug]", "/admin/hotels/abc"));
    assert.ok(!matchScreen("/admin/hotels/[slug]", "/admin/hotels/abc/rooms"));
  });

  it("denies a path nobody filed, whatever the viewer holds", () => {
    const everything = [...new Set(SCREENS.flatMap((rule) => (rule.capability ? [rule.capability].flat() : [])))];
    assert.equal(canOpenPath(everything, "/admin/secret-new-screen"), false);
    assert.equal(canOpenPath(everything, "/admin/hotels/x/rooms/extra"), false);
  });

  it("opens the overview, the manual and the denied page to any staff account", () => {
    for (const path of ["/admin", "/admin/help", "/admin/help/finance", "/admin/denied"]) {
      assert.ok(canOpenPath([], path), path);
    }
  });

  it("asks for the write capability on every create form", () => {
    for (const rule of SCREENS.filter((candidate) => candidate.pattern.endsWith("/new"))) {
      const needs = [rule.capability ?? []].flat();
      assert.ok(needs.length > 0, `${rule.pattern} opens to everyone`);
      assert.ok(
        needs.every((capability) => !capability.endsWith(".read")),
        `${rule.pattern} opens on a read capability: ${needs.join(", ")}`,
      );
    }
  });
});
