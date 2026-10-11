/**
 * Cached `Intl` formatters.
 *
 * A formatter is cheap to call and surprisingly expensive to construct, and
 * the money and date helpers run inside list loops — a page of fifty cards
 * was building a few hundred of them per render. The key space is small: a
 * handful of locales times a handful of option sets.
 *
 * Georgian is the exception to "ask ICU". Node ships full ICU and formats
 * `ka-GE` as "15 ნოე. 2026" and "1 234,50 ₾"; Chromium ships no Georgian
 * locale data at all (`supportedLocalesOf(['ka'])` is empty) and silently
 * falls back to "15 Nov 2026" and "GEL 1,234.50". A Server Component then
 * renders one string and the browser hydrates another — React error #418 on
 * every Georgian page with a price or a date. So for `ka` the formatter is
 * built on `en-GB`, which every runtime has, and the month and weekday names,
 * the grouping and the decimal mark are applied from the tables below. Both
 * sides of the hydration then agree, in Georgian.
 */

/** What callers use of an `Intl.NumberFormat`; the Georgian one is hand-built to the same shape. */
export interface NumberFormatter {
  format(value: number | bigint): string;
  formatToParts(value: number | bigint): Intl.NumberFormatPart[];
  resolvedOptions(): Intl.ResolvedNumberFormatOptions;
}
export interface DateTimeFormatter {
  format(date?: Date | number): string;
  formatToParts(date?: Date | number): Intl.DateTimeFormatPart[];
  resolvedOptions(): Intl.ResolvedDateTimeFormatOptions;
}

const numberFormats = new Map<string, NumberFormatter>();
const dateTimeFormats = new Map<string, DateTimeFormatter>();

const keyOf = (locale: string, options: object | undefined) =>
  `${locale}|${options ? JSON.stringify(options) : ""}`;

/** `ka`, `ka-GE`, `ka-Geor-GE`… — the language, whatever the region tag. */
const isGeorgian = (locale: string) => /^ka(-|$)/i.test(locale);

/** The locale Georgian output is built on: available everywhere, 24-hour clock, day-month order. */
const GEORGIAN_BASE = "en-GB";

// Exactly what Node's ICU answers for ka-GE, so the server-rendered strings do
// not change — only the browser now agrees with them.
const KA_MONTH_SHORT = ["იან", "თებ", "მარ", "აპრ", "მაი", "ივნ", "ივლ", "აგვ", "სექ", "ოქტ", "ნოე", "დეკ"];
const KA_MONTH_LONG = ["იანვარი", "თებერვალი", "მარტი", "აპრილი", "მაისი", "ივნისი", "ივლისი", "აგვისტო", "სექტემბერი", "ოქტომბერი", "ნოემბერი", "დეკემბერი"];
const KA_WEEKDAY_SHORT = ["კვი", "ორშ", "სამ", "ოთხ", "ხუთ", "პარ", "შაბ"];
const KA_WEEKDAY_LONG = ["კვირა", "ორშაბათი", "სამშაბათი", "ოთხშაბათი", "ხუთშაბათი", "პარასკევი", "შაბათი"];
const EN_MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EN_WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Georgian uses a space between thousands and a comma before the fraction. */
const KA_GROUP = " ";
const KA_DECIMAL = ",";
/** Symbols ICU shows for ka; anything else keeps whatever en-GB chose (€, US$, …). */
const KA_CURRENCY: Record<string, string> = { GEL: "₾" };

const georgianNumberFormat = (options?: Intl.NumberFormatOptions): NumberFormatter => {
  const base = new Intl.NumberFormat(GEORGIAN_BASE, options);

  const formatToParts = (value: number | bigint): Intl.NumberFormatPart[] => {
    const parts = base.formatToParts(value);
    const currency = parts.find((part) => part.type === "currency");
    const mapped: Intl.NumberFormatPart[] = [];

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part.type === "group") mapped.push({ type: "group", value: KA_GROUP });
      else if (part.type === "decimal") mapped.push({ type: "decimal", value: KA_DECIMAL });
      else if (part.type === "currency") {
        // en-GB puts the symbol first, possibly with a literal after it; Georgian puts it last.
        if (parts[index + 1]?.type === "literal") index += 1;
      } else mapped.push(part);
    }

    if (currency) {
      const code = base.resolvedOptions().currency ?? "";
      mapped.push({ type: "literal", value: KA_GROUP }, { type: "currency", value: KA_CURRENCY[code] ?? currency.value });
    }

    return mapped;
  };

  return {
    format: (value) => formatToParts(value).map((part) => part.value).join(""),
    formatToParts,
    resolvedOptions: () => base.resolvedOptions(),
  };
};

const georgianDateTimeFormat = (options?: Intl.DateTimeFormatOptions): DateTimeFormatter => {
  const base = new Intl.DateTimeFormat(GEORGIAN_BASE, options);

  const translate = (part: Intl.DateTimeFormatPart): Intl.DateTimeFormatPart => {
    if (part.type === "month") {
      const short = EN_MONTH_SHORT.indexOf(part.value);
      if (short >= 0) return { type: "month", value: KA_MONTH_SHORT[short] };
      const long = EN_MONTH_LONG.indexOf(part.value);
      if (long >= 0) return { type: "month", value: KA_MONTH_LONG[long] };
      return part;
    }
    if (part.type === "weekday") {
      const short = EN_WEEKDAY_SHORT.indexOf(part.value);
      if (short >= 0) return { type: "weekday", value: KA_WEEKDAY_SHORT[short] };
      const long = EN_WEEKDAY_LONG.indexOf(part.value);
      if (long >= 0) return { type: "weekday", value: KA_WEEKDAY_LONG[long] };
      return part;
    }
    // "15 November 2026 at 13:05" — the one English word en-GB's styles add.
    if (part.type === "literal" && part.value === " at ") return { type: "literal", value: ", " };
    return part;
  };

  const formatToParts = (date?: Date | number) => base.formatToParts(date).map(translate);

  return {
    format: (date) => formatToParts(date).map((part) => part.value).join(""),
    formatToParts,
    resolvedOptions: () => base.resolvedOptions(),
  };
};

export function numberFormat(locale: string, options?: Intl.NumberFormatOptions): NumberFormatter {
  const key = keyOf(locale, options);
  let cached = numberFormats.get(key);
  if (!cached) {
    cached = isGeorgian(locale) ? georgianNumberFormat(options) : new Intl.NumberFormat(locale, options);
    numberFormats.set(key, cached);
  }
  return cached;
}

export function dateTimeFormat(locale: string, options?: Intl.DateTimeFormatOptions): DateTimeFormatter {
  const key = keyOf(locale, options);
  let cached = dateTimeFormats.get(key);
  if (!cached) {
    cached = isGeorgian(locale) ? georgianDateTimeFormat(options) : new Intl.DateTimeFormat(locale, options);
    dateTimeFormats.set(key, cached);
  }
  return cached;
}
