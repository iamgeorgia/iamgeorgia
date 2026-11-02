# Flitt Payment Gateway Integration Plan (test mode first)

Status: **DRAFT for approval, 2026-11-03. Nothing is implemented.** Line numbers refer to the working tree at commit `010c169` (branch `feat/gudauri-ski-site`) and will drift.

**Progress** (branch `feat/flitt-payments`, from `main` 253037d):

| Phase | State | Notes |
|---|---|---|
| 0 — Foundations | **Built 2026-11-03** (uncommitted at time of writing) | `config.payments.flitt` + `assertPaymentsConfig`, `API_PUBLIC_URL`, `lib/integrations/flitt/{signature,parse,status,client}.js`, `test/support/flitt.stub.js`, live fixture `test/support/fixtures/flitt-live-exchange.json`, 51 unit tests, `scripts/flitt-smoke.js`, env examples, `render.yaml`, logger redaction. Smoke script created a real test order and polled its signed status. **Spike on the preview host (OQ1/OQ2/OQ4) not yet run: it needs this branch deployed to the preview API.** Observation: Flitt's `order_time` ran two hours ahead of UTC on 2026-11-02 (UTC+2), so it is treated as advisory and the ledger stamps `paidAt` from our clock. |
| 1 — Schema and domain services | **Built 2026-11-03** | Branch rebased onto `feat/b2b-phase-0-hardening` (the line the dev DB and the booking-management work live on; `main` is 9 commits behind it). Migrations `20261103100000_psp_enum_values` + `20261103100100_psp_payments` (PSP tables, policy owners/`productKind`/`unpaidCancelHours`/`cardOptional`, `paymentPolicyId` on tour options, packages, transfer providers, frozen rule on receivables). `lib/payments/{machines,policy,returnToken}.js`, `services/payments/{psp-payment,flitt-callback,psp-sweeper}.service.js`, `validation/payments.js`, ledger freezes the rule per product and per order (strictest wins), product payment templates seeded by `seedPolicyTemplates`, hotel policy lists exclude product templates, `PaymentRecord.externalPaymentId` written by the ledger. `test/payments.flow.test.js`: 26 scenarios (create, reuse, race, gateway down, approve → ledger, idempotent/stale/concurrent apply, late approval, mismatch, overpayment, decline + retry, expiry, abandoned create, callbacks valid/duplicate/forged/foreign merchant/IP/form/unknown order, poll convergence, outage catch-up, PAY_NOW freeze + auto-cancel, in-flight protection, PAY_AT_HOTEL default, gateway off). Finance/booking/order/cancellation/invoicing suites still green (171). Not yet mounted: no routes, no timer, no outbox handlers (Phase 2). |
| 2 — HTTP surface | **Built 2026-11-03** | Guest routes `GET /api/payments/settings`, `POST /api/payments`, `GET /api/payments/:id?t=`, `POST /api/payments/:id/retry`; gateway routes `POST /api/payments/flitt/callback` (raw body, own 600/min limiter) and `GET|POST /api/payments/flitt/return/:id/:token` (303 to the result page; `?cancel=1` closes only after the gateway confirms nobody paid), both mounted in `app.js` ahead of the global limiter, the origin check and the JSON parser; finance routes `GET /api/admin/payments/settings`, `GET /api/admin/payments`, `GET /:id`, `POST /:id/check-status`; `paymentCreateLimiter` (10 per 10 min per visitor, `FLITT_CREATE_LIMIT_PER_10_MIN`); sweeper timer in `server.js`; outbox handlers in `services/payments/psp.outbox.js` (receipt, retry note, finance alerts, unpaid auto-cancel) with templates `cardPaymentReceipt`, `cardPaymentFailed`, `bookingAutoCancelledUnpaid`, `cardPaymentAlert`; notification categories; RBAC matrix regenerated (+4 routes). `test/payments.http.test.js`: 19 scenarios. Still owed in this phase: Postman folder, `server/API.md` section, a manual round trip on the preview host (needs deploy). |
| 2b — Rules and docs | **Built 2026-11-03** | `GET /api/payments/rules` (strictest rule for what a checkout holds), `payment.timing/autoCancelAt/card` on every booking payload, `unpaidCancelHours`/`cardOptional` on policies; `server/API.md` "Card payments — Flitt" section; `docs/DEPLOYMENT.md` §3.4d switch-on runbook and env rows. |
| 3 — Guest checkout and result page (client) | **Built 2026-11-03** (gates: typecheck, lint 0 errors, 149 client tests, build) | `lib/api/payments.ts`, `types/payments.ts`, `lib/payments/{cardPayment,declineReason,usePaymentChoice}.ts`, `PaymentMethodChoice`, `PaymentResultView` + `/booking/payment/[paymentId]`, `PaymentStatusPanel` on every confirmation/manage view, `BookingSteps` gains `pay`, all five checkout forms start the card payment after the booking succeeds, `payment` dictionary block (82 keys × 4 languages, ka/ru/he for native review), the "no online payment" copy rewritten incl. privacy and terms, `test/payments.copy.test.ts`. Known limits: a package's child-item rules are not reflected pre-booking (slug only); cart lookups name hotel and tour holds only; no browser walk yet. |
| 6 — Reconciliation and health (server) | **Built 2026-11-03** | `reconcileSettledPayments` in the sweeper (settled rows re-read an hour after settling, ledger vs gateway net, `reconciledAt` or `PSP_RECONCILIATION_MISMATCH` audit + finance alert, 20 per pass), `GET /api/admin/payments/health` (inbox backlog, open/stuck attempts, mismatches, pending refunds, unpaid deadlines due, last sweep), `cardPaymentsAttention` badge. Not built: Flitt report-745 pull, deposit flow, Embedded groundwork (deferred; not needed for the test-mode MVP). |
| 5 — Refunds through Flitt (server) | **Built 2026-11-03** | `POST /api/admin/payments/:id/refunds` opens a REFUND approval naming the payment; the approval's execute writes `PspRefund` + outbox; the drain sends the reversal with the refund id as `reverse_id`, retries transient failures with the same key, declines what the gateway refuses (finance alerted), and writes the ledger REFUND only on `approved`; `refundableCents` on the staff shape; payment goes `REVERSED` when fully refunded. `test/payments.refund.test.js` (5). Admin UI button still to build with Phase 4 client. |
| 4 — Admin (server part) | **Built 2026-11-03** | `/api/admin/payment-policies` template catalogue (TOUR/TRANSFER/PACKAGE, own `payment_policy_product` enum, migration `20261103100200`), `paymentPolicyId` on tour options and packages, `PATCH /api/admin/transfers/providers/:id`, `payment` on the option/package/provider serializers, product templates kept out of hotel lists. `test/payments.policies.test.js` (5). Client screens (card payments list/detail, policy editors, banner, help article) still to build. |

**Owner decisions taken on 2026-11-03** (section 20.2): card and pay-later availability and the unpaid-booking timeout are **rules per product item**, carried by the existing `PaymentPolicy` and extended to tours, packages and transfers (section 4.4); unpaid timeout is set per policy, default 24 h; scope is all four guest products, partner receivables excluded; refunds through Flitt after the MVP (Phase 5); deposits in a later phase; `delayed=N`, no pre-authorisation, order description = reference and product only.

Authors' roles: payment systems architecture, full-stack engineering, application security. Every Flitt claim below was checked against the official documentation at https://docs.flitt.com/ on 2026-11-03, and the signing and verification algorithm was exercised live against Flitt's public test merchant (section 3.9).

---

## 1. Executive summary

- **Today the platform takes no money online.** Every booking (hotel, tour, transfer, package order) is created `CONFIRMED` at checkout, a `Receivable` is opened in the finance ledger, and the guest settles later by hand ("payment is taken by the property"). There is no card gateway, no PSP transaction table, no webhook signature code and no raw-body parser (section 2).
- **Recommendation: Flitt Redirect Checkout, interaction scheme B** (server-to-server `POST /api/checkout/url`, then redirect the guest to the returned `checkout_url`). It keeps the site at PCI DSS SAQ A, needs no front-end card form, works on mobile, supports Visa/Mastercard, 3-D Secure, Apple Pay and Google Pay on the hosted page, and is the only method Flitt's own PCI page recommends without extra compliance work (section 4).
- **Recommendation: "confirm, then pay", settling the existing Receivable.** The booking creation code path stays untouched. Card payment becomes a new step that settles the `Receivable` the ledger already opens at confirmation, through the existing `recordPaymentInTx` (`method: CARD`). One payment module therefore serves every product, the ledger stays the source of truth, InvoiceOcean invoicing keeps working, and nothing already in production changes behaviour when `FLITT_ENABLED=false` (section 4.3).
- **Whether card is required, offered or absent is a rule per item**, carried by the existing `PaymentPolicy` (already on hotel rate plans) and extended to tour options, packages and transfer providers. `PAY_NOW` items are auto-cancelled when unpaid after a per-policy number of hours (default 24); `PAY_LATER` items keep today's behaviour with a card option; `PAY_AT_HOTEL` items stay pay-later (section 4.4).
- **Backend is the only authority on payment state.** A payment is marked paid only after (a) a signature-verified server callback *or* a signed status fetch, *and* (b) a fresh `POST /api/status/order_id` re-fetch confirms `order_status=approved` with our amount and currency. The browser return URL carries no trust (sections 5, 11, 12).
- **Test mode is a hard property of the configuration**, not a flag on a request: `FLITT_MODE=test` pins the public test merchant `1549901` and secret `test`, every payment row is stamped `mode=TEST`, the admin panel shows a persistent banner, and the configuration loader refuses a live-looking merchant while in test mode (section 13).
- **No new runtime dependency.** Flitt's official Node SDK is GPL-3.0 licensed, mutates its own configuration object at call time, has no request-level timeout control, and does not preserve the lexical form of JSON numbers, which the signature needs. The API is one SHA-1 and three JSON endpoints; a 150-line in-house adapter under `server/lib/integrations/flitt/` is safer (section 3.8).
- **Delivery in seven phases**, the first six in test mode, ending with a separate, owner-approved production switch-on (sections 17 to 19). Mandatory MVP = Phases 0 to 4 (config, schema, adapter, checkout, callbacks, result page, admin list). Phases 5 and 6 (refunds through Flitt, reconciliation hardening, Embedded Checkout groundwork) are recommended but can follow.

Decisions the owner must take before implementation are listed in section 20.2; the plan proceeds under the stated defaults if they are left blank.

---

## 2. Existing architecture audit (verified 2026-11-03)

### 2.1 Stack

| Layer | What is there |
|---|---|
| Client | `client/`: Next.js 16 App Router, React 19, Tailwind v4, Framer Motion. Locales `en` (unprefixed), `ka`, `ru`, `he` (RTL) under `app/[locale]/`, routing in `client/proxy.ts`. Dictionaries are TypeScript files `client/lib/i18n/ui/{en,ka,ru,he}.ts`. |
| Server | `server/`: Express 5, Prisma 7 (`@prisma/adapter-pg`), PostgreSQL 17 + PostGIS, zod 4, pino, helmet, express-rate-limit (optional Redis store), nodemailer. Node 24 (`engines >= 22.18`). |
| Tests | `node:test` + supertest, `server/test/*.test.js`, env from `server/.env.test`; client `node:test` via `client/test/*.test.ts`. |
| CI | `.github/workflows/ci.yml`: client typecheck/lint/test/build, server `prisma validate`, `migrate deploy`, seed, `npm test`, `npm audit`, Docker image builds. |
| Deploy | API on Render (`render.yaml`, Frankfurt, `preDeployCommand: npx prisma migrate deploy`, health `/health`); client on Vercel (`client/vercel.json`); single-host alternative `docker-compose.prod.yml` + `deploy/Caddyfile`. |

### 2.2 Current payment providers and integrations

- **None for card payments.** No Stripe, Bank of Georgia, TBC or Flitt code exists. Searching `server/` for `stripe|bog|tbc|flitt|fondy|psp` yields only fixture bank names and documentation.
- **InvoiceOcean** (`INVOICEOCEAN_ENABLED`) is the only external money-adjacent integration and is the architectural template to copy:
  - provider interface with an error contract (`server/services/invoicing/provider.js`: `UnprocessableEntityError` = permanent, `BadGatewayError` = transient and retried by the outbox);
  - adapter with `fetch` + `AbortSignal.timeout`, concurrency semaphore, one retry on transient failures (`server/services/invoicing/invoiceocean.adapter.js:288-380`);
  - inbound webhook: no session, shared secret with `timingSafeEqual` (`server/services/invoicing/sync.service.js:31-38`), stored into an **inbox table** `InvoiceSyncEvent` with `@@unique([provider, externalId, externalUpdatedAt])` (duplicates become no-ops), answered `200 {received, duplicate}` immediately, and **applied later by a locked sweeper that re-fetches the document from the provider before believing the webhook** (`applySyncEvents`, 60 s) with a polling fallback (`pollInvoices`, 15 min).

### 2.3 Checkout and order creation flows

Guest-capable routers use `optionalAuthenticate, rejectUnapprovedPartner`; no session means guest.

| Product | Create route | Service (facade → InTx) | Status at creation |
|---|---|---|---|
| Hotel | `POST /api/bookings` (`server/routes/hotels.bookings.routes.js`) | `confirmBooking` → `confirmHotelBookingInTx` (`server/services/hotel/booking.service.js:309, 469-538`) | `CONFIRMED` |
| Tour | `POST /api/tours/bookings` | `services/tour/booking.service.js` | `CONFIRMED` or `PENDING` (`ON_REQUEST`) |
| Transfer | `POST /api/transfers/bookings` (no holds) | `services/transfer/booking.service.js:269` | `CONFIRMED` |
| Package / custom order | `POST /api/orders` (`server/routes/orders.routes.js`) | `confirmOrder` (`services/order/order.service.js:462-603`), children via `confirmChildInTx`, status rolled up by `rollUpOrderStatus` (420) | `PENDING_CONFIRMATION` → `CONFIRMED` |
| Service | `/api/service-bookings` | partner-only | out of guest scope |

Shared properties relevant to payments:

- **Prices never come from the client.** They travel in HMAC-signed 30-minute offer tokens (`server/lib/hotel/offerToken.js`, `lib/tour/offerToken.js`, `lib/transfer/quoteToken.js`) and are re-quoted at confirm time (`prepareHotelBooking`, strict `409 PRICE_CHANGED`).
- **Holds**: hotel/tour holds last `HOTEL_HOLD_TTL_MS` = 15 min (`server/config.js:338`), swept every 30 s.
- **Idempotency**: `Idempotency-Key` header or body key (`server/lib/idempotency.js`), per-service `deriveIdempotencyKey`, replay gated by read access, `P2002` race returns the winner.
- **Transaction rule** (`booking.service.js:300`): "Nothing slow happens in here. No email, no payment call, no HTTP." The plan respects this: no Flitt HTTP inside any Prisma transaction.
- **Finance hook**: at confirmation `syncBookingReceivableInTx` / `syncOrderReceivableInTx` (`server/services/finance/ledger.service.js:407-408, 565`) open one `Receivable` per booking or order; a guest receivable is due the same day (`FINANCE_GUEST_DUE_DAYS=0`). The buyer total for a hotel is `sellTotalCents + taxTotalCents` (`ledger.service.js:46`).

### 2.4 Database (payment-related)

`server/prisma/schema.prisma` (5,678 lines, 48 migrations). Conventions (lines 1-17): integer minor units, snake_case via `@map`, Json validated by zod in `server/validation/domain.js`, enum values mirrored as client string unions, `currency String @db.Char(3)` on every money row, no FX conversion.

