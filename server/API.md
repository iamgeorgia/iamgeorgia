# API surface

Every endpoint under `/api`. Written for the client: it says what to call, what
comes back, and which fields depend on who is asking.

**Conventions**

- Auth is an httpOnly session cookie (`iag_session`). Send `credentials: 'include'`.
- Errors are always `{ error: { message, details? } }`. `details` is a zod issue
  array for a 400, or a structured object for a domain conflict.
- **Money is integer minor units** and always travels with a `currency`.
- **Dates are `YYYY-MM-DD` strings**, never instants. Check-out is exclusive.
- Lists are `{ data, total, page, pageSize, totalPages }`.
- Fields marked **staff** are *absent*, not null, unless the viewer is an admin
  or the supplier that owns the hotel.

---

## Public catalogue

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/destinations` | Whole tree, nested. `?locale&countryCode&featured` |
| GET | `/destinations/:slug` | Detail with `parent`, `children` |
| GET | `/hotels` | Browse, no dates. `?search&destinationSlug&destinationPath&propertyType&minStars&amenity&kosher&kosherCertified&featured&locale&page&pageSize` |
| GET | `/hotels/:slug` | Detail with `roomTypes[]`, `amenities[]`, `images[]`, `childPolicy` |
| GET | `/amenities` | Vocabulary. `?category&scope&locale` |

Only `ACTIVE` hotels are ever returned, whatever the query string says.

## Dated search

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/search` | `?checkIn&checkOut&adults&childAges&rooms` + filters. Repeated params for arrays |
| GET | `/search/hotels/:slug` | Availability for one hotel, grouped by room |
| POST | `/search/offers/quote` | `{ token }` → re-priced offer, or 409 |

`/search` filters: `destinationSlug`, `destinationPath`, `countryCode`,
`propertyType`, `minStars`, `amenity` (repeatable), `mealPlan`, `refundableOnly`,
`kosher`, `kosherCertified`, `locale`, `page`, `pageSize`.

**Kosher filtering** is two parameters, and only two. Every kosher *facility* —
a kosher restaurant, a Shabbat elevator, a synagogue, a mikveh — is an amenity,
so it travels on `amenity` like any other:

| Parameter | Meaning |
| --- | --- |
| `kosher` | A **minimum** level of kosher service: `ON_REQUEST`, `KOSHER_FRIENDLY`, `PARTIAL`, `FULL`. `NONE` is rejected — it records "we asked, and the answer is no". |
| `kosherCertified` | A certificate that is verified **and** still valid today **and** covers the property (`PROPERTY` or `KITCHEN`, not `RESTAURANT` or `PASSOVER`). |
| `amenity=shabbatElevator` | A facility. Repeatable, and every one asked for must be present. |

`amenity` values are amenity **codes** and are case-sensitive: `shabbatElevator`,
not `shabbatelevator`.

A search that sends neither kosher parameter is unaffected by any of this.

**Search result card**

```jsonc
{
  "id": "...", "slug": "...", "name": "...", "starRating": 4,
  "coverImage": { "url": "...", "variants": [{ "variant": "card", "format": "webp", "url": "..." }] },
  "destination": { "id": "...", "name": "...", "path": "/georgia/..." },
  "startingFrom": { "totalCents": 52500, "perNightCents": 17500, "currency": "GEL" },
  "mealPlans": ["BB"], "refundable": true, "offerCount": 3,
  // Present only for a property that offers kosher services at all.
  "kosher": {
    "serviceLevel": "FULL", "offersKosher": true,
    "certified": true, "certificationState": "VERIFIED", "expiringSoon": false,
    "authorityName": "Chief Rabbinate of Georgia", "expiresOn": "2027-01-14"
  },
  "cheapestOffer": { /* offer, below */ }
}
```

`certified` is **derived**, never stored: it needs a VERIFIED, unexpired,
property-scoped certificate. No admin field sets it and no amenity produces it,
so a property with every kosher facility ticked and no certificate comes back
`certified: false`. `certificationState` folds expiry in and is computed on
every read — a certificate that lapsed overnight reports `EXPIRED` at 00:01
without any job having run.

**Offer** — the unit taken into checkout.

```jsonc
{
  "token": "…signed…",
  "roomTypeId": "...", "ratePlanId": "...", "name": "Breakfast, flexible",
  "terms": {
    "mealPlan": { "code": "BB", "name": "Bed & Breakfast" },
    "cancellation": { "kind": "FLEXIBLE", "freeUntil": "2027-06-01T10:00:00.000Z", "refundable": true },
    "payment": { "timing": "PAY_NOW", "depositBps": null }
  },
  "quote": {
    "currency": "GEL",
    "nights": [{ "date": "2027-06-01", "sellCents": 17500 }],
    "taxes": { "includedCents": 0, "payableAtPropertyCents": 0, "applied": [] },
    "totals": { "nights": 3, "roomCents": 52500, "totalCents": 52500 }
  },
  "occupancy": { "extraBedsNeeded": 0, "extraGuests": 0 },
  "availableUnits": 5,
  "freeCancellationUntil": "2027-06-01T10:00:00.000Z"
}
```

`quote.nights[].netCents`, `quote.totals.netCents`, `markupBps`, `marginCents`
are **staff** only.

Errors: `409 { reason: 'PRICE_CHANGED', quotedCents, currentCents }`,
`409 { reason: 'UNAVAILABLE' }`, `410` for an expired token.

An offer token is re-checked against the caller's sales channel when it is
quoted, held or booked, not only when it was issued: a token for a hotel that
is not `b2cEnabled`, or for a `PARTNER_ONLY` rate plan, is `409 UNAVAILABLE`
to anyone who is not trade. Trade means an **approved** partner or an admin —
a `DRIVER`, a `DISPATCHER` or a partner still awaiting approval buys as the
public does. The same rule applies to tour offer tokens.

### Idempotency

Every confirm endpoint (`POST /bookings`, `/transfers/bookings`,
`/tours/bookings`, `/service-bookings`, `/orders`) accepts an
`Idempotency-Key` header, or `idempotencyKey` in the body; the header wins.
Either form must be 8–200 characters (`400` otherwise); a blank header is
treated as absent. Without one the key is derived from the token and the lead
traveller, so an identical retry still replays.

A replay is a read of the original record and is authorised like one: the
caller must be able to read the booking the key names (an admin, its partner,
or a guest whose lead email matches). A key that names somebody else's booking
is `409 { reason: 'IDEMPOTENCY_KEY_REUSED' }` with nothing about that booking.
Send unguessable keys — the shipped client sends UUIDs.

## Bookings

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/bookings/holds` | `{ token }` → hold. 409 if gone |
| DELETE | `/bookings/holds/:token` | Always 204 |
| POST | `/bookings` | `{ holdToken \| offerToken, leadGuest, guests?, specialRequests?, requests? }`. Send `Idempotency-Key` |
| GET | `/bookings/:reference` | Guests must add `?email=` |
| PATCH | `/bookings/:reference` | Amend paperwork only. `{ leadGuest?, specialRequests?, requests?, email? }` |
| GET | `/bookings/:reference/cancellation-quote` | `?email=` for guests |
| POST | `/bookings/:reference/cancel` | `{ reason?, email? }` |
| GET | `/partner/bookings` | Own bookings. `?status&from&to&search&page&pageSize` |
| GET | `/partner/dashboard` | `{ partner, stats: { listings, bookings, upcoming, cancelled } }` |

**There is no field for an amount.** The schema is strict; sending one is a 400.
`201` on create, `200` when a replay.

**Structured requirements** travel in `requests`, alongside `specialRequests`
rather than instead of it:

```jsonc
"requests": [
  { "code": "kosherMealOnRequest", "note": "Two kosher dinners, Fri and Sat" },
  { "code": "shabbatElevator" }
]
```

Each `code` is checked against what the property actually offers — its own
kosher-category amenities, plus `kosherMealOnRequest`, which any kosher property
may be asked for. A code it does not offer is a **422**:

```jsonc
{ "error": { "message": "This property does not offer some of those requirements",
             "details": { "unsupported": ["mikvehOnSite"] } } }
```

The check runs *before* any inventory is claimed, so a refused request leaves no
hold and no booking behind it.

**Requirements do not gate confirmation.** The rooms were claimed and priced, so
the booking is `CONFIRMED` and each requirement carries its own
`REQUESTED → CONFIRMED | DECLINED` status. Every booking response carries
`requestsPending`, and the detail carries the rows:

```jsonc
"requestsPending": 1,
"requests": [
  { "id": "...", "code": "kosherMealOnRequest", "note": "…",
    "status": "CONFIRMED", "respondedAt": "…", "responseNote": null }
]
```

On a `PATCH`, `requests` is the **whole set**: withdrawing one means sending the
list without it. A requirement the property has already answered is left alone —
re-asking cannot undo a refusal — though its note may still be corrected.

**Amendments are paperwork only.** `PATCH` reaches the lead guest's name,
email and phone, and the special requests — nothing that was priced. Dates,
rooms, board and party are not in the schema, because changing them means
releasing inventory and re-quoting: cancel and book again. Allowed while the
booking is `PENDING` or `CONFIRMED`; anything else is a `409` carrying the
status. Authorization is the same as a read, so a partner amends its own and a
guest amends theirs by quoting `email`.

**Booking detail**

```jsonc
{
  "reference": "BKG-000001", "status": "CONFIRMED",
  "hotel": { "id": "...", "name": "...", "slug": "..." },
  "hotelSnapshot": { /* name, address, phone, timezone, checkIn/checkOut times */ },
  "checkIn": "2027-06-01", "checkOut": "2027-06-04", "nights": 3, "rooms": 1,
  "leadGuestName": "...", "leadGuestEmail": "...",
  "currency": "GEL", "totalCents": 52500, "payableAtPropertyCents": 0,
  "bookingRooms": [{
    "id": "...", "status": "CONFIRMED",
    "roomTypeName": "Deluxe Double", "ratePlanName": "...",
    "mealPlan": { "code": "BB", "name": "..." },
    "bedConfiguration": "1 x King Bed",
    "cancellation": { "freeUntil": "...", "windows": [{ "fromAt": null, "toAt": "...", "chargeCents": 0 }] },
    "sellSubtotalCents": 52500,
    "nights": [{ "date": "2027-06-01", "sellCents": 17500 }],
    "guests": [{ "type": "ADULT", "firstName": "...", "isLead": true }]
  }]
}
```

Names come from the **snapshot**, not the live hotel. **staff**:
`netTotalCents`, `markupBps`, `marginCents`, `partner`, per-night `netCents`.

Status: `CONFIRMED → CANCELLED | COMPLETED`. A confirmed stay rolls to
`COMPLETED` (with `completedAt`) by a sweep once its check-out date is behind
us (`HOTEL_COMPLETION_SWEEP_INTERVAL_MS`, hourly); a completed stay cannot be
cancelled (409). Orders containing a hotel complete only after this has run.

**Emails.** A standalone booking writes two outbox events with the booking and
nothing is sent inside the request: the guest gets `hotelBookingConfirmed` (the
voucher, with a manage link carrying `?email=`) and the property gets
`supplierBookingReceived` at its own address, else its partner company's, else
`TRANSFER_OPS_EMAIL`. Cancelling sends `hotelBookingCancelled` and
`supplierBookingCancelled`. Tours and services do the same
(`tourBookingRequested|Confirmed|Declined|Cancelled`,
`serviceBooking…`); a booking made inside an order tells its supplier but the
guest hears from the order (`orderConfirmed`, `orderItemDeclined`, …) instead.
A refused email leaves the event unprocessed and it is retried with backoff.

## Transfers

Point-to-point ground transport. The shape mirrors hotels — a signed quote
carried into an idempotent booking — with one structural difference: **there is
no inventory and there are no holds.** A private transfer is dispatched from an
elastic fleet, so nothing has to be claimed. What can stop a sale is a road
closing, which is a blackout.

### Catalogue

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/transfers/points` | The picker. `?search&kind&popular&locale`. Matches names, regions, IATA codes and every translation |
| GET | `/transfers/routes` | `?tier&category&featured&fromSlug&toSlug&search&locale&page&pageSize` |
| GET | `/transfers/routes/:slug` | Route landing page, with `stops[]` |
| GET | `/transfers/vehicles` | The fleet. `?vehicleClass&kind&locale` |
| GET | `/transfers/vehicles/:slug` | |
| GET | `/transfers/extras` | Child seats, ski carriage, extra stops |

Only `ACTIVE` rows are returned. A vehicle class is B2B by default — an
anonymous visitor sees only `b2cEnabled` classes, a signed-in partner sees the
whole active fleet, exactly as hotels work.

### Quotes

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/transfers/quotes` | `?from&to&date&time&tripType&returnDate&returnTime&adults&children&luggage&cabinBags&extra&locale` |
| POST | `/transfers/quotes/revalidate` | `{ token }` → re-priced offer. Not strict: it shows the new fare rather than refusing |

`from` and `to` are point slugs or ids. `extra` repeats: `?extra=childSeat&extra=skiEquipment`.

**Pricing is two-tier.** A curated `TransferRoutePrice` is used when one exists;
otherwise the fare is `max(minimumFare, distanceKm × perKm) + airportFee` from
the vehicle class. So every pair of points is bookable, and the ones that matter
commercially are priced by hand. The response says which was used — but only to
staff, in `quote.legs[].source`.

**Quote result**

```jsonc
{
  "from": { "id": "...", "slug": "tbilisi-airport", "name": "...", "kind": "AIRPORT", "code": "TBS", "region": "Tbilisi", "timezone": "Asia/Tbilisi" },
  "to": { /* the same shape */ },
  "route": { "slug": "tbilisi-airport-to-gudauri", "tier": "TIER_1", "distanceKm": 128, "startingFromCents": 12776 },
  "closed": false,
  "offers": [{
    "token": "…signed…",
    "vehicle": { "slug": "comfort-sedan-private-transfer", "name": "Comfort Sedan", "vehicleClass": "COMFORT", "body": "sedan", "kind": "PRIVATE", "maxPassengers": 3, "features": ["airConditioning"] },
    "quote": {
      "currency": "GEL",
      "perSeat": false,
      "legs": [{
        "direction": "OUTBOUND", "from": "…", "to": "…",
        "pickupAt": "2027-02-10T05:00:00.000Z",
        "distanceKm": 128, "durationMinutes": 135, "isNight": false,
        "baseFareCents": 17116, "nightSurchargeCents": 0,
        "extras": [{ "code": "childSeat", "quantity": 1, "totalCents": 2000 }],
        "sellCents": 17116
      }],
      "totals": { "sellCents": 17116, "totalCents": 17116 }
    }
  }]
}
```

`legs[].netCents`, `legs[].source`, `totals.netCents`, `markupBps`,
`marginCents` and the vehicle's `fallbackPricing` are **staff** only.

A vehicle tariff and a curated one-way price are rack prices: what the public
pays, at the platform's default markup. A signed-in partner is quoted net plus
its own commission (`Partner.commissionRateBps`, or a matching pricing rule),
so the same journey prices differently for a partner and for a guest, while
the recorded `netCents` is the same whoever buys. Extras are the listed price
for everyone.

`closed: true` with an empty `offers` array means the road is shut for those
dates — a real answer, not an error.

Errors: `404` for a point we do not serve, `409 { reason: 'SAME_POINT' }`,
`422 { reason: 'TOO_SOON' | 'BEYOND_HORIZON' | 'RETURN_BEFORE_OUTBOUND' | 'PARTY_TOO_LARGE' }`,
`410` for an expired token.

A party that no vehicle can carry returns `200` with no offers. Capacity is a
hard constraint, not a filter.

### Transfer bookings

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/transfers/bookings` | `{ quoteToken, leadPassenger, flightNumber?, pickupAddress?, dropoffAddress?, pickupPlace?, dropoffPlace?, specialRequests?, preferredDriverId?, preferredFleetVehicleId? }`. Send `Idempotency-Key`. `pickupPlace`/`dropoffPlace` are searched doors — `{ latitude, longitude, place: PlaceRef | null }` — for the driver to navigate to; the address strings stay the text they read |
| GET | `/transfers/bookings/:reference` | Travellers must add `?email=` |
| PATCH | `/transfers/bookings/:reference` | Paperwork only |
| GET | `/transfers/bookings/:reference/cancellation-quote` | `{ chargeCents, refundCents, currency, freeUntil, asAt }` — the same shape as hotels and tours. `refundableCents` is still sent as a deprecated alias for one release. |
| POST | `/transfers/bookings/:reference/cancel` | `{ reason?, email? }` |
| GET | `/partner/transfers/bookings` | Own bookings. `?status&from&to&search&page&pageSize` |

References are `TRF-000001`. **There is no field for an amount**; the schema is
strict, so sending one is a 400. `201` on create, `200` on a replay.

