# Postman collection

Two files:

| File | What it is |
| --- | --- |
| `I-am-Georgia.postman_collection.json` | The collection — 32 folders, ~700 requests covering **every** endpoint the server mounts, each asserting its expected result |
| `I-am-Georgia.local.postman_environment.json` | The environment — base URL and credentials |

Works in the Postman desktop app, the web app, and `newman` on the command line.

---

## Setting it up (5 minutes)

### 1. Start the API and seed it

From `server/` — the full walkthrough is in [../LOCAL_SETUP.md](../LOCAL_SETUP.md):

```bash
npm run db:up
npm run prisma:migrate
npm run seed:all                     # reference data, hotels, transfers, kosher, tours, services, packages,
                                     # plus the demo transfer bookings, drivers and cars the operations folders use
node scripts/create-admin.js you@example.com Your Name
node scripts/seed-b2b-demo.js         # the demo staff and partner logins folders 06o–06q use (optional)
npm run dev
```

`seed:all` runs every seed script in order; the individual scripts still work on
their own if you only want part of the catalogue.

Keep the password `create-admin.js` prints — it is shown once and cannot be
recovered.

### 2. Import both files

Postman → **Import** → drag both `.json` files in.

### 3. Select the environment

Top-right dropdown → **I am Georgia — Local**.

### 4. Fill in the credentials

Click the environment name → **Edit**, and set:

| Variable | Value |
| --- | --- |
| `baseUrl` | `http://localhost:5000` (already filled) |
| `adminEmail` | the address you passed to `create-admin.js` |
| `adminPassword` | the password it printed |
| `partnerEmail` | *(optional)* a partner account, for folders 05 and 05b |
| `partnerPassword` | *(optional)* |
| `driverEmail` | *(optional)* a `DRIVER` login, for folder 06i. Pre-filled with the first demo driver `seed-fleet.js` creates; clear it to skip |
| `driverPassword` | *(optional)* `driver-demo-password` unless you seeded with `--password` |
| `financeEmail` | *(optional)* an `ACCOUNTANT` login, for the invoice writes in folder 06q. Pre-filled with the demo accountant `seed-b2b-demo.js` creates; clear it to skip |
| `financePassword` | *(optional)* `Demo-Georgia-2026` unless you seeded with `--password` |
| `reservationsEmail` | *(optional)* a `TOUR_OPERATOR` login, for the 403 checks in folder 06q. Pre-filled with the demo reservations desk; clear it to skip |
| `reservationsPassword` | *(optional)* as above |

Leave everything else alone — the rest is filled in automatically as you go.

### 5. Check it works

Run **00 · Health → Readiness**. Green means the API and database are both up.
Red means start there before anything else.

---

## Running it

### One request at a time

Open any request, press **Send**, and read the **Test Results** tab. Every
assertion is named after the behaviour it checks, so a failure tells you what
broke rather than just which line it was on.

The **description** panel on each request documents the expected result, the
error cases, and *why* the API behaves that way. Read it before filing a bug —
several results that look wrong are deliberate.

### The whole collection

**Collection → Run**, then:

| Setting | Value | Why |
| --- | --- | --- |
| Iterations | `1` | The booking flow creates real records |
| Delay | `650` ms | The global limiter allows 100 requests a minute per address; ~700 requests need this spacing. Use `100` ms when running a single folder |
| Keep variable values | **on** | So captured tokens and references survive the run |
| Folders | all, **in order** | Later folders consume tokens the earlier ones captured |

**Order matters.** Folder 03 needs the offer token folder 03's own search
captured; folder 06 asserts against the booking folder 03 created. Running
folder 06 alone will show a couple of skipped assertions, not failures.

**The admin folders write.** Folders 06b–06n create their own records — a
hotel, a partner, a tour, a route, a car, a driver and so on — every one named
with the run token (`pm-hotel-<runId>`, plate `PM-<runId>`,
`pm-<runId>@example.test`) and archived or deleted again at the end of the
folder. Nothing seeded is edited. Where the API refuses a hard delete by design
(points retire, vehicles archive, a booked service cannot be deleted) a
terminal row tagged with the run token is left behind. Run them against a
development database, not a shared one.

### From the command line

```bash
npm install -g newman

newman run docs/postman/I-am-Georgia.postman_collection.json \
  -e docs/postman/I-am-Georgia.local.postman_environment.json \
  --env-var adminEmail=you@example.com \
  --env-var adminPassword='the-printed-password' \
  --delay-request 650
```

The whole collection takes about eight minutes at that spacing.

