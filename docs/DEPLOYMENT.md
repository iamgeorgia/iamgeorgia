# Deploying "I am Georgia"

Two deployables and one database:

| Piece | What it is | Ships as |
| --- | --- | --- |
| `client/` | Next.js 16 site, admin panel and partner portal | Docker image (`client/Dockerfile`) or Vercel |
| `server/` | Express 5 API with Prisma 7, background sweeps and graceful shutdown | Docker image (`server/Dockerfile`) |
| Database | PostgreSQL 17 **with PostGIS** — the schema uses `geography(Point, 4326)` | Managed Postgres, or the `db` service in `docker-compose.prod.yml` |

Plus two external services the API already talks to: an S3-compatible bucket
pair for media (Cloudflare R2) and an SMTP relay for mail.

Two supported ways to run it:

- **Render + Vercel** (what production runs): `render.yaml` at the repo root
  creates the database and the API from one Blueprint; the Next.js client is
  deployed by Vercel from the `client` folder. Zero servers to patch.
- **One host with Docker Compose**: `docker-compose.prod.yml` runs everything,
  Caddy included, on a single VPS. Cheaper, and all the operations are yours.

Both use the same images and the same environment contract
(`server/.env.production.example`), so moving between them is a config change.

---

## 1. The three rules that are easy to get wrong

1. **The site and the API must share a registrable domain.** The session
   cookie is `SameSite=Strict` with no `Domain` attribute. `iamgeorgia.travel`
   and `api.iamgeorgia.travel` are one site; `x.onrender.com` and
   `y.onrender.com` (or `x.vercel.app`) are two different sites and sign-in
   will silently fail. Attach custom domains before testing login.

   Sharing a site is not enough on its own. Without a `Domain` attribute the
   cookie belongs to the API's host only, and the admin, partner and driver
   panels check the session while rendering on the *site's* host — so sign-in
   returns 200 and the panel sends you straight back to its sign-in page. Set
   `AUTH_COOKIE_DOMAIN` on the API to the narrowest domain both hosts share:

   | Site | API | `AUTH_COOKIE_DOMAIN` |
   | --- | --- | --- |
   | `iamgeorgia.travel` | `api.iamgeorgia.travel` | `iamgeorgia.travel` |
   | `preview.iamgeorgia.com.ge` | `api.preview.iamgeorgia.com.ge` | `preview.iamgeorgia.com.ge` |

   Never a parent of the environment's own domain (`iamgeorgia.com.ge` for the
   preview): that sends the preview's cookie to production and every other
   host under it. Locally it stays unset — `localhost:3000` and
   `localhost:5000` already share cookies, because cookies ignore ports.
2. **`NEXT_PUBLIC_API_URL` is baked into the client at build time.** It must be
   the API's *public* URL, and the API's `CLIENT_ORIGIN` must be the site's
   public URL. Changing either means rebuilding the client.
3. **Migrations run before the new API starts, never inside it.** Render's
   `preDeployCommand` and the compose `migrate` service both run
   `prisma migrate deploy` in the freshly built image. A migration that fails
   stops the deploy while the old version keeps serving.

---

## 2. Before the first deploy

- A domain, with DNS you control. Plan on `iamgeorgia.travel` (site),
  `api.iamgeorgia.travel` (API) and optionally `media.iamgeorgia.travel`
  (public bucket CDN).
- **Cloudflare R2**: two buckets (`iamgeorgia-public-prod`,
  `iamgeorgia-private-prod`), one API token with read/write on both, and a
  public URL for the public bucket (an `r2.dev` URL or a custom domain). If
  you use a custom media domain, add it to `images.remotePatterns` in
  `client/next.config.ts`.
- **A transactional email provider** (Resend, Postmark, Amazon SES, Brevo)
  with SMTP credentials. A Gmail or Mailtrap account is fine for staging only.
- The repository pushed to GitHub, because both Render and CI deploy from it.

---

## 3. Deploying on Render

### 3.1 Create everything from the Blueprint

1. Render dashboard → **New → Blueprint** → pick this repository. Render reads
   `render.yaml` and lists what it will create: `iamgeorgia-db` and
   `iamgeorgia-api`.
2. It prompts for every variable marked `sync: false`. Fill them from the
   table below. Secrets marked `generateValue: true` are minted by Render.
3. Approve. Render builds the API image, applies the migrations through the
   pre-deploy command, then starts the API once `/health` answers.

Region is `frankfurt` in the file — the closest to Georgia. Change it in
`render.yaml` *before* the first apply; a database cannot move region later.

### 3.2 Variables you are asked for

