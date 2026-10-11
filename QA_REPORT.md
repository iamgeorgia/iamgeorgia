# QA Report — I am Georgia (full functional, interface, API, security and performance audit)

**Date:** 2026-10-10 · **Branch:** `feat/b2b-phase-0-hardening` at `e72e490` plus the uncommitted working tree (notifications pages, finance panels, help articles) · **Environment:** local, production client build (`next build` + `next start`) on :3000, Express API on :5000, PostgreSQL 17 in the `iamgeorgia-postgres` Docker container (dev database, no production data: 72 users on `example.test` / demo domains).

Everything below was executed, not inferred. Every check has an ID; the full list with evidence is in [docs/qa/QA_CHECKS_2026-10-10.md](docs/qa/QA_CHECKS_2026-10-10.md), the harness that produced it is in [qa/e2e/](qa/e2e/), screenshots are in [docs/qa/evidence/](docs/qa/evidence/).

---

## 1. Executive summary

The platform is substantially solid in the places that matter most. The complete hotel booking journey (search → live offers → hold with a countdown → checkout → confirmation → self-service cancel) and the complete transfer journey (quote → vehicle → passenger details → confirmation → dispatch → driver accept → cancel) work end to end in a real browser, and every money figure they produce was re-derived and matched (offer arithmetic, booking totals, margin = total − tax − net, cancellation charge + refund = total, receivables and payables written in the booking transaction, frozen commission rates). Concurrency is handled correctly: 7 simultaneous holds on 6 units gave exactly 6 holds and one 409; double-clicking Confirm created exactly one booking; two dispatchers cannot put the same driver on overlapping legs. The capability-based RBAC held on every route and service-level check tried (33 role checks, 6 IDOR probes across suppliers and drivers, maker-checker approvals with self-approval refused, credit limits that refuse a booking before anything is written). Input handling is strict where it must be (no amount fields accepted, unknown body keys rejected, 413 on oversized bodies, 400 on malformed JSON, magic-byte sniffing on uploads, CSRF origin check, HttpOnly server-side sessions that expire and can be revoked).

Four defects block a production release in my judgment, each small to fix:

1. **Dated tour search returns HTTP 500** (`GET /api/search/tours?date=…`): int4 overflow in the candidate SQL as soon as any tour's net price exceeds ~1,867 GEL per unit. Seven of the real tours do. The public tours page with a date, the Postman folder and any partner searching tours by date are broken.
2. **The dated-search rate limit is effectively site-wide.** `searchLimiter` is hard-coded to 30 requests/min per IP, the client renders hotel and tour search on the server, and the server-side fetch does not forward the visitor's IP. Behind a single-egress host (Render) the whole site shares one bucket: the 31st dated search in any minute fails for everyone. Reproduced locally with a 30-request burst even with `RATE_LIMIT_GLOBAL` raised.
3. **Order replay is not idempotent in practice.** `confirmOrder` re-prices and re-checks availability before it looks up the idempotency key, so a client that retries after a timeout gets `409 UNAVAILABLE` instead of its existing order.
4. **Dependency advisories rated critical**: `next@16.3.0` (unauthenticated RCE advisories, fixed in a later 16.3.x) and `proxy-addr` (IP spoofing through the trust-proxy subnet, which this API relies on for per-IP limits).

Beyond those: the partner notifications page crashes (500) for any partner that has not yet accepted the current terms; Georgian (`/ka`) tour pages hydrate with React error #418 in Chromium; and the transfer cancellation quote names its refund field differently from every other product (and from the documentation). Lighthouse scores are good (performance 81–98, SEO 100 on indexable pages, best practices 96) with accessibility at 86–96 and a recurring colour-contrast finding.

**Readiness classification at audit time (2026-10-10): NOT READY FOR PRODUCTION** — because of items 1, 2 and 4 above.

**Update 2026-10-11:** every confirmed defect except the environment-only BUG-011 was fixed and re-verified against the rebuilt application (see §14). The classification is now **READY WITH MINOR ISSUES**: the remaining items are the accessibility findings, mobile LCP, the dev-bucket images and the test-hygiene notes.

Numbers, for scale:

| Metric | Result |
|---|---|
| Features discovered (inventory rows) | 74 (over 140 Next.js pages and 402 API endpoints) |
| Features with an execution status | 74 — 62 PASS, 4 FAIL, 2 INFO (404 by design), 6 NOT TESTED |
| Harness checks executed (browser + API + DB) | 672 — 636 pass, 13 fail, 22 info, 1 not tested |
| Page loads swept across 6 roles | 178 (169 clean, 9 with real problems before noise filtering was applied: 4 portal-notifications 500s, 3 designed 404s, 2 Georgian hydration errors) |
| Server test suite (`node --test`) | 1,138 tests, 1,137 pass, 1 flaky (passes alone) |
| Client unit tests | 22 / 22 pass; lint 0 errors (5 warnings); production build clean |
| Postman collection via newman | 766 requests, 4,074 assertions, 41 failed (1 product 500; the rest are collection/environment drift, see §7) |
| Lighthouse runs | 7 pages (mobile + desktop presets) |
| Confirmed bugs | 11 (2 high, 3 medium, 6 low) + 3 test-infrastructure findings |

---

## 2. Scope and method

- **Discovery** from the code, not the docs: `server/routes/index.js` (54 routers, 402 endpoints), `client/app` (140 `page.tsx` files across `(site)`, `(admin)`, `(portal)`, `(driver)` route groups and four locales), `prisma/schema.prisma` (108 models, 46 migrations), `lib/permissions.js` (62 capabilities, 13 seeded roles).
- **Environment**: Docker Desktop started for the dev database; API started with raised auth/global limits and `MAIL_TRANSPORT=log` so no mail left the machine; a second API instance with default limits on :5001 was used only to verify throttling; demo accounts refreshed with `scripts/seed-b2b-demo.js` (13 logins covering SUPER_ADMIN, ADMIN, MANAGEMENT, TOUR_OPERATOR, ACCOUNTANT, FINANCE_OPERATOR, DISPATCHER, four partner roles, a suspended partner, a hotel supplier and a transport supplier) plus a seeded demo driver.
- **Execution**: Playwright 1.62 driving Edge (headless) for every UI journey, viewport sweep and timing; plain `fetch` for the API; `docker exec … psql` for persistence checks; the project's own suites (`npm test` in `server/` and `client/`); newman for the 709-request Postman collection; Lighthouse 12 via npx.
- **Safety**: dev database only; disposable `qa.*@example.test` records; every booking the audit created was cancelled, every destination/role/hotel/tour/service/partner it created was deleted; two deactivated invitee users and three `QA-*` payment records remain (finance rows are append-only by design). No repository file was changed by the audit other than the additions under `docs/qa/`, `qa/e2e/` and this report; `git status` shows the same 28 pre-existing entries.

---

## 3. Architecture (as discovered)

