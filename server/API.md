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
| GET | `/transfers/bookings/:reference/cancellation-quote` | |
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
Drivers read theirs at `GET /api/driver/notifications` (`unread=true`) and
mark them with `POST /api/driver/notifications/:id/read` or `…/read-all`.

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
| GET / PATCH / DELETE | `/admin/services/:serviceId` | Detail with `publishChecklist`; delete refuses 409 `HAS_BOOKINGS` / `IN_PACKAGE`. |
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

Status: `PENDING_CONFIRMATION → CONFIRMED → PARTIALLY_CANCELLED | CANCELLED | COMPLETED`. Item status mirrors its child: `REQUESTED | CONFIRMED | DECLINED | CANCELLED | COMPLETED | NO_SHOW`.

### Admin → Orders

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/orders` | Every order; `?status=PENDING_CONFIRMATION` is the on-request queue, earliest deadline first. Rows carry `pendingCount`. `?status&packageId&partnerId&from&to&search&page&pageSize` |
| GET | `/admin/orders/:reference` · `…/cancellation-quote` | With net, margin and the frozen allocation. |
| POST | `/admin/orders/:reference/cancel` | `{ reason? }` |
| POST | `/admin/orders/:reference/items/:slotIndex/confirm` · `/decline` (`{ reason }`) · `/cancel` | The operator's answer to a request, and the override that cancels a required part on its own. |

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
A fixed `sellCents` replaces the markup entirely, so it may never sit below
`netCents`: 400 when one request carries both, 422 `SELL_BELOW_NET` (with the
`netCents` or `sellCents` already on those nights) when a half-update would get
a night there, and the table's `rates_sell_gte_net` CHECK beneath both. The
same rule applies to a service's `netCents`/`sellCents`.
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
`ADMIN`, `MANAGEMENT`, `RESERVATIONS`, `FINANCE`, `DISPATCHER`, `DRIVER`.
Partner side, always attached to one: `PARTNER_OWNER`, `PARTNER_ADMIN`,
`PARTNER_AGENT`, `PARTNER_FINANCE`. The database CHECK enforces the split.

What a role may do is a list of **capabilities** (`server/lib/permissions.js`),
and the signed-in user's list travels on `user.capabilities` in the sign-in
response and on `GET /api/auth/me`, sorted, so a client decides what to show
from that rather than from a copy of the role table. Names are `area.verb`:
`catalogue.write`, `bookings.cancel`, `finance.margin.read`,
`users.staff.manage`, `partner.team.manage`, `partner.bookings.write`, and so
on. A 403 from a capability guard says what was missing:
`{ error: { details: { reason: "INSUFFICIENT_CAPABILITY", required: ["…"] } } }`.

What the platform roles reach in the admin panel:

| Area | Read | Change |
| --- | --- | --- |
| Catalogue — destinations, amenities, hotels, tours, services, packages, transfer points/vehicles/routes | every staff role | `SUPER_ADMIN`, `ADMIN` |
| A hotel's contracts and documents | the list: `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `RESERVATIONS`, `FINANCE`; opening a file goes by its category — a contract or rate sheet needs `partners.financial.read`, a payment slip or invoice `finance.payments.read`, a driver's papers `dispatch.read`, a certificate `catalogue.read` | `SUPER_ADMIN`, `ADMIN` |
| Bookings and orders, every company | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `RESERVATIONS`, `FINANCE` (transfers: also `DISPATCHER`) | confirm/decline and cancel: `SUPER_ADMIN`, `ADMIN`, `RESERVATIONS` |
| Fleet, drivers, dispatch | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `RESERVATIONS`, `DISPATCHER` | `SUPER_ADMIN`, `ADMIN`, `DISPATCHER` (deleting a car or a driver: admins) |
| Partners | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `RESERVATIONS`, `FINANCE` | `SUPER_ADMIN`, `ADMIN` |
| A partner's bank details | `SUPER_ADMIN`, `ADMIN`, `FINANCE` | `SUPER_ADMIN`, `ADMIN` |
| Pricing rules | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `FINANCE` | `SUPER_ADMIN`, `ADMIN` |
| Net, markup and margin in any response | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `FINANCE` | — |
| Which agency bought a booking | `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `RESERVATIONS`, `FINANCE` | — |

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
| A partner's history (`/admin/partners/:id/audit`) | `audit.read`: `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `FINANCE` | — |