| Model | Purpose | Reuse for Flitt |
|---|---|---|
| `Receivable` (5202) | what the buyer owes: `amountCents`, `paidCents`, `status SettlementStatus {OPEN, PARTIAL, PAID, VOID, WAIVED}`, `debtorPartnerId?`, `debtorEmail`, `currency`, nullable unique FKs to each booking type and `orderId` | **The payment target.** A card payment settles a receivable. |
| `PaymentRecord` (5247) | money that moved: `direction {IN,OUT}`, `kind {PAYMENT, REFUND}`, `method {BANK_TRANSFER, CASH, CARD, OTHER}`, `idempotencyKey @unique`, `externalPaymentId?` (not unique), `recordedByUserId?` | **Written on approval** via `recordPaymentInTx` (`services/finance/payment.service.js:315`), `method: CARD`. |
| `PaymentAllocation` (5281) | links a record to a receivable or instalment | Written by `recordPaymentInTx`. |
| `ApprovalRequest` (5577) | maker-checker; `KINDS.REFUND` executes `recordPaymentInTx` (`services/finance/approval.service.js:28-60`) | Refund through Flitt hooks in here. |
| `InvoiceSyncEvent` (5439) | inbound webhook inbox | Pattern for the callback inbox. |
| `OutboxEvent` (4979) | transactional outbox, `drainOutbox` every 5 s, 8 attempts, backoff `30s·2^(n-1)` | Receipt emails, refund execution. |
| `AuditLog` (3725), `AuditAction` (3163-3385) | includes `PAYMENT_RECORDED`, `REFUND_RECORDED` | New PSP actions needed. |
| `NotificationKind` (4557) | includes `FINANCE_PAYMENT_RECEIVED` | New PSP alert kinds needed. |

**Gaps:** no booking table carries a payment status (by design, finance is separate); no PSP transaction table; no provider enum; `PaymentRecord.externalPaymentId` is not unique; no raw-body or form-encoded parser (`express.json({limit:'100kb'})` only, `server/app.js:60`); `globalLimiter` skips only `/health` (`server/middleware/rateLimit.js:350`); logger redaction list has no PSP fields (`server/lib/logger.js`).

### 2.5 Authentication and authorization

- Opaque DB sessions, cookie `iag_session`, **`sameSite: 'strict'`**, `secure` when deployed (`server/services/auth.service.js:14-28`). Guests have no accounts; they read bookings by reference + email (`assertMayRead`, `booking.service.js:559`, answers 404 not 403).
- Capability RBAC resolved per request (`server/lib/permissions.js`, `services/rbac/access.js`); finance capabilities include `finance.payments.read/write`, `finance.refunds.request/approve/execute`, `finance.reports.read`. `finance.refunds.execute` is withheld from SUPER_ADMIN (maker-checker).
- **CSRF** (`server/middleware/csrf.js`, mounted globally at `app.js:56`): write requests with `Sec-Fetch-Site: cross-site` or a foreign `Origin` are refused with 403. Requests with neither header (server-to-server) pass. Consequence: Flitt's host-to-host callback passes; **a browser auto-POST from pay.flitt.com to the API would be refused**, so the return route must be mounted before this middleware or be a GET.
- Client: `client/lib/admin/navigation.ts` (capability-gated sidebar), `client/types/auth.ts` (`can()`), `client/lib/auth/session.ts`. There is no screen table or dashboard registry.

### 2.6 Admin panel finance

Screens under `client/app/[locale]/(admin)/admin/(panel)/finance/` (overview, payables, receivables, payments, invoices, approvals, penalties, reports, terms). Shared components `components/admin/DataTable.tsx`, `AdminPage.tsx`, `StatusBadge.tsx`, `StatCard.tsx`; finance browsers in `components/admin/finance/` (`PaymentsBrowser`, `RecordPaymentModal`, `ApprovalRequestActions`, …). Filters live in the URL; server pages parse them and call `serverFetch`. Lists return `{ data, total, page, pageSize, totalPages }`. Every admin page needs a help article under `client/lib/admin/help/articles/<category>/` (enforced by `client/test/help-registry.test.ts`). Badges come from `/api/admin/badges`.

### 2.7 Webhooks, environment, deployment

- Only the InvoiceOcean webhook exists (`POST /api/integrations/invoiceocean/webhook`, mounted `server/routes/index.js:108`).
- `server/config.js` (dotenv, no zod): `required = ['DATABASE_URL']`, `requiredInProduction` when `NODE_ENV` is neither development nor test; `numberEnv` throws on non-numeric; boot assertions `assertInvoicingConfig` (609-724) are the template. **No server variable holds the API's own public URL** (`CLIENT_ORIGIN` and `APP_URL` describe the client), so the callback URL has nowhere to come from today.
- `TRUST_PROXY` required when deployed; body limit 100 kB; `REQUEST_TIMEOUT_MS` 30 s.
- Env files: `server/.env.example`, `server/.env.production.example`, `server/.env.test`, `client/.env.local.example`; Render `render.yaml` env block.

### 2.8 Error handling, logging, monitoring

- `server/lib/errors.js`: `HttpError` family incl. `BadGatewayError` (reserved for external providers). `server/middleware/errors.js` maps Prisma/SQLSTATE codes; envelope `{ error: { message, details } }`, `details.reason` is what the client switches on.
- pino with redaction of auth/cookie/`x-webhook-secret` headers; `pino-http` default request ids, no propagation header. **No Sentry/APM.** Health `GET /health` and `/health/db`.

### 2.9 Background jobs

`server/server.js` runs 13 `setInterval` jobs (hold sweeps, outbox drain, finance reminders, InvoiceOcean apply/poll, tour/order sweeps). Transactional guards: `pg_try_advisory_xact_lock` via `lib/locks.js` (`lockKey`, `lockRows`). No payment reconciliation job exists.

### 2.10 Tests and CI relevant to payments

`finance.payments.test.js`, `finance.approvals.test.js`, `finance.ledger.unit.test.js`, `idempotency.unit.test.js`, `booking.test.js`, `orders.booking.test.js`, `cancellation.test.js`, `invoicing.flow.test.js` (uses `test/support/invoiceocean.stub.js`, an in-process `node:http` stub with `failNext`/`delayMs`), `csrf.test.js`, `ratelimit*.test.js`, `logger.redaction.test.js`, `rbac.matrix.test.js` (regenerated fixture `test/support/fixtures/rbac-matrix.json`). Postman collection `docs/postman/I-am-Georgia.postman_collection.json`.

### 2.11 Customer-facing copy that contradicts card payments

`client/lib/i18n/ui/en.ts` (mirrored in ka/ru/he): 537 "Payment is settled with the operator, not on this site", 821, 1237 `noPayment`, 1354/1616-1617 (transfers, settle with the driver), 1560 `noPaymentStep`, 1718-1724 (about), **1817-1819 and 1878-1880 (privacy policy and terms: "We take no payment online… we never see or store card details")**, 2212/2221-2222/2242 (booking: "Payment is taken by the property"), 722/2166 `payAtProperty`.

### 2.12 House rules that bind this plan

`.claude/skills/payment-engineering/SKILL.md` and `.claude/skills/api-integration/SKILL.md`: integer cents with asserted currency; ledger as source of truth; domain-derived idempotency keys enforced by unique constraints; **never mark paid from a redirect**; webhook verified before trust, limiter-exempt, fast 2xx, unique PSP event id, out-of-order safe, **re-fetch from the PSP before acting on any amount**; adapter per vendor under `server/lib/integrations/<vendor>/`, credentials only via `config.js`; `fetch` + `AbortSignal.timeout`; retry only transient, idempotent failures; vendor outage is 502/503; never log PAN/CVV/credentials.

---

## 3. Flitt documentation findings (official links)