| Area | Finding |
|---|---|
| Frontend | Next.js 16.3.0 App Router, React 19.2.8, Tailwind v4, Framer Motion; `[locale]` tree (en, ka, ru, he RTL); Server Components fetch with `serverFetch` (forwards the session cookie only); `proxy.ts` handles locale redirects |
| Backend | Express 5.2 + Prisma 7.9 + PostgreSQL 17 (PostGIS); zod validation on every route; `createApp()` without `listen()` for tests; helmet, CORS with one exact origin + credentials, pino logging, in-memory or Redis rate limiters |
| Auth | Email + password, Argon/pepper-hashed tokens, `iag_session` HttpOnly SameSite cookie, server-side `sessions` rows (30-day TTL, revocable), activation/reset/invitation tokens, origin-based CSRF check on state-changing requests |
| Authorization | Capability table (`lib/permissions.js`) materialised into `roles`/`role_capabilities`/`user_roles`/`user_capability_overrides`; `requireCapability` on routers, `assertMayMutate` in services; maker-checker approvals for refunds/adjustments |
| Domain | Hotels (room types, rate plans, nightly rates, inventory, holds), transfers (points, routes, vehicle classes, quotes, fleet, drivers, dispatch legs, ratings), tours (options, seasons/tiers, departures, holds), services, packages → orders, finance (payables, instalments, receivables, payments, allocations, penalties, credit limits, reminders), partners (lifecycle, contract, terms, product access, team), notifications, audit log, outbox |
| Integrations | SMTP/Mailtrap (logged during the audit), Cloudflare R2 (S3) media with sharp variants, Google Places (client key), optional Redis for limiters |
| Background work | Outbox drain (emails/notifications), hotel completion sweep, tour hold sweep, finance reminder sweep (10 min), overdue alerts |
| Deployment | Vercel (client) + Render (API) per `render.yaml`/`docs/DEPLOYMENT.md`; Docker files for both apps |
| Existing tests | 85 server test files (node:test + supertest, incl. an RBAC route matrix fixture), 2 client unit test files, a 709-request Postman collection, GitHub Actions CI |

---

## 4. Feature inventory and execution status

Status is the worst result among the checks mapped to the row (PASS / FAIL / INFO = recorded or by design / NOT TESTED). Routes are the client routes; the API column names the endpoints behind them.