| Variable | Value |
| --- | --- |
| `CLIENT_ORIGIN` | `https://iamgeorgia.travel` — the site's public origin, no trailing slash |
| `APP_URL` | Same as `CLIENT_ORIGIN` |
| `AUTH_COOKIE_DOMAIN` | The domain the site and the API share (rule 1): `iamgeorgia.travel` in production, `preview.iamgeorgia.com.ge` for the preview |
| `MAIL_REPLY_TO` | The mailbox humans reply to |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | From the email provider |
| `TRANSFER_OPS_EMAIL` | Where "leg still has no driver" alerts go |
| `MEDIA_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | The R2 API token |
| `MEDIA_PUBLIC_BUCKET`, `MEDIA_PRIVATE_BUCKET` | Bucket **names**, never URLs |
| `MEDIA_PUBLIC_BASE_URL` | The public bucket's URL, e.g. `https://pub-….r2.dev` |

Everything else (`NODE_ENV`, `PORT`, `TRUST_PROXY=1`, `DATABASE_URL` from the
database, the six signing secrets) is set by the Blueprint.

### 3.3 Custom domains

1. `iamgeorgia-api` → Settings → Custom Domains → add `api.iamgeorgia.travel`.
2. Vercel → project → Settings → Domains → add `iamgeorgia.travel` and
   `www.iamgeorgia.travel`.
3. Create the CNAME/A records each dashboard shows. Certificates are issued
   automatically once DNS resolves. The domain itself must have nameservers
   published first — if `nslookup iamgeorgia.travel` says "non-existent
   domain", nothing under it can resolve yet.
4. Set `CLIENT_ORIGIN` and `APP_URL` on the API to `https://iamgeorgia.travel`,
   `AUTH_COOKIE_DOMAIN` on the API to `iamgeorgia.travel`, and
   `NEXT_PUBLIC_API_URL` on Vercel to `https://api.iamgeorgia.travel`, then
   redeploy the client. `render.yaml` only prompts for `AUTH_COOKIE_DOMAIN`
   when a Blueprint is first applied — on a service that already exists, add it
   under Environment by hand.
5. Only now does sign-in work end to end (rule 1 above).

### 3.4 First-run tasks

Open a shell on the API service (dashboard → Shell) and run, once:

```bash
node scripts/seed-reference.js                 # amenities, bed types, meal plans, policy templates
node scripts/create-admin.js you@iamgeorgia.travel First Last
node scripts/check-media-storage.js            # round-trips an object through R2
```

Or seed the whole catalogue in one go from your machine — see §3.4a.

The admin script prints an activation link; the email goes out through SMTP
too. Then verify:

```bash
curl https://api.iamgeorgia.travel/health       # {"status":"ok",...}
curl https://api.iamgeorgia.travel/health/db    # {"status":"ok","now":"..."}
```

### 3.4a Seeding the hosted database

Two seed scripts read editorial files from `client/data`, which the API image
does not contain, so seed from your machine against the hosted database:

1. Database → **Access Control** → add your public IP, and copy the
   **External Database URL** from the same page.
2. In `server/`, point `DATABASE_URL` at it for this shell only and run the
   combined seed. `--no-demo` leaves out the demo bookings, drivers and cars;
   drop it on a staging system where you want them.

   ```powershell
   $env:DATABASE_URL = "<external url>?sslmode=require"
   npm run seed:all -- --no-demo --admin you@iamgeorgia.travel --first First --last Last
   Remove-Item Env:DATABASE_URL
   ```

   Images are pushed through the media pipeline into the R2 buckets named in
   your local `.env`, which must be the same buckets the API is configured
   with. A certificate error means the URL needs `?sslmode=no-verify` instead.
3. Remove your IP from Access Control again. The API reaches the database
   over the private network and never needs the public door.

### 3.5 Database plan, backups, access

- **Do not use a free database.** Render deletes free Postgres instances after
  30 days. The Blueprint asks for `basic-256mb`; move up as data grows.
- Daily backups come with paid plans. **Enable point-in-time recovery** (a
  Pro-tier feature) before taking real bookings — "restore to yesterday" is
  not acceptable for payments.
- `ipAllowList: []` means the database is unreachable from the internet; the
  API uses the internal connection string. To use `psql` from your machine,
  add your IP in the database's Access Control and use the *external* URL with
  `?sslmode=require`.
- Do a restore drill into a scratch database once, and note how long it took.
  That number is your real recovery time.

### 3.6 Everyday operations

