# API Testing Guide

Everything a tester needs to exercise the "I am Georgia" API by hand or through
the Postman collection in [`postman/`](postman/).

Each endpoint is listed with **what to send** and **exactly what should come
back** — both when it works and when it does not. If you get something else,
that is a bug worth raising.

> **Before you start:** the API must be running. See
> [LOCAL_SETUP.md](LOCAL_SETUP.md).
> Base URL for local testing: `http://localhost:5000`

---

## Part 1 — Ground rules

Read this section once. It explains conventions that apply to every endpoint and
will save you filing false bugs.

### 1.1 Everything lives under `/api`

The only exceptions are the two health checks (`/health`, `/health/db`) and, in
local development only, `/media/*` for uploaded files.

### 1.2 Authentication is a cookie, not a token

Signing in sets an `httpOnly` cookie named **`iag_session`**. There is no bearer
token and no `Authorization` header anywhere in this API.

- **In Postman:** nothing to do. Postman's cookie jar stores it automatically
  after `POST /api/auth/login` and sends it on every later request.
- **In a browser / fetch:** you must send `credentials: 'include'`.
- **In curl:** use a cookie jar — `curl -c jar.txt -b jar.txt ...`

The session slides forward as you use it (30 days by default) but has a hard
ceiling of 90 days from creation. Deactivating a user kills their access on the
**next request**, not when the cookie expires.

### 1.3 Every error has the same shape

```json
{ "error": { "message": "Human-readable explanation" } }
```

Some errors add `details`:

```json
{
  "error": {
    "message": "Invalid request body",
    "details": [
      { "code": "invalid_type", "path": ["leadGuest", "email"], "message": "Required" }
    ]
  }
}
```

`details` is either a **zod issue array** (for a `400`) or a **structured
object** (for a domain conflict, e.g. `{ "reason": "PRICE_CHANGED" }`).

**Never expect a bare string body or a plain-text error.** If you see one, that
is a bug.

### 1.4 Money is always integer minor units

`52500` means **525.00 GEL**, not 52,500. Every amount travels with a
`currency`, and every field name ends in `Cents`. Floating-point money never
appears anywhere in this API.

### 1.5 Dates are calendar strings, not timestamps

Stay dates are `"2027-06-01"` — a date at the property, never an instant.
**Check-out is exclusive**: `checkIn: 2027-06-01`, `checkOut: 2027-06-04` is
three nights.

Pick-up times and cancellation deadlines *are* instants, and appear as full ISO
strings: `"2027-06-01T10:00:00.000Z"`.

### 1.6 Lists are always paginated the same way

```json
{ "data": [ ... ], "total": 137, "page": 1, "pageSize": 24, "totalPages": 6 }
```

Send `?page=` and `?pageSize=`. Page sizes are capped (24–25 default, 50–100
max depending on the endpoint); asking for more is a `400`, not a silent clamp.

### 1.7 Some fields are invisible unless you are staff

Fields marked **staff-only** in this guide are **absent from the JSON entirely**
— not `null`, not `0` — unless the caller is an admin or the supplier that owns
the hotel.

The ones to watch: `netCents`, `netTotalCents`, `markupBps`, `marginCents`,
`partner`, and a transfer quote's `legs[].source`.

**Test this deliberately.** Call the same endpoint anonymously and as an admin
and diff the responses. A `netCents` leaking to an anonymous caller is a
**severity-1 bug** — it exposes the platform's margin.

### 1.8 No endpoint accepts an amount

Not search, not checkout, not booking. Request bodies carry identifiers, dates
and people; **every figure is recomputed on the server**. The booking schemas
are `.strict()`, so sending `{ "totalCents": 1 }` is a `400`, not a silently
ignored field.

This is the single most important thing to try to break. If you ever manage to
influence a price from the request body, stop and report it.

### 1.9 Prices travel as signed tokens

Search hands you an **offer token** (hotels) or **quote token** (transfers). It
is a signed blob naming the room, the rate, the dates and the price. You carry
it into checkout unchanged.

- Editing a single character of a token → **`400`** (signature check fails).
- Using one older than 30 minutes → **`410 Gone`**.
- Using one whose underlying price has moved → **`409`** with both figures.

### 1.10 Cross-site protection

Every state-changing request (POST/PATCH/PUT/DELETE) is checked against the
browser-set `Origin` and `Sec-Fetch-Site` headers. A request from an origin
other than `CLIENT_ORIGIN` gets **`403 Cross-site requests are not accepted`**.

**Requests carrying neither header pass.** That is deliberate — a browser cannot
suppress those headers on a cross-origin write, so a request without them came
from curl, Postman or a server integration, none of which has an ambient cookie
jar to exploit.

> **Practical effect for you:** Postman and curl work with no extra setup. To
> *test* the protection, add a header `Origin: https://evil.example.com` to any
> POST and expect a `403`.

### 1.11 Rate limits

| Limit | Window | Counted per | Env variable |
| --- | --- | --- | --- |
| 100 requests | 1 minute | IP, across everything except `/health` | `RATE_LIMIT_GLOBAL` |
| 30 requests | 1 minute | IP, on `/api/search/*` only | — |
| 10 **failed** sign-ins | 15 minutes | IP **and** email combined | `AUTH_LOGIN_LIMIT` |
| 5 wrong current-passwords | 15 minutes | signed-in user | `AUTH_PASSWORD_CHANGE_LIMIT` |
| 5 reset links | 15 minutes | email address, wherever asked from | `AUTH_FORGOT_PASSWORD_LIMIT` |
| 30 token lookups | 15 minutes | IP | `AUTH_TOKEN_LOOKUP_LIMIT` |
| 5 invitation claims | 1 hour | IP | `AUTH_REGISTRATION_LIMIT` |

Over the limit → **`429`** with `{ "error": { "message": "Too many ..." } }` and
standard `RateLimit-*` response headers.

Two details that matter when testing:

- The login limiter uses `skipSuccessfulRequests` — **a successful login does
  not count**. Only failures do.
- Locally, counters live in the server process's memory. **Restarting the
  server clears every limit.** That is your reset button.

### 1.12 Status codes you should expect

| Code | Means | Typical cause |
| --- | --- | --- |
| `200` | Success | Read, update, or a replayed idempotent create |
| `201` | Created | A new booking, hold, partner or amenity |
| `204` | Success, no body | Logout, releasing a hold, password change/reset |
| `400` | Bad input | zod validation failed; `details` says which field |
| `401` | Not signed in | Missing, expired or revoked session cookie |
| `403` | Signed in, not allowed | Wrong role, unapproved partner, cross-site write |
| `404` | Not there | Also what you get for *someone else's* record — see below |
| `409` | Conflict | Price moved, sold out, duplicate slug, wrong status |
| `410` | Gone | Expired offer/quote token |
| `413` | Too large | Body over 100 KB, or an oversized upload |
| `422` | Understood but unprocessable | Publish blocked by checklist; transfer window rules |
| `429` | Rate limited | See above |
| `500` | Server error | Always a bug. Capture the request and the server log. |
| `503` | Dependency down | `/health/db` when Postgres is unreachable |

**`404` versus `403` is intentional.** Asking for another supplier's hotel
returns `404`, not `403` — telling you "that exists but is not yours" would
confirm the record exists. Do not file this as a bug.

---

## Part 2 — Health

### `GET /health`

Liveness. Deliberately does not touch the database, so an orchestrator will not
restart a healthy API over a slow query.

**Expected — 200**

```json
{ "status": "ok", "uptime": 128.44 }
```

### `GET /health/db`

Readiness. Runs `SELECT NOW()`.

**Expected — 200**

```json
{ "status": "ok", "now": "2026-08-30T09:12:44.180Z" }
```

**Expected — 503** when Postgres is down:

```json
{ "status": "error", "message": "Database unavailable" }
```

> Note it reports failure as a `503` **response**, not as a thrown error, so it
> never reaches the generic error handler. Both health routes are exempt from
> the global rate limit.

---

## Part 3 — Authentication

All under `/api/auth`. Every response here carries `Cache-Control: no-store`
and `Vary: Cookie` — worth asserting, because an authenticated response sitting
in a shared cache is a real security bug.

### `POST /api/auth/login`

```json
{ "email": "you@example.com", "password": "Str0ngLocalPass!" }
```

**Expected — 200**, plus a `Set-Cookie: iag_session=...; HttpOnly; SameSite=...`

```json
{
  "user": {
    "id": "clx...", "email": "you@example.com",
    "firstName": "Your", "lastName": "Name",
    "role": "SUPER_ADMIN", "isActive": true
  },
  "partner": null
}
```

`partner` is `null` for staff, and the full partner record for a partner user.

| Scenario | Expected |
| --- | --- |
| Wrong password | `401` — *"Incorrect email address or password"* |
| Unknown email | `401` — the **same** message. Different wording would let someone enumerate accounts. |
| Deactivated account | `401` |
| Missing `password` field | `400` with a zod `details` array |
| `email` not an email | `400` |
| 11th consecutive failure | `429` — *"Too many sign-in attempts. Try again later."* |

> **Check the cookie flags.** `HttpOnly` must be present. Missing it means
> JavaScript can read the session — report immediately.

### `POST /api/auth/logout`

No body. **Expected — `204`, no content**, plus a `Set-Cookie` that clears the
session.

Calling it **without** a session is also `204`. Logging out of nothing has
succeeded by any definition the caller cares about — this is not a bug.

### `GET /api/auth/me`

**Expected — 200**, the same `{ user, partner }` shape as login.
Without a cookie: **`401`**.

Use this as your "am I still signed in?" probe throughout a test run.

### `GET /api/auth/activation/:token`

Reads an activation link before the password is set, so the page can greet the
holder by name.

**Expected — 200**

```json
{
  "email": "nino@partner.ge",
  "firstName": "Nino", "lastName": "Beridze",
  "companyName": "Alpine Tours LLC",
  "expiresAt": "2026-09-01T09:00:00.000Z"
}
```

| Scenario | Expected |
| --- | --- |
| Token already used | `410` or `404` |
| Token expired | `410` |
| Token under 20 characters | `400` — rejected before it reaches the database |
| 31st lookup in 15 minutes | `429` |

### `POST /api/auth/activation/:token`

```json
{ "password": "a-strong-password-12+" }
```

**Expected — 200** with `{ user, partner }` **and a session cookie**. The user
is signed in immediately — sending someone who just proved control of their
mailbox back to a login form would be pointless.

| Scenario | Expected |
| --- | --- |
| Password under 12 characters | `400` — *"Use at least 12 characters"* |
| A common password (`password123`) | `400` — *"That password is too common"* |
| Password containing their own name or email local-part | `400` |
| Re-using the same token | `410`/`404` — single use |

### `POST /api/auth/password/forgot`

```json
{ "email": "you@example.com" }
```

**Expected — `204`, always.** Whether or not the address has an account, whether
or not the account is active. Any other behaviour would turn this endpoint into
an account-enumeration oracle.

**How to verify it actually worked:** look in the server terminal.
`MAIL_TRANSPORT=log` prints the reset email, link included.

Sixth request for the same address within 15 minutes → **`429`**. Note the
counter is keyed on **what was typed**, not on what was found, so it still
reveals nothing.

### `POST /api/auth/password/reset/:token`

```json
{ "password": "a-new-strong-password" }
```

**Expected — `204`**, and the session cookie is **cleared**. Unlike activation,
a reset does *not* sign you in: this is the flow someone uses when they suspect
their account was reachable by someone else, so it ends every session and makes
them sign in deliberately.

Verify afterwards that the old password gives `401` and the new one gives `200`.

### `POST /api/auth/password/change`

Requires a live session.

```json
{ "currentPassword": "old-one", "newPassword": "a-new-strong-one" }
```

**Expected — `204`**, plus a **fresh** session cookie. The change revokes every
session the account had — including this one — so the device doing the changing
is handed a new cookie rather than being signed out for its trouble.

| Scenario | Expected |
| --- | --- |
| Wrong `currentPassword` | `401` |
| `newPassword` identical to `currentPassword` | `400` — *"Choose a password you have not used here before"* |
| Weak `newPassword` | `400` |
| Not signed in | `401` |
| 6th wrong attempt in 15 minutes | `429` (counted per **user**, not per IP) |

**Worth testing explicitly:** sign in on two Postman environments, change the
password on one, then call `/api/auth/me` on the other. It must be `401`.

---

## Part 4 — Public catalogue

No authentication. These are the marketing pages' data.

### `GET /api/destinations`

Query: `locale` (`en`/`ka`/`ru`/`he`), `countryCode`, `featured`

**Expected — 200**, the whole tree, nested:

```json
{
  "data": [
    {
      "id": "clx...", "slug": "georgia", "name": "Georgia",
      "type": "COUNTRY", "path": "/georgia",
      "children": [
        { "slug": "tbilisi", "name": "Tbilisi", "type": "CITY", "children": [] }
      ]
    }
  ]
}
```

`?locale=ka` returns Georgian names, **falling back to English field by field**
where a translation is missing — never a blank string.

### `GET /api/destinations/:slug`

**Expected — 200**, detail with `parent` and `children`.
Unknown slug → **`404`**.

### `GET /api/hotels`

Browsing, **not** searching — no dates, so no availability is checked. This
answers "what properties exist in Bakuriani".

Query: `search`, `destinationSlug`, `destinationPath`, `propertyType`,
`minStars`, `amenity` (repeatable), `featured`, `locale`, `page`, `pageSize`

**Expected — 200**

```json
{
  "data": [{
    "id": "clx...", "slug": "gudauri-alpine-hotel", "name": "Gudauri Alpine Hotel",
    "propertyType": "Hotel", "starRating": 4,
    "destination": { "slug": "gudauri", "name": "Gudauri" },
    "coverImage": { "url": "https://..." },
    "priceFrom": { "amountCents": 21000, "currency": "GEL" }
  }],
  "total": 9, "page": 1, "pageSize": 24, "totalPages": 1
}
```

**Things to verify here:**

1. **Only `ACTIVE` hotels are ever returned** — whatever the query string says.
   There is no combination of parameters that reaches a `DRAFT`. Try
   `?status=DRAFT`; you should get either a `400` or the ACTIVE list, never a
   draft.
2. **`priceFrom` is viewer-relative.** Anonymous callers see the platform
   default markup; a signed-in partner sees theirs. Call it both ways and expect
   *different numbers* — that is correct, not a bug.
3. `priceFrom` is **indicative** and rounded to whole currency units. A price
   without dates is not an offer.
4. Catalogue cards never carry `status`, `supplierId` or inventory data, even
   for a partner. That belongs to the extranet, not the shop window.

### `GET /api/hotels/:slug`

**Expected — 200**, the full property: `roomTypes[]` (each with its own
`priceFrom`), `amenities[]`, `images[]`, `childPolicy`, address, coordinates.

The hotel-level `priceFrom` always equals the cheapest room's, so the header and
the room list can never disagree.

Unknown or non-ACTIVE slug → **`404`**.

### `GET /api/amenities`

Query: `category`, `scope`, `locale`

**Expected — 200** — `{ "data": [{ "id", "slug", "name", "category", "icon" }] }`

Deactivated amenities are never returned. `includeInactive` is stripped from
public queries before the service sees it, so it cannot be forced from the URL.

---

## Part 5 — Hotel search and booking

This is the core money path. Test it end to end and in that order — each step
consumes a token from the one before.

```
GET /api/search  ──▶ offer token
                       │
                       ├──▶ POST /api/bookings/holds  ──▶ hold token
                       │                                     │
                       └──▶ POST /api/bookings ◀──────────────┘
                                   │
                                   ├──▶ GET  /api/bookings/:reference
                                   ├──▶ PATCH /api/bookings/:reference
                                   └──▶ POST /api/bookings/:reference/cancel
```

### `GET /api/search`

**Required:** `checkIn`, `checkOut`
**Optional:** `adults` (default 2), `childAges` (repeatable), `rooms`
(default 1), `destinationSlug`, `destinationPath`, `countryCode`,
`propertyType`, `minStars`, `amenity` (repeatable), `mealPlan`,
`refundableOnly`, `locale`, `page`, `pageSize`

```
GET /api/search?checkIn=2027-06-01&checkOut=2027-06-04&adults=2&destinationSlug=gudauri
```

**Expected — 200**

```json
{
  "data": [{
    "id": "clx...", "slug": "gudauri-alpine-hotel", "name": "Gudauri Alpine Hotel",
    "starRating": 4,
    "destination": { "name": "Gudauri", "path": "/georgia/gudauri" },
    "startingFrom": { "totalCents": 52500, "perNightCents": 17500, "currency": "GEL" },
    "mealPlans": ["BB"], "refundable": true, "offerCount": 3,
    "cheapestOffer": {
      "token": "eyJ...signed...",
      "roomTypeId": "clx...", "ratePlanId": "clx...",
      "name": "Breakfast, flexible",
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
  }],
  "total": 1, "page": 1, "pageSize": 24, "totalPages": 1
}
```

**Staff-only inside `quote`:** `nights[].netCents`, `totals.netCents`,
`markupBps`, `marginCents`. Confirm they are absent anonymously.

| Scenario | Expected |
| --- | --- |
| `checkOut` before or equal to `checkIn` | `400` — *"Check-out must be after check-in"* |
| Missing `checkIn` | `400` |
| `checkIn=01/06/2027` (wrong format) | `400` — *"Use a calendar date, for example 2026-12-20"* |
| Stay longer than 30 nights | `400` (`HOTEL_MAX_STAY_NIGHTS`) |
| Dates beyond ~540 days out | `400`/`422` (`HOTEL_BOOKING_HORIZON_DAYS`) |
| `adults=0` or `adults=99` | `400` (range 1–30) |
| `pageSize=500` | `400` (max 50) |
| Nothing available | **`200` with `data: []`** — an empty result is an answer, not an error |
| 31st search in a minute | `429` |

> **Repeated parameters make arrays:**
> `?amenity=wifi&amenity=parking&childAges=4&childAges=9`.
> Ages, not a count — a hotel cannot price a child without knowing how old it
> is, and an 11- and 12-year-old may be a child and an adult at the same
> property.

### `GET /api/search/hotels/:slug`

Same stay parameters, availability for one property grouped by room type.

**Expected — 200** — `{ "hotelId", "nights", "roomTypes": [...] }`, each room
type carrying its own offers.

### `POST /api/search/offers/quote`

Re-prices an offer before checkout.

```json
{ "token": "eyJ...signed..." }
```

**Expected — 200** — the offer again, re-priced from live data.

| Scenario | Expected |
| --- | --- |
| Price moved since the token was issued | `409` — `details: { "reason": "PRICE_CHANGED", "quotedCents": 52500, "currentCents": 55000 }` |
| Sold out | `409` — `details: { "reason": "UNAVAILABLE" }` |
| Token older than 30 minutes | `410` |
| Token altered by one character | `400` |
| Any extra field in the body | `400` — the schema is `.strict()` so nothing about money can ride along |

### `POST /api/bookings/holds`

Secures the rooms while the guest fills in their details.

```json
{ "token": "eyJ...offer token..." }
```

**Expected — 201**

```json
{
  "token": "hold-token-...",
  "expiresAt": "2026-08-30T09:27:00.000Z",
  "checkIn": "2027-06-01", "checkOut": "2027-06-04",
  "rooms": 1, "currency": "GEL", "totalCents": 52500,
  "hotel": { "id": "clx...", "name": "Gudauri Alpine Hotel", "slug": "gudauri-alpine-hotel" },
  "roomTypeName": "Deluxe Double", "ratePlanName": "Breakfast, flexible"
}
```

Holds last 15 minutes (`HOTEL_HOLD_TTL_MS`) and expired ones are swept back into
availability every 30 seconds.

| Scenario | Expected |
| --- | --- |
| The last room went while you were deciding | `409` |
| Expired offer token | `410` |

> **The oversell test.** Find a room type with `availableUnits: 1`, then fire two
> holds at the same moment. Exactly one must get `201` and the other `409`.
> Availability is enforced by a conditional `UPDATE` whose `WHERE` clause *is*
> the check, so there is no window in which both can win. Two `201`s here is a
> severity-1 bug.

### `DELETE /api/bookings/holds/:token`

**Expected — `204`, always** — including for a token that never existed or has
already expired. Releasing nothing has succeeded. Not a bug.

Verify the room count goes back up immediately afterwards rather than waiting
for the sweeper.

### `POST /api/bookings`

The confirmation. **Send an `Idempotency-Key` header.**

```json
{
  "holdToken": "hold-token-...",
  "leadGuest": {
    "firstName": "Nino", "lastName": "Beridze",
    "email": "nino@example.com", "phone": "+995555123456"
  },
  "guests": [
    { "type": "ADULT", "firstName": "Nino", "lastName": "Beridze" },
    { "type": "CHILD", "firstName": "Luka", "lastName": "Beridze", "age": 9 }
  ],
  "specialRequests": "High floor if possible",
  "source": "web"
}
```

Send **either** `holdToken` **or** `offerToken` — never both, never neither.
`offerToken` exists for server-to-server bookings that have no checkout page.

**Expected — 201**

```json
{
  "reference": "BKG-000001", "status": "CONFIRMED",
  "hotel": { "id": "clx...", "name": "Gudauri Alpine Hotel", "slug": "gudauri-alpine-hotel" },
  "hotelSnapshot": { "name": "...", "address": "...", "phone": "...", "timezone": "Asia/Tbilisi" },
  "checkIn": "2027-06-01", "checkOut": "2027-06-04", "nights": 3, "rooms": 1,
  "leadGuestName": "Nino Beridze", "leadGuestEmail": "nino@example.com",
  "currency": "GEL", "totalCents": 52500, "payableAtPropertyCents": 0,
  "bookingRooms": [{
    "id": "clx...", "status": "CONFIRMED",
    "roomTypeName": "Deluxe Double", "ratePlanName": "Breakfast, flexible",
    "mealPlan": { "code": "BB", "name": "Bed & Breakfast" },
    "bedConfiguration": "1 x King Bed",
    "cancellation": {
      "freeUntil": "2027-06-01T10:00:00.000Z",
      "windows": [{ "fromAt": null, "toAt": "2027-06-01T10:00:00.000Z", "chargeCents": 0 }]
    },
    "sellSubtotalCents": 52500,
    "nights": [{ "date": "2027-06-01", "sellCents": 17500 }],
    "guests": [{ "type": "ADULT", "firstName": "Nino", "isLead": true }]
  }]
}
```

**Staff-only:** `netTotalCents`, `markupBps`, `marginCents`, `partner`, and each
night's `netCents`.

| Scenario | Expected |
| --- | --- |
| **Same `Idempotency-Key` sent again** | **`200`** (not `201`) with the *identical* booking. No second reference. |
| Both `holdToken` and `offerToken` | `400` — *"Provide either a holdToken or an offerToken, not both"* |
| Neither | `400` |
| Any amount field, e.g. `"totalCents": 1` | `400` — the schema is `.strict()` |
| `leadGuest.email` missing or malformed | `400` |
| Hold already expired | `409`/`410` |
| Room sold out between hold and confirm | `409` |

> **The idempotency test is the important one.** Send the same request with the
> same `Idempotency-Key` five times. You must end with exactly **one** booking
> reference: one `201` and four `200`s. Two references means we have
> double-booked a guest.

**Also verify the snapshot.** After booking, rename the room type in the admin
panel, then re-read the booking. It must still show the **old** name. Names come
from the frozen snapshot, not the live hotel — a property that renames a room in
March cannot change what a guest who booked in January was sold.

### `GET /api/bookings/:reference`

- **Signed-in admin or the owning partner:** the session proves it. No query
  needed.
- **Anonymous guest:** must add `?email=` matching the lead guest's address.

**Expected — 200**, the booking detail above.

| Scenario | Expected |
| --- | --- |
| Anonymous, no `email` | `404` (or `401`) — never the booking |
| Anonymous, **wrong** `email` | `404` — never "wrong email", which would confirm the reference exists |
| Another partner's booking | `404`, not `403` |
| Unknown reference | `404` |

### `GET /api/bookings/:reference/cancellation-quote`

**Expected — 200**

```json
{ "chargeCents": 0, "refundCents": 52500, "currency": "GEL", "refundable": true }
```

Read off the **schedule frozen at confirmation**. The hotel's current policy is
never consulted — terms tightened later cannot change what an earlier guest is
owed. Worth testing: tighten the policy in admin, re-read the quote, confirm the
numbers have not moved.

### `PATCH /api/bookings/:reference`

**Paperwork only.**

```json
{
  "leadGuest": { "firstName": "Nino", "phone": "+995555999888" },
  "specialRequests": "Late arrival, around 23:00",
  "email": "nino@example.com"
}
```

The top-level `email` is **not** a new address — it is the proof an anonymous
guest offers that the booking is theirs, the same as on cancel. The address
being *changed* is `leadGuest.email`.

**Expected — 200**, the full booking detail with the changes applied.

| Scenario | Expected |
| --- | --- |
| Any of `checkIn`, `checkOut`, `rooms`, `roomTypeId`, `totalCents` | `400` — not in the schema, on purpose |
| Booking already `CANCELLED` / `COMPLETED` | `409`, carrying the status |
| Wrong or missing `email`, anonymously | `404` |