| ID | Module | Feature | Route | Roles | Backend/API | Priority | Status |
|---|---|---|---|---|---|---|---|
| F001 | Public site | Home page | / | All | catalogue | High | PASS |
| F002 | Hotels | Hotel listing + dated search form | /hotels | All | GET /hotels, /search | Critical | PASS |
| F003 | Hotels | Hotel detail, live room offers, reserve | /hotels/[slug] | All | GET /hotels/:slug, /search/hotels/:slug | Critical | PASS |
| F004 | Hotel booking | Checkout form, hold countdown, validation, confirm | /booking/checkout | All | POST /bookings/holds, POST /bookings | Critical | PASS |
| F005 | Hotel booking | Confirmation page | /booking/confirmation/[ref] | All | GET /bookings/:ref | Critical | PASS |
| F006 | Hotel booking | Find my booking (reference + email) | /booking/manage | Guest | GET /bookings/:ref | High | PASS |
| F007 | Hotel booking | Manage: view, cancel with quote | /booking/manage/[ref] | Guest | cancellation-quote, cancel | Critical | PASS |
| F008 | Tours | Tour listing | /tours | All | GET /tours | High | PASS |
| F009 | Tours | Tour detail (B2C) + departures | /tours/[slug] | All | GET /tours/:slug, /search/tours/:slug | High | PASS |
| F010 | Tours | Tour checkout (UI) | /tours/checkout | All | POST /tours/bookings | High | NOT TESTED |
| F011 | Packages | Package listing | /packages | All | GET /packages | High | PASS |
| F012 | Packages | Package detail + quote | /packages/[slug] | All | GET /packages/:slug/quote | High | PASS |
| F013 | Packages | Package checkout (UI) | /packages/checkout | All | POST /orders | High | NOT TESTED |
| F014 | Transfers | Transfer landing + search widget | /transfers | All | GET /transfers/points | High | PASS |
| F015 | Transfers | Results, filters, vehicle cards | /transfers/search | All | GET /transfers/quotes | Critical | PASS |
| F016 | Transfers | Vehicle detail with journey | /transfers/[slug] | All | GET /transfers/vehicles/:slug | High | PASS |
| F017 | Transfers | Passenger details form, validation, confirm | /transfers/booking | All | POST /transfers/bookings | Critical | PASS |
| F018 | Transfers | Transfer confirmation | /transfers/confirmation/[ref] | All | GET /transfers/bookings/:ref | Critical | PASS |
| F019 | Transfers | Route landing page | /transfers/routes/[slug] | All | GET /transfers/routes/:slug | Medium | NOT TESTED |
| F020 | Transfers | Passenger rates the driver (emailed link) | /transfers/rate/[token] | Guest | POST /transfers/ratings | Medium | NOT TESTED |
| F021 | Public site | Experiences (page returns notFound by design) | /experiences, /experiences/[slug] | All | - | Low | INFO |
| F022 | Public site | Destinations (page returns notFound by design) | /destinations, /destinations/[slug] | All | GET /destinations | Low | INFO |
| F023 | Public site | Static pages | /about, /contact, /privacy, /terms, /cookies | All | - | Low | PASS |
| F024 | Auth | Password reset request + reset form | /forgot-password, /reset-password/[token] | All | POST /auth/password/forgot, /reset/:token | High | PASS |
| F025 | Auth | Account activation (set password) | /activate/[token] | Invited users | GET/POST /auth/activation/:token | High | PASS |
| F026 | Partners | Partner registration wizard (UI) | /partners/register/[token] | Invited partner | GET/POST /invitations/:token | High | NOT TESTED |
| F027 | i18n | Localised routes incl. RTL Hebrew | /[locale]/* (ka, ru, he RTL) | All | locale param | High | FAIL |
| F028 | Auth | Staff sign-in | /admin/sign-in | Staff | POST /auth/login | Critical | PASS |
| F029 | Auth | Partner sign-in | /portal/sign-in | Partners | POST /auth/login | Critical | PASS |
| F030 | Auth | Driver sign-in | /driver/sign-in | Drivers | POST /auth/login | High | PASS |
| F031 | Admin | Dashboard, badges, summary | /admin (dashboard) | Staff | GET /admin/badges, /admin/bookings/summary | High | PASS |
| F032 | Admin bookings | Hotel bookings register, detail, cancel, requests | /admin/bookings, /admin/bookings/[id] | bookings.read/cancel | GET /admin/bookings*, POST cancel | Critical | PASS |
| F033 | Admin transfers | Transfer bookings register + detail | /admin/transfers/bookings[/ref] | bookings.read | GET /admin/transfers/bookings* | High | PASS |
| F034 | Admin tours | Tour bookings register, confirm/decline requests | /admin/tours/bookings[/ref] | bookings.write | GET/POST /admin/tours/bookings* | High | PASS |
| F035 | Admin orders | Orders register, on-request queue, item actions | /admin/orders[/ref] | bookings.write | /admin/orders* | High | PASS |
| F036 | Dispatch | Legs board, candidates, assign, status | /admin/transfers/dispatch | dispatch.* | /admin/transfers/dispatch/* | Critical | PASS |
| F037 | Dispatch | Schedule view, ratings moderation | /admin/transfers/schedule, /ratings | dispatch.read | dispatch/schedule, dispatch/ratings | Medium | PASS |
| F038 | Fleet | Fleet cars CRUD, images, documents | /admin/transfers/fleet[/id|new] | dispatch.write | /admin/transfers/fleet/* | High | PASS |
| F039 | Fleet | Drivers CRUD, verify, account, documents | /admin/transfers/drivers[/id|new] | dispatch.write | /admin/transfers/drivers/* | High | PASS |
| F040 | Transfer catalogue | Routes, points, vehicle classes, extras CRUD + bulk prices | /admin/transfers/routes|points|vehicles|extras | catalogue.write | /admin/transfers/* | High | PASS |
| F041 | Reference data | Destinations CRUD, translations, place pin | /admin/destinations[/id|new] | catalogue.write | /admin/destinations/* | Medium | PASS |
| F042 | Hotels admin | Hotel register, details, rooms, calendar, images, location, kosher, publish | /admin/hotels[/slug/*|new] | catalogue.write, pricing.write | /admin/hotels/* | Critical | PASS |
| F043 | Tours admin | Tour register, options, seasons, departures, images, translations, publish | /admin/tours[/slug/*|new] | tours.write | /admin/tours/* | High | PASS |
| F044 | Packages admin | Package templates, components, kosher profile, preview quote | /admin/packages[/slug/*|new] | catalogue.write | /admin/packages/* | High | PASS |
| F045 | Services admin | Services register, publish, bookings | /admin/services[/id] | catalogue.write | /admin/services/* | Medium | FAIL |
| F046 | Partners admin | Partner lifecycle: invite, approve (contract gate), suspend, block, terminate, terms, product access, financial | /admin/partners[/id|new|applications] | partners.* | /admin/partners/* | Critical | PASS |
| F047 | Finance | Finance overview, payments-due panel | /admin/finance (overview) | finance.*.read | /admin/finance/due, reports/summary | High | PASS |
| F048 | Finance | Supplier payables, instalments, pay, override/waive via approval | /admin/finance/payables[/id] | finance.payables.read, payments.write | /admin/finance/payables* | Critical | PASS |
| F049 | Finance | Receivables, due date, waive via approval, notes | /admin/finance/receivables[/id] | finance.receivables.read | /admin/finance/receivables* | Critical | PASS |
| F050 | Finance | Record payments, allocations, idempotency, refunds | /admin/finance/payments[/id] | finance.payments.write | POST /admin/finance/payments | Critical | PASS |
| F051 | Finance | Maker-checker approvals (refund, override, waive) | /admin/finance/approvals[/id] | finance.*.approve | /admin/approvals/* | Critical | PASS |
| F052 | Finance | Cancellation penalties register | /admin/finance/penalties | finance.receivables.read | /admin/finance/penalties | Medium | PASS |
| F053 | Finance | Summary, margin, ageing, commission reports + CSV export | /admin/finance/reports | finance.reports.read, export | /admin/finance/reports/* | High | PASS |
| F054 | Finance | Supplier payment terms editor | /admin/finance/terms/[kind]/[id] | finance.terms.write | /admin/finance/terms/:kind/:id | Medium | PASS |
| F055 | Finance | Credit limit BLOCK/WARN enforcement at booking | Partner credit limits | partners.credit.write | /admin/finance/partners/:id/credit | Critical | PASS |
| F056 | Staff | Invite staff, roles, overrides, deactivate, sessions | /admin/users[/id] | users.staff.manage | /admin/users/* | Critical | PASS |
| F057 | Staff | Role editor (capabilities as data) | /admin/roles[/key|new] | roles.manage | /admin/roles/* | High | PASS |
| F058 | Audit | Audit log browser + filters | /admin/audit | audit.read | /admin/audit | High | FAIL |
| F059 | Notifications | Staff notifications, mark read | /admin/notifications | notifications.read | /admin/notifications/* | Medium | PASS |
| F060 | Help | Help centre articles | /admin/help/* | Staff | - | Low | PASS |
| F061 | Admin | Sidebar by capability, account menu, sign-out | Admin shell | Staff | POST /auth/logout | High | PASS |
| F062 | Portal | Status panel, terms acceptance gate | /portal (status) + /portal/terms | Partners | GET/POST /partner/terms | Critical | PASS |
| F063 | Portal | Partner dashboard + stats | /portal/dashboard | partner.bookings.read | GET /partner/dashboard | High | PASS |
| F064 | Portal | Own bookings (hotel/transfer/tour/orders), detail, cancel | /portal/bookings[/ref] | partner.bookings.* | /partner/bookings, /partner/orders… | Critical | PASS |
| F065 | Portal | B2B booking creation incl. preferred driver | Portal booking editors (hotel, tour, transfer) | partner.bookings.write | POST /bookings, /tours/bookings, /transfers/bookings, /partner/drivers/available | Critical | PASS |
| F066 | Portal | Statement, credit, commission | /portal/finance | partner.statement.read | /partner/finance/* | High | PASS |
| F067 | Portal | Team members, invitations, roles (capability subset) | /portal/team | partner.team.manage | /partner/team/* | High | PASS |
| F068 | Portal | Company profile, bank details, account | /portal/settings | partner.profile.write, financial.* | PATCH /partner/profile, /partner/financial | High | PASS |
| F069 | Portal | Partner notifications | /portal/notifications | notifications.read | /partner/notifications/* | Medium | FAIL |
| F070 | Portal | Driver public profile + reviews | /portal/drivers/[id] | Partners | GET /partner/drivers/:id | Low | NOT TESTED |
| F071 | Portal | Own hotels, room types, inventory + rates editing | Supplier extranet (hotel owner) | PARTNER_OWNER/ADMIN | /partner/hotels/* | Critical | PASS |
| F072 | Driver panel | Jobs, accept/decline, status milestones | /driver (today/upcoming/history) | DRIVER | /driver/assignments/* | Critical | PASS |
| F073 | Driver panel | Own profile edit (phone, languages, bio) | /driver/me | DRIVER | PATCH /driver/me | Medium | PASS |
| F074 | Driver panel | Driver notifications | /driver/notifications | DRIVER | /driver/notifications | Low | PASS |

Rows marked NOT TESTED and why:

| ID | Feature | Reason |
|---|---|---|
| F010 | Tour checkout UI | Tour booking was exercised through the API as an agency (hold → book → replay → cancel, U7–U18); the B2C `/tours/checkout` form itself was not driven in the browser for lack of time |
| F013 | Package checkout UI | Same: package quote → order → cancel was proven through the API (P1–P16); the UI form was not driven |
| F019 | Transfer route landing page | Not linked from the pages swept; the API behind it (`GET /transfers/routes/:slug`) passed in newman |
| F020 | Passenger rating link | Needs a completed leg and the emailed token; dispatch status moves beyond ACCEPTED are correctly refused this far ahead of pick-up (T29), so no leg could be completed inside the audit window |
| F026 | Partner registration wizard UI | The same flow was executed through its API (`POST /invitations/:token/accept`, W1–W18); the multi-step wizard UI was not driven |
| F070 | Driver public profile in the portal | No requested-driver booking existed for the demo agency |

---

## 5. Test results by group

| Group | Checks | Pass | Fail | Info | Not tested | Blocked |
|---|---|---|---|---|---|---|
| Auth & sessions (A*) | 25 | 23 | 0 | 2 | 0 | 0 |
| Page sweep, all roles (SW-*) | 182 | 173 | 6 | 3 | 0 | 0 |
| Hotel booking API + DB (H*) | 34 | 33 | 0 | 1 | 0 | 0 |
| Transfer API + dispatch + driver (T*) | 40 | 39 | 1 | 0 | 0 | 0 |
| Terms gate (G*) | 8 | 7 | 0 | 1 | 0 | 0 |
| Tours (U*) | 19 | 15 | 1 | 3 | 0 | 0 |
| Packages / orders (P*) | 17 | 15 | 1 | 1 | 0 | 0 |
| Finance: payments, approvals, credit (F*) | 46 | 40 | 0 | 6 | 0 | 0 |
| RBAC / IDOR (R*) | 33 | 32 | 1 | 0 | 0 | 0 |
| Input hardening & headers (S*) | 14 | 14 | 0 | 0 | 0 | 0 |
| Partner lifecycle, rates, publish, notifications (W*) | 56 | 54 | 1 | 1 | 0 | 0 |
| Pagination, filters, catalogue rules (Q*) | 38 | 35 | 1 | 2 | 0 | 0 |
| UI: hotel journey (UH*) | 17 | 17 | 0 | 0 | 0 | 0 |
| UI: transfer journey (UT*) | 13 | 12 | 0 | 1 | 0 | 0 |
| UI: admin CRUD, invite, activation, sign-out (UA*) | 13 | 11 | 0 | 1 | 1 | 0 |
| UI: partner portal (UP*) | 9 | 9 | 0 | 0 | 0 | 0 |
| UI: driver panel (UD*) | 3 | 3 | 0 | 0 | 0 | 0 |
| Responsive (RV/RM/RS/RT/RA/RP) | 82 | 82 | 0 | 0 | 0 | 0 |
| Performance (PF/PA) | 22 | 21 | 1 | 0 | 0 | 0 |
| **Total** | **672** | **636** | **13** | **22** | **1** | **0** |

Group notes:

- **Page sweep**: 178 loads. The noise filter removes three environment-only signals that appear on nearly every page: the `/_vercel/speed-insights/script.js` 404 (only exists on Vercel), the anonymous `GET /api/auth/me` 401 the client issues on every public page, and `_next/image` 404s for objects missing from the **dev** R2 bucket. The remaining failures are real and listed as bugs.
- **Hotel API**: H1–H29 cover arithmetic across every offer, token tampering, 7-way concurrent holds, strict schema, idempotent replay, spent-hold reuse, guest/partner/staff read authorisation, paperwork-only amendments, cancellation quote, double cancel, inventory restoration, DB rows (booking, 3 night rows, payable, receivable, penalty) and outbox topics.
- **Transfers**: T1–T35 cover point search, quote arithmetic including per-seat shared classes and extras, SAME_POINT/TOO_SOON/404/RETURN_BEFORE_OUTBOUND, guest booking, dispatch candidates/assign/SCHEDULE_CONFLICT, driver accept/TOO_EARLY/decline, passenger view with initial-only surname and no phone, dispatcher money hiding and cancel refusal.
- **Finance**: partial payment, replay with the same key (no double cash), same key different amount → 409, OLDEST_DUE allocation, NOT_SETTLEABLE on a PAID item, over-allocation and currency mismatch 422s, refund needs approval (even for the super admin), self-approval 403, approval executes the refund in the same transaction, waive needs approval, notes allowed, CSV export audited, commission reports, credit limit BLOCK (422, no rows written) and WARN (booking goes through, `PARTNER_CREDIT_WARNING` audited), partner statement without supplier data, in-app payment notifications.
- **UI journeys**: every step verified against the API and the database, including that the displayed totals equal the API totals, that confirmation pages survive reload, that `<img onerror>` / `<script>` payloads in guest text render escaped in guest and admin views, and that double submits create one record.

The 13 failing checks map to the bugs in §6 as follows: U2/R21 → BUG-001; PA-burst → BUG-002; P7 → BUG-003; SW-PO-*/SW-PF-* `/portal/notifications` → BUG-004; SW-PUB `/ka/tours*` → BUG-005; T34b → BUG-006; W40 → BUG-007; Q30 → BUG-008.