**A partner may name the driver.** `preferredDriverId` (and optionally which
of that driver's cars, `preferredFleetVehicleId`) is honoured for a partner
session or operations; a guest sending it is a 400. The driver has to be one
`POST /partner/drivers/available` would list — verified, active, in a car on
the road that is sold as the booked class and big enough for the party — or
the answer is 422 `DRIVER_NOT_ELIGIBLE`. The offer is written for every leg in
the same transaction as the booking: a driver who was taken in the meantime is
409 `DRIVER_UNAVAILABLE` and nothing is written, so the partner chooses again
(or omits the field and lets dispatch assign). The driver still has to accept;
until then the booking's `legs[].assignment` carries them with
`awaitingDriver: true`.

**Amendments are paperwork only** — the lead passenger, their phone, the flight
number and the two addresses. The journey, the vehicle, the date and the party
are not in the schema, because changing any of them changes the fare: cancel and
book again. Allowed while `PENDING` or `CONFIRMED`, otherwise a `409` carrying
the status.

**Cancellation reads only the schedule frozen at confirmation.** The vehicle's
current policy is never consulted, so terms tightened later cannot change what
an earlier traveller is owed.

**Booking detail**

```jsonc
{
  "reference": "TRF-000001", "status": "CONFIRMED", "tripType": "ONE_WAY",
  "pickupAt": "2027-02-10T05:00:00.000Z", "returnPickupAt": null,
  "route": { /* snapshot: fromName, toName, distanceKm, stops[] */ },
  "vehicle": { /* snapshot: name, vehicleClass, providerName, pickupProcedure */ },
  "adults": 2, "children": 0, "luggage": 2,
  "leadPassengerName": "...", "leadPassengerEmail": "...",
  "flightNumber": "TK378", "pickupAddress": "Terminal 1, arrivals",
  "pickupPlace": { "latitude": 41.6692, "longitude": 44.9547, "place": { "placeId": "ChIJ…", "name": "Tbilisi International Airport", "formattedAddress": "…", "city": "Tbilisi", "region": "Tbilisi", "countryCode": "GE", "types": ["airport"] } },
  "dropoffPlace": null,
  "currency": "GEL", "totalCents": 17116,
  "cancellation": { "freeUntil": "...", "windows": [{ "fromAt": null, "toAt": "...", "chargeCents": 0 }] },
  "legs": [{ "legIndex": 0, "direction": "OUTBOUND", "from": "...", "to": "...", "pickupAt": "...", "sellCents": 17116 }],
  "extras": [{ "code": "childSeat", "quantity": 1, "totalCents": 2000 }]
}
```

Names come from the **snapshot**, not the live route. **staff**:
`netTotalCents`, `markupBps`, `marginCents`, `partner`, per-leg `netCents`.

### Transfer admin

All under `/admin/transfers/*`, guarded by `authenticate + requireAdmin`.

| Method | Path |
| --- | --- |
| GET/POST | `/admin/transfers/points` · GET/PATCH/DELETE `/points/:id` — coordinates required; `place?` (PlaceRef, see Destinations) alongside them. A second live point with the same `place.placeId` is a 409 `PLACE_TAKEN` naming the existing slug |
| PUT | `/admin/transfers/points/:id/translations/:locale` |
| GET/POST | `/admin/transfers/vehicles` · GET/PATCH `/vehicles/:id` · POST `/vehicles/:id/archive` |
| PUT | `/admin/transfers/vehicles/:id/translations/:locale` |
| GET/POST | `/admin/transfers/routes` · GET/PATCH `/routes/:id` |
| **PUT** | `/admin/transfers/routes/prices` — the bulk editor |
| PUT | `/admin/transfers/routes/:id/prices` · `/stops` · `/translations/:locale` |
| POST | `/admin/transfers/routes/:id/publish` · `/unpublish` · `/archive` |
| GET/POST/PUT/DELETE | `/admin/transfers/extras[/:code]` |
| GET/POST/DELETE | `/admin/transfers/blackouts[/:id]` |
| GET | `/admin/transfers/bookings` · `/:reference` · POST `/:reference/cancel` |
| GET | `/admin/transfers/bookings/summary` — `{ total, confirmed, confirmedValue: { byCurrency: [{ currency, amountCents, count }] } }`, aggregated in the database; sums revenue, so `finance.margin.read` (a dispatcher reads the list without the tiles) |

### Seeding the transfer catalogue

```
node scripts/seed-reference.js              # first — shared policy templates
node scripts/seed-transfers.js              # 67 points, 9 classes, 396 routes, 3,564 prices
node scripts/seed-transfer-translations.js  # ka/ru/he, recovered from git history
node scripts/seed-transfer-bookings.js      # demo bookings, for a panel with data in it
node scripts/seed-transfer-bookings.js --clear
```

All four are idempotent and none of them deletes anything an operator has
changed — a re-run refreshes editorial fields and leaves every curated price
where it was. `seed-transfer-bookings.js` goes through the real quote and
confirmation path rather than inserting rows, so if it runs, the booking path
runs; its records carry `source: 'demo'` and `@demo.iamgeorgia.test` addresses,
which is what `--clear` matches.

`DELETE /points/:id` **retires** rather than deletes — routes and bookings
reference the row with `Restrict`, and a place that has ever been travelled to
has to stay readable.

Every route mutation returns the route plus `publishChecklist: [{ code, message }]`.
`POST /publish` answers **422** with `details.missing` when a route has no price
at all, because publishing one would silently fall through to the distance
estimate. Missing copy is listed but does not block.

**Route price grid** (whole-grid PUT, so a half-applied grid is impossible):

```jsonc
{ "prices": [{ "vehicleId": "...", "oneWayCents": 17500, "returnCents": null, "netCents": null }] }
```

**Bulk repricing:**

```jsonc
{ "tier": "TIER_1", "vehicleIds": ["..."], "perKmCents": 150, "overwrite": false }
```

Either `perKmCents` or `flatCents`, never both. **A filter is required** —
`tier`, `category` or `routeIds` — there is deliberately no way to reprice the
whole catalogue in one call. `overwrite` defaults to false, so the ordinary use
fills gaps and leaves every figure someone has already set. Returns
`{ routes, written, kept }`.

---

### Operations roles and the driver identity

`DISPATCHER` reads every transfer booking (`GET /api/admin/transfers/bookings`,
`GET /api/admin/transfers/bookings/:reference`), reads the catalogue, and
manages cars, drivers and assignments — but never changes the catalogue, the
fares or the partners, never cancels, and never sees the money: the summary and
detail shapes carry `netTotalCents`, `markupBps` and `marginCents` only for
roles holding `finance.margin.read`. `DRIVER` reaches nothing under
`/api/partner/*` or `/api/admin/*`; it has its own panel. The full role map is
under "Users, roles and capabilities".

`GET /api/auth/me` answers with a third field, `driver`, beside `user` and
`partner`: the driver's own profile for a `DRIVER` account (`null` until an
operations user has linked one), and `null` for everyone else.

```json
{
  "user": { "role": "DRIVER", "partnerId": null, "...": "..." },
  "partner": null,
  "driver": {
    "id": "…", "firstName": "Levan", "lastName": "Gogoladze",
    "photo": null, "languages": ["ka", "en"], "yearsExperience": 7, "bio": null,
    "verified": true, "ratingAvg": 0, "ratingCount": 0, "completedCount": 0,
    "phone": "+995555000111", "email": null,
    "provider": { "id": "…", "name": "I am Georgia fleet" },
    "verificationStatus": "VERIFIED", "isActive": true, "licenceExpiresOn": null,
    "homeBasePoint": null, "vehicles": []
  }
}
```

The licence number, date of birth, internal notes and documents are never in
this shape, nor in the one a partner sees; they exist only in the operations
view.

### Fleet and drivers (operations)

`/api/admin/transfers/fleet` and `/api/admin/transfers/drivers` are open to
`SUPER_ADMIN`, `ADMIN` and `DISPATCHER`. Every response is the operations
view; a document response never carries a URL — the bytes are reached through
the `…/url` endpoint, which authorises and writes a `PRIVATE_FILE_ACCESSED`
audit row.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/transfers/fleet` | `providerId`, `vehicleClassId`, `status` (repeatable), `search` (make, model, plate however spelt), `page`, `pageSize` |
| POST | `/admin/transfers/fleet` | 201. 409 `field: plateNumber` when the normalised plate is already on a non-archived car |
| GET / PATCH | `/admin/transfers/fleet/:id` | PATCH refuses `status: ARCHIVED` (400) — use the action |
| POST | `/admin/transfers/fleet/:id/archive` | 409 `reason: ACTIVE_ASSIGNMENTS` with the bookings while a live assignment names the car |
| POST | `/admin/transfers/fleet/:id/activate` | DRAFT / INACTIVE / ARCHIVED → ACTIVE; 409 if the plate has since been reissued |
| DELETE | `/admin/transfers/fleet/:id` | **Admin only.** A real delete, open only while no assignment names the car: 409 `HAS_ASSIGNMENTS` (with the count) once it has been on a job — archive instead. Photographs and documents nothing else references are removed with it |
| GET / POST | `/admin/transfers/fleet/:id/images` | Gallery, as for hotels. The cover is mirrored onto `mainImage` |
| PATCH / DELETE | `/admin/transfers/fleet/:id/images/:imageId` | |
| PUT | `/admin/transfers/fleet/:id/images/order` | `{ order: [imageId…] }`, every image exactly once |
| GET / POST | `/admin/transfers/fleet/:id/documents` | `docType` ∈ REGISTRATION, INSURANCE, TECHNICAL_INSPECTION, OTHER; the asset must be PRIVATE |
| GET | `/admin/transfers/fleet/:id/documents/:documentId/url` | Short-lived signed link, audited |
| DELETE | `/admin/transfers/fleet/:id/documents/:documentId` | The bytes stay in the media library |
| GET | `/admin/transfers/drivers` | `providerId`, `verificationStatus` (repeatable), `isActive` (`true`/`false`), `search`, `page`, `pageSize` |
| POST | `/admin/transfers/drivers` | 201. `languages` is a closed ISO 639-1 list |
| GET / PATCH | `/admin/transfers/drivers/:id` | |
| POST | `/admin/transfers/drivers/:id/verify` | `{ status, note? }`. VERIFIED stamps who and when; anything else clears both |
| POST | `/admin/transfers/drivers/:id/deactivate` | `{ reason, force? }`. 409 `ACTIVE_ASSIGNMENTS` unless `force`, which revokes them and returns their legs to UNASSIGNED. Ends the login's sessions |
| POST | `/admin/transfers/drivers/:id/activate` | |
| DELETE | `/admin/transfers/drivers/:id` | **Admin only.** A real delete, open only while no assignment names the driver: 409 `HAS_ASSIGNMENTS` once they have been on a job — deactivate instead. Takes the `DRIVER` login (and its sessions) with the profile, and the documents and photo nothing else references |
| POST | `/admin/transfers/drivers/:id/account` | `{ email }`. Creates the `DRIVER` login and emails `driverAccountActivation`. Returns `{ driver, link: { kind: 'activation', url, expiresAt }, email, emailSent }` so the admin can copy the link themselves. 409 if one exists or the email is taken |
| POST | `/admin/transfers/drivers/:id/account/resend` | Same response shape, with a fresh link. 409 once the account has a password |
| PUT | `/admin/transfers/drivers/:id/vehicles` | `{ vehicles: [{ fleetVehicleId, isPrimary }] }`, replaced as a whole; at most one primary |
| GET / POST / DELETE | `/admin/transfers/drivers/:id/documents[/:documentId]` | `docType` ∈ DRIVING_LICENCE, ID_DOCUMENT, MEDICAL, BACKGROUND_CHECK, OTHER |
| GET | `/admin/transfers/drivers/:id/documents/:documentId/url` | Signed link, audited |

`/api/admin/media` is likewise open to dispatchers for the four fleet and
driver categories (`FLEET_IMAGE`, `DRIVER_PHOTO`, `DRIVER_DOCUMENT`,
`VEHICLE_DOCUMENT`) and nothing else: an upload in another category is 403,
a read of another category's file is 404, and delete stays admin-only. Every
other staff role reaches a private file by its category in the same way
(contracts and rate sheets with `partners.financial.read`, payment slips and
invoices with `finance.payments.read`, certificates with `catalogue.read`);
only an admin, or whoever writes the catalogue, reaches them all.

### Dispatch (operations)

`/api/admin/transfers/dispatch`, open to `SUPER_ADMIN`, `ADMIN` and `DISPATCHER`.
A *leg* is the unit of dispatch — a return booking is two. Each leg carries an
operational `status` (`UNASSIGNED → ASSIGNED → ACCEPTED → EN_ROUTE → ARRIVED →
ON_BOARD → COMPLETED`, with `NO_SHOW_REPORTED → NO_SHOW` and `CANCELLED`
beside it) and at most one live assignment. The booking's own `status` is
unchanged by any of this until every leg is terminal, when it rolls up to
`COMPLETED` or `NO_SHOW`.

| Method | Path | Notes |
|---|---|---|
| GET | `/dispatch/legs` | `from`, `to` (dates), `legStatus` (repeatable), `driverId`, `search`; each row carries `booking`, `assignment` and `allowedTransitions` |
| GET | `/dispatch/legs/:legId` | |
| GET | `/dispatch/legs/:legId/candidates` | Active drivers with an active car of the booked class, ranked, with those cars and any conflicts in the leg's window |
| POST | `/dispatch/legs/:legId/assign` | `{ driverId, fleetVehicleId?, acceptOnBehalf?, overrideUnverified?, overrideClassMismatch?, overrideVehicleLink?, windowEndOverride?, note? }`. 201. Reassigns when the leg is already held. 422 `CAPACITY`; 422 `OVERRIDE_REQUIRED` with `overrides[]`; 409 `SCHEDULE_CONFLICT` with `conflicts[]` |
| POST | `/dispatch/legs/:legId/unassign` | `{ reason }` |
| POST | `/dispatch/legs/:legId/status` | `{ to, expectedFrom?, note? }` on behalf of the driver, or an operations-only move (`NO_SHOW`, corrections). 409 `STALE_STATE`, `INVALID_TRANSITION`, `TOO_EARLY` |
| POST | `/dispatch/legs/:legId/cancel` | One leg only — a return whose outbound already ran |
| GET | `/dispatch/assignments` | History: `driverId`, `fleetVehicleId`, `status`, `from`, `to` |
| GET | `/dispatch/assignments/:id` | |
| GET | `/dispatch/schedule` | `driverId` \| `fleetVehicleId` \| `providerId`, `from`, `to`: every live claim on the resource's time, jobs and blocks alike |
| GET / POST | `/dispatch/blocks` | A block names one driver or one car; 409 `SCHEDULE_CONFLICT` while a job sits inside it |
| DELETE | `/dispatch/blocks/:id` | |

Occupancy is pick-up minus `TRANSFER_DISPATCH_PRE_BUFFER_MINUTES` to the end
of the journey plus `TRANSFER_DISPATCH_POST_BUFFER_MINUTES`, stored on the
assignment. Two dispatchers offering the same driver overlapping legs get one
201 and one 409: the service locks the driver's row and checks the occupancy
view under it, and the database's exclusion constraints refuse the overlap
regardless.

### The driver panel

`/api/driver`, for `DRIVER` accounts with a linked, active profile. Every
query is scoped on the session's driver; another driver's assignment is a
404. Nothing here ever carries a fare.

| Method | Path | Notes |
|---|---|---|
| GET / PATCH | `/driver/me` | PATCH accepts `phone`, `languages`, `bio` only |
| GET | `/driver/vehicles` | The cars linked to the driver |
| GET | `/driver/assignments` | `scope=today|upcoming|history` |
| GET | `/driver/assignments/:id` | The job, the passenger block, the car, the milestones and `allowedTransitions` |
| POST | `/driver/assignments/:id/accept` | 409 `ASSIGNMENT_NOT_ACTIVE` once the offer has been withdrawn |
| POST | `/driver/assignments/:id/decline` | `{ reason? }`. An accepted job may be declined until `TRANSFER_DISPATCH_LATE_DECLINE_HOURS` before pick-up; after that, 409 `LATE_DECLINE` |
| POST | `/driver/assignments/:id/status` | `{ to, expectedFrom?, note? }`. Forward skips fill the milestones they jumped; every timestamp is the server's |

### What a partner and a passenger see

`GET /api/partner/transfers/bookings/:reference` (new) and the guest lookup
`GET /api/transfers/bookings/:reference?email=` carry `legs[].status` and
`legs[].assignment`. The assignment is `null` until the driver has accepted;
then it holds the driver's public profile (`firstName`, `lastName` — the
initial only for a passenger — photo, languages, experience, `verified`,
rating and completed counts), the car, and the milestones. `driver.phone` is
present only from `TRANSFER_DISPATCH_CONTACT_REVEAL_HOURS` before pick-up.
The one exception is the driver the partner asked for at checkout: that
offer is shown while it waits, with `awaitingDriver: true` and no phone
number, so the partner can see whom they asked for. An offer a dispatcher
made stays hidden until it is answered.

**Choosing a driver at checkout.** `POST /api/partner/drivers/available`
`{ token }` — the quote token from the results page — answers with the
drivers a partner may ask for: `{ vehicleClass, legs: [{ direction, pickupAt,
windowStart, windowEnd }], drivers: [...] }`. Each driver is the public
profile plus `provider` and `cars`, every car of the booked class that is
linked to them, on the road, big enough for the party and free across every
leg (with its gallery). Verified, active drivers only; the list is advice,
and the booking call checks again under the driver's row lock. Approved
partners and admins; 401 / 403 otherwise. `GET /api/partner/drivers/:id` now
also answers for a driver the partner has requested but who has not yet
accepted.

### Ratings and notifications

One rating per completed leg, 1–5 with optional words. Who may leave it:

| Who | How | Endpoint |
|---|---|---|
| The lead passenger | the link emailed after the transfer (`transferRatingInvite`), signed with `TRANSFER_RATING_TOKEN_SECRET` and valid for `TRANSFER_RATING_WINDOW_DAYS` | `POST /api/transfers/ratings` `{ token, score, comment? }` |
| The partner | from the portal, on one of its own bookings | `POST /api/partner/transfers/bookings/:reference/legs/:legIndex/rating` |
| Operations | feedback taken by phone | `POST /api/admin/transfers/dispatch/legs/:legId/rating` |

First submission wins; a second is 409 `ALREADY_RATED`. A rating without a
comment is `PUBLISHED` at once; one with a comment is `PENDING` until
operations publish or reject it (`GET /api/admin/transfers/dispatch/ratings`,
`POST …/ratings/:id/publish|reject`). The driver's `ratingAvg` /
`ratingCount` and the provider's `rating` / `reviewCount` are recomputed from
the published rows inside the same transaction — never incremented, never
editable. `GET /api/driver/me/ratings` gives a driver the average, the count
and the score distribution, never the comments. `GET /api/partner/drivers/:id`
gives a partner the public profile, cars and published reviews of a driver
who has held an accepted assignment on one of its bookings; anyone else is
404.

Notifications ride a transactional outbox: every dispatch write enqueues an
event in its own transaction, and a sweeper (`TRANSFER_OUTBOX_DRAIN_INTERVAL_MS`)
turns events into in-app rows and emails under an advisory lock, retrying a
failed handler with backoff. A second sweeper
(`TRANSFER_REMINDER_SWEEP_INTERVAL_MS`) enqueues the time-driven ones — the
driver's reminder two hours before pick-up, the passenger's driver details at
`TRANSFER_DISPATCH_CONTACT_REVEAL_HOURS`, and the "still no driver" alert for
a confirmed leg within a day (also emailed to `TRANSFER_OPS_EMAIL`). Each is
stamped on the leg in the statement that selects it, so it fires once.

Every panel has a bell, each reading the same `Notification` rows through its
own router and always scoped to the session — a notice is one person's, and
somebody else's answers 404 whatever id is asked for:

| Panel | Base | Who |
| --- | --- | --- |
| Driver | `/api/driver/notifications` | a linked driver |
| Admin | `/api/admin/notifications` | staff with `notifications.read` (every staff role) |
| Portal | `/api/partner/notifications` | an approved partner's users |

Under each base: `GET ?unread=true&category&kind[]&sort=newest|oldest|unreadFirst&page&pageSize`
(`{ data, unreadCount, unreadByCategory, … }`), `GET /unread-count`
(`{ unreadCount, byCategory }`), `POST /:id/read`, `POST /read-all`
(`{ category? }` marks one tab read). Each row carries `kind`, `category`,
`title`, `body`, `payload` (ids and references to deep-link with),
`entityType`/`entityId`, **`href`** — the path the notice leads to in the
panel it was read from, decided by the server (`serializers/notification.js`),
null when it is only news — and `readAt`.

**Categories** are the bell's tabs, derived from the kind when the row is
written (`lib/notifications/categories.js`): `BOOKING` (new and amended
bookings, overdue supplier requests), `DISPATCH` (every `TRANSFER_*` kind),
`FINANCE` (payments, invoices, credit warnings), `APPROVAL` (finance
approvals and booking approvals), `DEADLINE` (payable and receivable due and
overdue), `SYSTEM`.

**Once per fact.** A notice written with a `dedupeKey` (`booking:<product>:<id>:new`,
`…:awaiting`, `…:approved`, `…:rejected`, `…:approval_overdue`,
`…:modified:<eventId>`) is unique per recipient: a handler that runs twice —
a retry, two sweepers — inserts the second copy with `skipDuplicates` and the
index drops it. Notices without a key keep the retry-time check on
`payload.outboxEventId`.

**The desk's two booking notices.** `BOOKING_NEW` goes to every holder of
`bookings.write` (minus whoever booked) when a booking is made and confirmed
at once; a booking that waits for approval is announced by
`BOOKING_AWAITING_APPROVAL` instead, so nobody reads the same arrival twice.
`BOOKING_MODIFIED` goes to the same people whenever the paperwork on a hotel,
transfer, tour or order booking is amended, naming the fields.

**Dead letters.** A handler that fails every attempt (8, with backoff to an
hour) is marked processed with its error kept so the queue never blocks
behind it. `GET /api/admin/outbox/failed?page&pageSize` (`audit.read` or
`settings.write`) lists those events; `POST /api/admin/outbox/:id/retry`
(`platform.admin` or `settings.write`, audited `OUTBOX_EVENT_RETRIED`) puts
one back for a single further attempt — the count is kept, so a second
failure gives up at once rather than climbing again. A delivered event, or
one that never failed, is 409 `NOT_FAILED`.

## Tours

A tour is sold through **options** — a shared seat or a private group, priced per person or per group — and each option has **price sheets** (seasons with party-size tiers) and **departures** (a capacity row per date). Availability is derived on read, exactly as for rooms: `total − blocked − booked − held`, with a database CHECK beneath it. A multi-day tour claims its departure date only.

Everything is B2B by default: an anonymous visitor sees only tours switched on for B2C, and only `PUBLIC` options. A signed-in partner or member of staff sees the whole `ACTIVE` catalogue.

### Catalogue

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/tours` | Browse, no dates. `?search&destinationSlug&destinationPath&category&difficulty&minDays&maxDays&featured&locale&page&pageSize`. `priceFrom` is indicative. |
| GET | `/tours/:slug` | Detail with itinerary, images, options (terms only — no price sheets). `?locale=` |

