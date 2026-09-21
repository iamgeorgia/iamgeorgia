/**
 * Money formatting.
 *
 * The API sends **integer minor units** with a currency beside them, and every
 * amount in the hotel module arrives that way. Nothing here should ever be
 * handed a float: the whole point of the server's convention is that 189.50
 * cannot be misrepresented, and dividing early throws that away.
 *
 * Currencies with no minor unit — JPY, KRW — have an exponent of zero, so the
 * divisor is looked up rather than assumed to be 100.
 */

import { numberFormat } from "./intl";

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XOF", "XAF"]);

const minorUnits = (currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100);

/** `52500, "GEL"` → `₾525.00`. */
export function formatMoney(
  amountCents: number,
  currency: string,
  locale = "en-GB",
  options: Intl.NumberFormatOptions = {},
): string {
  const divisor = minorUnits(currency);

  return numberFormat(locale, { style: "currency", currency, ...options }).format(
    amountCents / divisor,
  );
}

/** No decimals — for dashboard tiles and chart axes where they are noise. */
export const formatMoneyCompact = (amountCents: number, currency: string, locale = "en-GB") =>
  formatMoney(amountCents, currency, locale, {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });

/** Basis points as a percentage: `1500` → `15%`. */
export const formatBps = (bps: number) => {
  const percent = bps / 100;

  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
};

/** Percentage input back to basis points, for a form. */
export const percentToBps = (percent: number) => Math.round(percent * 100);

/**
 * A major-unit string from a form back to minor units.
 *
 * Rounds rather than truncates, so "12.005" becomes 1201 and not 1200 — a
 * truncation here is a penny the operator did not intend to give away.
 */
export const toMinorUnits = (value: string | number, currency = "GEL"): number | null => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value.replace(",", "."));

  if (!Number.isFinite(parsed)) return null;

  return Math.round(parsed * minorUnits(currency));
};

/**
 * An amount rounded to whole major units, still expressed in minor units.
 *
 * Indicative "from" prices are rendered across the site with
 * `maximumFractionDigits: 0` — a browse page shows ₾2,142, never ₾2,142.45,
 * because a figure that depends on the party and the date has no business
 * claiming a precision it does not have. Structured data must state the number
 * the visitor can see, so anything marking up a "from" price rounds it the same
 * way first. A dated quote is exact on the page and stays exact in the markup.
 */
export const roundToWholeUnits = (amountCents: number, currency = "GEL"): number => {
  const divisor = minorUnits(currency);

  return Math.round(amountCents / divisor) * divisor;
};

/** Minor units to a plain major-unit string, for populating a form field. */
export const toMajorUnits = (amountCents: number | null | undefined, currency = "GEL"): string => {
  if (amountCents === null || amountCents === undefined) return "";

  const divisor = minorUnits(currency);

  return divisor === 1 ? String(amountCents) : (amountCents / divisor).toFixed(2);
};