---

## 6. Detailed bug reports

### BUG-001 — Dated tour search returns 500 (integer overflow in candidate SQL)

**Severity:** High · **Module:** Tours / public search · **Location:** `GET /api/search/tours?date=YYYY-MM-DD` → `services/tour/search.service.js:270` → `services/tour/candidate.service.js` (sell-price CASE expression)

**Steps to reproduce:**
1. `curl "http://localhost:5000/api/search/tours?date=2026-11-20&adults=2"`
2. Observe HTTP 500 `{"error":{"message":"Internal server error"}}` (with a Prisma stack in development).

**Expected:** 200 with the tours that have a bookable departure that day.
**Actual:** 500. API log: `Raw query failed. Code: 22003. Message: integer out of range` at `searchTours`. Reproduced 7 times (every call), by anonymous, partner and staff viewers; also the only 5xx in the whole audit and the one failing request in the Postman folder 04b.

**Root cause (confirmed):** the raw SQL computes `round(tier.adult_net_cents * (10000 + ${markupBps}::int) / 10000.0)` and the same for `group_net_cents`; both operands are `integer`, so the product is evaluated in int4 and overflows above 2,147,483,647, i.e. whenever a tier's net exceeds ~186,000 cents at a 11,500 bps multiplier. The dev database has seven editorial tours above that (`tusheti-highland-crossing` group net 1,150,200 cents, `svaneti-tower-country` 955,800, `chaukhi-juta-crossing` 712,800, `gergeti-glacier-trek` 558,900, `kakheti-wine-route` 340,200, `vardzia-cave-city` 307,800, `imereti-canyons-and-caves` 283,500). Because one bad row fails the whole statement, the entire dated search is down.

**Affected:** public `/tours` page when a date is chosen (server-rendered via `searchTours`), partner portal tour search, `/api/search/tours` consumers. `GET /search/tours/:slug` (per-tour availability) is unaffected (U3–U18 pass).

**Recommended fix:** widen the arithmetic in `candidate.service.js` — `tier.adult_net_cents::bigint * (10000 + markup)` (or `::numeric`) in all four branches, and cast the final `sell_cents` to bigint before `::int` only if it is guaranteed to fit. Add a CHECK or validation cap on tier nets if int4 is intended.

**Regression test:** a `tours.money`/`search` test that creates a tier with `groupNetCents: 1_150_200`, calls `GET /api/search/tours?date=` and expects 200 with the departure priced.

**Status:** Open.

### BUG-002 — Dated-search rate limit is shared by every visitor behind the Next.js server

