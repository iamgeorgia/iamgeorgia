/**
 * A position, and what the place search said about it.
 *
 * Coordinates are the part everything downstream reads — transfer pricing,
 * Shabbat sunset times, the nearest-airport recommendation, the PostGIS
 * point. The place is what a person reads instead: "Stamba Hotel, 14 Merab
 * Kostava St, Tbilisi" rather than `41.7076, 44.7867`. It is kept beside the
 * coordinates, never instead of them, and is null for anything placed by hand
 * or recorded before place search existed.
 *
 * Mirrors `placeRefSchema` in server/validation/domain.js.
 */
export interface PlaceRef {
  /** Google's place id. The one field anything looks at again. */
  placeId: string;
  /** What the place is called — a business name, a locality, an airport. */
  name: string | null;
  formattedAddress: string | null;
  /** The locality, or the nearest thing Google offered in its place. */
  city: string | null;
  /** The first-level administrative area: Imereti, Kakheti, Tbilisi. */
  region: string | null;
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode: string | null;
  /** Google's place types, e.g. `airport`, `lodging`. A hint, never a fact. */
  types: string[];
}

/**
 * What a location field holds. Both coordinates or neither — the same pair
 * rule the server and the database CHECK enforce — and a place only ever
 * alongside a pair, because an address for nowhere is nothing to store.
 */
export interface LocationValue {
  latitude: number | null;
  longitude: number | null;
  place: PlaceRef | null;
}

/** A searched door on a booking: coordinates are required, the place is not. */
export interface PlacedLocation {
  latitude: number;
  longitude: number;
  place: PlaceRef | null;
}

export const EMPTY_LOCATION: LocationValue = { latitude: null, longitude: null, place: null };