> Dates, rooms, board and party are deliberately unreachable. Changing any of
> them means releasing inventory and re-quoting: cancel and book again. Allowed
> only while `PENDING` or `CONFIRMED`.

### `POST /api/bookings/:reference/cancel`

```json
{ "reason": "Change of plans", "email": "nino@example.com" }
```

Both fields optional (`email` only for anonymous guests). An empty body `{}` is
valid.

**Expected — 200**

```json
{
  "reference": "BKG-000001", "status": "CANCELLED",
  "cancellation": { "chargeCents": 0, "refundCents": 52500, "currency": "GEL", "refundable": true }
}
```

Then verify: the room is back in availability, and cancelling again returns
`409`.

### `GET /api/partner/bookings`

Requires an **approved** partner session. Query: `status`, `from`, `to`,
`search`, `page`, `pageSize`.

**Expected — 200**, a paginated list of that partner's bookings only. Scoping
happens **in the query**, not as a filter afterwards, so there is no path by
which one partner reads another's.

| Scenario | Expected |
| --- | --- |
| Not signed in | `401` |
| Partner still `PENDING_APPROVAL` | `403` with `details: { "partnerStatus": "PENDING_APPROVAL" }` |
| Suspended partner | `403` |
| `?partnerId=<someone else>` | Ignored — you still get only your own |

### `GET /api/partner/dashboard`

**Expected — 200**

```json
{
  "partner": { "...": "full partner detail" },
  "stats": { "listings": 3, "bookings": 41, "upcoming": 7, "cancelled": 2 }
}
```

`upcoming` counts `CONFIRMED` bookings whose check-in is today or later.

---

## Part 6 — Transfers

The same shape as hotels — a signed quote carried into an idempotent booking —
with one structural difference: **there is no inventory and there are no
holds.** A private transfer is dispatched from an elastic fleet, so nothing has
to be claimed. What can stop a sale is a road closing, which is a blackout.

### Catalogue

| Endpoint | Notes |
| --- | --- |
| `GET /api/transfers/points` | The location picker. `?search&kind&popular&locale` — matches names, regions, IATA codes and every translation |
| `GET /api/transfers/routes` | `?tier&category&featured&fromSlug&toSlug&search&locale&page&pageSize` |
| `GET /api/transfers/routes/:slug` | Route landing page, with `stops[]` |
| `GET /api/transfers/vehicles` | The fleet. `?vehicleClass&kind&locale` |
| `GET /api/transfers/vehicles/:slug` | |
| `GET /api/transfers/extras` | Child seats, ski carriage, extra stops |

All return `200` with `{ "data": [...] }`; the route list is paginated. Only
`ACTIVE` rows are ever returned.

> **Fleet visibility is viewer-dependent, exactly like hotels.** A vehicle class
> is B2B by default: anonymous callers see only `b2cEnabled` classes, a
> signed-in partner sees the whole active fleet. Compare the two responses —
> the partner's should be a superset.

### `GET /api/transfers/quotes`

**Required:** `from`, `to` (point slugs *or* ids), `date`, `time` (`HH:MM`,
24-hour, local to the pick-up point)
**Optional:** `tripType` (`ONE_WAY`/`RETURN`), `returnDate`, `returnTime`,
`adults` (default 2), `children`, `childAges`, `luggage` (default 2),
`cabinBags`, `extra` (repeatable), `locale`

```
GET /api/transfers/quotes?from=tbilisi-airport&to=gudauri&date=2027-02-10&time=09:00&adults=2&luggage=2&extra=childSeat
```

**Expected — 200**

```json
{
  "from": { "slug": "tbilisi-airport", "name": "Tbilisi International Airport",
            "kind": "AIRPORT", "code": "TBS", "region": "Tbilisi", "timezone": "Asia/Tbilisi" },
  "to":   { "slug": "gudauri", "name": "Gudauri", "kind": "RESORT" },
  "route": { "slug": "tbilisi-airport-to-gudauri", "tier": "TIER_1",
             "distanceKm": 128, "startingFromCents": 12776 },
  "closed": false,
  "offers": [{
    "token": "eyJ...signed...",
    "vehicle": {
      "slug": "comfort-sedan-private-transfer", "name": "Comfort Sedan",
      "vehicleClass": "COMFORT", "body": "sedan", "kind": "PRIVATE",
      "maxPassengers": 3, "features": ["airConditioning", "englishDriver"]
    },
    "quote": {
      "currency": "GEL", "perSeat": false,
      "legs": [{
        "direction": "OUTBOUND", "from": "Tbilisi International Airport", "to": "Gudauri",
        "pickupAt": "2027-02-10T05:00:00.000Z",
        "distanceKm": 128, "durationMinutes": 135, "isNight": false,
        "baseFareCents": 17116, "nightSurchargeCents": 0,
        "extras": [{ "code": "childSeat", "quantity": 1, "totalCents": 2000 }],
        "sellCents": 19116
      }],
      "totals": { "sellCents": 19116, "totalCents": 19116 }
    }
  }]
}
```

**Staff-only:** `legs[].netCents`, `legs[].source`, `totals.netCents`,
`markupBps`, `marginCents`, and the vehicle's `fallbackPricing`.

**Pricing is two-tier.** A curated route price is used when one exists;
otherwise the fare is `max(minimumFare, distanceKm x perKm) + airportFee` from
the vehicle class. So every pair of points is bookable, and the commercially
important ones are priced by hand. The response says which was used — but only
to staff, in `quote.legs[].source`.

| Scenario | Expected |
| --- | --- |
| **Road closed for those dates** | **`200`** with `"closed": true` and `"offers": []` — a real answer, not an error |
| **Party too large for any vehicle** | **`200` with no offers.** Capacity is a hard constraint, not a filter |
| A point we do not serve | `404` |
| `from` equals `to` | `409` — `details: { "reason": "SAME_POINT" }` |
| Pick-up under 3 hours away | `422` — `{ "reason": "TOO_SOON" }` (`TRANSFER_MINIMUM_NOTICE_MINUTES`) |
| Beyond ~540 days out | `422` — `{ "reason": "BEYOND_HORIZON" }` |
| Return before outbound | `422` — `{ "reason": "RETURN_BEFORE_OUTBOUND" }` |
| Over 50 passengers | `422` — `{ "reason": "PARTY_TOO_LARGE" }` |
| `tripType=RETURN` without `returnDate`/`returnTime` | `400` — *"A return journey needs a return date and time"* |
| `time=9:00` or `time=25:00` | `400` — *"Use a 24-hour time, for example 09:30"* |

> **Night surcharge.** Pick-ups between 22:00 and 06:00 *local to the pick-up
> point* carry a 20% surcharge by default. Quote the same journey at `14:00` and
> at `23:00` and confirm `nightSurchargeCents` is `0` and then non-zero.

### `POST /api/transfers/quotes/revalidate`

```json
{ "token": "eyJ...quote token..." }
```

**Expected — 200**, the offer re-priced. **This one is deliberately not
strict** — it is the preview call a results page makes when a token has been
sitting in a tab, so it *shows* the new fare rather than refusing. A changed
price here is a `200`, not a `409`.

Expired token → `410`. Tampered token → `400`.

### `POST /api/transfers/bookings`

**Send an `Idempotency-Key` header.**

```json
{
  "quoteToken": "eyJ...signed...",
  "leadPassenger": {
    "firstName": "Nino", "lastName": "Beridze",
    "email": "nino@example.com", "phone": "+995555123456"
  },
  "flightNumber": "TK378",
  "pickupAddress": "Terminal 1, arrivals hall",
  "dropoffAddress": "Gudauri Alpine Hotel, main entrance",
  "specialRequests": "Two large ski bags",
  "source": "web"
}
```

**Expected — 201**

```json
{
  "reference": "TRF-000001", "status": "CONFIRMED", "tripType": "ONE_WAY",
  "pickupAt": "2027-02-10T05:00:00.000Z", "returnPickupAt": null,
  "route": { "fromName": "Tbilisi International Airport", "toName": "Gudauri",
             "distanceKm": 128, "stops": [] },
  "vehicle": { "name": "Comfort Sedan", "vehicleClass": "COMFORT",
               "providerName": "...", "pickupProcedure": "..." },
  "adults": 2, "children": 0, "luggage": 2,
  "leadPassengerName": "Nino Beridze", "leadPassengerEmail": "nino@example.com",
  "flightNumber": "TK378", "pickupAddress": "Terminal 1, arrivals hall",
  "currency": "GEL", "totalCents": 19116,
  "cancellation": {
    "freeUntil": "2027-02-09T05:00:00.000Z",
    "windows": [{ "fromAt": null, "toAt": "2027-02-09T05:00:00.000Z", "chargeCents": 0 }]
  },
  "legs": [{ "legIndex": 0, "direction": "OUTBOUND", "from": "...", "to": "...",
             "pickupAt": "2027-02-10T05:00:00.000Z", "sellCents": 19116 }],
  "extras": [{ "code": "childSeat", "quantity": 1, "totalCents": 2000 }]
}
```

References are `TRF-000001`. **Staff-only:** `netTotalCents`, `markupBps`,
`marginCents`, `partner`, per-leg `netCents`.

| Scenario | Expected |
| --- | --- |
| Same `Idempotency-Key` replayed | `200` with the same booking — **not** a second car dispatched |
| Any amount field | `400` — `.strict()` |
| Missing `leadPassenger.email` | `400` |
| Expired `quoteToken` | `410` |
| Fare moved since quoting | `409` — booking calls the pricer in strict mode, unlike revalidate |

A voucher email is sent **after** the transaction commits, and only on a genuine
`201` — never on a replay. Check the server log for it.

### The rest of the transfer booking endpoints

They behave exactly like their hotel equivalents:

| Endpoint | Expected |
| --- | --- |
| `GET /api/transfers/bookings/:reference` | `200`. Travellers must add `?email=`; wrong email is `404` |
| `GET /api/transfers/bookings/:reference/cancellation-quote` | `200` — `{ chargeCents, refundCents, currency, refundable }`, off the frozen schedule |
| `PATCH /api/transfers/bookings/:reference` | `200`. Paperwork only: lead passenger, phone, `flightNumber`, the two addresses, `specialRequests`. Anything else is `400`; wrong status is `409` |
| `POST /api/transfers/bookings/:reference/cancel` | `200` with the summary plus `cancellation` |
| `GET /api/partner/transfers/bookings` | `200`, that partner's transfers only |

> The journey, the vehicle, the date and the party are **not** amendable,
> because changing any of them changes the fare — and a fare that changes
> without being re-quoted is a dispute waiting to happen.

---

## Part 6b — Tours

Tours follow the hotel shape exactly, with departures in place of nights. Seed the catalogue first — `node --env-file=.env.test scripts/seed-tours.js` after `seed-reference.js` and `seed-catalogue.js` — and you have ten published tours (the editorial data lives in `db/seed/tours.js`), each with a shared seat option and a private group option, a year of price sheets and departures. Multi-day private options are **on request**.

### 6b.1 Browse and search

```
GET /api/tours?locale=ka
GET /api/tours/kakheti-wine-route
GET /api/search/tours?date=2027-08-10&adults=2&childAges=6
GET /api/search/tours/kakheti-wine-route?from=2027-08-01&to=2027-08-31&adults=2
```

Expect: anonymous callers see only B2C tours and PUBLIC options; a signed-in partner sees everything ACTIVE. Every departure entry is either `available: true` with a `token` and a `quote`, or `available: false` with a `reason` (`SOLD_OUT`, `PARTY_SIZE`, `TOO_SOON`, `BEYOND_HORIZON`, `PAST`, `UNPRICED`). A partner is quoted at its own commission; no `netCents` ever appears for a non-staff caller.

### 6b.2 Hold, confirm, replay, cancel

```
POST /api/tours/bookings/holds           { "token": "<from search>" }        → 201, units held
POST /api/tours/bookings                 { "holdToken": "...", "leadTraveller": {...}, "travellers": [...] }
                                          Idempotency-Key: any-string          → 201 TUR-000001
POST /api/tours/bookings  (same body + same key)                              → 200, same reference
GET  /api/tours/bookings/TUR-000001?email=<lead email>
GET  /api/tours/bookings/TUR-000001/cancellation-quote?email=...
POST /api/tours/bookings/TUR-000001/cancel  { "email": "..." }
```

Things to try: confirm with an `offerToken` after an admin has repriced the season → `409 PRICE_CHANGED` with `quotedCents`/`currentCents`; five concurrent confirmations against a departure with seven seats → exactly three succeed, two get `409 UNAVAILABLE`; let a hold expire (or `DELETE /holds/:token`) and confirm it → `410`.