### Dated search

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/search/tours` | `?date=YYYY-MM-DD&adults&childAges&…filters` — tours with a bookable departure that day, cheapest first; without `date` it is the catalogue. |
| GET | `/search/tours/:slug` | `?date=` or `?from=&to=` (≤ 62 days), `adults`, `childAges` (one per child). Every option, every departure in the window. |
| POST | `/search/tours/offers/quote` | `{ token }` — re-prices an offer; a moved price comes back with `priceChanged: true`. |

A departure entry is either bookable —

```jsonc
{
  "available": true,
  "date": "2027-08-10", "departureTime": "08:00", "startAt": "2027-08-10T04:00:00.000Z", "endDate": "2027-08-10",
  "availableUnits": 9, "units": 3,                  // units this party would take: seats, or one group
  "token": "…",                                     // carries the offer into checkout; never a price
  "quote": {
    "currency": "GEL", "pricingBasis": "PER_PERSON",
    "party": { "adults": 2, "children": 1, "infants": 0, "pax": 3 },
    "lines": [{ "travellerType": "ADULT", "count": 2, "unitSellCents": 11500, "sellCents": 23000 }, …],
    "totals": { "totalCents": 28750 }               // staff also see netCents, markupBps, marginCents
  },
  "cancellation": { "freeUntil": "…", "windows": [ … ] }
}
```

— or explains itself: `{ "available": false, "date": "…", "reason": "SOLD_OUT" | "PARTY_SIZE" | "TOO_SOON" | "BEYOND_HORIZON" | "PAST" | "UNPRICED", … }`.

### Tour bookings

References are `TUR-000001`. The same rules as hotel bookings: no amount in any request, `Idempotency-Key` replays with 200, a guest reads or cancels with `?email=`.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/tours/bookings/holds` | `{ token }` → hold on the seats (15 min). 409 `UNAVAILABLE` if gone. |
| DELETE | `/tours/bookings/holds/:token` | Always 204. |
| POST | `/tours/bookings` | `{ holdToken \| offerToken, leadTraveller, travellers?, specialRequests?, pickupNote?, source? }`. 201, or 200 on replay. 409 `PRICE_CHANGED` / `UNAVAILABLE`, 410 spent token or hold. |
| GET | `/tours/bookings/:reference` | Detail from the snapshot. |
| GET | `/tours/bookings/:reference/cancellation-quote` | Read off the frozen schedule. |
| PATCH | `/tours/bookings/:reference` | Paperwork only: `leadTraveller`, `specialRequests`, `pickupNote`. |
| POST | `/tours/bookings/:reference/cancel` | `{ reason?, email? }` |
| GET | `/partner/tours/bookings` | Own bookings. `?status&tourId&from&to&search&page&pageSize` |

**On request.** An option with `confirmationMode: ON_REQUEST` is written as `PENDING` with its seats already claimed and a `requestDeadlineAt` (48 h). The operator answers through the admin register; declining releases the seats and charges nothing, and a traveller may cancel a pending request at no charge. Operations are alerted when a deadline passes.

### Admin → Tours

All under `/admin/tours`, admin only.

| Method | Path | Notes |
| --- | --- | --- |
| GET / POST | `/admin/tours` | Register (`?status&supplierId&…`) and create a DRAFT. |
| GET / PATCH / DELETE | `/admin/tours/:tourId` | Detail with `publishChecklist`; delete only with no bookings (409 `HAS_BOOKINGS`). |
| POST | `/admin/tours/:tourId/publish` · `/unpublish` · `/archive` | Publish answers 422 with `details.missing` until the checklist is clear. |
| GET / PUT | `/admin/tours/:tourId/translations`, `…/translations/:locale` | Every translation for the editor; a locale is written whole, prose only. |
| GET | `/admin/tours/policies/cancellation` | The platform templates a tour option may use — active, and priced against the whole total. |
| POST / PUT / PATCH / DELETE | `…/images`, `…/images/order`, `…/images/:imageId` | The gallery, as for hotels. |
| GET / POST | `…/options` | Options: `kind` SHARED\|PRIVATE, `pricingBasis` PER_PERSON\|PER_GROUP, `unitKind`, `scheduleKind`, `confirmationMode`, `visibility`, `minPax`/`maxPax`, `noticeHours`, `horizonDays`, `cancellationPolicyId` (percent-of-total policies only). |
| GET / PATCH | `…/options/:optionId`, `POST …/archive` | |
| POST / PUT / DELETE | `…/options/:optionId/seasons[/:seasonId]` | A season is written whole with its `tiers[]` (`minPax`, `maxPax?`, adult/child/infant/group net cents, optional fixed sell cents). Currency must be the tour's. |
| PUT | `…/options/:optionId/inventory` | `{ from, to, weekdays?, totalUnits?, blockedUnits?, stopSell?, departureTime?, note? }` — anything omitted keeps its value. 409 `OVERSELL` with the dates in the way. |
| GET | `…/options/:optionId/inventory/calendar?from&to` | One row per departure with derived `availableUnits`. |
| GET | `/admin/tours/bookings` · `/:reference` | Every tour booking. |
| POST | `/admin/tours/bookings/:reference/confirm` · `/decline` (`{ reason }`) · `/cancel` | The operator's answer to a request, and cancellation. |

Seeding: `node scripts/seed-tours.js` reads the ten editorial tours in `db/seed/tours.js` (prose in four languages), gives each a shared and a private option, a year of price sheets and departures, and publishes them. Requires `seed-reference.js` and `seed-catalogue.js` first.

## Services

A **service** is a priced thing without inventory: kosher meal delivery, Shabbat meals, a mashgiach, a synagogue transfer, a guide, equipment. It is sold through packages in this release; the standalone endpoints exist for partners and staff, and there is no public checkout page for one.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/services` | Browse. `?search&destinationSlug&category&kosher&locale&page&pageSize`. `unitPrice` is the buyer's own price for one unit of the service's `basis`. |
| GET | `/services/:slug` | Detail. `?locale=` |
| POST | `/service-bookings` | Partner or staff. `{ serviceId, date, time?, days?, quantity?, pax?, lead: { name, email, phone? }, notes?, source? }`. 201, or 200 on replay (`Idempotency-Key`). 409 `TOO_SOON` inside `noticeHours`, 422 `PAST` / `BEYOND_HORIZON` / `QUANTITY`. |
| GET | `/service-bookings`, `/service-bookings/:reference` | Own bookings (`SVC-000001`). `?status&serviceId&from&to&search&page&pageSize` |
| GET | `/service-bookings/:reference/cancellation-quote` · `POST …/cancel` | Off the frozen schedule; a pending request cancels at nothing. |

Basis: `PER_PERSON` (units = pax), `PER_GROUP` (1), `PER_DAY` (days), `PER_PERSON_PER_DAY` (pax × days). A service with `confirmationMode: ON_REQUEST` is written `PENDING` with a 48 h deadline; operations confirm or decline it from the register.

### Admin → Services

| Method | Path | Notes |
| --- | --- | --- |
| GET / POST | `/admin/services` | Register and create a DRAFT. `category`, `basis`, `netCents`, `sellCents?` (fixed sell), `currency`, `cancellationPolicyId` (percent-of-total template), `noticeHours`, `confirmationMode`, `isKosher`, `kosherAuthority?`, `supplierId?`, `destinationId?`. |
| GET / PATCH / DELETE | `/admin/services/:serviceId` | Detail with `publishChecklist`; a PATCH whose fixed `sellCents` would sit below the (stored or sent) `netCents` is 422 `SELL_BELOW_NET` with both figures; delete refuses 409 `HAS_BOOKINGS` / `IN_PACKAGE`. |
| POST | `…/publish` · `/unpublish` · `/archive` | Publish answers 422 with `details.missing` until the checklist is clear. |
| GET / PUT | `…/translations`, `…/translations/:locale` | Prose only. |
| GET | `/admin/services/bookings` · `/:reference` · `…/cancellation-quote` | Every service booking. |
| POST | `/admin/services/bookings/:reference/confirm` · `/decline` (`{ reason }`) · `/cancel` | The operator's answer to a request, and cancellation. |

## Packages

A package is an **admin-defined template with typed slots** — a hotel stay, a transfer, a tour, a service — each constrained to what the admin allows (a hotel and its room types, a journey and its vehicle classes, a tour and its options, one service). It has no price of its own: a quote for one start date and one party resolves every slot through that product's own engine, applies the package adjustment, and signs the lot. Everything in one currency; no FX.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/packages` | Browse. `?search&destinationSlug&destinationPath&kosher&minNights&maxNights&featured&locale&page&pageSize`. `priceFrom` is indicative (refreshed daily from sample dates); `kosher` is the declared profile. |
| GET | `/packages/:slug` | Detail: components with their constraints, gallery, kosher profile. |
| GET | `/packages/:slug/quote` | `?startDate&adults&childAges&rooms&choices&exclude&locale`. `choices` is a JSON object `{ "<slotIndex>": { ratePlanId \| hotelId \| vehicleId \| tourOptionId } }`; `exclude` lists optional slots to drop. |
| POST | `/packages/quotes/revalidate` | `{ token }` — re-prices a package offer; a moved price answers with `priceChanged`. |

A quote:

```jsonc
{
  "available": true, "unavailableReason": null,      // COMPONENT_UNAVAILABLE | ADJUSTMENT_BELOW_COST | KOSHER_INELIGIBLE
  "startDate": "2027-06-04", "endDate": "2027-06-06", "party": { … }, "currency": "GEL",
  "components": [{
    "slotIndex": 0, "componentType": "HOTEL_STAY", "label": "Two nights", "required": true, "included": true,
    "resolved": { "sellCents": 44000, "hotel": { … }, "roomType": { … }, "ratePlan": { … }, "token": "…" },
    "alternatives": [ … ],                            // other allowed choices for the slot, each with its own token
    "adjustmentCents": -4400, "lineTotalCents": 39600
  }, …],
  "adjustment": { "kind": "DISCOUNT_BPS", "value": 1000, "appliesTo": "REQUIRED_ONLY", "appliedCents": -8600 },
  "totals": { "componentsSellCents": 130000, "adjustmentCents": -8600, "totalCents": 121400 },   // staff also see net and margin
  "kosher": { "blockers": [], "warnings": [ … ], "overridden": false } | null,
  "token": "…"                                        // the composite offer; expires with its youngest child (30 min)
}
```

The adjustment (`NONE`, `DISCOUNT_BPS`, `FIXED_SELL`, `PER_PERSON_FIXED`, over `REQUIRED_ONLY` or `ALL_ITEMS`) is allocated across the eligible lines by largest remainder, so lines sum to the total exactly; the allocation is frozen onto the order and is what a partial cancellation reads.

