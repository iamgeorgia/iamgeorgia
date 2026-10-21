import { amenityFilters } from "@/data/amenities";
import { propertyTypes } from "@/data/hotels";
import type { AmenityId, Hotel, PropertyType } from "@/types";

/**
 * The catalogue filter model: what can be asked, what an answer counts as, and
 * which questions this particular list is able to answer.
 *
 * Kept out of the panel component because the three have to agree and used to
 * not. The count was computed in the explorer while the filtering happened in
 * the panel, and they drifted: the budget counted as active below one
 * threshold and filtered from another, so narrowing the budget removed
 * properties while the panel insisted nothing was set — and hid the "clear
 * all" that would have undone it. One module, one source of truth.
 */

/**
 * The kosher facility chips.
 *
 * The six an agency actually filters on, not all twenty-one — a filter panel
 * with every facility in it stops being a filter and becomes a checklist. The
 * rest are still visible on the property page, which is where the detail
 * belongs.
 */
export const KOSHER_FACILITY_FILTERS = [
  "kosherRestaurant",
  "kosherBreakfast",
  "shabbatElevator",
  "shabbatMeals",
  "synagogueOnSite",
  "mikvehOnSite",
] as const;

const SCORE_OPTIONS = [8, 9] as const;
const STAR_OPTIONS = [3, 4, 5] as const;

export interface HotelFilterState {
  /** Destination slugs. Empty means every destination in the catalogue. */
  destinations: string[];
  propertyTypes: PropertyType[];
  amenities: AmenityId[];
  /**
   * `null` means "any".
   *
   * Not a constant ceiling: the catalogue is priced by the API in lari and the
   * dearest property moves, so a hard-coded top of the range would either cut
   * real properties off the slider or leave its last third empty.
   */
  maxPrice: number | null;
  /** Minimum guest score out of 10. 0 means "any". */
  minScore: number;
  /** Minimum official star classification. 0 means "any". */
  minStars: number;
  /**
   * The two kosher filters that are not facilities.
   *
   * `kosherOnly` asks for a property that offers kosher services at all;
   * `kosherCertified` asks for one where a certificate has been verified and
   * has not lapsed. They are separate because they mean different things, and
   * collapsing them into one chip would let a property with no certificate
   * answer a search for a certified one.
   */
  kosherOnly: boolean;
  kosherCertified: boolean;
  /** Facility codes — the same mechanism as `amenities`, different vocabulary. */
  kosherFacilities: string[];
}

export const defaultFilters: HotelFilterState = {
  destinations: [],
  propertyTypes: [],
  amenities: [],
  maxPrice: null,
  minScore: 0,
  minStars: 0,
  kosherOnly: false,
  kosherCertified: false,
  kosherFacilities: [],
};

/** How many filters are on — what the mobile button and the "clear all" read. */
export function countActiveFilters(filters: HotelFilterState): number {
  return (
    filters.destinations.length +
    filters.propertyTypes.length +
    filters.amenities.length +
    filters.kosherFacilities.length +
    (filters.kosherOnly ? 1 : 0) +
    (filters.kosherCertified ? 1 : 0) +
    (filters.minScore > 0 ? 1 : 0) +
    (filters.minStars > 0 ? 1 : 0) +
    (filters.maxPrice === null ? 0 : 1)
  );
}