### 6b.3 On request

Book the private option of any multi-day tour (or an option with `confirmationMode: ON_REQUEST`) → `201` with `status: PENDING` and `requestDeadlineAt`. The departure is already claimed. Then as an admin:

```
GET  /api/admin/tours/bookings?status=PENDING
POST /api/admin/tours/bookings/TUR-000002/confirm            → CONFIRMED
POST /api/admin/tours/bookings/TUR-000002/decline  { "reason": "Guide unavailable" }  → CANCELLED, charge 0, seats released
```

Confirming twice is a `409`. A pending request cancelled by the traveller charges nothing.

### 6b.4 Admin catalogue

```
POST /api/admin/tours                                   → 201 DRAFT with publishChecklist
POST /api/admin/tours/:tourId/options                   { code, name, kind, pricingBasis, maxPax, cancellationPolicyId, ... }
POST /api/admin/tours/:tourId/options/:optionId/seasons { name, validFrom, validUntil, tiers: [{ minPax, adultNetCents, childNetCents }] }
PUT  /api/admin/tours/:tourId/options/:optionId/inventory { from, to, weekdays?, totalUnits }
GET  /api/admin/tours/:tourId/options/:optionId/inventory/calendar?from&to
POST /api/admin/tours/:tourId/publish                   → 422 with details.missing until the checklist is clear
PUT  /api/admin/tours/:tourId/translations/ka           { title: "..." }
```

Expect: a cancellation policy with per-night rules (the Flexible template) is refused for a tour option with `400`; the Tiered template works. Reducing `totalUnits` below what is already booked answers `409 OVERSELL` naming the dates. Publishing refreshes nothing — `priceFrom` is refreshed whenever a season is written.

## Part 6c — Services

A service is a priced thing with no inventory: kosher meals, a mashgiach, a guide, equipment hire. Seed six of them with `node --env-file=.env.test scripts/seed-services.js` (after `seed-reference.js` and `seed-catalogue.js`). They are sold inside packages, so there is no public checkout for one — the standalone booking endpoints exist for trade and staff.

### 6c.1 The catalogue

```
GET /api/services?locale=he
GET /api/services?category=SHABBAT_MEALS&isKosher=true
GET /api/services/mashgiach-on-site
```

Expect: `unitPrice` is the price of **one unit of the service's basis** for the calling viewer — a partner sees its own commission applied, an anonymous visitor the platform default, and `netCents` appears for nobody but staff and the service's own supplier. The filter is `isKosher`, not `kosher`; an unknown query key is stripped rather than refused, so a misspelt filter silently returns everything.

`basis` is the field most worth checking, because it decides what a package slot multiplies:

| basis | one unit is | `quantity` for a party of 4 over 3 days |
| --- | --- | --- |
| `PER_PERSON` | one traveller | 4 |
| `PER_GROUP` | the booking | 1 |
| `PER_DAY` | one day | 3 |
| `PER_PERSON_PER_DAY` | one traveller-day | 12 |

### 6c.2 Booking one directly

```
POST /api/service-bookings   { "serviceId": "...", "date": "2027-06-04", "days": 1, "quantity": 2, "pax": 2,
                               "lead": { "name": "...", "email": "..." } }
                              Idempotency-Key: any-string        → 201 SVC-000001
GET  /api/service-bookings/SVC-000001
GET  /api/service-bookings/SVC-000001/cancellation-quote
POST /api/service-bookings/SVC-000001/cancel
```

Things to try: book `mashgiach-on-site` for tomorrow → `409 TOO_SOON` (it wants a week); book with `quantity: 0` → `422 QUANTITY`; book a date two years out → `422 BEYOND_HORIZON`. A service whose `confirmationMode` is `ON_REQUEST` — the Shabbat meals, the mashgiach, the guide — is written `PENDING` with a `requestDeadlineAt`, and staff answer it from `/api/admin/services/bookings`.

### 6c.3 Admin

```
GET  /api/admin/services?status=DRAFT
POST /api/admin/services            { slug, name, category, basis, netCents, currency, cancellationPolicyId, ... }
POST /api/admin/services/:id/publish                  → 422 with details.missing until the checklist is clear
PUT  /api/admin/services/:id/translations/ka          { name, summary }
DELETE /api/admin/services/:id                        → 409 HAS_BOOKINGS or IN_PACKAGE
POST /api/admin/services/bookings/SVC-000001/confirm | /decline { reason } | /cancel
```

`DELETE` answers two different refusals and they need different fixes: `IN_PACKAGE` means a template still names the service and that slot must go first; `HAS_BOOKINGS` means the record has to survive for the voucher, so archive instead.

## Part 6d — Packages

A package is an **admin-defined template of typed slots** — a hotel stay, a transfer, a tour, a service — each constrained to what the admin allows. It has no price of its own. Seed three with `node --env-file=.env.test scripts/seed-packages.js`, last in the chain after reference, catalogue, transfers, tours and services.

The three are deliberately different shapes: `kakheti-wine-weekend` pins every slot; `tbilisi-shabbat` carries a kosher profile; `tbilisi-your-choice` leaves its hotel slot open so the resolver searches the destination.

### 6d.1 Browse and quote

```
GET /api/packages?kosher=true&locale=ru
GET /api/packages/kakheti-wine-weekend
GET /api/packages/kakheti-wine-weekend/quote?startDate=2027-06-03&adults=2
GET /api/packages/tbilisi-your-choice/quote?startDate=2027-06-03&adults=2&choices={"0":{"hotelId":"..."}}
```

`priceFrom` on a card is a **sample**, refreshed daily from a few dates ahead, and can never be booked. Only a quote's `token` becomes an order.

A quote answers `200` even when it cannot be sold, which is the point — a date picker needs a reason, not an exception:

```jsonc
{ "available": false,
  "unavailableReason": "COMPONENT_UNAVAILABLE",   // or ADJUSTMENT_BELOW_COST, KOSHER_INELIGIBLE
  "components": [{ "slotIndex": 2, "included": true, "resolved": null, "reason": "SOLD_OUT", … }] }
```

Things to try: quote a party larger than the package's `maxPax` → `422`; quote a start date outside `validFrom`/`validUntil` → `422 NOT_ON_SALE`; pass `exclude=4` to drop an optional slot and watch `adjustmentCents` change, because the discount is reallocated across the lines that remain. Every line's `lineTotalCents` must sum exactly to `totals.totalCents` — that is the largest-remainder allocation, and a penny out is a bug.

**The figure to check.** A slot's `sellCents` is what the buyer pays for that line, taxes included. It must equal what the order's confirmation compares against; a package containing a hotel with a tax row is the case that catches a mismatch, and it once did.

### 6d.2 Kosher packages

`tbilisi-shabbat` has a profile, and the profile is the switch: a package without one is judged by no kosher rule at all.

```
GET /api/packages/tbilisi-shabbat/quote?startDate=<a Thursday>&adults=2   → available, no blockers
GET /api/packages/tbilisi-shabbat/quote?startDate=<a Friday>&adults=2     → 200, available: false
```

The Friday start pushes the optional city tour onto Saturday, and the profile forbids it: `unavailableReason: KOSHER_INELIGIBLE` with a blocker `TOUR_ON_REST_DAY` naming the date. Shabbat is computed from the hotel's own coordinates by sunset, so the window moves through the year — that is the point of `SOLAR` over fixed hours.

Also worth trying: a transfer timed inside the window → `TRANSFER_IN_SHABBAT`; a hotel whose certificate lapses mid-stay → a blocker while `requireCertValidThroughStay` is on and a warning when it is off. Warnings never block and are frozen onto the order, so nobody can later say they were not told.

### 6d.3 Admin

```
GET  /api/admin/packages?status=DRAFT
POST /api/admin/packages          { slug, name, destinationId, nights, components: [ … ] }
GET  /api/admin/packages/:id/preview-quote?startDate=…&adults=2     ← the real engine, on a DRAFT, with net beside sell
PUT  /api/admin/packages/:id/kosher      { minServiceLevel, shabbatMode, … }
PUT  /api/admin/packages/:id/kosher/override   { until, reason }
POST /api/admin/packages/:id/publish
```

Components are written **whole**: sending `components` replaces the set and re-validates it, because a slot is only correct relative to its neighbours. A bad one answers `422 { problems: [{ slotIndex, code, message }] }` — `OUTSIDE_PACKAGE` for a day beyond the package length, `ENDPOINTS` for a transfer missing an end, `CURRENCY` for a product priced in another. The preview quote is the screen that matters: it runs the live engine on a draft, so a template that cannot sell is found before a partner finds it.

## Part 6e — Orders

An order is a package booked as one thing. One transaction writes a hotel booking, a transfer booking, a tour booking and a service booking, and one item per slot points at **exactly one** of them, enforced by a database CHECK. Either every part is written or none is.

### 6e.1 Hold, confirm, replay

```
POST /api/orders/holds     { "packageToken": "<from the quote>" }   → 201 { holdTokens: { "0": "...", "2": "..." }, expiresAt }
POST /api/orders           { "packageToken": "...", "holdTokens": { … }, "leadGuest": { … }, "travellers": [ … ] }
                            Idempotency-Key: any-string              → 201 ORD-000001
POST /api/orders  (same body + same key)                             → 200, same reference
```

Only hotel and tour slots hold anything — transfers and services have no inventory to reserve — so `holdTokens` is keyed by slot index and is usually shorter than the package. Confirming without holds is allowed: the orchestrator claims inside its own transaction.

The refusals are the interesting part, and each names every slot involved rather than the first:

```jsonc
409 { "reason": "PRICE_CHANGED", "quotedCents": …, "currentCents": …,
      "components": [{ "slotIndex": 0, "label": "…", "quotedCents": …, "currentCents": … }] }
409 { "reason": "UNAVAILABLE", "slots": [{ "slotIndex": 2, "label": "…", "reason": "SOLD_OUT" }] }
409 { "reason": "KOSHER_INELIGIBLE" | "PACKAGE_CHANGED" | "NOT_ON_SALE" }
```

**Atomicity is the thing to attack.** Set a tour's departure to zero seats between the quote and the confirm, then confirm: expect `409`, and expect `orders`, `order_items`, `hotel_bookings`, `booking_holds` and `outbox_events` to be exactly as they were, with the room counters untouched. Twenty concurrent confirmations with one idempotency key must produce one order.

### 6e.2 Reading and cancelling

```
GET  /api/orders/ORD-000001?email=<lead email>
GET  /api/orders/ORD-000001/cancellation-quote?email=…
POST /api/orders/ORD-000001/items/4/cancel   { "reason": "…" }      ← one optional part
POST /api/orders/ORD-000001/cancel           { "reason": "…" }      ← the whole trip
GET  /api/partner/orders?status=CONFIRMED
```

Each item carries its **child booking's own reference**: a traveller at the hotel desk quotes `BKG-…`, not `ORD-…`. Those children are readable on their own registers but **cannot be cancelled there** — try `POST /api/bookings/BKG-…/cancel` on one and expect `409 PART_OF_ORDER` carrying the order reference. The order is the only door, because it is the only thing that can roll the status up.

Cancelling one part refunds `max(0, sellCents − childCharge + adjustmentCents)`: the child's own frozen terms on its standalone price, less its share of the package discount, which is forfeited and reported as `clawbackCents`. A **required** part answers `409 REQUIRED_COMPONENT` for a partner and succeeds for staff — a package without its hotel is not a package, and keeping the discounted transfer is the arbitrage the allocation exists to prevent.

### 6e.3 On request

A package with an `ON_REQUEST` tour or service — `tbilisi-shabbat` has two — confirms as `PENDING_CONFIRMATION`: the child is `PENDING` with its seats already claimed, the item `REQUESTED`, and `requestDeadlineAt` is the earliest deadline across them (48 h).

```
GET  /api/admin/orders?status=PENDING_CONFIRMATION        ← the queue, earliest deadline first
POST /api/admin/orders/ORD-000001/items/2/confirm         → the item confirms; the order waits for the rest
POST /api/admin/orders/ORD-000001/items/2/decline  { "reason": "No caterer that night" }
```

Two decline outcomes, and they are genuinely different. Declining an **optional** part drops it, shrinks `totalCents`, and leaves the order `CONFIRMED` — a supplier saying no is not the buyer cancelling. Declining a **required** part cancels the whole order at **no charge**, because the failure is supplier-side. Confirming a part that is not on request is a `409`. The buyer may cancel a pending order at zero charge, and exactly one voucher goes out, on the transition into `CONFIRMED`.