Add `--reporters cli,html --reporter-html-export report.html` for a shareable
report, or `--folder "03 · Hotel search & booking"` to run one folder.

---

## What is in each folder

| Folder | Covers |
| --- | --- |
| **00 · Health** | Liveness and readiness. Start here — if readiness is 503, nothing else will work |
| **01 · Auth** | Login, session cookie, `/me`, logout, forgot-password. Failure cases run **before** the successful login, because the login limiter only counts failures |
| **01b · Account links** | Activation, password reset and invitation tokens (paste one from the email or the admin response to see the happy path), change-password rules |
| **02 · Public catalogue** | Destinations, hotels, amenities — no authentication, no dates |
| **03 · Hotel search & booking** | The full money path: search → offer token → hold → booking → amend → cancel. Includes the idempotency replay and the "can I send my own price?" attacks |
| **04 · Transfers** | Points, routes, vehicles, quotes, booking, cancellation — plus the window rules (`TOO_SOON`, `BEYOND_HORIZON`, `SAME_POINT`) |
| **04b · Tours** | Catalogue, departures for a party, hold → confirm → replay → cancel as a guest, then the admin register, price sheets, the departure calendar and the on-request answer |
| **04c · Services** | The service catalogue and a direct trade booking |
| **04d · Packages** | Browse, detail, quotes (including a kosher package across Shabbat) and the admin preview quote |
| **04e · Orders** | A package booked as one thing: holds, confirm, replay, partial and whole cancellation, the on-request queue |
| **04f · Public — more** | Transfer route and vehicle pages, package re-validation, recommendations for a stay, order holds and paperwork, the emailed rating link. Runs after the booking folders so it can use their references |
| **05 · Partner portal** | The approval gate, role restrictions, and cross-tenant isolation. Skips itself if no partner account is configured |
| **05b · Partner portal — more** | The supplier extranet (room types, calendar, inventory and rate writes), the partner registers, service bookings, transfer bookings and driver choice, bank details. Skips without a partner account |
| **06 · Admin** | The staff surface, read across; the other half of the staff-only field test |
| **06b · Admin — Partners** | Create, invite, approve, suspend, reactivate, reject, financial details, audit trail, delete |
| **06c · Admin — Reference data** | Destinations, amenities, the media library, pricing rules, cancelling a booking as staff |
| **06d · Admin — Hotels & rooms** | A hotel from draft to published and back: gallery, translations, amenities, room types, beds, rate plans, restrictions, rates, inventory, the calendar |
| **06e · Admin — Hotel policies & files** | Child policy, cancellation and payment policies, meal plans, taxes and fees, private documents, kosher certificate edits and removal |
| **06f · Admin — Transfer catalogue** | Points, providers, vehicle classes, routes with price grids and stops, bulk repricing, extras, blackouts, staff view of a transfer booking |
| **06g · Operations — Fleet & drivers** | Cars and drivers: create, verify, link, gallery, private documents with signed links, driver login links, deactivate, delete |
| **06h · Operations — Dispatch** | The dispatch board: legs, candidates, assign, status moves, unassign, assignments history, schedule, blocks, ratings moderation |
| **06i · Driver panel** | Signed in as a driver: profile, cars, jobs, accept / decline / status, notifications. Uses the demo driver unless `driverEmail` is cleared |
| **06j · Admin — Tours** | A tour from draft to published: options, price sheets, departures, translations, gallery, kosher, lifecycle, the operator's answer to a request |
| **06k · Admin — Orders** | Detail, cancellation quote, per-item confirm / decline / cancel, whole-order cancel |
| **06l · Admin — Services** | A service from draft to published, translations, the bookings register with confirm / decline / cancel, retire and delete |
| **06m · Admin — Packages** | A package template with a hotel slot: validation of slots, kosher profile and override, translations, gallery, publish, retire, delete |
| **06n · Admin — Staff, team & audit** | Staff accounts (super admins: invite → role change → resend → delete; anyone else is asserted to get 403), a partner's own team (needs `partnerEmail`), and the audit log with its filters |
| **06o · Admin — Finance** | Reports per currency (and CSV), payables, receivables and payments lists, supplier terms, the refusals a payment or adjustment must give, and a partner's own statement. Read-only plus refusals: it never records a real payment |
| **06p · Admin — Notifications & reminders** | The admin and portal bells (list, unread count, read marks), the payments-due queue behind the supplier payment reminders, the `paymentsDue` and `unreadNotifications` badges, and the outbox's failed-event list. The reminders themselves come from the server's clock, so the folder reads what the sweeper produced |
| **06q · Admin · Invoices** | The invoicing module (InvoiceOcean): settings, the invoice list and its filters, sync events, one document and its PDF, a partner's own documents, the refusals (the reservations desk, a partner, a foreign document), the hand-issue, send, cancel and retry routes, and the webhook with a wrong secret. Runs green with `INVOICEOCEAN_ENABLED` off or on — the settings request reads the flag and the writes expect `422 INVOICING_DISABLED` while it is off. Never needs a live InvoiceOcean account; with the flag on, the hand-issue request writes a real proforma for the first open receivable |
| **07 · Kosher** | Kosher services and certification on a hotel, the kosher search filters, a requirement the hotel cannot meet |
| **08 · Security & error contract** | Requests that are *supposed* to fail: 401, 403, 404, 400, 413, 429, and the cross-site write check |

