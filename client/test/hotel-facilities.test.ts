import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { amenityFilters } from "../data/amenities";
import { buildFacets, defaultFilters, matchesFilters } from "../lib/hotels/filters";
import {
  amenityLabel,
  cardAmenityCodes,
  facilityViews,
  formatAmenityCode,
} from "../lib/hotels/facilities";
import { languageName, staffLanguages } from "../lib/hotels/languages";
import { en } from "../lib/i18n/ui/en";
import { he } from "../lib/i18n/ui/he";
import { ka } from "../lib/i18n/ui/ka";
import { ru } from "../lib/i18n/ui/ru";
import { adaptHotelDetail, adaptHotelSummary } from "../lib/site/hotelAdapter";
import type { Hotel, HotelFacility } from "../types";
import type {
  CatalogueAmenity,
  Hotel as ApiHotel,
  HotelSummary as ApiHotelSummary,
} from "../types/catalogue";

/**
 * The facilities a property page shows, end to end on the client: what the
 * adapter keeps, how a row is labelled in each locale, and what the "Free
 * parking" chip is allowed to match.
 *
 * The codes below are the ones the audit found dropped — every one outside
 * the site's own vocabulary, and every one a real facility on a real hotel.
 */

const amenity = (
  code: string,
  extra: Partial<Pick<CatalogueAmenity, "name" | "icon" | "note">> = {},
): CatalogueAmenity => ({
  id: `amenity-${code}`,
  code,
  name: extra.name ?? code,
  category: "General",
  scope: "HOTEL",
  icon: extra.icon ?? null,
  sortOrder: 0,
  isActive: true,
  note: extra.note ?? null,
});

/** The fields a list row and a detail share; `kosher` differs in shape between the two. */
const BASE: Omit<ApiHotelSummary, "kosher"> = {
  id: "hotel-1",
  slug: "hotel-one",
  name: "Hotel One",
  propertyType: "Hotel",
  starRating: 4,
  guestScore: 8.6,
  reviewCount: 12,
  shortDescription: null,
  countryCode: "GE",
  latitude: null,
  longitude: null,
  currency: "GEL",
  featured: false,
  updatedAt: "2026-10-01T00:00:00.000Z",
  coverImage: null,
  destination: null,
  priceFrom: null,
};

const summary = (overrides: Partial<ApiHotelSummary> = {}): ApiHotelSummary => ({
  ...BASE,
  ...overrides,
});

