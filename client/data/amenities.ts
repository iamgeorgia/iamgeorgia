import type { AmenityId } from "@/types";

/**
 * Human labels for amenity keys. Icons are mapped in components/hotels/amenityIcons.tsx.
 *
 * English only — the reference a page falls back to when neither the locale's
 * dictionary nor the API has a name. A rendered label comes from
 * `amenityLabel` in lib/hotels/facilities, which tries `t.hotels.amenityLabels` first.
 */
export const amenityLabels: Record<AmenityId, string> = {
  wifi: "Free Wi-Fi",
  breakfast: "Breakfast included",
  pool: "Swimming pool",
  // Neutral on purpose: `parking` says nothing about the price, and the
  // property's note ("Paid public parking") is where the price is stated.
  parking: "Parking",
  freeParking: "Free parking",
  restaurant: "Restaurant",
  spa: "Spa & wellness",
  airConditioning: "Air conditioning",
  gym: "Fitness centre",
  bar: "Bar & lounge",
  petFriendly: "Pet friendly",
  familyRooms: "Family rooms",
  airportShuttle: "Airport shuttle",
  terrace: "Terrace",
  roomService: "Room service",
};

/** Whether the site has its own icon and label for a code the API sent. */
export const isAmenityId = (code: string): code is AmenityId =>
  Object.prototype.hasOwnProperty.call(amenityLabels, code);

/**
 * Filter chips on the hotels index.
 *
 * `freeParking`, not `parking`: the chip promises parking that costs nothing,
 * and a property with only a paid car park must not answer it.
 */
export const amenityFilters: AmenityId[] = [
  "breakfast",
  "pool",
  "spa",
  "freeParking",
  "restaurant",
  "petFriendly",
  "gym",
  "airportShuttle",
];