/** Does one property survive the panel? */
export function matchesFilters(hotel: Hotel, filters: HotelFilterState): boolean {
  if (filters.destinations.length && !filters.destinations.includes(hotel.destinationSlug)) {
    return false;
  }
  if (filters.propertyTypes.length && !filters.propertyTypes.includes(hotel.propertyType)) {
    return false;
  }
  if (filters.minScore && hotel.guestScore < filters.minScore) return false;
  if (filters.minStars && hotel.starRating < filters.minStars) return false;
  // A property whose lowest rate has not been loaded prices as 0. That is not
  // "free", it is unknown, and dropping it because the budget slider moved
  // would be inventing a price for it.
  if (filters.maxPrice !== null && hotel.priceFrom > 0 && hotel.priceFrom > filters.maxPrice) {
    return false;
  }
  // Matched on exact codes, against the unfiltered list. "Free parking" asks
  // for `freeParking`; a property with only `parking` — a car park, usually
  // paid — does not answer it, wherever either code sits in the array.
  if (filters.amenities.length) {
    const codes = hotel.amenityCodes ?? hotel.amenities;
    if (!filters.amenities.every((amenity) => codes.includes(amenity))) return false;
  }
  // A property with no kosher record fails every kosher filter, which is the
  // point: absence of the record means the property does not offer kosher
  // services, so there is nothing to match.
  if (filters.kosherOnly && !hotel.kosher?.offersKosher) return false;
  // Read straight off the server's derived flag. Never inferred from the
  // facility list, and never recomputed from an expiry date against the
  // browser's clock.
  if (filters.kosherCertified && !hotel.kosher?.certified) return false;
  if (filters.kosherFacilities.length) {
    const codes = hotel.amenityCodes ?? hotel.amenities;
    if (!filters.kosherFacilities.every((code) => codes.includes(code))) return false;
  }
  return true;
}

/**
 * The questions this catalogue can actually answer.
 *
 * A chip no property in the list satisfies is not a filter, it is a guaranteed
 * empty state — and the static vocabularies behind these rows are deliberately
 * wider than any one page: five property types, eight amenity chips, six kosher
 * facilities. So each row is cut to what is in front of the visitor, and a row
 * left with nothing to choose between is not drawn at all.
 */
export interface HotelFilterFacets {
  destinations: { slug: string; name: string }[];
  propertyTypes: PropertyType[];
  amenities: AmenityId[];
  scores: number[];
  stars: number[];
  kosherFacilities: string[];
  offersKosher: boolean;
  offersCertified: boolean;
  /** `null` when no property in the list carries a price. */
  priceBounds: { min: number; max: number } | null;
}

export function buildFacets(hotels: Hotel[]): HotelFilterFacets {
  const destinations = new Map<string, string>();
  const types = new Set<string>();
  const codes = new Set<string>();
  const prices: number[] = [];
  let offersKosher = false;
  let offersCertified = false;

  for (const hotel of hotels) {
    if (hotel.destinationSlug && !destinations.has(hotel.destinationSlug)) {
      destinations.set(hotel.destinationSlug, hotel.location || hotel.destinationSlug);
    }
    types.add(hotel.propertyType);
    for (const code of hotel.amenityCodes ?? hotel.amenities) codes.add(code);
    if (hotel.priceFrom > 0) prices.push(hotel.priceFrom);
    if (hotel.kosher?.offersKosher) offersKosher = true;
    if (hotel.kosher?.certified) offersCertified = true;
  }

  // A threshold only earns a chip when the catalogue straddles it: if every
  // property already scores 9+, neither "9+" nor "8+" narrows anything.
  const straddles = (read: (hotel: Hotel) => number, threshold: number) =>
    hotels.some((hotel) => read(hotel) >= threshold) &&
    hotels.some((hotel) => read(hotel) < threshold);

  return {
    destinations: [...destinations]
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    // Canonical order, not encounter order — these vocabularies read as
    // designed lists, and reshuffling them per page would make the panel feel
    // like it moves under the cursor.
    propertyTypes: propertyTypes.filter((type) => types.has(type)),
    amenities: amenityFilters.filter((amenity) => codes.has(amenity)),
    scores: SCORE_OPTIONS.filter((score) => straddles((hotel) => hotel.guestScore, score)),
    stars: STAR_OPTIONS.filter((star) => straddles((hotel) => hotel.starRating, star)),
    kosherFacilities: KOSHER_FACILITY_FILTERS.filter((code) => codes.has(code)),
    offersKosher,
    offersCertified,
    priceBounds: prices.length
      ? {
          min: Math.floor(Math.min(...prices) / 10) * 10,
          max: Math.ceil(Math.max(...prices) / 10) * 10,
        }
      : null,
  };
}