## Part 7 — Partner portal

All under `/api/partner`, all requiring a session.

### `GET /api/partner/me`

**Readable in every status** — including `PENDING_APPROVAL`, `REJECTED` and
`SUSPENDED`. This is what the portal renders its "application under review",
"declined" and "suspended" pages from.

**Expected — 200**, the full partner detail with `status`.
Account not attached to a partner (i.e. an admin) → **`403`**.

**This is the one endpoint an unapproved partner can reach.** Everything else
behind the approval gate is `403`. Test that boundary explicitly.

### `PATCH /api/partner/account`

```json
{ "firstName": "Nino", "lastName": "Beridze", "position": "Reservations Manager", "phone": "+995555123456" }
```

**Expected — 200**, the updated user.

Allowed in **every** partner status and to **every** partner role — correcting
the spelling of your own name is not a privileged act, and someone whose
application is still under review should be able to fix a typo in it.

An empty body `{}` returns the unchanged user with `200`.

### `PATCH /api/partner/profile`

Company details. Requires `PARTNER_OWNER` or `PARTNER_ADMIN` **and** approved
status.

**Expected — 200**, the updated partner.

| Scenario | Expected |
| --- | --- |
| `PARTNER_AGENT` or `PARTNER_FINANCE` | `403` |
| Unapproved partner | `403` |
| Sending `status`, `reference` or `commissionRateBps` | `400` — the schema is an allow-list, so these never reach the update at all |

> **Worth an explicit test:** a partner must not be able to approve itself,
> rename its Partner ID, or award itself a better commission rate. Try all
> three.

### `GET` / `PUT /api/partner/financial`

Bank details. Requires `PARTNER_OWNER` or `PARTNER_FINANCE`, **and** approved
status — gated identically on read and write.

```json
{ "iban": "GE29NB0000000101904917", "swift": "BAGAGE22",
  "bankName": "Bank of Georgia", "accountHolder": "Alpine Tours LLC" }
```

**Expected — 200** — `{ iban, swift, bankName, accountHolder, updatedAt }`

| Scenario | Expected |
| --- | --- |
| `PARTNER_ADMIN` or `PARTNER_AGENT` | `403` — same company, no business seeing the bank details |
| No details on file yet (GET) | `404` — *"No bank details on file"* |
| Unapproved or suspended | `403` |

### Supplier extranet — `/api/partner/hotels`

Guarded by `authenticate + requireApprovedPartner`, scoped to the caller's own
properties.

| Method | Path | Role required |
| --- | --- | --- |
| `GET` | `/api/partner/hotels` | any partner role |
| `GET` | `/api/partner/hotels/:hotelId` | any |
| `GET` | `/api/partner/hotels/:hotelId/room-types` | any |
| `GET` | `.../room-types/:id/inventory/calendar?from&to` | any |
| `PUT` | `.../room-types/:id/inventory` | **`PARTNER_OWNER` / `PARTNER_ADMIN` only** |
| `PUT` | `.../rate-plans/:id/rates` | **`PARTNER_OWNER` / `PARTNER_ADMIN` only** |
| `GET` | `/api/partner/hotels/:hotelId/bookings` | any |

**The two isolation tests that matter:**

1. Sign in as supplier A, request supplier B's `hotelId`. Expect **`404`, not
   `403`** — telling you it exists but is not yours would confirm it exists.
2. Sign in as a `PARTNER_AGENT` and attempt either `PUT`. Expect **`403`**.

### Registration (public)

| Endpoint | Expected |
| --- | --- |
| `GET /api/invitations/:token` | `200` — a preview: company name, contact email, expiry. `410`/`404` if used or expired. `429` after 30 lookups in 15 minutes |
| `POST /api/invitations/:token/accept` | `201` — `{ "reference": "P-000042", "status": "PENDING_APPROVAL", "companyName": "Alpine Tours LLC" }` |

The accept body is `{ company, contact, financial, password }`. Holding the
token is the entire proof, which is why it is 256 bits of randomness,
single-use, time-limited and bound to one email address.

| Scenario | Expected |
| --- | --- |
| Weak password, or one containing the applicant's own name/email/company | `400` |
| Token reused | `410`/`404` — single use |
| 6th claim from one IP in an hour | `429` |

Note the new partner lands in `PENDING_APPROVAL`. They can sign in and read
`/api/partner/me`, and nothing else.

---

### Team — `/api/partner/team`

Owners and partner admins only (`partner.team.manage`); an agent or a finance
user gets **`403`**, as does platform staff. Approved partners only. Every id
is looked up inside the caller's company, so another company's member is
**`404`** on every verb — test that with a user from a second partner.

| Method | Path | Expected |
| --- | --- | --- |
| `GET` | `/api/partner/team?role&status&q&page&pageSize` | `200`, paginated; `status` ∈ `INVITED` `ACTIVE` `DEACTIVATED` |
| `POST` | `/api/partner/team` | `201` — `{ user, link: { kind, url, expiresAt }, email, emailSent }`; `role` ∈ `PARTNER_ADMIN` `PARTNER_AGENT` `PARTNER_FINANCE`. A partner admin inviting a `PARTNER_ADMIN` → `403` `ROLE_ABOVE_CEILING`; a taken email → `409`; a full team → `409` `TEAM_FULL` |
| `GET` | `/api/partner/team/:id` | `200` |
| `PATCH` | `/api/partner/team/:id/role` | `200`; the member's sessions end. Your own id → `400` `SELF` |
| `PATCH` | `/api/partner/team/:id/primary-contact` | `200`; exactly one primary contact remains. An invited member → `409` `NOT_ACTIVE` |
| `POST` | `/api/partner/team/:id/deactivate` · `/reactivate` · `/sessions/revoke` · `/activation/resend` | `200` |
| `DELETE` | `/api/partner/team/:id` | `204` with `{ "confirm": "<their email>" }`; an active member → `409` `STILL_ACTIVE` |

## Part 8 — Admin

Everything under `/api/admin/*` is guarded on the **router**, not route by
route — `requireAdmin` on the older routers, a named capability on the newer
ones (`/admin/users` needs `users.staff.manage`, `/admin/audit` needs
`audit.read`). So the first test for every single admin endpoint is the same:

| Caller | Expected |
| --- | --- |
| Anonymous | `401` |
| Any partner role, or a driver | `403` |
| `ADMIN` / `SUPER_ADMIN` | `200`/`201` |
| `MANAGEMENT` / `TOUR_OPERATOR` / `ACCOUNTANT` / `DISPATCHER` | depends on the area — see the role table in `server/API.md` ("Users, roles and capabilities") |

Worth doing once as a sweep across the whole surface, rather than per endpoint.
The server's own `test/rbac.matrix.test.js` does exactly that for every route
and every role, against `test/fixtures/rbac-matrix.json`.

### Partners

| Method | Path | Expected |
| --- | --- | --- |
| `GET` | `/api/admin/partners` | `200`, paginated |
| `POST` | `/api/admin/partners` | `201` — `{ partner, link: { kind, url, expiresAt }, emailSent }` |
| `GET` | `/api/admin/partners/:id` | `200` |
| `PATCH` | `/api/admin/partners/:id` | `200` |
| `DELETE` | `/api/admin/partners/:id` | `204`/`200` |
| `POST` | `/api/admin/partners/:id/approve` · `/reject` · `/suspend` · `/reactivate` | `200`, status changed |
| `GET` / `PUT` | `/api/admin/partners/:id/financial` | `200` |
| `GET` / `POST` | `/api/admin/partners/:id/invitations` | `200` / `201` |
| `GET` | `/api/admin/partners/:id/audit` | `200` — who changed what, when |

`POST /api/admin/partners` takes a `mode`:

| `mode` | What happens |
| --- | --- |
| `invite` | Drafts the company, emails a registration link, waits for the rest |
| `activate` | Creates the account now, emails a password-creation link |
| `approve` | Creates the account, emails a password link, and approves at once |

`approve` requires **complete** company details — approving a record still
missing its registration number would put a half-empty partner into the live
platform. Try it with a partial `company` and expect `400`.

**The link is in the response as well as in the email**, so a mail server being
down does not leave an admin with a partner they cannot onboard. `emailSent`
tells the panel whether to show the link or just confirm. This is how you get an
activation URL locally without an inbox.

> `POST /:id/invitations` is the exception that does **not** send quietly: the
> admin pressed a button whose entire purpose is "send them a link", so a
> failure comes back as `emailSent: false` rather than a cheerful lie.

### Hotels

| Method | Path |
| --- | --- |
| `GET` / `POST` | `/api/admin/hotels` |
| `GET` / `PATCH` | `/api/admin/hotels/:id` |
| `POST` | `/api/admin/hotels/:id/publish` · `/unpublish` · `/archive` |
| `PUT` | `/api/admin/hotels/:id/amenities` — `{ "amenities": [{ "amenityId", "note?" }] }` |
| `POST`/`PATCH`/`DELETE` | `/api/admin/hotels/:id/images` · `/images/:imageId` |
| `PUT` | `/api/admin/hotels/:id/images/order` — `{ "order": ["imageId", ...] }` |
| `PUT` | `/api/admin/hotels/:id/translations/:locale` |

Create takes **only** `slug`, `name`, `propertyType`, `destinationId`,
`starRating`, and optionally `supplierId`, `countryCode`, `timezone`,
`currency`. Everything else is a `PATCH`. Sending a field that belongs to PATCH
is a `400`.

**Every read of `:id` and every mutation returns the hotel plus a
`publishChecklist`:**

```json
{
  "id": "clx...", "slug": "gudauri-alpine-hotel", "status": "DRAFT",
  "publishChecklist": [
    { "code": "NO_IMAGES", "message": "Add at least one image" },
    { "code": "NO_RATE_PLAN", "message": "Add a rate plan" }
  ]
}
```

`POST /publish` answers **`422`** with `details.missing` when the checklist is
not empty:

```json
{ "error": { "message": "This hotel is not ready to publish",
             "details": { "missing": [{ "code": "NO_IMAGES", "message": "Add at least one image" }] } } }
```

There is **no `DELETE`** for a hotel — only `archive`. A property that has ever
been booked has to stay readable.

Duplicate `slug` → `409`.

### Rooms, rates and inventory

| Method | Path |
| --- | --- |
| `GET` / `POST` | `/api/admin/hotels/:hotelId/room-types` |
| `GET` / `PATCH` | `.../room-types/:roomTypeId` |
| `POST` | `.../room-types/:roomTypeId/archive` |
| `PUT` | `.../room-types/:id/beds` — `{ "beds": [{ "bedTypeCode", "quantity", "groupIndex" }] }` |
| `PUT` | `.../room-types/:id/amenities` |
| `GET` / `POST` | `.../room-types/:id/rate-plans` |
| `GET` / `PATCH` | `.../rate-plans/:ratePlanId` |
| `POST` | `.../rate-plans/:id/archive` |
| `POST`/`PUT`/`DELETE` | `.../rate-plans/:id/restrictions[/:restrictionId]` |
| **`PUT`** | `.../room-types/:id/inventory` — the bulk editor |
| **`GET`** | `.../room-types/:id/inventory/calendar?from&to` |
| **`PUT`** | `.../rate-plans/:id/rates` — the bulk editor |
| `GET` / `PUT` | `/api/admin/hotels/:id/child-policy` |
| `GET`/`POST`/`PUT` | `/api/admin/hotels/:id/policies/cancellation[/:policyId]` |
| `GET`/`POST`/`PUT` | `/api/admin/hotels/:id/policies/payment[/:policyId]` |
| `GET` / `PUT` | `/api/admin/hotels/:id/meal-plans` |
| `GET`/`POST`/`PUT`/`DELETE` | `/api/admin/hotels/:id/tax-fees[/:taxFeeId]` |

**Bulk inventory body:**

```json
{
  "from": "2027-12-01", "to": "2027-12-31",
  "weekdays": [1, 2, 3, 4],
  "totalUnits": 5, "stopSell": false, "minStay": 2,
  "closedToArrival": false, "closedToDeparture": false
}
```

**Bulk rates body:**

```json
{
  "from": "2027-12-01", "to": "2027-12-31", "weekdays": [5, 6, 7],
  "netCents": 12500, "sellCents": null,
  "extraAdultCents": 3000, "extraChildCents": null, "singleOccupancyCents": null,
  "closed": false
}
```

`weekdays` is ISO — **1 = Monday**. Omit it to hit every day.

**Expected — 200** — `{ "nights": 20, "days": 31 }`

**Anything you omit keeps its existing value.** This is a partial write, not a
replace. Verify it: set `minStay: 2` on a range, then send a second request
setting only `totalUnits`, and confirm `minStay` is still `2`.

