# Running "I am Georgia" locally

A step-by-step guide for anyone who needs the platform running on their own
machine — developers, testers, and anyone doing a demo. No prior knowledge of
the codebase is assumed.

If you only want to *test the API*, you still need everything in this document:
the API cannot answer a single meaningful request without a database behind it.

---

## 1. What you are installing

The project is two applications that talk to each other over HTTP and share
nothing else:

| Part | What it is | Runs on | Folder |
| --- | --- | --- | --- |
| **Server** | The API. Express 5 + Prisma 7. Everything under `/api`. | `http://localhost:5000` | `server/` |
| **Client** | The website. Next.js 16 + React 19. | `http://localhost:3000` | `client/` |
| **Database** | PostgreSQL 17 with PostGIS, run in Docker. | `localhost:5432` | `server/docker-compose.yml` |

The client calls the server. The server calls the database. Nothing else is
required — no Redis, no S3 account, no mail server — because each of those has
a local stand-in that is switched on by default in development.

---

## 2. Prerequisites

Install these before you start.

| Tool | Minimum version | Check it with | Where to get it |
| --- | --- | --- | --- |
| **Node.js** | 22.18.0 | `node -v` | <https://nodejs.org> (LTS) |
| **npm** | ships with Node | `npm -v` | — |
| **Docker Desktop** | any current | `docker -v` | <https://docker.com/products/docker-desktop> |
| **Git** | any current | `git --version` | <https://git-scm.com> |

> **Windows note.** Docker Desktop must be *running* (whale icon in the tray),
> not merely installed. If `docker ps` errors with "cannot connect to the Docker
> daemon", start Docker Desktop and wait for it to say "Engine running".

**Do you have to use Docker?** No. Docker is only how we run PostgreSQL. If you
already have PostgreSQL 17 with the PostGIS extension installed natively, skip
`npm run db:up` and point `DATABASE_URL` at your own instance instead.

---

## 3. Get the code

```bash
git clone <repository-url>
cd "I am Georgia"
```

You should see two folders, `client/` and `server/`.

---

## 4. Set up the server

Every command in this section runs from inside `server/`.

```bash
cd server
```

### 4.1 Create your environment file

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

`.env.example` is a fully commented template — every variable is explained in
it. **For local development the defaults work as they are.** You do not need to
edit anything to get started.

The values that matter most, and why:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `5000` | Where the API listens. |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/iamgeorgia` | How the API reaches Postgres. Must match the `POSTGRES_*` values below it. |
| `CLIENT_ORIGIN` | `http://localhost:3000` | The one origin allowed to make browser calls with a session cookie. Both the CORS allowlist **and** the cross-site write check read this. |
| `APP_URL` | `http://localhost:3000` | Where the front end lives. Every invitation, activation and password-reset link in an email is built from this. |
| `MAIL_TRANSPORT` | `log` | `log` prints emails — links included — to the terminal instead of sending them. This is how you get activation links locally. |
| `GOOGLE_CLIENT_ID` and friends | unset | Only to try the Gmail API transport locally: create a development OAuth client with redirect `http://localhost:5000/api/admin/mail/google/callback`, set the four `GOOGLE_*`/`GMAIL_SENDER_EMAIL` values, and connect from Settings → Email. See docs/DEPLOYMENT.md §3.4c. |
| `AUTH_TOKEN_PEPPER` | a placeholder | Mixed into every token hash. Fine as-is locally; must be 32 random bytes in production. |
| `LOG_LEVEL` | `debug` | How chatty the server is. |

> **Real `.env` files are never committed.** Only the `*.example` templates and
> `.env.test` live in the repository. Anything secret you put in `.env` stays on
> your machine.

### 4.2 Install dependencies

```bash
npm install
```

This also runs `prisma generate` automatically (a `postinstall` hook), which
builds the typed database client. If you ever change `prisma/schema.prisma`, run
`npm run prisma:generate` again.

### 4.3 Start the database

```bash
npm run db:up
```

That is `docker compose up -d` — it pulls the `postgis/postgis:17-3.5-alpine`
image the first time (a minute or two) and starts a container called
`iamgeorgia-postgres`. Data lives in a Docker volume named `pgdata`, so it
survives restarts.

Confirm it is healthy:

```bash
docker ps
```

You want to see `iamgeorgia-postgres` with status `Up ... (healthy)`.

### 4.4 Create the database tables

```bash
npm run prisma:migrate
```

This applies every migration in `prisma/migrations/` — the full schema:
partners, users, sessions, destinations, hotels, room types, rate plans,
inventory, bookings, transfers and the audit log.

### 4.5 Seed the reference data

```bash
node scripts/seed-reference.js
```

**Run this before anything else that seeds.** It creates the shared vocabulary
the rest of the system depends on: amenities, bed types, meal plans and the
cancellation/payment policy templates. Without it, seeding a hotel fails.