**Severity:** High (availability under modest load) · **Module:** API rate limiting / client data fetching · **Location:** `server/middleware/rateLimit.js:342` (`searchLimiter`, `limit: config.isTest ? 10_000 : 30`, key `req.ip`); `client/lib/api/search.ts:46,49` and `client/lib/api/tours.ts:81,94` (`serverFetch`), `client/lib/api/client.ts:233` (forwards cookies only).

**Steps to reproduce:**
1. Start the API with `RATE_LIMIT_GLOBAL=100000` (global limiter out of the way).
2. Fire 30 concurrent `GET /api/search?checkIn=2026-11-10&checkOut=2026-11-13&adults=2` from one address.
3. Observe at least one `429 Too Many Requests` (check PA-burst: `statuses=200,429`). The same limiter guards `/api/search/hotels/:slug` and `/api/search/offers/quote`.

**Expected:** per-visitor throttling.
**Actual:** throttling per *API client address*. The hotel listing, hotel detail offers and tour search are rendered by the Next.js server, which calls the API from its own address without an `X-Forwarded-For`. On a single-egress host (Render) every visitor's dated search counts against one 30/min bucket; the 31st search in a minute renders an error page for everyone. The global 100/min limiter has the same shape but is at least configurable. The limit is not env-configurable, so it cannot be relaxed in production without a code change.

**Root cause (confirmed by code reading and the burst test):** key = `req.ip`; no visitor IP propagation from the client's server-side fetch; hard-coded limit.

**Recommended fix:** (a) have `serverFetch` forward the visitor's address (`x-forwarded-for` from `headers()`) and let the API key its limiters on that header **only** for requests that carry a shared secret or come from the trusted client host; or (b) exempt the Next server's address from `searchLimiter`/`globalLimiter` and rely on the client's own per-visitor limiting; and in all cases make the search limit an env knob (`RATE_LIMIT_SEARCH`). Set `TRUST_PROXY=1` on Render (the config default is `false`).

**Regression test:** supertest with 31 dated searches carrying distinct forwarded addresses → all 200; 31 from one address → the last is 429.

**Status:** Open.

### BUG-003 — Order replay with the same Idempotency-Key answers 409 UNAVAILABLE instead of the original order

**Severity:** Medium (correctness of retries; a client that times out and retries believes the order failed while it exists) · **Module:** Orders · **Location:** `services/order/order.service.js:462–477` (`confirmOrder` calls `prepareOrder(input, actor)` at line 463 before `prisma.order.findUnique({ where: { idempotencyKey } })` at line 466)

**Steps to reproduce (P6–P7):**
1. As `agency.agent@demo-b2b…`, quote `GET /api/packages/kakheti-wine-weekend/quote?startDate=2026-11-19&adults=2`, `POST /api/orders/holds`, then `POST /api/orders` with `Idempotency-Key: <uuid>` → 201 `ORD-000567`.
2. Repeat the identical `POST /api/orders` with the same key.

**Expected:** 200 with the same order (API.md: "A replay is a read of the original record").
**Actual:** `409 {"reason":"UNAVAILABLE","slots":[{"slotIndex":0,"label":"Two nights in the vineyards",…}]}` because the hold tokens were already spent by the first call and `prepareOrder` fails before the replay lookup runs. Hotel, transfer and tour bookings replay correctly (H11, T14, U10), so this is specific to orders.

**Recommended fix:** look the key up first (as the booking services do), return the existing order when the caller may read it, and only then prepare.

**Regression test:** `orders.booking.test.js`: book, replay with the same key after the holds are spent → 200, same reference, no second order.

**Status:** Open.

### BUG-004 — Partner notifications page crashes (500) before the terms are accepted

**Severity:** Medium · **Module:** Partner portal · **Location:** `client/app/[locale]/(portal)/portal/notifications/page.tsx` (`listNotifications("partner", …)` is awaited with no handling of the terms gate; every other portal page redirects to `/portal/terms`)

**Steps to reproduce:**
1. Sign in as a partner whose company has not accepted the current terms (any demo partner before this audit accepted them; `GET /api/partner/terms` → `outdated: true`).
2. Open `/portal/notifications`.

**Expected:** redirect to `/portal/terms` like `/portal/dashboard`, `/portal/bookings` etc.
**Actual:** HTTP 500, "Portal error", React #441 in the console; client log: `ApiError: The platform terms must be accepted before continuing`. Reproduced for four partner roles (sweep rows SW-PO-agency, SW-PO-hotel, SW-PO-transfer, SW-PF-agencyfin; screenshot `docs/qa/evidence/SW-PO-agency_portal_notifications.png`). After acceptance the page works and "Mark all as read" sets the DB unread count to 0 (UP-notif).

**Recommended fix:** apply the same terms/approval gate the other portal pages use (redirect when `TERMS_OUTDATED`), or catch the 403 and render the gate.

**Regression test:** Playwright: partner with outdated terms → `/portal/notifications` → URL is `/portal/terms`, status 200.

**Status:** Open (the file is uncommitted work in progress on this branch).

### BUG-005 — Georgian tour pages hydrate with React error #418

**Severity:** Medium (visible console error, React re-renders the tree client-side; content still displays) · **Module:** i18n · **Location:** `/ka/tours`, `/ka/tours/[slug]` (text mismatch between server and client rendering)

**Steps to reproduce:** open `http://localhost:3000/ka/tours` in Edge/Chrome and watch the console.
**Expected:** no hydration error.
**Actual:** `Minified React error #418 … args[]=text` on both pages (sweep rows SW-PUB `/ka/tours`, `/ka/tours/kakheti-wine-route`). `/ka`, `/ru`, `/he`, `/he/hotels` are clean. Earlier notes attribute this to Georgian `Intl` output differing between Node and Chromium (no `ka` locale data in Chromium).

**Recommended fix:** format the affected numbers/dates on the server only (pass preformatted strings), or pin a formatter that does not depend on browser ICU, or `suppressHydrationWarning` on that specific text node after confirming the value is cosmetic.

**Regression test:** Playwright loads `/ka/tours` and asserts no `pageerror` events.

**Status:** Open (known).

### BUG-006 — Transfer cancellation quote uses `refundableCents`; hotels, tours, the docs and the Postman tests use `refundCents`

**Severity:** Low (contract inconsistency; the Postman assertion "Charge plus refund equals the fare" fails with NaN) · **Location:** `GET /api/transfers/bookings/:reference/cancellation-quote` vs `GET /api/bookings/:reference/cancellation-quote`

**Evidence:** T34b — transfer body keys `refundableCents,chargeCents,currency,freeUntil,asAt`; hotel body uses `chargeCents`/`refundCents` (H23). API.md documents `refundCents` for orders and the collection expects it for transfers.

**Recommended fix:** rename to `refundCents` (keeping `refundableCents` as a deprecated alias for one release) and update the client type.

**Status:** Open.

### BUG-007 — Service sell price below net is refused with a misleading 409 "conflicts with current availability"

**Severity:** Low · **Location:** `PATCH /api/admin/services/:serviceId` with `{ sellCents }` lower than the stored `netCents` (W40). `POST` validates the same rule as 400 ("sell covers net") because both values are present; the partial update schema cannot evaluate it, and the service layer throws a generic ConflictError.