| Scenario | Expected |
| --- | --- |
| Reducing units below what is already sold | **`409`** with `details.conflicts: [{ "date": "2027-12-05", "committed": 3 }]` |
| Range longer than 730 days | `400` (`HOTEL_MAX_BULK_DAYS`) |
| `to` before `from` | `400` |

**Calendar response — 200:**

```json
{
  "roomType": { "id": "clx...", "name": "Deluxe Double", "code": "DBL" },
  "nights": [{
    "date": "2027-12-01",
    "totalUnits": 5, "blockedUnits": 0, "bookedUnits": 1, "heldUnits": 0,
    "availableUnits": 4,
    "stopSell": false, "minStay": null,
    "closedToArrival": false, "closedToDeparture": false,
    "rates": [{ "ratePlanId": "clx...", "ratePlanName": "Breakfast, flexible",
                "netCents": 12500, "sellCents": null, "closed": false }]
  }]
}
```

`availableUnits` is **derived** — `total − blocked − booked − held` — never
stored. If it ever disagrees with that arithmetic, that is a bug.

### Transfer admin

| Method | Path |
| --- | --- |
| `GET`/`POST` | `/api/admin/transfers/points` · `GET`/`PATCH`/`DELETE` `/points/:id` |
| `PUT` | `/api/admin/transfers/points/:id/translations/:locale` |
| `GET`/`POST` | `/api/admin/transfers/vehicles` · `GET`/`PATCH` `/vehicles/:id` · `POST` `/vehicles/:id/archive` |
| `PUT` | `/api/admin/transfers/vehicles/:id/translations/:locale` |
| `GET`/`POST` | `/api/admin/transfers/routes` · `GET`/`PATCH` `/routes/:id` |
| **`PUT`** | `/api/admin/transfers/routes/prices` — the bulk repricer |
| `PUT` | `/api/admin/transfers/routes/:id/prices` · `/stops` · `/translations/:locale` |
| `POST` | `/api/admin/transfers/routes/:id/publish` · `/unpublish` · `/archive` |
| `GET`/`POST`/`PUT`/`DELETE` | `/api/admin/transfers/extras[/:code]` |
| `GET`/`POST`/`DELETE` | `/api/admin/transfers/blackouts[/:id]` |
| `GET` | `/api/admin/transfers/bookings` · `/:reference` · `POST /:reference/cancel` |
| `GET` | `/api/admin/transfers/bookings/summary` — `total`, `confirmed`, `confirmedValue.byCurrency`; aggregated, operations roles |

**`DELETE /points/:id` retires rather than deletes.** Routes and bookings
reference the row with `Restrict`, and a place that has ever been travelled to
has to stay readable. Expect the point to disappear from the public picker but
still resolve inside existing bookings.

**Route price grid** — a whole-grid `PUT`, so a half-applied grid is impossible:

```json
{ "prices": [{ "vehicleId": "clx...", "oneWayCents": 17500, "returnCents": null, "netCents": null }] }
```

**Bulk repricing:**

```json
{ "tier": "TIER_1", "vehicleIds": ["clx..."], "perKmCents": 150, "overwrite": false }
```

**Expected — 200** — `{ "routes": 42, "written": 120, "kept": 18 }`

| Scenario | Expected |
| --- | --- |
| Both `perKmCents` and `flatCents` | `400` — one or the other, never both |
| **No filter at all** | `400` — a filter (`tier`, `category` or `routeIds`) is **required**. There is deliberately no way to reprice the whole catalogue in one call |
| `overwrite` omitted | Defaults to `false` — fills gaps, leaves every figure someone has already set |
| `POST /routes/:id/publish` with no price at all | `422` with `details.missing` — publishing would silently fall through to the distance estimate |
| Publish with missing copy only | `200` — missing translations are listed in the checklist but do not block |

**Blackouts are how you test `closed: true`.** Create one over a route, then
quote it and expect `200` with `"closed": true` and no offers.

### Everything else

| Method | Path | Notes |
| --- | --- | --- |
| `GET`/`POST` | `/api/admin/destinations`, `GET /api/admin/destinations/tree` | |
| `GET`/`PATCH`/`DELETE` | `/api/admin/destinations/:id` | |
| `PUT` | `/api/admin/destinations/:id/translations/:locale` | |
| `GET`/`POST` | `/api/admin/amenities`, `GET`/`PATCH` `/api/admin/amenities/:id` | `POST` → `201` |
| `GET`/`POST` | `/api/admin/media` | multipart: `file`, `category`, `altText?` |
| `GET`/`DELETE` | `/api/admin/media/:id` | |
| `GET` | `/api/admin/media/:id/url` | signed link, **private categories only** |
| `GET` | `/api/admin/bookings`, `/api/admin/bookings/:reference` | every booking on the platform |
| `GET` | `/api/admin/bookings/summary?days=30` | `activeCount` + what was created in the window, by currency; `days` 1–365 |
| `GET` | `/api/admin/badges` | the sidebar's five queue counts; a DISPATCHER gets `unassignedLegs` and `null` for the rest |
| `POST` | `/api/admin/bookings/:reference/cancel` | |
| `GET`/`POST` | `/api/admin/pricing-rules` | |
| `GET` | `/api/admin/pricing-rules/explain?partnerId&hotelId` | which rule wins, and why |
| `PUT`/`DELETE` | `/api/admin/pricing-rules/:id` | |

**Media visibility is decided by the category, not by the caller:**

| Public — served directly | Private — no URL in the response |
| --- | --- |
| `HOTEL_IMAGE`, `ROOM_IMAGE`, `AMENITY_ICON` | `CONTRACT`, `RATE_SHEET`, `INVOICE`, `VOUCHER`, `IMPORT`, `OTHER` |

A private file has **no `url` field at all**. Fetch `GET /:id/url` for a
60-second signed link. If a `CONTRACT` ever comes back with a plain URL, that is
a security bug.

Upload limits: 10 MB for images, 25 MB for documents. Over the limit → **`413`**
— *"That file is too large"*, not a `500`. Two files at once → `400`. Wrong
field name → `400`.

---

### Staff accounts — `/api/admin/users`

**`SUPER_ADMIN` only.** An `ADMIN` gets `403` with
`details.reason = "INSUFFICIENT_CAPABILITY"` and `details.required =
["users.staff.manage"]` — the first thing to test.

| Method | Path | Expected |
| --- | --- | --- |
| `GET` | `/api/admin/users?role&status&q&page&pageSize` | `200`, paginated; staff only — no drivers, no partner users |
| `POST` | `/api/admin/users` | `201` — `{ user, link, email, emailSent }`; `role` ∈ `ADMIN` `MANAGEMENT` `TOUR_OPERATOR` `ACCOUNTANT` `DISPATCHER` (`SUPER_ADMIN` → `400`). Taken email → `409` |
| `GET` | `/api/admin/users/:id` | `200`; `status` derived (`INVITED` / `ACTIVE` / `DEACTIVATED`) |
| `PATCH` | `/api/admin/users/:id/role` | `200`; the account's sessions end — its old cookie now gets `401` on `/api/auth/me` |
| `POST` | `/api/admin/users/:id/deactivate` | `200`; sign-in now `401`. An invitation → `409` `NOT_ACTIVATED` |
| `POST` | `/api/admin/users/:id/reactivate` · `/sessions/revoke` · `/activation/resend` | `200` |
| `DELETE` | `/api/admin/users/:id` | `204` with `{ "confirm": "<their email>" }`; wrong address → `400` `CONFIRM_MISMATCH`; active account → `409` `STILL_ACTIVE` |

The activation link in the `POST` response opens the same `/activate/:token`
flow as a partner's: `POST /api/auth/activation/:token` with a password, then
sign in and check `user.role` and `user.capabilities`.

### Audit log — `/api/admin/audit`

