import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requiredFor, screenFor } from "@/lib/admin/access";
import { serverFetchOptional } from "@/lib/api/client";
import { localePath, stripLocale } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { can, homePathFor, isStaff, type Session } from "@/types/auth";

/**
 * Who the viewer is, during a server render.
 *
 * Wrapped in React's `cache` so a layout, a page and a component in the same
 * render share one call to `/api/auth/me` instead of making three. An
 * unauthenticated viewer resolves to null rather than throwing — being signed
 * out is an ordinary state, not an error.
 */
export const getSession = cache(async (): Promise<Session | null> =>
  serverFetchOptional<Session>("/api/auth/me"),
);

/**
 * Guards the admin panel.
 *
 * A convenience for layouts, not a security boundary — every admin endpoint
 * checks the role again on the server. This exists so a signed-out visitor gets
 * a sign-in screen instead of a page full of failed requests.
 */
export async function requireAdminSession(): Promise<Session> {
  const session = await getSession();
  const locale = await getLocale();

  if (!session) {
    redirect(localePath(locale, "/admin/sign-in"));
  }

  if (!isStaff(session)) {
    // Signed in, but as a partner or a driver. Their own panel is where they
    // belong.
    redirect(localePath(locale, homePathFor(session)));
  }

  return session;
}

/** The canonical path of the page being rendered, as the proxy stamped it. */
export async function currentPanelPath(): Promise<string | null> {
  const stamped = (await headers()).get("x-pathname");
  return stamped ? stripLocale(stamped) : null;
}

/**
 * The entry check every panel page runs first.
 *
 * Looks the page up in the screen table (`lib/admin/access.ts`) by the path
 * the proxy stamped on the request and sends the viewer to the denied screen
 * when their capabilities do not open it — or when the table does not know
 * the path at all, which is how a new screen stays closed until somebody
 * files it. Returns the session so the page can go on to decide its content
 * with `can()`.
 *
 * `pattern` names the screen outright for the rare page whose path the
 * header cannot carry; every ordinary page calls this with no argument.
 *
 * Like the layout's check this is a courtesy, not the boundary: the API
 * behind the screen refuses on its own. It exists so a bookmarked or
 * hand-typed address lands on one honest page rather than a shell full of
 * refusals.
 */
export async function requireScreen(pattern?: string): Promise<Session> {
  const session = await requireAdminSession();
  const canonical = pattern ?? (await currentPanelPath());
  const rule = canonical ? screenFor(canonical) : null;
  const required = requiredFor(rule);

  if (rule === null || (required.length > 0 && !can(session, ...required))) {
    const locale = await getLocale();
    const query = new URLSearchParams();
    if (canonical) query.set("for", canonical);
    for (const capability of required) query.append("needs", capability);
    redirect(localePath(locale, `/admin/denied?${query.toString()}`));
  }

  return session;
}

/**
 * The same check for a capability the page names itself — for content that
 * is more than a screen, such as a tab the table cannot see.
 */
export async function requireCapabilities(...anyOf: string[]): Promise<Session> {
  const session = await requireAdminSession();

  if (!can(session, ...anyOf)) {
    const locale = await getLocale();
    const query = new URLSearchParams();
    const canonical = await currentPanelPath();
    if (canonical) query.set("for", canonical);
    for (const capability of anyOf) query.append("needs", capability);
    redirect(localePath(locale, `/admin/denied?${query.toString()}`));
  }

  return session;
}

/** Guards the partner portal, in any partner status. */
export async function requirePartnerSession(): Promise<Session> {
  const session = await getSession();
  const locale = await getLocale();

  if (!session) {
    redirect(localePath(locale, "/portal/sign-in"));
  }

  if (!session.partner) {
    redirect(localePath(locale, homePathFor(session)));
  }

  return session;
}

/**
 * Guards the driver panel.
 *
 * A DRIVER account whose profile has not been linked yet still passes: the
 * panel renders that as its own explanation rather than bouncing the driver
 * to a sign-in screen they have just come from.
 */
export async function requireDriverSession(): Promise<Session> {
  const session = await getSession();
  const locale = await getLocale();

  if (!session) {
    redirect(localePath(locale, "/driver/sign-in"));
  }

  if (!can(session, "driver.panel")) {
    redirect(localePath(locale, homePathFor(session)));
  }

  return session;
}
