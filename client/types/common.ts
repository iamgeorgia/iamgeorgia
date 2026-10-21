/** Shared building blocks used across tours, hotels, destinations and experiences. */

export interface GalleryImage {
  src: string;
  alt: string;
}

/**
 * The amenity codes the site has its own icon, label and filter chip for, so
 * every surface renders the same icon and label for the same facility. Icon
 * mapping lives in components/hotels/amenityIcons.
 *
 * A curated subset, not the vocabulary: the API's amenity codes are open-ended
 * rows, and a code outside this union is still a facility the property has.
 * What a page displays is `HotelFacility`, keyed on a plain string; this union
 * only decides which codes get the site's own treatment.
 *
 * `parking` is a car park of any kind, usually paid; `freeParking` is the one
 * that costs nothing. They are separate codes on the server and must not be
 * read as each other.
 */
export type AmenityId =
  | "wifi"
  | "breakfast"
  | "pool"
  | "parking"
  | "freeParking"
  | "restaurant"
  | "spa"
  | "airConditioning"
  | "gym"
  | "bar"
  | "petFriendly"
  | "familyRooms"
  | "airportShuttle"
  | "terrace"
  | "roomService";

export interface Amenity {
  id: AmenityId;
  label: string;
}

/**
 * Guest reviews. Hotels use a 10-point score (the convention travellers expect
 * from booking platforms); tours and experiences use a 5-point star rating.
 */
export interface Review {
  id: string;
  author: string;
  country: string;
  date: string;
  score: number;
  title: string;
  body: string;
  tripType: string;
}

export interface ReviewCategoryScore {
  label: string;
  score: number;
}