const detail = (overrides: Partial<ApiHotel> = {}): ApiHotel => ({
  ...BASE,
  summary: null,
  description: [],
  address: null,
  postalCode: null,
  place: null,
  timezone: "Asia/Tbilisi",
  checkIn: { from: null, until: null },
  checkOut: { from: null, until: null },
  phone: null,
  email: null,
  website: null,
  languages: [],
  policies: {},
  nearby: [],
  categoryScores: [],
  amenities: [],
  images: [],
  roomTypes: [],
  childPolicy: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

/** A list row as the adapter makes it, with only the codes changed. */
const listHotel = (codes: string[]): Hotel => adaptHotelSummary(summary({ amenityCodes: codes }));

const AUDITED_CODES = [
  "elevator",
  "cafe",
  "porterService",
  "soundproofRooms",
  "freeParking",
  "wheelchairAccessible",
  "meetingRooms",
];

describe("adaptHotelDetail", () => {
  it("keeps every facility, including codes outside the site's vocabulary", () => {
    const api = detail({
      amenities: [amenity("wifi"), ...AUDITED_CODES.map((code) => amenity(code)), amenity("parking")],
    });
    const codes = (adaptHotelDetail(api).facilities ?? []).map((facility) => facility.code);

    assert.deepEqual(codes, ["wifi", ...AUDITED_CODES, "parking"]);
  });

  it("carries name, icon and note through, blanks as null", () => {
    const api = detail({
      amenities: [
        amenity("parking", { name: "Parking", icon: "car", note: "Paid public parking" }),
        amenity("cafe", { name: "  ", icon: "", note: "   " }),
      ],
    });

    assert.deepEqual(adaptHotelDetail(api).facilities, [
      { code: "parking", name: "Parking", icon: "car", note: "Paid public parking" },
      { code: "cafe", name: null, icon: null, note: null },
    ] satisfies HotelFacility[]);
  });

  it("drops only rows without a code, and repeats of a code", () => {
    const api = detail({ amenities: [amenity(" "), amenity("elevator"), amenity("elevator")] });

    assert.deepEqual(
      (adaptHotelDetail(api).facilities ?? []).map((facility) => facility.code),
      ["elevator"],
    );
  });

  it("passes the staff languages through", () => {
    assert.deepEqual(adaptHotelDetail(detail({ languages: ["en", "ru"] })).languages, ["en", "ru"]);
    assert.deepEqual(adaptHotelDetail(detail()).languages, []);
  });

  it("still narrows `amenities` to the typed vocabulary, now including freeParking", () => {
    const hotel = adaptHotelDetail(
      detail({ amenities: [amenity("freeParking"), amenity("elevator"), amenity("parking")] }),
    );
    assert.deepEqual(hotel.amenities, ["freeParking", "parking"]);
    assert.deepEqual(hotel.amenityCodes, ["freeParking", "elevator", "parking"]);
  });
});

describe("facility labels", () => {
  it("names paid and free parking apart in every locale", () => {
    for (const t of [en, ru, ka, he]) {
      assert.notEqual(amenityLabel(t, "parking"), amenityLabel(t, "freeParking"));
    }
    assert.equal(amenityLabel(en, "parking"), "Parking");
    assert.equal(amenityLabel(en, "freeParking"), "Free parking");
    assert.equal(amenityLabel(ru, "parking"), "Парковка");
    assert.equal(amenityLabel(ru, "freeParking"), "Бесплатная парковка");
    assert.equal(amenityLabel(ka, "parking"), "პარკინგი");
    assert.equal(amenityLabel(ka, "freeParking"), "უფასო პარკინგი");
    assert.equal(amenityLabel(he, "parking"), "חניה");
    assert.equal(amenityLabel(he, "freeParking"), "חניה חינם");
  });

  it("prefers the locale's dictionary over the API name, and the API name over the code", () => {
    assert.equal(amenityLabel(ru, "parking", "Parking"), "Парковка");
    assert.equal(amenityLabel(ru, "elevator", "Лифт"), "Лифт");
    assert.equal(amenityLabel(ru, "kosherRestaurant", "Kosher Restaurant"), ru.hotels.kosher.features.kosherRestaurant);
    assert.equal(amenityLabel(en, "porterService", null), "Porter service");
    assert.equal(amenityLabel(en, "porterService", "   "), "Porter service");
  });

  it("formats an unknown code readably", () => {
    assert.equal(formatAmenityCode("soundproofRooms"), "Soundproof rooms");
    assert.equal(formatAmenityCode("reception24h"), "Reception 24h");
    assert.equal(formatAmenityCode("ski_storage"), "Ski storage");
    assert.equal(formatAmenityCode("constructor"), "Constructor");
  });

  it("does not read prototype keys as dictionary entries", () => {
    assert.equal(amenityLabel(en, "constructor"), "Constructor");
    assert.equal(amenityLabel(en, "toString", "To string"), "To string");
  });
});

describe("facilityViews", () => {
  it("keeps notes, drops empty ones, and shows both parking codes once each", () => {
    const views = facilityViews(en, [
      { code: "parking", name: "Parking", icon: "car", note: "Paid public parking" },
      { code: "freeParking", name: "Free Parking", icon: "circle-parking", note: "Free public parking" },
      { code: "breakfast", name: "Breakfast", icon: "coffee", note: "Breakfast in the room" },
      { code: "wifi", name: "Wi-Fi", icon: "wifi", note: "In rooms" },
      { code: "cafe", name: null, icon: "mystery-icon", note: "" },
    ]);

    assert.deepEqual(
      views.map((view) => [view.code, view.label, view.note]),
      [
        ["parking", "Parking", "Paid public parking"],
        ["freeParking", "Free parking", "Free public parking"],
        ["breakfast", "Breakfast included", "Breakfast in the room"],
        ["wifi", "Free Wi-Fi", "In rooms"],
        ["cafe", "Cafe", null],
      ],
    );
  });

  it("does not print the same line twice", () => {
    const views = facilityViews(en, [
      { code: "parking", name: "Parking", icon: null, note: null },
      { code: "parking", name: "Parking", icon: null, note: null },
      { code: "carPark", name: "Parking", icon: null, note: null },
      { code: "garage", name: "Parking", icon: null, note: "Underground" },
      { code: "lift", name: "Lift", icon: null, note: "Lift" },
    ]);

    assert.deepEqual(
      views.map((view) => [view.code, view.label, view.note]),
      [
        ["parking", "Parking", null],
        ["garage", "Parking", "Underground"],
        ["lift", "Lift", null],
      ],
    );
  });

  it("is empty for no facilities", () => {
    assert.deepEqual(facilityViews(en, []), []);
  });
});

describe("the Free parking filter", () => {
  const chip = { ...defaultFilters, amenities: ["freeParking" as const] };

  it("is the chip the panel offers, not plain parking", () => {
    assert.ok(amenityFilters.includes("freeParking"));
    assert.ok(!amenityFilters.includes("parking"));
  });

  it("matches freeParking wherever it sits, and never parking alone", () => {
    assert.equal(matchesFilters(listHotel(["parking"]), chip), false);
    assert.equal(matchesFilters(listHotel(["freeParking"]), chip), true);
    assert.equal(matchesFilters(listHotel(["wifi", "pool", "parking", "freeParking"]), chip), true);
    assert.equal(matchesFilters(listHotel(["freeParking", "parking"]), chip), true);
    assert.equal(matchesFilters(listHotel([]), chip), false);
  });

  it("is offered only when some property in the list has free parking", () => {
    assert.deepEqual(buildFacets([listHotel(["parking"])]).amenities, []);
    assert.deepEqual(
      buildFacets([listHotel(["parking"]), listHotel(["elevator", "freeParking"])]).amenities,
      ["freeParking"],
    );
  });
});

describe("cardAmenityCodes", () => {
  it("puts codes the locale can name first, keeps the rest, and leaves kosher to its badge", () => {
    assert.deepEqual(
      cardAmenityCodes(ru, ["elevator", "kosherRestaurant", "parking", "cafe", "freeParking", "parking"], 4),
      ["parking", "freeParking", "elevator", "cafe"],
    );
  });

  it("still shows unfamiliar codes when there is nothing else", () => {
    assert.deepEqual(cardAmenityCodes(en, ["elevator", "porterService"], 4), [
      "elevator",
      "porterService",
    ]);
    assert.deepEqual(cardAmenityCodes(en, [], 4), []);
  });
});

describe("staff languages", () => {
  it("names a language in each of the site's locales", () => {
    assert.deepEqual(
      ["en-GB", "ru-RU", "ka-GE", "he-IL"].map((locale) => languageName("ru", locale)),
      ["Russian", "Русский", "რუსული", "רוסית"],
    );
    assert.equal(languageName("en", "ru-RU"), "Английский");
  });

  it("falls back to the code for a language nobody has a name for", () => {
    assert.equal(languageName("xx", "en-GB"), "XX");
    assert.equal(languageName("not a tag", "en-GB"), "NOT A TAG");
  });

  it("lists each language once and skips blanks", () => {
    assert.deepEqual(staffLanguages(["en", " ", "EN", "ru"], "en-GB"), [
      { code: "en", name: "English" },
      { code: "ru", name: "Russian" },
    ]);
    assert.deepEqual(staffLanguages([], "en-GB"), []);
    assert.deepEqual(staffLanguages(undefined, "en-GB"), []);
  });
});
