# Server

Express API backed by PostgreSQL (Docker) via Prisma.

## Stack

| Piece | Choice |
| --- | --- |
| Runtime | Node.js 22.18+ (ES modules) |
| API | Express 5 |
| Database | PostgreSQL 17 in Docker Compose |
| ORM | Prisma 7 with the `@prisma/adapter-pg` driver adapter |
| Validation | zod, enforced inside the Prisma client |
| Logging | pino / pino-http |
| Tests | `node --test` + supertest |

Prisma 7 dropped the Rust query engine, so queries run through a driver
adapter over `pg`. The generated client is TypeScript in `generated/prisma`
and is imported directly — Node strips the types at load time, which is why
the package is `"type": "module"` and requires Node 22.18+.

## Setup

```bash
cp .env.example .env      # adjust credentials if you like
npm install               # postinstall runs `prisma generate`
npm run db:up             # start PostgreSQL in Docker
npm run prisma:migrate    # create/apply migrations
node scripts/create-admin.js you@example.com Your Name   # first administrator
npm run dev               # start the API on http://localhost:5000
```

Check it: `curl http://localhost:5000/health/db` returns the database time.

There is no sign-up for administrators and there should not be: the first
account comes from `scripts/create-admin.js`, and every one after it from an
admin already inside the panel. The script prints a generated password once.

In development `MAIL_TRANSPORT` defaults to `log`, so invitation and activation
links are printed through the logger instead of being emailed. Set it to `smtp`
with `SMTP_*` credentials to send for real, or to `gmail` to send through the
Gmail API as a Google account connected under Settings → Email (see
docs/DEPLOYMENT.md §3.4c); the test suite uses `capture`, which collects
messages into an in-memory outbox the tests assert on.

