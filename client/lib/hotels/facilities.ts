import { amenityLabels, isAmenityId } from "@/data/amenities";
import type { UiDictionary } from "@/lib/i18n/ui/en";
import type { HotelFacility } from "@/types";

/**
 * Turning the API's facility rows into what a page prints.
 *
 * Kept out of the components because three surfaces have to agree — the
 * property page, its structured data and the list card — and a facility that
 * reads "Parking" in one place and "Free parking" in another is a claim about
 * the price nobody made.
 *
 * The rule that matters: **nothing is dropped for being unfamiliar.** A code
 * the site has no copy for still renders, under the API's name or, failing
 * that, a readable form of the code.
 */

type Labels = Pick<UiDictionary, "hotels">;

/** A trimmed string, or null for null, undefined and whitespace. */
export const textOrNull = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

/** A dictionary entry by code, without reaching `constructor` and friends. */
const own = (record: object, key: string): string | null =>
  Object.prototype.hasOwnProperty.call(record, key)
    ? textOrNull((record as Record<string, string>)[key])
    : null;

/** The current locale's own word for a code: general amenities, then kosher facilities. */
const dictionaryLabel = (t: Labels, code: string): string | null =>
  own(t.hotels.amenityLabels, code) ?? own(t.hotels.kosher.features, code);

/**
 * A code as a reader would write it: `porterService` → "Porter service",
 * `reception24h` → "Reception 24h", `ski_storage` → "Ski storage".
 */
export function formatAmenityCode(code: string): string {
  const words = code
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/[\s_.-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/**
 * The label for one facility, in this order:
 *
 *   1. the current locale's dictionary entry for the code;
 *   2. the API's name — already in the requested locale where the server has
 *      a translation for it;
 *   3. the English reference in `data/amenities`;
 *   4. the code, made readable.
 *
 * The dictionary comes first so the English reference can never override a
 * translation, and so a known code reads the same on the card (which has no
 * API name) as on the property page (which has one).
 */
export function amenityLabel(t: Labels, code: string, apiName?: string | null): string {
  return (
    dictionaryLabel(t, code) ??
    textOrNull(apiName) ??
    (isAmenityId(code) ? amenityLabels[code] : null) ??
    formatAmenityCode(code)
  );
}

/** One row of the facilities list, ready to print. */
export interface FacilityView {
  code: string;
  label: string;
  /** The API's icon name, for `amenityIcon`; null when the row had none. */
  icon: string | null;
  /** The property's remark, verbatim; null when there is nothing to add. */
  note: string | null;
}

/**
 * Labelled rows, in the API's order, each facility once.
 *
 * Deduplicated twice: by code, and by what the visitor would read — two codes
 * that resolve to the same label with the same note are the same line. A note
 * that only repeats its label is dropped rather than printed twice.
 */
export function facilityViews(t: Labels, facilities: readonly HotelFacility[]): FacilityView[] {
  const codes = new Set<string>();
  const lines = new Set<string>();
  const views: FacilityView[] = [];

  for (const facility of facilities) {
    const code = textOrNull(facility.code);
    if (!code || codes.has(code)) continue;
    codes.add(code);

    const label = amenityLabel(t, code, facility.name);
    const rawNote = textOrNull(facility.note);
    const note =
      rawNote && rawNote.toLocaleLowerCase() !== label.toLocaleLowerCase() ? rawNote : null;

    const line = `${label.toLocaleLowerCase()}\n${note?.toLocaleLowerCase() ?? ""}`;
    if (lines.has(line)) continue;
    lines.add(line);

    views.push({ code, label, icon: textOrNull(facility.icon), note });
  }

  return views;
}

/**
 * The few codes a list card has room for.
 *
 * Codes the locale's dictionary can name go first, so a card reads in the
 * visitor's language wherever it can; the rest follow rather than vanish.
 * Kosher facilities are left out — the card has its own kosher line for them,
 * and the property page lists them in full.
 */
export function cardAmenityCodes(t: Labels, codes: readonly string[], limit: number): string[] {
  const unique = [...new Set(codes.map((code) => code.trim()).filter(Boolean))].filter(
    (code) => !own(t.hotels.kosher.features, code),
  );
  const named = unique.filter((code) => own(t.hotels.amenityLabels, code));
  const rest = unique.filter((code) => !own(t.hotels.amenityLabels, code));
  return [...named, ...rest].slice(0, limit);
}
