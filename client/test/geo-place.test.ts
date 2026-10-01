import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeLocation,
  formatCoordinates,
  geocoderResultToPlaceRef,
  locationOf,
  mapsDirectionsUrl,
  placeRefFrom,
  postalCodeOf,
  suggestPointKind,
} from "../lib/geo/place";

/**
 * The normaliser, exercised on the shapes Google actually returns.
 *
 * No browser and no Maps script: `placeRefFrom` reads plain objects, which is
 * the point of it being separate from the components. The fixtures below are
 * trimmed copies of real responses for Tbilisi airport and a Kazbegi
 * guesthouse, plus the awkward cases — no locality, no address at all.
 */

const airport = {
  id: "ChIJ-airport",
  displayName: "Tbilisi International Airport",
  formattedAddress: "Tbilisi International Airport, Tbilisi 0158, Georgia",
  types: ["airport", "point_of_interest", "establishment"],
  addressComponents: [
    { longText: "Tbilisi", shortText: "Tbilisi", types: ["locality", "political"] },
    { longText: "Tbilisi", shortText: "Tbilisi", types: ["administrative_area_level_1", "political"] },
    { longText: "Georgia", shortText: "GE", types: ["country", "political"] },
    { longText: "0158", shortText: "0158", types: ["postal_code"] },
  ],
};

describe("placeRefFrom", () => {
  it("reads the city, region and country off a Places result", () => {
    const ref = placeRefFrom(airport);

    assert.deepEqual(ref, {
      placeId: "ChIJ-airport",
      name: "Tbilisi International Airport",
      formattedAddress: "Tbilisi International Airport, Tbilisi 0158, Georgia",
      city: "Tbilisi",
      region: "Tbilisi",
      countryCode: "GE",
      types: ["airport", "point_of_interest", "establishment"],
    });
  });

  it("falls back to the municipality for a place with no locality", () => {
    const ref = placeRefFrom({
      id: "ChIJ-stepantsminda",
      displayName: "Rooms Hotel Kazbegi",
      formattedAddress: "1 V. Gorgasali St, Stepantsminda, Georgia",
      types: ["lodging"],
      addressComponents: [
        { longText: "Kazbegi Municipality", shortText: "Kazbegi", types: ["administrative_area_level_2", "political"] },
        { longText: "Mtskheta-Mtianeti", shortText: "Mtskheta-Mtianeti", types: ["administrative_area_level_1", "political"] },
        { longText: "Georgia", shortText: "GE", types: ["country", "political"] },
      ],
    });

    assert.equal(ref.city, "Kazbegi Municipality");
    assert.equal(ref.region, "Mtskheta-Mtianeti");
  });

  it("survives a place Google knows nothing about beyond its id", () => {
    const ref = placeRefFrom({ id: "ChIJ-bare", displayName: "  ", addressComponents: null, types: null });

    assert.deepEqual(ref, {
      placeId: "ChIJ-bare",
      name: null,
      formattedAddress: null,
      city: null,
      region: null,
      countryCode: null,
      types: [],
    });
  });

  it("reads the Geocoder's older field names the same way", () => {
    const ref = geocoderResultToPlaceRef({
      place_id: "ChIJ-geocoded",
      formatted_address: "14 Merab Kostava St, Tbilisi, Georgia",
      types: ["street_address"],
      address_components: [
        { long_name: "Tbilisi", short_name: "Tbilisi", types: ["locality", "political"] },
        { long_name: "Georgia", short_name: "ge", types: ["country", "political"] },
      ],
    } as unknown as google.maps.GeocoderResult);

    assert.equal(ref.name, "14 Merab Kostava St", "the first line of the address stands in for a name");
    assert.equal(ref.city, "Tbilisi");
    assert.equal(ref.countryCode, "GE", "and the country code is upper-cased whatever Google sent");
  });

  it("finds the postal code for the hotel address form", () => {
    assert.equal(postalCodeOf(airport.addressComponents), "0158");
    assert.equal(postalCodeOf([]), null);
    assert.equal(postalCodeOf(undefined), null);
  });
});

describe("suggestPointKind", () => {
  it("names the obvious kinds and stays quiet otherwise", () => {
    assert.equal(suggestPointKind(["airport", "establishment"]), "AIRPORT");
    assert.equal(suggestPointKind(["lodging", "point_of_interest"]), "HOTEL");
    assert.equal(suggestPointKind(["train_station", "transit_station"]), "STATION");
    assert.equal(suggestPointKind(["locality", "political"]), "CITY");
    assert.equal(suggestPointKind(["route"]), null);
    assert.equal(suggestPointKind([]), null);
  });
});

describe("formatting", () => {
  it("prints coordinates the way the tables already do", () => {
    assert.equal(formatCoordinates(41.71513, 44.82712), "41.7151, 44.8271");
    assert.equal(formatCoordinates(41.71513, 44.82712, 6), "41.715130, 44.827120");
  });

  it("builds a directions link a phone opens in its maps app", () => {
    assert.equal(
      mapsDirectionsUrl(41.6692, 44.9547),
      "https://www.google.com/maps/dir/?api=1&destination=41.6692,44.9547",
    );
  });

  it("describes a location by its place when it has one, by its coordinates when it does not", () => {
    const ref = placeRefFrom(airport);

    assert.equal(
      describeLocation({ latitude: 41.6692, longitude: 44.9547, place: ref }),
      "Tbilisi International Airport · Tbilisi, GE",
    );
    assert.equal(describeLocation({ latitude: 41.6692, longitude: 44.9547, place: null }), "41.6692, 44.9547");
    assert.equal(describeLocation({ latitude: null, longitude: null, place: null }), null);
  });

  it("drops a place that has outlived its coordinates when reading a record", () => {
    const ref = placeRefFrom(airport);

    assert.equal(locationOf({ latitude: null, longitude: null, place: ref }).place, null);
    assert.equal(locationOf({ latitude: 41.6, longitude: 44.9, place: ref }).place, ref);
    assert.equal(locationOf({ latitude: 41.6, longitude: 44.9 }).place, null);
  });
});