Deploying it — the Dockerfile, the Render Blueprint and the one-host Compose
stack — is covered in [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the API with file watching |
| `npm start` | Start the API |
| `npm test` | Run the test suite (DB tests skip if Postgres is down) |
| `npm run db:up` / `db:down` | Start / stop the Postgres container |
| `npm run db:logs` | Follow Postgres logs |
| `npm run db:psql` | Open a `psql` shell using the container's own credentials |
| `npm run prisma:generate` | Regenerate the client after a schema change |
| `npm run prisma:migrate` | Create and apply a dev migration |
| `npm run prisma:deploy` | Apply pending migrations (production) |
| `npm run prisma:studio` | Browse the data in Prisma Studio |
| `node scripts/create-admin.js <email> <first> <last>` | Create the first administrator |
| `npm run seed:all` / `node scripts/seed-all.js [--no-demo] [--admin email …] [--dry-run]` | Every seed below in dependency order, stopping at the first failure. `--no-demo` leaves out the demo bookings, drivers and cars; `--admin you@x.com --first F --last L` bootstraps the administrator too; `seed:catalogue` is the `--no-demo` shorthand |
| `node scripts/seed-reference.js` | Load the reference tables (amenities, bed types, meal plans, policy templates). Idempotent; re-run after editing `db/seed/*` |
| `node scripts/check-media-storage.js` | Round-trip an object through the configured storage driver. Run after setting the R2 credentials — `npm test` only ever exercises the local driver |
| `node scripts/seed-catalogue.js` | Seed the real catalogue from `client/data/*.ts`: destination tree, nine hotels with rooms, rate plans, a year of seasonal rates and inventory, and images through the media pipeline. Idempotent by slug; removes `smoke-*` test fixtures first |
| `node scripts/seed-kosher.js` | Overlay kosher data on the seeded catalogue: profiles, certificates in every state, facilities, nearby religious places and booking requirements. Idempotent, and it never overwrites a property somebody has edited by hand |
| `node scripts/seed-fleet.js [--no-assign] [--no-images] [--password …] [--clear]` | Demo drivers (with `@demo.iamgeorgia.test` logins and generated avatar photos) and `DM-` cars (two generated photographs each) under a house provider, pushed through the real media pipeline, then dispatches upcoming demo transfer legs through the real dispatch service. Idempotent; `--clear` removes them |
| `node scripts/seed-services.js` | The service catalogue from `db/seed/services.js`: kosher provision, a guide and equipment hire, in four languages. Idempotent by slug; needs `seed-reference.js` and `seed-catalogue.js` |
| `node scripts/seed-packages.js` | Three sample packages from `db/seed/packages.js` — one with every slot pinned, one kosher, one with an open hotel slot — resolved from product **slugs**, published, and priced. Run last: it needs transfers, tours and services. A package whose products are missing is skipped whole, naming the slug |
| `node scripts/benchmark-package-quote.js [runs]` | Measure `quotePackage` against the seeded packages: wall clock, statements per quote, where those statements go by table, and whether the cost moves with the party. Reads only — safe against a database with real data in it |
| `node scripts/benchmark-search.js [hotels] [days]` | Seed a realistic dataset, measure search latency and print a stage breakdown, then clean up. `KEEP_DATA=1` leaves the data for `EXPLAIN` |

## Layout

```
server.js              Process lifecycle: startup, signals, graceful shutdown
app.js                 createApp() — middleware and routes, no listener
config.js              Env loading, validation and tunables
lib/logger.js          pino instance
lib/errors.js          HttpError types carrying an HTTP status
lib/password.js        scrypt hashing, with cost parameters inside the hash
lib/tokens.js          Random tokens; only their sha256 is ever stored
lib/reference.js       Public references (PTR-000001, BKG-000001) from sequences
lib/locales.js         The four locales, and the fallback to English
lib/audit.js           recordAudit(), taking a transaction handle
lib/mailer/            Transport selection and the notification templates
middleware/errors.js   404 handler + central error handler
middleware/auth.js     authenticate, requireRole, requireApprovedPartner
middleware/validate.js zod request validation onto req.valid
middleware/rateLimit.js Login, registration and token-lookup limiters
routes/                Routers, mounted under /api
services/              Auth, partner and invitation logic
services/hotel/        Destination, amenity and hotel catalogue logic
serializers/           What each role is allowed to see of a record
serializers/localise.js Merges a translation over its English base record
validation/domain.js   zod schemas for every Json column
validation/            Request schemas and shared field normalizers
db/seed/                Amenity, bed-type, meal-plan and kosher vocabularies
lib/time.js            Calendar dates, wall-clock times and the instants between
scripts/create-admin.js Bootstraps the first administrator
scripts/seed-reference.js Loads the reference tables (idempotent)
scripts/seed-kosher.js  Kosher profiles and certificates over the catalogue
scripts/check-media-storage.js Round-trips an object through the storage driver
prisma/schema.prisma   Data model (mirrors client/types)
prisma/migrations/     Migration history
prisma.config.ts       Prisma CLI config (datasource URL)
docker-compose.yml     PostgreSQL service (PostGIS image)
test/                  node:test suites
generated/prisma       Generated client (gitignored)
```

`app.js` deliberately does not call `listen()`. Tests import `createApp()` and
drive it over an ephemeral port; only `server.js` owns the process.

## Data model

`prisma/schema.prisma` mirrors the domain types the frontend already renders
from `client/types`: destinations, hotels (with rooms and reviews), tours
(with itinerary days) and experiences. Conventions:

- **Postgres tables and columns are snake_case** (`@map` / `@@map`), so
  hand-written SQL never needs quoted identifiers.
- **Foreign keys point at `id`**, not `slug`. Slugs stay unique for URL
  lookups but can be renamed without rewriting child rows.
- **Money is integer cents** (`priceFromCents`, `pricePerNightCents`,
  `priceCents`). Convert at the API boundary when serving the client.
- **Enum values match the client's string unions exactly**, so no translation
  layer is needed.
- **Json columns hold value objects that are always read whole**; every one of
  them is validated by a zod schema in `validation/domain.js`.

The catalogue starts empty. Seeding it from `client/data/*.ts` is still to do.

### The hotel module

Five layers, deliberately separated so a change to content cannot become a
change to money:

```
Destination  →  Hotel  →  RoomType  →  RatePlan  →  Rate / RoomInventory
 (geography)   (content)  (physical)  (commercial)   (per night)
```

Only the first two exist today; the rest arrive in later phases. What is
already load-bearing:

- **RoomType is the physical product and RatePlan will be the commercial one.**
  One Deluxe Double sold as BB-refundable, BB-non-refundable and HB-refundable
  is one RoomType and three RatePlans. The prototype's flat `rooms` table could
  not express that and was dropped. Individual numbered rooms are deliberately
  not modelled: no supplier in the pipeline assigns them at booking, and doing
  so would triple the inventory write path for nothing.
- **Occupancy is four numbers, not one, and `maxOccupancy` is not
  `maxAdults + maxChildren`.** A room may allow 2 adults and 2 children but only
  3 guests in total. All four are stored, all four are checked, and a CHECK
  constraint keeps them coherent even for a writer that never went through a
  route. `services/hotel/occupancy.service.js` is a pure function — no Prisma,
  no `req` — which is what makes the awkward cases exhaustively testable.
- **Bed configuration is structured, and `groupIndex` expresses alternatives.**
  Group 0 might be one king, group 1 two twins: the same room, made up either
  way. Without it a "double or twin" room has to be duplicated as two
  RoomTypes, and duplicate room types are what oversell inventory. Beds within
  a group add up; groups do not add to each other.
- **Child age is evaluated at check-in and never changes during the stay.** A
  child who turns twelve on the third night is a child for the whole booking.
  A "child" older than the hotel's child band is counted and charged as an
  adult, which is the single most common source of quote disputes and is
  therefore explicit rather than emergent.
- **A hotel with no child policy uses the platform default** (infant 0-2, child
  3-11, adult 12+). Policies are replaced whole, and the bands are checked for
  gaps and overlaps: a gap means an age resolves to no band and silently prices
  as an adult, an overlap means the charge depends on row order.
- **RatePlan is the sellable offer**: a room, a board, cancellation terms and
  payment terms. One Deluxe Double sold BB-flexible, BB-non-refundable,
  HB-flexible and RO-non-refundable is one RoomType and four RatePlans.
- **Cancellation rules are structured, not prose.** Each rule says "from this
  many hours before check-in and inward, this applies", so the hours are the
  *start* of a tier. Hours rather than days because a deadline is a wall-clock
  instant at the property, and days would leave the time of day to be guessed
  at cancellation. The customer-facing description is stored alongside and
  neither is derived from the other.
- **A booking will never re-read its hotel's policy.** At confirmation the
  rules resolve into a schedule of absolute instants which is frozen onto the
  booking, so a hotel that tightens its terms in March cannot change what a
  guest who booked in January is owed. `services/hotel/policy.service.js`
  builds and reads that schedule and is pure — no Prisma, no `req`.
- **Cancellation and payment are separate entities** because in B2B they vary
  independently: a non-refundable rate can still settle on a credit account
  thirty days after checkout.
- **Policies with a null `hotelId` are shared platform templates.** A hotel may
  use one but not edit it — editing would change terms for every other property
  using it — so the API answers 409 and suggests creating its own.
- **Inventory and rates are one row per night, keyed by `(parent, date)`** with
  no surrogate id — the natural key is the only key anything looks them up by,
  and dropping the extra column matters on tables that reach millions of rows.
  Availability is never stored: `total - blocked - booked - held` is derived on
  read, because a fifth number is a fifth thing that can disagree with the other
  four. A CHECK constraint says those four can never add up to an oversell.
- **Ranges are written in one statement.** `PUT .../inventory` and
  `.../rates` take `from`, `to` and an optional ISO weekday mask, and expand
  through `generate_series` with `ON CONFLICT DO UPDATE`. A 365-day update is
  one round trip, and one audit row, not 365 of each. Anything the body omits
  keeps its existing value, so "close December to arrivals" does not have to
  restate the room counts to avoid wiping them.
- **Search is two stages.** One SQL query finds every rate plan sellable for the
  dates and party; a fixed number of queries then hydrate the page. The load-
  bearing clause is `HAVING count(*) = nights`: a rate plan survives only if
  *every* night is both priced and in stock, so a stay with one sold-out night
  returns nothing rather than an offer that fails at checkout. Query count does
  not grow with result count.
- **"Starting from" is always a real bookable offer** for the exact dates and
  party — never `hotel.priceFromCents`, which has no dates attached.
- **Offers travel as signed tokens, and are always re-quoted.** The HMAC stops a
  client editing a price on the way to checkout; revalidation catches genuine
  change. A moved price is a 409 carrying both figures, not a blank failure.
- **Every availability read goes through `services/hotel/providers/`,** even
  though `MANUAL` is the only implementation. Adding a channel manager is a new
  file in that directory plus a registry entry — search and booking do not
  change.
- **Overbooking is prevented by a conditional UPDATE, not by a lock.** The claim
  is one statement whose WHERE clause *is* the availability check:

  ```sql
  UPDATE room_inventory SET held_units = held_units + :qty
   WHERE room_type_id = :rt AND date = ANY(:dates)
     AND total_units - blocked_units - booked_units - held_units >= :qty
  ```

  Under READ COMMITTED an UPDATE that meets a row locked by a concurrent
  transaction blocks, then **re-evaluates its WHERE against the newly committed
  row** — so the loser matches zero rows and rolls back. SERIALIZABLE would also
  be correct but makes every booking a candidate for a 40001 retry loop. The
  same claim-then-count shape `partner.service.js` already uses for invitations.
- **A hold is a claim; the counter is the enforcement.** `held_units` is what the
  CHECK constraint can see, and the hold row records who holds it and until
  when. The sweeper (interval + Postgres advisory lock, so several instances are
  safe) returns expired holds; `reconcileInventory` recomputes both counters
  from source and proves they agree. Confirming a hold deliberately skips the
  availability re-check — the hold already owns the rooms, and the query would
  otherwise trip over its own claim.
- **Nothing about money comes from the client.** The confirm request carries
  identifiers, dates and people; a strict schema means there is no field an
  amount could arrive in. A rate that moved while the guest was typing is a 409
  with both figures.
- **A booking is a snapshot.** Hotel name, room name, board, bed configuration,
  every night's price and the cancellation schedule resolved to absolute
  instants are all frozen onto it. There is a test that renames the hotel, the
  room and the rate plan afterwards and asserts the booking is unchanged, and
  another that tightens the cancellation policy and asserts the refund does not
  move.
- **Guests read their booking with reference *and* email.** References come from
  a sequence and are trivially enumerable, so the reference alone is not a
  credential. Partners are scoped in the query; every failure is a 404 so
  nothing can be probed for existence.
- **Search performance is measured, not assumed.** `scripts/benchmark-search.js`
  seeds a realistic dataset and reports a stage breakdown. At 1,000 hotels —
  1.5M inventory rows and 2.9M rate rows — p95 is around 150 ms, so none of the
  Phase 8 optimisations (summary rate calendar, response caching, Redis, table
  partitioning) are currently justified. Re-run it before building any of them.
- **Two findings from that benchmark are baked into the code.** Search
  paginates *before* hydrating, because a page of 24 cards was previously
  hydrating and pricing all 1,600 candidate offers; and the candidate query
  passes its nights as a **date array rather than a `generate_series`**, because
  the planner has no row estimate for a set-returning function and falls back to
  hash joins over the whole of `rates` and `room_inventory`. That single change
  took the query from 262 ms to 17 ms. Adding "helpful" `BETWEEN` bounds made it
  worse (698 ms) and is deliberately not there.
- **Stay dates are calendar dates all the way down.** `lib/time.js` keeps
  `YYYY-MM-DD` strings out of `Date` until they reach a `@db.Date` column;
  check-out is exclusive, so 20-23 December is three nights. Wall-clock to
  instant conversion runs two passes, because the offset depends on the instant
  being computed — without the correction every deadline within a day of a
  clock change is an hour wrong.
- **Destinations are a tree with a materialised `path`.** `path LIKE '/georgia/%'`
  is one index scan; a recursive CTE on every search request is not. The path is
  derived and never accepted from a client, and moving a destination rewrites
  every descendant in a single statement.
- **Coordinates are float8 columns plus a PostGIS `geography` point** kept in
  step by a trigger. Prisma can neither read nor write the point, which is fine:
  every geographic query is raw SQL, and a single writer means the point cannot
  disagree with the columns it comes from. A CHECK constraint rejects a
  transposed pair before it reaches the map.
- **Amenities are rows, not an enum array.** Adding "Ski Storage" is an INSERT,
  filtering on it is an index scan, and `hotel_amenities.note` carries the
  per-property qualifier ("Parking, 15 GEL per night") that an enum could not.
- **A hotel is never deleted.** `DRAFT → ACTIVE → INACTIVE → ARCHIVED` is the
  lifecycle; `ARCHIVED` is terminal. There is no DELETE endpoint.
- **Publishing is a transition with a completeness check**, not a boolean.
  `POST /api/admin/hotels/:id/publish` answers 422 with the whole checklist of
  what is outstanding, so the wizard's review step can render it at once. Later
  phases extend `buildPublishChecklist` — room types, rate plans, inventory —
  and nothing else changes.
- **Media is a `FileAsset` plus typed join tables**, not one polymorphic
  association table: a polymorphic row cannot carry a foreign key, so an orphan
  would be undetectable. The database stores object keys and never URLs; a
  public URL is composed from config at serialization time and a private one is
  signed on demand.
- **Translations are per-entity tables with every prose field nullable.** The
  serializer merges only the fields that are set, so a half-finished translation
  reads translated where it exists and English everywhere else — the same
  contract `client/data/i18n/merge.ts` already implements. Nothing that is not
  language is duplicated.

Two conventions worth stating because they will matter later:

- **Stay dates are `@db.Date`, never `timestamptz`.** A hotel night is a
  calendar date at the property, and using an instant here is the single most
  common source of off-by-one-night bugs.
- **Every amount carries its currency.** `Hotel.currency` is the contracted one;
  `priceFromCents` is a denormalised cache for the un-dated browse page only and
  is never used to quote or to book.

### Accounts and partners

`User` is one table for everyone who can sign in, with a `Role` enum and a
nullable `partnerId`: one login endpoint, one session mechanism, one unique
email, and room for several employees per partner without a redesign. A
`CHECK` constraint enforces that platform-side roles carry no `partnerId` and
partner roles always do. The platform side is `SUPER_ADMIN`, `ADMIN`,
`DISPATCHER` and `DRIVER`; the constraint lists every role on one side or the
other, so a role added without a decision fails on its first write.

`DISPATCHER` runs transfer operations — cars, drivers, assignments — and is
deliberately *not* an admin: `middleware/auth.js` exposes `TRANSFER_OPS_ROLES`
and `requireTransferOps` beside `ADMIN_ROLES`, and anything gated on `isAdmin`
(fares, partners, net figures) stays closed to it. `DRIVER` is affiliated to a
supplier through its `TransferDriver` profile rather than through
`User.partnerId`, which is what keeps every partner-scoped query on the
platform closed to drivers by construction; the partner routers also name
their audience with `requirePartner` rather than relying on that alone.
`requireDriver` loads the profile onto `req.driver` and refuses an unlinked or
deactivated one.

A partner's bank details live in their own table, `partner_financial_details`,
so the queries the admin panel runs cannot return an IBAN by accident —
reaching one has to be a deliberate join, and the serializers only make it for
a viewer entitled to the result.

`AuditLog` deliberately breaks two of the conventions above: it references its
subject by plain `(entityType, entityId)` strings rather than a foreign key,
and its actor uses `onDelete: SetNull` with the email kept as a snapshot beside
it. A trail that vanished with the record it describes would be useless.

The public Partner ID (`PTR-000001`) comes from a Postgres sequence created in
the migration. `nextval` is atomic without taking a lock, so two concurrent
registrations cannot be handed the same number. It is never the primary key,
and a deleted partner's number is never reissued.

`DELETE /api/admin/partners/:id` removes a company, its accounts, its bank
details and its invitations. The body must carry `confirm` set to that
partner's own reference, so an irreversible endpoint cannot be fired by a URL
alone — a request naming the wrong record fails instead of destroying it. The
audit row is written inside the same transaction, before the delete, and
survives it.

### The fleet and dispatch module

The transfer catalogue sells a *class* of car (`TransferVehicle`). The fleet
block at the end of the schema is what turns up at the kerb: a physical car
(`TransferFleetVehicle`, sold as one class, owned by a `TransferProvider`), a
driver (`TransferDriver`, a profile that may exist before a `DRIVER` login is
linked to it), and the record of who was sent where (`TransferAssignment`).

Two state machines, defined as data in `lib/transfer/machines.js` on top of
`lib/stateMachine.js`. `TransferBooking.status` stays commercial and is what
money and cancellation read. `TransferBookingLeg.status` is operational —
`UNASSIGNED → ASSIGNED → ACCEPTED → EN_ROUTE → ARRIVED → ON_BOARD → COMPLETED`,
with `NO_SHOW_REPORTED`/`NO_SHOW` and `CANCELLED` beside it — because a return
booking is two jobs on two days with, quite possibly, two drivers. An
assignment is one offer of one driver for one leg and is append-only: a
reassignment revokes the old row and inserts a new one.

Double-booking is refused by Postgres, not only by the service. Each
assignment stores the window it occupies (pick-up minus a buffer, to the end
of the journey plus a buffer; the buffers are stored on the row), and two
`EXCLUDE USING gist` constraints — one over `(driver_id, window)`, one over
`(fleet_vehicle_id, window)`, both limited to `OFFERED`/`ACCEPTED` rows —
make an overlap a `23P01` that `middleware/errors.js` reports as a 409. A
partial unique index allows one live offer per leg. Manual unavailability is
`TransferResourceBlock`; the `transfer_occupancy` view unions both sources
for the schedule screen and the dispatcher's pre-check. `btree_gist` is
enabled by the migration.

Ratings are individual rows (`TransferDriverRating`, one per completed leg,
1–5) and the averages on the driver and the provider are recomputed from the
published rows in the same transaction, never incremented. A rating with a
comment waits for a look (`PENDING`) before it counts.

Notifications go through a transactional outbox: every dispatch write
enqueues an `OutboxEvent` in its own transaction, and
`services/notifications/outbox.service.js` drains it on an interval from
`server.js` — under a transaction-scoped advisory lock, claiming a batch with
a lease and processing it *outside* the transaction so an SMTP conversation
never holds a connection. Handlers write `Notification` rows (the in-app
channel) and send email through `sendMail`, which throws — deliberately, since
that is what makes a refused email a retried event rather than a lost one; a
failed handler retries with backoff, and `Notification` rows are stamped with
the event id so a retry does not repeat a notice already written.
`sendMailQuietly` is for request handlers, where a failed notice must not fail
the request. Standalone hotel, tour and service bookings use the same outbox:
the facade writes the guest's event (`hotel.booking.confirmed`,
`tour.booking.requested`, …) and the `…InTx` function writes the supplier's
(`supplier.booking.received` / `…cancelled`), so a booking sold inside an
order tells its supplier but leaves the guest to the order's own emails.
`services/transfer/reminder.service.js` is the second sweeper:
the driver's reminder, the passenger's driver details and the "still no
driver" alert, each stamped on the leg in the statement that selects it so it
fires once. Dispatch settings live under `config.transfer.dispatch`
(`TRANSFER_DISPATCH_*`, `TRANSFER_RATING_*`, `TRANSFER_OPS_EMAIL`,
`TRANSFER_OUTBOX_DRAIN_INTERVAL_MS`, `TRANSFER_REMINDER_SWEEP_INTERVAL_MS`).