All pages are also served as Markdown by appending `index.md` (https://docs.flitt.com/llms/index.md).

### 3.1 Integration types and PCI scope

- Redirect: https://docs.flitt.com/getting-started/redirect/ — hosted page on `pay.flitt.com`, all payment methods on one page, brand presets configured in the Merchant Portal (https://docs.flitt.com/getting-started/presets/).
- Embedded: https://docs.flitt.com/getting-started/embedded/ and https://docs.flitt.com/api/embedded-custom/ — Flitt's `checkout.js` renders the form in an iframe on our page; order created on the backend with `POST /api/checkout/token`, token handed to the widget.
- Direct: https://docs.flitt.com/getting-started/direct/ — card data passes through our backend; **requires PCI DSS SAQ D / RoC** (https://docs.flitt.com/pcidss-compliance/ "Direct method requires card data storage on merchant own server. In this case, PCI DSS RoC is mandatory"). Redirect and Embedded (iframe) are SAQ A; a JavaScript card form is SAQ A-EP. Flitt's recommendation: "With SAQ A, D and A-EP you can use any Flitt integrations except Direct".

### 3.2 Test mode (https://docs.flitt.com/api/testing/)

| Item | Value |
|---|---|
| Test `merchant_id` (purchases) | `1549901` |
| Test payment secret key | `test` |
| Payout secret (not used) | `testcredit` |
| Reports-only merchant / application | `1549902` / `application_id 1019`, key `test` |
| API host | `https://pay.flitt.com` (same host for test and live; mode is a property of the merchant: "Depending on merchant test or live status you use, all requests are executed in corresponding test or live mode. Test mode never affects your live finances." https://docs.flitt.com/api/introduction/) |

Test cards (expiry and CVV any):

| Card | Brand | 3DS | Result |
|---|---|---|---|
| `4444555566661111` | Visa | yes | approve |
| `4444111166665555` | Visa | yes | decline |
| `4444555511116666` | Visa | no | approve |
| `4444111155556666` | Visa | no | decline |
| `5555666644441111` | Mastercard | yes | approve |
| `6666444455551111` | Mastercard | yes | approve |
| `2222555566663333` | Mastercard | yes | decline |
| `4444555566669999` | Visa | frictionless 3DS | approve |
| `4444666655559999` | Visa | challenge 3DS | approve |
| `4444999966665555` | Visa | frictionless 3DS | decline |
| `4444666699995555` | Visa | challenge 3DS | decline |

Warnings on the testing/intro pages: "Do not send any sensitive information to Flitt API with test payment key and merchant taken from Testing mode section." The test merchant is public and shared by every developer, so `order_id` values must be globally unique (section 3.9 observed `1013 Duplicate order` on reuse).

### 3.3 Request structure and authentication (https://docs.flitt.com/api/request/, https://docs.flitt.com/api/introduction/)

- HTTPS `POST`, JSON body `{"request": {...}}`, response `{"response": {...}}`. `response_status` describes only the HTTP request (`success`/`failure`); the payment state is `order_status`.
- Error responses: `{"response": {"error_code": 1014, "error_message": "Invalid signature", "request_id": "…", "response_status": "failure"}}`. Decline responses are "normal" (`response_status: success`, `order_status: declined`, `response_code`, `response_description`).
- In test mode responses include `response_signature_string` (masked secret + joined values), absent in live mode.

### 3.4 Create order, status, order parameters

- `POST https://pay.flitt.com/api/checkout/url` (https://docs.flitt.com/api/create-order/) returns `checkout_url` and `payment_id`. `POST /api/checkout/token` returns a `token` (Embedded, mobile, wallets). `POST /api/checkout/redirect` is a browser form POST (not used: it would expose signing to the browser).
- Parameters (https://docs.flitt.com/api/order-parameters/): mandatory `order_id` (string ≤1024, unique per merchant), `merchant_id`, `order_desc` (UTF-8), `amount` (**integer minor units, no separator**), `currency` (`GEL`, `USD`, `EUR` for Georgian merchants, https://docs.flitt.com/api/currencies/), `signature`. Optional: `version` (`1.0.1`), `response_url`, `server_callback_url`, `cancel_url`, `lifetime` (seconds, default 36000, max 69120000), `merchant_data` (≤2048, string, echoed in callbacks and reports), `preauth` (`Y` hold, then capture), `sender_email`, `delayed` (default `Y`), `lang` (`en`, `ka`, `ru`, … **no `he`**), `product_id`, `required_rectoken`, `verification`, `rectoken`, `design_id`, `reservation_data` (base64 JSON with customer name/address, `account`, `settlement_id`; https://docs.flitt.com/api/reservation_data/).
- Response/callback fields: `order_status ∈ {created, processing, declined, approved, expired, reversed}`, `tran_type ∈ {purchase, verification, p2p credit, p2p transfer, reverse, settlement}`, `amount`, `actual_amount` (held or charged), `actual_currency`, `reversal_amount` (sum of reversals), `payment_id` (Flitt's integer id), `masked_card`, `card_bin`, `card_type`, `rrn`, `approval_code`, `eci` (5/6/7), `response_code`, `response_description`, `order_time` (`DD.MM.YYYY hh:mm:ss`), `fee`, `settlement_*`, `merchant_data`, `rectoken`, `additional_info` (JSON **string** with `transaction_id`, `capture_status`, `capture_amount`, `is_test`, `timeend`, `ipaddress_v4`, `version_3ds`, `bank_response_code`).
- `POST /api/status/order_id` (https://docs.flitt.com/api/order-status/): `{order_id, merchant_id, version?, signature}`; response has the same shape as a callback and is signed.
- Delayed orders (https://docs.flitt.com/api/delayed/): with `delayed=Y` (default) the customer can retry on the same order until `lifetime` and the merchant receives a callback per attempt, with `processing` after a bank refusal; with `delayed=N` a refusal is final (`declined`), one callback. The plan uses `delayed=N` (section 20.2, OD3).

### 3.5 Signature (https://docs.flitt.com/api/building-signature/)

"`sha1` is applied to the string, which contains merchant payment secret key and all request or response parameters, concatenated in alphabetic order and separated by `|` symbol." Rules confirmed by the page and the reference implementations (PHP `array_filter(strlen)`, Python `!= '' and not None`, Node SDK `genSignature`):

1. Take every parameter except `signature` and `response_signature_string`.
2. Drop parameters whose value is absent, `null` or the empty string. **Keep `0` and `"0"`.**
3. Sort by key name (byte order), take the values as strings, in that order.
4. Prefix the secret key: `secret|v1|v2|…`. UTF-8. SHA-1, lowercase hex.
5. Verify a response/callback by recomputing over its own fields and comparing with its `signature` (constant time).

**Finding:** the example hashes printed on the signature page do not match the strings printed next to them (e.g. `sha1("test|1000|GEL|1549901|Test payment|TestOrder2|http://myshop/callback/")` is `cd0edb71…`, the page says `91ea7da4…`). The algorithm, not the examples, is correct: section 3.9 shows the live gateway accepting our signature and our verification matching Flitt's response signature. Treat the printed examples as stale.

Two subtleties the implementation must handle:
- JSON numbers (`merchant_id: 1549901`, `payment_id: 805243692`, `card_bin: 444455`, `response_code: 1000`) are signed by their textual form. Parsing with `JSON.parse` and `String(value)` works for integers, but to be safe against values like `1.0` the callback parser keeps the original source text of numbers (Node ≥ 21 `JSON.parse` reviver `context.source`, verified on Node 24).
- `additional_info` is a JSON *string* and is signed verbatim; it must not be re-serialised.

### 3.6 Callbacks (https://docs.flitt.com/api/callbacks/)

- Host-to-host `POST`, `Content-Type: application/json; charset=UTF-8`, body is the flat response object (not wrapped in `response`), timeout 30 s, **does not follow redirects**.
- Merchant must answer `HTTP 200` or Flitt retries at 2, 60, 300, 600, 3600, 86400 seconds.
- Source IPs to allow: `54.154.216.60`, `3.75.125.89`.
- `response_url` redirect: "Flitt redirects customer to merchant site by sending payment result using HTTPS POST or GET" (https://docs.flitt.com/api/payment-flow/). **Which method, and whether parameters are attached, is not specified** (open question OQ1); the return route must accept both and trust neither.

### 3.7 Reversal, capture, saved cards, wallets, reports

- Reversal (refund): `POST /api/reverse/order_id` with `order_id, merchant_id, amount, currency, comment?, email?, reverse_id?, signature` (https://docs.flitt.com/api/create-reversal/, https://docs.flitt.com/api/reversal-parameters/). Full or partial; multiple partials allowed while the sum ≤ `actual_amount`. `reverse_id` (≤50 chars) is an **idempotent key per retry**; the response carries `reverse_status ∈ {created, processing, declined, approved}`, `reversal_amount`, `transaction_id`, `signature`. Reversal status afterwards is read from `/api/status/order_id` (`reversal_amount`; `order_status: reversed` when fully reversed) (https://docs.flitt.com/api/get-reversal-status/). Error 1084 "Only full refund allowed" and 1069 "Reverse not allowed. Turnover is not enough" exist (https://docs.flitt.com/api/response-codes/).
- Capture: `preauth=Y` holds funds; `POST /api/capture/order_id` captures once, full or partial; capture is safely retriable (same amount returns current status); partial reverse of an uncaptured hold is not allowed (https://docs.flitt.com/api/create-capture/). Not used in MVP (section 20.2, OD5).
- Saved cards / recurring: `required_rectoken=Y` returns `rectoken` in callbacks; `POST /api/recurring` charges it without 3DS; **production use requires enablement by Flitt support** (changelog 2026-08-28). Out of MVP scope.
- Apple Pay / Google Pay: appear automatically on the hosted Redirect page once enabled on the merchant; in test mode real wallet cards are converted to test tokens (https://docs.flitt.com/api/applepay-web/, https://docs.flitt.com/api/googlepay-web/). Embedded buttons need domain registration with Flitt (and Apple's domain-association file). Redirect needs nothing from us.
- Reports API (https://docs.flitt.com/api/reports/): separate credentials (`application_id`, key), token via `portal.flitt.com/authorizer/token/application/get`, report 745 lists orders by `payment_id`, `order_status`, `amount`, `actual_amount`, settlement fields. Candidate for the later reconciliation phase; MVP reconciles per order with `/api/status/order_id`.
- Response codes: https://docs.flitt.com/api/response-codes/ (1000 general decline, 1003 invalid CVV2, 1007 parameter incorrect, 1012 currency not available for merchant, 1013 duplicate order, 1014 invalid signature, 1018 order not found, 1019 already completed, 1023 invalid amount, 1024 3DS failed, 1037 insufficient funds, 1051 antifraud, 1052 order expired, 1084 only full refund, 1086 transaction already finished, 1089/1123 acquirer timeout; JavaScript codes 2xxx incl. 2009 already paid).

### 3.8 Official Node.js SDK (https://docs.flitt.com/sdk-and-mobile/sdk/nodejs/, https://github.com/flittpayments/node-js-sdk)

`@flittpayments/flitt-node-js-sdk@2.0.0`, `lib/index.js` + `lib/util.js`, base host `pay.flitt.com`, methods `Checkout`, `CheckoutToken`, `Status`, `Reverse`, `ReverseFull`, `Capture`, `CaptureFull`, `Recurring`, `isValidResponse`. Reasons not to add it as a dependency:
- **License GPL-3.0** (package.json), incompatible with a proprietary server codebase without legal review.
- `Subscription`/`Settlement`/`TransactionList` mutate `this.config.protocol` for the lifetime of the instance; no `AbortSignal`; single global timeout.
- `genSignature` joins `Object.values(...)` so a `null` becomes an empty slot while Flitt drops it; integers lose lexical form.
- It throws on `error_code` only, so a decline (`order_status: declined`) is returned as a success-shaped object; our adapter needs an explicit status model anyway.

The SDK source is nonetheless the best executable reference for the wire format and was used to validate the adapter design.

### 3.9 Live verification against the public test merchant (2026-11-03)

Executed from this workstation with merchant `1549901` / key `test`, throwaway `order_id` values, no personal data:

| Probe | Result |
|---|---|
| `POST /api/checkout/url` signed per section 3.5 | `response_status: success`, `checkout_url` on `pay.flitt.com/merchants/…/index.html?token=…`, `payment_id` returned |
| `POST /api/status/order_id` on the new order | `order_status: created`, `amount: "100"`, `merchant_data` echoed, `additional_info` string present, **our recomputed signature equals Flitt's `signature`** |
| Status with a wrong signature | `error_code 1014 Invalid signature` |
| Status for an unknown order | `error_code 1018 Order not found` |
| Re-creating the same `order_id` | `error_code 1013 Duplicate order … for merchant 1549901` |
| `lifetime: 600` accepted | yes |

Not exercised (needs a public callback URL and a browser): the callback delivery itself, the `response_url` method, 3DS challenge pages, reversal. These are Phase 1 spike items (section 17).

### 3.10 Documentation gaps recorded as open questions

OQ1 `response_url` HTTP method and payload; OQ2 whether callbacks are sent for `expired` orders without customer interaction (the delayed-order page implies the status exists; the callback trigger is not stated); OQ3 the Merchant Portal page "Getting payment key" is empty at https://docs.flitt.com/api/getting-payment-key/; OQ4 whether `is_test` in `additional_info` is always present; OQ5 maximum callback body size (our limit is 100 kB; `additional_info` is ≤ 20480 chars); OQ6 whether `cancel_url` is called with parameters; OQ7 Hebrew is not a supported `lang`.

---

## 4. Recommended integration approach

### 4.1 Comparison

| Criterion | A. Redirect (hosted page) | B. Embedded (iframe widget) | C. Direct API |
|---|---|---|---|
| PCI DSS scope | **SAQ A** | SAQ A (iframe) | SAQ D + RoC, card data on our servers |
| Card data on our domain | never | never (iframe) | yes |
| 3DS, Apple Pay, Google Pay, Open Banking | all on Flitt's page, zero work | supported, needs domain registration for wallets | we drive 3DS steps ourselves |
| Front-end work | one redirect + result page | load `checkout.js` (Vue widget) from `pay.flitt.com`, CSP changes, theme work, event handling | full card form, encryption, 3DS orchestration |
| Mobile | hosted page is responsive | iframe inside our responsive layout | our form |
| Failure/UX control | limited to presets, logo, colours; guest leaves the site | guest stays on site | full |
| Maintenance / blast radius | lowest | medium (third-party script in our page, CSP, widget versions) | highest |
| Security surface added | one callback endpoint, one return endpoint | plus a third-party script on the checkout page | plus card data handling |

### 4.2 Recommendation

**Redirect Checkout, interaction scheme B** (host-to-host create, then redirect to `checkout_url`): the lowest-risk way to prove the entire server-side lifecycle, and every server-side component (adapter, payment table, callback inbox, status reconciliation, refund flow, admin screens) is **identical** for Embedded. Scheme A (browser form POST to `/api/checkout/redirect`) is rejected because the signature would have to be computed server-side and still exposed in the browser form.

### 4.3 Where payment sits in the booking lifecycle ("confirm, then pay")

Three placements were evaluated:

1. **Pay before the booking exists** (payment against the hold): the booking would be created inside the callback handler from a stored input snapshot; the 15-minute hold would have to outlive the Flitt order lifetime; price re-validation could fail after money moved and force an automatic refund; every booking InTx function would need a second entry point. High risk, large change.
2. **New `AWAITING_PAYMENT` status on every booking/order enum**: touches four booking state machines, the order roll-up, sweepers, supplier notifications and emails; blocks ON_REQUEST products that are confirmed days later.
3. **Confirm, then pay, settling the Receivable** (recommended): the booking is created exactly as today; the `Receivable` the ledger already opens is the payment target; a card payment is a `PaymentRecord(method: CARD)` written by the existing `recordPaymentInTx` when Flitt approves. Works for every product, for later balance payments, for bookings confirmed after an ON_REQUEST review (guest pays from the manage page link), and for re-tries after a decline.

Trade-off of option 3: an abandoned card payment leaves a confirmed, unpaid booking, exactly the state the platform is in today for every booking. Mitigation offered as an owner decision (OD1): an optional sweeper that cancels guest bookings whose receivable is still `OPEN` N hours after creation when the guest chose "pay by card", with the standard cancellation path and emails.

### 4.4 Payment policy rules (owner decision 2026-11-03)

Whether a guest **must** pay by card at checkout, **may** choose "pay later", or cannot pay by card at all is a property of the item being sold, not of the platform. The schema already models this for hotels: `PaymentPolicy` (`server/prisma/schema.prisma:2204`, `timing PaymentTiming {PAY_NOW, PAY_LATER, DEPOSIT, PAY_AT_HOTEL, CREDIT_ACCOUNT}`, `depositBps`, `balanceDueDaysBeforeCheckIn`), owned by a hotel or a platform template (`hotelId null`, `isTemplate`, `services/hotel/policyCatalog.service.js`), attached per `RatePlan.paymentPolicyId`, edited in `components/admin/RoomsManager.tsx`, serialised as `plan.payment` (`serializers/ratePlan.js:93,123`) and already present on hotel offers and bookings (`client/types/booking.ts:102`). Booking code never reads it today. The plan makes it the rule engine and extends it to the other products.

**Meaning of `timing` for a guest checkout (the matrix the checkout, the API and the sweeper all read):**

| `timing` | Card at checkout | "Pay later" at checkout | Unpaid card booking | Notes |
|---|---|---|---|---|
| `PAY_NOW` | required | no | auto-cancelled after `unpaidCancelHours` (policy field, default 24) | the only timing that releases inventory automatically |
| `PAY_LATER` | offered | yes | kept, finance chases as today | current behaviour plus a card option |
| `PAY_AT_HOTEL` | **not offered** (owner may flip to "offered" per policy with `cardOptional`) | yes | n/a | payment is taken by the property/operator/driver |
| `DEPOSIT` | later phase; **in MVP behaves as `PAY_NOW` for the full balance** and the admin form warns about it | no | as `PAY_NOW` | deposit + balance pay link is a Phase 6 item |
| `CREDIT_ACCOUNT` | n/a for guests | n/a | n/a | partner terms; card never offered |

**Where the rule attaches per product:** hotel `RatePlan` (exists); tour `TourOption` (`schema.prisma:1090`, beside its `cancellationPolicyId`); `Package`; transfers on `TransferProvider` (`schema.prisma:3956`; one policy per supplier rather than per route, because routes are many and pricing is per vehicle class). Each gets a nullable `paymentPolicyId`; **null means the platform default policy** for that product kind (a seeded template, `PAY_LATER` for hotels/tours/packages, `PAY_AT_HOTEL`-style "settle with the driver" for transfers, so nothing changes until staff choose otherwise).

**Orders (packages / custom carts) with mixed items:** the strictest rule wins. Any `PAY_NOW` item makes the order `PAY_NOW` with the smallest `unpaidCancelHours`; otherwise any `PAY_LATER` item offers card; card is not offered only when every item is `PAY_AT_HOTEL`.

**Frozen at booking time** (a policy edited later must not change what a guest agreed to): the resolved `paymentTiming`, `unpaidCancelHours` and the resulting `autoCancelAt` are written on the `Receivable` when it is opened (`syncBookingReceivableInTx` / `syncOrderReceivableInTx`), next to the due date it already freezes. The booking's own snapshot JSON (`hotelSnapshot`, `tourSnapshot`, `packageSnapshot`) additionally records the policy name for the confirmation page.

**Auto-cancellation (PAY_NOW only):** `sweepUnpaidBookings` (part of the payments sweeper, section 16.6) cancels a guest booking or order whose receivable is still `OPEN`, whose `autoCancelAt` has passed and which has no `APPROVED`/`PROCESSING` card attempt, through the product's normal cancellation path (`cancelHotelBookingInTx` and siblings, actor `SYSTEM`, reason `UNPAID`), with the cancellation charge forced to zero (the guest never paid) and the existing cancellation emails plus a "your booking was cancelled because payment was not completed; book again" variant. A guest who opens the pay link after cancellation sees "This booking was cancelled" with a link to search again.

### 4.5 Migration path to Embedded Checkout later

Only the client and two adapter lines change: create the order with `POST /api/checkout/token` instead of `/api/checkout/url` (`FlittClient.createToken`), expose the token from `POST /api/payments`, render Flitt's `checkout.js` in a `PaymentWidget` client component on `/booking/payment/[id]`, add `script-src`/`frame-src pay.flitt.com` to a client CSP, and keep every callback, status, refund and admin component unchanged. The `PspPayment.checkoutToken` column is reserved for this.

---

## 5. System architecture

```
┌────────────────────────── Browser (guest) ──────────────────────────┐
│ /booking/checkout  ──submit──►  /booking/payment/[id]  (result page) │
│      │                                   ▲        │ poll GET status  │
│      │ POST /api/bookings (unchanged)     │        ▼                  │
│      │ POST /api/payments  ──checkoutUrl──┘   GET /api/payments/:id   │
└──────┼───────────────────────────────────────────────┼───────────────┘
       │ 302/assign to checkout_url                    │
       ▼                                               │
┌──────────────── pay.flitt.com (hosted checkout) ─────┼───────────────┐
│ card form, 3DS, Apple/Google Pay                     │               │
│  ── redirect response_url ──► API return route ──303─┘               │
│  ── server callback (POST JSON, signed) ──► API callback route       │
└───────────────────────────────────────────────────────────────────────┘
                                   │
┌────────────────── Express API (server/) ──────────────────────────────┐
│ routes/payments.routes.js            routes/payments.flitt.routes.js   │
│   POST /api/payments                   POST /api/payments/flitt/callback│
│   GET  /api/payments/:id               GET|POST /api/payments/flitt/   │
│   POST /api/payments/:id/retry                return/:id/:token        │
│ routes/admin.payments.routes.js (list, detail, check-status, refund)   │
│                     │                                                  │
│ services/payments/psp-payment.service.js  (create, apply status,       │
│                     │                       state machine, ledger)     │
│ services/payments/flitt-callback.service.js (verify → inbox → apply)   │
│ services/payments/psp-refund.service.js   (approval hook → outbox)     │
│ services/payments/psp-sweeper.service.js  (apply inbox, poll stuck,    │
│                     │                       expire, reconcile)         │
│ lib/integrations/flitt/{signature,client,parse,status}.js  ◄── config │
│                     │                                                  │
│ Prisma: psp_payments, psp_callback_events, psp_refunds                 │
│         + existing receivables / payment_records / payment_allocations │
│         + outbox_events (receipts, refund execution, alerts)           │
└───────────────────────────────────────────────────────────────────────┘
```

Trust boundaries: the browser is untrusted (it only carries opaque ids and a signed return token); Flitt callbacks are authenticated by signature and (in live mode) source IP, then **confirmed by a signed status re-fetch**; the merchant secret exists only in `server/config.js` memory and the host's environment.

---

## 6. End-to-end payment sequence

```
Guest            Client (Next)        API (Express)              Postgres            Flitt
 │ fill details      │                    │                          │                 │
 │──────────────────►│ POST /api/bookings │ (unchanged: booking      │                 │
 │                   │───────────────────►│  CONFIRMED, Receivable   │                 │
 │                   │                    │  OPEN, emails queued)    │                 │
 │                   │◄── {reference} ────│                          │                 │
 │ chose "card"      │ POST /api/payments │                          │                 │
 │                   │ {reference,email,  │ 1 find receivable, check │                 │
 │                   │  idempotencyKey}   │   guest+email, OPEN,     │                 │
 │                   │───────────────────►│   amount = amountCents-  │                 │
 │                   │                    │   paidCents, currency    │                 │
 │                   │                    │ 2 INSERT psp_payments    │                 │
 │                   │                    │   status CREATED ───────►│                 │
 │                   │                    │ 3 sign + POST            │                 │
 │                   │                    │   /api/checkout/url ────────────────────► │
 │                   │                    │◄── checkout_url, payment_id ───────────── │
 │                   │                    │ 4 UPDATE checkoutUrl,    │                 │
 │                   │                    │   providerPaymentId,     │                 │
 │                   │                    │   status REDIRECT_READY ►│                 │
 │                   │◄── {id,checkoutUrl}│                          │                 │
 │◄── location.assign(checkoutUrl) ──────┤                          │                 │
 │ pays on pay.flitt.com, 3DS ──────────────────────────────────────────────────────► │
 │                   │                    │◄── POST callback (signed JSON) ─────────── │
 │                   │                    │ 5 verify sig, mode, mid; │                 │
 │                   │                    │   INSERT inbox (unique   │                 │
 │                   │                    │   hash) → 200 OK ───────►│                 │
 │                   │                    │ 6 apply: POST /api/status/order_id ─────► │
 │                   │                    │◄── signed status (approved, amount) ────── │
 │                   │                    │ 7 TX: lock psp_payment;  │                 │
 │                   │                    │   assert amount+currency;│                 │
 │                   │                    │   transition → APPROVED; │                 │
 │                   │                    │   recordPaymentInTx(CARD)│                 │
 │                   │                    │   → Receivable PAID,     │                 │
 │                   │                    │   audit, outbox receipt ►│                 │
 │◄── redirect response_url ─────────────────────────────────────────────────────────┤
 │                   │ GET /api/payments/flitt/return/:id/:token ──► 303 ───────────► │
 │──────────────────►│ /booking/payment/[id]?t=token                                  │
 │                   │ GET /api/payments/:id?t= ───► if not final and >5 s since last │
 │                   │                              check: status fetch (step 6-7)    │
 │                   │◄── {status: APPROVED, maskedCard, reference…}                  │
 │◄── "Paid" ────────│                                                                │
```

Steps 5 to 7 and the return are independent: whichever arrives first drives the state; the other finds the work done (idempotent). If neither arrives (local dev without a public callback URL, or a dropped callback), the sweeper (section 16) and the result page's throttled status fetch converge the state.

---

## 7. Exact files and modules to add or modify

### 7.1 New server files

| File | Responsibility |
|---|---|
| `server/lib/integrations/flitt/signature.js` | `canonicalString(secret, params)`, `sign(secret, params)`, `verify(secret, params)` (constant-time), pure, no I/O. |
| `server/lib/integrations/flitt/parse.js` | `parseCallbackBody(buffer)`: JSON with number source preservation, size and shape validation (zod), returns `{ fields, rawHash }`. |
| `server/lib/integrations/flitt/client.js` | `createFlittClient(getSettings)`: `createCheckoutUrl`, `createCheckoutToken`, `getOrderStatus`, `reverse`, `capture`; `fetch` + `AbortSignal.timeout`, one retry on network/5xx/429 **only for `getOrderStatus`** (idempotent), never for create/reverse without the idempotent key; maps `error_code` to `UnprocessableEntityError`/`BadGatewayError`; verifies every response signature; never logs the secret or full card fields. |
| `server/lib/integrations/flitt/status.js` | `mapOrderStatus(flittStatus) → PspPaymentStatus`, `isFinal`, `rank` for monotonic transitions; `toCents(amountString)` (integer string → int, throws on anything else). |
| `server/lib/payments/machines.js` | `pspPaymentMachine`, `pspRefundMachine` via `lib/stateMachine.js` `defineMachine`. |
| `server/lib/payments/returnToken.js` | HMAC-SHA256 token binding `paymentId` (secret `FLITT_RETURN_TOKEN_SECRET`), same style as `lib/hotel/offerToken.js`. |
| `server/services/payments/psp-payment.service.js` | `createPayment`, `getPaymentForGuest`, `getPaymentForStaff`, `applyProviderStatus` (the single state-transition function), `refreshFromProvider`, `listPayments`. |
| `server/services/payments/flitt-callback.service.js` | `ingestCallback(req)`: signature, mode, merchant and IP checks → inbox row → 200; `applyCallbackEvents()`. |
| `server/services/payments/psp-refund.service.js` | `requestPspRefund` (from the approval execute path), outbox handler `executePspRefund`, `applyRefundResult`. |
| `server/services/payments/psp-sweeper.service.js` | `sweepPspPayments()`: apply inbox, poll stuck, expire, daily reconciliation. |
| `server/validation/payments.js` | zod schemas: `createPaymentSchema`, `callbackSchema` (loose: strings/integers, required keys `order_id, merchant_id, order_status, amount, currency, signature`), `adminListSchema`, `refundSchema`. |
| `server/routes/payments.routes.js` | guest routes (`optionalAuthenticate`). |
| `server/routes/payments.flitt.routes.js` | callback + return routes; mounted **before** `globalLimiter`/`verifyRequestOrigin` with their own limiter. |
| `server/routes/admin.payments.routes.js` | staff routes, `finance.payments.read/write`, refund via approvals. |
| `server/prisma/migrations/2026MMDD…_psp_enum_values/` and `…_psp_payments/` | see section 8. |
| `server/test/support/flitt.stub.js` | in-process `node:http` Flitt stub (signs responses with the configured secret, scripted `order_status` per `order_id`, `failNext`, `delayMs`, records requests, can emit a callback to a URL). |
| `server/test/payments.flitt.signature.unit.test.js`, `payments.flitt.parse.unit.test.js`, `payments.flow.test.js`, `payments.callback.test.js`, `payments.refund.test.js`, `payments.sweeper.test.js`, `payments.admin.test.js` | section 14. |
| `server/scripts/flitt-smoke.js` | manual: create a test payment against the real test merchant, print the checkout URL, poll status (used in Phase 1 and the production smoke test). |

### 7.2 Modified server files

| File | Change |
|---|---|
| `server/config.js` | `config.payments.flitt` block (section 13), `apiPublicUrl`, `assertPaymentsConfig()` boot assertion. |
| `server/app.js` | mount `paymentsFlittRouter` right after `cookieParser`/pino and **before** `globalLimiter` (line ~49) with `express.raw({ type: ['application/json', 'application/x-www-form-urlencoded'], limit: '64kb' })` scoped to the callback path; keep everything else unchanged. |
| `server/routes/index.js` | mount `/api/payments` and `/api/admin/payments`. |
| `server/middleware/rateLimit.js` | export `pspCallbackLimiter` (per-IP, generous, `passOnStoreError`) and `paymentCreateLimiter` (per visitor, e.g. 10/10 min). |
| `server/lib/logger.js` | add redaction paths: `req.body.signature`, `req.body.masked_card`, `req.body.sender_email`, `req.body.rectoken`, `*.secretKey`, `req.headers['x-forwarded-for']` stays visible (needed for IP checks). |
| `server/lib/outbox.js` | topics `PSP_PAYMENT_APPROVED = 'psp.payment.approved'`, `PSP_PAYMENT_FAILED = 'psp.payment.failed'`, `PSP_REFUND_REQUESTED = 'psp.refund.requested'`, `PSP_ALERT = 'psp.alert'`. |
| `server/services/notifications/outbox.service.js` | handlers: guest receipt email on `psp.payment.approved` (reuse `paymentReceipt` template, extend to guests), "payment failed, retry link" on `psp.payment.failed`, `executePspRefund` on `psp.refund.requested`, finance notification on `psp.alert`. |
| `server/lib/mailer/templates.js` | `cardPaymentReceipt`, `cardPaymentFailed`, link helpers `paymentUrl(id, token)`; add a "Pay now" block to `hotelBookingConfirmed`, `tourBookingConfirmed`, `transferBookingConfirmed`, `orderConfirmed` when the receivable is open and the debtor is a guest. |
| `server/services/finance/approval.service.js` | `KINDS.REFUND.execute`: when `payload.pspPaymentId` is set, call `requestPspRefund` (creates `PspRefund` + outbox) instead of recording the refund immediately; the record is written when Flitt approves. |
| `server/services/finance/payment.service.js` | accept `externalPaymentId`, `reference`, `paidAt` from the PSP path (already fields); `sameRequest` unchanged. |
| `server/routes/admin.badges.routes.js` | badge `cardPaymentsAttention` (count of `MISMATCH`/`REVIEW` rows). |
| `server/server.js` | `pspSweeper` timer every `FLITT_SWEEP_INTERVAL_MS` (60 s) when enabled; cleared on shutdown. |
| `server/lib/permissions.js` | no new capability needed (reuse `finance.payments.read/write`, `finance.refunds.*`); regenerate `test/support/fixtures/rbac-matrix.json`. |
| `server/.env.example`, `server/.env.production.example`, `server/.env.test` (`FLITT_ENABLED=false`), `render.yaml`, `docs/DEPLOYMENT.md` (§3.4c "Switching on Flitt"), `server/API.md`, `docs/API_TESTING_GUIDE.md`, Postman collection | documentation and environment. |

### 7.3 New and modified client files

| File | Change |
|---|---|
| `client/lib/api/payments.ts` | `createPayment`, `getPayment`, `retryPayment`; admin `listCardPayments`, `getCardPayment`, `checkCardPaymentStatus`. |
| `client/types/payments.ts` | `PspPaymentStatus`, `PspPayment`, `PspPaymentSummary`, `PaymentsSettings`. |
| `client/components/booking/PaymentMethodChoice.tsx` | radio group "Pay securely by card" / "Pay later" (the latter only when allowed, section 10.2). |
| `client/components/booking/PaymentStatusPanel.tsx` | shared status renderer (processing, success, failed, cancelled, pending, expired) with reference and retry. |
| `client/app/[locale]/(site)/booking/payment/[paymentId]/page.tsx` + `PaymentResultView.tsx` | result page with polling. |
| `client/components/booking/CheckoutForm.tsx`, `tours/TourCheckoutForm.tsx`, `packages/OrderCheckoutForm.tsx`, `transfers/TransferBookingForm.tsx` | after the booking succeeds and "card" was chosen: `createPayment` → `window.location.assign(checkoutUrl)`; otherwise unchanged navigation. |
| `client/components/booking/BookingSteps.tsx` | add `pay` step (`choose | details | pay | confirm`). |
| Confirmation views (`OrderConfirmationView`, `TourConfirmationView`, hotel, transfer) and `/booking/manage/[reference]` | "Payment" card: status, "Pay now" / "Pay the balance" when the receivable is open and payments are enabled; for `PAY_NOW` the deadline "Pay before {date/time} or the booking is cancelled". |
| `client/components/admin/PaymentPolicyEditor.tsx` (extracted from `RoomsManager.tsx`), tour option editor, package editor, transfer provider editor, `app/[locale]/(admin)/admin/(panel)/catalogue/payment-policies/page.tsx` | policy selection and editing for the other products; platform templates screen; `types/catalogue.ts` `PaymentPolicy` gains `unpaidCancelHours`, `cardOptional`, `productKind`. |
| `client/lib/i18n/ui/{en,ka,ru,he}.ts` | new `payment` block; rewrite the "no online payment" strings listed in 2.11, including legal pages. |
| `client/lib/admin/navigation.ts` | Finance group item "Card payments" → `/admin/finance/card-payments`, capability `finance.payments.read`, badge `cardPaymentsAttention`. |
| `client/app/[locale]/(admin)/admin/(panel)/finance/card-payments/page.tsx`, `[id]/page.tsx` | list and detail (section 15). |
| `client/components/admin/finance/CardPaymentsBrowser.tsx`, `CardPaymentDetail.tsx`, `PspModeBanner.tsx` | admin UI. |
| `client/lib/admin/help/articles/finance/card-payments.ts` (+ `index.ts`) | help article (CI gate). |
| `client/components/admin/AdminShell` (or the panel layout) | render `PspModeBanner` when `settings.mode === 'TEST'`. |
| `client/lib/api/finance.ts` | `getPaymentsSettings()` (`GET /api/admin/payments/settings`). |
| `client/.env.local.example` | nothing new (public API URL already there). |

No change to any booking creation component's validation, hold or idempotency logic.

---

## 8. Database changes and migration strategy

### 8.1 New enums (migration 1: `…_psp_enum_values`, values only, no tables)

```prisma
enum PaymentProvider { FLITT }
enum PspMode { TEST LIVE }
enum PspPaymentStatus {
  CREATED          // row inserted, Flitt not yet called
  REDIRECT_READY   // checkout_url obtained; guest may be on Flitt's page
  PROCESSING       // Flitt reports created/processing after the guest started paying
  APPROVED         // funds charged; PaymentRecord written
  DECLINED         // final decline (delayed=N) or expired after an attempt
  EXPIRED          // lifetime elapsed without approval
  CANCELLED        // guest used cancel_url or abandoned and we closed it
  REVERSED         // fully reversed at Flitt
  MISMATCH         // Flitt approved but amount/currency/merchant differ: needs a human
  FAILED           // Flitt create call failed permanently (no checkout_url)
}
enum PspRefundStatus { REQUESTED SUBMITTED APPROVED DECLINED FAILED }
```

Add to existing enums (same migration, since Postgres cannot use a new enum value in the transaction that adds it):

- `AuditAction`: `PSP_PAYMENT_CREATED, PSP_PAYMENT_APPROVED, PSP_PAYMENT_DECLINED, PSP_PAYMENT_EXPIRED, PSP_PAYMENT_MISMATCH, PSP_CALLBACK_REJECTED, PSP_REFUND_REQUESTED, PSP_REFUND_APPROVED, PSP_REFUND_FAILED, PSP_RECONCILIATION_MISMATCH, PSP_STATUS_CHECKED`.
- `NotificationKind`: `PSP_PAYMENT_MISMATCH, PSP_CALLBACK_REJECTED, PSP_REFUND_FAILED, PSP_RECONCILIATION_MISMATCH`.
- `PaymentMethod` already has `CARD`; no change.

### 8.2 New tables (migration 2: `…_psp_payments`)

```prisma
model PspPayment {
  id                 String           @id @default(cuid())
  /// Public reference, e.g. PAY-000001 (new sequence psp_payment_reference_seq).
  reference          String           @unique
  provider           PaymentProvider  @default(FLITT)
  mode               PspMode
  status             PspPaymentStatus @default(CREATED)
  receivableId       String           @map("receivable_id")
  receivable         Receivable       @relation(fields: [receivableId], references: [id])
  /// Denormalised for admin filters and guest access checks.
  debtorEmail        String           @map("debtor_email")
  bookingType        FinanceProduct?  @map("booking_type")   // HOTEL/TOUR/TRANSFER/SERVICE, null for an order
  bookingReference   String           @map("booking_reference") // BKG-/TUR-/TRF-/ORD-
  amountCents        Int              @map("amount_cents")
  currency           String           @db.Char(3)
  /// What Flitt says it actually charged, from actual_amount / actual_currency.
  actualAmountCents  Int?             @map("actual_amount_cents")
  actualCurrency     String?          @db.Char(3) @map("actual_currency")
  reversedCents      Int              @default(0) @map("reversed_cents")
  /// order_id sent to Flitt; unique per merchant, so prefixed per environment.
  merchantOrderId    String           @map("merchant_order_id")
  /// Flitt payment_id (integer(19) on their side; stored as text).
  providerPaymentId  String?          @map("provider_payment_id")
  providerTransactionId String?       @map("provider_transaction_id") // additional_info.transaction_id
  checkoutUrl        String?          @map("checkout_url")
  checkoutToken      String?          @map("checkout_token")   // reserved for Embedded
  providerOrderStatus String?         @map("provider_order_status") // raw last order_status
  responseCode       Int?             @map("response_code")
  responseDescription String?         @map("response_description")
  maskedCard         String?          @map("masked_card")      // 444455XXXXXX1111 only
  cardType           String?          @map("card_type")
  cardBin            String?          @map("card_bin")
  paymentSystem      String?          @map("payment_system")   // card / apple / google / opb
  approvalCode       String?          @map("approval_code")
  rrn                String?
  eci                String?
  paymentRecordId    String?          @unique @map("payment_record_id")
  paymentRecord      PaymentRecord?   @relation(fields: [paymentRecordId], references: [id])
  idempotencyKey     String           @unique @map("idempotency_key")
  lang               String?          @db.Char(2)
  createdIp          String?          @map("created_ip")
  lifetimeSeconds    Int              @map("lifetime_seconds")
  expiresAt          DateTime         @map("expires_at")
  redirectReadyAt    DateTime?        @map("redirect_ready_at")
  returnedAt         DateTime?        @map("returned_at")        // guest came back through response_url
  lastCallbackAt     DateTime?        @map("last_callback_at")
  lastStatusCheckAt  DateTime?        @map("last_status_check_at")
  completedAt        DateTime?        @map("completed_at")       // APPROVED/DECLINED/EXPIRED/…
  reconciledAt       DateTime?        @map("reconciled_at")
  failureReason      String?          @map("failure_reason")
  createdAt          DateTime         @default(now()) @map("created_at")
  updatedAt          DateTime         @updatedAt @map("updated_at")
  callbacks          PspCallbackEvent[]
  refunds            PspRefund[]

  @@unique([provider, mode, merchantOrderId])
  @@unique([provider, mode, providerPaymentId])
  @@index([receivableId, status])
  @@index([status, expiresAt])
  @@index([status, lastStatusCheckAt])
  @@index([debtorEmail])
  @@index([createdAt])
  @@map("psp_payments")
}

model PspCallbackEvent {
  id                String          @id @default(cuid())
  provider          PaymentProvider @default(FLITT)
  mode              PspMode
  /// sha256 of the raw body: identical retries become no-ops.
  bodyHash          String          @map("body_hash")
  merchantOrderId   String?         @map("merchant_order_id")
  providerPaymentId String?         @map("provider_payment_id")
  orderStatus       String?         @map("order_status")
  signatureValid    Boolean         @map("signature_valid")
  sourceIp          String?         @map("source_ip")
  /// Redacted copy: card number already masked by Flitt; sender_email kept; secret never present.
  payload           Json
  paymentId         String?         @map("payment_id")
  payment           PspPayment?     @relation(fields: [paymentId], references: [id])
  receivedAt        DateTime        @default(now()) @map("received_at")
  processedAt       DateTime?       @map("processed_at")
  error             String?
  @@unique([provider, bodyHash])
  @@index([processedAt, receivedAt])
  @@map("psp_callback_events")
}

model PspRefund {
  id                 String          @id @default(cuid())
  paymentId          String          @map("payment_id")
  payment            PspPayment      @relation(fields: [paymentId], references: [id])
  status             PspRefundStatus @default(REQUESTED)
  amountCents        Int             @map("amount_cents")
  currency           String          @db.Char(3)
  /// Sent to Flitt as reverse_id (≤ 50 chars) — the idempotent key per attempt.
  reverseId          String          @unique @map("reverse_id")
  approvalRequestId  String?         @map("approval_request_id")
  paymentRecordId    String?         @unique @map("payment_record_id")
  providerTransactionId String?      @map("provider_transaction_id")
  responseCode       Int?            @map("response_code")
  responseDescription String?        @map("response_description")
  reason             String
  requestedByUserId  String?         @map("requested_by_user_id")
  attempts           Int             @default(0)
  lastError          String?         @map("last_error")
  submittedAt        DateTime?       @map("submitted_at")
  completedAt        DateTime?       @map("completed_at")
  createdAt          DateTime        @default(now()) @map("created_at")
  updatedAt          DateTime        @updatedAt @map("updated_at")
  @@index([paymentId, status])
  @@map("psp_refunds")
}
```

Relations added on existing models: `Receivable.pspPayments PspPayment[]`, `PaymentRecord.pspPayment PspPayment?`, `PaymentRecord.pspRefund PspRefund?`.

### 8.2b Payment policy extension (same migration 2, additive)

```prisma
model PaymentPolicy {
  // existing fields unchanged …
  /// Owners besides hotels. At most one of hotelId/tourId/packageId/transferProviderId is set;
  /// all null = platform template (isTemplate) usable by every item of `productKind`.
  tourId             String?  @map("tour_id")
  packageId          String?  @map("package_id")
  transferProviderId String?  @map("transfer_provider_id")
  productKind        FinanceProduct? @map("product_kind")   // which product a template is for; null = hotel (legacy rows)
  /// PAY_NOW only: hours after booking before an unpaid guest booking is cancelled. Null = never.
  unpaidCancelHours  Int?     @default(24) @map("unpaid_cancel_hours")
  /// PAY_AT_HOTEL only: also offer card at checkout.
  cardOptional       Boolean  @default(false) @map("card_optional")
  tourOptions        TourOption[]
  packages           Package[]
  transferProviders  TransferProvider[]
}
// TourOption, Package, TransferProvider: paymentPolicyId String? @map("payment_policy_id") + relation (onDelete: Restrict)

model Receivable {
  // existing fields unchanged …
  paymentTiming     PaymentTiming? @map("payment_timing")      // frozen at creation (section 4.4)
  unpaidCancelHours Int?           @map("unpaid_cancel_hours")
  autoCancelAt      DateTime?      @map("auto_cancel_at")      // PAY_NOW guests only
  autoCancelledAt   DateTime?      @map("auto_cancelled_at")
  @@index([autoCancelAt, status])
}
```

SQL: CHECK `payment_policies_single_owner` (`num_nonnulls(hotel_id, tour_id, package_id, transfer_provider_id) <= 1`), CHECK `payment_policies_unpaid_hours_range (unpaid_cancel_hours IS NULL OR unpaid_cancel_hours BETWEEN 1 AND 720)`. Seed (`scripts/seed-reference.js` + `policyCatalog.service.js` `ensureTemplates`): one platform template per product kind as described in section 4.4. Existing hotel policies are untouched (`productKind` null = hotel).

Serialisers: `toPaymentPolicy` gains `unpaidCancelHours`, `cardOptional`, `productKind`; tour offers (`services/tour/pricing.service.js` offer payload), package quotes (`services/package/quote.service.js`) and transfer quotes (`services/transfer/quote.service.js`) gain `payment: { timing, unpaidCancelHours, cardOptional, name }` so the checkout form knows the rule before the booking exists, exactly as hotel offers do today.

SQL in the migration beyond what Prisma generates: `CREATE SEQUENCE psp_payment_reference_seq;` (and `REFERENCE_KINDS.pspPayment = { sequence: 'psp_payment_reference_seq', prefix: 'PAY', digits: 6 }` in `server/lib/reference.js`); CHECK constraints `psp_payments_amount_positive (amount_cents > 0)`, `psp_payments_reversed_bounded (reversed_cents BETWEEN 0 AND amount_cents)`, `psp_refunds_amount_positive`.

### 8.3 Why not reuse `PaymentRecord` alone

`PaymentRecord` is the ledger entry for money that moved; a card attempt that never completes must not appear there, and a declined attempt must be visible to support. `PspPayment` is the attempt/intent; `PaymentRecord` is written exactly once per approved attempt (unique `paymentRecordId`, unique `idempotencyKey = flitt:<mode>:<providerPaymentId>`), satisfying the house rule "ledger is the source of truth; append-only".

### 8.4 Migration strategy

- Two migrations, named with hand-picked timestamps that sort after the latest existing one (`20261020150000…`) and in the order enum → tables (see memory note on hand-named migration timestamps).
- Additive only: no existing column changes, so the deployed client keeps working during rollout (`docs/DEPLOYMENT.md` §1 rule).
- `prisma migrate deploy` runs in Render `preDeployCommand` and in CI before tests; CHECK constraints and the sequence are added in the SQL file (Prisma diff will not be clean, which matches the repository's existing state).
- Rollback: tables are unreferenced by old code; `FLITT_ENABLED=false` disables every route, timer and UI entry without a schema rollback.

---

## 9. Backend API contracts

All responses use the existing envelope; errors are `{ error: { message, details: { reason } } }`.

### 9.1 Guest routes (`server/routes/payments.routes.js`, `optionalAuthenticate`)

**`POST /api/payments`** — create a card payment for an open receivable. Rate-limited by `paymentCreateLimiter`.

```json
// request
{ "reference": "BKG-000123", "email": "guest@example.com", "idempotencyKey": "psp-…", "locale": "ka" }
// 201
{ "id": "clx…", "reference": "PAY-000045", "status": "REDIRECT_READY", "mode": "TEST",
  "amountCents": 189500, "currency": "GEL", "checkoutUrl": "https://pay.flitt.com/merchants/…",
  "expiresAt": "2026-11-03T12:30:00.000Z", "token": "<return token>" }
```

Rules: `reference` is a booking or order reference; access is the same guest rule as `assertMayRead` (email must match the receivable's `debtorEmail`; staff with `finance.payments.write` may also create one, e.g. for a desk sale, out of MVP). Refuses with `409 RECEIVABLE_NOT_PAYABLE` if the receivable is not `OPEN`/`PARTIAL`, `409 CARD_NOT_OFFERED` if the frozen `paymentTiming` is `PAY_AT_HOTEL` without `cardOptional` or `CREDIT_ACCOUNT`, `410 BOOKING_CANCELLED` if the booking was auto-cancelled or cancelled, `409 PARTNER_RECEIVABLE` if `debtorPartnerId` is set (partners settle on terms), `409 PAYMENT_IN_PROGRESS` with the existing payment if one is `REDIRECT_READY`/`PROCESSING` and younger than `FLITT_REUSE_WINDOW_SECONDS` (default 120; the response then **returns the existing checkoutUrl**, so repeated clicks reuse one Flitt order), `503 PAYMENTS_DISABLED` when `FLITT_ENABLED=false`, `502 PROVIDER_UNAVAILABLE` when Flitt is down (the row is left `FAILED` with `failureReason`). Amount = `receivable.amountCents - receivable.paidCents` (full balance; partial amounts are a later option). Idempotency: `Idempotency-Key` header or body key, unique on `psp_payments.idempotency_key`, replay returns the same payment (P2002 race returns the winner, as in `recordPayment`).

**`GET /api/payments/:id?t=<token>`** — guest status. The token is the HMAC return token issued at creation (so no email in URLs); a staff session with `finance.payments.read` needs no token.

```json
{ "id": "clx…", "reference": "PAY-000045", "status": "APPROVED", "mode": "TEST", "amountCents": 189500,
  "currency": "GEL", "bookingReference": "BKG-000123", "maskedCard": "444455XXXXXX1111", "cardType": "VISA",
  "completedAt": "…", "checkoutUrl": null, "canRetry": false, "receivable": { "status": "PAID", "paidCents": 189500 } }
```

Side effect: when the status is not final and `lastStatusCheckAt` is older than `FLITT_STATUS_POLL_MIN_SECONDS` (5), the handler calls `refreshFromProvider` (section 11.4) before answering. This is what makes local development and lost callbacks converge.

**`POST /api/payments/:id/retry`** (token or session) — allowed only from `DECLINED`, `EXPIRED`, `CANCELLED`, `FAILED` and while the receivable is still open; creates a **new** `PspPayment` (new `merchantOrderId`) and answers like `POST /api/payments`. The old row is kept for history.

### 9.2 Provider routes (`server/routes/payments.flitt.routes.js`, no session, no CSRF, own limiter)

**`POST /api/payments/flitt/callback`** — raw body. Always answers quickly:

| Outcome | HTTP | Body |
|---|---|---|
| Signature valid, stored (new) | 200 | `{ "received": true }` |
| Signature valid, duplicate body | 200 | `{ "received": true, "duplicate": true }` |
| Signature invalid, unknown merchant, wrong mode, body unparsable | **400** (so Flitt retries at most per its schedule and the rejection is visible), audit `PSP_CALLBACK_REJECTED`, notification | `{ "error": { "message": "Callback rejected" } }` |
| Payments disabled | 404 | |

Processing of a stored event is asynchronous (section 11.3) but kicked immediately after the response (`setImmediate(applyCallbackEvents)`), so the normal path completes within a second.

**`GET|POST /api/payments/flitt/return/:id/:token`** — the `response_url`. Ignores any body or query parameters except for logging the presence of `order_status` at debug level; validates the token; stamps `returnedAt`; answers `303 See Other` to `${APP_URL}/<locale>/booking/payment/<id>?t=<token>`. It never changes a payment status. The same route (with `?cancel=1`) is used as `cancel_url`, marking `CANCELLED` **only** if the row is still `REDIRECT_READY` and a subsequent status fetch reports `created`/`expired`.

### 9.3 Staff routes (`server/routes/admin.payments.routes.js`, `authenticate`)

| Route | Capability | Purpose |
|---|---|---|
| `GET /api/admin/payments/settings` | staff | `{ enabled, provider: 'FLITT', mode, merchantId, callbackUrl, apiBaseUrl }` (never the secret) — drives the test-mode banner. |
| `GET /api/admin/payments` | `finance.payments.read` | list; filters `status`, `mode`, `q` (reference, booking reference, email, providerPaymentId), `from`, `to`, `attention=1`; paged `{ data, total, page, pageSize, totalPages }`. |
| `GET /api/admin/payments/:id` | `finance.payments.read` | detail incl. `callbacks[]` (redacted payloads), `refunds[]`, linked `paymentRecord`, `receivable`, audit trail. |
| `POST /api/admin/payments/:id/check-status` | `finance.payments.write` | force `refreshFromProvider`; audit `PSP_STATUS_CHECKED`. |
| `POST /api/admin/payments/:id/refunds` | `finance.refunds.request` | opens an `ApprovalRequest` of kind `REFUND` with `payload.pspPaymentId`, `amountCents` ≤ `actualAmountCents - reversedCents`; approval and execution follow the existing maker-checker routes `/api/admin/approvals/:id/approve`. |
| `POST /api/admin/payments/:id/resolve-mismatch` | `finance.refunds.approve` | moves `MISMATCH` to `APPROVED` (recording the payment with the amount Flitt actually charged) or to `REVIEW_CLOSED`-style note; always audited; MVP-optional. |
| `GET /api/admin/payments/reconciliation` | `finance.reports.read` | last run summary and open mismatches (Phase 6). |

### 9.4 Flitt outbound requests (adapter, `server/lib/integrations/flitt/client.js`)

| Call | Endpoint | Body built by the adapter |
|---|---|---|
| create | `POST {FLITT_API_BASE_URL}/api/checkout/url` | `version "1.0.1"`, `order_id`, `merchant_id`, `order_desc` ("I am Georgia booking BKG-000123" in Latin letters, ≤ 1024), `amount` (int), `currency`, `response_url`, `server_callback_url`, `cancel_url`, `lifetime`, `delayed: "N"`, `lang` (en/ka/ru; he → en), `sender_email`, `merchant_data` (`JSON.stringify({ paymentId, reference, mode })`), `product_id` (booking reference), `signature` |
| status | `POST …/api/status/order_id` | `order_id`, `merchant_id`, `version`, `signature` |
| reverse | `POST …/api/reverse/order_id` | `order_id`, `merchant_id`, `amount`, `currency`, `reverse_id`, `comment`, `email` (staff email), `signature` |

`Content-Type: application/json; charset=utf-8`, `User-Agent: iamgeorgia-api/<version>`, `AbortSignal.timeout(FLITT_REQUEST_TIMEOUT_MS)` (default 15 s). Every response's `signature` is verified; a response with `response_status: failure` becomes `UnprocessableEntityError` for 1007/1008/1009/1011/1012/1013/1014/1016/1018/1019/1023/1084 and `BadGatewayError` otherwise, carrying `error_code` and `request_id` in `details`.

---

## 10. Frontend implementation details

### 10.1 Design system

Reuse the booking components and tokens already used by `CheckoutForm.tsx` (cards, `BookingSteps`, primary button, error banners), `StatusBadge` colours, and the `fill()` interpolation. No new UI library. All strings from the `payment` dictionary block; RTL verified for `he`.

### 10.2 Checkout step

- `PaymentMethodChoice` renders under the order summary on each checkout form: **"Pay securely by card"** (Visa, Mastercard, Apple Pay, Google Pay icons as plain SVGs; subtitle "You will be taken to our payment provider Flitt to complete the payment") and **"Pay later"** (existing behaviour; label per product: "Pay at the property" / "Settle with the operator"). **Which options appear comes from the offer's `payment` policy (section 4.4 matrix)**: `PAY_NOW` shows card only with the sentence "Payment is required to confirm this booking. Unpaid bookings are cancelled after {hours} hours"; `PAY_LATER` shows both, card preselected; `PAY_AT_HOTEL` shows pay-later only unless `cardOptional`. Whether card payment is available at all comes from `GET /api/payments/settings` (public subset: `{ enabled, mode }`; cached per page load), so the UI degrades to today's flow when disabled, and a `PAY_NOW` item with payments disabled falls back to pay-later with a server-side `autoCancelAt` of null (nothing is auto-cancelled while the gateway is off).
- Order summary already shows currency and total; add the line "Charged now: ₾1,895.00 GEL" (full balance) and, in test mode, a yellow chip "Test payments — no real money is charged".
- Button label switches to "Pay securely" when card is chosen. On submit: existing `confirmBooking` → on success `createPayment({ reference, email, idempotencyKey: draft.idempotencyKey + ':pay' })` → `window.location.assign(checkoutUrl)`. Double-clicks are prevented by `submitting`, and the server's reuse window returns the same URL anyway.
- If `createPayment` fails after the booking succeeded, the user is sent to the confirmation page with an inline notice "Your booking is confirmed; we could not start the card payment. Try again from this page", with the "Pay now" button (no second booking is ever created).

### 10.3 Result page `/booking/payment/[paymentId]?t=<token>`

Server component reads the payment with `serverFetch` (token in query); a client `PaymentResultView` polls `GET /api/payments/:id` every 3 s for up to 2 minutes while the status is not final, then every 15 s up to 10 minutes, then shows the pending state with a "Check again" button.

| Server status | Screen | Actions |
|---|---|---|
| `REDIRECT_READY`, `PROCESSING` | spinner "Confirming your payment with the bank… Do not close this page" (safe to close; the booking page shows the result too) | none |
| `APPROVED` | success: amount, masked card, payment reference `PAY-…`, booking reference, "Receipt sent to <email>", link to the booking confirmation | "View booking" |
| `DECLINED` | failed: decline reason mapped to friendly text by `response_code` (1037 insufficient funds, 1003 CVV, 1024 3DS…), "No money was taken" | "Try again" (→ `POST /retry` → redirect), "Pay later" (→ confirmation page) |
| `EXPIRED`, `CANCELLED` | cancelled: "The payment was not completed" | "Try again", "Pay later" |
| `FAILED` | "We could not reach the payment provider" | "Try again" |
| `MISMATCH` | pending-review: "Your payment is being verified. We will email you." | none |
| unknown (network error) | pending-unknown with the reference and support email | "Check again" |

Refreshing, closing the tab, or navigating back never changes state: the page only reads. The confirmation and manage pages show the same `PaymentStatusPanel` so the guest can always find the outcome by reference + email.

### 10.4 Confirmation and manage pages

A "Payment" card: receivable status (Open / Partially paid / Paid), last card attempt summary, and "Pay now" when open and payments enabled. For ON_REQUEST tours and pending orders the card says "You will be able to pay once the booking is confirmed", and the confirmation email carries the pay link.

### 10.5 Copy and legal

Rewrite the strings in section 2.11 in all four languages: "Pay securely by card (processed by Flitt) or settle with the property", privacy policy ("Card payments are processed by Flitt; we never see or store card numbers; we store the masked card, amount and result"), terms (refund timing: "Refunds go back to the card used, usually within 3–10 business days"). Georgian, Russian and Hebrew translations are produced with the existing dictionary structure and marked for native review (owner task).

---

## 11. Callback and signature verification design

### 11.1 Signature module (`server/lib/integrations/flitt/signature.js`)

```js
// Pure; no config import, so unit tests can run without the database.
export const canonicalString = (secret, params) => {
  const keys = Object.keys(params)
    .filter((k) => k !== 'signature' && k !== 'response_signature_string')
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();                                   // byte order, as the PHP ksort/Python sorted examples
  return [secret, ...keys.map((k) => String(params[k]))].join('|');
};
export const sign = (secret, params) =>
  createHash('sha1').update(canonicalString(secret, params), 'utf8').digest('hex');
export const verify = (secret, params) => {
  const presented = typeof params.signature === 'string' ? params.signature.toLowerCase() : '';
  const expected = sign(secret, params);
  return presented.length === 40 && timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
};
```

Values are the **lexical** forms: the request builder only ever puts strings and integers in; the callback parser (11.2) keeps number source text. Verified live (3.9).

### 11.2 Callback parsing (`parse.js`)

- Mounted with `express.raw({ type: ['application/json', 'application/x-www-form-urlencoded'], limit: '64kb' })` on the callback path only; a non-Buffer body is rejected with 400.
- JSON: `JSON.parse(text, (key, value, ctx) => typeof value === 'number' && ctx?.source ? ctx.source : value)` (Node 24 verified). Form-encoded fallback (`URLSearchParams`), because Flitt's redirect family of endpoints is form-based and OQ1 is open.
- Top-level object only, all values must be scalars (string/number/boolean/null); nested objects are refused (Flitt sends `additional_info` as a string).
- `bodyHash = sha256(rawBody)`.
- zod `callbackSchema` requires `order_id`, `merchant_id`, `order_status`, `amount`, `currency`, `signature`; everything else optional and passthrough.

### 11.3 Ingest then apply (`flitt-callback.service.js`)

1. **Config gate**: `FLITT_ENABLED` else 404.
2. **Parse** (11.2); failure → 400 + audit.
3. **Verify signature** with the configured secret (`verify`). Invalid → store inbox row with `signatureValid=false` (payload redacted to `order_id`, `merchant_id`, `order_status`, `amount`, `currency`, `payment_id` and the presented signature), audit `PSP_CALLBACK_REJECTED`, notification `PSP_CALLBACK_REJECTED` to finance ops, respond **400**.
4. **Merchant and mode**: `merchant_id` must equal `config.payments.flitt.merchantId`; in live mode `additional_info.is_test` (when present) must be `false`; in test mode it must not be `false`. Mismatch → reject as in 3.
5. **Source IP**: compare `req.ip` (behind `TRUST_PROXY`) against `FLITT_CALLBACK_IPS`. Live mode with `FLITT_CALLBACK_IP_ENFORCE=true` (default when deployed): reject. Otherwise: log a warning and continue (test mode, tunnels).
6. **Store** `PspCallbackEvent` via `createMany({ skipDuplicates: true })` keyed on `[provider, bodyHash]`; link `paymentId` by `merchantOrderId` lookup; respond 200 `{received, duplicate}`.
7. **Apply** (`applyCallbackEvents`, also run by the sweeper under `lockKey('psp_apply')`): for each unprocessed event with a valid signature, call `refreshFromProvider(payment)` (11.4), **not** the callback's own fields, then mark `processedAt`. A callback for an unknown `order_id` is stored, marked processed with `error: 'UNKNOWN_ORDER'`, and raises an alert (it may be a forged or mis-routed callback).

The callback body is therefore only a *trigger*; the state comes from Flitt's status endpoint under our own signed request. This closes forged-callback, replayed-callback, out-of-order and wrong-amount attacks in one place, mirrors the InvoiceOcean design already in production, and matches the house rule "re-fetch from the PSP before acting".

### 11.4 `refreshFromProvider` and the single transition function

```
refreshFromProvider(paymentId):
  status = flitt.getOrderStatus({ order_id })         // outside any DB transaction; 502 on outage
  return applyProviderStatus(paymentId, status)

applyProviderStatus(paymentId, s):                      // one Prisma transaction
  payment = SELECT … FOR UPDATE (lockRows 'psp_payments')
  assert s.merchant_id == config merchantId
  assert s.order_id == payment.merchantOrderId
  next = mapOrderStatus(s.order_status)                 // created→REDIRECT_READY, processing→PROCESSING,
                                                        // approved→APPROVED, declined→DECLINED, expired→EXPIRED, reversed→REVERSED
  if rank(next) < rank(payment.status) and not (payment.status==APPROVED and next==REVERSED): no-op (out of order / stale)
  if next == APPROVED:
      actual = toCents(s.actual_amount || s.amount); cur = s.actual_currency || s.currency
      if actual != payment.amountCents or cur != payment.currency or toCents(s.amount) != payment.amountCents:
          transition → MISMATCH, store actual*, audit PSP_PAYMENT_MISMATCH, notify, return
      if payment.paymentRecordId == null:
          record = recordPaymentInTx(tx, { direction:'IN', kind:'PAYMENT', method:'CARD',
                    currency, amountCents: actual, counterparty from receivable,
                    allocations: [{ receivableId, amountCents: actual }],
                    idempotencyKey: `flitt:${mode}:${s.payment_id}`, externalPaymentId: String(s.payment_id),
                    reference: s.rrn || null, paidAt: parseFlittTime(s.order_time), note: mode==TEST ? 'TEST MODE' : null },
                    actor=null /* system */, req)
          payment.paymentRecordId = record.id
      store masked_card, card_type, card_bin, approval_code, rrn, eci, payment_system, providerPaymentId, transaction_id
      transition → APPROVED, completedAt; audit PSP_PAYMENT_APPROVED; enqueue psp.payment.approved (receipt)
  if next in (DECLINED, EXPIRED): store response_code/description; transition; audit; enqueue psp.payment.failed
  if next == REVERSED or s.reversal_amount > 0: reversedCents = toCents(s.reversal_amount); mark REVERSED when == actualAmountCents
  lastStatusCheckAt = now
```

`recordPaymentInTx` already updates `Receivable.paidCents/status`, fires `onReceivablePaidInTx` (InvoiceOcean VAT invoice), writes `PAYMENT_RECORDED` audit and the `finance.payment.recorded` outbox event. `recordedByUserId` is nullable, `actorEmail` becomes `'system'` (`lib/audit.js:22`). The transaction never performs HTTP.

Concurrency: two callbacks or a callback plus a page poll apply at the same time → the row lock serialises them; the second sees `APPROVED` and is a no-op; the unique `idempotencyKey` on `payment_records` is the last line of defence against a double ledger entry.

### 11.5 Return route

The `response_url`/`cancel_url` carry a per-payment HMAC token (`returnToken.js`: `base64url(hmacSha256(secret, paymentId))[0:32]`). The route verifies it, stamps `returnedAt`, and 303-redirects. It is mounted before `verifyRequestOrigin` because Flitt may `POST` cross-site (OQ1), and it is excluded from the global limiter but has its own limiter (60/min per IP). It performs no state change on its own.

---

## 12. Security and failure handling

| Threat / failure | Control |
|---|---|
| Forged callback | SHA-1 signature over all fields with the merchant secret (11.1), merchant id check, live-mode IP allowlist, **and** state only ever taken from our own signed status fetch (11.3/11.4). In test mode the secret is public, so test mode can never be enabled in production (13.3). |
| Invalid signature | 400, inbox row kept for forensics, audit + notification; repeated rejections from one IP are rate-limited. |
| Duplicate callback delivery | unique `(provider, bodyHash)`; apply is idempotent; monotonic status ranks. |
| Replay of an old callback | same as above; a replayed `approved` after `REVERSED` is lower-ranked and ignored; the status fetch is authoritative anyway. |
| Amount or currency manipulation | the client never sends an amount; `amount` is derived from the receivable on the server; approval requires `actual_amount == amount == amountCents` and both currencies equal, otherwise `MISMATCH` (never recorded, human review). |
| Currency not enabled for the merchant | `1012` → `UnprocessableEntityError` → 502-class message to the guest; configuration assertion lists `FLITT_CURRENCIES` (default `GEL`) and `createPayment` refuses other currencies before calling Flitt. |
| Unauthorized refund | refunds exist only through `ApprovalRequest` (maker-checker: `finance.refunds.request` to open, `finance.refunds.approve` to approve, self-approval refused, `finance.refunds.execute` withheld from SUPER_ADMIN); amount ≤ `actualAmountCents - reversedCents`; audit rows name requester and approver; separate limiter on refund routes. |
| Double payment processing | one `PaymentRecord` per approved attempt (unique `paymentRecordId`, unique ledger `idempotencyKey`); `createPayment` reuses an in-flight attempt within the reuse window; a second approved attempt for an already-`PAID` receivable is recorded (money did move) but flagged `MISMATCH`-class alert "overpayment" for refund by finance. |
| Race conditions | `SELECT … FOR UPDATE` on the payment row; `lockKey('psp_apply')` for the sweeper; outbox lease for emails and refunds. |
| Network failure to Flitt on create | row `FAILED` with reason; guest sees "could not reach provider", can retry (new order id). A timeout on create is **not** retried blindly: the adapter first calls status for the same `order_id`; `1018 Order not found` → safe to retry with the same id; otherwise adopt the existing order. |
| Network failure on status fetch | `BadGatewayError`; the page shows pending; sweeper retries with backoff; nothing is marked paid or failed. |
| Database failure after Flitt approved | the callback was answered before apply; the inbox row stays unprocessed and the sweeper retries; Flitt also retries the callback for 24 h; status fetch is idempotent, so no money is lost or double-recorded. |
| Server restart mid-payment | all state is in Postgres; timers restart; the result page polls. |
| Expired payment | `lifetime` (default 1800 s) → `expired`; sweeper marks rows past `expiresAt + 5 min` by fetching status; guest can retry. |
| Leaked merchant secret | lives only in the environment, read once by `config.js`; redacted in logs; never serialised in any API response (`settings` endpoint omits it); rotation = env change + restart (Render secret); test and live secrets are different variables in different environments. |
| Incorrect state transitions | `defineMachine` tables with explicit ranks; a transition outside the table throws and is logged; tests enumerate every pair. |
| Logs | redact `signature`, `masked_card` (keep in DB, not logs), `sender_email`, `rectoken`, secret; log vendor `request_id` and our payment reference at `warn/error`. No PAN or CVV ever reaches our systems (hosted page). |
| Callback endpoint abuse (DoS) | 64 kB raw limit, dedicated limiter, cheap rejection path (hash + signature) before any DB write beyond the inbox. |
| CSRF | guest `POST /api/payments` stays behind `verifyRequestOrigin`; provider routes carry no cookies and are before it. |
| SameSite=Strict on return | guest pages need no session; staff/partner card payments are out of MVP. |

---

## 13. Test-mode configuration

### 13.1 Variables (`server/config.js` → `config.payments.flitt`)

| Variable | Test value | Notes |
|---|---|---|
| `FLITT_ENABLED` | `true` | master switch; `false` hides routes, timer and UI (default `false`, `.env.test` pins `false`) |
| `FLITT_MODE` | `test` | `test` or `live`; stamped on every row |
| `FLITT_MERCHANT_ID` | `1549901` | integer |
| `FLITT_SECRET_KEY` | `test` | payment key; never the payout key |
| `FLITT_API_BASE_URL` | `https://pay.flitt.com` | same host in both modes per docs; overridable for the test stub |
| `API_PUBLIC_URL` | preview: `https://api.preview.iamgeorgia.com.ge`; local: a tunnel URL | **new**; the API's own public origin. Production is `https://api.iamgeorgia.com.ge` (owner, 2026-11-03) |
| `FLITT_CALLBACK_URL` | derived: `${API_PUBLIC_URL}/api/payments/flitt/callback` | explicit override allowed (tunnels) |
| `FLITT_RETURN_URL` | derived: `${API_PUBLIC_URL}/api/payments/flitt/return` | explicit override allowed; `/:id/:token` appended per payment |
| `FLITT_RETURN_TOKEN_SECRET` | random ≥ 32 chars | `generateValue` on Render |
| `FLITT_ORDER_PREFIX` | `IAGT-<shortname>` | prefix for `merchantOrderId` (`<prefix>-PAY-000045-<6 random>`); avoids collisions on the shared public merchant |
| `FLITT_ORDER_LIFETIME_SECONDS` | `1800` | 30 min |
| `FLITT_REQUEST_TIMEOUT_MS` | `15000` | |
| `FLITT_CURRENCIES` | `GEL` | allowlist for `createPayment` |
| `FLITT_CALLBACK_IPS` | `54.154.216.60,3.75.125.89` | |
| `FLITT_CALLBACK_IP_ENFORCE` | `false` in test, `true` in live | |
| `FLITT_REUSE_WINDOW_SECONDS` | `120` | |
| `FLITT_STATUS_POLL_MIN_SECONDS` | `5` | |
| `FLITT_SWEEP_INTERVAL_MS` | `60000` | |
| `FLITT_DESIGN_ID` | empty | Merchant Portal design preset, optional |

### 13.2 Boot assertions (`assertPaymentsConfig`)

- `FLITT_ENABLED=true` requires `FLITT_MODE`, `FLITT_MERCHANT_ID` (integer), `FLITT_SECRET_KEY`, `API_PUBLIC_URL` (https when deployed), `FLITT_RETURN_TOKEN_SECRET` (≥ 32).
- `FLITT_MODE=test`: merchant must be `1549901` **or** listed in `FLITT_TEST_MERCHANT_IDS` (the owner's own merchant while Flitt keeps it in test status); secret may be `test`.
- `FLITT_MODE=live`: merchant must **not** be `1549901`/a listed test merchant and the secret must not be `test`; `FLITT_CALLBACK_IP_ENFORCE` defaults to `true`.
- **Deployed + `NODE_ENV=production` + `FLITT_MODE=test`** is refused unless `FLITT_ALLOW_TEST_MODE_WHEN_DEPLOYED=true` (intended only for the preview environment). This is what makes "live transactions impossible while test mode is enabled" and the converse: a production deploy cannot silently run on the public test merchant.

### 13.3 Test-mode indicators

- Admin: `PspModeBanner` (amber, every panel page) "Card payments run in Flitt TEST mode (merchant 1549901). No real money moves."; `mode` column and filter in the card-payments list; payment records written in test mode carry `note: 'TEST MODE'`.
- Guest checkout: chip "Test payments" and the test card hint only when `mode=TEST` (text explicitly says no charge is made).
- Emails: subject prefix `[TEST]` on receipts when `mode=TEST`.
- Payment reference prefix stays `PAY-`; the `merchantOrderId` prefix `IAGT-` distinguishes test orders in Flitt's portal.

### 13.4 Local development

Flitt cannot call `localhost`. Two supported setups: (a) run without a public URL and rely on the result-page polling and sweeper (callbacks never arrive; everything still converges); (b) set `API_PUBLIC_URL` to a tunnel and `FLITT_CALLBACK_IP_ENFORCE=false`. The Phase 0 spike uses the public preview API `https://api.preview.iamgeorgia.com.ge` (Render behind Cloudflare, auto-deployed from `main`), with `FLITT_MODE=test` and `FLITT_ALLOW_TEST_MODE_WHEN_DEPLOYED=true`. The production API `https://api.iamgeorgia.com.ge` never carries test credentials.

---

## 14. Automated testing strategy

Framework and layout follow `server/test/*.test.js` with `node:test` + supertest and the stub pattern of `test/support/invoiceocean.stub.js`; `.env.test` keeps `FLITT_ENABLED=false` globally and each payment test file enables it against the stub via `Object.assign(config.payments.flitt, {...})` and restores it.

### 14.1 Unit (no database)

- `signature.unit`: canonical string drops `''`/`null`, keeps `0` and `"0"`, sorts, excludes `signature`/`response_signature_string`; vectors recorded from the live probe (section 3.9) so the exact bytes are pinned; `verify` is constant-time and case-tolerant.
- `parse.unit`: number source preservation (`1549901`, `0.0`, `1.0`), rejects nested objects, 64 kB limit, form-encoded fallback, `bodyHash` stability.
- `status.unit`: `mapOrderStatus` for all six Flitt statuses + unknown → throws; `rank` monotonicity; `toCents` rejects `"1.0"`, `"-1"`, `""`.
- `machines.unit`: every (from, to) pair for `pspPaymentMachine` and `pspRefundMachine`.
- `returnToken.unit`.

### 14.2 Stub-server flow tests (`payments.flow.test.js`)

The stub implements `/api/checkout/url`, `/api/checkout/token`, `/api/status/order_id`, `/api/reverse/order_id`, verifies incoming signatures with the test secret and signs its responses; `stub.setOrderStatus(order_id, {order_status, amount, …})`, `stub.failNext(status, {path, times})`, `stub.delayMs`, `stub.sendCallback(app, order_id)` posts a correctly signed callback to the app under test.

Scenarios (each maps to section 9 of the brief):

1. Successful Visa, successful Mastercard (card_type differs only): create → stub approved → callback → `APPROVED`, `PaymentRecord(method CARD)`, receivable `PAID`, receipt outbox event, audit rows; replaying the callback and polling afterwards change nothing.
2. Declined: callback `declined` with `response_code 1000` → `DECLINED`, `canRetry: true`, receivable still `OPEN`, failed-email outbox event; retry creates a second row with a new `merchantOrderId`; the old row is untouched.
3. 3DS approve/decline: identical to 1/2 from the server's view (`eci` stored); asserted by fixture.
4. Cancelled: return route with `?cancel=1` while stub says `created` → `CANCELLED`; while stub says `approved` → ignored and `APPROVED` wins.
5. Expired: stub `expired` → `EXPIRED` via sweeper; past `expiresAt` without any callback → sweeper fetches and sets `EXPIRED`.
6. Duplicate callback: same body twice → `duplicate: true`, one inbox row, one ledger row.
7. Invalid signature: 400, inbox row `signatureValid=false`, audit `PSP_CALLBACK_REJECTED`, notification, no state change.
8. Wrong amount / wrong currency / wrong merchant id in the stub's status: `MISMATCH`, no `PaymentRecord`, notification; admin `resolve-mismatch` path.
9. Repeated checkout clicks: three concurrent `POST /api/payments` with the same idempotency key → one row; with different keys inside the reuse window → same `checkoutUrl` returned (`409`-style reuse answer with 200 and `reused: true`).
10. Concurrent payment attempts: two approvals racing on one receivable → second ends `APPROVED` with an "overpayment" alert and the receivable `paidCents > amountCents` is reported; (asserts no crash and both ledger rows exist).
11. Browser refresh / user leaves before returning: `GET /api/payments/:id` with the stub at `processing` then `approved` → state converges without any callback.
12. Server restart: inbox row left unprocessed → `sweepPspPayments` processes it on the next tick.
13. Temporary Flitt outage: `failNext(503)` on create → `FAILED` + `502 PROVIDER_UNAVAILABLE`; on status → pending, retried later; timeout on create followed by `1018` on status → safe retry with the same order id.
14. Delayed or missing callback: no callback at all; sweeper after `FLITT_STATUS_POLL_MIN_SECONDS` fetches → converges.
15. Reconciliation: stub reports `reversal_amount` for an `APPROVED` row → `reversedCents` updated, `REVERSED` when full, mismatch notification when our ledger disagrees.
16. Refund: approval request → approve → `PspRefund SUBMITTED` → stub `reverse_status approved` → `PaymentRecord(kind REFUND)` with negative allocation, receivable `PARTIAL`/`OPEN`; stub `declined` → `FAILED` + notification; retried after a network error with the **same** `reverse_id`; refund > remaining → 422.
17. Database failure recovery: inject a failing `recordPaymentInTx` (stub Prisma error once) → transaction rolls back, inbox row keeps `error`, next sweep succeeds, exactly one ledger row.
18. Out-of-order: `approved` applied, then a stale `processing` callback → ignored.
19. CSRF and limiter: callback with `Origin: https://evil.example` still accepted (no cookie, before CSRF); `POST /api/payments` with `Sec-Fetch-Site: cross-site` → 403; callback path not counted by `globalLimiter` (`ratelimit` test pattern).
20. Redaction (`logger.redaction.test.js` extension): a logged callback body shows `signature: [Redacted]`.
21. RBAC matrix regeneration (`rbac.matrix.test.js`): new routes with expected capabilities; guest routes open; admin routes 401/403 for the wrong roles.
22. Test-mode guards: `FLITT_MODE=test` with merchant `999` → boot assertion throws; `live` with `1549901` → throws; deployed + test without the override → throws.
23. Policy matrix: for each `timing` × product, `POST /api/payments` and the offer payload expose the right options (`CARD_NOT_OFFERED` for `PAY_AT_HOTEL` without `cardOptional`); mixed orders resolve to the strictest rule; `autoCancelAt` frozen at creation and unchanged when the policy is edited afterwards.
24. Unpaid auto-cancel: `PAY_NOW` hotel booking with no attempt → cancelled after `unpaidCancelHours`, charge zero, receivable `VOID`, email queued; with an `APPROVED` attempt → never cancelled; with a `PROCESSING` attempt at the deadline → postponed, then cancelled or kept according to the outcome; cancelled booking's pay link → `410 BOOKING_CANCELLED`; two sweeper instances racing → one cancellation.
25. Payments disabled (`FLITT_ENABLED=false`): `PAY_NOW` items book as pay-later with `autoCancelAt null`; no sweeper runs; routes answer 404/503.

### 14.3 Client tests and E2E

- `client/test/help-registry.test.ts` must stay green (help article).
- `client/test/payments.copy.test.ts`: every `payment.*` key exists in all four dictionaries; no remaining `noPayment`/"no online payment" keys referenced by components.
- `qa/e2e/payments.flitt.mjs` (Playwright via Edge, see memory on the responsive harness): drives the real hosted page in test mode with card `4444555566661111` and `4444111166665555`, asserts the result page states and the admin list. Run manually and in a nightly job, not in PR CI (external dependency).

### 14.4 Manual matrix (Phase 4 exit)

Executed on the preview environment with the public test merchant: each test card from section 3.2 once; Apple Pay with a real wallet card (converted to a test token per docs) on an iPhone; mobile Safari and Chrome Android for the full round trip; language `ka`/`ru` payment pages; callback arrival timing recorded; a deliberate 30-second API outage (stop the Render service) during a payment, then recovery; refund of one approved test payment from the admin panel; reconciliation report review.

---

## 15. Admin panel requirements

- **Card payments list** (`/admin/finance/card-payments`): columns reference, booking, guest email, amount, mode chip, status badge, card (`VISA ••1111`), created, completed, attention flag; filters status, mode, date range, search; CSV export via `finance.export` (reuse the reports pattern). Rows link to the detail.
- **Detail** (`/admin/finance/card-payments/[id]`): header with status and mode; definition list (amounts, actual amount, currency, Flitt `payment_id`, `order_id`, transaction id, RRN, approval code, ECI, card, response code/description, timestamps, `lastStatusCheckAt`, `reconciledAt`); linked receivable, booking/order and ledger `PaymentRecord`; **Callbacks** timeline (received, valid/invalid, order_status, source IP, processed, error; expandable redacted payload); **Refunds** table with status; **Audit** trail. Actions: "Check status now" (`finance.payments.write`), "Request refund" (opens the existing approval modal pre-filled with `pspPaymentId`, max amount; `finance.refunds.request`), "Resolve mismatch" (`finance.refunds.approve`).
- **Approvals** (`/admin/finance/approvals/[id]`): a REFUND with `pspPaymentId` shows "Will be sent to Flitt" and, after approval, the live `PspRefund` status.
- **Payments browser** (`/admin/finance/payments`): `method=CARD` rows show a "Flitt" chip linking to the card payment.
- **Receivable detail**: "Card attempts" section.
- **Test-mode banner** on every panel page while `mode=TEST`; **badge** `cardPaymentsAttention` on the Finance group (mismatches, rejected callbacks in the last 24 h, failed refunds).
- **Dashboard** overview `StatCard`s: card payments today (count, sum), approval rate 24 h, open mismatches (gated by `finance.payments.read`).
- Help article `finance/card-payments` describing statuses, what "mismatch" means, how refunds flow, and the test-mode banner.

Reconciliation status per row: `reconciledAt` set by the daily job when Flitt's status and our ledger agree; the list filter `attention=1` shows rows where they do not.

---

## 16. Monitoring, reliability and reconciliation

### 16.1 Structured logging (pino)

Every payment log line carries `{ paymentId, paymentReference, merchantOrderId, providerPaymentId, mode, op }`. Levels: `info` for created/approved/declined; `warn` for IP mismatch (non-enforced), stale callbacks, provider 4xx; `error` for signature rejections, mismatches, provider outages, refund failures, with Flitt `request_id` when present.

### 16.2 Alerts (in-app notifications to finance-capable staff + `FINANCE_OPS_EMAIL`, via the existing `notify` path and `psp.alert` outbox topic)

| Condition | Detection |
|---|---|
| Payment creation failures | > 3 `FAILED` rows in 10 minutes (sweeper counts) |
| Signature validation failures | each rejection (notification), and > 5 per hour → email |
| Callback processing failures | inbox rows with `error` older than 10 minutes |
| Stuck pending payments | `PROCESSING` older than 30 minutes, or `REDIRECT_READY` past `expiresAt + 30 min` still not final after a status fetch |
| Provider API timeouts | > 3 `BadGatewayError` in 5 minutes |
| Database inconsistencies | `APPROVED` without `paymentRecordId`; `paymentRecordId` whose allocation sum ≠ `actualAmountCents - reversedCents`; receivable `PAID` with `paidCents < amountCents` |
| Reconciliation mismatches | daily job (16.4) |
| Unusual failure rates | declined/(approved+declined) over the last 100 attempts > 60 % with ≥ 20 attempts |

Health: `GET /health/payments` (staff-only or token-protected) returns the last sweep time, inbox backlog, open mismatches, mode; Render/uptime monitor can check it. Sentry/APM remains out of scope (none exists today); the structure above fits a later Sentry hook.

### 16.3 Retry policies

| Operation | Policy |
|---|---|
| Flitt create order | no automatic retry (not idempotent by itself); on timeout: status probe by `order_id`, then retry with the same id only on `1018` |
| Flitt status | up to 3 attempts, full-jitter backoff 0.5 s/1 s/2 s inside one request; the sweeper retries every minute thereafter |
| Flitt reverse | outbox event (`psp.refund.requested`), 8 attempts with the standard backoff, **same `reverse_id` on every attempt**; a `1086 Transaction already finished`/`1084` response is terminal |
| Apply inbox event | sweeper each minute until processed; `error` stored; 24 h backlog triggers an alert |
| Receipt emails | existing outbox policy |

### 16.4 Reconciliation job (part of `sweepPspPayments`, daily at 03:00 Tbilisi via the interval + "last run date" guard, same style as the finance reminders)

For every `APPROVED`/`REVERSED` payment completed in the last 3 days and every non-final row older than 1 hour: fetch status; compare `order_status`, `actual_amount`, `reversal_amount` with the row and with the ledger sum for `paymentRecordId` and its refunds; agree → `reconciledAt = now`; disagree → notification `PSP_RECONCILIATION_MISMATCH`, audit, row flagged. Later (Phase 6): pull Flitt report 745 by date range with the reports credentials and reconcile the whole day in one call.

### 16.6 Unpaid-booking sweeper (`sweepUnpaidBookings`, every sweep interval, `lockKey('psp_unpaid_cancel')`)

Selects receivables with `autoCancelAt < now()`, `status OPEN`, `autoCancelledAt null`, `debtorPartnerId null`, and no `PspPayment` in `APPROVED`/`PROCESSING`/`MISMATCH`; for each, re-checks inside the transaction (row lock) that no approval landed meanwhile, then cancels the booking or order through the product's cancellation InTx function with charge zero and reason `UNPAID`, voids the receivable (`VOID`, existing path), stamps `autoCancelledAt`, audits `BOOKING_CANCELLED` with `metadata.cause = 'UNPAID_AUTO_CANCEL'`, and enqueues the cancellation emails. A `PROCESSING` attempt postpones the cancellation by one sweep until it resolves. Conditional updates make the job safe to run on several instances. Alert when more than 20 bookings are auto-cancelled in one day (possible gateway problem rather than guest behaviour).

### 16.5 Recovery procedures (runbook content for `docs/DEPLOYMENT.md` §3.4c)

- Guest paid, booking shows unpaid: open the card payment, "Check status now"; if Flitt says approved and the row is `MISMATCH`, resolve with the actual amount; if the callback is in the inbox with an error, fix the cause and let the sweeper apply.
- Flitt outage: payments show pending; no manual action; after recovery the sweeper converges within one interval.
- Secret rotation: update env, restart; in-flight orders keep working because status fetches are signed with the current key (Flitt rotates per merchant, not per order).
- Disabling payments in an emergency: `FLITT_ENABLED=false` + restart; existing approved payments stay in the ledger; pending rows are expired by the next enable.

---

## 17. Implementation phases

Each phase ends with the full server suite green (section 14 files added incrementally), client `tsc`/eslint/build green, the RBAC matrix regenerated, Postman folder added, and a short note in the Status table at the top of this document.

### Phase 0 — Foundations and spike (dependencies: none)

Deliverables: `config.payments.flitt` + assertions; `API_PUBLIC_URL`; signature/parse/status/client modules with unit tests; `scripts/flitt-smoke.js`; a spike on the Render preview API that creates one test order, completes it in a browser with a test card and **records**: the `response_url` method and parameters (OQ1), callback timing and body, whether `expired` produces a callback (OQ2), `is_test` presence (OQ4). Findings are written into section 20.3.
Affected files: `server/config.js`, `server/lib/integrations/flitt/*`, `server/lib/logger.js`, `server/.env.example`, `.env.test`, `render.yaml`, the three unit test files, this document.
Verification: unit tests; smoke script output; no routes exposed yet.

### Phase 1 — Schema and domain services (depends on 0)

Deliverables: the two migrations (PSP tables **and** the payment-policy extension of section 8.2b); seeded platform default policies per product kind; `REFERENCE_KINDS.pspPayment`; `lib/payments/machines.js`; `lib/payments/policy.js` (`resolvePaymentTiming(items)`, the matrix of section 4.4); receivable freezing in `syncBookingReceivableInTx`/`syncOrderReceivableInTx`; `payment` on tour/package/transfer offer payloads; `psp-payment.service.js` (`createPayment`, `applyProviderStatus`, `refreshFromProvider`); `flitt-callback.service.js`; `sweepUnpaidBookings`; `test/support/flitt.stub.js`; flow tests 1, 2, 6, 7, 8, 11, 13, 14, 18, 22, 23, 24, 25.
Affected files: `server/prisma/schema.prisma`, migrations, `lib/reference.js`, `services/finance/ledger.service.js`, `services/hotel/policyCatalog.service.js`, `validation/ratePlan.js` (policy schema gains `unpaidCancelHours`, `cardOptional`), the tour/package/transfer quote services and serialisers, the new services, tests.
Verification: `prisma migrate deploy` on the dev DB; suite green; CHECK constraints present; existing hotel policies and rate plans unchanged (`booking.test.js` green).

### Phase 2 — HTTP surface (depends on 1)

Deliverables: guest routes, provider routes with raw body and limiter exemption, return token, staff `settings` route, `app.js` mounting order, outbox topics + receipt/failed-email handlers + templates, sweeper timer in `server.js`, RBAC matrix regeneration, Postman folder "07 Card payments", `server/API.md` section.
Verification: tests 9, 10, 12, 17, 19, 20, 21; manual round trip on preview with the public test merchant (callback arrives, status converges, receipt email in Mailtrap).

### Phase 3 — Guest checkout and result page (depends on 2)

Deliverables: `PaymentMethodChoice`, `PaymentStatusPanel`, result page, checkout form changes for all four products, confirmation/manage page payment card, `BookingSteps` `pay` step, dictionary block in four languages, copy rewrite (section 2.11) including legal pages, client API module and types.
Verification: client gates; `qa/e2e/payments.flitt.mjs` on preview with the test cards; RTL check in `he`; mobile walk (iPhone Safari, Android Chrome).

### Phase 4 — Admin panel (depends on 2; can run in parallel with 3)

Deliverables: admin list/detail routes and pages, nav item, badge, test-mode banner, dashboard stat cards, help article, "Check status now"; **payment policy editing for the other products**: a shared `PaymentPolicyEditor` (extracted from `RoomsManager.tsx`'s policy form, with the new `unpaidCancelHours` and `cardOptional` fields and the DEPOSIT warning) on the tour option, package and transfer provider admin pages, plus a "Payment policies" catalogue screen for platform templates (`catalogue.write`); routes `GET/POST/PATCH /api/admin/payment-policies` (templates) and `paymentPolicyId` accepted on the existing tour option, package and transfer provider PATCH routes; help text updated.
Verification: `help-registry` test; RBAC walk with FINANCE_OPERATOR, ACCOUNTANT, MANAGEMENT, DISPATCHER (must not see card payments), TOUR_OPERATOR (edits tour policies only); admin tests; existing hotel rate-plan policy editing unchanged.

**MVP exit (Phases 0–4):** a guest can pay for a hotel, tour, transfer or package booking by test card; the ledger, invoices and emails reflect it; staff see it; nothing changes when the flag is off; manual matrix (14.4) passed.

### Phase 5 — Refunds through Flitt (depends on 4)

Deliverables: `psp-refund.service.js`, approval hook, outbox handler, admin "Request refund", refund tests (16), runbook text.
Verification: refund of a test payment end to end; partial and full; declined path.

### Phase 6 — Reconciliation and hardening (depends on 5)

Deliverables: daily reconciliation, `/health/payments`, alert thresholds, optional report-745 pull, **deposit + balance flow** (`DEPOSIT` timing charges `depositBps` at checkout, balance pay link emailed `balanceDueDaysBeforeCheckIn` before arrival, second `PspPayment` against the same receivable, receivable `PARTIAL` in between), Embedded Checkout groundwork (`createCheckoutToken` exposed behind `FLITT_CHECKOUT=embedded`, no UI yet).
Verification: tests 15; alert firing in a staged failure; 7-day preview soak with the nightly E2E.

### Phase 7 — Production switch-on (depends on 6 and explicit owner approval; section 19)

---

## 18. Acceptance criteria per phase

| Phase | Criteria (all must hold) |
|---|---|
| 0 | `assertPaymentsConfig` rejects the four bad combinations; `sign()` reproduces the live-probe vectors; `scripts/flitt-smoke.js` obtains a `checkout_url` and a signature-verified status with the public test merchant; spike findings recorded in 20.3. |
| 1 | Migrations apply forwards on an empty and on the dev database; every status transition is table-driven and unit-tested; an approved status yields exactly one `PaymentRecord` under concurrent application; `MISMATCH` never writes a ledger row; a duplicate callback body is a no-op; the policy matrix (4.5) is resolved identically by the offer payload, `POST /api/payments` and the sweeper; a `PAY_NOW` booking is auto-cancelled only when unpaid and never while an attempt is in flight. |
| 2 | Callback route accepts a signed JSON POST without cookies/Origin, rejects a bad signature with 400 and an inbox row, is excluded from `globalLimiter`; return route performs no state change; `GET /api/payments/:id` converges a `processing → approved` stub without callbacks; RBAC matrix diff shows only the new routes; receipt email rendered in capture transport. |
| 3 | Guest flow works for the four products in `en`/`ka`/`ru`/`he`; refresh/back/close never changes state; declined → retry creates a new order id; no dictionary key missing; no "no online payment" copy remains; Lighthouse mobile score for the result page not below the booking confirmation page's current score. |
| 4 | Finance roles see list/detail; dispatcher/tour operator cannot (403 server, hidden nav); banner visible in test mode; "Check status now" audited; help article passes the registry test; staff can set a payment policy on a tour option, a package and a transfer provider and the next checkout of that item reflects it; editing a policy never changes an existing receivable's frozen rule. |
| 5 | A refund can only be executed through an approved `ApprovalRequest`; Flitt reverse is retried with the same `reverse_id`; ledger sum after refund equals `actual - reversed`; over-refund refused with 422. |
| 6 | Reconciliation marks agreeing rows and alerts on a seeded disagreement; `/health/payments` reports backlog 0 after a sweep; 7-day soak shows no stuck payment older than 30 min without an alert. |
| 7 | Section 19 checklist complete and signed off by the owner. |

---

## 19. Production migration checklist (separate approval required)

1. **Merchant account**: Flitt merchant contract signed; live `merchant_id` and payment secret key obtained from the Merchant Portal (Technical settings; doc page OQ3 is empty, confirm with Flitt support); currencies enabled (GEL at minimum, USD/EUR if sold); payment methods activated (cards, Apple Pay, Google Pay; Apple Pay on the hosted page needs no certificate from us); design preset and logo configured; callback IPs confirmed with support; merchant switched from test to live status by Flitt.
2. **Environment isolation**: production API has `FLITT_MODE=live`, a distinct `FLITT_SECRET_KEY`, `FLITT_RETURN_TOKEN_SECRET`, `FLITT_ORDER_PREFIX=IAG` (no `T`), `FLITT_CALLBACK_IP_ENFORCE=true`, `API_PUBLIC_URL=https://api.iamgeorgia.com.ge`; the preview API (`https://api.preview.iamgeorgia.com.ge`) keeps `test`. Both hosts sit behind Cloudflare in front of Render, so `TRUST_PROXY` must count that hop for the callback IP check, and Cloudflare must not challenge or cache `POST /api/payments/flitt/callback` (a WAF rule or page rule for that path). Boot assertions enforce the combination.
3. **Callback endpoint verification**: `https://api.iamgeorgia.com.ge/api/payments/flitt/callback` (production) reachable from the internet over HTTPS, no redirect (Flitt does not follow them), answers 404 when disabled and 400 to an unsigned POST when enabled; `TRUST_PROXY` set so `req.ip` is the real source; firewall/Render allows the two Flitt IPs.
4. **Deployment configuration**: Render env block, `docs/DEPLOYMENT.md` §3.4c, `.env.production.example` updated; migrations already applied by earlier phases; client built with the production `NEXT_PUBLIC_API_URL`.
5. **Security review**: secrets never in git (`git log -p` grep), log redaction verified on production logs, RBAC walk repeated, refund maker-checker verified with real staff accounts, rate limits on `/api/payments` and the callback verified, dependency audit clean (no new packages).
6. **Legal and copy**: privacy policy and terms updated and reviewed in all languages; receipt email reviewed.
7. **Smoke test in live mode**: one real card payment of the smallest sellable amount by the owner, callback observed, ledger row, invoice (if InvoiceOcean enabled), receipt; then a full refund of that payment through the approval flow; both reconciled.
8. **Monitoring**: alert recipients confirmed; `/health/payments` added to the uptime monitor; first-week daily reconciliation review by finance.
9. **Rollback**: `FLITT_ENABLED=false` + restart hides the feature in under a minute; approved payments remain in the ledger; the client falls back to "pay later" automatically; no schema rollback needed. Document the Flitt support contact for stuck funds.
10. **Go/no-go**: owner signs the checklist; the date and merchant id (not the key) are recorded in this document's Status table.

---

## 20. Risks, assumptions and open questions

### 20.1 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Confirmed-but-unpaid bookings consume inventory | medium | per-policy `PAY_NOW` auto-cancel (section 4.4, 16.6); `PAY_LATER` items behave as today; finance overdue view; email reminder with pay link |
| Auto-cancelling a booking that is being paid at that moment | guest charged for a cancelled booking | sweeper skips receivables with a `PROCESSING` attempt and re-checks under the row lock; an approval that still lands after cancellation is flagged for refund (`MISMATCH`-class alert) |
| Staff set `PAY_NOW` on an ON_REQUEST tour | guest cannot pay before confirmation | `autoCancelAt` is computed from confirmation time (receivable creation), not request time |
| Public test merchant is shared: duplicate `order_id` and forged test callbacks | test only | unique prefixed order ids; state from signed status fetch; test mode cannot run in production |
| `response_url` method unknown (OQ1) | return page not reached | return route accepts GET and POST, mounted before CSRF; result still visible on confirmation page |
| Hebrew not supported on Flitt's page | UX for `he` | fall back to `en`; mention on the result page |
| Flitt changes callback IPs | callbacks rejected in live mode | enforcement configurable; alert on rejections |
| Partners paying by card later | scope | partner receivables refused for MVP (OD2) |
| InvoiceOcean VAT invoice fires on card payment | expected, but test mode would create test invoices | `INVOICEOCEAN_ENABLED` stays off in preview or the test sandbox account is used |
| Multiple approved attempts (guest pays twice from two tabs) | overpayment | reuse window; alert; refund path |

### 20.2 Owner decisions (taken 2026-11-03)

| # | Decision | Owner's answer | Consequence |
|---|---|---|---|
| OD1 | What happens to a booking whose card payment was not completed | **Depends on the hotel/tour/package rule** | `PaymentPolicy.timing` decides (section 4.4): `PAY_NOW` auto-cancels after the policy's `unpaidCancelHours` (**default 24 h, set per policy**); other timings keep the booking |
| OD2 | Products and buyers in MVP | **All guest products** | hotel, tour, transfer, package orders; partner receivables excluded |
| OD3 | `delayed=N` vs `Y` | **N (accepted)** | one Flitt order per attempt; retry = new order id |
| OD4 | Refunds through Flitt | **Yes, after the MVP (Phase 5)** | maker-checker approval → Flitt reversal → ledger |
| OD5 | Pre-authorisation / capture | **No (accepted)** | immediate charge; ON_REQUEST items are paid after confirmation |
| OD6 | Keep "Pay later" for guests | **Depends on the rule** | per item via `PaymentPolicy`: `PAY_LATER` offers both, `PAY_NOW` card only, `PAY_AT_HOTEL` pay-later only (card if `cardOptional`) |
| OD6a | Where the rule lives | **Reuse `PaymentPolicy`, extend to tours, packages, transfers** | nullable `paymentPolicyId` on `TourOption`, `Package`, `TransferProvider`; platform default templates per product kind; admin editors (Phase 4) |
| OD6b | Deposits (`DEPOSIT` timing) | **Later phase, not MVP** | MVP treats DEPOSIT as full `PAY_NOW` with an admin warning; deposit + balance link in Phase 6 |
| OD7 | Wallets (Apple/Google Pay) from day one | default kept | yes if Flitt enables them; no code change |
| OD8 | Order description / merchant_data content | **Reference and product only (accepted)** | no guest name sent to Flitt |
| OD9 | Plan file location | default kept | `docs/plans/FLITT_INTEGRATION_PLAN.md` (this file) |

### 20.3 Open questions (to resolve in Phase 0 spike or with Flitt support)

- OQ1 `response_url`: GET or POST, with which parameters?
- OQ2 Is a callback sent on `expired` without customer interaction?
- OQ3 Exact Merchant Portal path for the live payment key; whether a merchant's own test key differs from `test`.
- OQ4 Is `additional_info.is_test` always present?
- OQ5 Maximum callback body size.
- OQ6 Is `cancel_url` called with parameters?
- OQ7 Fallback language for Hebrew visitors.
- OQ8 Whether the reports credentials (application id/key) will be issued for reconciliation.

### 20.4 Assumptions

- GEL is the only currency charged in MVP (catalogue defaults to GEL; no FX, decision D8).
- The Render preview API is public and may run `FLITT_MODE=test` with the override flag.
- The owner will provide native review of ka/ru/he copy and the legal text.
- No change to how partners settle (terms, credit limits, statements).

---

*Prepared for owner review; decisions OD1–OD9 recorded on 2026-11-03. Implementation starts only after the owner approves this plan.*
