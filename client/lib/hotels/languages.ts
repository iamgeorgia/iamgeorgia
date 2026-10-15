import { languageLabels } from "@/lib/admin/fleet";
import { textOrNull } from "@/lib/hotels/facilities";

/**
 * The languages a property's staff speak, named in the visitor's language.
 *
 * The names come from the runtime's CLDR data rather than a dictionary: every
 * language code already has a name there in all four of the site's locales,
 * and a hand-kept list would only ever cover the codes somebody thought of.
 * The property page renders this on the server, where Node ships full ICU —
 * Georgian included — so there is no browser to disagree with it.
 */

const displayNames = new Map<string, Intl.DisplayNames | null>();

/**
 * A language-name formatter for the locale, or null when this runtime has no
 * data for it — `Intl.DisplayNames` would otherwise fall back to English
 * silently and the page would claim a translation it does not have.
 */
const languageNamesFor = (intlLocale: string): Intl.DisplayNames | null => {
  if (!displayNames.has(intlLocale)) {
    const supported = Intl.DisplayNames.supportedLocalesOf([intlLocale]).length > 0;
    displayNames.set(
      intlLocale,
      supported ? new Intl.DisplayNames([intlLocale], { type: "language", fallback: "none" }) : null,
    );
  }
  return displayNames.get(intlLocale) ?? null;
};

/** Mkhedruli is caseless in use; upper-casing it would turn it into Mtavruli capitals. */
const GEORGIAN = /^[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/;

/** CLDR names languages in lower case where the language does ("русский"); a list item starts with a capital. */
const capitalise = (name: string, intlLocale: string): string =>
  GEORGIAN.test(name) ? name : name.charAt(0).toLocaleUpperCase(intlLocale) + name.slice(1);

/**
 * A language code in the visitor's language: `ru` → "Russian", "Русский",
 * "რუსული", "רוסית".
 *
 * The runtime's names first, then the English names the driver profiles
 * already use, then the code itself — an unknown code is still a language
 * somebody on the desk speaks.
 */
export function languageName(code: string, intlLocale: string): string {
  let name: string | undefined;
  try {
    name = languageNamesFor(intlLocale)?.of(code);
  } catch {
    // Not a well-formed language tag; fall through.
  }
  if (name) return capitalise(name, intlLocale);

  const key = code.toLowerCase();
  return Object.prototype.hasOwnProperty.call(languageLabels, key)
    ? languageLabels[key as keyof typeof languageLabels]
    : code.toUpperCase();
}

/** The staff languages to list, each once, with blanks removed. */
export function staffLanguages(
  codes: readonly string[] | null | undefined,
  intlLocale: string,
): { code: string; name: string }[] {
  const seen = new Set<string>();
  const languages: { code: string; name: string }[] = [];

  for (const raw of codes ?? []) {
    const code = textOrNull(raw);
    if (!code || seen.has(code.toLowerCase())) continue;
    seen.add(code.toLowerCase());
    languages.push({ code, name: languageName(code, intlLocale) });
  }

  return languages;
}