### What a partner may change about itself

`PATCH /api/partner/profile` is an allow-list, and four fields are deliberately
outside it: the legal entity, the registration number, the partner type and the
country. Those are what the approval was granted against, so a company that
could rewrite them after being vetted would make the review meaningless. They
move through an admin, who leaves an audit row when they do it. The portal
shows them locked rather than hiding them, so a partner can still read back
what we hold.

`PATCH /api/partner/account` covers a user's own name, position and phone, and
works in every partner status — correcting the spelling of your own name should
not wait on a decision about your company. Email is not in it: it is the login
identifier and the address every decision was sent to, so moving it needs a
verification round trip rather than a text field.

`POST /api/auth/password/change` requires the current password even though the
caller is already signed in, ends every session the account had, and answers
with a fresh cookie so the device doing the changing is not signed out for its
trouble.

## Json validation

Postgres accepts any JSON in a `Json` column, so `db/index.js` installs a
Prisma client extension that validates those fields on every write —
`create`, `createMany`, `update`, `updateMany` and `upsert`. Invalid data
throws a `BadRequestError` (400) carrying the zod issues, before it reaches
the database. Because the check lives in the client, routes, scripts and seeds
are all covered rather than only the callers that remember to validate.

Add a new Json column by adding its schema to `jsonFieldSchemas` in
`validation/domain.js`.

