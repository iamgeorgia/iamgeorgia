# End-to-end QA harness

Node scripts that drive the real application: the API over HTTP, the client in a real browser (Playwright, Edge channel),
and the database through `docker exec … psql` for persistence checks. They were written for the 2026-10-10 audit
(see `../../QA_REPORT.md`) and are kept so the audit can be repeated.

## Prerequisites

- Node 22+ (24 used), Docker Desktop with the `iamgeorgia-postgres` container up (`npm run db:up` in `server/`).
- `npm i -D playwright` somewhere on the resolution path (the scripts import `playwright`), and either Edge installed
  (`channel: 'msedge'`, default in `lib.mjs`) or `npx playwright install chromium` and change the channel.
- Demo accounts: `node --env-file=.env scripts/seed-b2b-demo.js` in `server/` (all logins use `Demo-Georgia-2026`);
  demo drivers come from `seed-fleet.js` (`*@demo.iamgeorgia.test` / `driver-demo-password`).
- API on :5000 started with raised limits and no outbound mail:
  `RATE_LIMIT_GLOBAL=100000 AUTH_LOGIN_LIMIT=1000 AUTH_LOGIN_IP_LIMIT=1000 AUTH_LOGIN_ACCOUNT_LIMIT=1000 MAIL_TRANSPORT=log node --env-file=.env server.js`
  (note: the dated-search limiter is hard-coded to 30/min and is not overridable — see QA_REPORT BUG-002).
- Client production build on :3000: `npx next build && npx next start -p 3000` in `client/`.

## Scripts

| Script | What it does |
|---|---|
| `01-auth.mjs` | Sign-in/out for admin, portal, driver through the UI; API auth, CSRF origin check, tampered tokens |
| `02-sweep.mjs` | Loads every panel page per role and every public page, follows first detail links, collects JS/HTTP errors → `sweep.json` |
| `03-hotel-transfer-api.mjs` | Hotel search → hold (concurrency) → book → amend → cancel with DB/outbox checks; transfer quote → book → dispatch → driver accept/decline → cancel |
| `04-tours-orders-finance-rbac.mjs` | Terms gate, tour booking as agency, package → order, payments/allocations/idempotency, approvals (maker-checker), credit limits, RBAC/IDOR matrix, input hardening |
| `04b-finance-recheck.mjs` | Re-checks with exact preconditions (PAID item, notifications, BLOCK limit) |
| `05-ui-flows.mjs` / `05b-transfer-ui.mjs` | Browser journeys: hotel checkout and cancel, transfer booking, admin destination CRUD, role editor, staff invite → activation → sign-in → deactivate, sign-out, portal and driver screens |
| `06-responsive-perf.mjs` | 5 viewports × public/admin/portal pages (overflow, mobile menus, tap targets), web timings, API latency and bursts |
| `07-workflows-api.mjs` | Partner invite → registration → contract gate → approve → suspend/reactivate/block; rate edit → public price; publish checklists; admin cancel; notifications; audit filters |
| `08-pagination-filters.mjs` | Pagination boundaries, filters, catalogue visibility rules, i18n fallbacks |
| `09-session-expiry.mjs` | Expired session, re-login, super-admin session revocation |
| `report-gen.mjs`, `inventory-gen.mjs`, `final-results.mjs`, `sweep-normalize.mjs` | Aggregate `results.jsonl` into the report tables |
| `lighthouse.sh` | Lighthouse 12 (via npx) for seven pages, mobile + desktop presets |

Every check appends one JSON line to `results.jsonl` (`id`, `feature`, `status`, `notes`). Statuses are PASS, FAIL,
INFO (recorded, not asserted), NOT TESTED and BLOCKED. Rerunning a script overwrites nothing; the aggregators take the
last result per check ID.

## Browser-automation notes

- Booking pages also contain the footer newsletter form: scope submit clicks with `form:has(#firstName)`.
- The public header is fixed: scroll a target to `block: 'center'` before clicking it.
- Admin sign-out is a `role=menuitem` inside the account menu; the account button is `button[aria-haspopup="menu"]`.
- `button[aria-haspopup="menu"]` also matches hidden desktop buttons at mobile widths; use `aria-label="Open menu"`
  (public) and `aria-label="Open navigation"` (admin).
- The server test suite leaves ACTIVE fixtures in the dev database (`tour-*`, `req-*`, `order-*`, `sedan-klo-*`,
  `dest-*` slugs). Filter them out when picking test data.
