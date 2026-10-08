import type { LocationValue, PlaceRef } from "@/types/geo";
import type { TransferPointKind } from "@/types/transfer";

/**
 * Turning what Google returns into what the forms and the API speak.
 *
 * Pure functions over plain shapes, on purpose: the Places library only exists
 * in a browser with the Maps script loaded, and this module is exercised by
 * `test/geo-place.test.ts` under plain Node. Anything that needs `google.*` at
 * runtime lives in components/geo; here the namespace appears only in type
 * positions, which the compiler erases.
 */

/** The middle of Georgia, zoomed to show the whole country. */
export const GEORGIA_CENTER = { lat: 42.0, lng: 43.5 };

/**
 * A box around Georgia, used to *bias* the place search — Georgian results
 * first — without restricting it. A Yerevan airport or a Trabzon hotel is
 * still a legitimate pick-up point.
 */
export const GEORGIA_BOUNDS = { north: 43.6, south: 41.0, east: 46.8, west: 40.0 };

/**
 * An address component as either API shapes it: the Places library says
 * `longText`/`shortText`, the Geocoder still says `long_name`/`short_name`.
 * Both are read so a reverse-geocoded pin and a searched place normalise
 * through the same code.
 */
export interface AddressComponentLike {
  longText?: string | null;
  shortText?: string | null;
  long_name?: string;
  short_name?: string;
  types: string[];
}

/** The subset of a Places `Place` or a Geocoder result this module reads. */
export interface PlaceLike {
  id: string;
  displayName?: string | null;
  formattedAddress?: string | null;
  addressComponents?: AddressComponentLike[] | null;
  types?: string[] | null;
}

const longOf = (component: AddressComponentLike) =>
  component.longText ?? component.long_name ?? null;

const shortOf = (component: AddressComponentLike) =>
  component.shortText ?? component.short_name ?? null;

const componentOf = (components: AddressComponentLike[], ...types: string[]) => {
  for (const type of types) {
    const found = components.find((component) => component.types.includes(type));
    if (found) return found;
  }
  return null;
};

const blankToNull = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Normalises a place.
 *
 * The city is the locality when Google names one, else the nearest thing it
 * offers: a postal town, or the second-level area (a municipality) for the
 * many Georgian places that have no locality at all. The region is the
 * first-level area — Imereti, Kakheti, Tbilisi — which is what the pick-up
 * point form wants on its "Region" line.
 */
export const placeRefFrom = (place: PlaceLike): PlaceRef => {
  const components = place.addressComponents ?? [];
  const city = componentOf(components, "locality", "postal_town", "administrative_area_level_2");
  const region = componentOf(components, "administrative_area_level_1");
  const country = componentOf(components, "country");

  return {
    placeId: place.id,
    name: blankToNull(place.displayName),
    formattedAddress: blankToNull(place.formattedAddress),
    city: blankToNull(city ? longOf(city) : null),
    region: blankToNull(region ? longOf(region) : null),
    countryCode: blankToNull(country ? shortOf(country) : null)?.toUpperCase() ?? null,
    types: (place.types ?? []).filter(Boolean),
  };
};

/** A Places-library `Place`, after `fetchFields`. */
export const toPlaceRef = (place: google.maps.places.Place, name?: string | null): PlaceRef =>
  placeRefFrom({
    id: place.id,
    // `name` comes from the autocomplete prediction. Asking Places for
    // `displayName` instead is a Pro-tier field, and requesting one in the
    // call that closes a session bills that call at the dearest tier.
    displayName: name ?? place.displayName,
    formattedAddress: place.formattedAddress,
    addressComponents: place.addressComponents,
    types: place.types,
  });

/**
 * A Geocoder result, from reverse-geocoding a dragged pin. Geocoder results
 * have no display name, so the first line of the address stands in for one.
 */
export const geocoderResultToPlaceRef = (result: google.maps.GeocoderResult): PlaceRef =>
  placeRefFrom({
    id: result.place_id,
    displayName: result.formatted_address?.split(",")[0] ?? null,
    formattedAddress: result.formatted_address,
    addressComponents: result.address_components,
    types: result.types,
  });

/** The postal code, for the hotel address form to prefill. */
export const postalCodeOf = (components: AddressComponentLike[] | null | undefined) => {
  const found = componentOf(components ?? [], "postal_code");
  return found ? blankToNull(longOf(found)) : null;
};

/**
 * Which kind of pick-up point a place probably is, from Google's types.
 *
 * A suggestion for the form to prefill while the field is still at its
 * default — never applied over a kind the operator has chosen. Null when the
 * types say nothing useful, which is most of them.
 */
export const suggestPointKind = (types: string[]): TransferPointKind | null => {
  if (types.includes("airport")) return "AIRPORT";
  if (types.includes("train_station") || types.includes("transit_station") || types.includes("bus_station"))
    return "STATION";
  if (types.includes("lodging")) return "HOTEL";
  if (types.includes("ski_resort") || types.includes("resort_hotel")) return "RESORT";
  if (types.includes("locality") || types.includes("postal_town")) return "CITY";
  if (types.includes("tourist_attraction") || types.includes("natural_feature") || types.includes("landmark"))
    return "LANDMARK";
  return null;
};

/** `41.7151, 44.8271` — the form every list and detail screen already uses. */
export const formatCoordinates = (latitude: number, longitude: number, decimals = 4) =>
  `${latitude.toFixed(decimals)}, ${longitude.toFixed(decimals)}`;

/** A Google Maps directions link a driver's phone opens in its maps app. */
export const mapsDirectionsUrl = (latitude: number, longitude: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;

/**
 * One line naming a location for a card or a table cell: the place's name
 * and where it is when there is one, the coordinates when there is not, and
 * nothing at all when the pin is not set.
 */
export const describeLocation = (value: LocationValue): string | null => {
  if (value.latitude === null || value.longitude === null) return null;
  if (!value.place) return formatCoordinates(value.latitude, value.longitude);

  const where = [value.place.city, value.place.countryCode].filter(Boolean).join(", ");
  const name = value.place.name ?? value.place.formattedAddress;

  if (name && where && !name.includes(where)) return `${name} · ${where}`;
  return name ?? formatCoordinates(value.latitude, value.longitude);
};

/** A `LocationValue` from what a record already stores. */
export const locationOf = (record: {
  latitude: number | null;
  longitude: number | null;
  place?: PlaceRef | null;
}): LocationValue => ({
  latitude: record.latitude,
  longitude: record.longitude,
  place: record.latitude === null || record.longitude === null ? null : (record.place ?? null),
});

export const isPlaced = (value: LocationValue): value is LocationValue & { latitude: number; longitude: number } =>
  value.latitude !== null && value.longitude !== null;
