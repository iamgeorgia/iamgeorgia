import { defaultLocale, isLocale, type Locale } from "./config";
import { en, type UiDictionary } from "./ui/en";
import { he } from "./ui/he";
import { ka } from "./ui/ka";
import { ru } from "./ui/ru";

/**
 * UI dictionary lookup.
 *
 * Imported statically rather than lazily: every page needs one of them, and
 * static imports keep this usable from `generateMetadata` without an await.
 * Server-only in practice — Client Components get their strings through the
 * provider, and import `fill` from `./fill` so this module never enters the
 * browser bundle.
 */
const dictionaries: Record<Locale, UiDictionary> = { en, ka, ru, he };

export function getDictionary(locale: string): UiDictionary {
  return dictionaries[isLocale(locale) ? locale : defaultLocale];
}

export { fill } from "./fill";
export type { UiDictionary };