**Kosher packages** are ordinary packages with a `kosher` profile: minimum hotel service level and certification, required meal codes, hotel request codes attached to every hotel component automatically, and Shabbat rules (`SOLAR` sunset from the hotel's coordinates, `FIXED_HOURS`, or `NONE`; no transfers in Shabbat, no tours on a rest day, extra rest days for festivals). The profile is validated when the template is saved (422 `KOSHER_INELIGIBLE` with per-slot `problems`), at every quote and again at confirmation; a certificate expiring mid-stay is a blocker, one expiring soon after is a warning frozen into the order.

### Recommendations

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/recommendations` | `?hotel=<slug>` or `?tour=<slug>`, `checkIn`, `checkOut?`, `adults`, `childAges`. Transfers to and from the nearest airport (cheapest class each way), tours with a departure during the stay (cheapest first), and active packages that contain the anchor, priced for those dates. Every card carries a real offer or is absent. |

### Admin → Packages

| Method | Path | Notes |
| --- | --- | --- |
| GET / POST | `/admin/packages` | Register (`?status&destinationId&kosher&search`) and create a DRAFT with its `components[]`. Components are always written whole; 422 `{ problems: [{ slotIndex, code }] }` names a slot that is `OUTSIDE_PACKAGE`, `NOT_FOUND`, `INACTIVE`, in another `CURRENCY`, or missing `ENDPOINTS` / `TOUR` / `OPTIONS`. |
| GET / PATCH / DELETE | `/admin/packages/:packageId` | Detail with `publishChecklist`; delete refuses 409 `HAS_ORDERS`. |
| POST | `…/publish` · `/unpublish` · `/archive` | |
| GET | `…/preview-quote?startDate&adults&childAges&rooms&choices` | The real quote for a draft, with staff figures — what a partner would see. |
| PUT / DELETE | `…/kosher` | The kosher profile; creating it is the switch. 422 `KOSHER_INELIGIBLE` lists the slots in the way. |
| PUT | `…/kosher/override` | `{ until, reason }` — sells past a blocker until a date, audited as `PACKAGE_KOSHER_OVERRIDDEN`; never silent. |
| GET / PUT | `…/translations`, `…/translations/:locale` | |
| POST / PUT / PATCH / DELETE | `…/images`, `…/images/order`, `…/images/:imageId` | The gallery. |
| PUT | `/admin/tours/:tourId/kosher` | `{ kosherMealsAvailable, operatesOnShabbat, notes? }` — what a kosher package may ask of a tour. |

## Orders

An **order** (`ORD-000001`) is a package booked as one thing: one transaction writes a hotel booking, a transfer booking, a tour booking and a service booking — each with its own reference, snapshot and cancellation terms — and one `OrderItem` per slot pointing at exactly one of them. Either every part is written or none is; the outcome is 201, a 409 that names every slot in the way, or a rolled-back 5xx. Children are readable on their own registers but **cannot be cancelled there** (409 `PART_OF_ORDER` with the order reference): the order is the only door.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/orders/holds` | `{ packageToken }` → `{ holdTokens: { "<slot>": token }, expiresAt }` — a hotel hold and a tour hold per such slot (15 min). |
| DELETE | `/orders/holds` | `{ holdTokens }`. Always 204. |
| POST | `/orders` | `{ packageToken, holdTokens?, leadGuest, travellers?, specialRequests?, requests?, flightNumber?, pickupAddress?, pickupPlace?, preferredDriverId?, source? }` (`pickupPlace` as on transfer bookings; it reaches the order's transfer). 201, or 200 on replay (`Idempotency-Key`). 409 `PRICE_CHANGED` `{ quotedCents, currentCents, components: [{ slotIndex, label, quotedCents, currentCents }] }`; 409 `UNAVAILABLE` `{ slots: [{ slotIndex, label, reason }] }`; 409 `KOSHER_INELIGIBLE`; 409 `PACKAGE_CHANGED` / `NOT_ON_SALE`; 410 spent token. |
| GET | `/orders/:reference` | Detail: items with their child bookings. A guest reads with `?email=`. |
| GET | `/orders/:reference/cancellation-quote` | Per item `{ chargeCents, refundCents, clawbackCents }` and totals, off frozen data. |
| PATCH | `/orders/:reference` | Paperwork only: `leadGuest`, `specialRequests`. |
| POST | `/orders/:reference/cancel` | `{ reason?, email? }` — every live part, in one transaction. |
| POST | `/orders/:reference/items/:slotIndex/cancel` | One optional part. A required part answers 409 `REQUIRED_COMPONENT` unless the caller is staff. |
| GET | `/partner/orders` | Own orders. `?status&packageId&from&to&search&page&pageSize` |

**Money.** `totalCents` is what the buyer pays; each item carries `sellCents` (its standalone price), `adjustmentCents` (its share of the package discount) and `lineTotalCents`. Cancelling a part refunds `max(0, sellCents − childCharge + adjustmentCents)`: the child's own frozen terms on its standalone price, less the discount share, which is forfeited (`clawbackCents`). Declining by a supplier charges nothing.

**On request.** An order with an `ON_REQUEST` tour or service is `PENDING_CONFIRMATION`: the child is `PENDING` with its seats claimed, the item `REQUESTED`, and `requestDeadlineAt` is the earliest deadline (48 h). The buyer may cancel it meanwhile at no charge. Once every part is answered the order becomes `CONFIRMED` and one voucher goes out listing every child reference. Declining an **optional** part drops it and shrinks the total; declining a **required** part cancels the whole order at no charge. Operations are alerted once when a deadline passes; nothing auto-declines.

Status: `PENDING_APPROVAL → PENDING_CONFIRMATION → CONFIRMED → PARTIALLY_CANCELLED | CANCELLED | COMPLETED`. Item status mirrors its child: `AWAITING_APPROVAL | REQUESTED | CONFIRMED | DECLINED | CANCELLED | COMPLETED | NO_SHOW`. See *Booking approval* below for the first step.

### The cart — `/orders/custom`

Owner decision OD2 (2026-10-20): hotels, transfers, tours, services and whole packages go into one cart and are booked as **one order of `kind: CUSTOM`** — one transaction, one approval, one receivable, one proforma. A package in the cart is flattened: its components become items of the custom order, each keeping `packageId`, `packageSlotIndex` and a shared `groupKey`, with the package's discount allocated over them exactly as the package quote allocated it (`adjustmentSource: "PACKAGE"`), so the package costs in the cart what it costs on its own and nothing is counted twice. A standalone item has no group and no adjustment (`"NONE"`); the desk's adjustment, when there is one, is spread over the standalone items (`"MANUAL"`). Behind `CART_ENABLED` (off: 404 `CART_DISABLED`).

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/orders/custom/quote` | `{ items, leadGuest? }` → `{ available, currency, startDate, endDate, items: [{ index, slotIndex, type, componentType, label, groupKey, quotedCents, currentCents, adjustmentCents, lineTotalCents, priceChanged, dates }], priceChanged, drifted, totals: { componentsSellCents, adjustmentCents, sellTotalCents } }` (staff with `finance.margin.read` also get `componentsNetCents`), or `{ available: false, reason: UNAVAILABLE \| MIXED_CURRENCY, … }`. Nothing is written. |
| POST | `/orders/custom/holds` | `{ items }` → `{ holds: { "<index>": token \| { "<slot>": token } }, expiresAt }` — a hotel hold and a tour hold per such item (a package's holds nested per slot, as `/orders/holds` gives them). |
| DELETE | `/orders/custom/holds` | `{ holds }` as returned. Always 204. |
| POST | `/orders/custom` | `{ items, leadGuest, name?, travellers?, requests?, specialRequests? }`. 201 with the order detail, or 200 on replay (`Idempotency-Key`; else a hash of the items and the lead). 409 `UNAVAILABLE` `{ items: [{ index, type, reason }] }` and 409 `PRICE_CHANGED` `{ items: [{ index, type, quotedCents, currentCents }] }` name every item in the way; 422 `MIXED_CURRENCY` `{ currencies }`; 422 `EMPTY`. |

**`items`** (1–20), each `{ type, label? , … }`: `HOTEL_STAY { offerToken, holdToken?, travellers?, requests?, specialRequests? }` · `TOUR { offerToken, holdToken?, travellers?, specialRequests? }` · `TRANSFER { quoteToken, flightNumber?, flights?, pickupAddress?, dropoffAddress?, pickupPlace?, dropoffPlace?, preferredDriverId?, preferredFleetVehicleId? }` · `SERVICE { serviceId, date, time?, days?, quantity?, pax?, quotedSellCents? }` · `PACKAGE { packageToken, holdTokens?, travellers?, requests?, flightNumber?, pickupAddress?, pickupPlace?, preferredDriverId?, preferredFleetVehicleId? }`. Per-item travellers and requests fall back to the order's. As everywhere: no amount.

The order reads, cancels and is approved exactly as a package order (`package.id` is `null`; `packageSnapshot` carries `{ kind: "CUSTOM", name, items, packages }`). Items are numbered in lock order (hotels, tours, transfers, services) and the order spans the earliest and latest item. Cancelling one item follows the item's own rule: a standalone item is optional; a package's required component answers 409 `REQUIRED_COMPONENT` to a buyer, as it would inside a package order. Every item carries `packageId`, `packageSlotIndex`, `groupKey` and `adjustmentSource` so the client can show a package's lines under their package.

### Admin → Orders

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/orders` | Every order; `?status=PENDING_CONFIRMATION` is the on-request queue, earliest deadline first. Rows carry `pendingCount`. `?status&packageId&partnerId&from&to&search&page&pageSize` |
| GET | `/admin/orders/:reference` · `…/cancellation-quote` | With net, margin and the frozen allocation. |
| POST | `/admin/orders/:reference/cancel` | `{ reason? }` |
| POST | `/admin/orders/:reference/items/:slotIndex/confirm` · `/decline` (`{ reason }`) · `/cancel` | The operator's answer to a request, and the override that cancels a required part on its own. |

## Booking approval — `/admin/booking-approvals`

Owner decision OD1 (2026-10-20): a booking made without an online payment — every booking, there being no card step — waits for an operator's **yes** before it is confirmed. It is written `PENDING_APPROVAL` with its inventory claimed (rooms, seats), owes nothing, and nobody outside the platform is told of it; the yes is the moment the platform used to confirm at. Rolled out behind `BOOKING_APPROVAL_ENABLED` (off: every booking is confirmed at once, as before). A partner whose `bookingApproval` an admin has set to `AUTO` (on `PATCH /admin/finance/partners/:id/terms`) keeps instant confirmation; everyone else, guests included, is `REQUIRED`.

What each product does while it waits, and on the answer:

| | Waiting | Yes | No / withdrawn / expired |
| --- | --- | --- | --- |
| Hotel | `PENDING_APPROVAL`, rooms claimed, no payable, no receivable | `CONFIRMED`; property told; payable + receivable opened (the proforma issues from there); guest gets `hotelBookingConfirmed` | `CANCELLED`, charge 0, rooms back, property never hears of it |
| Transfer | as hotel; legs exist but are **off the dispatch board**; a partner's chosen driver is kept on the row | `CONFIRMED`; voucher sent; the chosen driver is offered in its own transaction (a driver taken meanwhile leaves the legs for dispatch, with an audit note) | `CANCELLED`, charge 0 |
| Tour / service, instant | as hotel | `CONFIRMED`; operator told | as hotel |
| Tour / service, `ON_REQUEST` | `PENDING_APPROVAL`, seats claimed, **operator not yet asked** (`requestDeadlineAt` null) | `PENDING` with `requestedAt` / `requestDeadlineAt` set now; operator asked; then the existing confirm / decline | `CANCELLED`, charge 0 |
| Order | `PENDING_APPROVAL`, every item `AWAITING_APPROVAL`, every child `PENDING_APPROVAL`, no receivable | one yes for the whole order: items become `CONFIRMED` or `REQUESTED`, the order rolls to `CONFIRMED` / `PENDING_CONFIRMATION`, the receivable opens | the whole order and every child `CANCELLED` at no charge; one `bookingRejected` note, no `orderCancelled` |

A child of an order is decided **with its order** (409 `PART_OF_ORDER` on its own). A buyer may cancel a waiting booking through the ordinary cancel route at no charge (`cancellation-quote` answers 0; the booking reads `approval.state: "WITHDRAWN"`). The credit limit is checked again at the yes, because nothing counted against it while the booking waited. A second yes or no answers 409 `NOT_PENDING_APPROVAL`; two decisions racing answer 409 `STATUS_CHANGED` to the loser.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/booking-approvals` | The queue, earliest deadline first, order children excluded. Rows: `{ product, id, reference, status, title, when: { from, to }, leadName, leadEmail, partner, currency, totalCents, source, requestedAt, deadlineAt, overdue, createdAt }`. `?product&partnerId&overdue=true&search&page&pageSize`. `bookings.approve`. |
| POST | `/admin/booking-approvals/:product/:reference/approve` | `{ note? }`. `product` is `HOTEL \| TRANSFER \| TOUR \| SERVICE \| ORDER`. Answers the product's own detail plus `product`. 422 `CREDIT_LIMIT_EXCEEDED` leaves it waiting. |
| POST | `/admin/booking-approvals/:product/:reference/reject` | `{ reason }` — required; the buyer is told it. |

Every booking and order detail and summary now carries two blocks:

```jsonc
"approval": null | {                 // null: never waited for one
  "state": "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN",
  "requestedAt", "deadlineAt", "overdue",
  "approvedAt", "approvedBy",        // the operator's name, snapshotted
  "rejectedAt", "rejectedBy", "reason"
},
"payment": {                         // the ledger's word, in the desk's terms
  "status": "NONE" | "UNPAID" | "PARTIAL" | "OVERDUE" | "PAID" | "WAIVED" | "VOID",
  "via": "BOOKING" | "ORDER",        // an order's child is paid through the order
  "receivableId", "dueAt", "amountCents", "paidCents", "outstandingCents"
}
```

**On the clock.** Past `approvalDeadlineAt` (`BOOKING_APPROVAL_SLA_HOURS`, default 24) operations are told once (`BOOKING_APPROVAL_OVERDUE` in-app, `bookingApprovalOverdue` to `BOOKING_OPS_EMAIL`); nothing is rejected at the deadline. A booking still waiting when its service date has passed is rejected by the sweeper as the system (audit `BOOKING_APPROVAL_EXPIRED`), because nobody can approve a stay that has begun.

**Who is told.** On arrival: holders of `bookings.approve` in-app (`BOOKING_AWAITING_APPROVAL`, minus whoever booked), the buyer by `bookingAwaitingApproval`, the desk mailbox by `bookingApprovalQueue`. On a yes: the partner's `partner.bookings.read` holders in-app (`BOOKING_APPROVED`), then the confirmation the buyer would have had. On a no: `BOOKING_REJECTED` in-app and `bookingRejected` by email. The badge is `pendingBookingApprovals` (null for anyone who cannot approve). Audit: `BOOKING_APPROVED`, `BOOKING_REJECTED`, `BOOKING_APPROVAL_EXPIRED`, `PARTNER_BOOKING_APPROVAL_CHANGED`.

**`source`** on every booking is now read off the session — `PARTNER`, `ADMIN` or `WEB` (a `BookingSource` enum; manual bookings name their channel) — and the `source` a client sends is ignored.

## The register of every booking — `/admin/bookings/all`

One list across hotels, transfers, tours, services and orders, read from the
booking index (`booking_index`): a projection the services keep in step in
the same transaction as every status, money and desk change, and that a daily
reconcile (and `node scripts/backfill-booking-index.js`) rebuilds from the
product tables. Children of an order are listed under their order unless
`children=true`.

`GET /admin/bookings/all` (`bookings.read`) and `GET /partner/bookings/all`
(the partner's own) take `?product[]&status[]&paymentStatus[]&invoiceStatus[]&partnerId&customerId&managerId&destinationId&source[]&approval=PENDING|OVERDUE&from&to&createdFrom&createdTo&search&sort&children&page&pageSize`
and answer rows of `{ product, id, reference, status, kind, title, leadName, leadEmail, partnerId, customerId, assignedManagerUserId, partner: { id, name } | null, customer: { id, name, kind } | null, assignedManager: { id, name } | null, order, destinationId, startDate, endDate, startAt, currency, totalCents, payment: { status, receivableId, dueAt, paidCents }, approval, source, href, createdAt, confirmedAt, cancelledAt }` (the names are looked up once per page, never denormalised into the index).
`search` is one trigram-indexed match over reference, names, email, title, partner and customer.

**The same filters on every product register.** `GET /admin/bookings`, `/admin/transfers/bookings`, `/admin/tours/bookings`, `/admin/services/bookings`, `/admin/orders` and the partner lists all take, beside their own fields, `paymentStatus[]` (`NONE UNPAID PARTIAL OVERDUE PAID WAIVED VOID`, read through the booking's receivable or its order's), `invoiceStatus[]`, `paymentMethod`, `createdFrom`/`createdTo`, `customerId`, `managerId`, `destinationId`, `source[]`, `approval=PENDING|OVERDUE` and `sort` (`created:desc|asc`, `date:asc|desc`, `due:asc|desc`, `total:desc|asc`; each list keeps its own default). The transfer register now also takes `partnerId`.

## Deadlines and reminders — `/admin/deadlines`

Three deadlines per booking, projected into `booking_deadlines` beside the
booking index and rebuilt with it: **PAYMENT** (the receivable's `dueAt`),
**FREE_CANCELLATION** (the last free moment of the frozen cancellation
schedule; the earliest room's, for a hotel) and **CONFIRMATION** (the
platform's approval deadline — `meta.awaiting: "PLATFORM"` — or the
supplier's answer deadline — `"SUPPLIER"`). Status `OPEN | MET | MISSED |
CANCELLED`; `source` `SYSTEM | MANUAL`. A child of an order carries no
PAYMENT row (the order's receivable is what is paid) and no approval row
of its own while the order waits as one.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/deadlines` | `?kind[]&status[]&product[]&partnerId&managerId&customerId&reference&bookingId&from&to&sort=soonest|latest&page&pageSize` (instants for from/to; `reference` or `bookingId` for one booking's three rows). `bookings.read` or `finance.receivables.read`. Rows: `{ id, kind, status, source, product, bookingId, reference, title, leadName, partnerId, customerId, assignedManagerUserId, partner: { id, name } \| null, customer: { id, name, kind } \| null, assignedManager: { id, name } \| null, receivableId, dueAt, timezone, overdue, daysLeft, meta, completedAt, href }` (names looked up once per page). |
| GET | `/admin/deadlines/:id` | With `history: [{ fromAt, toAt, source, reason, changedBy, at }]`. |
| PATCH | `/admin/deadlines/:id` | `{ dueAt, reason }`. **The truth moves first, under its kind's rule**: PAYMENT goes through the receivable (`finance.adjustments.execute`, else 403 `APPROVAL_REQUIRED` with `kind: RECEIVABLE_DUE_DATE` and the `receivableId`: nothing is raised for the caller — the panel then opens the request itself with `POST /admin/approvals { kind: RECEIVABLE_DUE_DATE, subjectId: receivableId, payload: { dueAt, reason } }`, as Finance's own due-date edit does); FREE_CANCELLATION rewrites the frozen schedule's free window on every live room, so what cancelling costs follows the date (`bookings.deadlines.write`); CONFIRMATION moves the approval or request stamp the sweepers read (`bookings.deadlines.write`). The row is then `MANUAL`, with a history entry; audit `BOOKING_DEADLINE_CHANGED`. 409 `DEADLINE_CLOSED` once met or cancelled. |
| GET | `/partner/deadlines` | The partner's own, same query and shape, `href` into the portal. |
| GET/PUT | `/admin/settings/reminder-policies` | The schedule: one platform row per kind (`scope: "PLATFORM"`) and partner overrides (`?partnerId=` lists both). `PUT { kind, partnerId?, offsetsDays: [7,3,1,0], channels: ["IN_APP","EMAIL"], recipients: ["STAFF","PARTNER","GUEST"], enabled, remove? }` (`settings.reminders.write`; `remove: true` drops a partner's override and needs no schedule in the body; the platform row is switched off, never removed → 422 `PLATFORM_POLICY`). Audit `REMINDER_POLICY_UPDATED`. |

**Reminders.** `sweepDeadlineReminders` (`DEADLINE_SWEEP_INTERVAL_MS`, behind `DEADLINE_REMINDERS_ENABLED`) claims each (deadline, offset) once per the policy that applies — a partner's own row when it has one, the platform's otherwise — counting calendar days in the deadline's own timezone exactly as the supplier reminders do, collapses several offsets claimed together to the smallest, and writes one `booking.deadline.upcoming` event. The handler re-reads the row and says nothing once it is met or closed; otherwise STAFF are told in-app (`finance.receivables.read` holders for money, `bookings.write` holders for the rest), the partner's `partner.bookings.read` holders in-app and its contact by `deadlineReminder` email, and a guest or desk customer by email — each per the policy's channels and recipients, deduped per recipient (`deadline:<id>:<offset>`). Rows past their moment are marked MISSED by the same sweep (the overdue *alerts* for money and approvals stay where they were). Notification kinds `DEADLINE_PAYMENT_UPCOMING`, `DEADLINE_CANCELLATION_UPCOMING`, `DEADLINE_CONFIRMATION_UPCOMING`, category `DEADLINE`.

## Manual bookings — the desk

A booking made at the desk — by phone, by email, through another agency, or face to face — for a partner or for a customer with no account. The same products, the same confirmation bodies, the same ledger, the same approval step: the booking is made *as the buyer* (`lib/booking/onBehalf.js`), so a partner's own prices, product access, commission and credit limit apply, and `bookedBy` stays the member of staff. `bookings.write` to create; `bookings.price.override` to change the price; `bookings.approve` to confirm at once.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/admin/bookings/manual` · `/admin/transfers/bookings/manual` · `/admin/tours/bookings/manual` · `/admin/services/bookings/manual` · `/admin/orders/manual` | `{ buyer, channel, confirmNow?, priceAdjustment?, assignedManagerUserId?, internalNotes?, booking }` where `booking` is the product's ordinary confirmation body (hold or offer token, lead guest, …) and answers the product's detail. 201, or 200 on replay (`Idempotency-Key`). |
| POST | `/admin/orders/custom/manual` | The cart at the desk: the same envelope with `booking` = the `POST /orders/custom` body (`items`, `leadGuest`, …). Several products for one buyer as one CUSTOM order; `priceAdjustment` is spread over the standalone items (`adjustmentSource: "MANUAL"`) and audited once on the order. Works whether or not `CART_ENABLED` is on. |
| PATCH | `…/:reference/desk` on the same five registers | `{ assignedManagerUserId?, internalNotes? }` — audited `BOOKING_MANAGER_ASSIGNED` / `BOOKING_NOTES_CHANGED`. The manager must be an active member of staff (422 `NOT_STAFF`). |
| GET/POST | `/admin/customers` | `?q&kind&page&pageSize`; `{ kind: INDIVIDUAL \| COMPANY, name, contactName?, email, phone?, billingAddress?, city?, country?, taxId?, notes? }`. Read with `bookings.read`, written with `bookings.write`. |
| GET/PATCH | `/admin/customers/:id` | The customer with its bookings across every product. |

**`buyer`** is `{ kind: "PARTNER", partnerId }` (the partner must be APPROVED, else 422 `PARTNER_INACTIVE`) or `{ kind: "CUSTOMER", customerId }` / `{ kind: "CUSTOMER", customer: { … } }` (created first, outside the booking's transaction, so a refused booking still leaves the customer to try again with). **`channel`** is `PHONE | EMAIL | EXTERNAL_AGENCY | DIRECT` and becomes the booking's `source`.

**Searching as the buyer.** An offer token is priced for the viewer it was issued to, so a booking for a partner is searched as that partner: the desk sends `X-Act-As-Partner: <partnerId>` on `/search/*`, `/transfers/quotes`, `/tours/*`, `/packages/*`, `/orders/custom/quote` and `/orders/custom/holds`, and is that partner for the request (`bookings.write` only; anyone else is 403 `ACT_AS_FORBIDDEN`). A customer with no account is searched as the member of staff: trade inventory at the default markup, which is the desk's prerogative and is audited with the booking.

**Price (OD3).** `priceAdjustment: { cents, reason }` is a signed figure on top of the catalogue price, never a replacement of it: the row keeps `sellTotalCents`, rooms and nights still add up, the cancellation schedule still reads the catalogue sell, and the buyer's `totalCents`, the receivable and a cancellation refund are the catalogue price plus the adjustment (`lib/booking/desk.js`). Audited `BOOKING_PRICE_ADJUSTED` with both figures and the reason. 403 with `details.fields: ["priceAdjustment"]` without the capability.

**The desk block.** Staff who may see the buyer (`partners.read`) get `desk` on every booking and order: `{ source, customer, assignedManager, internalNotes, priceAdjustment }` — on an order without `priceAdjustment`, whose adjustment lives on its items (`adjustmentSource: "MANUAL"`). A partner or a guest never sees it. A customer who owes money is the receivable's `debtorCustomerId` (`debtor.customer` on the finance serializers) and gets its own client record at the invoicing provider, filed under `customer:<id>`.

## Admin

All under `/admin/*`, guarded by `authenticate + requireAdmin`.

### Hotels

| Method | Path |
| --- | --- |
| GET / POST | `/admin/hotels` |
| GET / PATCH | `/admin/hotels/:id` — `latitude`/`longitude` as a pair, nullable together to take the pin off the map (which also clears `place`); `place?` only alongside a pair |
| POST | `/admin/hotels/:id/publish` · `/unpublish` · `/archive` |
| PUT | `/admin/hotels/:id/amenities` — `{ amenities: [{ amenityId, note? }] }` |
| POST / PATCH / DELETE | `/admin/hotels/:id/images` · `/images/:imageId` |
| PUT | `/admin/hotels/:id/images/order` — `{ order: [imageId] }` |
| PUT | `/admin/hotels/:id/translations/:locale` |
| GET / PUT / DELETE | `/admin/hotels/:id/kosher` |
| POST | `/admin/hotels/:id/kosher/certifications` |
| PATCH / DELETE | `…/kosher/certifications/:certId` |
| POST | `…/kosher/certifications/:certId/verify` |
| GET / POST | `/admin/hotels/:id/documents` |
| DELETE | `/admin/hotels/:id/documents/:documentId` |
| POST | `/admin/bookings/:reference/requests/:requestId` |

`GET /admin/hotels/:id` and every mutation return the hotel plus
`publishChecklist: [{ code, message }]`. `POST /publish` answers **422** with
`details.missing` when it is not empty. There is no DELETE.

Create takes only: `slug, name, propertyType, destinationId, starRating,
supplierId?, countryCode?, timezone?, currency?`. Everything else is PATCH.

### Kosher

`PUT /admin/hotels/:id/kosher` creates the record, and **creating it is the
switch**: a hotel with no kosher row shows no kosher block anywhere, matches no
kosher filter, and renders no kosher admin section.

```jsonc
// PUT /admin/hotels/:id/kosher   → 201 on create, 200 on update
{ "serviceLevel": "FULL", "notes": "Glatt kosher kitchen.",
  "contactName": "Front office", "contactEmail": "kosher@example.ge" }
```

`serviceLevel` is required — the column's default exists so it can be NOT NULL,
not so the API can classify a property nobody assessed.

**There is no `verification` field in any of these schemas.** Marking a
certificate verified is `POST …/certifications/:certId/verify`, a transition of
its own with its own audit action — the same treatment `status` gets on a hotel.
`PATCH /admin/hotels/:id` is strict and has no kosher key at all, so no ordinary
hotel update can reach certification.

```jsonc
// POST …/kosher/certifications/:certId/verify
{ "decision": "VERIFIED" | "REJECTED" | "PENDING_VERIFICATION", "notes": "…" }
```

`notes` is required for anything but an approval. Editing a verified
certificate's authority, reference, scope, dates or document withdraws its
verification and clears the verifier: verification attaches to a set of facts,
not to a row id. Every mutation answers with the **whole** kosher block,
re-derived.

`DELETE /admin/hotels/:id/kosher` is a **409** while a live certificate exists —
removing the record would cascade its history away with it. Archive first, or
set `serviceLevel: "NONE"`.

Facilities are **not** written here. They are ordinary amenities in the
`KosherFood`, `Shabbat` and `Religious` categories, written through
`PUT /admin/hotels/:id/amenities` like any other, and *projected* into
`kosher.features` on read — so there is exactly one place a facility lives.

### Documents

`HotelDocument` is the private file library: a `docType` machine key, an optional
`validUntil`, and no URL anywhere in the response. Reaching the bytes is
`GET /admin/media/:id/url`, which is authorized and audited as
`PRIVATE_FILE_ACCESSED`. Attaching requires a **private** asset; upload it as
`KOSHER_CERTIFICATE` (PDF or an image, stored private, no gallery renditions).
Detaching is a 409 while a verified certificate points at it.

### Rooms, rates, inventory

| Method | Path |
| --- | --- |
| GET / POST | `/admin/hotels/:hotelId/room-types` |
| GET / PATCH | `…/room-types/:roomTypeId` |
| POST | `…/room-types/:roomTypeId/archive` |
| PUT | `…/room-types/:id/beds` — `{ beds: [{ bedTypeCode, quantity, groupIndex }] }` |
| PUT | `…/room-types/:id/amenities` |
| POST/PATCH/DELETE/PUT | `…/room-types/:id/images`, `/images/:imageId`, `/images/order` |
| GET / POST | `…/room-types/:id/rate-plans` |
| GET / PATCH | `…/rate-plans/:ratePlanId` |
| POST | `…/rate-plans/:id/archive` |
| POST/PUT/DELETE | `…/rate-plans/:id/restrictions[/:restrictionId]` |
| **PUT** | `…/room-types/:id/inventory` — the bulk editor |
| **GET** | `…/room-types/:id/inventory/calendar?from&to` |
| **PUT** | `…/rate-plans/:id/rates` — the bulk editor |
| GET / PUT | `/admin/hotels/:id/child-policy` |
| GET/POST/PUT | `/admin/hotels/:id/policies/cancellation[/:policyId]` |
| GET/POST/PUT | `/admin/hotels/:id/policies/payment[/:policyId]` |
| GET / PUT | `/admin/hotels/:id/meal-plans` |
| GET/POST/PUT/DELETE | `/admin/hotels/:id/tax-fees[/:taxFeeId]` |

**Bulk range body** (both inventory and rates):

```jsonc
{ "from": "2027-12-01", "to": "2027-12-31",
  "weekdays": [1,2,3,4],           // ISO, 1=Mon. Omit for every day
  "totalUnits": 5, "stopSell": false, "minStay": 2,
  "closedToArrival": false, "closedToDeparture": false }
```

```jsonc
{ "from": "2027-12-01", "to": "2027-12-31", "weekdays": [5,6,7],
  "netCents": 12500, "sellCents": null,
  "extraAdultCents": 3000, "extraChildCents": null, "singleOccupancyCents": null,
  "closed": false }
```

**Anything omitted keeps its existing value.** Returns `{ nights, days }`.
409 with `details.conflicts[{ date, committed }]` if a reduction would oversell.
A fixed `sellCents` replaces the markup entirely, so it may never sit below
`netCents`: 400 when one request carries both, 422 `SELL_BELOW_NET` (with the
`netCents` or `sellCents` already on those nights) when a half-update would get
a night there, and the table's `rates_sell_gte_net` CHECK beneath both. The
same rule applies to a service's `netCents`/`sellCents`.

**Calendar response**

```jsonc
{ "roomType": { "id": "...", "name": "...", "code": "..." },
  "nights": [{
    "date": "2027-12-01",
    "totalUnits": 5, "blockedUnits": 0, "bookedUnits": 1, "heldUnits": 0,
    "availableUnits": 4,
    "stopSell": false, "minStay": null, "closedToArrival": false, "closedToDeparture": false,
    "rates": [{ "ratePlanId": "...", "ratePlanName": "...", "netCents": 12500, "sellCents": null, "closed": false }]
  }] }
```

### Everything else

| Method | Path |
| --- | --- |
| GET/POST | `/admin/destinations`, `GET /admin/destinations/tree` |
| GET/PATCH/DELETE | `/admin/destinations/:id` — `latitude`/`longitude` as a pair or neither; on PATCH an explicit `null` pair takes the pin off the map and clears `place`. `place?` is what Google Places said when the pin was set: `{ placeId, name, formattedAddress, city, region, countryCode, types }`, every field but `placeId` nullable, accepted only alongside a pair, and answered as `place` (null for pins placed by hand) on destinations, hotels and pick-up points alike |
| PUT | `/admin/destinations/:id/translations/:locale` |
| GET/POST | `/admin/amenities`, `GET/PATCH /admin/amenities/:id` |
| GET/POST | `/admin/media` (multipart: `file`, `category`, `altText?`) |
| GET/DELETE | `/admin/media/:id`, `GET /admin/media/:id/url` (signed, private only) |
| GET | `/admin/bookings`, `/admin/bookings/:reference` |
| GET | `/admin/bookings/summary?days=30` — `{ activeCount, recent: { days, from, byCurrency: [{ currency, amountCents, count }] } }`; `recent` is what was **created** in the window, PENDING and CONFIRMED only, summed in the database; `days` 1–365 |
| GET | `/admin/badges` — the panel's queue counts in one request: `{ pendingPartners, activeBookings, unassignedLegs, pendingTourRequests, pendingOrders }`. Operations roles; a DISPATCHER gets `unassignedLegs` and `null` for the rest |
| POST | `/admin/bookings/:reference/cancel` |
| GET/POST | `/admin/pricing-rules`, `GET /admin/pricing-rules/explain?partnerId&hotelId&tourId&serviceId&packageId&productType&destinationId` — a rule names at most one product (`hotelId` / `tourId` / `serviceId` / `packageId`) and optionally a `productType` (`HOTEL` `TRANSFER` `TOUR` `SERVICE` `PACKAGE`); specificity is partner 8 + named product 4 + destination 2 + product type 1 |
| PUT/DELETE | `/admin/pricing-rules/:id` |

Media categories decide visibility, not the caller: `HOTEL_IMAGE`, `ROOM_IMAGE`,
`AMENITY_ICON` are public; `CONTRACT`, `RATE_SHEET`, `INVOICE`, `VOUCHER`,
`IMPORT`, `OTHER` are private and have **no URL** — fetch `/url` for a
60-second signed link.

## Users, roles and capabilities

Eleven roles. Platform side, never attached to a partner: `SUPER_ADMIN`,
`ADMIN`, `MANAGEMENT`, `TOUR_OPERATOR`, `ACCOUNTANT`, `DISPATCHER`, `DRIVER`.
Partner side, always attached to one: `PARTNER_OWNER`, `PARTNER_ADMIN`,
`PARTNER_AGENT`, `PARTNER_FINANCE`. The database CHECK enforces the split.

What a role may do is a list of **capabilities**. The names live in code
(`server/lib/permissions.js`: each is a check somewhere, and a row cannot
invent a check); which of them a role carries is data (`roles`,
`role_capabilities`, seeded from the code's defaults), which roles an account
holds is data (`user_roles`; the one the panels label the account with is
`users.primary_role_id`, a reference into `roles` that a trigger keeps among
the `user_roles` rows — the old `role` enum column is gone, and the API's
`role` field is that primary role's key), and the odd capability granted to or denied an account by
name, with a reason and optionally a last day, is data too
(`user_capability_overrides`). Every request resolves the account's
capabilities from those rows — a super admin holds everything on the platform
side, computed — so an edit applies on the next request with no sign-out.
The signed-in user's resolved list travels on `user.capabilities` in the
sign-in response and on `GET /api/auth/me`, sorted, beside `user.roles`
(`[{ key, name, isSystem }]`), so a client decides what to show from that
rather than from a copy of the role table. Names are `area.verb`:
`catalogue.write`, `bookings.cancel`, `finance.margin.read`,
`users.staff.manage`, `partner.team.manage`, `partner.bookings.write`, and so
on. A 403 from a capability guard says what was missing:
`{ error: { details: { reason: "INSUFFICIENT_CAPABILITY", required: ["…"] } } }`.

What the platform roles reach in the admin panel:

| Area | Read | Change |
| --- | --- | --- |
| Catalogue — destinations, amenities, hotels, tours, services, packages, transfer points/vehicles/routes | every staff role | `SUPER_ADMIN`, `ADMIN` (`catalogue.write`); tours also `TOUR_OPERATOR` (`tours.write`) |
| Hotel prices — rates, rate plans, taxes and fees, cancellation and payment policies, child charges, a hotel's supplier and currency, a package's discount, the markup rules | as the catalogue | `pricing.write` on top of the catalogue capability: `SUPER_ADMIN`, `ADMIN`. A request that carries a priced field without it is refused (403 with `details.fields`), never quietly stripped |
| A hotel's contracts and documents | the list: `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `TOUR_OPERATOR`, `ACCOUNTANT`; opening a file goes by its category — a contract or rate sheet needs `partners.financial.read`, a payment slip or invoice `finance.payments.read`, a driver's papers `dispatch.read`, a certificate `catalogue.read` | `SUPER_ADMIN`, `ADMIN` |
| Bookings and orders, every company | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `TOUR_OPERATOR`, `ACCOUNTANT` (transfers: also `DISPATCHER`) | confirm/decline and cancel: `SUPER_ADMIN`, `ADMIN`, `TOUR_OPERATOR` |
| Fleet, drivers, dispatch | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `TOUR_OPERATOR`, `DISPATCHER` | `SUPER_ADMIN`, `ADMIN`, `TOUR_OPERATOR`, `DISPATCHER` (deleting a car or a driver: admins) |
| Partners | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `TOUR_OPERATOR`, `ACCOUNTANT` | `SUPER_ADMIN`, `ADMIN` |
| A partner's bank details | `SUPER_ADMIN`, `ADMIN`, `ACCOUNTANT` | `SUPER_ADMIN`, `ADMIN` |
| Pricing rules | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `ACCOUNTANT` | `SUPER_ADMIN`, `ADMIN` |
| Payments, refunds, write-offs, payment terms | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `ACCOUNTANT`; the ledger and its payments also `FINANCE_OPERATOR` | `SUPER_ADMIN`, `ACCOUNTANT`; payments also `FINANCE_OPERATOR`; terms `finance.terms.write` |
| A partner's commission rate | as the partner | `finance.commission.write` on top of `partners.write`: `SUPER_ADMIN`, `ADMIN` (the accountant holds it for the commission screens to come) |
| Net, markup and margin in any response | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `ACCOUNTANT` | — |
| A partner's history (`/admin/partners/:id/audit`) | `audit.read`: `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `ACCOUNTANT` | — |

Reading every booking is not changing one. On the public booking routes
(`/bookings`, `/tours/bookings`, `/transfers/bookings`, `/orders`) a staff
session is refused at the router unless it holds `bookings.write` or
`bookings.cancel` (403 `INSUFFICIENT_CAPABILITY`), and beneath that the
services answer a desk that reads but may not change — management, finance —
as they would a stranger, with a 404. The identity on `/auth/me` and
`/partner/me` never carries bank details; `GET /partner/financial` and
`GET /admin/partners/:id/financial` (`partners.financial.read`) do.
| Which agency bought a booking | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `TOUR_OPERATOR`, `ACCOUNTANT` | — |

`GET /admin/badges` answers every staff role, with `null` for each queue the
role does not work (a dispatcher gets `unassignedLegs` only; finance gets
everything but `unassignedLegs`).

On the partner side, `PARTNER_FINANCE` reads the company's bookings and its
bank details but makes, holds, amends and cancels nothing: every change on
`/bookings`, `/transfers/bookings`, `/tours/bookings`, `/orders` and
`/service-bookings` needs `partner.bookings.write` or `partner.bookings.cancel`
(403 `INSUFFICIENT_CAPABILITY`). Editing the company profile needs
`partner.profile.write` (owner, admin); the bank details need
`partner.financial.read`/`.write` (owner, finance).

### Staff accounts — `/admin/users`

`users.staff.manage`, which only `SUPER_ADMIN` holds: an `ADMIN` gets 403.
Drivers are not here; they are managed with their profiles under
`/admin/transfers/drivers`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/users?role&status&q&page&pageSize` | `status` ∈ `INVITED` `ACTIVE` `DEACTIVATED`; `role` repeatable; envelope `{ data, total, page, pageSize, totalPages }` |
| POST | `/admin/users` | `{ email, firstName, lastName, role, position?, phone? }`, `role` ∈ `ADMIN` `MANAGEMENT` `TOUR_OPERATOR` `ACCOUNTANT` `FINANCE_OPERATOR` `DISPATCHER`. 201 `{ user, link: { kind: "activation", url, expiresAt }, email, emailSent }` — the link is returned as well as emailed, as for partners and drivers. 409 `{ field: "email" }` when taken |
| GET | `/admin/users/:id` | `status` is derived: no password yet → `INVITED`; switched off → `DEACTIVATED`; else `ACTIVE`. Carries `invitedBy`, `invitedAt`, `deactivatedBy`, `deactivatedAt`, every role held (`roles`), the overrides written for the account (`overrides`) and what it resolves to (`capabilities`) |
| GET | `/admin/users/grantable` | What the caller may hand out to a new staff account: `{ roles, capabilities }`, the same answer as below without naming an account; the invite form's role list |
| GET | `/admin/users/:id/grantable` | What the caller may hand out: `{ roles, capabilities }` — the roles it dominates (never `DRIVER`) and the capabilities it holds that may be written by name |
| PUT | `/admin/users/:id/roles` | `{ roles: [key…] }`, the whole set the account holds afterwards. The first by order (a built-in role before a panel-made one) becomes `role`, the primary. Every role must be on the platform side (400 `ROLE_WRONG_SIDE`) and within the caller's own capabilities (403 `ROLE_ABOVE_CEILING` with `details.missing`). Ends the account's sessions |
| PATCH | `/admin/users/:id/role` | `{ role }`: the single-role form of the above |
| POST | `/admin/users/:id/overrides` | `{ capability, effect: GRANT \| DENY, reason, expiresAt? }`. A grant needs the caller to hold the capability; a denial needs only that it may manage the account; the capabilities that hand out everything else (`platform.admin`, `users.staff.manage`, `roles.manage`, `settings.write`, `partner.team.manage`) are never written this way (403 `PROTECTED_CAPABILITY`). One row per capability: writing it again replaces the reason and the last day. 201 with the account |
| DELETE | `/admin/users/:id/overrides/:capability` | Takes the override back |
| POST | `/admin/users/:id/deactivate` | `{ reason? }`; sessions end now and every unused activation or reset link is spent. 409 `NOT_ACTIVATED` for an invitation — delete it instead |
| POST | `/admin/users/:id/reactivate` | |
| POST | `/admin/users/:id/sessions/revoke` | `{ user, revoked }` |
| POST | `/admin/users/:id/activation/resend` | a fresh link; the old one stops working |
| DELETE | `/admin/users/:id` | `{ confirm: email }` must match. Only `INVITED` or `DEACTIVATED` accounts (409 `STILL_ACTIVE`); bookings the person made keep their rows |

Nobody may change, deactivate or delete their own account through these
(400 `SELF`). Invitations are limited per inviter (`AUTH_INVITE_LIMIT`).

The rule under every grant, invitation and change above: **nobody hands out,
or touches, more than they hold.** An actor may give a role, write an
override, or act on an account only if it holds every capability the role
carries or the account resolves to; holding every capability of a *peer* is
not outranking it, so only a super admin manages super admins and only an
owner other owners. A partner admin therefore cannot invite a finance user
(it does not hold `partner.financial.write`), which is what stops it from
opening the returned activation link and changing the bank details as them.

### Roles — `/admin/roles`

`roles.manage`, which only `SUPER_ADMIN` holds. The system roles are seeded
and keep their key and side for good; what a super admin or a driver may do
is fixed (409 `ROLE_LOCKED`); everything else about a role is data.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/roles?side` | `{ data: [{ id, key, name, description, side, isSystem, sortOrder, capabilities, members }] }` |
| GET | `/admin/roles/capabilities` | Every capability there is, grouped by area, and which are `protected` |
| GET | `/admin/roles/:key` | |
| POST | `/admin/roles` | `{ key, name, description?, side: PLATFORM \| PARTNER, capabilities }`. A key is lower case (`^[a-z][a-z0-9_]{2,40}$`), so a panel-made role can never be mistaken for a system one; a platform role carries no `partner.*` capability and a partner role only those and the bell (400 `CAPABILITY_WRONG_SIDE`); a capability goes into a role only from a caller who holds it (403 `ROLE_ABOVE_CEILING`). Audited `ROLE_CREATED` |
| PATCH | `/admin/roles/:key` | `{ name?, description?, capabilities? }`, the whole capability set afterwards. Adding is handing out (the ceiling applies); removing is not. Audited `ROLE_UPDATED` with `{ changes: { capabilities: { added, removed } } }` |
| DELETE | `/admin/roles/:key` | Never a system role (409 `SYSTEM_ROLE`), never one still held (409 `ROLE_IN_USE`). Audited `ROLE_DELETED` |

### Contract, terms and the end of a partnership

A company trades on the platform under a signed agreement and the platform
terms in force. Both are gates, not paperwork.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/invitations/:token` | the preview now carries `terms: { version, url }`, the text to present and the version to send back |
| POST | `/invitations/:token/accept` | now carries `terms: { accepted: true, version }`; any version but the current one is 400 `TERMS_VERSION_STALE` with `current`. Stamped on the company, audited `PARTNER_TERMS_ACCEPTED` |
| POST | `/admin/partners/:id/contract` | `partners.contract.write` (super admin, admin). Multipart: `file` (a PDF, filed as a private `CONTRACT` the company owns), `signedAt` (YYYY-MM-DD), `version?`. A second upload replaces the first; audited `PARTNER_CONTRACT_UPLOADED` |
| GET | `/admin/partners/:id/contract` · `/partner/contract` | `partners.contract.write` or `partners.financial.read`; the company's own users for their own. A short-lived `{ url, expiresAt }`, audited as every private file is. 404 when nothing is on file |
| PUT | `/admin/partners/:id/contract-requirement` | `partners.contract.write`: `{ contractRequired, reason }`. Companies approved before the gate existed were grandfathered (`contractRequired: false`); waiving it for a new one is an admin's decision, on the trail |
| POST | `/admin/partners/:id/approve` | 400 `CONTRACT_MISSING` while `contractRequired` and no contract is on file. The same on `POST /admin/partners` in `approve` mode, which takes `contract: { assetId, signedAt, version? }` (a `CONTRACT` file uploaded through `/admin/media` first, re-parented to the new company) or `contractRequired: false` |
| GET | `/partner/terms` | In every status: `{ current, url, acceptedVersion, acceptedAt, outdated }` |
| POST | `/partner/terms/accept` | `partner.terms.accept` (the owner): `{ version }`, the current one or 400 `TERMS_VERSION_STALE`. Audited |
| POST | `/admin/partners/:id/block` | `partners.write`: `{ reason }`, from APPROVED or SUSPENDED. Sessions end at once; signing in answers 403 `{ reason: "PARTNER_BLOCKED" }` after the password check. `unblock` puts the company back to APPROVED as it was |
| POST | `/admin/partners/:id/terminate` | `{ reason, confirm: <Partner ID> }`, from any status but TERMINATED, and nothing leads out of it: every account is deactivated, every open link spent, every invitation withdrawn, sessions ended; bookings and balances stay under the company's name. Signing in answers 403 `PARTNER_TERMINATED` |
| DELETE | `/admin/partners/:id` | 409 `USE_TERMINATE` once the company has any booking, receivable or payable |

The partner detail carries `contract { required, onFile, signedAt, version,
uploadedAt, uploadedBy, filename }`, `terms { current, url, acceptedVersion,
acceptedAt, acceptedBy, outdated }` and `review.blocked*` / `review.terminated*`.

Behind `requireApprovedPartner` and on the public booking routes, a company
whose `terms.acceptedVersion` is not the current one is refused with 403
`{ reason: "TERMS_OUTDATED", termsVersion, acceptedVersion }` until its owner
accepts; `/partner/me`, `/partner/terms` and `/partner/contract` stay open so
the page that asks can render. Bump `PARTNER_TERMS_VERSION` and every company
accepts again on its next visit. The driver panel refuses drivers of a
blocked or terminated supplier as it does a suspended one.

### What one partner may sell — product access

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/partners/:id/product-access` | `partners.read`: `{ data: [{ id, productType: HOTEL \| TRANSFER \| TOUR \| SERVICE \| PACKAGE, productId, mode: ALLOW \| DENY, note, product: { id, name, slug }, createdAt, createdBy }] }` |
| PUT | `/admin/partners/:id/product-access` | `partners.access.write` (super admin, admin): `{ entries: [{ productType, productId, mode, note? }] }`, the whole list — what is absent is removed. Every product must exist (422 `UNKNOWN_PRODUCT`). Audited `PARTNER_PRODUCT_ACCESS_CHANGED` with `{ added, removed, changed }` |

No rows means everything. A DENY row hides that product from the company
wherever it is listed, searched, quoted or booked (a 404, as for a product
that is not on its channel); one or more ALLOW rows for a type turn that type
into an allow-list. `TRANSFER` names a vehicle class. The rows travel with the
session's partner, so a change applies on the next request, to every user of
the company alike; staff and the public are never on the list. A package is
gated as a package; the hotels and tours inside it are the package's own.

### A partner's team — `/partner/team`

`partner.team.manage`: `PARTNER_OWNER` and `PARTNER_ADMIN`, on an approved
partner. The same verbs as above, scoped to the session's company — another
company's user id is **404**. Differences: invite roles are `PARTNER_ADMIN`
`PARTNER_AGENT` `PARTNER_FINANCE`; `PATCH /partner/team/:id/role` accepts any
partner role including `PARTNER_OWNER`, and `PUT /partner/team/:id/roles`
the whole set; `GET /partner/team/grantable` says which the caller may give.
An owner manages everyone (other owners included) while an admin manages
agents only — a finance user can do what an admin cannot (403
`ROLE_ABOVE_CEILING`); `PATCH /partner/team/:id/primary-contact` moves the one
primary contact to an active member, within the same ceiling on both the
member gaining it and the one losing it (so a partner admin cannot take it
from an owner); a team holds at most `PARTNER_TEAM_MAX`
members, invited ones included (409 `TEAM_FULL`).

### Audit log — `/admin/audit`

`audit.read` (`SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `ACCOUNTANT`).
`GET /admin/audit?entityType&entityId&actorUserId&action&q&from&to&page&pageSize`
answers the whole trail newest first, each entry `{ id, action, entityType,
entityId, summary, metadata, actor, actorEmail, createdAt }`. `action` must be a
known audit action (400 otherwise); `from`/`to` are ISO instants. The query is
strict: a parameter the list does not name (`search=` for `q=`, say) is a 400,
never silently the whole trail. Successful
sign-ins (`USER_LOGIN_SUCCEEDED`, with the user agent) and sign-outs
(`USER_LOGGED_OUT`) are on the trail beside the failures.

### Email: the Gmail connection — `/admin/mail/google`

The company Google account outgoing mail is sent as when
`MAIL_TRANSPORT=gmail` (setup: `docs/DEPLOYMENT.md` §3.4c). Usable as soon as
the server has the four Google identifiers, whatever the transport, so the
account can be connected and tested before the switch. Without them,
`authorize` and `test` answer `409 GMAIL_NOT_CONFIGURED`.

| Route | Who | Answers |
| --- | --- | --- |
| `GET /admin/mail/google` | `platform.admin` or `settings.write` | `{ provider, transport, active, configured, senderEmail, fromAddress, fromMatchesSender, fromAliasVerified, redirectUri, connected, source: 'database' \| 'environment' \| null, account: { accountEmail, scopes, connectedAt, connectedByEmail, revokedAt, lastAuthError } \| null, volume: { sentLast24h, warnAt }, lastSent: { at, template } \| null, lastFailure: { at, template, error } \| null }`. Never a token, sealed or not |
| `POST /admin/mail/google/authorize` | `settings.write`, rate limited | `{ url, expiresAt }`: Google's consent URL (`gmail.send` + `email`, offline, `prompt=consent`, `login_hint` = the sender). Sets an HttpOnly, SameSite=Lax `iag_gmail_oauth` cookie on `/api/admin/mail/google` for ten minutes. The client navigates the browser to `url` |
| `GET /admin/mail/google/callback` | **no session** | Google's return. Always `200` with a small HTML page whose meta refresh (and Continue link) moves the browser on to `{APP_URL}/admin/settings/email?connected=1` or `?error=<code>`. Not a redirect: a redirect stays inside Google's cross-site navigation, the Strict session cookie is withheld and the admin lands on the sign-in screen. Codes: `state` (unknown, expired or used), `session` (cookie missing), `forbidden` (the admin lost `settings.write`), `denied`, `account` (not `GMAIL_SENDER_EMAIL`, or unverified; the grant is revoked at Google), `scope` (send permission unticked), `no_refresh_token`, `exchange`, `google`, `not_configured`, `server` |
| `POST /admin/mail/google/test` | `settings.write`, rate limited | Sends `mailProviderTest` through Gmail to the signed-in admin only. `{ sent, to, error: { kind, reason, message } \| null }`; a Gmail refusal is `200` with `sent: false` |
| `POST /admin/mail/google/disconnect` | `settings.write`, rate limited | Revokes the grant at Google and deletes it: `{ revokedAtGoogle }`. `404` when nothing is connected |

The callback has no session because the session cookie is `SameSite=Strict`
and Google's return is a cross-site navigation. What authorises it is a
single-use state (32 random bytes, stored as its SHA-256, ten minutes, bound
to the admin who asked and to the `iag_gmail_oauth` cookie). Audit actions:
`MAIL_PROVIDER_CONNECTED`, `MAIL_PROVIDER_CONNECT_REJECTED`,
`MAIL_PROVIDER_DISCONNECTED`, `MAIL_PROVIDER_TEST_SENT`, and
`MAIL_PROVIDER_REVOKED` (actor `system`) when Google refuses the stored grant.
That last one also puts a `MAIL_PROVIDER_ALERT` notice (category `SYSTEM`,
`payload.link`) on every administrator's bell, as does crossing
`GMAIL_DAILY_SEND_WARN` sends in 24 hours (once a day).

## Finance

Operational finance, not bookkeeping: what we owe each supplier, what each
buyer owes us, and the money that moved. Every amount is integer minor units
in the record's own currency, and nothing is ever converted or added across
currencies.

**Where the records come from.** The booking services write them, inside the
booking's own transaction:

- A **payable** (what we owe the supplier, its net) when a hotel, transfer,
  tour or service booking is confirmed — including each part of a package.
  It is split into instalments by the supplier's payment terms (an optional
  deposit and a balance, each due a number of days from confirmation, arrival
  or departure, at the terms' cutoff time in the supplier's timezone). No
  terms: one undated balance, flagged `needsReview: NO_TERMS`.
- A **receivable** (what the buyer owes, its sell price; for a hotel plus the
  included tax) for a standalone booking when it is confirmed, or for an
  order once every request in it is answered. Due `Partner.paymentDueDays`
  after confirmation (or arrival, per `paymentDueAnchor`); a guest without an
  account owes at once (`FINANCE_GUEST_DUE_DAYS`, default 0).
- On **cancellation** the receivable becomes the cancellation charge, and the
  payable follows the supplier's `cancellationLiability`: `PROPORTIONAL` (the
  same share of the net as was charged — 50% charged, 50% of the net owed;
  the default), `NONE_UNLESS_NON_REFUNDABLE` (the whole net if charged in full,
  else nothing) or `MANUAL` (stops at what was paid, `needsReview:
  CANCELLATION_MANUAL`). A reduction comes off the balance before the deposit.
  Money already paid beyond what is now owed shows as `refundDueCents`.
- A declined request, or a booking still awaiting an answer, owes nothing and
  has no rows.

Statuses: `OPEN`, `PARTIAL`, `PAID`, `VOID` (nothing owed, nothing paid),
`WAIVED` (written off by Finance). `scripts/backfill-finance.js [--apply]
[--since YYYY-MM-DD]` gives older bookings their rows the same way.

All under `/api/admin/finance`. Reading needs `finance.payables.read`,
`finance.receivables.read`, `finance.payments.read` or `finance.reports.read`
(super admin, admin, management, finance); changing needs
`finance.payments.write` or `finance.terms.write` (super admin and finance:
an admin runs the company and reads every figure, and keeping the books is
the finance desk's); a CSV export needs `finance.export` as well. A payment
names each item once, its payer or payee must own every item it settles
(422 `COUNTERPARTY_MISMATCH`), and its attachment must be an uploaded
`PAYMENT_ATTACHMENT` (422 `ATTACHMENT_INVALID`).

**A second person for money going out or written off.** A refund
(`POST /payments` with `kind: REFUND`), a supplier amount override or
write-off (`PATCH /payables/:id` with `amountOverrideCents` or `waive`) and
a moved deadline or write-off on a receivable (`PATCH /receivables/:id` with
`dueAt` or `waive`) are refused on those routes with 403
`{ reason: "APPROVAL_REQUIRED", kind }` unless the caller holds
`finance.refunds.execute` / `finance.adjustments.execute` — which nobody is
seeded with, a super admin included, and which only a role can carry. The
notes alone need `finance.notes.write`, and are on the trail
(`PAYABLE_NOTES_CHANGED`, `RECEIVABLE_NOTES_CHANGED`). Everyone else asks:

### Approval requests — `/admin/approvals`

Opening one needs `finance.refunds.request` or `finance.adjustments.request`
(accountant, finance operator, super admin); deciding one needs
`finance.refunds.approve` / `finance.adjustments.approve` (seeded on the
super admin alone, given to others by role). Nobody decides what they asked
for themselves (403 `SELF_APPROVAL`). A requester sees their own requests; an
approver sees every request of the kinds they decide; anyone else's id is
404. Approvers are told in-app and at `FINANCE_OPS_EMAIL`; the requester is
told how it went.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/approvals?status&kind&mine&page&pageSize` | `{ data: [{ id, reference: "APR-000012", kind, status, subjectType, subjectId, payload, amountCents, currency, summary, requestedBy, requestNote, decidedBy, decidedAt, decisionNote, executedEntityType, executedEntityId, lastError }] }` |
| POST | `/admin/approvals` | `{ kind, subjectId?, payload, note? }`. `kind` ∈ `REFUND` (payload: the refund body `POST /payments` takes), `PAYABLE_OVERRIDE` / `PAYABLE_WAIVE` (`subjectId` the payable; payload the `PATCH /payables/:id` body with just that change), `RECEIVABLE_DUE_DATE` / `RECEIVABLE_WAIVE` (likewise for a receivable). The payload is validated with the executing route's own schema, so what the approver reads is what will run. 201 |
| GET | `/admin/approvals/:id` | |
| POST | `/admin/approvals/:id/approve` | `{ note? }`. Runs the action in the approver's name, in the same transaction that marks the request approved: done or still pending, never half. The usual audit row (`REFUND_RECORDED`, `PAYABLE_WAIVED`, …) carries `approvalId` and `requestedByUserId`. If the action can no longer run (the payable was written off meanwhile) the request stays `PENDING` with `lastError` set and the error is answered (409/422) |
| POST | `/admin/approvals/:id/reject` | `{ note? }` |
| POST | `/admin/approvals/:id/cancel` | The requester withdraws a pending request |

`GET /admin/badges` carries `pendingApprovals`: requests waiting on the
viewer's decision, `null` for someone who decides none.

### Penalties, credit limits and commission

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/finance/penalties?partnerId&product&currency&overridden&page&pageSize` | `finance.receivables.read`. Every cancelled booking has a row: `{ id, bookingType, bookingId, reference, partner, currency, chargeCents, overrideCents, overrideReason, effectiveCents, approvalId }`. The ledger chases `effectiveCents` (`overrideCents ?? chargeCents`); an override arrives only through a `PENALTY_OVERRIDE` approval request (`subjectId` the penalty, payload `{ overrideCents: number \| null, reason }`), never above the charge |
| GET | `/admin/finance/partners/:id/credit` | `finance.receivables.read` or `partners.write`: `{ limitCents, currency, mode, outstandingCents, availableCents }` |
| PATCH | `/admin/finance/partners/:id/credit` | `partners.credit.write` (super admin, admin, accountant): `{ creditLimitCents: number \| null, creditLimitCurrency?, creditLimitMode?: BLOCK \| WARN }`. Null is no limit. Audited `PARTNER_CREDIT_LIMIT_CHANGED` with `changes` |
| GET | `/admin/finance/reports/commission?from&to&currency&groupBy=partner\|product&partnerId&format` | `finance.commission.read` (the finance readers): per agency or product, confirmed bookings in the period and their sell, net, `commissionCents` (sell − net) and the agency rate frozen at booking (`rateBps`). CSV with `finance.export` |
| GET | `/partner/finance/credit` · `/partner/finance/commission?from&to&currency` | `partner.statement.read`: the company's own position and its own bookings by product |

A credit limit is checked in the transaction that confirms a booking, under
a lock on the partner and before anything is claimed: in BLOCK mode the
booking is refused with 422 `{ reason: "CREDIT_LIMIT_EXCEEDED", limitCents,
outstandingCents, requestedCents, currency }` and holds nothing; in WARN mode
it goes through, the trail records `PARTNER_CREDIT_WARNING`, and the finance
desk is told. The limit counts only its own currency's open receivables.
Every booking an agency confirms also freezes the agency's commission rate
beside the markup actually applied (`commissionRateBps`, on every booking
and order), which is what the commission report reads.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/payables?status&supplierPartnerId&product&currency&dueBefore&needsReview&q&page&pageSize` | `status` repeatable; `supplierPartnerId=PLATFORM` for platform-owned inventory. Each row: `booking { kind, id, reference, status }`, `supplier`, amounts (`original`, `amount`, `paid`, `outstanding`, `refundDue`), `status`, `nextDueAt`, `needsReview`/`reviewReason`, `instalments[]` |
| GET | `/payables/:id` | Instalments carry their `allocations[]` with the payment each came from |
| PATCH | `/payables/:id` | `{ amountOverrideCents?: int or null, waive?: true, notes?, reason }` — `reason` always required. An override is what the supplier is owed from then on, kept through every later recalculation (null hands it back to the rules); 422 `ABOVE_ORIGINAL` past the booked net. `waive` writes off what is left |
| POST | `/payables/:id/instalments/:sequence/pay` | `{ method, paidAt, amountCents?, reference?, note? }` — an OUT payment of the instalment's outstanding amount (or `amountCents`). 201 `{ payment, replayed }` |
| GET | `/receivables?status&debtorPartnerId&currency&dueBefore&overdue&q&page&pageSize` | `debtorPartnerId=GUEST` for guests without an account. Each row: `subject { kind: HOTEL, TRANSFER, TOUR, SERVICE or ORDER, id, reference, status }`, `debtor { partner, name, email }`, amounts, `dueAt`, `overdue` |
| GET | `/receivables/:id` | With `allocations[]` |
| PATCH | `/receivables/:id` | `{ dueAt?: ISO or null, waive?: true, notes?, reason }` — moving the due date is audited as `RECEIVABLE_DUE_DATE_CHANGED`; a later date re-arms the overdue alert |
| GET | `/payments?direction&kind&method&currency&counterpartyPartnerId&from&to&q&page&pageSize` | |
| GET | `/payments/:id` | |
| POST | `/payments` | See below. `Idempotency-Key` header (8–200 chars): a retry answers 200 with the original and `replayed: true`; the same key for a different amount, currency or direction is 409 `IDEMPOTENCY_KEY_REUSED` |
| POST | `/payments/:id/allocations` | `{ allocations: [...] }` — spreads what an earlier payment left unallocated |
| GET | `/due?days=7` | The payments-due queue (0–90 days): `instalments[]` overdue or due within `days`, earliest first, each with its `payable { id, product, bookingReference, supplier, currency, timezone }`; `receivables[]` the same; `totals.{instalments,receivables}.{overdue, due, outstandingByCurrency}`. A side the viewer may not read is `null`. Needs `finance.payables.read` or `finance.receivables.read` |
| GET | `/reports/summary?currency&from&to&format` | Per currency: receivables open / overdue / refund due, payables open / overdue / due within 7 days / needing review, and cash in and out in the period (`from`/`to` are dates, Tbilisi days, last 30 by default) |
| GET | `/reports/margin?currency&from&to&groupBy&format` | Bookings confirmed in the period, grouped by `product`, `supplier` or `partner`: `bookings`, `revenueCents` (what the buyer owes for them now), `costCents` (what suppliers are owed now), `marginCents`, `marginBps`. A package line counts at its own product's price |
| GET | `/reports/ageing?side&currency&format` | `side=receivables` or `payables`: open money per counterparty in `current` (not yet due or undated), `d1_30`, `d31_60`, `d61_90`, `d90_plus` |
| GET/PUT | `/terms/:kind/:id` | `kind` = `hotels`, `transfer-providers`, `tours`, `services`. `{ milestones, cancellationLiability, cutoffTime?, notes? }`; GET answers the defaults with `isDefault: true` when none are saved. New terms apply to bookings confirmed afterwards; existing schedules are not moved |
| GET/PATCH | `/partners/:id/terms` | `{ paymentDueDays (0–365), paymentDueAnchor: CONFIRMATION or ARRIVAL, paymentTermsNote, bookingApproval: AUTO or REQUIRED }` (OD1: `bookingApproval` is audited on its own as `PARTNER_BOOKING_APPROVAL_CHANGED`) |

`?format=csv` on any report answers `text/csv` (amounts in major units) and is
audited as `FINANCE_REPORT_EXPORTED`.

A payment:

```json
POST /api/admin/finance/payments   Idempotency-Key: 6b0e…
{
  "direction": "IN", "kind": "PAYMENT", "method": "BANK_TRANSFER",
  "currency": "GEL", "amountCents": 120000, "paidAt": "2026-10-07T09:30:00Z",
  "reference": "TBC-88213",
  "allocations": [{ "receivableId": "…", "amountCents": 80000 }, { "receivableId": "…", "amountCents": 40000 }]
}
```

`IN`+`PAYMENT` settles receivables; `OUT`+`PAYMENT` settles supplier
instalments (`payableInstalmentId`); `OUT`+`REFUND` gives a buyer money back
(negative allocations on receivables); `IN`+`REFUND` is a supplier giving us
money back. A refund needs a `reason`. Instead of `allocations`, `allocate: {
mode: "OLDEST_DUE", partnerId }` settles that partner's open items earliest
due first; with neither, the payment is recorded unallocated. 422 reasons:
`ALLOCATION_EXCEEDS_OUTSTANDING`, `ALLOCATIONS_EXCEED_PAYMENT`,
`CURRENCY_MISMATCH`, `WRONG_TARGET`; 409 `NOT_SETTLEABLE` for a closed item.
The payer or payee is taken from what is settled when not given.

### Supplier payment reminders

A sweeper (`FINANCE_REMINDER_SWEEP_INTERVAL_MS`, default 10 min) watches
every open instalment's `dueAt` and writes outbox events on the clock:

- `finance.payable.instalment_due` — at each of `FINANCE_REMINDER_OFFSET_DAYS`
  (default `7,3,1,0`) **calendar days before the due day in the payable's
  timezone**: an instalment due 10:00 on the 17th is "due today" from
  midnight on the 17th in Tbilisi. Each (instalment, offset) is claimed once
  by a unique `payable_reminders` row, so it fires once however many servers
  sweep; several offsets claimed in one sweep (a payable backfilled four days
  before its due day) collapse to one event carrying the nearest.
- `finance.payable.instalment_overdue` — once the due time passes
  (`overdue_alert_at` stamped in the selecting statement), and again every
  `FINANCE_OVERDUE_REPEAT_DAYS` (default 1; 0 = once) while still owed.
- `finance.receivable.overdue` — the same for a buyer's bill.
- `finance.payment.recorded` — written by `POST /payments` in the payment's
  own transaction.

The handlers re-read the row and say nothing when it is no longer `OPEN` or
`PARTIAL`: recording the payment is what stops reminders, including one
already claimed. Who hears:

| Event | In-app (`NotificationKind`) | Email |
| --- | --- | --- |
| instalment due / overdue | every active user whose role has `finance.payables.read` (`FINANCE_PAYABLE_DUE`, `FINANCE_PAYABLE_OVERDUE`), linking to the payable | `FINANCE_OPS_EMAIL` when set (`financePayableDue`, `financePayableOverdue`) |
| receivable overdue | the same staff (`FINANCE_RECEIVABLE_OVERDUE`); and, for a partner debtor, its users with `partner.statement.read` | `FINANCE_OPS_EMAIL` (`financeReceivableOverdue`); the partner's address (`receivableOverdue`). A guest is not chased automatically |
| payment recorded | for an `IN` payment from a partner: its statement readers (`FINANCE_PAYMENT_RECEIVED`) | the partner (`paymentReceipt`: amount, date, what it settled, anything left on account). Nothing for `OUT` payments or refunds |

Emails carry amounts, references and supplier names, never bank details. On
first run against a database with older payables, everything inside the
window is reminded about at once; the Finance → Payables badge (`paymentsDue`
on `GET /api/admin/badges`) and `GET /due` show the same rows.

### Invoices

**Lines (owner decision OD4).** A document is built one line per hotel
room and one per transfer leg (`services/invoicing/lines.js`), each with a
one-line `description` and a `detail` — the structured fields plus a
multi-line `text` the provider prints under the line. A hotel room line
reads `Hotel Vera · Deluxe Double, Breakfast Included · 01.12.2026 –
05.12.2026 (4 nights) · BKG-1` with `quantity` = nights, `unitCents` the
nightly gross, and `detail { hotel: { name, city, country }, room, checkIn:
{ date, from }, checkOut: { date, until }, nights, pax: [{ lastName,
firstName, title, type, age, text: "BERIDZE / NINO MRS." }], text }`; a
transfer leg reads `Arrival transfer Tbilisi Airport → Tbilisi, 02.12.2026
01:30 · TRF-1` in the airport's own time with `detail { label: ARRIVAL |
DEPARTURE | RETURN | TRANSFER, from, to, date, time, flightNumber, vehicle,
passengers, text }`; tours and services one line each with the party and
names; an order one line per item carrying its child's detail. `kind` is
`HOTEL_ROOM | TRANSFER_LEG | TOUR | SERVICE | EXTRA | ADJUSTMENT |
CANCELLATION_CHARGE | MANUAL`. Lines always add up to what is owed:
weights (a room's subtotal, a leg's fare) split the receivable by largest
remainder; the desk's price adjustment is its own `ADJUSTMENT` line; a
cancelled booking is one `CANCELLATION_CHARGE` line. Nothing is invented: a
guest without a `title` is printed without one, a leg without a flight has
no flight line. Lines are written once with the document; a trigger
refuses an update to the lines of anything but a DRAFT. The provider
receives each line as a position `{ name, description, quantity, tax,
total_price_gross }` — **whether the PDF prints `description` with its line
breaks is to be confirmed on the sandbox account before the flag goes on**
(the fallback is folding the text into `name`).

The documents behind a receivable — a proforma, the VAT invoice, a
correction — numbered, printed and emailed by **InvoiceOcean**. The
platform keeps one `Invoice` row per document with its lines and the
provider's id and number; the PDF is streamed from the provider on demand
and never stored, and the provider's own share link is never handed out.
Everything is behind `INVOICEOCEAN_ENABLED` (how to switch it on:
`docs/DEPLOYMENT.md` §3.4b). Off, the read routes still list what was
issued before, and every route that would write a document or call the
provider answers 422 `{ reason: "INVOICING_DISABLED" }` — the flag is
checked before the document is looked up, so an unknown id is 422 while
off and 404 once on.

Kinds: `PROFORMA`, `VAT`, `CORRECTION`, and `ADVANCE` / `FINAL`, which can
be issued by hand but which no flow writes. Statuses: `DRAFT` (written here,
not yet at the provider), `ISSUED`, `SENT`, `PARTIAL`, `PAID`, `CANCELLED`,
`ERROR` (the provider refused it, or every attempt failed).

**How documents come to be.** Three hooks run inside the booking's own
transaction and write a `DRAFT` row plus an outbox event — nothing is
called there, so a slow or absent provider delays the document, never the
booking:

- a **proforma** when the receivable is created — a standalone booking
  confirmed, or an order once every request in it is answered;
- a **VAT invoice**, chained from the proforma (`fromInvoice`), when the
  receivable is paid in full. A partial payment is posted to the proforma at
  the provider instead (`PaymentAllocation.externalPaymentId` makes that
  once);
- a **correction** of the VAT invoice when a VAT-invoiced receivable's
  amount changes (a cancellation with a charge) — one live correction per
  receivable. An unpaid proforma is cancelled here and at the provider
  instead, and the new amount gets a fresh one.

The outbox drain (`TRANSFER_OUTBOX_DRAIN_INTERVAL_MS`, 5 s) then creates the
document: the row becomes `ISSUED` with `number`, `externalId` and
`hasPdf: true` a few seconds after the 202, so a client reads the number
back by refreshing, not from the response. Before creating, the drain asks
the provider for a document already carrying our reference (`oid` = the
booking or order reference) and adopts it, and a partial unique index allows
one live document per kind per receivable, so a replayed event, a retried
handler or two drains racing end with one document. A refusal the provider
would only repeat — a 422 with field errors (`seller_name: can't be blank`
while the account's company details are empty), a 404, a refused token —
marks the row `ERROR` at once with the provider's words in `syncError`; a
transient failure is retried by the outbox (8 attempts) and marked `ERROR`
on the last. Both tell every `invoices.write` holder in-app
(`FINANCE_INVOICE_SYNC_FAILED`) and email `FINANCE_OPS_EMAIL`; a document
issued tells the finance readers and the partner's invoice readers in-app
(`FINANCE_INVOICE_ISSUED`), and InvoiceOcean emails it to the buyer when
`INVOICEOCEAN_AUTO_SEND=true` or Finance presses Send. **Retry** puts an
`ERROR` row back to `DRAFT` and queues it again. Nothing is ever deleted: a
cancelled proforma stays `CANCELLED`, a failed one `ERROR`, and the
receivable's detail carries all of them in `invoices[]`. Outbox topics:
`finance.invoice.issue_requested`, `…send_requested`, `…cancel_requested`,
`…issued`, `…sync_failed`; audit actions `INVOICE_REQUESTED`,
`INVOICE_SENT`, `INVOICE_CANCELLED`, `INVOICE_SYNC_FAILED`.

What changes at the provider — marked paid there, sent there, cancelled
there — arrives by webhook and, for deliveries that never came, by a poll
every `INVOICEOCEAN_POLL_INTERVAL_MS` (15 min). Both are stored as
`invoice_sync_events` (one per document and provider `updated_at`, so a
repeated delivery is one event) and applied every
`INVOICEOCEAN_SYNC_APPLY_INTERVAL_MS` (60 s) to the local row's `status`,
`paidCents` and `number` — never to the ledger: a payment seen in
InvoiceOcean is a prompt for Finance to record it, not a payment. A webhook
is re-read from the API before it is believed.

Reading needs `invoices.read` (super admin, admin, management, accountant;
the seeded `FINANCE_OPERATOR` role does not hold it until given in the role
editor). Issuing by hand, sending, cancelling and retrying need
`invoices.write` (super admin, accountant). Under `/api/admin/invoices`,
except the hand-issue route, which lives on the receivable it is for:

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/invoices?kind&status&receivableId&debtorPartnerId&from&to&q&page&pageSize` | `status` repeatable; `debtorPartnerId=GUEST` for documents addressed to guests; `from`/`to` are issue dates (`YYYY-MM-DD`); `q` matches the number or the booking reference. Newest first; `{ data, total, page, pageSize, totalPages }` |
| GET | `/admin/invoices/settings` | What a screen needs before offering anything: `{ enabled, provider: "INVOICEOCEAN", languages[], defaultLang, defaultTaxBps, autoSend }`. No secret in it |
| GET | `/admin/invoices/sync-events?page&pageSize` | Provider reports that could not be applied: `{ id, source: WEBHOOK \| POLL, externalId, externalUpdatedAt, status, number, oid, error, processedAt, createdAt }`. `error` is `UNMATCHED` (a document the platform does not have — one issued by hand in InvoiceOcean, or before the import), `GONE` (the provider no longer has it) or the applier's own message |
| GET | `/admin/invoices/:id` | |
| GET | `/admin/invoices/:id/pdf` | `application/pdf`, `Content-Disposition: inline`, `Cache-Control: private, no-store`, streamed from the provider. 409 `NOT_ISSUED` for a draft or failed document (no `externalId`); 502 when the provider cannot be reached |
| POST | `/admin/invoices/:id/send` | `{ to?: email }` — the buyer's address on the document when omitted. 202 `{ invoice, queued: true }`; InvoiceOcean sends it. 409 `NOT_ISSUED` unless `ISSUED`, `SENT`, `PAID` or `PARTIAL` |
| POST | `/admin/invoices/:id/cancel` | `{ reason? }`. 200 with the invoice, `CANCELLED` here at once and at the provider through the outbox. A proforma only (409 `NOT_A_PROFORMA`: a VAT invoice is corrected, never cancelled), from `DRAFT`, `ISSUED`, `SENT`, `PARTIAL` or `ERROR` (409 `NOT_CANCELLABLE` once paid or already cancelled) |
| POST | `/admin/invoices/:id/retry` | 202 `{ invoice, queued: true }`. `ERROR` only (409 `NOT_FAILED`); 409 `LIVE_INVOICE_EXISTS` if a live document of that kind appeared meanwhile |
| POST | `/admin/finance/receivables/:id/invoices` | `{ kind: PROFORMA \| VAT \| ADVANCE \| FINAL, lang?, dueDate?: YYYY-MM-DD \| null, taxRateBps?, lines?: [{ description, quantity?, taxRateBps?, totalGrossCents }] }` — for a booking confirmed before invoicing was on, or after a failed one was cancelled. Lines default to the booking's own (one per package part when they add up); hand-written lines must add up to a positive amount (D4: the rate may differ per line). 202 `{ invoice, queued: true }`. 422 `NOTHING_OWED` (amount 0, `VOID` or `WAIVED`); 409 `LIVE_INVOICE_EXISTS` with the existing `invoiceId` |

A staff invoice: `{ id, provider, kind, status, number, externalId,
currency, lang, totalCents, paidCents, issueDate, sellDate, dueDate, buyer
(the name, tax id and address as printed), receivable { id, reference,
status, amountCents, paidCents, debtor { partner, name, email } },
fromInvoice { id, kind, status, number, totalCents }, derived[] (the same
shape: the VAT invoice from a proforma, the correction from a VAT invoice),
correctionReason, source (what wrote it: CONFIRM, PAYMENT, CANCELLATION,
MANUAL or IMPORT), syncError, lastSyncedAt,
externalUpdatedAt, hasPdf, lines[] { id, description, quantity, taxRateBps,
totalGrossCents, bookingReference }, createdAt, updatedAt }`. The receivable
detail (`GET /admin/finance/receivables/:id`) carries `invoices[]` as
compact rows (`id, kind, status, number, currency, totalCents, paidCents,
issueDate, fromInvoiceId, syncError, hasPdf, createdAt`).

**The partner's own documents** need `partner.invoices.read` (owner, partner
admin, partner finance), an approved company, and are scoped to the
session's partner: another company's document, a draft and a failed one are
all **404**, because they do not exist as documents.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/partner/finance/invoices?kind&status&receivableId&from&to&q&page&pageSize` | Only `ISSUED`, `SENT`, `PARTIAL`, `PAID` and `CANCELLED` documents that exist at the provider; `debtorPartnerId` is ignored |
| GET | `/partner/finance/invoices/:id` | `{ id, kind, status, number, currency, totalCents, paidCents, issueDate, dueDate, reference, receivableId, fromInvoice { id, kind, number }, hasPdf, lines[], createdAt }` — no provider ids, no sync error, no internal notes |
| GET | `/partner/finance/invoices/:id/pdf` | As the staff route, scoped |

**What is printed as the buyer.** A partner's `taxId` (its VAT or tax
number, 2–32 characters, or null for none) and `invoiceLang` (one of the
languages InvoiceOcean prints — `GET /admin/invoices/settings` lists them;
Georgian and Hebrew are not among them, so the partner's locale is never
used as-is; null = `INVOICEOCEAN_LANG`) are on every partner shape.
`PATCH /admin/partners/:id` accepts both; `PATCH /partner/profile` accepts
`taxId` only. A guest's document carries the lead name and email from the
booking.

**The webhook — `POST /api/integrations/invoiceocean/webhook`.** Public:
there is no session on the other end. Guarded by the secret the webhook was
registered with (`INVOICEOCEAN_WEBHOOK_SECRET`, 16+ characters), which
InvoiceOcean echoes as `api_token` in the body; an `X-Webhook-Secret` header
is accepted too, for a test with curl. The compare is constant-time and an
unset secret matches nothing: a missing or wrong secret is **401**. The body
is only loosely validated — InvoiceOcean's payload is its own, and only the
id is relied on (`invoice.id`, or `id` / `invoice_id` at the top level; none
is 400). A delivery is stored and answered **200 `{ received: true,
duplicate }`** at once — for a document the platform has never heard of as
well, which surfaces as `UNMATCHED` on `/admin/invoices/sync-events` after
the next apply run rather than as a refusal, because a refused delivery
would be retried forever. The global rate limit and the 100 kB body limit
apply.

Error reasons, in one place: 422 `INVOICING_DISABLED` (any write or
provider call while the flag is off), 422 `NOTHING_OWED`, 409 `NOT_ISSUED`
(send or PDF of a document that is not at the provider), 409
`NOT_A_PROFORMA`, 409 `NOT_CANCELLABLE`, 409 `NOT_FAILED`, 409
`LIVE_INVOICE_EXISTS`; 404 for a partner's foreign document; 401 for a
webhook without the secret; 502 when the provider cannot be reached or
refuses the token. `scripts/import-invoiceocean.js --from YYYY-MM-DD [--to
YYYY-MM-DD] [--apply]` (a dry run without `--apply`; needs the domain and
token, not the flag) brings documents already in the account in as
`source: IMPORT`, matched by `oid` to a receivable's reference.

### A partner's own money — `/partner/finance`

`partner.statement.read` (owner, partner admin, partner finance), approved
partners only, always scoped to the session's company.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/partner/finance/statement?status&page&pageSize` | `balances[]` per currency (`outstandingCents`, `overdueCents`, `creditCents`) and the agency's receivables with the payments against each — no supplier, no net, no internal notes |
| GET | `/partner/finance/payables?status&page&pageSize` | For a supplier: what we owe it for its own bookings — its net and its schedule, nothing of ours |
| GET | `/partner/finance/invoices` · `/invoices/:id` · `/invoices/:id/pdf` | `partner.invoices.read`: the company's own proformas and invoices, and their PDFs — see Invoices above |

## Supplier extranet

`/partner/hotels`, guarded by `authenticate + requireApprovedPartner`, scoped to
the caller's own properties. Another supplier's id returns **404, not 403**.

| Method | Path | Role |
| --- | --- | --- |
| GET | `/partner/hotels` | any partner role |
| GET | `/partner/hotels/:hotelId` | any |
| GET | `/partner/hotels/:hotelId/room-types` | any |
| GET | `…/room-types/:id/inventory/calendar` | any |
| PUT | `…/room-types/:id/inventory` | **OWNER / ADMIN only** |
| PUT | `…/rate-plans/:id/rates` | **OWNER / ADMIN only** |
| GET | `/partner/hotels/:hotelId/bookings` | any. Every reservation at the property, whichever partner made it. `?status&from&to&search&page&pageSize`, as `/partner/bookings` |

A `PARTNER_AGENT` gets 403 on the two writes.

## Enums the client needs

```
PropertyType   Hotel Boutique Resort Guesthouse Lodge Apartment Chalet Hostel Villa
HotelStatus    DRAFT ACTIVE INACTIVE SUSPENDED ARCHIVED
RoomTypeStatus ACTIVE INACTIVE ARCHIVED
RatePlanStatus ACTIVE INACTIVE ARCHIVED
MealPlanCode   RO BB HB HB_PLUS FB FB_PLUS AI UAI
CancellationKind FLEXIBLE NON_REFUNDABLE TIERED
ChargeBasis    PERCENT_OF_TOTAL PERCENT_OF_FIRST_NIGHT FIXED_AMOUNT NIGHTS
PaymentTiming  PAY_NOW PAY_LATER DEPOSIT PAY_AT_HOTEL CREDIT_ACCOUNT
BedTypeCode    SINGLE TWIN DOUBLE QUEEN KING SOFA BUNK FUTON
BathroomType   PRIVATE ENSUITE SHARED
ChildChargeMode FREE PERCENT_OF_ADULT FIXED_PER_NIGHT FULL_ADULT
TaxFeeBasis    PERCENT PER_NIGHT_PER_PERSON PER_NIGHT_PER_ROOM PER_STAY
BookingStatus  PENDING_APPROVAL PENDING CONFIRMED CANCELLED COMPLETED NO_SHOW   (PENDING_APPROVAL: the platform's wait; PENDING: the supplier's)
ImageCategory  Exterior Lobby Restaurant Pool Spa Room Bathroom View Facilities
AmenityCategory General FoodDrink Wellness Parking Business Family Ski Accessibility Transportation
                KosherFood Shabbat Religious
FileCategory   HOTEL_IMAGE ROOM_IMAGE AMENITY_ICON CONTRACT RATE_SHEET INVOICE VOUCHER IMPORT
               KOSHER_CERTIFICATE OTHER

KosherServiceLevel       NONE ON_REQUEST KOSHER_FRIENDLY PARTIAL FULL   (weakest first)
KosherCertificationScope PROPERTY KITCHEN RESTAURANT PASSOVER
KosherCertificationState NONE UNVERIFIED PENDING_VERIFICATION VERIFIED EXPIRED REJECTED ARCHIVED
                         (EXPIRED and ARCHIVED are derived, never stored)
KosherDataSource         ADMIN HOTEL SUPPLIER IMPORT
BookingRequestStatus     REQUESTED CONFIRMED DECLINED WITHDRAWN

TransferPointKind     AIRPORT CITY RESORT HOTEL LANDMARK STATION
TransferVehicleClass  ECONOMY COMFORT MINIVAN VAN GROUP JEEP_4X4 VIP
TransferVehicleBody   sedan suv minivan van bus
TransferKind          PRIVATE SHARED
TransferRouteTier     TIER_1 TIER_2 TIER_3
TransferRouteCategory AIRPORT CITY RESORT TOURIST_ROUTE COMBINED
TransferStatus        DRAFT ACTIVE INACTIVE ARCHIVED
TransferBookingStatus PENDING_APPROVAL PENDING CONFIRMED CANCELLED COMPLETED NO_SHOW
TransferTripType      ONE_WAY RETURN
TransferExtraBasis    FIXED PER_PASSENGER PER_HOUR PERCENT
TransferFeature       airConditioning wifi childSeat englishDriver meetGreet flightTracking bottledWater freeWaiting

ServiceCategory       KOSHER_MEAL_DELIVERY SHABBAT_MEALS MASHGIACH SYNAGOGUE_TRANSFER GUIDE EQUIPMENT OTHER
ServiceBasis          PER_PERSON PER_GROUP PER_DAY PER_PERSON_PER_DAY
ServiceStatus         DRAFT ACTIVE INACTIVE ARCHIVED
ServiceBookingStatus  PENDING_APPROVAL PENDING CONFIRMED CANCELLED COMPLETED NO_SHOW
PackageStatus         DRAFT ACTIVE INACTIVE ARCHIVED
PackageComponentType  HOTEL_STAY TRANSFER TOUR SERVICE
PackageAdjustmentKind NONE DISCOUNT_BPS FIXED_SELL PER_PERSON_FIXED
PackageAdjustmentScope REQUIRED_ONLY ALL_ITEMS
PackageQuantityRule   ONE PER_PERSON PER_ROOM
ShabbatMode           SOLAR FIXED_HOURS NONE
OrderStatus           PENDING_APPROVAL PENDING_CONFIRMATION CONFIRMED PARTIALLY_CANCELLED CANCELLED COMPLETED
OrderItemStatus       AWAITING_APPROVAL REQUESTED CONFIRMED DECLINED CANCELLED COMPLETED NO_SHOW
BookingApprovalMode   AUTO REQUIRED
PaymentStatus         NONE UNPAID PARTIAL OVERDUE PAID WAIVED VOID   (derived from the receivable, never stored)
OrderItemFulfilment   INTERNAL ON_REQUEST EXTERNAL
PricingProductType    HOTEL TRANSFER TOUR SERVICE PACKAGE
BookingSource         WEB PARTNER ADMIN PHONE EMAIL EXTERNAL_AGENCY DIRECT DEMO   (the session's word, or the desk's channel)
CustomerKind          INDIVIDUAL COMPANY
NotificationCategory  BOOKING DISPATCH FINANCE APPROVAL DEADLINE SYSTEM
```
