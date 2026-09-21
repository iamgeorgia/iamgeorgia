"use client";

import { createContext, useContext, useMemo } from "react";

import { SITE_NAMESPACES, type ClientDictionary } from "./client";
import { defaultLocale, localeMeta, localePath, type Locale } from "./config";

/**
 * Locale access for Client Components.
 *
 * Server Components read the locale straight from `next/root-params`, which is
 * unavailable on the client — so the root layout resolves it once on the
 * server and hands it down through `LocaleProvider`. The strings come
 * separately, from `DictionaryProvider` in each route group's layout: what a
 * Server Component passes to a Client Component is serialised into the page,
 * and the root layout serves the admin panel and the driver app as well as
 * the site, so it must not carry the site's copy for them. See
 * `lib/i18n/client.ts` for which namespaces each group provides.
 */

interface LocaleValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  /** For `Intl.NumberFormat` / `Intl.DateTimeFormat` — mirrors `getI18n()`. */
  intlLocale: string;
}

interface LocaleContextValue extends LocaleValue {
  t: ClientDictionary;
}

const LocaleContext = createContext<LocaleValue | null>(null);
const DictionaryContext = createContext<ClientDictionary | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo<LocaleValue>(
    () => ({ locale, dir: localeMeta[locale].dir, intlLocale: localeMeta[locale].intlLocale }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Throws, in development, on a read of a namespace this group did not provide.
 *
 * The type says every Client Component sees `ClientDictionary`; a group that
 * provides a smaller set is trusting that nothing under it reads the rest.
 * Reading a missing namespace would otherwise surface as "cannot read
 * properties of undefined" somewhere inside a component, which says nothing
 * about the cause. Only the known namespace names are checked, so React's
 * own probing of objects (`$$typeof`, `then`) passes through untouched.
 */
function guarded(dictionary: Partial<ClientDictionary>): ClientDictionary {
  if (process.env.NODE_ENV === "production") return dictionary as ClientDictionary;

  const known = new Set<string>(SITE_NAMESPACES);

  return new Proxy(dictionary, {
    get(target, key, receiver) {
      if (typeof key === "string" && known.has(key) && !(key in target)) {
        throw new Error(
          `Dictionary namespace "${key}" is not provided to this route group. ` +
            "Add it to the DictionaryProvider in the group's layout (see lib/i18n/client.ts).",
        );
      }
      return Reflect.get(target, key, receiver) as unknown;
    },
  }) as ClientDictionary;
}

export function DictionaryProvider({
  dictionary,
  children,
}: {
  dictionary: Partial<ClientDictionary>;
  children: React.ReactNode;
}) {
  const value = useMemo(() => guarded(dictionary), [dictionary]);

  return <DictionaryContext.Provider value={value}>{children}</DictionaryContext.Provider>;
}

function useLocaleValue(): LocaleValue {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error("useI18n must be used inside <LocaleProvider>");
  }
  return value;
}

export function useI18n(): LocaleContextValue {
  const locale = useLocaleValue();
  const t = useContext(DictionaryContext);
  if (!t) {
    throw new Error(
      "useI18n needs a <DictionaryProvider>; the route group's layout must render one",
    );
  }
  return { ...locale, t };
}

/**
 * Prefixes a canonical path with the active locale.
 *
 * Every client-side `Link` must use this. A raw `href="/tours"` would drop a
 * Georgian reader back into English mid-journey, which is the single easiest
 * way to break a localised site.
 *
 * Needs only the locale, so it works under any group — including one that
 * provides no strings at all.
 */
export function useLocalePath(): (path: string) => string {
  const { locale } = useLocaleValue();
  return (path: string) => localePath(locale, path);
}

export { defaultLocale, localePath };
