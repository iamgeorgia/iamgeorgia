import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { defaultLocale, isLocale, locales } from "@/lib/i18n/config";

/**
 * Locale routing.
 *
 * Next 16 renamed the `middleware` convention to `proxy`; this is the same
 * request hook under the new name.
 *
 * Three cases:
 *   /ka/tours  → serve as-is, the `[locale]` segment already matches
 *   /en/tours  → redirect to /tours, so English has exactly one canonical URL
 *   /tours     → rewrite to /en/tours internally; the address bar keeps /tours
 *
 * The rewrite is what lets English stay unprefixed without duplicating the
 * route tree. A visitor's stored choice is honoured only on the bare root, so
 * a shared link always opens in the language it names.
 */

const LOCALE_COOKIE = "iag_locale";

function preferredLocale(request: NextRequest): string {
  const stored = request.cookies.get(LOCALE_COOKIE)?.value;
  if (stored && isLocale(stored)) return stored;

  // `en-GB,en;q=0.9,ka;q=0.8` → first supported base language wins.
  const header = request.headers.get("accept-language");
  if (header) {
    const ranked = header
      .split(",")
      .map((part) => {
        const [tag, q] = part.trim().split(";q=");
        return { tag: tag.split("-")[0].toLowerCase(), q: q ? Number(q) : 1 };
      })
      .sort((a, b) => b.q - a.q);

    for (const { tag } of ranked) {
      if (isLocale(tag)) return tag;
    }
  }

  return defaultLocale;
}

/**
 * Tells the server render which page it is on.
 *
 * A Server Component has no `usePathname`, and the panel's entry check
 * (`requireScreen` in `lib/auth/session.ts`) needs the path to look up which
 * capability opens the screen. The proxy sees every request, so it stamps the
 * canonical, locale-stripped path onto the request as a header the page reads
 * back with `headers()`. Always overwritten, never trusted from the client: a
 * caller who sends their own `x-pathname` has it replaced here.
 */
const PATHNAME_HEADER = "x-pathname";

const withPathname = (request: NextRequest, canonical: string) => {
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, canonical);
  return { request: { headers } };
};

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];

  // Already prefixed with a non-default locale — serve as-is, named.
  if (first && isLocale(first) && first !== defaultLocale) {
    const rest = segments.slice(1).join("/");
    return NextResponse.next(withPathname(request, rest ? `/${rest}` : "/"));
  }

  // `/en/...` is a duplicate of the unprefixed URL. Collapse it — permanently,
  // so a search engine that finds the prefixed form transfers its signals to
  // the one address rather than treating the pair as two pages.
  if (first === defaultLocale) {
    const rest = segments.slice(1).join("/");
    const url = request.nextUrl.clone();
    url.pathname = rest ? `/${rest}` : "/";
    return NextResponse.redirect(url, 308);
  }

  // Bare root: send visitors to their own language the first time.
  if (pathname === "/") {
    const locale = preferredLocale(request);
    if (locale !== defaultLocale) {
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}`;
      return NextResponse.redirect(url);
    }
  }

  // Unprefixed path — serve the English tree without changing the URL.
  const url = request.nextUrl.clone();
  url.pathname = `/${defaultLocale}${pathname}`;
  url.search = search;
  return NextResponse.rewrite(url, withPathname(request, pathname || "/"));
}

export const config = {
  /**
   * Skip Next internals, the metadata routes Next serves from `app/`, and
   * anything with a file extension (everything under /images).
   */
  matcher: ["/((?!_next|icon.svg|sitemap.xml|robots.txt|.*\\..*).*)"],
};

export { locales };
