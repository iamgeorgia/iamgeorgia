import type { UiDictionary } from "./ui/en";

/**
 * Which parts of the dictionary reach the browser.
 *
 * Whatever a Server Component hands to a Client Component is serialised into
 * the page — the whole `UiDictionary` used to travel with every document,
 * 25–33 KB gzipped, most of it copy that only Server Components ever read
 * (the home page, the legal pages, metadata). Each route group's layout now
 * provides just the namespaces its Client Components use, picked with
 * `pickClientDictionary`.
 *
 * `ClientDictionary` is the type Client Components see through `useI18n()`.
 * It is the public site's set, which is the largest; a group that provides
 * less relies on the development-time guard in `provider.tsx` to catch a read
 * outside what it supplied. TypeScript catches a read outside this list.
 */
export const SITE_NAMESPACES = [
  "a11y",
  "actions",
  "booking",
  "common",
  "cookieNotice",
  "error",
  "footer",
  "hotels",
  "nav",
  "orders",
  "packages",
  "share",
  "tours",
  "transfers",
  "units",
] as const satisfies readonly (keyof UiDictionary)[];

export type ClientNamespace = (typeof SITE_NAMESPACES)[number];

export type ClientDictionary = Pick<UiDictionary, ClientNamespace>;

/**
 * The admin panel and the partner portal are written in English, but they
 * render the shared booking, tour and order components, which read their
 * strings through the provider. No site chrome, no transfers search.
 */
export const PANEL_NAMESPACES = [
  "a11y",
  "actions",
  "booking",
  "common",
  "error",
  "hotels",
  "orders",
  "packages",
  "tours",
  "units",
] as const satisfies readonly ClientNamespace[];

/** The driver app reads almost nothing; the floor is what a dialog needs. */
export const DRIVER_NAMESPACES = ["a11y", "actions", "common", "error"] as const satisfies readonly ClientNamespace[];

export function pickClientDictionary<K extends ClientNamespace>(
  dictionary: UiDictionary,
  namespaces: readonly K[],
): Pick<UiDictionary, K> {
  const picked = {} as Pick<UiDictionary, K>;
  for (const namespace of namespaces) picked[namespace] = dictionary[namespace];
  return picked;
}
