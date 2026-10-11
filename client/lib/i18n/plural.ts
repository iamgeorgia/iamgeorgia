import { localeMeta, type Locale } from "./config";
import { numberFormat } from "@/lib/intl";

/**
 * Plural selection.
 *
 * `${count} ${noun}s` is an English assumption. Russian needs three forms for
 * the same noun (1 турист / 2 туриста / 5 туристов), Hebrew has a dual, and
 * Georgian has one form for every count. A single template string cannot carry
 * that, so countable nouns are stored as a set of forms and the right one is
 * chosen at render time by `Intl.PluralRules` — which already knows the rules
 * for every locale we ship.
 */

export interface PluralForms {
  one: string;
  /** Hebrew dual. Falls back to `other` where a language has none. */
  two?: string;
  /** Russian 2–4. */
  few?: string;
  /** Russian 5+ and the teens. */
  many?: string;
  other: string;
}

/**
 * `Intl.PluralRules` is cheap to call but not free to construct, and these are
 * rendered inside list loops.
 */
const rules = new Map<string, Intl.PluralRules>();

function rulesFor(intlLocale: string): Intl.PluralRules {
  let cached = rules.get(intlLocale);
  if (!cached) {
    // Chromium has no Georgian locale data, so `ka-GE` there is the root rule
    // ("other" for everything) while the server, with full ICU, says "one"
    // for 1. Georgian's categories are English's (one / other), so English
    // rules give every runtime the same answer — and the same hydration.
    cached = new Intl.PluralRules(/^ka(-|$)/i.test(intlLocale) ? "en" : intlLocale);
    rules.set(intlLocale, cached);
  }
  return cached;
}

/** The noun alone, in the form `count` calls for. */
export function pluralForm(locale: Locale, count: number, forms: PluralForms): string {
  const category = rulesFor(localeMeta[locale].intlLocale).select(count);
  // Ordered fallback rather than a lookup: a locale can select a category the
  // forms object does not define (Georgian never asks for `few`), and landing
  // on `other` is always correct in that case.
  switch (category) {
    case "one":
      return forms.one;
    case "two":
      return forms.two ?? forms.other;
    case "few":
      return forms.few ?? forms.other;
    case "many":
      return forms.many ?? forms.other;
    default:
      return forms.other;
  }
}

/**
 * The count and the noun together — "3 travellers", "3 туриста".
 *
 * The number is formatted for the locale too, so a four-figure count reads
 * 1,240 in English and 1 240 in Russian.
 */
export function plural(locale: Locale, count: number, forms: PluralForms): string {
  const value = numberFormat(localeMeta[locale].intlLocale).format(count);
  return `${value} ${pluralForm(locale, count, forms)}`;
}