`audit.read`: `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `ACCOUNTANT`. A `DISPATCHER`
and every partner role → `403`.

| Query | Expected |
| --- | --- |
| `?entityType=Partner&entityId=<id>` | `200`, newest first, every entry for that partner |
| `?action=PARTNER_APPROVED&actorUserId=<admin id>` | `200`, only that action by that admin |
| `?action=NOT_A_THING` | `400` |
| `?from=<ISO>&to=<ISO>` with `from` after `to` | `400` |

Sign in and out first: `USER_LOGIN_SUCCEEDED` and `USER_LOGGED_OUT` rows
appear against the account.

## Part 8b — Finance

What we owe suppliers (**payables**), what buyers owe us (**receivables**),
and the **payments** that settle them. All under `/api/admin/finance`. Full
contract in `server/API.md` → "Finance".

**Who:** reads — `SUPER_ADMIN`, `ADMIN`, `MANAGEMENT`, `ACCOUNTANT`. Changes
(payments, adjustments, terms) — `SUPER_ADMIN`, `ADMIN`, `ACCOUNTANT`. A
`MANAGEMENT` user gets `403` on every POST/PUT/PATCH here; `TOUR_OPERATOR`,
`DISPATCHER` and every partner role get `403` on all of it.

### The records appear on their own

Book something and check, don't create finance rows by hand:

| Do this | Expect |
| --- | --- |
| Confirm a hotel, transfer, tour or service booking | `GET /payables?q=<reference>` shows one payable for its net; a standalone booking also has a receivable (`GET /receivables?q=<reference>`) for its price |
| Book an on-request tour, before the operator answers | No payable, no receivable |
| The operator confirms it | Both appear |
| Book a package (order) | A payable for each part; **one** receivable for the order, once every request in it is answered |
| Cancel inside a free window | Receivable `VOID`; payable `VOID` |
| Cancel with a 50% charge | Receivable = the charge; payable per the supplier's terms: same share of the net by default |

### Payments

| Request | Expected |
| --- | --- |
| `POST /payments` IN, allocations to two receivables, `Idempotency-Key` header | `201`; both receivables move to `PAID` / `PARTIAL` |
| The same request again, same key | `200`, `replayed: true`, nothing paid twice |
| Same key, different amount | `409` `IDEMPOTENCY_KEY_REUSED` |
| An allocation larger than what is outstanding | `422` `ALLOCATION_EXCEEDS_OUTSTANDING` |
| A USD payment against a GEL receivable | `422` `CURRENCY_MISMATCH` |
| An OUT payment allocated to a receivable | `422` `WRONG_TARGET` |
| A refund without `reason` | `400` |
| `allocate: { mode: "OLDEST_DUE", partnerId }` | `201`; the partner's earliest-due items are settled first, any rest is `unallocatedCents` |
| `POST /payables/:id/instalments/1/pay` | `201`; the instalment `PAID`, the payable `PARTIAL`, `nextDueAt` moves to the balance |

### Finance's own hand

| Request | Expected |
| --- | --- |
| `PATCH /payables/:id` `{ amountOverrideCents }` without `reason` | `400` |
| …above the booked net | `422` `ABOVE_ORIGINAL` |
| …with a reason | `200`; `amountOverrideCents` set, `needsReview` cleared |
| `PATCH /payables/:id` `{ waive: true, reason }` | `200`, `WAIVED` |
| `PATCH /receivables/:id` `{ dueAt, reason }` | `200`; the audit log has `RECEIVABLE_DUE_DATE_CHANGED` |

### Terms

| Request | Expected |
| --- | --- |
| `PUT /terms/hotels/:id` with a deposit and no balance | `400` |
| …with `[{ kind: "BALANCE", anchor: "ARRIVAL", offsetDays: -7 }]` and `cancellationLiability: "MANUAL"` | `200` |
| `GET /terms/boats/:id` | `404` |
| `PATCH /partners/:id/terms` `{ paymentDueDays: 30 }` | `200`; the next booking that partner confirms is due 30 days later |

### Reports

`GET /reports/summary`, `/reports/margin?groupBy=product`, `/reports/ageing?side=payables`
— `200`, one row per **currency**, never a total across currencies.
`?format=csv` — `200` `text/csv` with a header row; `403` without
`finance.export`; the audit log gains `FINANCE_REPORT_EXPORTED`.

### A partner's own view

`GET /api/partner/finance/statement` as an owner or finance user — `200`, only
that company's receivables, with `balances` per currency and no `debtor`,
`notes` or net. As an agent — `403`. A second partner never sees the first
one's rows. `GET /api/partner/finance/payables` as a supplier — its own net
and schedule, nothing of ours.

## Part 8c — Invoicing

The documents behind a receivable — a **proforma** at confirmation, the
**VAT invoice** when it is paid in full, a **correction** when a VAT-invoiced
booking is cancelled with a charge — numbered, printed and emailed by
InvoiceOcean. Staff routes under `/api/admin/invoices`, the hand-issue route
on the receivable, a partner's own view under `/api/partner/finance/invoices`,
and one public webhook. Full contract in `server/API.md` → "Finance" →
"Invoices".

**Who:** reads (list, detail, PDF, settings, sync events) — `SUPER_ADMIN`,
`ADMIN`, `MANAGEMENT`, `ACCOUNTANT`. Writes (issue by hand, send, cancel,
retry) — `SUPER_ADMIN` and `ACCOUNTANT` only: an `ADMIN` or `MANAGEMENT`
user gets `403` on every POST here, and so does `FINANCE_OPERATOR`, which as
seeded holds neither `invoices.read` nor `invoices.write`. `TOUR_OPERATOR`,
`DISPATCHER`, `DRIVER` and every partner role get `403` on all of
`/api/admin/invoices`. A partner's `PARTNER_OWNER`, `PARTNER_ADMIN` and
`PARTNER_FINANCE` read their own company's documents; `PARTNER_AGENT` gets
`403`; an unapproved company gets `403`. The demo accounts from
`scripts/seed-b2b-demo.js` cover every one of these
(`finance@…` is the accountant, `reservations@…` the tour operator,
`agency.owner@…` the agency).

**The switch.** Everything is behind `INVOICEOCEAN_ENABLED`. With it off the
server still lists what was issued before, and every write answers
`422 { reason: "INVOICING_DISABLED" }` — checked *before* the id is looked
up, so `POST /api/admin/invoices/no-such-id/retry` is `422` while off and
`404` once on. Test both states; the Postman folder *06q · Admin · Invoices*
reads `GET /settings` first and expects accordingly.

### With the flag off

Sign in as the accountant. `<api>` is your base URL; the session is the
`iag_session` cookie, so pass the cookie jar to every call:

```bash
curl -s -c jar.txt -X POST <api>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<accountant email>","password":"<password>"}'
```

| Request | Expected |
| --- | --- |
| `GET /api/admin/invoices/settings` | `200` `{ enabled: false, provider: "INVOICEOCEAN", languages: [...], defaultLang: "en", defaultTaxBps: 1800, autoSend: false }` — and no token anywhere in it |
| `GET /api/admin/invoices` | `200`, `data` newest first (empty on a fresh database), `total`, `totalPages` |
| `GET /api/admin/invoices?status=BOGUS` | `400` |
| `GET /api/admin/invoices?status=ISSUED&status=PAID&debtorPartnerId=GUEST&from=2026-01-01` | `200`; `status` repeats, `GUEST` means documents addressed to guests, `from`/`to` are issue dates |
| `GET /api/admin/invoices/sync-events` | `200`, `data` (empty until the provider has reported something unknown) |
| `POST /api/admin/finance/receivables/<open receivable id>/invoices` `{ "kind": "PROFORMA" }` | `422` `INVOICING_DISABLED` |
| `POST /api/admin/invoices/<any id>/send`, `/cancel`, `/retry` | `422` `INVOICING_DISABLED`, even for an id that does not exist |
| `GET /api/admin/invoices/<id>/pdf` of a `DRAFT` or `ERROR` document | `409` `NOT_ISSUED` — there is nothing at the provider to stream |
| The same as `MANAGEMENT` | reads `200`, every POST `403` naming `invoices.write` |
| The same as `TOUR_OPERATOR` or a partner | `403` on all of it |
| `POST /api/integrations/invoiceocean/webhook` with `{ "api_token": "wrong", "invoice": { "id": 1 } }` | `401` — no session needed, and an unset secret matches nothing |

### With the flag on

Needs an InvoiceOcean account with its company details filled in, the API
token and the webhook secret in the environment (`docs/DEPLOYMENT.md`
§3.4b), and — for the webhook round trip — an API host InvoiceOcean can
reach. Confirm a booking for the demo agency (Part 8b shows how), find its
receivable, and watch:

```bash
curl -s -b jar.txt '<api>/api/admin/invoices?receivableId=<receivable id>'
```

| Do this | Expect |
| --- | --- |
| Confirm a booking | Within a few seconds a `PROFORMA` row appears for its receivable, first `DRAFT`, then `ISSUED` with `number` (e.g. `P1`), `externalId` and `hasPdf: true`. The finance bell gets `FINANCE_INVOICE_ISSUED`; so does the agency's |
| …while the InvoiceOcean account's seller details are blank | `ERROR` instead, `syncError` holding the provider's own words (`seller_name: can't be blank`); the finance bell gets `FINANCE_INVOICE_SYNC_FAILED` and `FINANCE_OPS_EMAIL` an email. Nothing is retried automatically — the provider would only repeat itself |
| Fill the company details in InvoiceOcean, then `POST /api/admin/invoices/<id>/retry` | `202` `{ invoice, queued: true }`; the row goes `DRAFT` → `ISSUED` on the next drain |
| `POST …/retry` on it again | `409` `NOT_FAILED` |
| `POST /api/admin/invoices/<id>/send` `{ "to": "<an inbox you can read>" }` | `202`; the status becomes `SENT`; InvoiceOcean emails the PDF |
| `GET /api/admin/invoices/<id>/pdf` | `200`, `Content-Type: application/pdf`, `Content-Disposition: inline; filename="P1.pdf"`, `Cache-Control: private, no-store` |
| Record a payment for the whole receivable (Part 8b) | A `VAT` row appears, `fromInvoice` pointing at the proforma, `ISSUED` with its own number (e.g. `I1`) and `paidCents = totalCents`, status `PAID`; the proforma's `derived[]` lists it |
| Record a *partial* payment instead | No VAT invoice; the proforma becomes `PARTIAL` and the payment is posted to it at the provider (once — replaying the payment posts nothing twice) |
| `POST /api/admin/invoices/<VAT id>/cancel` | `409` `NOT_A_PROFORMA` |
| `POST /api/admin/invoices/<PAID proforma id>/cancel` | `409` `NOT_CANCELLABLE` |
| `POST /api/admin/invoices/<unpaid proforma id>/cancel` `{ "reason": "duplicate" }` | `200`, `CANCELLED` at once here and, through the outbox, at the provider. `POST …/receivables/<id>/invoices` `{ "kind": "PROFORMA" }` then issues a fresh one |
| `POST …/receivables/<id>/invoices` `{ "kind": "PROFORMA" }` while one is live | `409` `LIVE_INVOICE_EXISTS` with the existing `invoiceId` |
| …on a `VOID` or `WAIVED` receivable | `422` `NOTHING_OWED` |
| Cancel a VAT-invoiced booking with a 50% charge | A `CORRECTION` row from the VAT invoice, `correctionReason` naming the old and new amounts |
| Mark the proforma paid **in InvoiceOcean** (or wait: it marks it paid itself when the VAT invoice is paid) | Within a minute of the webhook (or 15 minutes of the poll) the local row's `status`/`paidCents` follow — and the receivable in `/api/admin/finance` does **not**: a status seen at the provider is a prompt for Finance, not a payment |
| As the agency owner: `GET /api/partner/finance/invoices` | `200`, only that company's issued documents, with `number`, `totalCents`, `hasPdf`, `lines`, and no `externalId`, `syncError` or `buyer` |
| As the agency owner: `GET /api/partner/finance/invoices/<id>/pdf` | `200` `application/pdf` for its own document; `404` for another company's, for a `DRAFT`, for an `ERROR` one, for an id that does not exist |
| As the agency agent: any of the above | `403` |
| `PATCH /api/admin/partners/<id>` `{ "taxId": "GE123456789", "invoiceLang": "ru" }` | `200`; both fields come back on the partner, and the next document issued to it prints that tax id in Russian. `"invoiceLang": "ka"` is `400` — InvoiceOcean has no Georgian or Hebrew |
| `PATCH /api/partner/profile` `{ "taxId": "GE123456789" }` as the owner | `200`; sending `invoiceLang` there is not an error but is dropped — the schema is an allow-list, so the language stays what Finance set |

Nothing in this part deletes anything: look for `CANCELLED` and `ERROR`
rows in the list, never for a row that vanished. A row that disappears is a
bug.

### The sandbox checklist

What was walked on 2026-10-14 against a test InvoiceOcean account, in the
order that works. Placeholders throughout; never paste a real token into a
ticket.

1. In the InvoiceOcean account, fill in the company details (seller name,
   tax id, address, bank) **first**. Until the seller name is set the API
   refuses every document with `seller_name: can't be blank`, and the
   platform records that as `ERROR` — which is itself a useful first test
   if you want to see the failure path, but do it on purpose.
2. Create the API token in the account (Settings → API), invent a webhook
   secret of 16+ characters, and start the API with
   `INVOICEOCEAN_ENABLED=true`, `INVOICEOCEAN_DOMAIN=<account>`,
   `INVOICEOCEAN_API_TOKEN=<token>`, `INVOICEOCEAN_WEBHOOK_SECRET=<secret>`.
   It refuses to boot when one of the first three is missing, or when the
   secret is shorter than 16 characters.
3. `GET /api/admin/invoices/settings` as the accountant → `enabled: true`.
4. Confirm a booking for the demo agency → a `PROFORMA` appears and reaches
   `ISSUED` with a number (`P1` on an empty account). If you skipped step 1
   it is `ERROR` with `seller_name: can't be blank`: fill the details, then
   `POST /api/admin/invoices/<id>/retry` → `202`, and it reaches `ISSUED`.
5. `POST /api/admin/invoices/<id>/send` → `202`, then `SENT`; the document
   lands in the buyer's inbox from InvoiceOcean, not from the platform.
6. Record an `IN` payment for the whole receivable → a `VAT` row from the
   proforma, `I1`, `PAID`.
7. InvoiceOcean marks the proforma paid on its side as well; a poll run
   (or its webhook) brings the local proforma to `PAID` within the apply
   interval. Nothing changes on the receivable.
8. `GET /api/admin/invoices/<id>/pdf` as the accountant and
   `GET /api/partner/finance/invoices/<id>/pdf` as the agency owner → both
   `200 application/pdf`.
9. The webhook round trip needs a host InvoiceOcean can reach (the
   deployed API, or a tunnel to your machine). Register
   `https://<api host>/api/integrations/invoiceocean/webhook` for
   `invoice:create` and `invoice:update` with the secret as its token
   (§3.4b), then:
   - `curl -X POST <api>/api/integrations/invoiceocean/webhook -H 'Content-Type: application/json' -d '{"api_token":"wrong-secret","invoice":{"id":1}}'` → `401`;
   - the same with the right secret and an id the platform does not have
     (`"id": 424242`) → `200 { received: true, duplicate: false }`, the
     same body again → `duplicate: true`, and about a minute later
     `GET /api/admin/invoices/sync-events` lists it with `error: "UNMATCHED"`;
   - mark a document paid in InvoiceOcean's own screen → the local row
     follows within the apply interval without any poll.
10. Switch the flag back off and confirm the list still shows everything
    and every write is `422 INVOICING_DISABLED` again.

## Part 9 — Kosher

Kosher support is three separate claims, trusted differently, and most of what is
worth testing is the boundary between them.

| The claim | Where it lives | Who backs it |
| --- | --- | --- |
| "There is a Shabbat elevator" | An ordinary amenity, in the `Shabbat` category | The property |
| "This property is fully kosher" | `kosher.serviceLevel` | Staff, as a declaration |
| "Kosher certified" | A verified, unexpired, property-scoped certificate | Us, having checked |

### 9.1 The one rule to try to break

**No request can mark a hotel kosher certified except the verify transition.**
`certified` is computed from certificates and today's date; there is no column
behind it. Things worth trying, all of which should fail:

```http
PATCH /api/admin/hotels/:id            { "certified": true }        → 400
PATCH /api/admin/hotels/:id            { "serviceLevel": "FULL" }   → 400
PUT   /api/admin/hotels/:id/kosher     { "serviceLevel": "FULL",
                                         "verification": "VERIFIED" } → 400
POST  …/kosher/certifications          { "authorityName": "Self",
                                         "verification": "VERIFIED" } → 400
```

And the thing that *should* succeed, and is the only one that does:

```http
POST /api/admin/hotels/:id/kosher/certifications/:certId/verify
{ "decision": "VERIFIED" }                                          → 200
```

Declaring `serviceLevel: "FULL"` must come back `certified: false`. So must a
property with every kosher facility ticked. Both are the feature working.

### 9.2 The switch

`PUT /api/admin/hotels/:id/kosher` creates the record, and **creating it is the
switch** — a hotel with no kosher row shows no kosher block anywhere and matches
no kosher filter. `GET` answers `200` with `null` for such a hotel, not `404`.

`DELETE` is a **409** while a live certificate exists: removing the record would
cascade its certification history away with it.

### 9.3 Expiry, which nothing has to run

