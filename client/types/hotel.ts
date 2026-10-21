import type { KosherSummary } from "./catalogue";
import type { AmenityId, GalleryImage, Review, ReviewCategoryScore } from "./common";

export type PropertyType = "Hotel" | "Boutique" | "Resort" | "Guesthouse" | "Lodge";

export interface Room {
  id: string;
  name: string;
  image: string;
  bedConfiguration: string;
  maxGuests: number;
  sizeSqm: number;
  amenities: string[];
  cancellation: string;
  breakfastIncluded: boolean;
  pricePerNight: number;
  /** Prototype scarcity cue, e.g. "Only 2 left at this price". */
  availabilityNote?: string;
}

export interface HotelPolicies {
  checkIn: string;
  checkOut: string;
  cancellation: string;
  children: string;
  pets: string;
  payment: string;
  rules: string[];
}

export interface NearbyPlace {
  name: string;
  type: string;
  distance: string;
}

/**
 * One facility as the API attached it to the property — any code, known to the
 * site or not.
 *
 * Every field but `code` is nullable: a row imported from a supplier may have
 * no icon, and a note is the property's own optional remark. Blank strings are
 * normalised to null by the adapter, so a reader only ever checks for null.
 */
export interface HotelFacility {
  /** Stable machine key, e.g. `freeParking`. */
  code: string;
  /** The API's display name, in the requested locale where a translation exists. */
  name: string | null;
  /** A Lucide icon name from the amenity row, e.g. `circle-parking`. */
  icon: string | null;
  /** This property's remark, e.g. "Paid public parking". Shown as the API sent it. */
  note: string | null;
}

export interface Hotel {
  id: string;
  slug: string;
  name: string;
  propertyType: PropertyType;
  location: string;
  destinationSlug: string;
  address: string;
  /** Official star classification, 1–5. */
  starRating: number;
  /** Guest score out of 10, as travellers expect from booking platforms. */
  guestScore: number;
  reviewCount: number;
  summary: string;
  description: string[];
  image: string;
  gallery: GalleryImage[];
  amenities: AmenityId[];
  highlights: string[];
  rooms: Room[];
  categoryScores: ReviewCategoryScore[];
  reviews: Review[];
  policies: HotelPolicies;
  nearby: NearbyPlace[];
  /** Lowest nightly rate across room types, in USD. */
  priceFrom: number;
  featured: boolean;
  /**
   * Every amenity code the API sent, including ones the `AmenityId` union has
   * no icon for.
   *
   * `amenities` above stays narrowed to that union so the icon map keeps its
   * exhaustiveness check; this is the unfiltered list, and it is what a filter
   * matches against — a kosher facility must be filterable whether or not the
   * prototype ever had a picture for it.
   *
   * Optional because the prototype fixtures in `data/hotels.ts` predate it and
   * carry only the narrowed union; a reader falls back to `amenities` there.
   */
  amenityCodes?: string[];
  /**
   * The full facility rows, in the API's order, with nothing dropped for being
   * outside `AmenityId`. Only the detail response carries names, icons and
   * notes, so a list card has codes alone.
   *
   * Optional for the same reason as `amenityCodes`.
   */
  facilities?: HotelFacility[];
  /** Language codes the staff speak, as the API sends them, e.g. `["en", "ru"]`. */
  languages?: string[];
  /** Present only for a property that offers kosher services at all. */
  kosher?: KosherSummary | null;
}