---

## How the chaining works

Nothing needs to be copied by hand. Each request stores what the next one needs:

```
Search           → offerToken, quotedTotalCents, hotelSlug
Create hold      → holdToken
Confirm booking  → bookingReference, bookingTotalCents, bookingIdempotencyKey
Quote a journey  → quoteToken, quotedFareCents
Confirm transfer → transferReference, transferIdempotencyKey
Partner login    → partnerId, partnerStatus, partnerRole
Invoice settings → invoicingEnabled
Invoices list    → invoiceId          (a document without a PDF when there is one)
Receivables      → invReceivableId
```

Dates are regenerated on **every** request by the collection pre-request script
— a stay 120 days out, a transfer 90 days out — so the collection never expires
and never needs editing. The same script mints one `runId` per run; every record
the admin folders create carries it, so you can find (and, if a run was
interrupted, tidy up) everything a run left behind by searching for it.

Requests that depend on something the run cannot produce — an emailed token, a
completed transfer leg, a file to upload — say so in their description and
accept the refusal codes as well as the success, so the collection runs green
without hand-holding and still shows the happy path when you supply the input.

Authentication needs no setup at all: the session is an `httpOnly` cookie
(`iag_session`) and Postman's cookie jar handles it. There is no bearer token
anywhere in this API, so do not add an `Authorization` header.

---

## Things that look like bugs but are not

Check this list before filing.

| You see | Why |
| --- | --- |
| `404` for another partner's record | Deliberate. A `403` would confirm the record exists |
| `204` from logging out when not signed in | Logging out of nothing has succeeded |
| `204` from releasing a hold that never existed | Same reasoning |
| `204` from forgot-password for an unknown address | Anything else would enumerate accounts |
| `200` with `"closed": true` and no transfer offers | The road is shut. A real answer, not an error |
| `200` with no offers for a large party | Vehicle capacity is a hard constraint, not a filter |
| `200` with `data: []` from search | Nothing available on those dates. Also an answer |
| Different `priceFrom` for anonymous vs partner | Prices are viewer-relative — partner markup differs from the platform default |
| Transfer *revalidate* returning 200 on a moved fare | It is a preview; it shows the new fare. Only *booking* refuses with 409 |
| Postman not blocked by the cross-site check | Postman sends no `Origin`/`Sec-Fetch-Site`, and a browser cannot suppress those. Only requests from a page are checked |
| `429` after a lot of clicking | The global limit is 100/minute per IP. Restart the server to clear it |
| `400` from a media upload | No file was picked in the request's form-data tab. Everything downstream of it tolerates the missing id |
| `422` `INVOICING_DISABLED` from an invoice write in folder 06q | Invoicing is switched off on that server (`INVOICEOCEAN_ENABLED=false`, the shipped value). Deliberate, and asserted; the same request answers for real once it is on |
| `409` `NOT_ISSUED` from an invoice PDF | The folder picks a document that is not at the provider on purpose, so the run never calls InvoiceOcean. A real PDF needs an issued document and the account configured |
| `404` / `409` from a folder-06 request on `{{bookingReference}}`, `{{transferReference}}` or `{{orderReference}}` | The earlier folder already cancelled that record; the description says how to see the 200 |

---

## Things to report immediately

- Any `netCents`, `netTotalCents`, `markupBps`, `marginCents` or `partner`
  visible to a guest or an anonymous caller — that exposes the platform's margin
- A price that changes because of something you put in the request body
- Two `201`s from the same `Idempotency-Key`, or two successful holds on one
  last room
- One partner reading another partner's data
- Any `500`
- A `CONTRACT` or `INVOICE` media record carrying a plain `url`

The full reporting template is in
[../API_TESTING_GUIDE.md](../API_TESTING_GUIDE.md) §11.