**Recommended fix:** validate sell ≥ net in the service with a 422 `SELL_BELOW_NET` carrying both figures.

**Status:** Open.

### BUG-008 — Query strings and some bodies are parsed leniently

**Severity:** Low · **Locations:** `GET /api/admin/audit?search=…` ignores the unknown `search` parameter and returns the whole log (49,722 rows paginated) — the real parameter is `q` (Q29/Q30); `PATCH /api/partner/profile` strips unknown fields such as `status` and `commissionRateBps` (no escalation: DB unchanged, verified) but still answers 200 and writes a `PARTNER_UPDATED` audit row "updated their company profile" when nothing changed.

**Recommended fix:** `.strict()` on query schemas (400 on unknown keys) or at least on admin filters; skip the audit row when the diff is empty.

**Status:** Open.

### BUG-009 — Dependency advisories (npm audit, production dependencies)

**Severity:** Critical/High per the advisories · **Evidence:** `npm audit --omit=dev` on 2026-10-10.

| Package | Severity | Advisory |
|---|---|---|
| `next` 16.3.0 (client) | critical | Unauthenticated remote code execution (Windows-hosted servers) and a second unauthenticated RCE advisory; fixed in a later 16.3.x |
| `proxy-addr` 2.0.x (server, via express) | critical | IP spoofing via IPv4-mapped IPv6 trust subnet — directly relevant to `trust proxy` and every per-IP limiter |
| `nodemailer` ≤10.0.8 (server) | high | Process-global DNS cache reuses TLS `servername` across transports |
| `sharp` <0.35.5 (both) | high | librsvg / libheif vulnerabilities |
| `source-map-js` (client) | high | Event-loop DoS through indexed source-map section offsets |
| `fast-uri`, `ip-address` (server) | moderate | host normalisation / link-local SSRF checks |

**Recommended fix:** bump `next`, `express` (for `proxy-addr`), `nodemailer`, `sharp`; re-run `npm audit`.

**Status:** Open.

### BUG-010 — `/_vercel/speed-insights/script.js` is requested on every page

**Severity:** Low · **Evidence:** one 404 on every page load of every role (probe-404). Harmless on Vercel, a guaranteed console error and wasted request on any other host (the API is on Render; a self-hosted client would show this to every visitor).

**Recommended fix:** render `<SpeedInsights />` only when `process.env.VERCEL` is set.

**Status:** Open.

### BUG-011 — Hotel and room images 404 from the dev R2 bucket (environment)

**Severity:** Low in this environment; must be checked against the production bucket · **Evidence:** 8 page loads with `_next/image?url=https://pub-….r2.dev/hotel-image/…/card.webp` → 404 and matching `upstream image response failed` lines in the client log; hotel cards and galleries render as beige placeholders with alt text (screenshot `UH4-checkout.png` shows the room thumbnail area). The database keys exist; the objects do not.

**Recommended fix:** verify the production bucket holds every key referenced by `file_assets`; add a startup/cron check (`scripts/check-media-storage.js` exists) to the deployment runbook.

**Status:** Open (environment).

### Test-infrastructure findings (not product defects, but they shaped this audit)

- **TI-1 The server suite leaks ACTIVE fixtures into the shared dev database.** 19 of 29 tours, 13 of 17 packages, several vehicle classes (`sedan-klo-…`, `vehicle-avc-…`), destinations (`dest-…`) and services are test rows left ACTIVE and public: they appear first in transfer results and in the admin registers, and `/images/tours/kazbegi.jpg` / `test.jpg` 404 on the admin tours and packages pages come from them. The audit log holds 49,722 rows and the demo super admin had 408 unread notifications from test runs. Tests should create fixtures as DRAFT or under a dedicated schema, and tear them down.
- **TI-2 `admin.summaries.test.js` is order-dependent** ("counts every transfer booking": 78 ≠ 77 in the full run, passes alone) because other files create bookings concurrently against the same database.
- **TI-3 The Postman collection lags the code.** 40 of its 41 failing assertions come from behaviour that changed on this branch (contract gate before approval → 400 `CONTRACT_MISSING`; refunds/adjustments now 403 `APPROVAL_REQUIRED` before field validation; `refundCents` naming) or from environment assumptions (folder 05 expects an *unapproved* partner, folder 07 needs `kosherHotelId` and an admin session — it ran with an empty id and the partner cookie). Only the tour-search 500 is a product failure.

---

## 7. Security findings

**Confirmed working (tested):**

- Authentication: wrong password and unknown email give the identical 401 body (no enumeration); tampered or expired session tokens → 401; logout and super-admin revocation invalidate sessions server-side immediately; suspension of a partner ends its live sessions; sessions are DB rows with a 30-day expiry (policy question, not a defect); weak/personal passwords refused at registration and change.
- CSRF: state-changing requests from a foreign `Origin` → 403; same-site GETs without Origin still work; CORS does not echo foreign origins.
- Headers: CSP, HSTS, `nosniff`, `frame-ancestors`, no `X-Powered-By`; session cookie HttpOnly + SameSite (Secure must be confirmed over HTTPS in production).
- Authorization: 33 role/route checks matched the capability table (dispatcher cannot cancel or see money, management cannot write or read bank details, admin cannot record payments or list staff, tour operator cannot touch hotel prices, finance operator cannot write terms or export, partner agent cannot see the statement or team, suspended partner refused, pending partner refused); IDOR probes across suppliers (hotel, room type, inventory write), partners (bookings, orders), drivers (assignments) all 404; drivers cannot reach `/admin/*`; partner admins cannot grant roles with capabilities they lack.
- Money: no request accepts an amount; prices travel as signed tokens and tampered tokens are refused; maker-checker on refunds/write-offs including for the super admin; credit limits enforced inside the booking transaction.
- Input: strict body schemas (unknown keys → 400), 413 at 100 kB, malformed JSON → clean 400, SQL-looking search strings handled as data, XSS payloads stored verbatim and rendered escaped in guest, admin and transfer confirmation views, uploads sniffed by magic bytes (text labelled PNG → 4xx), dispatcher cannot upload outside the fleet categories, Idempotency-Key length enforced.
- Rate limiting (default-config instance): login 10/min → 429 on the 11th, forgot-password 5/min, global 100/min with `RateLimit-*` headers.
- Error responses: stack traces are included only when `NODE_ENV=development` (verified in `middleware/errors.js`); production envelopes are `{ error: { message, details } }`.

**Confirmed risks:** BUG-002 (shared limiter bucket; also a trivial way for one abusive visitor to deny dated search to everyone), BUG-009 (advisories, in particular `proxy-addr` because the deployment relies on `trust proxy`).

**Suspected / not verified:** the `Secure` cookie attribute in production; the real R2 bucket's object ACLs; the `TRUST_PROXY` value on Render (defaults to `false`, which would make every per-IP limit count the proxy as one client — the config comment says so).

---

## 8. Performance findings (measured)

**Lighthouse 12 (Edge, headless, local production build; mobile preset unless stated):**

