import { numberFormat } from "./intl";

/** Small, dependency-free helpers shared across components. */

/** Joins conditional class names. Deliberately tiny — no runtime class merging. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Indicative prices only — this prototype never transacts.
 *
 * `intlLocale` comes from `getI18n()` / `useI18n()`, so the grouping separator
 * and the position of the currency symbol follow the reader's language:
 * $1,240 in English, 1 240 $ in Russian. It defaults to English rather than
 * being required, because a handful of call sites price things outside a
 * locale context (sitemaps, structured data) and must stay canonical.
 */
export function formatPrice(
  amount: number,
  intlLocale = "en-US",
  // GEL: the platform settles in lari and the live catalogue prices in it.
  // The remaining fixture data (tours, transfers) shows lari too rather than
  // pretending two currencies coexist on one site.
  currency = "GEL",
): string {
  return numberFormat(intlLocale, { style: "currency", currency, maximumFractionDigits: 0 }).format(
    amount,
  );
}

/** Turns a 10-point guest score into the wording travellers expect. */
export type GuestScoreKey =
  | "exceptional"
  | "excellent"
  | "veryGood"
  | "good"
  | "pleasant";

/**
 * Returns a dictionary key rather than a word — the verdict beside a guest
 * score has to be translated, and the band boundaries are the same in every
 * language.
 */
export function guestScoreLabel(score: number): GuestScoreKey {
  if (score >= 9) return "exceptional";
  if (score >= 8.5) return "excellent";
  if (score >= 8) return "veryGood";
  if (score >= 7) return "good";
  return "pleasant";
}

/** "3 days" / "1 day" without pulling in a formatting library. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Picks up to `limit` items from `items`, excluding the current slug. */
export function relatedBySlug<T extends { slug: string }>(
  items: T[],
  currentSlug: string,
  limit = 3,
): T[] {
  return items.filter((item) => item.slug !== currentSlug).slice(0, limit);
}