## Error handling

Express 5 forwards rejected promises, so routes need no `try/catch`. The
handler in `middleware/errors.js`:

- uses the status of any `HttpError` from `lib/errors.js`;
- maps Prisma codes — `P2002` → 409, `P2003` → 409, `P2025` → 404;
- honours `status`/`expose` on http-errors thrown by Express middleware, so a
  body over the size limit is a 413 rather than a 500;
- replaces the message of anything else with `Internal server error`, and only
  includes a stack in development.

## Hotel module environment

`.env.example` documents these in full. The ones that must be set in any
deployed environment and have deliberately public development defaults:

| Variable | Why it is required in production |
| --- | --- |
| `HOTEL_OFFER_TOKEN_SECRET` | Signs the offer tokens search hands out. With the development default, anyone could re-price an offer on its way into checkout. |
| `TRANSFER_QUOTE_TOKEN_SECRET` | The same for transfer quotes. Its own secret so either can be rotated without invalidating the other's tokens in flight. |
| `MEDIA_S3_*`, `MEDIA_PUBLIC_BASE_URL` | Without them every image upload fails at the moment an admin tries to publish a hotel, which is a bad place to discover missing configuration. |

"Deployed" means any `NODE_ENV` other than `development` or `test`: a staging
box reachable from the internet is just as exposed with the development pepper
as production would be, so it is held to the same list.

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default 5000) |
| `CLIENT_ORIGIN` | Allowed CORS origin (the Next.js app) |
| `LOG_LEVEL` | pino level; `silent` in tests |
| `APP_URL` | Where the browser reaches the front end; every emailed link is built from it |
| `AUTH_TOKEN_PEPPER` | Mixed into every token hash, so a database dump alone cannot rebuild a link |
| `TRUST_PROXY` | Required behind a reverse proxy, or the per-IP rate limits protect nothing |
| `REDIS_URL` | Shared rate-limit counters; required once the API runs on more than one instance |
| `MAIL_TRANSPORT` | `smtp`, `gmail`, `log` (development) or `capture` (tests); anything else refuses to boot |
| `MAIL_FROM`, `SMTP_*` | Mail credentials; `SMTP_*` required outside development and test unless the transport is `gmail` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GMAIL_SENDER_EMAIL` | The Gmail API: all four or none. With them set, an administrator can connect the account and test it before `MAIL_TRANSPORT=gmail` |
| `MAIL_CREDENTIALS_KEY` | 32 random bytes, base64: seals the stored Google refresh token. Required on a deployed instance once the Gmail API is configured |
| `GMAIL_FROM_ALIAS_VERIFIED` | `true` when `MAIL_FROM` is a verified "Send mail as" alias of the Gmail account; otherwise `MAIL_FROM` must be the account itself |
| `GMAIL_DAILY_SEND_WARN` | Sends in 24 hours after which administrators are warned in-app (default 400; not a cap) |
| `SMTP_CONNECTION_TIMEOUT_MS` / `SMTP_SOCKET_TIMEOUT_MS` | How long a send may wait on the relay (default 10s / 30s) |
| `MEDIA_S3_REQUEST_TIMEOUT_MS` / `MEDIA_S3_CONNECTION_TIMEOUT_MS` / `MEDIA_S3_MAX_ATTEMPTS` | Object storage timeouts and retries (default 30s / 5s / 3) |
| `REQUEST_TIMEOUT_MS` | How long a client may take to send a whole request (default 30s) |
| `DATABASE_URL` | Connection string used by the app and Prisma CLI |
| `DATABASE_POOL_MAX` | Pool size **per process** (default 10) |
| `DATABASE_IDLE_TIMEOUT_MS` / `DATABASE_CONNECTION_TIMEOUT_MS` | Pool timeouts |
| `SHUTDOWN_TIMEOUT_MS` | Grace period before shutdown is forced |
| `HOTEL_COMPLETION_SWEEP_INTERVAL_MS` | How often confirmed stays past check-out roll to `COMPLETED` (default hourly); orders with a hotel wait on it |
| `TOUR_OFFER_TOKEN_SECRET` / `PACKAGE_OFFER_TOKEN_SECRET` | Sign tour offers and package quotes; required outside development and test, like the hotel and transfer secrets |
| `TRANSFER_RATING_TOKEN_SECRET` | Signs the rating links emailed after a transfer; required outside development and test |
| `MEDIA_DRIVER` | `s3` or `local`; inferred from `MEDIA_S3_ENDPOINT` when unset, set explicitly in production |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | Consumed by `docker-compose.yml`; keep in sync with `DATABASE_URL` |

Startup fails immediately if `DATABASE_URL` is missing, rather than booting a
server that cannot serve anything. Every numeric variable is checked the same
way: unset means the default, but a value that is present and not a number is
refused rather than silently replaced by it.