| Page | Perf | A11y | Best practices | SEO | FCP | LCP | TBT | CLS | Weight |
|---|---|---|---|---|---|---|---|---|---|
| `/` mobile | 87 | 86 | 96 | 100 | 1.06 s | 4.03 s | 19 ms | 0 | 910 KB |
| `/` desktop | 98 | 86 | 96 | 100 | 0.29 s | 1.13 s | 0 | 0 | 1,190 KB |
| `/hotels` mobile | 81 | 88 | 96 | 100 | 1.06 s | 4.21 s | 249 ms | 0 | 424 KB |
| `/hotels/vera-house-tbilisi` mobile | 88 | 86 | 96 | 100 | 1.06 s | 3.84 s | 73 ms | 0 | 607 KB |
| `/tours` mobile | 92 | 96 | 96 | 100 | 0.91 s | 3.43 s | 36 ms | 0 | 772 KB |
| `/transfers/search?…` mobile | 88 | 92 | 96 | 63* | 1.06 s | 3.77 s | 94 ms | 0 | 391 KB |
| `/admin/sign-in` mobile | 92 | 95 | 96 | 63* | 0.91 s | 3.31 s | 69 ms | 0 | 358 KB |

\* SEO 63 on the search results and sign-in pages is the expected `noindex`.

Accessibility audits that fail: `color-contrast` on every page; `aria-prohibited-attr`, `list`/`listitem` on the home and hotel pages; `heading-order` and `select-name` on the hotel listing; `definition-list`/`dlitem` on the hotel detail. Mobile LCP of 3.3–4.2 s under Lighthouse's throttling is the one metric that misses the 2.5 s target; the unthrottled browser measured LCP at 72–132 ms with CLS 0, so the gap is image weight and render-blocking on a slow network rather than server time.

**Browser timings (Playwright, Edge, unthrottled, laptop viewport):** TTFB 7–32 ms, DOMContentLoaded 27–131 ms, load 80–188 ms, 43–49 requests per public page, 207–223 KB of JavaScript, 1 API call from the browser per page (everything else is server-rendered). Admin pages: TTFB 11–15 ms, client-side navigation dashboard → bookings 51 ms.

**API latency (10 sequential requests each, local):**

| Endpoint | p50 ms | p95 ms | max ms |
|---|---|---|---|
| GET /search (dated, 3 nights) | 12 | 19 | 19 |
| GET /hotels | 5 | 7 | 7 |
| GET /transfers/quotes | 7 | 9 | 9 |
| GET /packages/:slug/quote | 27 | 33 | 33 |
| GET /admin/bookings | 6 | 6 | 6 |
| GET /admin/finance/payables | 6 | 8 | 8 |
| GET /admin/finance/reports/summary | 4 | 5 | 5 |
| GET /admin/audit | 6 | 7 | 7 |
| GET /admin/transfers/dispatch/legs | 7 | 10 | 10 |

**Concurrency:** 30 concurrent transfer quotes all 200 in 108 ms wall time; 30 concurrent dated hotel searches completed in 106 ms but included 429s from the search limiter (BUG-002).

**Server-side load behaviour was not measured** beyond these bursts (no authorised load-test environment); the perf database noted in earlier work was not used.

---

## 9. Responsive and cross-browser

Viewports 1920×1080, 1366×768, 768×1024, 390×844, 375×667 across 11 public pages, 5 admin pages and 3 portal pages: **no horizontal overflow on any page at any width** (82 checks). The public menu opens and navigates at 768/390/375; the admin drawer ("Open navigation") opens at 390 and navigates; the hotel search form submits at every width with its button inside the viewport; tap targets on the listing are all ≥ 24 px; the bookings table scrolls inside its own container on mobile. Only Chromium (Edge) was exercised; Firefox and WebKit are not installed on this machine and were not tested.

---

## 10. Automated tests executed

| Suite | Command | Result |
|---|---|---|
| Server unit/integration | `npm test` in `server/` (85 files, node:test + supertest) | 1,138 tests: 1,137 pass, 1 fail (`admin.summaries` cross-file race; passes alone), 67 s |
| Client unit | `npm test` in `client/` | 22 / 22 pass |
| Client lint / build | `npm run lint`, `npx next build` | 0 errors, 5 warnings; build clean (type check included) |
| Postman via newman | 709-request collection, `--delay-request 60` | 766 requests, 4,074 assertions, 41 failed (see TI-3), 2 m 19 s |
| QA harness (new, `qa/e2e/`) | scripts 01–09 | 672 checks (see §5) |
| Lighthouse | `qa/e2e/lighthouse.sh` | 7 runs (table in §8) |

Newman per folder is in [docs/qa/NEWMAN_SUMMARY_2026-10-10.md](docs/qa/NEWMAN_SUMMARY_2026-10-10.md); 251 of the 402 mounted endpoints were hit by newman alone (path match), the harness and the server suite cover the rest of the critical paths; the per-endpoint list is in [docs/qa/ENDPOINT_COVERAGE_2026-10-10.md](docs/qa/ENDPOINT_COVERAGE_2026-10-10.md).

---

## 11. Recommended fixes, in priority order

1. **BUG-001** tour search overflow — cast to bigint/numeric in `candidate.service.js`; add the regression test. (Data integrity / core workflow.)
2. **BUG-002** search limiter — forward the visitor IP from `serverFetch` and key limiters on it (or exempt the client host), make the limit configurable, set `TRUST_PROXY=1` on Render. (Availability.)
3. **BUG-009** dependency bumps (`next`, `express`/`proxy-addr`, `nodemailer`, `sharp`). (Security.)
4. **BUG-003** order replay ordering in `confirmOrder`. (Retry correctness.)
5. **BUG-004** terms gate on `/portal/notifications`. (Portal crash.)
6. **BUG-005** Georgian hydration mismatch. (UX / console errors for `ka` users.)
7. **BUG-006/007/008** API contract tidy-ups (`refundCents`, service sell<net 422, strict query schemas, no-op audit rows).
8. **TI-1/TI-2/TI-3** test hygiene: fixture teardown or DRAFT fixtures, isolate the summaries test, refresh the Postman collection for the contract gate, approvals and `refundCents`, and give it `kosherHotelId` and an unapproved partner in the environment.
9. **BUG-010/011** environment guards (Speed Insights only on Vercel; media-bucket completeness check in the runbook).
10. Accessibility: colour contrast tokens, `aria-prohibited-attr`, list/dl semantics, heading order, label on the sort/select on `/hotels`.
11. Mobile LCP: compress/resize hero imagery (home 514 KB of images), preload the LCP image.
12. Product gap (not a defect): there is no payment service provider — bookings confirm as "PAY_NOW" with no card capture; finance records the money by hand. Known from earlier readiness work; it limits B2C go-live rather than this build's correctness.

---

## 12. Production readiness

**Classification at audit time (2026-10-10): NOT READY FOR PRODUCTION.**

Grounds: a public, core-catalogue endpoint returns 500 for the whole dated tour search (BUG-001); the dated hotel/tour search can be exhausted by 30 requests per minute site-wide under the real deployment topology (BUG-002); and the client ships a Next.js version with a critical RCE advisory (BUG-009). None of these is architectural — the evidence here (672 harness checks, 1,138 server tests, 4,074 collection assertions, full browser journeys for both booking products, finance, RBAC, dispatch and partner lifecycle) shows the core is correct and consistent.