Set a certificate's `expiresOn` to yesterday and verify it. Then read the hotel:

```jsonc
{ "certified": false, "certificationState": "EXPIRED" }
```

No job ran. Expiry is derived from the date on every read, which is why the
answer is right at 00:01 rather than after the next sweep. The nightly job
writes `KOSHER_CERTIFICATION_EXPIRING` audit rows and changes no state at all.

A certificate expiring **today** is still valid today — worth checking, because
getting it wrong costs a property a day of its badge.

### 9.4 Scope

A `RESTAURANT` or `PASSOVER` certificate is a real certificate and is shown as
one, but it does not certify the property: `certified` stays false and
`kosherCertified=true` does not return the hotel. Only `PROPERTY` and `KITCHEN`
do.

### 9.5 Filtering

```http
GET /api/search?checkIn=…&checkOut=…&adults=2&kosher=PARTIAL
GET /api/search?checkIn=…&checkOut=…&adults=2&kosherCertified=true
GET /api/search?checkIn=…&checkOut=…&adults=2&amenity=shabbatElevator
```

Two parameters, because the other eight things people filter on are *facilities*
and facilities are amenities. `kosher` is a **minimum** level; `NONE` is a `400`.
Amenity codes are **case-sensitive** — `shabbatElevator`, not `shabbatelevator`.

A search sending neither kosher parameter must be completely unaffected.

### 9.6 Booking requirements

A requirement is not the reservation. Asking for something the property does not
offer is a **422** naming it, and claims no inventory:

```jsonc
POST /api/bookings
{ "offerToken": "…", "leadGuest": {…}, "requests": [{ "code": "mikvehOnSite" }] }

→ 422 { "error": { "details": { "unsupported": ["mikvehOnSite"] } } }
```

A supported one is accepted, and the booking comes back **`CONFIRMED`** with
`requestsPending: 1`. That pairing is the design: the rooms were claimed and
priced, and a meal still being arranged does not put them back in doubt. Watch
`requestsPending` fall while `status` never moves.

`POST /api/admin/bookings/:reference/requests/:requestId` is admin-only — a
partner answering its own request is a `403`. Declining needs a `responseNote`.

On a `PATCH`, `requests` is the whole set: leaving one out withdraws it (it is
not deleted), and re-asking for something already declined cannot undo the
refusal.

### 9.7 Certificate files

Uploaded as `KOSHER_CERTIFICATE`: PDF or an image, stored **private**, no gallery
renditions, and no URL anywhere in a response. `documentAvailable` says one
exists; reaching the bytes is `GET /api/admin/media/:id/url`, which is authorized
and audited. Detaching a document a verified certificate points at is a `409`.

---

## Part 10 — A suggested test run

Roughly 45 minutes, covering the paths that carry money.

**Smoke (5 min)**
1. `GET /health` → `200`
2. `GET /health/db` → `200`
3. `GET /api/destinations` → `200`, non-empty
4. `GET /api/hotels` → `200`, non-empty

**Auth (10 min)**
5. Login with a wrong password → `401`
6. Login correctly → `200` + `HttpOnly` cookie
7. `GET /api/auth/me` → `200`
8. `GET /api/auth/me` with the cookie removed → `401`
9. `POST /api/auth/logout` → `204`; then `/me` → `401`
10. 11 failed logins in a row → `429` on the last

**Kosher (8 min)**
K1. `PATCH /api/admin/hotels/:id` with `{"certified": true}` → **400**
K2. `PUT /api/admin/hotels/:id/kosher` with `FULL` → `certified: false`
K3. Add a certificate → still `certified: false`
K4. Verify it → `certified: true`
K5. Edit its reference → back to `PENDING_VERIFICATION`, `certified: false`
K6. Set `expiresOn` to yesterday and re-verify → `certificationState: EXPIRED`
K7. `GET /api/search?…&kosherCertified=true` → that hotel is absent
K8. Book with `requests: [{"code": "mikvehOnSite"}]` → **422**, no hold taken

**Hotel booking (15 min)**
11. `GET /api/search` with valid dates → `200`, capture `cheapestOffer.token`
12. Confirm no `netCents` anywhere in the anonymous response
13. `POST /api/search/offers/quote` → `200`
14. `POST /api/bookings/holds` → `201`, capture the hold token
15. `POST /api/bookings` with an `Idempotency-Key` → `201`, capture the reference
16. **Repeat step 15 unchanged → `200`, same reference**
17. `GET /api/bookings/:reference?email=...` → `200`
18. Same with a wrong email → `404`
19. `GET .../cancellation-quote` → `200`
20. `PATCH` with `"totalCents": 1` → `400`
21. `POST .../cancel` → `200`, status `CANCELLED`
22. Cancel again → `409`

**Transfers (10 min)**
23. `GET /api/transfers/points?search=tbilisi` → `200`
24. `GET /api/transfers/quotes` for a valid journey → `200` with offers
25. Same journey, pick-up in one hour → `422` `TOO_SOON`
26. Same point for `from` and `to` → `409` `SAME_POINT`
27. `POST /api/transfers/bookings` → `201`, capture `TRF-...`
28. Replay with the same key → `200`, same reference

**Packages and orders (12 min)**
P1. `GET /api/packages` → the three seeded packages, each with a `priceFrom`
P2. `GET /api/packages/kakheti-wine-weekend/quote?startDate=…&adults=2` → `available: true`, and the lines sum to `totals.totalCents`
P3. `GET /api/packages/tbilisi-shabbat/quote?startDate=<a Friday>` → `available: false`, blocker `TOUR_ON_REST_DAY`
P4. `POST /api/orders/holds` with the token → `201`, holds only on the hotel and tour slots
P5. `POST /api/orders` with an `Idempotency-Key` → `201 ORD-…`, one child reference per slot
P6. **Repeat P5 unchanged → `200`, same reference**
P7. `POST /api/bookings/<the hotel child>/cancel` → `409 PART_OF_ORDER`
P8. `POST /api/admin/orders/ORD-…/items/<the on-request slot>/confirm` → the order becomes `CONFIRMED`
P9. `GET /api/orders/ORD-…/cancellation-quote?email=…` → per item, with `clawbackCents` on the discounted lines
P10. `POST /api/orders/ORD-…/items/<a required slot>/cancel` as a partner → `409 REQUIRED_COMPONENT`
P11. `POST /api/orders/ORD-…/cancel` → every child `CANCELLED`, inventory released

**Authorization (5 min)**
29. `GET /api/admin/partners` anonymously → `401`
30. Same as a partner → `403`
31. Same as an admin → `200`
32. As supplier A, `GET /api/partner/hotels/<supplier B's id>` → `404`
33. As a `PARTNER_AGENT`, `PUT .../inventory` → `403`
34. As an unapproved partner, `GET /api/partner/me` → `200`, but
    `GET /api/partner/dashboard` → `403`

---

## Part 11 — Enum reference

Every value the API will accept or return.

```
PropertyType      Hotel Boutique Resort Guesthouse Lodge Apartment Chalet Hostel Villa
HotelStatus       DRAFT ACTIVE INACTIVE SUSPENDED ARCHIVED
RoomTypeStatus    ACTIVE INACTIVE ARCHIVED
RatePlanStatus    ACTIVE INACTIVE ARCHIVED
MealPlanCode      RO BB HB HB_PLUS FB FB_PLUS AI UAI
CancellationKind  FLEXIBLE NON_REFUNDABLE TIERED
ChargeBasis       PERCENT_OF_TOTAL PERCENT_OF_FIRST_NIGHT FIXED_AMOUNT NIGHTS
PaymentTiming     PAY_NOW PAY_LATER DEPOSIT PAY_AT_HOTEL CREDIT_ACCOUNT
BedTypeCode       SINGLE TWIN DOUBLE QUEEN KING SOFA BUNK FUTON
BathroomType      PRIVATE ENSUITE SHARED
ChildChargeMode   FREE PERCENT_OF_ADULT FIXED_PER_NIGHT FULL_ADULT
TaxFeeBasis       PERCENT PER_NIGHT_PER_PERSON PER_NIGHT_PER_ROOM PER_STAY
BookingStatus     PENDING CONFIRMED CANCELLED COMPLETED NO_SHOW
GuestType         ADULT CHILD INFANT
ImageCategory     Exterior Lobby Restaurant Pool Spa Room Bathroom View Facilities
AmenityCategory   General FoodDrink Wellness Parking Business Family Ski Accessibility Transportation
                  KosherFood Shabbat Religious

KosherServiceLevel        NONE ON_REQUEST KOSHER_FRIENDLY PARTIAL FULL   (weakest first)
KosherCertificationScope  PROPERTY KITCHEN RESTAURANT PASSOVER
KosherCertificationState  NONE UNVERIFIED PENDING_VERIFICATION VERIFIED EXPIRED
                          REJECTED ARCHIVED   (EXPIRED and ARCHIVED are derived)
KosherDataSource          ADMIN HOTEL SUPPLIER IMPORT
BookingRequestStatus      REQUESTED CONFIRMED DECLINED WITHDRAWN

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
TransferFeature       airConditioning wifi childSeat englishDriver meetGreet
                      flightTracking bottledWater freeWaiting

ServiceCategory        KOSHER_MEAL_DELIVERY SHABBAT_MEALS MASHGIACH
                       SYNAGOGUE_TRANSFER GUIDE EQUIPMENT OTHER
ServiceBasis           PER_PERSON PER_GROUP PER_DAY PER_PERSON_PER_DAY
ServiceStatus          DRAFT ACTIVE INACTIVE ARCHIVED
ServiceBookingStatus   PENDING CONFIRMED CANCELLED COMPLETED NO_SHOW
ConfirmationMode       INSTANT ON_REQUEST

PackageStatus          DRAFT ACTIVE INACTIVE ARCHIVED
PackageComponentType   HOTEL_STAY TRANSFER TOUR SERVICE
PackageAdjustmentKind  NONE DISCOUNT_BPS FIXED_SELL PER_PERSON_FIXED
PackageAdjustmentScope REQUIRED_ONLY ALL_ITEMS
PackageQuantityRule    ONE PER_PERSON PER_ROOM
ShabbatMode            SOLAR FIXED_HOURS NONE
PackageUnavailable     COMPONENT_UNAVAILABLE ADJUSTMENT_BELOW_COST KOSHER_INELIGIBLE
SlotReason             EXCLUDED UNAVAILABLE ROUTE_CLOSED SOLD_OUT PARTY_SIZE
                       TOO_SOON BEYOND_HORIZON PAST UNPRICED QUANTITY
                       NOT_FOUND INACTIVE CURRENCY

OrderStatus            PENDING_CONFIRMATION CONFIRMED PARTIALLY_CANCELLED
                       CANCELLED COMPLETED
OrderItemStatus        REQUESTED CONFIRMED DECLINED CANCELLED COMPLETED NO_SHOW
OrderItemFulfilment    INTERNAL ON_REQUEST EXTERNAL
OrderKind              PACKAGE          (CUSTOM reserved, not yet sold)
PricingProductType     HOTEL TRANSFER TOUR SERVICE PACKAGE

UserRole              SUPER_ADMIN ADMIN PARTNER_OWNER PARTNER_ADMIN
                      PARTNER_AGENT PARTNER_FINANCE
PartnerStatus         PENDING_APPROVAL APPROVED REJECTED SUSPENDED
MediaCategory         HOTEL_IMAGE ROOM_IMAGE TOUR_IMAGE
                      PACKAGE_IMAGE AMENITY_ICON                (public)
                      CONTRACT RATE_SHEET INVOICE VOUCHER IMPORT
                      KOSHER_CERTIFICATE OTHER                   (private)
Locale                en ka ru he
```

---

## Part 12 — How to report a bug

Include all of these; without them a report usually cannot be acted on.

1. **Request** — method, full URL with query string, headers you set (especially
   `Idempotency-Key` and `Origin`), and the body
2. **Who you were** — anonymous, guest with `?email=`, partner (which role and
   status), or admin
3. **Expected** — quote the line from this guide
4. **Actual** — the status code and the **whole** response body
5. **Server log** — the matching lines from the terminal running `npm run dev`.
   Every request is logged with an id; include it
6. **Reproducible?** — every time, or once? If once, what else was running

**Report these immediately, whatever else you are doing:**

- Any `netCents`, `markupBps`, `marginCents` or `partner` visible to a
  non-staff caller
- Any response body that changes a price based on something you put in the
  request
- Two `201`s from the same `Idempotency-Key`, or two holds on one last room
- Any partner reading another partner's data
- A `500` on any request — those are always bugs
- A `CONTRACT` or `INVOICE` media record coming back with a plain `url`