Reading every booking is not changing one. On the public booking routes
(`/bookings`, `/tours/bookings`, `/transfers/bookings`, `/orders`) a staff
session is refused at the router unless it holds `bookings.write` or
`bookings.cancel` (403 `INSUFFICIENT_CAPABILITY`), and beneath that the
services answer a desk that reads but may not change — management, finance —
as they would a stranger, with a 404. The identity on `/auth/me` and
`/partner/me` never carries bank details; `GET /partner/financial` and
`GET /admin/partners/:id/financial` (`partners.financial.read`) do.
| GET | `/admin/users?role&status&q&page&pageSize` | `status` ∈ `INVITED` `ACTIVE` `DEACTIVATED`; `role` repeatable; envelope `{ data, total, page, pageSize, totalPages }` |
| POST | `/admin/users` | `{ email, firstName, lastName, role, position?, phone? }`, `role` ∈ `ADMIN` `MANAGEMENT` `RESERVATIONS` `FINANCE` `DISPATCHER`. 201 `{ user, link: { kind: "activation", url, expiresAt }, email, emailSent }` — the link is returned as well as emailed, as for partners and drivers. 409 `{ field: "email" }` when taken |
| GET | `/admin/users/:id` | `status` is derived: no password yet → `INVITED`; switched off → `DEACTIVATED`; else `ACTIVE`. Carries `invitedBy`, `invitedAt`, `deactivatedBy`, `deactivatedAt` |
| PATCH | `/admin/users/:id/role` | `{ role }`, any staff role including `SUPER_ADMIN`; ends the account's sessions |
| POST | `/admin/users/:id/deactivate` | `{ reason? }`; sessions end now and every unused activation or reset link is spent. 409 `NOT_ACTIVATED` for an invitation — delete it instead |
| POST | `/admin/users/:id/reactivate` | |
| POST | `/admin/users/:id/sessions/revoke` | `{ user, revoked }` |
| POST | `/admin/users/:id/activation/resend` | a fresh link; the old one stops working |
| DELETE | `/admin/users/:id` | `{ confirm: email }` must match. Only `INVITED` or `DEACTIVATED` accounts (409 `STILL_ACTIVE`); bookings the person made keep their rows |

Nobody may change, deactivate or delete their own account through these
(400 `SELF`). Invitations are limited per inviter (`AUTH_INVITE_LIMIT`).

### A partner's team — `/partner/team`

`partner.team.manage`: `PARTNER_OWNER` and `PARTNER_ADMIN`, on an approved
partner. The same verbs as above, scoped to the session's company — another
company's user id is **404**. Differences: invite roles are `PARTNER_ADMIN`
`PARTNER_AGENT` `PARTNER_FINANCE`; `PATCH /partner/team/:id/role` accepts any
partner role including `PARTNER_OWNER`; an owner manages everyone (other
owners included) while an admin manages agents and finance users only (403
`ROLE_ABOVE_CEILING`); `PATCH /partner/team/:id/primary-contact` moves the one
primary contact to an active member, within the same ceiling on both the
member gaining it and the one losing it (so a partner admin cannot take it
from an owner); a team holds at most `PARTNER_TEAM_MAX`
members, invited ones included (409 `TEAM_FULL`).

### Audit log — `/admin/audit`