### 4.6 Create the first administrator

```bash
node scripts/create-admin.js you@example.com Your Name
```

There is deliberately **no sign-up for administrators**. The first account comes
from this script; every account after it is invited from inside the admin panel.

The script prints a generated password **once**. Copy it somewhere safe — it is
never printed again and cannot be recovered. If you would rather choose it, pass
it as a fourth argument (minimum 12 characters, and it must not contain your own
name or email address):

```bash
node scripts/create-admin.js you@example.com Your Name "Str0ngLocalPass!"
```

### 4.7 Optional: seed a catalogue worth testing

One command runs every seed below in the right order and stops at the first
failure. Add `--admin you@example.com` to create the administrator in the same
run, or `--no-demo` to leave out the demo bookings, drivers and cars:

```bash
npm run seed:all
```

Or step by step:

An empty database technically works, but every search returns nothing. To get
real data:

```bash
# Hotels: 8 destinations, 9 Georgian properties, room types, rate plans,
# and roughly 400 days of nightly rates and inventory.
node scripts/seed-catalogue.js

# Transfers: 67 points, 9 vehicle classes, 396 routes, 3,564 curated prices.
node scripts/seed-transfers.js
node scripts/seed-transfer-translations.js   # ka / ru / he copy
node scripts/seed-transfer-bookings.js       # a few demo bookings
node scripts/seed-fleet.js                   # demo drivers and cars, and dispatches the demo legs

# Kosher: profiles and certificates over the hotels above.
node scripts/seed-kosher.js

# Tours: ten editorial journeys, each with a shared and a private option,
# a year of price sheets and departures.
node scripts/seed-tours.js

# Services and packages, in that order — a package slot can only point at a
# service that already exists.
node scripts/seed-services.js
node scripts/seed-packages.js
```

The package seed is the one that proves the rest: it builds three trips out of
the hotels, tours, transfers and services above, and prices each one. If it
reports "not quotable on any sample date", something earlier in the chain did
not seed. The three are deliberately different shapes — one with every slot
pinned, one kosher, and one whose hotel slot is left open for the buyer to
choose from.

`seed-kosher.js` is written for **coverage rather than volume** — eight
properties, arranged so that every state the feature can be in is on a screen at
once. Two of them are the ones worth opening first:

* **Abanotubani Residence** holds a certificate that is verified and still valid,
  and reads `certified: false` — it covers the restaurant, and a certified
  restaurant inside a hotel is not a certified hotel.
* **Gudauri Alpine Hotel** holds one that was verified and has since lapsed. It
  reports `EXPIRED` with no job having run, because expiry is derived from the
  date on every read rather than stored.

Also seeded: a certificate expiring inside the 60-day warning window, one
awaiting review, an archived predecessor certificate, a supplier update held
back because staff have written the record, and structured nearby synagogues and
mikvehs with walking times.

Certificate dates are **relative to the day you run it**, so the expired one
stays expired and the live one stays live however long the database sits.

Like the others it is idempotent, and it goes further: a property that already
has a kosher profile is skipped whole, so anything entered by hand in the admin
panel survives a re-run untouched.

Every one of these is **idempotent** — re-running refreshes editorial fields and
never deletes anything an operator has changed. `seed-transfer-bookings.js`
books through the real quote-and-confirm path rather than inserting rows, so if
it succeeds, the booking path works.

To undo the demo bookings only: `node scripts/seed-transfer-bookings.js --clear`.
To undo the demo drivers and cars: `node scripts/seed-fleet.js --clear`. Every
demo driver signs in at `/driver/sign-in` with the password the script prints
(`driver-demo-password` unless `--password` was given).

### 4.8 Start the API

```bash
npm run dev
```

`npm run dev` is `node --watch server.js` — it restarts on every file save. Use
`npm start` if you want it to stay put.

**Verify it:**

```bash
curl http://localhost:5000/health
# {"status":"ok","uptime":3.42}

curl http://localhost:5000/health/db
# {"status":"ok","now":"2026-08-30T09:12:44.180Z"}
```

`/health` says the process is alive. `/health/db` says the database is reachable
— it is the one to check when something is wrong.

---

## 5. Set up the client

In a **second terminal**, from the repository root:

```bash
cd client
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:5000
npm install
npm run dev
```

Open <http://localhost:3000>.

Two things must agree or the browser will be blocked:

- `client/.env.local` — `NEXT_PUBLIC_API_URL` must point at the API.
- `server/.env` — `CLIENT_ORIGIN` must list the client's origin.

Optionally, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`)
in `client/.env.local` turns on the Google place search and map on the admin
location screens and at transfer checkout. Use a browser key whose referrers
include `http://localhost:3000/*`. Without it those screens fall back to typed
coordinates, which is fine for most local work.