**Classification after the fixes (2026-10-11): READY WITH MINOR ISSUES.** BUG-001 to BUG-010 are fixed and re-verified (§14): the three blockers are gone, `npm audit --omit=dev` reports 0 vulnerabilities in both apps, the server suite passes (1,139 of 1,141; the two remaining failures are the documented cross-file races and pass in isolation), the client build, type-check, lint and unit tests pass. What remains is BUG-011 (objects missing from the **dev** media bucket — confirm the production bucket), the accessibility and mobile-LCP items in §8, the test-hygiene notes TI-1–TI-3, and one deployment step: set `API_CLIENT_TOKEN` to the same value on Render and Vercel (and `TRUST_PROXY=1` on Render) so BUG-002's fix is active in production.

---

## 13. Limitations and what was not done

- Firefox and WebKit were not available; all browser work ran in Edge (Chromium).
- No load test beyond 30-request bursts; no production or staging environment was touched.
- Email delivery was logged (`MAIL_TRANSPORT=log`), so templates were rendered (116 emails of 7 kinds) but SMTP delivery was not exercised.
- Media uploads to R2 and contract PDF uploads were not performed (they would write to the dev bucket); validation paths were tested instead.
- Dispatch milestones beyond ACCEPTED (EN_ROUTE → COMPLETED), ratings and the completion sweeps need a pick-up inside the allowed window and were only checked for their refusals (`TOO_EARLY`).
- The six NOT TESTED inventory rows in §4.
- Residue in the dev database after cleanup: two deactivated `qa.invite.*@example.test` users, three `QA-*` payment records and their allocations, cancelled QA bookings (all CANCELLED), plus the fixture pollution that pre-dates this audit.

---

## 14. Fixes applied on 2026-10-11 and their verification

Each fix was verified three ways: the project's own suites, a regression test added next to the defect, and a live re-run of the exact audit check against the rebuilt application ([docs/qa/REVERIFY_2026-10-11.md](docs/qa/REVERIFY_2026-10-11.md), script `qa/e2e/10-reverify-fixes.mjs`).

| Bug | Change | Regression test | Live re-check |
|---|---|---|---|
| BUG-001 tour search 500 | `services/tour/candidate.service.js`: net cents cast to `bigint` before the basis-point multiplication (four branches) | `tours.money.test.js` — a tier with a 1,150,200-cent net prices in the dated search | FX-001: `GET /api/search/tours?date=` → 200, 5 tours priced; suspended partner 200 |
| BUG-002 site-wide search limit | `middleware/rateLimit.js`: `visitorKey` — when `API_CLIENT_TOKEN` is set and a request presents it in `x-client-token`, the limiters count the IP named in `x-visitor-address` (bare IP, constant-time token compare); applied to the global and search limiters. `RATE_LIMIT_SEARCH` is now configurable. Client `serverFetch` forwards the visitor's first `x-forwarded-for` hop (or `x-real-ip`) with the token. Documented in `.env.production.example`, `client/.env.local.example`, `render.yaml` (`sync: false`) and `docs/DEPLOYMENT.md` | `ratelimit.visitorKey.unit.test.js` (4 cases: trusted relay, wrong/missing/prefix token, non-IP header, IPv6 normalisation) | FX-002: 40 concurrent searches for 40 visitors all 200; one visitor capped at 30 (30×200, 10×429) |
| BUG-003 order replay | `services/order/order.service.js`: the idempotency key is derived and looked up before `prepareOrder` re-prices | `orders.booking.test.js` — replay with spent hold tokens → 200, same reference, no second claim | FX-003: create 201 `ORD-000608`, replay 200 same reference |
| BUG-004 portal notifications 500 | `portal/notifications/page.tsx`: the same terms/approval gate as the other portal pages (redirect to `/portal/terms` on `TERMS_OUTDATED`, to sign-in on 401) | — (page) | FX-004: partner with cleared terms → `/portal/terms`, status 200 |
| BUG-005 Georgian hydration | `lib/intl.ts`: for `ka*` locales the formatter is built on `en-GB` and Georgian month/weekday names, space grouping, comma decimal and the `₾` symbol are applied from fixed tables, so Node and Chromium agree; the six direct `new Intl.*` call sites now use the shared helper; `pluralForm` uses English rules for Georgian (same one/other categories) | `client/test/intl-georgian.test.ts` (money, dates, weekday+time, dateStyle/timeStyle, other locales untouched) | FX-005 + probe: `/ka/tours`, `/ka/tours/[slug]`, `/ka/hotels`, `/ka/hotels/[slug]?dates`, `/ka/packages/[slug]`, `/ka/transfers/search` all hydrate with no React errors |
| BUG-006 `refundableCents` | Transfer cancellation quote serves `refundCents`; `refundableCents` kept as a deprecated alias for one release; client type and API.md updated | `transfers.booking.test.js` asserts both fields | FX-006: `refundCents` present, alias equal, charge + refund = total |
| BUG-007 service sell < net 409 | `services/service/service.service.js`: a partial update is checked against the stored net → 422 `SELL_BELOW_NET` with both figures | `services.test.js` PATCH case | FX-007: 422 `SELL_BELOW_NET`, `netCents: 10000, sellCents: 5000` |
| BUG-008 lenient parsing | `auditQuerySchema` is `.strict()` (unknown filter → 400); `PATCH /partner/profile` writes and audits only the fields that actually change | `audit.test.js` (typo → 400, `q=` → 200); `partners.settings.test.js` (no-op PATCH adds no audit row) | FX-008: `?search=` 400, `?q=` 200; FX-008b: audit count unchanged, status still APPROVED |
| BUG-009 advisories | `next` 16.3.0 → 16.3.8 (+ `eslint-config-next`), `express` 5.2.1 → 5.3.0 (`proxy-addr` 2.0.8), `nodemailer` 9 → 10.1.0, `sharp` 0.35.5; transitive fixes via `npm audit fix` | `npm audit --omit=dev`: **0 vulnerabilities** in both apps; full server suite and `mailer.test.js` pass on nodemailer 10 | build, type-check, lint, unit tests green |
| BUG-010 Speed Insights 404 | `app/[locale]/layout.tsx` mounts `<SpeedInsights />` only when `process.env.VERCEL` is set | — | FX-010: no `/_vercel/speed-insights` request |
| BUG-011 dev-bucket images | Not a code defect; verify the production bucket (`scripts/check-media-storage.js`) before launch | — | — |

Suite results after the fixes: server 1,139 / 1,141 (the two failures, `admin.summaries` and `transfers.partnerChoice`, are the documented cross-file races and pass when run alone; running the suite while a live API drains the outbox adds a third kind of race — stop the API first); client unit 25 / 25; lint 0 errors; `next build` clean.

Deployment note: BUG-002's per-visitor counting is active only when `API_CLIENT_TOKEN` is set to the same value on the API (Render) and the web app (Vercel); without it the API behaves as before, with one shared bucket.