`audit.read` (`SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `FINANCE`).
`GET /admin/audit?entityType&entityId&actorUserId&action&q&from&to&page&pageSize`
answers the whole trail newest first, each entry `{ id, action, entityType,
entityId, summary, metadata, actor, actorEmail, createdAt }`. `action` must be a
known audit action (400 otherwise); `from`/`to` are ISO instants. Successful
sign-ins (`USER_LOGIN_SUCCEEDED`, with the user agent) and sign-outs
(`USER_LOGGED_OUT`) are on the trail beside the failures.

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
`finance.payments.write` or `finance.terms.write` (super admin, admin,
finance); a CSV export needs `finance.export` as well.

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
| GET | `/reports/summary?currency&from&to&format` | Per currency: receivables open / overdue / refund due, payables open / overdue / due within 7 days / needing review, and cash in and out in the period (`from`/`to` are dates, Tbilisi days, last 30 by default) |
| GET | `/reports/margin?currency&from&to&groupBy&format` | Bookings confirmed in the period, grouped by `product`, `supplier` or `partner`: `bookings`, `revenueCents` (what the buyer owes for them now), `costCents` (what suppliers are owed now), `marginCents`, `marginBps`. A package line counts at its own product's price |
| GET | `/reports/ageing?side&currency&format` | `side=receivables` or `payables`: open money per counterparty in `current` (not yet due or undated), `d1_30`, `d31_60`, `d61_90`, `d90_plus` |
| GET/PUT | `/terms/:kind/:id` | `kind` = `hotels`, `transfer-providers`, `tours`, `services`. `{ milestones, cancellationLiability, cutoffTime?, notes? }`; GET answers the defaults with `isDefault: true` when none are saved. New terms apply to bookings confirmed afterwards; existing schedules are not moved |
| GET/PATCH | `/partners/:id/terms` | `{ paymentDueDays (0–365), paymentDueAnchor: CONFIRMATION or ARRIVAL, paymentTermsNote }` |

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

### A partner's own money — `/partner/finance`

`partner.statement.read` (owner, partner admin, partner finance), approved
partners only, always scoped to the session's company.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/partner/finance/statement?status&page&pageSize` | `balances[]` per currency (`outstandingCents`, `overdueCents`, `creditCents`) and the agency's receivables with the payments against each — no supplier, no net, no internal notes |
| GET | `/partner/finance/payables?status&page&pageSize` | For a supplier: what we owe it for its own bookings — its net and its schedule, nothing of ours |

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
BookingStatus  PENDING CONFIRMED CANCELLED COMPLETED NO_SHOW
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
TransferBookingStatus PENDING CONFIRMED CANCELLED COMPLETED NO_SHOW
TransferTripType      ONE_WAY RETURN
TransferExtraBasis    FIXED PER_PASSENGER PER_HOUR PERCENT
TransferFeature       airConditioning wifi childSeat englishDriver meetGreet flightTracking bottledWater freeWaiting

ServiceCategory       KOSHER_MEAL_DELIVERY SHABBAT_MEALS MASHGIACH SYNAGOGUE_TRANSFER GUIDE EQUIPMENT OTHER
ServiceBasis          PER_PERSON PER_GROUP PER_DAY PER_PERSON_PER_DAY
ServiceStatus         DRAFT ACTIVE INACTIVE ARCHIVED
ServiceBookingStatus  PENDING CONFIRMED CANCELLED COMPLETED NO_SHOW
PackageStatus         DRAFT ACTIVE INACTIVE ARCHIVED
PackageComponentType  HOTEL_STAY TRANSFER TOUR SERVICE
PackageAdjustmentKind NONE DISCOUNT_BPS FIXED_SELL PER_PERSON_FIXED
PackageAdjustmentScope REQUIRED_ONLY ALL_ITEMS
PackageQuantityRule   ONE PER_PERSON PER_ROOM
ShabbatMode           SOLAR FIXED_HOURS NONE
OrderStatus           PENDING_CONFIRMATION CONFIRMED PARTIALLY_CANCELLED CANCELLED COMPLETED
OrderItemStatus       REQUESTED CONFIRMED DECLINED CANCELLED COMPLETED NO_SHOW
OrderItemFulfilment   INTERNAL ON_REQUEST EXTERNAL
PricingProductType    HOTEL TRANSFER TOUR SERVICE PACKAGE
```
