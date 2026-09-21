/**
 * Cached `Intl` formatters.
 *
 * A formatter is cheap to call and surprisingly expensive to construct, and
 * the money and date helpers run inside list loops — a page of fifty cards
 * was building a few hundred of them per render. The key space is small: a
 * handful of locales times a handful of option sets.
 */

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

const keyOf = (locale: string, options: object | undefined) =>
  `${locale}|${options ? JSON.stringify(options) : ""}`;

export function numberFormat(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = keyOf(locale, options);
  let cached = numberFormats.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, cached);
  }
  return cached;
}

export function dateTimeFormat(
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = keyOf(locale, options);
  let cached = dateTimeFormats.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, options);
    dateTimeFormats.set(key, cached);
  }
  return cached;
}