The session cookie is `httpOnly` and only travels cross-origin when CORS says it
may, so a mismatch shows up as "logged out immediately" or a CORS error in the
browser console — not as a server error.

> The API URL is inlined into the browser bundle at build time, so it has to be
> a URL the *visitor's browser* can reach — not a Docker-internal hostname.

---

## 6. Where things are

| Path | What lives there |
| --- | --- |
| `server/app.js` | Builds the Express app. Deliberately never calls `listen()`. |
| `server/server.js` | Owns the process: listening, signals, shutdown. |
| `server/routes/` | One file per area. `routes/index.js` mounts them all under `/api`. |
| `server/services/` | The actual logic. Routes stay thin. |
| `server/validation/` | zod schemas. Parsed input lands on `req.valid`, never back on `req.body`. |
| `server/serializers/` | Decide what each role is allowed to see in a response. |
| `server/middleware/` | auth, csrf, rate limiting, validation, error handling. |
| `server/prisma/schema.prisma` | The data model. |
| `server/scripts/` | Seeds and one-off admin tools. |
| `server/test/` | The test suite. |
| `client/app/[locale]/` | Three route groups: `(site)`, `(portal)`, `(admin)`. |

---

## 7. Running the tests

```bash
cd server
npm test
```

That is `node --env-file=.env.test --test "test/*.test.js"` — Node's built-in
test runner with supertest driving the app over an ephemeral port.

`.env.test` pins mail to an in-memory outbox and media to a scratch directory,
so **no test needs credentials or a network**. Suites that need a database skip
themselves cleanly if Postgres is not running, rather than failing.

Run one file:

```bash
node --env-file=.env.test --test test/booking.test.js
```

---

## 8. Everyday commands

All from `server/`:

| Command | What it does |
| --- | --- |
| `npm run dev` | API with auto-restart on save |
| `npm start` | API without watching |
| `npm test` | Full test suite |
| `npm run db:up` | Start PostgreSQL |
| `npm run db:down` | Stop PostgreSQL (data survives — it is in a volume) |
| `npm run db:logs` | Follow the database log |
| `npm run db:psql` | Open a `psql` shell inside the container |
| `npm run prisma:migrate` | Create and apply a migration (development) |
| `npm run prisma:deploy` | Apply existing migrations (production) |
| `npm run prisma:generate` | Rebuild the Prisma client after a schema change |
| `npm run prisma:studio` | Browse the database in a GUI at `localhost:5555` |

---

## 9. Troubleshooting

**`ECONNREFUSED` on port 5432, or `/health/db` returns 503**
Postgres is not running. `npm run db:up`, then `docker ps` to confirm it is
healthy. On Windows, check Docker Desktop itself is started.

**`Port 5000 is already in use`**
Something else has the port. Either stop it, or set `PORT=5001` in `server/.env`
— and then update `NEXT_PUBLIC_API_URL` in `client/.env.local` to match.

**The server refuses to boot and prints a configuration error**
That is intentional: both apps validate their configuration at startup and
refuse to run half-configured rather than serving broken responses. Read the
message — it names the variable — and check it against `.env.example`.

**`prisma generate` errors, or types look stale after pulling**

```bash
npm install && npm run prisma:generate && npm run prisma:migrate
```

**I never receive the invitation / activation / reset email**
You are not meant to. `MAIL_TRANSPORT=log` prints the whole message, link
included, into the server terminal. Search the log for the URL and paste it into
your browser.

**Everything 401s even though I logged in**
The session is an `httpOnly` cookie named `iag_session`. In a browser, check
`CLIENT_ORIGIN` matches the origin you are calling from. In Postman, make sure
the cookie jar is on and you are hitting the same host that issued the cookie.

**`429 Too many requests`**
You hit a rate limit — 100 requests/minute per IP globally, and tighter limits
on the auth endpoints (see the testing guide). They are counted in this
process's memory locally, so **restarting the server clears every counter**.

**I want to start from a completely clean database**

```bash
npm run db:down
docker volume ls                   # find the volume, usually server_pgdata
docker volume rm server_pgdata
npm run db:up
npm run prisma:migrate
node scripts/seed-reference.js
node scripts/create-admin.js you@example.com Your Name
```

This destroys all local data. That is the point.

---

## 10. What to read next

| Document | What it covers |
| --- | --- |
| [API_TESTING_GUIDE.md](API_TESTING_GUIDE.md) | Every endpoint, with the exact expected result for each |
| [postman/](postman/) | Ready-to-import Postman collection and environment |
| [../server/API.md](../server/API.md) | The client-facing API contract in detail |
| [../server/README.md](../server/README.md) | Backend architecture and the reasoning behind it |
| [../client/FRONTEND.md](../client/FRONTEND.md) | Colour system, accessibility, i18n |
