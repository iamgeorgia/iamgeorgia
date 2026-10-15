import { isAmenityId } from "@/data/amenities";
import { textOrNull } from "@/lib/hotels/facilities";
import type {
  CatalogueAmenity,
  Hotel as ApiHotel,
  HotelSummary as ApiHotelSummary,
  RoomType as ApiRoomType,
} from "@/types/catalogue";
import type { AmenityId, Hotel, HotelFacility, Room } from "@/types";

/**
 * Live catalogue records, in the shape the site components already render.
 *
 * The public site was built against the fixture `Hotel` type and its
 * components are good — cards, galleries, room lists, review blocks. Rather
 * than rewrite them all against the API shape, this adapter maps the API onto
 * the fixture contract, so the pages switch data source and the components do
 * not change. When the site is redesigned against the API natively, this file
 * is the only thing to delete.
 *
 * Prices: the API sends integer minor units in GEL; the fixture type carries
 * whole units. Divided here, once, and `formatPrice` now defaults to GEL.
 */

/**
 * The codes the site has its own icon and label for — the narrowed list the
 * typed maps read. Derived from the label map rather than kept as a second
 * list, so the two cannot drift. What a page *displays* is `facilities`,
 * which keeps every code.
 */
const toKnownAmenities = (codes: string[]): AmenityId[] => codes.filter(isAmenityId);

/**
 * Every facility the API attached, in its order, each code once.
 *
 * A row is dropped only when it has no code at all — there is nothing to key
 * it on. Being outside `AmenityId`, or arriving without an icon or a note, is
 * not a reason: the API's vocabulary is open, and the page falls back.
 */
const toFacilities = (amenities: CatalogueAmenity[]): HotelFacility[] => {
  const seen = new Set<string>();
  const facilities: HotelFacility[] = [];

  for (const amenity of amenities) {
    const code = textOrNull(amenity.code);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    facilities.push({
      code,
      name: textOrNull(amenity.name),
      icon: textOrNull(amenity.icon),
      note: textOrNull(amenity.note),
    });
  }

  return facilities;
};

/** A displayable image URL: the card rendition when it exists, else the original. */
const imageUrl = (
  asset: { url: string; variants: { variant: string; url: string }[] } | null,
  variant = "card",
): string =>
  asset ? (asset.variants.find((v) => v.variant === variant)?.url ?? asset.url) : "";

const wholeUnits = (amountCents: number | null | undefined): number =>
  amountCents ? Math.round(amountCents / 100) : 0;

/** "1 × King Bed + 1 × Sofa Bed", from the structured groups. */
const bedText = (roomType: ApiRoomType): string => {
  const group = roomType.bedGroups[0];

  if (!group) return "";

  return group.beds.map((bed) => `${bed.quantity} × ${bed.name}`).join(" + ");
};

const BOARD_CODES = new Set(["BB", "HB", "HB_PLUS", "FB", "FB_PLUS", "AI", "UAI"]);

const toRoom = (roomType: ApiRoomType, fallbackImage: string): Room => {
  // The plan a guest would compare first: cheapest board with the friendliest
  // cancellation is how the seed orders them, so the first active plan reads
  // as the room's headline terms.
  const plan = roomType.ratePlans.find((candidate) => candidate.status === "ACTIVE");

  return {
    id: roomType.id,
    name: roomType.name,
    image: imageUrl(roomType.images.find((image) => image.isCover) ?? roomType.images[0] ?? null) || fallbackImage,
    bedConfiguration: bedText(roomType),
    maxGuests: roomType.occupancy.max,
    sizeSqm: roomType.roomSizeSqm ?? 0,
    // The seed stored the room's selling points in its description, joined
    // with a middle dot; a hand-written description falls back to amenities.
    amenities: roomType.description?.includes(" · ")
      ? roomType.description.split(" · ")
      : roomType.amenities.map((amenity) => amenity.name),
    cancellation:
      plan?.cancellation?.description ??
      (plan?.cancellation?.kind === "NON_REFUNDABLE" ? "Non-refundable" : "Flexible cancellation"),
    breakfastIncluded: roomType.ratePlans.some(
      (candidate) =>
        candidate.status === "ACTIVE" && BOARD_CODES.has(candidate.mealPlan?.code ?? ""),
    ),
    pricePerNight: wholeUnits(roomType.priceFrom?.amountCents),
  };
};

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

/**
 * A list card. Fields the card never reads are defaulted rather than fetched —
 * the listing must not pay detail-page costs per row.
 */
export function adaptHotelSummary(api: ApiHotelSummary): Hotel {
  return {
    id: api.id,
    slug: api.slug,
    name: api.name,
    propertyType: api.propertyType as Hotel["propertyType"],
    location: api.destination?.name ?? api.countryCode,
    destinationSlug: api.destination?.slug ?? "",
    address: "",
    starRating: api.starRating,
    guestScore: api.guestScore,
    reviewCount: api.reviewCount,
    summary: api.shortDescription ?? "",
    description: [],
    image: imageUrl(api.coverImage),
    gallery: [],
    amenities: toKnownAmenities(api.amenityCodes ?? []),
    // The unfiltered list, alongside the narrowed one. Kosher facilities have
    // no entry in the prototype's icon map and would otherwise vanish here —
    // which would make them unfilterable on the catalogue page.
    amenityCodes: api.amenityCodes ?? [],
    kosher: api.kosher ?? null,
    highlights: [],
    rooms: [],
    categoryScores: [],
    reviews: [],
    policies: {
      checkIn: "",
      checkOut: "",
      cancellation: "",
      children: "",
      pets: "",
      payment: "",
      rules: [],
    },
    nearby: [],
    priceFrom: wholeUnits(api.priceFrom?.amountCents),
    featured: api.featured,
  };
}

/** The full detail, for the hotel page. */
export function adaptHotelDetail(api: ApiHotel): Hotel {
  const cover = imageUrl(api.coverImage, "gallery");

  return {
    ...adaptHotelSummary(api),
    address: api.address ?? "",
    summary: api.summary ?? api.shortDescription ?? "",
    description: api.description,
    image: cover,
    gallery: api.images.map((image) => ({
      src: imageUrl(image, "gallery"),
      alt: image.altText ?? image.caption ?? api.name,
    })),
    amenities: toKnownAmenities(api.amenities.map((amenity) => amenity.code)),
    amenityCodes: api.amenities.map((amenity) => amenity.code),
    facilities: toFacilities(api.amenities),
    languages: api.languages ?? [],
    // The detail response carries the full profile; the card fields it shares
    // with the summary are the ones a list row reads.
    kosher: api.kosher ?? null,
    rooms: api.roomTypes
      .filter((roomType) => roomType.status === "ACTIVE")
      .map((roomType) => toRoom(roomType, cover)),
    categoryScores: api.categoryScores,
    reviews: (api.reviews ?? []).map((review) => ({
      id: review.id,
      author: review.author,
      country: review.country,
      date: MONTH_YEAR.format(new Date(review.date)),
      score: review.score,
      title: review.title,
      body: review.body,
      tripType: review.tripType,
    })),
    policies: {
      checkIn: api.policies.checkIn ?? "",
      checkOut: api.policies.checkOut ?? "",
      cancellation: api.policies.cancellation ?? "",
      children: api.policies.children ?? "",
      pets: api.policies.pets ?? "",
      payment: api.policies.payment ?? "",
      rules: api.policies.rules ?? [],
    },
    nearby: api.nearby,
  };
}