| Task | How |
| --- | --- |
| Deploy | Push to `main`. CI runs, then Render builds, migrates and rolls out health-gated. |
| Roll back the API | Service → Events → **Rollback** to the previous deploy. Only safe if the migration in between was additive (see §5). |
| Change a variable | Service → Environment. The API restarts; the web app must be **rebuilt** if `NEXT_PUBLIC_API_URL` changed. |
| Read logs | Service → Logs. They are JSON (pino); search by `reqId`, `err.message`, `statusCode`. |
| Scale the API to 2+ instances | Uncomment the `keyvalue` block and the `REDIS_URL` variable in `render.yaml`, and set `DATABASE_POOL_MAX` so `pool × instances` stays under the database's connection limit. |

### 3.7 The client on Vercel

Import the repo in Vercel with **Root Directory** `client`, set
`NEXT_PUBLIC_API_URL` to the API's public URL for the Production environment,
and attach `iamgeorgia.travel`. Every push to `main` redeploys. The
`output: "standalone"` setting in `next.config.ts` switches itself off under
Vercel's builder (it keys off the `VERCEL` variable), so the same config
serves both the Docker image and Vercel.

To host the client on Render instead, add a second Docker web service with
`rootDir: client` and `NEXT_PUBLIC_API_URL` as an env var — Render passes env
vars as build args, which is what `client/Dockerfile` expects.

---

## 4. Deploying on one host with Docker Compose

For a VPS with Docker installed and both DNS names pointing at it.

```bash
git clone <repo> && cd "I am Georgia"
cp server/.env.production.example server/.env.production
# Fill in server/.env.production, and add these Compose-only values to it:
#   POSTGRES_USER=iamgeorgia
#   POSTGRES_PASSWORD=<long random>
#   POSTGRES_DB=iamgeorgia
#   NEXT_PUBLIC_API_URL=https://api.iamgeorgia.travel
#   SITE_DOMAIN=iamgeorgia.travel
#   API_DOMAIN=api.iamgeorgia.travel

docker compose --env-file server/.env.production -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f api
```

What the file does: PostGIS with a persistent volume and no published port,
a one-shot `migrate` service, the API (started only after migration
succeeds), the web app (started only after the API is healthy), and Caddy
terminating TLS for both hostnames with certificates it obtains itself
(`deploy/Caddyfile`).

First-run tasks are the same as §3.4, run through Compose:

```bash
docker compose -f docker-compose.prod.yml exec api node scripts/seed-reference.js
docker compose -f docker-compose.prod.yml exec api node scripts/create-admin.js you@iamgeorgia.travel First Last
```

Updating:

```bash
git pull
docker compose --env-file server/.env.production -f docker-compose.prod.yml up -d --build
```

Backups are yours to run. A nightly cron like this, shipped off the host, is
the minimum:

```bash
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U iamgeorgia -Fc iamgeorgia > backup-$(date +%F).dump
```

---

## 5. Migrations and rollback

`prisma migrate deploy` applies pending migrations in order and never resets.
For a rollback to be possible, every migration must be **backwards compatible
with the version currently running**:

- Add a nullable column, backfill, ship the code that uses it, and drop the old
  column in a *later* release.
- Never drop or rename a column in the same release as the code that stopped
  using it. That deploy has no safe rollback.

The CI workflow applies every migration to a fresh PostGIS on each pull
request, so a migration that cannot apply is caught before it reaches Render.

---

## 6. Environment contract

`server/.env.production.example` is the complete list for a deployed API.
`config.js` refuses to boot when any required variable is missing, and lists
them by name, so a misconfigured deploy fails at startup rather than at the
first sign-in or upload. The full reference, including every optional tuning
knob, is `server/.env.example` and the table in `server/README.md`.

The client has one required variable, `NEXT_PUBLIC_API_URL`, and two optional
ones for the place search and maps on the admin location screens and the
transfer checkout: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and
`NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. All three are inlined at build time, so a
change means a rebuild. The Maps key is a **browser** key: restrict it in the
Cloud console by HTTP referrer to the site's origins (production domain,
Vercel preview pattern, `http://localhost:3000/*`) and to exactly the Maps
JavaScript API, Places API (New) and Geocoding API, and set per-minute quotas
and a budget alert there. Without the key the location screens fall back to
typed coordinates and the checkout hides the address search.

---

## 7. CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`:

1. Client: `tsc --noEmit`, `eslint`, `next build`.
2. Server: `prisma validate`, `prisma migrate deploy` against a PostGIS
   service container, the full test suite, `npm audit`.
3. Both Docker images build (not pushed).

Render deploys on push to `main` regardless of CI. To make deploys wait for a
green run, turn off `autoDeployTrigger` in `render.yaml` and trigger the
service's Deploy Hook URL from a final CI job instead.
