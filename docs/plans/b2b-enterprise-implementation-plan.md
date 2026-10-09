# I am Georgia — Enterprise B2B Platform Implementation Plan

Planning document only. Nothing in this file has been applied. Line numbers refer to the working tree at commit `499657d` (branch `main`, 2026-10-08) and will drift. After approval, copy this file to `docs/plans/b2b-enterprise-implementation-plan.md` as the first task of Phase 0.

## Context

A client asked whether the platform supports six capabilities: separate employee accounts, management/reservation roles, InvoiceOcean invoicing, accounting, supplier payment reminders, and hotel-name search for transfers. The feature readiness audit (published 2026-10-08) found none fully implemented: accounts, RBAC, finance and maps are partial; InvoiceOcean and payment reminders are absent. The audit also found four security defects and a pricing-rule defect, all re-verified in source for this plan.

This plan turns the audit into executable work for a coding agent: exact files, Prisma changes, endpoints, UI, tests, deployment steps, and an ordered task list. It reuses the existing patterns (prepare/confirmInTx/cancelInTx services, zod `validate`, `recordAudit`, the transactional outbox, stamp-column sweepers, `navigationFor`, the Browser/detail admin page pattern) and does not rebuild anything that works.

## Decisions already taken (owner, 2026-10-08)

| Decision | Choice | Consequence in this plan |
|---|---|---|
| Partner settlement | **Per booking** | One `Receivable` per confirmed booking/order with its own due date; no monthly statements (optional later). |
| Invoice trigger | **Proforma at confirmation, VAT invoice on full payment** | `invoice.create_requested` on confirm creates `kind: proforma`; recording full payment creates `kind: vat` with `from_invoice_id`; cancellation after VAT issue creates a correction. |
| Staff roles | **MANAGEMENT, RESERVATIONS, FINANCE** added; SUPER_ADMIN alone manages staff | Role enum grows by three; DB CHECK extended; capability map keyed by role. |
| Unknown Google place at transfer search | **Auto-register as pending TransferPoint** | `POST /api/transfers/points/resolve` creates a HOTEL/LANDMARK point with `reviewStatus: PENDING`, deduped by place id; admin review queue. |

## Verified baseline (what exists and is reused)

- Auth: `server/middleware/auth.js` role lists (6–18), `authenticate` 227, `requireRole` 255, `requireApprovedPartner` 349; DB sessions, scrypt, CSRF, rate limits (`middleware/rateLimit.js`). Tests: `auth`, `partners.access`, `partners.financial`, `invitations`, `csrf` — 183 DB-backed tests passed on 2026-10-08.
- Bookings: `prepareX` / `confirmXInTx(tx, prepared, { idempotencyKey }, actor, req)` / `cancelXInTx(tx, booking, { reason, waiveCharges }, actor, req)` for hotel, transfer, tour, service; orders orchestrate all in one `$transaction({ timeout: 15000 })`. Frozen `netTotalCents`, `sellTotalCents`, `markupBps`, `taxTotalCents`, `cancellationChargeCents` on every booking.
- Outbox: `lib/outbox.js` `TOPICS` + `enqueueEvent(client, { topic, payload, entityType, entityId })`; drain with xact advisory lock + 5-min lease, 8 attempts, exponential backoff (`services/notifications/outbox.service.js`); in-app `Notification` model + `notification.service.js`; `opsUserIds()`; mail templates `lib/mailer/templates.js` with `layout()`; `test/mailer.test.js:38` asserts template coverage.
- Sweeper pattern: `services/transfer/reminder.service.js` (xact lock + `UPDATE … WHERE stamp IS NULL RETURNING` + `createMany` outbox in one transaction); intervals registered in `server/server.js` and cleared on shutdown.
- Pricing: `services/hotel/pricingRule.service.js resolveMarkup` (59–114); `PricingRule` model (schema 2663–2710); transfer rack model `services/transfer/pricing.service.js` 168–260.
- Maps: `client/components/geo/{GoogleMapsProvider,PlaceSearch,LocationMap,LocationField}.tsx`, `client/lib/geo/place.ts`, `client/types/geo.ts`; server `placeRefSchema`/`placedLocationSchema` (`validation/domain.js:108-133`), `place Json?` on points/hotels/destinations, `pickupPlace`/`dropoffPlace` on transfer bookings.
- Admin UI: `client/lib/admin/navigation.ts` (`navigationFor(role)`, badge keys 45–52), `client/lib/auth/session.ts requireAdminSession`, Browser/detail page pattern, help centre articles under `client/lib/admin/help/articles/`.

---

# Phase 0 — Security hardening and critical fixes

Ordered by severity. All seven are small, independent and shippable in one PR each. Effort 4–6 days total.

## 0.1 Suspended, pending or rejected partners can still book (High)

- **Root cause.** `login` deliberately admits any partner status (`services/auth.service.js:104-113` comment) and relies on `requireApprovedPartner` for protection, but the public booking routers (`routes/hotels.bookings.routes.js:57`, `transfers.bookings.routes.js:48`, `tours.bookings.routes.js:51`, `orders.routes.js:40`) use `optionalAuthenticate` only. The booking is stamped `partnerId: actor?.partnerId` (`services/hotel/booking.service.js:341`; tour 230; transfer 265; order 481) and `resolveMarkup({ partner })` applies the partner's commission (`services/hotel/search.service.js:310,404,545`). Suspension revokes sessions (`partner.service.js:371-386`) but a new login succeeds.
- **Impact.** A suspended or rejected agency keeps trade pricing and booking capability; a pending (unvetted) applicant can book at its default commission.
- **Fix (server).** Add `requireTradeOrGuest` middleware in `middleware/auth.js`: if `req.user?.partnerId` is set and `req.user.partner.status !== 'APPROVED'`, throw `ForbiddenError('PARTNER_NOT_APPROVED')` with `partnerStatus` in details (same shape as `requireApprovedPartner`, 349–365). Mount it after `optionalAuthenticate` on the four public booking routers and on `/transfers/quotes`, `/search`, `/tours`, `/services`, `/packages` quote endpoints is NOT needed: `isTrade` already withholds partner-only inventory there; pricing for a non-approved partner should fall back to public: in `pricingRule.service.js resolveMarkup` (59–114) ignore `partner` unless `partner.status === 'APPROVED'` (callers pass `viewer.partner`, which carries status; a bare `{ id }` from tests is treated as approved, mirroring `isTrade`). Keep login behaviour (the portal explains statuses); do not change `login`.
- **Fix (client).** None required; portal pages already explain status.
- **Regression risk.** Tests that book as a `partnerIn('PENDING_APPROVAL')` would now get 403; grep `test/` for such cases and adjust expectations. Guests unaffected.
- **Tests.** Extend `test/partners.access.test.js`: "a suspended partner cannot create, amend or cancel a booking through the public routes" for all four products (expect 403, no row created); "a pending partner is quoted public prices" (markup source PLATFORM_DEFAULT, not PARTNER_COMMISSION).

## 0.2 Supplier sees platform margin and buying agency (High)

- **Root cause.** `canViewNetRates = isAdmin || ownsHotel` (`middleware/auth.js:83`) and `toBookingSummary` adds `netTotalCents`, `markupBps`, `marginCents`, `partner` under that predicate (`serializers/booking.js:89-96`); `GET /partner/hotels/:hotelId/bookings` lists all agencies' bookings at the property via `propertyScope` (`routes/partner.hotels.routes.js:125-137`, `booking.service.js:582-590`). Header at `serializers/booking.js:13` says margin is admin-only.
- **Impact.** A supplier (any sub-role, including PARTNER_AGENT) learns the platform's markup and which competing agency booked.
- **Fix.** Split the predicate: keep `canViewNetRates(viewer, hotel)` for *net* (the supplier's own rate) and add `canViewMargin = isAdmin` (later: capability `finance.margin.read`) in `middleware/auth.js`. In `serializers/booking.js:89-96` emit `netTotalCents` under `canViewNetRates`, and `markupBps`, `marginCents`, `partner` under `canViewMargin` only. Apply the same split in `serializers/tourBooking.js:60-64`, `service.js:141-145`, `inventory.js:147-150`, `tour.js`, `package.js` wherever `marginCents`/`markupBps` is emitted (grep `marginCents`). For the supplier view of a partner booking, replace `partner` with `{ bookedVia: 'AGENCY' | 'DIRECT' }`.
- **Client.** Admin pages read `marginCents` (e.g. `admin/(panel)/bookings/[id]/page.tsx:250-251`); unchanged for admins. No supplier extranet UI exists.
- **Tests.** `test/supplier.test.js`: "a supplier sees its net but never the markup, margin or the buying agency on bookings at its property"; `test/transfers.pricing.test.js` "never shows a net fare or a margin to the public" stays green.

## 0.3 DISPATCHER can cancel any transfer booking (Medium)

- **Root cause.** `adminTransferBookingRoutes.use(authenticate, requireTransferOps)` (`routes/transfers.bookings.routes.js:209`) covers `POST /:reference/cancel` (239–255); `assertMayRead` returns early for `isTransferOps` (`services/transfer/booking.service.js:463-466`), so the public `/transfers/bookings/:reference` amend/cancel is also open to dispatchers.
- **Fix.** Add `requireAdmin` to the cancel route (`transfers.bookings.routes.js:239`) and to any amend route in the same router; in `assertMayRead` keep the ops early-return for reads only by adding a second guard `assertMayMutate(booking, viewer)` = admin, owning partner, or guest-by-email, used by amend/cancel (lines ~665 and the public cancel handler). Phase 1 replaces both with capabilities (`bookings.transfer.read` vs `bookings.transfer.cancel`).
- **Tests.** `test/transfers.foundation.test.js:140` extend: "lets a dispatcher read a booking but not cancel or amend it" (403 on admin cancel, 404 on public amend).

## 0.4 Inconsistent cross-company authorization responses (Low)

- **Root cause.** `services/order/order.service.js:658` throws 403 (`'That order is not yours to see'`) for a foreign reference; every other module throws `NotFoundError` (hotel `booking.service.js:536-556`, transfer 463–489, tour 405, service 300).
- **Fix.** Change to `NotFoundError('That order does not exist')`; update `test/orders.booking.test.js` expectations if any assert 403.
- **Also:** the partner's own `GET /partner/financial` reads Prisma directly without audit (`routes/partner.routes.js:150`); route it through `readFinancial` so `PARTNER_FINANCIAL_VIEWED` is written for self-reads too (optional, 0.5 h).

## 0.5 Transfer pricing rules typed TRANSFER never match (Medium, financial)

- **Root cause.** `services/transfer/quote.service.js:227-232` calls `resolveMarkup({ partner, destinationId, timezone, date })` without `productType`; `anyOr('productType', null)` (`pricingRule.service.js:41`) matches only rules with `productType IS NULL`; fallback uses `config.hotel.defaultMarkupBps` (106–111). Admin API accepts `productType: 'TRANSFER'` (`routes/admin.pricingRules.routes.js:36`).
- **Fix.** Pass `productType: 'TRANSFER'` in `quote.service.js:227`; in `resolveMarkup` add `type === 'TRANSFER' ? config.transfer.defaultMarkupBps` to the platform-default switch (config key at `config.js:276`). Also audit `services/package/quote.service.js` transfer slot path for the same omission.
- **Regression.** Existing TRANSFER-typed rules in production data would start applying; list them before deploy (`SELECT * FROM pricing_rules WHERE product_type='TRANSFER'`) and confirm with the owner.
- **Tests.** `test/transfers.markup.unit.test.js` or `test/supplier.test.js`: "applies a TRANSFER-typed rule to a transfer quote" and "falls back to the transfer default, not the hotel default".

## 0.6 Missing frontend password recovery (Medium, functional)

- **Root cause.** API exists (`routes/auth.routes.js:119-186`) and the email links to `${APP_URL}/reset-password/:token` (`lib/mailer/templates.js:21`), but `client/app` has no `reset-password` or `forgot-password` page and `client/lib/api/partners.ts` has no `forgotPassword`/`resetPassword` (help text `client/lib/admin/help/articles/getting-started/signing-in.ts:75` confirms).
- **Fix (client).** Add `app/[locale]/(site)/forgot-password/page.tsx` and `app/[locale]/(site)/reset-password/[token]/page.tsx` modelled on `(site)/activate/[token]/page.tsx`; API functions `forgotPassword(email)` → `POST /api/auth/password/forgot` (always 204) and `resetPassword(token, password)` → `POST /api/auth/password/reset/:token` in `lib/api/partners.ts` (or a new `lib/api/auth.ts`); "Forgot password?" links on admin, portal and driver sign-in pages; i18n keys `t.auth.forgot.*` / `t.auth.reset.*` in `lib/i18n/ui/{en,ka,ru,he}.ts`; handle 404/409/410 from the token lookup with the same messages the activation page uses; run `npx next typegen`; update the two help articles.
- **Server.** Verify the link path the template builds matches the new route (template uses `/reset-password/${token}`; the locale segment is handled by `proxy.ts` locale routing — confirm an un-prefixed path redirects to the default locale, else build the link with `/en/`).
- **Tests.** Server untouched (already tested); client: a `node:test` for the reset page's token-state mapping if a pure helper is extracted; manual E2E: forgot → Mailtrap link → reset → sign in.

## 0.7 Google Places billing and key configuration (Medium, cost)

- **Root cause.** `PLACE_FIELDS` includes `displayName` (`client/components/geo/PlaceSearch.tsx:72`), a Pro field; per Google session pricing a session terminated with a Pro/Enterprise field bills the terminating call at *Place Details Enterprise + Atmosphere* (USD 25/1k, 1,000 free) instead of *Essentials* (USD 5/1k, 10,000 free). No type or region filter (`200-206`), so every keystroke searches the world with a Georgia bias. No Map ID in `.env.local`; a single browser key; no server key.
- **Fix (client).** In `PlaceSearch.tsx`: drop `displayName` from `PLACE_FIELDS`; take the name from `prediction.mainText?.text ?? prediction.text.text` (Autocomplete prediction, free within the session) and pass it to `toPlaceRef` via an explicit `name` argument (extend `placeRefFrom` in `lib/geo/place.ts:75-90` to accept `nameOverride`); add props `includedPrimaryTypes?: string[]` and `includedRegionCodes?: string[]` forwarded to `fetchAutocompleteSuggestions`; default `includedRegionCodes: ['ge']` in the admin and checkout call sites (keep bias for the site search until Phase 5). Keep session token lifecycle (148, 197, 249).
- **Fix (ops).** Create two keys in Google Cloud: browser key (HTTP-referrer restricted to the Vercel and preview domains; APIs: Maps JavaScript, Places API (New), Geocoding) and server key (IP-restricted or proxied; APIs: Routes API, Geocoding; used only from Phase 5). Set `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` (create a Map ID) on Vercel and `.env.local`. Set per-day quotas and a budget alert. Document in `docs/DEPLOYMENT.md:282-283`.
- **Tests.** `client/test/geo-place.test.ts`: "uses the prediction text as the name when the place carries none"; existing tests unchanged.

## Phase 0 verification

- `npm test` in `server/` (full suite; wait 70 s between runs for the rate limiter), `npx tsc --noEmit`, `npx eslint .`, `npx next build` in `client/`.
- Newman folders 05 (partners) and 06 (transfers) against a local server.
- Manual: suspended partner login → portal shows status page; `POST /api/bookings` with that cookie → 403.

---

# Phase 1 — Employee accounts and role-based access control

## 1.A Current architecture (verified)

- One `User` table (schema 3318–3378) with `role`, `partnerId`, `isActive`, nullable `passwordHash` ("null until the invitee sets one"), `isPrimaryContact`, `lastLoginAt`. DB CHECK: platform roles ⇔ `partner_id IS NULL`, partner roles ⇔ NOT NULL (`migrations/20260901124948_transfer_fleet_dispatch/migration.sql:449-453`).
- Account creation paths: invitation accept → PARTNER_OWNER (`services/invitation.service.js:188-200`); admin partner create → PARTNER_OWNER + ACCOUNT_ACTIVATION token (`services/partner.service.js:211-232`); driver account → DRIVER + activation token, with resend (`services/transfer/driver.service.js:353-400`, routes `admin.drivers.routes.js:127,136`); CLI `scripts/create-admin.js` → SUPER_ADMIN. **The driver-account pattern (create user with null password + `issueAuthToken(ACCOUNT_ACTIVATION)` + `accountActivation`/`driverAccountActivation` template + client `(site)/activate/[token]`) is exactly what staff and team invitations need; reuse it rather than extending `Invitation`, which is the partner-onboarding wizard.**
- Lifecycle: `deactivateDriver`/`reactivateDriver` set `isActive` and revoke sessions (`driver.service.js:305-335`); `revokeUserSessions(userId)` / `revokePartnerSessions` exist (`services/auth.service.js:92-102`); user delete only by cascade.
- Guards: role lists and `requireRole`/`requireAdmin`/`requireTransferOps`/`requirePartner`/`requireApprovedPartner` (`middleware/auth.js`); `requireHotelAccess` (`middleware/hotelAccess.js`). No capability layer; SUPER_ADMIN ≡ ADMIN. Client mirrors role lists in `client/types/auth.ts:37-57` and `client/lib/admin/navigation.ts:94-116`.
- Audit: `recordAudit(client, { action, actor, entityType, entityId, summary, metadata, req })` (`lib/audit.js:13`), `AUDIT_ENTITY.user = 'User'`; only reader is per-partner (`partner.service.js:571-577`). Successful logins not audited.
- Self-update whitelist already excludes role/partnerId (`validation/partner.js:168-175`).

## 1.B Proposed architecture

1. **Capability map, not a permissions database.** `server/lib/permissions.js` exports `CAPABILITIES` (string constants), `ROLE_CAPABILITIES` (role → Set), `can(viewer, capability)` and `capabilitiesFor(role)`. `middleware/auth.js` gains `requireCapability(...anyOf)` (401 without user, 403 `{ reason: 'INSUFFICIENT_CAPABILITY', required }`). Existing guards stay as thin wrappers so untouched routers keep working: `requireAdmin = requireCapability('platform.admin')`, `requireTransferOps = requireCapability('dispatch.read')`, etc. New roles receive nothing until a router is converted, so rollout is fail-closed.
2. **Capabilities are served, not duplicated.** `GET /api/auth/me` and the login response add `capabilities: string[]` (serializer `serializers/user.js toSessionUser`). The client's `navigationFor`, page guards and conditional UI read `session.capabilities`, so the map lives in one place.
3. **Three new platform roles** MANAGEMENT, RESERVATIONS, FINANCE (owner decision). SUPER_ADMIN alone holds `users.staff.manage` and `settings.write`; ADMIN keeps every operational capability.
4. **User management service** `services/user.service.js` + router `routes/admin.users.routes.js` (`/api/admin/users`) for staff, and `routes/partner.team.routes.js` (`/api/partner/team`) for partner teams, both built on the driver-account pattern.
5. **Global audit reader** `GET /api/admin/audit` (capability `audit.read`) over the existing `AuditLog` table; successful logins and logouts audited.

## 1.C Database changes

Migration 1 `20261015100000_rbac_enum_values` (enum values only, two-migration rule as in `20260905181000_packages_orders_enum_values`):
```sql
ALTER TYPE "role" ADD VALUE 'MANAGEMENT';
ALTER TYPE "role" ADD VALUE 'RESERVATIONS';
ALTER TYPE "role" ADD VALUE 'FINANCE';
ALTER TYPE "audit_action" ADD VALUE 'USER_INVITED';
ALTER TYPE "audit_action" ADD VALUE 'USER_ROLE_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'USER_DEACTIVATED';
ALTER TYPE "audit_action" ADD VALUE 'USER_REACTIVATED';
ALTER TYPE "audit_action" ADD VALUE 'USER_DELETED';
ALTER TYPE "audit_action" ADD VALUE 'USER_SESSIONS_REVOKED';
ALTER TYPE "audit_action" ADD VALUE 'USER_LOGIN_SUCCEEDED';
ALTER TYPE "audit_action" ADD VALUE 'USER_LOGGED_OUT';
ALTER TYPE "audit_action" ADD VALUE 'USER_PRIMARY_CONTACT_CHANGED';
```
Migration 2 `20261015100100_rbac_users` (hand-written; no `DROP INDEX "*_geo_idx"` line):
```sql
ALTER TABLE "users" ADD COLUMN "deactivated_at" TIMESTAMP(3), ADD COLUMN "deactivated_by_user_id" TEXT,
  ADD COLUMN "invited_by_user_id" TEXT, ADD COLUMN "invited_at" TIMESTAMP(3);
ALTER TABLE "users" ADD CONSTRAINT "users_deactivated_by_fkey" FOREIGN KEY ("deactivated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "users" DROP CONSTRAINT "users_partner_role_requires_partner";
ALTER TABLE "users" ADD CONSTRAINT "users_partner_role_requires_partner" CHECK (
  ("role" IN ('SUPER_ADMIN','ADMIN','MANAGEMENT','RESERVATIONS','FINANCE','DISPATCHER','DRIVER') AND "partner_id" IS NULL) OR
  ("role" IN ('PARTNER_OWNER','PARTNER_ADMIN','PARTNER_AGENT','PARTNER_FINANCE') AND "partner_id" IS NOT NULL));
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs"("actor_user_id","created_at" DESC);
CREATE INDEX "audit_logs_action_created_idx" ON "audit_logs"("action","created_at" DESC);
```
(Constraint name verified at `20260901124948_transfer_fleet_dispatch/migration.sql:449-450`; `audit_logs` table and `actor_user_id`/`created_at` columns verified from `model AuditLog` `@@map`; it already has single-column indexes on `actorUserId` and `createdAt`, so the two composite indexes above are optional and only worth adding if the audit screen proves slow.)

Prisma: `enum Role` + 3 values; `enum AuditAction` + 9 values; `model User` + `deactivatedAt DateTime? @map("deactivated_at")`, `deactivatedBy User? @relation("UserDeactivatedBy", fields: [deactivatedByUserId], references: [id], onDelete: SetNull)`, `invitedBy` likewise, `invitedAt`. No change to `Invitation`, `Session`, `AuthToken`. Backfill: none (new columns nullable). Backward compatible: yes.

## 1.D Backend implementation

**New files**
- `lib/permissions.js` — `CAPABILITIES`, `ROLE_CAPABILITIES`, `can`, `capabilitiesFor`, `assertCan` (throws ForbiddenError). Pure module, unit-tested.
- `services/user.service.js` — `listUsers({ scope: 'STAFF' | 'PARTNER', partnerId, search, role, status, page, pageSize })`, `inviteUser({ email, firstName, lastName, role, position, phone, partnerId }, actor, req)` (creates user with `passwordHash: null`, `invitedByUserId`, `invitedAt`; `issueAuthToken(user, 'ACCOUNT_ACTIVATION')`; audit `USER_INVITED`; returns `{ user, activationLink }` — **return the link in the response and show "Copy link" in the UI**, project convention), `resendActivation(userId, actor, req)` (reissue token; audit `INVITATION_RESENT` exists), `changeRole(userId, role, actor, req)` (ceiling check; `USER_ROLE_CHANGED` with `{ from, to }`; revoke sessions so the new role takes effect), `deactivateUser(userId, { reason }, actor, req)` (`isActive=false`, `deactivatedAt`, `deactivatedByUserId`, `revokeUserSessions`; `USER_DEACTIVATED`), `reactivateUser`, `deleteUser(userId, { confirm }, actor, req)` (refuse when the user is the actor, the last active PARTNER_OWNER, or the last active SUPER_ADMIN; audit row survives via `actorEmail` snapshot and `onDelete: SetNull` — same guarantee `audit.test.js:123` proves for admins), `revokeSessions(userId, actor, req)`, `setPrimaryContact(partnerId, userId, actor, req)`.
- `validation/user.js` — `inviteStaffSchema` (role ∈ ADMIN|MANAGEMENT|RESERVATIONS|FINANCE|DISPATCHER; `emailField`, `nameField`, `phoneField`, `textField(80)` for position; `.strict()`), `inviteTeamMemberSchema` (role ∈ PARTNER_ADMIN|PARTNER_AGENT|PARTNER_FINANCE), `changeRoleSchema`, `userQuerySchema` (page/pageSize inline, `status ∈ INVITED|ACTIVE|DEACTIVATED`), `userIdParamSchema` (local `idField` as in `validation/dispatch.js:31`), `auditQuerySchema` (`entityType`, `entityId`, `actorUserId`, `action`, `from`, `to`, page/pageSize ≤ 100).
- `serializers/user.js` (exists; `toUser` at :8) — add `toUserSummary(user)` (id, email, names, role, position, phone, status derived: `!passwordHash → 'INVITED'`, `!isActive → 'DEACTIVATED'`, else `'ACTIVE'`; `lastLoginAt`, `invitedAt`, `partnerId`) and extend `toUser` with `capabilities: capabilitiesFor(user.role)`; `/me` is served by `identity(req.user)` in `services/auth.service.js` (`routes/auth.routes.js:71-73`), which must include the same field.
- `routes/admin.users.routes.js` — mounted at `/admin/users` in `routes/index.js` before `/admin/partners` (specific-before-broad rule, 97–99). All routes `authenticate, requireCapability('users.staff.manage')`:
  - `GET /` list (query `userQuerySchema`, scope STAFF) → `{ data, total, page, pageSize, totalPages }`
  - `POST /` invite → 201 `{ user, activationLink }`
  - `GET /:id`, `PATCH /:id/role`, `POST /:id/deactivate`, `POST /:id/reactivate`, `POST /:id/sessions/revoke`, `POST /:id/activation/resend`, `DELETE /:id` (body `{ confirm: email }`) → 204
- `routes/partner.team.routes.js` — `/partner/team`, `authenticate, requirePartner, requireApprovedPartner, requireCapability('partner.team.manage')`: same verbs scoped to `req.user.partnerId`; invite roles limited to PARTNER_ADMIN|AGENT|FINANCE; `PATCH /:id/primary-contact`. The service refuses any `userId` whose `partnerId !== viewer.partnerId` with 404 (tenant isolation, same style as `assertMayRead`).
- `routes/admin.audit.routes.js` — `GET /admin/audit` (`audit.read`) → `listAudit(query)` generalised from `partner.service.js:571-577` into `services/audit.service.js`; keep the partner-scoped endpoint delegating to it.

**Modified files**
- `middleware/auth.js`: add `requireCapability`; re-express `requireAdmin`, `requireTransferOps`, `FINANCIAL_ROLES` checks through `can`; export `canViewMargin = (v) => can(v, 'finance.margin.read')` (Phase 0.2 placeholder becomes this).
- `services/auth.service.js`: `login` writes `USER_LOGIN_SUCCEEDED` (metadata `{ ip, userAgent }`) at :151; `logout` writes `USER_LOGGED_OUT`; `/me` payload includes capabilities.
- `routes/auth.routes.js:71` (`/me`) and login response: use `toSessionUser`.
- Serializers that gate money on `isAdmin`: `booking.js:91`, `tourBooking.js:60`, `service.js:141`, `transfer.js:97,143,260`, `order.js:47,77`, `package.js:97,140,226,294`, `inventory.js:147`, `kosher.js:59`, `tour.js:90`, `partner.js:90` → `can(viewer, 'finance.margin.read')` for money, `can(viewer, 'partners.read')` for partner identity, `can(viewer, 'catalogue.write')`-type checks where the flag drives admin-only fields. Grep `isAdmin(` in `serializers/` (expect ~20 sites) and convert each with the matrix below.
- Router conversion (one task per router, table in 1.H): replace `requireAdmin` with the precise capability (`catalogue.write` for hotels/destinations/amenities/transfer catalogue/tours/services/packages; `bookings.read`/`bookings.write`/`bookings.cancel` on booking routers; `partners.write` on partner review; `pricing.write` on pricing rules; `finance.*` on summaries). Partner routers: `partner.bookings.write` on create/amend/cancel paths (public routers check `can` when `req.user?.partnerId` is set).
- `lib/audit.js`: nothing structural; add `AUDIT_ENTITY.session` if sessions get entries (optional).
- `routes/index.js`: mount `/admin/users`, `/admin/audit`, `/partner/team`.
- `API.md`: new "Users and roles" section; `docs/API_TESTING_GUIDE.md` Part 3b; Postman folder `01c · Users & roles`.

**Permission matrix (server-side truth; `lib/permissions.js`)**

| Capability | SUPER_ADMIN | ADMIN | MANAGEMENT | RESERVATIONS | FINANCE | DISPATCHER | P_OWNER | P_ADMIN | P_AGENT | P_FINANCE |
|---|---|---|---|---|---|---|---|---|---|---|
| `platform.admin` (legacy alias; nothing new should use it) | ✔ | ✔ | – | – | – | – | – | – | – | – |
| `users.staff.manage` | ✔ | – | – | – | – | – | – | – | – | – |
| `settings.write` | ✔ | – | – | – | – | – | – | – | – | – |
| `audit.read` | ✔ | ✔ | ✔ | – | ✔ | – | – | – | – | – |
| `catalogue.read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | – | – | – | – |
| `catalogue.write` (hotels, destinations, amenities, transfer catalogue, tours, services, packages, media) | ✔ | ✔ | – | – | – | – | – | – | – | – |
| `pricing.write` (pricing rules, commission) | ✔ | ✔ | – | – | – | – | – | – | – | – |
| `bookings.read` (all products, all companies) | ✔ | ✔ | ✔ | ✔ | ✔ | – | – | – | – | – |
| `bookings.write` (create on behalf, amend, confirm/decline on-request) | ✔ | ✔ | – | ✔ | – | – | – | – | – | – |
| `bookings.cancel` | ✔ | ✔ | – | ✔ | – | – | – | – | – | – |
| `dispatch.read` (transfer bookings list/detail without money, fleet, drivers, schedule) | ✔ | ✔ | ✔ | ✔ | – | ✔ | – | – | – | – |
| `dispatch.write` (assign, fleet/driver CRUD, ops media) | ✔ | ✔ | – | – | – | ✔ | – | – | – | – |
| `partners.read` | ✔ | ✔ | ✔ | ✔ | ✔ | – | – | – | – | – |
| `partners.write` (invite, approve, reject, suspend, commission, delete) | ✔ | ✔ | – | – | – | – | – | – | – | – |
| `partners.financial.read` (bank details) | ✔ | ✔ | – | – | ✔ | – | – | – | – | – |
| `finance.margin.read` (net, markup, margin on any booking) | ✔ | ✔ | ✔ | – | ✔ | – | – | – | – | – |
| `finance.payables.read` / `finance.receivables.read` / `finance.payments.read` | ✔ | ✔ | ✔ | – | ✔ | – | – | – | – | – |
| `finance.payments.write` (record, allocate, void payments; mark instalments paid) | ✔ | ✔ | – | – | ✔ | – | – | – | – | – |
| `finance.terms.write` (supplier terms, partner terms, reminder settings) | ✔ | ✔ | – | – | ✔ | – | – | – | – | – |
| `finance.reports.read` / `finance.export` | ✔ | ✔ | ✔ | – | ✔ | – | – | – | – | – |
| `invoices.read` | ✔ | ✔ | ✔ | – | ✔ | – | – | – | – | – |
| `invoices.write` (issue, send, correct) | ✔ | ✔ | – | – | ✔ | – | – | – | – | – |
| `notifications.read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `partner.profile.write` | – | – | – | – | – | – | ✔ | ✔ | – | – |
| `partner.financial.read/write` | – | – | – | – | – | – | ✔ | – | – | ✔ |
| `partner.team.manage` | – | – | – | – | – | – | ✔ | ✔ | – | – |
| `partner.bookings.read` | – | – | – | – | – | – | ✔ | ✔ | ✔ | ✔ |
| `partner.bookings.write` / `partner.bookings.cancel` | – | – | – | – | – | – | ✔ | ✔ | ✔ | – |
| `partner.inventory.write` (extranet rates/inventory) | – | – | – | – | – | – | ✔ | ✔ | – | – |
| `partner.statement.read` / `partner.invoices.read` | – | – | – | – | – | – | ✔ | ✔ | – | ✔ |

Partner capabilities are always tenant-scoped by `viewer.partnerId` in services (unchanged mechanism). Behaviour changes versus today, to confirm with the owner: PARTNER_FINANCE loses booking create/amend/cancel; DISPATCHER loses transfer cancel (Phase 0.3); ADMIN loses staff management to SUPER_ADMIN.

## 1.E Frontend implementation

- `client/types/partner.ts:15-23` `Role` union + 3 roles; `client/types/auth.ts`: `SessionUser.capabilities: string[]`, helper `can(session, cap)`; `homePathFor` sends MANAGEMENT/RESERVATIONS/FINANCE to `/admin`.
- `client/lib/auth/session.ts requireAdminSession` (28–43): allow any session with `capabilities.includes('catalogue.read')` (i.e. all platform roles); `(panel)/page.tsx:35-38` redirect logic becomes capability-based (DISPATCHER → dispatch; FINANCE → `/admin/finance` in Phase 2).
- `client/lib/admin/navigation.ts`: replace `ops?: boolean` with `capability?: string` on `AdminNavItem`; `navigationFor(capabilities)` filters by it (keep `ops` semantics for DISPATCHER via `dispatch.read`). Add group **People**: "Staff" (`/admin/users`, `users.staff.manage`), "Audit log" (`/admin/audit`, `audit.read`). `AdminShell.tsx:60-65 ROLE_LABELS` + Management, Reservations, Finance.
- Pages (each needs a help article or an exemption in `lib/admin/help/routes.ts:21-26`, enforced by `test/help-registry.test.ts:154`):
  - `app/[locale]/(admin)/admin/(panel)/users/page.tsx` — list via `listAdminUsers` (serverFetch), `UsersBrowser` (clone of `PartnersBrowser` pattern: URL-state filters role/status/search, 300 ms debounce, Page x of y), header action "Invite staff" opening `InviteUserModal` (`components/ui/Modal`, `FormControls`), on success shows the activation link with the inline Copy-link pattern from `PartnerActions.tsx:277-291` and `router.refresh()`.
  - `users/[id]/page.tsx` — `AdminDefinitionList` profile, status badge (`StatusBadge` Pill tones), `UserActions` (change role select + confirm, deactivate/reactivate, revoke sessions, resend activation), `UserDangerZone` (type the email to confirm; `router.replace('/admin/users')`).
  - `audit/page.tsx` — `AuditBrowser` with filters (entity type, action, actor, date range) over `GET /api/admin/audit`; reuse `toAuditEntry` shape and the labels in `lib/admin/partners.ts:84-102` (move to `lib/admin/audit.ts`).
- Portal: `app/[locale]/(portal)/portal/team/page.tsx` guarded inline like `settings/page.tsx:25-38` plus `can(session,'partner.team.manage')`; `components/partners/TeamSection.tsx` (list, invite modal, role change, deactivate, resend, primary-contact toggle). Add "Team" to `PortalShell.tsx:20-22` when the capability is present. `PortalSettings.tsx:53` gate → capability.
- API: `client/lib/api/users.ts` (`listAdminUsers`, `getAdminUser`, `inviteStaff`, `changeUserRole`, `deactivateUser`, `reactivateUser`, `revokeUserSessions`, `resendUserActivation`, `deleteUser`; `listTeam`, `inviteTeamMember`, …, `setPrimaryContact`), `client/lib/api/audit.ts` (`listAudit`), `client/lib/api/admin.ts` unchanged. Types `client/types/user.ts`.
- Help: `lib/admin/help/articles/people/{staff,audit-log}.ts` (prefix `pp-`? add to `test/help-registry.test.ts:33` prefixes), update `getting-started/accounts.ts:4-6,37`, `roles.ts`, `reference/troubleshooting.ts:179`, `signing-in.ts:66-75`.
- Loading/empty/error: shared `(panel)/loading.tsx` covers lists; `EmptyState` for no users; `describeError` inline messages (no toast system exists).
- Run `npx next typegen` after adding routes.

## 1.F Business logic (workflows)

1. **Invite staff** (SUPER_ADMIN): validate → refuse existing email (409 like `invitation.service.js:146-148`) → create `User{ role, partnerId: null, passwordHash: null, invitedBy, invitedAt }` → `issueAuthToken(ACCOUNT_ACTIVATION, 48h)` → `sendMailQuietly('accountActivation')` → audit `USER_INVITED` → respond with link. Edge: resend reissues (old token spent by `issueAuthToken`); expired link → 410 on the existing activation page; the invitee's first login after activation is audited.
2. **Invite team member** (PARTNER_OWNER/ADMIN): same, with `partnerId = viewer.partnerId`, role ceiling (an OWNER may invite ADMIN/AGENT/FINANCE; an ADMIN may invite AGENT/FINANCE only), partner must be APPROVED, cap of 25 members per partner (config `PARTNER_TEAM_MAX`).
3. **Change role**: ceiling check (actor cannot grant above own level: SUPER_ADMIN > ADMIN > others; OWNER > ADMIN > AGENT/FINANCE); refuse demoting the last SUPER_ADMIN or last active PARTNER_OWNER; revoke the target's sessions; audit from/to.
4. **Deactivate**: refuse self; refuse last SUPER_ADMIN/last OWNER; set flags; revoke sessions; audit with reason. Login then fails with `inactive` (existing). Reactivate clears flags.
5. **Delete**: hard delete only for INVITED or DEACTIVATED users (ACTIVE must be deactivated first); confirmation body `{ confirm: email }`; cascades `Session`/`AuthToken` (existing FKs, `onDelete: Cascade` at schema 3388). Verified: every booking, hold, upload and kosher reference to a user is `onDelete: SetNull` (`bookedByUserId` on hotel 2474, transfer 4095, tour 1241, service 1501, order 1782), so hard delete is safe; audit rows keep `actorEmail`.
6. **Primary contact**: exactly one per partner; transfer by `setPrimaryContact` in one transaction.

## 1.G Security

- All new routers behind `authenticate` + capability; tenant isolation by `partnerId` equality in every team query; 404 for foreign ids.
- Invitation link only in the API response to the inviter and in the email; never logged (the token is in a URL — add `activationLink` to a response-redaction list if responses are ever logged; today pino logs headers only).
- Rate-limit invites: `inviteLimiter` (per user, 30/15 min) alongside the existing limiters.
- Password policy unchanged (`validation/normalize.js:188-212`); activation page unchanged.
- `USER_LOGIN_SUCCEEDED` must not store the password or token; `ip`/`userAgent` only.

## 1.H Testing

- `test/permissions.unit.test.js`: every role's capability set; `can()` with undefined viewer; no capability granted to two mutually exclusive roles by accident (e.g. DISPATCHER never has `finance.margin.read`).
- `test/rbac.matrix.test.js` (table-driven): for each mounted router (walk `routes/index.js` like the Postman generator did) × each role (incl. anonymous): expected status class (2xx/401/403/404). Seed one user per role with `makeAdmin(tracker, { role })` and `makePartnerUser(tracker, partner, { role })`.
- `test/users.admin.test.js`: invite/resend/role/deactivate/reactivate/delete; ceilings; last-admin guards; ADMIN gets 403 on `/admin/users`; activation of an invited staff member through `/api/auth/activation/:token` signs in with the right role.
- `test/partners.team.test.js`: owner invites agent; admin cannot invite admin; agent 403; cross-partner 404; last-owner guard; primary contact transfer; team cap.
- `test/audit.test.js` extend: global reader, filters, partner cannot read; login success/logout rows.
- Serializer regression: `supplier.test.js`, `transfers.foundation.test.js:155`, `admin.summaries.test.js` stay green; new assertions for MANAGEMENT (sees margin, cannot write) and RESERVATIONS (cancels, sees no margin).
- Client: `test/help-registry.test.ts` passes with new articles; `npm run typecheck`, `lint`, `build`.
- Acceptance: a SUPER_ADMIN invites a RESERVATIONS user who activates, signs in, sees Bookings but no margin and no Partners; a partner owner invites an agent who can book but cannot open bank details.

## 1.I Deployment

- Two migrations (enum values first). `prisma migrate deploy` runs in `preDeployCommand` (`render.yaml:41`) / the `migrate` compose service; both additive and reversible by leaving columns unused.
- No new env vars except `PARTNER_TEAM_MAX` (default 25) and `AUTH_INVITE_LIMIT` (default 30).
- Rollout order: deploy server (old client keeps working: `/me` gains a field); deploy client. Feature flag not needed; new roles cannot be created until the Staff UI ships.
- Rollback: forward-only; the CHECK constraint change is harmless to old code.

## 1.J Effort and risks

| Item | Days |
|---|---|
| permissions module, `requireCapability`, `/me` capabilities, unit tests | 1.5 |
| Router and serializer conversion + matrix test | 3–4 |
| user.service + admin users routes + tests | 2.5 |
| partner team routes + tests | 1.5 |
| audit service/reader + login audit | 1 |
| Client: staff pages, team page, audit page, nav, types, help | 4–5 |
| Docs, Postman, API.md | 1 |
| **Total** | **14–17** |

Risks: router conversion touching every admin route (mitigated by the matrix test); behaviour changes for PARTNER_FINANCE and DISPATCHER (confirm with owner before conversion); `bookedByUserId` delete semantics (verify FK); help-registry test forcing articles for new pages (budgeted).

---

# Phase 5 — Google Maps hotel autocomplete and transfer routing (independent workstream)

## 5.A Current architecture (verified)

- Search form: `client/components/transfers/TransferSearch.tsx:151,162` → `LocationSelector` (Modal picker, `searchTransferPoints(term, locale)` → `GET /api/transfers/points?search=`, value = point **slug**); URL params in `lib/transfers/query.ts` (`from`, `to` slugs). Results and booking pages call `quoteTransfers(query)` (`lib/api/transfers.ts:158`), which hits `GET /api/transfers/quotes` with `from`/`to` = id or slug only (`validation/transfer.js:111-127`).
- Server: `resolveEndpoints` (`services/transfer/point.service.js:86`), `quotesForJourney` (`quote.service.js:146`), `outboundMetrics` = curated route figures else `routeMetrics(from, to)` haversine × `TRANSFER_ROAD_FACTOR` (`pricing.service.js:55-67`); offer token carries point ids (`lib/transfer/quoteToken.js:30`); `createRoute` caches derived metrics (`route.service.js:178-184`); `assertPlaceUnclaimed` already dedupes points by `place.placeId` (`point.service.js:126-147`, 409 `PLACE_TAKEN`); `geo` maintained by trigger `transfer_points_set_geo`; nearest-point SQL in `services/package/recommendation.service.js:32-46` (not exported, no distance cap). Slugs are admin-supplied (no generator).
- Checkout: `TransferBookingForm.tsx:391-414` `PlaceSearch` for exact doors → `pickupPlace`/`dropoffPlace` (`placedLocationSchema`), display-only.
- Geo components: `PlaceSearch.tsx` (session token, Georgia bias, no type/region filter, `PLACE_FIELDS` incl. `displayName`), `LocationField`, `LocationMap` (admin only), `GoogleMapsProvider` (`places`, `marker`, `geocoding` libraries; `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`).
- Hotels: `Hotel.latitude/longitude/place/geo`, `GET /api/hotels?search=` name/slug/address (`hotel.service.js:235-243`). `TransferPoint` has `destinationId` but no `hotelId`. Seed has 0 HOTEL points.
- Google Maps Platform facts (docs fetched 2026-10-08): Autocomplete session + Essentials-only Place Details is the cheap path; `includedPrimaryTypes` ≤ 5, `includedRegionCodes` ≤ 15; Routes API `computeRoutes` DRIVE + `TRAFFIC_UNAWARE` + field mask `routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline` = Compute Routes Essentials (USD 5/1k, 10k free/month); place ids storable indefinitely, Places lat/lng cacheable 30 days (Maps Service Terms §14.3); server key must be IP-restricted.

## 5.B Proposed architecture

1. **Unified location search** on the transfer search form: a new `LocationPicker` that merges (a) internal results from `GET /api/transfers/locations?q=` (TransferPoints + published Hotels with coordinates, grouped) and (b) Google Places predictions filtered to lodging/airport/transit types in Georgia. Internal results render first; Google is queried only when the internal list has fewer than 3 hits or the user keeps typing (cost control).
2. **Resolution to a point id** stays the contract of quotes and tokens. Selecting an internal hotel or a Google prediction calls `POST /api/transfers/points/resolve`, which returns an existing point (by `hotelId`, by `place.placeId`, or by proximity ≤ 150 m) or creates a **pending** point (`reviewStatus: PENDING`, kind from `suggestPointKind`, slug generated server-side). The URL then carries the point slug exactly as today, so results, booking, dispatch and reporting are untouched.
3. **Road metrics** from the Routes API on the server, cached per ordered point pair in `transfer_route_metrics` (distance, duration, polyline, provider, fetchedAt), refreshed after 30 days; `outboundMetrics` prefers cache → Routes → haversine fallback. Curated `TransferRoute.distanceKm/durationMinutes` remain authoritative when set.
4. **Map** on the results and booking pages (site variant of `LocationMap` with two markers and the polyline) — read-only, no interaction cost.
5. **Driver link** falls back to the point's coordinates when no exact door exists.

## 5.C Database changes

Migration `20261020100000_transfer_points_review_enum` (enum): `CREATE TYPE "transfer_point_review" AS ENUM ('APPROVED','PENDING','REJECTED');` plus `ALTER TYPE "audit_action" ADD VALUE 'TRANSFER_POINT_AUTO_REGISTERED'`, `'TRANSFER_POINT_REVIEWED'`, `'TRANSFER_ROUTE_METRICS_REFRESHED'`.
Migration `20261020100100_transfer_points_hotels_metrics` (hand-written):
```sql
ALTER TABLE "transfer_points" ADD COLUMN "hotel_id" TEXT, ADD COLUMN "review_status" "transfer_point_review" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'ADMIN', ADD COLUMN "place_refreshed_at" TIMESTAMP(3);
ALTER TABLE "transfer_points" ADD CONSTRAINT "transfer_points_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "transfer_points_hotel_id_key" ON "transfer_points"("hotel_id") WHERE "hotel_id" IS NOT NULL;
CREATE UNIQUE INDEX "transfer_points_place_id_key" ON "transfer_points"((("place"->>'placeId'))) WHERE "place" IS NOT NULL AND "status" <> 'ARCHIVED';
CREATE TABLE "transfer_route_metrics" (
  "id" TEXT PRIMARY KEY, "from_point_id" TEXT NOT NULL REFERENCES "transfer_points"("id") ON DELETE CASCADE,
  "to_point_id" TEXT NOT NULL REFERENCES "transfer_points"("id") ON DELETE CASCADE,
  "distance_m" INTEGER NOT NULL, "duration_s" INTEGER NOT NULL, "polyline" TEXT, "provider" TEXT NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transfer_route_metrics_pair_key" UNIQUE ("from_point_id","to_point_id"));
```
Prisma: `TransferPoint` + `hotelId`, `hotel Hotel?`, `reviewStatus TransferPointReview @default(APPROVED)`, `source String @default("ADMIN")`, `placeRefreshedAt`; `Hotel` + `transferPoint TransferPoint?`; new `model TransferRouteMetrics`. Backfill: none required; optional script `scripts/link-hotel-points.js` matching existing HOTEL points to hotels by `place.placeId` or ≤ 50 m.

## 5.D Backend implementation

- `services/transfer/location.service.js` (new): `searchLocations({ q, locale, limit })` → `{ points: [...toPoint], hotels: [{ id, slug, name, city, latitude, longitude, pointId? }] }` using `listPoints` and `listHotels({ search, status: PUBLISHED })` with coordinates; `resolveLocation(input, actor, req)` where `input` is one of `{ pointId }`, `{ hotelId }`, `{ place: placeRefSchema, latitude, longitude }`: lookup order hotel link → place id → nearest ACTIVE point within 150 m (export and parameterise `nearestPoint` from `recommendation.service.js` with a `maxMetres` cap) → create via `createPoint` with `slug = slugify(name)-{suffix}` (new `lib/slug.js`, unique-checked), `kind = suggestPointKind(types)` (server copy of the client helper: lodging→HOTEL, airport→AIRPORT, else LANDMARK), `regionLabel` = place.region ?? city, `destinationId` = nearest destination by `geo` within 30 km (optional), `reviewStatus: PENDING`, `source: 'PLACES'`, `timezone: 'Asia/Tbilisi'`; audit `TRANSFER_POINT_AUTO_REGISTERED` with the actor (partner user or guest → `system`). Rate-limited (`searchLimiter`, and a new `resolveLimiter` 30/15 min per IP) because anonymous visitors may call it.
- `services/geo/routes.service.js` (new): `fetchRoadMetrics(from, to)` → `POST https://routes.googleapis.com/directions/v2:computeRoutes` with `X-Goog-Api-Key: config.geo.routesApiKey`, `X-Goog-FieldMask: routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline`, body `{ origin: { location: { latLng } }, destination: …, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', units: 'METRIC' }`; 5 s timeout (`AbortSignal.timeout`), one retry on 5xx/429, `BadGatewayError` otherwise; `getRouteMetrics(fromPoint, toPoint)` reads `transfer_route_metrics` (fresh ≤ 30 days) else fetches and upserts, else returns `null`. Uses global `fetch` (Node 24); no new dependency.
- `services/transfer/quote.service.js:189-197`: `outboundMetrics` = curated route → `await getRouteMetrics()` → `routeMetrics()`; the return leg reuses the reverse pair. Keep the quote fast: a cache miss costs one HTTP call (~300 ms); pre-warm popular pairs via a daily sweeper `sweepRouteMetrics` (points marked `popular`) registered in `server.js` like the others (interval `TRANSFER_ROUTE_METRICS_SWEEP_INTERVAL_MS`, 24 h, xact advisory lock).
- `services/transfer/route.service.js:178-184`: `createRoute` prefers `getRouteMetrics` before the haversine derivation; `updatePoint` with changed coordinates deletes cached metrics for that point (existing follow-up "recompute route distances when a point moves").
- Routes: `routes/transfers.routes.js` + `GET /locations` (query `{ q: 2..80 chars, locale, limit ≤ 10 }`) and `POST /points/resolve` (body `resolveLocationSchema`, `optionalAuthenticate`); `routes/admin.transfers.routes.js` + `GET /points/review` (list PENDING), `POST /points/:id/review` (`{ decision: APPROVE | REJECT | MERGE_INTO: pointId }` — MERGE re-points `transfer_booking_legs` and metrics to the survivor and archives the duplicate), capability `catalogue.write`.
- `validation/transfer.js`: `locationQuerySchema`, `resolveLocationSchema` (`z.union` of the three shapes, `.strict()`), `reviewPointSchema`; `pointQuerySchema` gains `reviewStatus`.
- `serializers/transfer.js toPoint` adds `hotelId`, `reviewStatus`; `toQuoteResult` adds `route.metricsSource: 'CURATED' | 'ROAD' | 'ESTIMATE'` and `polyline` (string | null) for the map.
- Config: `config.geo = { routesApiKey: process.env.GOOGLE_ROUTES_API_KEY ?? null, routesTimeoutMs, metricsTtlDays: 30, resolveMaxMetres: 150 }`; redact `GOOGLE_ROUTES_API_KEY` from logs (not logged today; add to `REDACTED_PATHS` only if request bodies are ever logged). When the key is absent, `getRouteMetrics` returns `null` and the estimate path is used (safe default for dev/test).
- Driver panel: `client/app/[locale]/(driver)/driver/(panel)/assignments/[id]/page.tsx:45-61` falls back to the leg point's coordinates.

## 5.E Frontend implementation

- `components/transfers/LocationPicker.tsx` (new, replaces `LocationSelector` usage in `TransferSearch.tsx`): one input, debounced 300 ms; group "Our locations" (points + hotels from `/api/transfers/locations`), group "More places (Google)" from `PlaceSearch`'s suggestion hook refactored into `useAutocompleteSuggestions({ includedPrimaryTypes: ['lodging','airport','train_station','bus_station','point_of_interest'], includedRegionCodes: ['ge'] })` (extract from `PlaceSearch.tsx:190-230` into `components/geo/useAutocompleteSuggestions.ts`); selection of a Google row → `fetchFields` with Essentials fields only → `resolveTransferLocation({ place, latitude, longitude })` → set slug. Keyboard navigation and ARIA listbox as in `PlaceSearch`. Fallback when Maps is unavailable: internal results only (today's behaviour).
- `lib/api/transfers.ts`: `searchTransferLocationsClient(q, locale)`, `resolveTransferLocation(input)`; types in `types/transfer.ts` (`TransferLocationResult`, `TransferPoint.reviewStatus`, `TransferQuoteResult.route.polyline`).
- Results page `transfers/search/page.tsx` and booking page: `components/transfers/RouteMap.tsx` (client, inside `GoogleMapsProvider`, `LocationMap`-style `GoogleMap` with two `AdvancedMarker`s and a `Polyline` decoded from `encodedPolyline` via the `geometry` library — add `"geometry"` to `GoogleMapsProvider.tsx:33`); hidden when no key. "Distance 32 km · about 45 min (road)" vs "(estimate)" label from `metricsSource`; i18n keys `t.transfers.results.metrics.*` in four locales.
- Admin: `transfers/points/page.tsx` filter "Pending review" + `PointReviewActions` (approve / reject / merge into picker using `TransferPointSearch`); badge key `pendingPoints` (add to `AdminBadgeKey`, `lib/api/admin.ts`, `/api/admin/badges`); help article `tr-point-review`.
- `PlaceSearch.tsx`: props from Phase 0.7 (`includedPrimaryTypes`, `includedRegionCodes`); checkout keeps using it for exact doors.

## 5.F Business logic

- Resolve order: hotelId → existing point (by `hotelId`, else by `place.placeId`, else nearest ≤ 150 m → link `hotelId` on that point) → create HOTEL point from the hotel's own coordinates/place. placeId → existing by placeId → nearest ≤ 150 m → create PENDING point. Coordinates without place (manual pin) → nearest ≤ 150 m → else create LANDMARK PENDING point named "Pinned location near {city}".
- A PENDING point is bookable immediately (status ACTIVE) but hidden from the public points list (`listPoints` filters `reviewStatus: APPROVED` unless `includePending`), so the catalogue stays clean while operations review. Reject archives the point; bookings keep their leg snapshot (`TransferBookingLeg` stores point names).
- Pricing is unchanged: curated price if a route exists for the pair, else per-km on road km (falls back to estimate). A pending point never matches a curated route, so it prices by distance — expected.
- Metrics freshness: `fetchedAt` older than 30 days → refetch lazily; failures keep the stale value for another day (`staleUntil`) and log a warning.
- Edge cases: Google returns a place outside Georgia (region filter prevents most; server rejects coordinates outside `GEORGIA_BOUNDS` with 422 `OUTSIDE_SERVICE_AREA`); two agents resolve the same hotel concurrently (unique index on placeId → catch P2002 → re-read); Routes API down (estimate path, `metricsSource: ESTIMATE`).

## 5.G Security and cost

- Browser key: referrer-restricted, Maps JavaScript + Places (New) + Geocoding only; server key: IP-restricted (Render egress IPs) or routed through a tiny proxy if IPs are dynamic, Routes API only; both with daily quotas; budget alert at USD 50. Keys live in Vercel/Render env only; `.env.example` entries documented with names.
- `POST /points/resolve` is anonymous-capable: validate strictly, rate-limit per IP, cap PENDING points created per IP per day (config `TRANSFER_RESOLVE_DAILY_CAP`, default 20) to prevent catalogue spam; audit every auto-registration.
- Compliance: store place ids indefinitely; `placeRefreshedAt` lets a monthly sweeper re-fetch Essentials fields for Places-sourced points (keeps lat/lng within the 30-day cache term) — or legal confirms admin-approved coordinates are the platform's own data, in which case the sweeper refreshes only PENDING points.
- Estimated cost at list prices: one hotel selection ≈ USD 0.005 (Essentials details) + ≤ 12 × USD 0.00283 autocomplete requests; one road metric ≈ USD 0.005, cached 30 days per pair; internal-first search avoids most Google calls.

## 5.H Testing

- Server: `test/transfers.locations.test.js` — search merges points and hotels; resolve by hotel creates and links a HOTEL point once (second call returns the same id); resolve by placeId dedupes; proximity match within 150 m; outside-Georgia 422; daily cap 429; review approve/reject/merge (legs re-pointed). `test/geo.routes.unit.test.js` — `fetchRoadMetrics` against a stubbed `fetch` (success, 429 retry, timeout → null); `getRouteMetrics` cache hit/miss/stale. `transfers.pricing.test.js` — quote uses road metrics when cached, estimate otherwise, curated always wins; `metricsSource` serialised. `transfers.booking.test.js` — booking a pending point works and the leg snapshot survives rejection.
- Client: `test/transfer-location-picker.test.ts` for the pure merge/ranking helper (internal first, dedupe by pointId); `geo-place.test.ts` for the server-side `suggestPointKind` twin if shared via a JSON fixture.
- Manual/E2E: type "Biltmore" on `/transfers` with the key set → internal hotel appears (seed one HOTEL point or a published hotel with coordinates) → select → results show road distance and map → book → driver panel Navigate link.
- Acceptance: "Tbilisi International Airport → The Biltmore Hotel Tbilisi" quotes with road distance, shows both pins, books, and the new point appears in the admin review queue.

## 5.I Deployment

- Env: `GOOGLE_ROUTES_API_KEY` (server, optional; absent = estimate mode), `TRANSFER_ROUTE_METRICS_SWEEP_INTERVAL_MS`, `TRANSFER_RESOLVE_DAILY_CAP`; client `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` set. Add to `render.yaml` (`sync: false`), `docker-compose.prod.yml` build args/env, `docs/DEPLOYMENT.md` §3.2, `.env.example`.
- Migrations additive; `reviewStatus` default APPROVED keeps all existing points visible.
- Feature flag: `NEXT_PUBLIC_TRANSFER_LOCATION_PICKER=1` to switch `TransferSearch` between `LocationSelector` and `LocationPicker` during rollout (client-only, removed after two weeks).
- Monitoring: log a `geo.routes` counter line per fetch (hit/miss/fail) so Google spend can be reconciled against logs; Google Cloud quota alerts.
- Rollback: unset the flag; server endpoints are additive.

## 5.J Effort and risks

| Item | Days |
|---|---|
| Schema, point review status, hotel link, metrics table | 1 |
| location.service (search + resolve + review/merge) + tests | 3 |
| routes.service (Routes API, cache, sweeper) + quote integration + tests | 2 |
| Client LocationPicker + hook extraction + RouteMap + i18n | 3–4 |
| Admin review queue + badge + help | 1 |
| Keys, env, docs, flag | 0.5 |
| **Total** | **10–12** |

Risks: catalogue pollution (mitigated by PENDING + cap + merge tool); price changes for existing uncurated pairs when road km replaces estimates (announce; `TRANSFER_ROAD_FACTOR` tuned on real roads per `transfers.pricing.test.js:42`, so differences should be small); Google pricing drift (re-verify at launch); referrer-restricted key misuse if the server key is mistakenly exposed (separate keys, never `NEXT_PUBLIC_` for the server one).

---

# Phase 2 — Operational financial management

## 2.A Current architecture (verified)

- Every booking freezes money: `HotelBooking.currency/netTotalCents/sellTotalCents/taxTotalCents/payableAtPropertyCents/markupBps` (2484–2489), `cancellationChargeCents` (2507); the same on `TransferBooking` (4119–4122, 4157), `TourBooking` (1259–1262, 1292), `ServiceBooking` (1514–1517, 1535), `Order` (1794–1798, 1813), `OrderItem` (1853–1859). `taxTotalCents` is the *included* tax the guest pays us (`services/hotel/pricing.service.js:255-258`, voucher `outbox.service.js:739-742`); `payableAtPropertyCents` is collected by the hotel.
- Margin is derived in serializers (`serializers/booking.js:91-96` etc.), never stored. Cancellation computes `chargeCents`/`refundCents` (`services/hotel/booking.service.js:629-643`, `policy.service.js:146-166`) but persists only the charge; refund and order clawback live in audit metadata only.
- Supplier identity per product: `Hotel.supplierId` (750), `Tour.supplierId` (909), `Service.supplierId` (1427), transfer `TransferVehicle.providerId → TransferProvider.partnerId`. Supplier bank details: `PartnerFinancialDetail` (3510–3525) behind `FINANCIAL_ROLES`.
- Partner commission: `Partner.commissionRateBps` (3454); `PricingRule` (2663–2710); `resolveMarkup`.
- No Payment, Payable, Receivable, Ledger or Invoice model; no PSP; no CSV/report endpoints; summaries sum sell by currency only (`booking.service.js:1143-1158`, `transfer/booking.service.js:738-764`).
- Hook points: `confirmXInTx` (hotel 305, transfer 255, tour 192 / pending 607, service 172 / pending 464), facades (hotel `confirmBooking` 459, transfer 377, tour 328, service 254), `confirmOrder` (order.service.js 454–589, tx at 473 with `config.order.txTimeoutMs`), cancel InTx (hotel 672, transfer 590, tour 514, service 395, order item 776, order 832). Amend endpoints are paperwork-only (no price change).
- Idempotency: `idempotencyKeyFrom(req)` + `assertReplayOwner` (`lib/idempotency.js`). Pagination envelope `{ data, total, page, pageSize, totalPages }`. Json columns must be registered in `validation/domain.js jsonFieldSchemas` (167–256).

## 2.B Proposed architecture

Operational finance, not bookkeeping: the platform answers "who owes whom how much, since when, what was paid". Four core entities on the finance side with nullable unique FKs to bookings (booking tables untouched, the `OrderItem` exactly-one-child pattern): `SupplierPayable` (+ `PayableInstalment`), `Receivable`, `PaymentRecord` (+ `PaymentAllocation`). Terms live on `SupplierPaymentTerms` (per hotel/provider/tour/service) and on `Partner` (due days). A single `services/finance/ledger.service.js` creates and updates records inside the existing booking transactions; `payment.service.js` records cash with allocations under row locks; `report.service.js` aggregates per currency and streams CSV. Statutory accounting stays outside (exports).

## 2.C Database changes (Prisma, for review only)

Timestamps stay `TIMESTAMP(3)` UTC like the rest of the schema (no `timestamptz` mixing); ids `cuid()`; tables `@@map` snake_case.

Enums (new types, created in the module migration): `FinanceProduct { HOTEL TRANSFER TOUR SERVICE }`, `SettlementStatus { OPEN PARTIAL PAID VOID WAIVED }`, `InstalmentKind { DEPOSIT BALANCE }`, `MilestoneBasis { PERCENT FIXED }`, `MilestoneAnchor { CONFIRMATION ARRIVAL DEPARTURE }`, `ReceivableDueAnchor { CONFIRMATION ARRIVAL }`, `PaymentDirection { IN OUT }`, `PaymentKind { PAYMENT REFUND }`, `PaymentMethod { BANK_TRANSFER CASH CARD OTHER }` (each `@@map("snake_case")`).

```prisma
/// One row per Hotel, TransferProvider, Tour or Service (exactly one subject, CHECK).
/// No row = "no terms": a single BALANCE instalment with no due date.
model SupplierPaymentTerms {
  id                 String            @id @default(cuid())
  hotelId            String?           @unique @map("hotel_id")
  hotel              Hotel?            @relation(fields: [hotelId], references: [id], onDelete: Cascade)
  transferProviderId String?           @unique @map("transfer_provider_id")
  transferProvider   TransferProvider? @relation(fields: [transferProviderId], references: [id], onDelete: Cascade)
  tourId             String?           @unique @map("tour_id")
  tour               Tour?             @relation(fields: [tourId], references: [id], onDelete: Cascade)
  serviceId          String?           @unique @map("service_id")
  service            Service?          @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  /// [{ kind: DEPOSIT|BALANCE, basis: PERCENT|FIXED, value: Int (bps or minor units), anchor, offsetDays (may be negative) }]
  /// zod in jsonFieldSchemas: 1–2 entries, kinds distinct, BALANCE present, PERCENT sum 10000 when no FIXED.
  milestones    Json     @default("[]")
  currency      String?  @db.Char(3)
  nonRefundable Boolean  @default(false) @map("non_refundable")
  cutoffTime    String?  @map("cutoff_time")
  notes         String?
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  @@map("supplier_payment_terms")
}

/// Added to model Partner
///   paymentDueDays   Int                 @default(14) @map("payment_due_days")
///   paymentDueAnchor ReceivableDueAnchor @default(CONFIRMATION) @map("payment_due_anchor")
///   paymentTermsNote String?             @map("payment_terms_note")
///   receivables Receivable[] @relation("PartnerReceivables"); supplierPayables SupplierPayable[] @relation("PartnerSupplierPayables"); paymentRecords PaymentRecord[] @relation("PartnerPaymentRecords")

model SupplierPayable {
  id                  String           @id @default(cuid())
  product             FinanceProduct
  hotelBookingId      String?          @unique @map("hotel_booking_id")
  hotelBooking        HotelBooking?    @relation(fields: [hotelBookingId], references: [id], onDelete: Restrict)
  transferBookingId   String?          @unique @map("transfer_booking_id")
  transferBooking     TransferBooking? @relation(fields: [transferBookingId], references: [id], onDelete: Restrict)
  tourBookingId       String?          @unique @map("tour_booking_id")
  tourBooking         TourBooking?     @relation(fields: [tourBookingId], references: [id], onDelete: Restrict)
  serviceBookingId    String?          @unique @map("service_booking_id")
  serviceBooking      ServiceBooking?  @relation(fields: [serviceBookingId], references: [id], onDelete: Restrict)
  supplierPartnerId   String?          @map("supplier_partner_id")
  supplierPartner     Partner?         @relation("PartnerSupplierPayables", fields: [supplierPartnerId], references: [id], onDelete: Restrict)
  bookingReference    String           @map("booking_reference")
  timezone            String
  currency            String           @db.Char(3)
  originalAmountCents Int              @map("original_amount_cents")
  amountCents         Int              @map("amount_cents")
  paidCents           Int              @default(0) @map("paid_cents")
  status              SettlementStatus @default(OPEN)
  nextDueAt           DateTime?        @map("next_due_at")
  voidedAt            DateTime?        @map("voided_at")
  waivedAt            DateTime?        @map("waived_at")
  source              String           @default("CONFIRM")
  notes               String?
  instalments         PayableInstalment[]
  createdAt           DateTime         @default(now()) @map("created_at")
  updatedAt           DateTime         @updatedAt @map("updated_at")
  @@index([status, nextDueAt])
  @@index([supplierPartnerId, status, createdAt])
  @@index([product, createdAt])
  @@index([currency, status])
  @@map("supplier_payables")
}

model PayableInstalment {
  id             String           @id @default(cuid())
  payableId      String           @map("payable_id")
  payable        SupplierPayable  @relation(fields: [payableId], references: [id], onDelete: Cascade)
  sequence       Int
  kind           InstalmentKind
  amountCents    Int              @map("amount_cents")
  paidCents      Int              @default(0) @map("paid_cents")
  dueAt          DateTime?        @map("due_at")
  status         SettlementStatus @default(OPEN)
  overdueAlertAt DateTime?        @map("overdue_alert_at")
  voidedAt       DateTime?        @map("voided_at")
  reminders      PayableReminder[]
  allocations    PaymentAllocation[]
  createdAt      DateTime         @default(now()) @map("created_at")
  updatedAt      DateTime         @updatedAt @map("updated_at")
  @@unique([payableId, sequence])
  @@index([status, dueAt])
  @@map("payable_instalments")
}

/// One row per (instalment, offset) sent; the unique pair is the idempotency for Phase 3.
model PayableReminder {
  id           String            @id @default(cuid())
  instalmentId String            @map("instalment_id")
  instalment   PayableInstalment @relation(fields: [instalmentId], references: [id], onDelete: Cascade)
  offsetDays   Int               @map("offset_days")
  sentAt       DateTime          @default(now()) @map("sent_at")
  @@unique([instalmentId, offsetDays])
  @@index([sentAt])
  @@map("payable_reminders")
}

model Receivable {
  id                  String           @id @default(cuid())
  hotelBookingId      String?          @unique @map("hotel_booking_id")
  hotelBooking        HotelBooking?    @relation(fields: [hotelBookingId], references: [id], onDelete: Restrict)
  transferBookingId   String?          @unique @map("transfer_booking_id")
  transferBooking     TransferBooking? @relation(fields: [transferBookingId], references: [id], onDelete: Restrict)
  tourBookingId       String?          @unique @map("tour_booking_id")
  tourBooking         TourBooking?     @relation(fields: [tourBookingId], references: [id], onDelete: Restrict)
  serviceBookingId    String?          @unique @map("service_booking_id")
  serviceBooking      ServiceBooking?  @relation(fields: [serviceBookingId], references: [id], onDelete: Restrict)
  orderId             String?          @unique @map("order_id")
  order               Order?           @relation(fields: [orderId], references: [id], onDelete: Restrict)
  reference           String
  debtorPartnerId     String?          @map("debtor_partner_id")
  debtorPartner       Partner?         @relation("PartnerReceivables", fields: [debtorPartnerId], references: [id], onDelete: Restrict)
  debtorEmail         String           @map("debtor_email")
  debtorName          String           @map("debtor_name")
  currency            String           @db.Char(3)
  originalAmountCents Int              @map("original_amount_cents")
  amountCents         Int              @map("amount_cents")
  paidCents           Int              @default(0) @map("paid_cents")
  status              SettlementStatus @default(OPEN)
  dueAt               DateTime?        @map("due_at")
  overdueAlertAt      DateTime?        @map("overdue_alert_at")
  voidedAt            DateTime?        @map("voided_at")
  waivedAt            DateTime?        @map("waived_at")
  source              String           @default("CONFIRM")
  notes               String?
  allocations         PaymentAllocation[]
  invoices            Invoice[]
  createdAt           DateTime         @default(now()) @map("created_at")
  updatedAt           DateTime         @updatedAt @map("updated_at")
  @@index([status, dueAt])
  @@index([debtorPartnerId, status, createdAt])
  @@index([debtorEmail])
  @@index([currency, status])
  @@map("receivables")
}

/// Refunds are PaymentRecords with kind REFUND and negative allocations (one table, one idempotency path).
model PaymentRecord {
  id                    String           @id @default(cuid())
  direction             PaymentDirection
  kind                  PaymentKind      @default(PAYMENT)
  method                PaymentMethod
  counterpartyPartnerId String?          @map("counterparty_partner_id")
  counterpartyPartner   Partner?         @relation("PartnerPaymentRecords", fields: [counterpartyPartnerId], references: [id], onDelete: Restrict)
  counterpartyName      String?          @map("counterparty_name")
  counterpartyEmail     String?          @map("counterparty_email")
  currency              String           @db.Char(3)
  amountCents           Int              @map("amount_cents")
  reference             String?
  paidAt                DateTime         @map("paid_at")
  note                  String?
  reason                String?
  recordedByUserId      String?          @map("recorded_by_user_id")
  recordedByUser        User?            @relation("PaymentRecordedBy", fields: [recordedByUserId], references: [id], onDelete: SetNull)
  attachmentAssetId     String?          @map("attachment_asset_id")
  attachmentAsset       FileAsset?       @relation("PaymentAttachments", fields: [attachmentAssetId], references: [id], onDelete: SetNull)
  idempotencyKey        String?          @unique @map("idempotency_key")
  externalPaymentId     String?          @map("external_payment_id")
  allocations           PaymentAllocation[]
  createdAt             DateTime         @default(now()) @map("created_at")
  updatedAt             DateTime         @updatedAt @map("updated_at")
  @@index([paidAt])
  @@index([counterpartyPartnerId, paidAt])
  @@index([direction, kind, paidAt])
  @@map("payment_records")
}

model PaymentAllocation {
  id                  String             @id @default(cuid())
  paymentRecordId     String             @map("payment_record_id")
  paymentRecord       PaymentRecord      @relation(fields: [paymentRecordId], references: [id], onDelete: Cascade)
  receivableId        String?            @map("receivable_id")
  receivable          Receivable?        @relation(fields: [receivableId], references: [id], onDelete: Restrict)
  payableInstalmentId String?            @map("payable_instalment_id")
  payableInstalment   PayableInstalment? @relation(fields: [payableInstalmentId], references: [id], onDelete: Restrict)
  amountCents         Int                @map("amount_cents")
  createdAt           DateTime           @default(now()) @map("created_at")
  @@index([receivableId])
  @@index([payableInstalmentId])
  @@map("payment_allocations")
}
```
Back-relations only (no columns) on `HotelBooking`, `TransferBooking`, `TourBooking`, `ServiceBooking` (`payable SupplierPayable?`, `receivable Receivable?`), `Order.receivable`, `Hotel/TransferProvider/Tour/Service.paymentTerms`, `User.paymentsRecorded`, `FileAsset.paymentAttachments`. New `FileCategory` value `PAYMENT_ATTACHMENT` (private, `services/media/upload.service.js:50` map). `jsonFieldSchemas` + `SupplierPaymentTerms.milestones`.

Enum values (enum-values migration): `AuditAction` + `SUPPLIER_TERMS_UPDATED, PARTNER_TERMS_UPDATED, PAYABLE_CREATED, PAYABLE_AMOUNT_CHANGED, PAYABLE_VOIDED, PAYABLE_WAIVED, RECEIVABLE_CREATED, RECEIVABLE_AMOUNT_CHANGED, RECEIVABLE_VOIDED, RECEIVABLE_WAIVED, PAYMENT_RECORDED, REFUND_RECORDED, FINANCE_REPORT_EXPORTED`; `FileCategory` + `PAYMENT_ATTACHMENT`. `AUDIT_ENTITY` + `supplierPaymentTerms, supplierPayable, payableInstalment, receivable, paymentRecord`.

Migrations: `20261101100000_finance_enum_values` (ADD VALUE only), `20261101100100_finance_module` (CREATE TYPE for new enums, Partner columns, six tables, FKs, indexes, CHECKs). Strip any `DROP INDEX "*_geo_idx"`.

CHECK constraints (SQL in the module migration): `supplier_payment_terms_exactly_one_subject` (CASE-sum = 1 over the four FKs); `supplier_payables_exactly_one_child`; `supplier_payables_child_matches_product` (product ⇔ FK); `supplier_payables_amounts_sane` (`original_amount_cents >= 0 AND amount_cents BETWEEN 0 AND original_amount_cents`); `supplier_payables_status_coherent` (VOID ⇔ `voided_at` set and `paid_cents = 0`); `payable_instalments_amounts_sane` (`amount_cents >= 0 AND sequence >= 1`); `payable_reminders_offset_sane` (`offset_days >= 0`); `receivables_exactly_one_subject` (five FKs); `receivables_amounts_sane`; `payment_records_amount_positive`; `payment_records_counterparty_present`; `payment_allocations_exactly_one_target`; `payment_allocations_non_zero`.

Backfill: `scripts/backfill-finance.js [--dry-run] [--include-completed] [--since YYYY-MM-DD]` (argv style of `scripts/create-admin.js`): pages CONFIRMED (and COMPLETED with flag) bookings lacking `payable`/`receivable`, calls the same `createPayableInTx`/`createReceivableInTx` with `source: 'BACKFILL'`, `dueAt` null when no terms, actor null (`actorEmail 'system'`), never enqueues invoices or payments; idempotent via the unique FKs (P2002 counted as "already present"). Backward compatible: booking tables unchanged; `bookingInclude` objects unchanged.

## 2.D Backend implementation

New files under `services/finance/`:
- `ledger.service.js` — `resolveSupplier(product, booking)` (hotel → `hotel.supplierId`; tour → `tour.supplierId`; service → `service.supplierId`; transfer → `vehicle.provider.partnerId`), `resolveTerms(product, booking)`, `buildInstalments(terms, amountCents, anchors, timezone)` (PERCENT → `Math.round(amount × value / 10000)`, FIXED → min(value, amount), BALANCE = remainder so rounding never leaks; `dueAt = zonedTimeToInstant(addDays(anchorDate, offsetDays), terms.cutoffTime ?? config.finance.cutoffTime, tz)` with `lib/time.js`; anchor CONFIRMATION = `todayInTimezone(tz)`, ARRIVAL = checkIn/date/pickup local date, DEPARTURE = checkOut/endDate/return-leg date), `createPayableInTx(tx, { product, booking }, actor, req)` (amount = `netTotalCents`; audit `PAYABLE_CREATED`), `createReceivableInTx(tx, { booking | order }, actor, req)` (amount: hotel `sellTotalCents + taxTotalCents`; transfer/tour/service `sellTotalCents`; order `Order.sellTotalCents`; debtor = `partnerId` or lead email/name; `dueAt` from `Partner.paymentDueDays/Anchor` or `config.finance.guestDueDays`; audit `RECEIVABLE_CREATED`; enqueue `INVOICE_ISSUE_REQUESTED { receivableId, kind: 'PROFORMA' }` when `config.finance.invoiceocean.enabled`), `applyCancellationInTx(tx, { booking | order | orderItem, charge })` (receivable `amountCents := cancellationChargeCents` (order item: `amountCents −= quote.refundCents`); payable: VOID instalments with `paidCents = 0`, PARTIAL ones `amountCents := paidCents`, payable `amountCents := terms.nonRefundable ? original : paidCents` — **client decision D6**; audit `*_AMOUNT_CHANGED`; invoice follow-ups per Phase 4), `deriveStatus({ amountCents, paidCents, status })` (sticky VOID/WAIVED; 0 → OPEN; partial; paid ≥ amount → PAID; amount 0 & paid 0 → VOID), `recomputePayable(tx, payableId)` (paid = Σ instalments, `nextDueAt` = min open `dueAt`).
- `payment.service.js` — `recordPayment(input, actor, req)`: replay via `idempotencyKeyFrom` (`lib/idempotency.js:29`) + `findUnique({ idempotencyKey })` + `assertReplayOwner`; `$transaction`: validate (amount > 0; `kind REFUND` requires `reason`; target status OPEN|PARTIAL for PAYMENT, PARTIAL|PAID for REFUND; currency equality else `UnprocessableEntityError({ reason: 'CURRENCY_MISMATCH' })`; direction/kind ↔ target type: IN+PAYMENT → receivables, OUT+PAYMENT → instalments, OUT+REFUND → receivables (negative), IN+REFUND → instalments (negative)); lock targets `SELECT id FROM receivables WHERE id IN (…) ORDER BY id FOR UPDATE` (and instalments) via `tx.$queryRaw` with sorted ids; explicit allocations (each ≤ outstanding else 422 `ALLOCATION_EXCEEDS_OUTSTANDING`; Σ ≤ amount else 422 `ALLOCATIONS_EXCEED_PAYMENT`; remainder reported as `unallocatedCents`) or auto `allocate: { mode: 'OLDEST_DUE', debtorPartnerId | supplierPartnerId }` (candidates OPEN|PARTIAL ordered `dueAt ASC NULLS LAST, createdAt ASC`); write record + allocations; update targets and parents; audit `PAYMENT_RECORDED`/`REFUND_RECORDED`; enqueue `PAYMENT_RECORDED`; if a receivable becomes PAID and invoicing is enabled → enqueue `INVOICE_ISSUE_REQUESTED { kind: 'VAT' }`. `allocateRemainder(paymentId, allocations)`. `payInstalment(payableId, sequence, input)` convenience (OUT PAYMENT, counterparty = supplier, one allocation).
- `terms.service.js` — `getSupplierTerms(subject)`, `upsertSupplierTerms(subject, input, actor, req)` (audit `SUPPLIER_TERMS_UPDATED`; never reschedules existing instalments), `updatePartnerTerms` (extends `adminUpdatePartnerSchema`, `validation/partner.js:139-156`; audit `PARTNER_TERMS_UPDATED`).
- `report.service.js` — `summary({ from, to, currency })` → `{ receivables: { openCents, overdueCents, paidCents, count }, payables: {…}, cash: { inCents, outCents, refundsInCents, refundsOutCents } }`; `margin({ from, to, currency, groupBy: product | supplier | partner })` from receivable/payable originals of bookings confirmed in the window (`sellCents, netCents, marginCents, marginBps`); `ageing({ asOf, currency })` buckets `current, 1-30, 31-60, 61-90, 90+, undated` by debtor and supplier; `toCsv(rows)` streaming with `Content-Disposition: attachment`; audit `FINANCE_REPORT_EXPORTED`. Never sums across currencies (precedent `transfer/booking.service.js:738-763`).
- `serializers/finance.js` — `toPayable(p, viewer)`, `toInstalment`, `toReceivable(r, viewer)` (adds `refundDueCents = max(0, paid − amount)`), `toPaymentRecord`, `toAllocation`, `toSupplierTerms`, `toStatementRow`.
- `validation/finance.js` — `supplierMilestoneSchema`, `supplierTermsSchema`, `payableQuerySchema`, `receivableQuerySchema`, `paymentQuerySchema`, `recordPaymentSchema` (`.strict()`, `allocations` xor `allocate` xor `unallocated: true`), `allocateSchema`, `patchSettlementSchema` (`reason` required), `reportQuerySchema` (`currency` required, `format ∈ json|csv`), `payInstalmentSchema`.
- Routes: `routes/admin.finance.routes.js` mounted at `/admin/finance` (`authenticate` + capabilities from Phase 1): `GET /payables`, `POST /payables` (manual off-platform cost), `GET /payables/:id`, `PATCH /payables/:id`, `POST /payables/:id/instalments/:sequence/pay`; `GET /receivables`, `GET /receivables/:id`, `PATCH /receivables/:id`; `GET /payments`, `POST /payments` (Idempotency-Key), `POST /payments/:id/allocations`; `GET /reports/summary|margin|ageing`. Supplier terms: `GET|PUT /admin/hotels/:hotelId/supplier-terms` (sub-router in `admin.hotels.routes.js:61-71`), `GET|PUT /admin/tours/:id/supplier-terms`, `/admin/services/:id/supplier-terms`, `/admin/transfers/providers/:id/supplier-terms` (`finance.terms.write`). Partner: `routes/partner.finance.routes.js` at `/partner/finance` (`authenticate, requirePartner, requireApprovedPartner, requireCapability('partner.statement.read')`): `GET /statement` (own receivables with status, due, outstanding, invoices, payments; `balances[]` per currency), `GET /payables` (supplier partners: own payables, net only).
- Hooks: `createPayableInTx` called in `confirmHotelBookingInTx` (after the booking row, beside `SUPPLIER_BOOKING_RECEIVED` at :442), `confirmTransferBookingInTx` (after :288), `confirmTourBookingInTx` when not on-request else `confirmPendingTourBookingInTx` (607), same for services (172/464). `createReceivableInTx` called by the facades (hotel `confirmBooking` after :488 inside the tx, transfer 404, tour 351 / `confirmPendingTourBooking`, service 274 / pending) and by `confirmOrder` when the rolled-up status is CONFIRMED (after the item loop, before `enqueueEvent` at :550) or on the roll-up transition to CONFIRMED. `applyCancellationInTx` in the six cancel InTx functions after the charge is computed. Hotel `confirmBooking`'s `$transaction` (482) gains `{ timeout: config.order.txTimeoutMs }` since it now writes more rows.
- `config.js` new section `finance: { cutoffTime: FINANCE_REMINDER_CUTOFF_TIME '10:00', guestDueDays: FINANCE_GUEST_DUE_DAYS 0, invoiceocean: {…Phase 4} }`; `.env.example` section `# --- Finance module ---`.
- `lib/outbox.js` TOPICS + `PAYMENT_RECORDED: 'finance.payment.recorded'` (handler in Phase 3/4 is a no-op until then; unknown topics are marked processed with a warn, so register the handler in the same PR).
- Docs: `API.md` "Finance" section; `docs/API_TESTING_GUIDE.md` Part 8b; Postman folder `06n · Finance`.

API contract examples (abridged; full list above):
```json
POST /api/admin/finance/payments   Idempotency-Key: 8–200 chars
{ "direction": "IN", "kind": "PAYMENT", "method": "BANK_TRANSFER", "currency": "GEL", "amountCents": 120000,
  "paidAt": "2026-10-07T09:30:00Z", "reference": "TBC-88213", "counterpartyPartnerId": "ckp…",
  "allocations": [{ "receivableId": "ckr1", "amountCents": 80000 }, { "receivableId": "ckr2", "amountCents": 40000 }] }
→ 201 { "payment": { "id", "amountCents": 120000, "allocatedCents": 120000, "unallocatedCents": 0,
         "allocations": [{ "receivableId": "ckr1", "amountCents": 80000, "status": "PAID" }, …] }, "replayed": false }
→ 422 { "error": { "message": "…", "details": { "reason": "CURRENCY_MISMATCH" | "ALLOCATION_EXCEEDS_OUTSTANDING" | "ALLOCATIONS_EXCEED_PAYMENT" } } }
→ 409 { "error": { "details": { "reason": "IDEMPOTENCY_KEY_REUSED" } } }

PUT /api/admin/hotels/:hotelId/supplier-terms
{ "currency": "GEL", "nonRefundable": false, "cutoffTime": "10:00",
  "milestones": [{ "kind": "DEPOSIT", "basis": "PERCENT", "value": 3000, "anchor": "CONFIRMATION", "offsetDays": 3 },
                 { "kind": "BALANCE", "basis": "PERCENT", "value": 7000, "anchor": "ARRIVAL", "offsetDays": -7 }] }

GET /api/admin/finance/payables?status=OPEN&status=PARTIAL&supplierPartnerId&product&dueBefore&page&pageSize
→ { "data": [{ "id", "product": "HOTEL", "bookingReference": "BKG-000123", "supplier": { "id", "name" }, "currency": "GEL",
      "amountCents": 48000, "paidCents": 24000, "outstandingCents": 24000, "status": "PARTIAL", "nextDueAt": "…",
      "instalments": [{ "sequence": 1, "kind": "DEPOSIT", "amountCents": 24000, "paidCents": 24000, "status": "PAID", "dueAt": "…" },
                      { "sequence": 2, "kind": "BALANCE", "amountCents": 24000, "paidCents": 0, "status": "OPEN", "dueAt": "…", "remindersSent": [7] }] }],
    "total": 1, "page": 1, "pageSize": 25, "totalPages": 1 }
```

## 2.E Frontend implementation

- Navigation group **Finance** (`navigation.ts`): Overview (`/admin/finance`), Payables, Receivables, Payments, Reports; visible with `finance.payables.read`; badge `paymentsDue` arrives in Phase 3. FINANCE role lands on `/admin/finance` from the overview redirect.
- Pages (`(panel)/finance/…`, each with a help article `fn-*`): `page.tsx` (StatCards per currency: open receivables, overdue, open payables, due in 7 days; recent payments table), `payables/page.tsx` + `[id]/page.tsx` (PayablesBrowser with status/supplier/product/due filters; detail with instalment table, "Record payment" modal pre-filled with outstanding, allocations list, booking link, audit tail), `receivables/page.tsx` + `[id]` (same shape; invoices panel in Phase 4; "Record payment" and "Refund" modals), `payments/page.tsx` (PaymentsBrowser with direction/kind/method/date filters; "Record payment" modal with allocation rows or "allocate oldest due"; attachment upload via existing media upload with category `PAYMENT_ATTACHMENT`), `reports/page.tsx` (summary/margin/ageing tabs; currency selector; "Download CSV" link to the API with `format=csv`).
- Booking detail pages (`bookings/[id]`, `transfers/bookings/[reference]`, `tours/bookings/[reference]`, `orders/[reference]`, services): add a `FinancePanel` showing the receivable and payable status with links; visible only with `finance.receivables.read`.
- Hotel admin: new tile "Supplier terms" in `hotels/[slug]/page.tsx:84-131` → `hotels/[slug]/supplier-terms/page.tsx` with `SupplierTermsForm` (milestone rows: kind, basis, value, anchor, offset; validation mirrors zod; currency; non-refundable toggle; cutoff time). Same form on tour, service and transfer provider admin pages (provider admin page may not exist: add `transfers/providers/[id]/page.tsx` or place the form on the vehicle's provider section; verify during implementation).
- Partners: `partners/[id]` gains a "Payment terms" panel (`paymentDueDays`, anchor, note) editable with `pricing.write`.
- Portal: `portal/finance/page.tsx` (statement: balances per currency, receivable rows, payments, invoice links from Phase 4), nav entry "Finance" for `partner.statement.read`; supplier partners also see "Payables".
- API: `client/lib/api/finance.ts` (`listPayables`, `getPayable`, `patchPayable`, `payInstalment`, `listReceivables`, `getReceivable`, `patchReceivable`, `listPayments`, `recordPayment`, `allocatePayment`, `getFinanceReport`, `getSupplierTerms`, `putSupplierTerms`, `getPartnerStatement`); types `client/types/finance.ts`; labels in `client/lib/admin/finance.ts` (status pills: OPEN neutral, PARTIAL attention, PAID positive, VOID/WAIVED neutral, overdue critical).
- States: `EmptyState` for empty lists ("No payables yet. They appear when a booking confirms."); inline `describeError`; `(panel)/loading.tsx` covers lists.

## 2.F Business logic (workflows)

1. **Confirm** → payable (net) with instalments from supplier terms, receivable (sell + included tax) with partner due date; both in the booking transaction, so a failure rolls the booking back.
2. **On-request** products: records created when the status becomes CONFIRMED (pending confirm paths), not at request time.
3. **Cancel** → receivable reduced to the cancellation charge; payable instalments voided or capped at paid; over-payment surfaces as `refundDueCents` until a REFUND record is allocated.
4. **Record payment** → allocations under row locks; statuses derived; parent payable recomputed; events enqueued.
5. **Refund** → REFUND record with negative allocations; receivable `paidCents` drops; invoice follow-up in Phase 4.
6. **Waive/void** → finance-only, reason required, audited; VOID refused when `paidCents > 0`.
7. **Reports** → per currency only; CSV export audited.
Edge cases: currency mismatch (422); instalment amounts rounding (balance absorbs); terms missing (single undated instalment, "needs terms" filter); supplier null (platform inventory: payable still created with `supplierPartnerId null`, listed under "Platform"); two concurrent payments on one receivable (locks serialize; second sees updated outstanding); replayed request (same key → 200 original); payment in a currency the debtor has no open items for (422).

## 2.G Security

All routes behind Phase 1 capabilities; partner statement scoped by `partnerId`; supplier payables show net only (their own rate); amounts validated as positive integers; attachments private category; every mutation audited with actor and reason; no amounts accepted from clients for payables/receivables except manual off-platform entries (flagged `source: 'MANUAL'`, `finance.payables.write`).

## 2.H Testing

- Unit: `test/finance.ledger.unit.test.js` (instalment building: percent rounding, fixed caps, negative offsets, timezone/DST boundaries via `zonedTimeToInstant`; `deriveStatus` matrix; allocation algorithm oldest-due).
- Integration (`node:test` + supertest, factories `makePartner`, `makeHotel`, `makeSellableHotel`, `makeTransferBooking`, `makeTour*`, `makeService`): `test/finance.records.test.js` (payable + receivable created on each confirm path incl. order and pending paths; amounts match frozen fields; cancellation adjustments per product; order item cancel), `test/finance.payments.test.js` (record, allocate, replay, over-allocation 422, currency 422, refund, waive/void rules, two concurrent payments via `Promise.all` end with consistent `paidCents`), `test/finance.reports.test.js` (per-currency sums, CSV header/escaping), `test/finance.terms.test.js` (CRUD, validation, no reschedule), `test/finance.access.test.js` (MANAGEMENT read-only, RESERVATIONS 403, partner statement isolation, supplier sees net only), `test/finance.backfill.test.js` (script twice → second run creates nothing).
- Regression: `booking`, `cancellation`, `orders.*`, `transfers.booking`, `tours.booking`, `services` suites stay green (confirm paths now write more rows).
- Acceptance: confirm a hotel booking for a partner → receivable due in 14 days and a two-instalment payable per the hotel's terms; record a bank transfer → receivable PAID; cancel inside the free window → receivable 0/VOID, payable VOID; reports show the margin.

## 2.I Deployment

- Env: `FINANCE_REMINDER_CUTOFF_TIME`, `FINANCE_GUEST_DUE_DAYS` (Phase 2); none required in production.
- Migrations additive; run `scripts/backfill-finance.js --dry-run` then live after deploy (documented in `docs/DEPLOYMENT.md` §3.4 first-run tasks).
- Rollout: server first; the client's new Finance group appears only for roles with the capability.
- Monitoring: log `finance.payment.recorded` with amounts; alert on `P2002` bursts from `payment_records.idempotency_key`.
- Rollback: forward-only; tables can stay unused.

## 2.J Effort and risks

| Item | Days |
|---|---|
| Schema, migrations, jsonFieldSchemas, factories | 2 |
| ledger.service + hooks in 6 confirm/6 cancel paths + tests | 4 |
| payment.service + routes + tests (locks, idempotency, concurrency) | 3 |
| terms (supplier + partner) + routes + tests | 1.5 |
| reports + CSV + tests | 2 |
| Backfill script + test | 1 |
| Client: finance section (5 pages), modals, booking panels, hotel terms tile, portal statement, help | 6–8 |
| Docs/Postman | 1 |
| **Total** | **20–23** |

Risks: D6 (supplier share on cancellation) unresolved → default documented; transaction size growth in `confirmOrder` (timeout already 15 s); report performance on large tables (indexes on status+dueAt; aggregate in SQL with `$queryRaw`, not in JS).

---

# Phase 3 — Supplier payment reminders

## 3.A Current architecture (verified)

- Outbox: `enqueueEvent(client, { topic, payload, entityType, entityId })`; `handlers` map in `services/notifications/outbox.service.js:224-695`; `notify(recipients, { kind, title, body, payload, entityType, entityId })` (:106) dedupes in-app notices on retry by `payload.outboxEventId`; drain every 5 s with xact lock + 5-min lease; 8 attempts, backoff to 60 min; exhausted events marked processed silently.
- Sweeper template: `services/transfer/reminder.service.js` (xact lock `hashtext('transfer_reminders')`, `UPDATE … WHERE stamp IS NULL … RETURNING`, `enqueueAll` via `createMany`); intervals in `server.js` with `.unref()` and cleared on shutdown (166–176).
- In-app `Notification` model (4774–4795), `notification.service.js` (`listNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `toNotification`), endpoints only for drivers (`routes/driver.routes.js:115-131`, schemas `validation/dispatch.js:148,159`). Admin badges `routes/admin.badges.routes.js` + `navigation.ts:45-52` + `lib/api/admin.ts:14-60`.
- Recipients: `opsUserIds()` (:78, TRANSFER_OPS_ROLES) and a single `TRANSFER_OPS_EMAIL`; templates in `lib/mailer/templates.js` with `layout()`; coverage test `test/mailer.test.js:38-59` uses a hard-coded list + `sampleData`.
- Timezone: `lib/time.js zonedTimeToInstant`; per-entity `timezone`.

## 3.B Proposed architecture

`services/finance/reminder.service.js` sweeps `payable_instalments` (from Phase 2) every 10 minutes: claims one `PayableReminder` row per (instalment, offset) with `INSERT … ON CONFLICT DO NOTHING RETURNING` (race-free across instances even without the lock), stamps `overdue_alert_at` for overdue instalments and receivables, and enqueues outbox events in the same transaction. Handlers notify finance users in-app and by email through a new recipient resolver `financeUserIds()` (capability-based) and `config.finance.opsEmail`. An admin notifications API and bell (missing today) make the in-app rows readable; a `paymentsDue` badge and an overview widget surface the queue.

## 3.C Database changes

Already created in Phase 2: `PayableReminder`, `PayableInstalment.overdueAlertAt`, `Receivable.overdueAlertAt`. Phase 3 adds (enum-values migration `20261110100000_finance_notifications_enum_values`): `NotificationKind` + `FINANCE_PAYABLE_DUE, FINANCE_PAYABLE_OVERDUE, FINANCE_RECEIVABLE_OVERDUE, FINANCE_INVOICE_ISSUED, FINANCE_INVOICE_SYNC_FAILED`; `AuditAction` + `FINANCE_REMINDER_SETTINGS_UPDATED`. Optional `FinanceSettings` single-row table (`reminder_offset_days int[]`, `ops_email`, `digest_hour`) if runtime-editable settings are wanted (SUPER_ADMIN `settings.write`); default is env-only.

## 3.D Backend implementation

- `services/finance/reminder.service.js`:
```js
export const sweepFinanceReminders = ({ now = new Date() } = {}) => prisma.$transaction(async (tx) => {
  const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('finance_reminders')) AS locked`;
  if (!locked) return { skipped: true };
  const claimed = [];
  for (const offsetDays of config.finance.reminderOffsetDays /* sorted desc, e.g. 7,3,1,0 */) {
    const horizon = new Date(now.getTime() + offsetDays * 86_400_000);
    const rows = await tx.$queryRaw`
      INSERT INTO payable_reminders (id, instalment_id, offset_days, sent_at)
      SELECT gen_random_uuid()::text, i.id, ${offsetDays}, ${now}
        FROM payable_instalments i JOIN supplier_payables p ON p.id = i.payable_id
       WHERE i.status IN ('OPEN','PARTIAL') AND p.status IN ('OPEN','PARTIAL')
         AND i.due_at IS NOT NULL AND i.due_at > ${now} AND i.due_at <= ${horizon}
      ON CONFLICT (instalment_id, offset_days) DO NOTHING
      RETURNING instalment_id, offset_days`;
    claimed.push(...rows);
  }
  // one event per instalment per sweep: keep the smallest offset claimed for the same instalment
  await enqueueAll(tx, TOPICS.PAYABLE_INSTALMENT_DUE, collapseByInstalment(claimed));
  const overdue = await tx.$queryRaw`UPDATE payable_instalments i SET overdue_alert_at = ${now} FROM supplier_payables p
     WHERE p.id = i.payable_id AND i.status IN ('OPEN','PARTIAL') AND p.status IN ('OPEN','PARTIAL')
       AND i.overdue_alert_at IS NULL AND i.due_at IS NOT NULL AND i.due_at < ${now} RETURNING i.id, i.payable_id`;
  await enqueueAll(tx, TOPICS.PAYABLE_INSTALMENT_OVERDUE, overdue);
  const receivables = await tx.$queryRaw`UPDATE receivables r SET overdue_alert_at = ${now}
     WHERE r.status IN ('OPEN','PARTIAL') AND r.overdue_alert_at IS NULL AND r.due_at IS NOT NULL AND r.due_at < ${now} RETURNING r.id`;
  await enqueueAll(tx, TOPICS.RECEIVABLE_OVERDUE, receivables);
  return { reminders: claimed.length, overdue: overdue.length, receivablesOverdue: receivables.length };
});
```
  (`gen_random_uuid()` is built into Postgres 13+; ids are TEXT so a uuid is acceptable; alternative: select candidates then `createMany({ skipDuplicates: true })`.) Repeated overdue nudges: a daily `FINANCE_OVERDUE_REPEAT_DAYS` option re-arms by clearing `overdue_alert_at` older than N days for still-open rows (optional).
- `lib/outbox.js` TOPICS: `PAYABLE_INSTALMENT_DUE 'finance.payable.instalment_due'`, `PAYABLE_INSTALMENT_OVERDUE`, `RECEIVABLE_OVERDUE`, `PAYMENT_RECORDED` (Phase 2).
- Handlers in `outbox.service.js`: each re-reads the instalment/receivable and returns silently when no longer OPEN|PARTIAL (pattern `TOUR_REQUEST_OVERDUE :396-397`), then `notify(await financeUserIds(), { kind, title: 'Hotel Vera: 70% balance (GEL 336.00) due in 3 days', body, payload: { payableId, instalmentId, offsetDays }, entityType: 'SupplierPayable', entityId })` and `sendMail({ to: config.finance.opsEmail, template: 'financePayableDue', data })` when the address is set; `RECEIVABLE_OVERDUE` also emails the debtor (`partnerRecipient` pattern :87-96, or guest) with `receivableOverdue`; `PAYMENT_RECORDED` notifies finance users (in-app only). `financeUserIds()` = active users whose role has `finance.payables.read` (via `lib/permissions.js`), excluding DISPATCHER by construction.
- Templates in `lib/mailer/templates.js`: `financePayableDue`, `financePayableOverdue`, `financeReceivableOverdue`, `receivableOverdue` (to debtor), `paymentReceipt` (optional, to debtor on IN payment). Add each to `sampleData` in `test/mailer.test.js:25-33`.
- Admin notifications API: `routes/admin.notifications.routes.js` at `/admin/notifications` (`authenticate, requireCapability('notifications.read')`): `GET /` (query `notificationQuerySchema`), `POST /read-all`, `POST /:id/read`, `GET /unread-count`; reuse `notification.service.js`. Partner equivalent `/partner/notifications` (same service, partner users already receive rows).
- Badges: `routes/admin.badges.routes.js` + `paymentsDue` (count of instalments OPEN|PARTIAL with `dueAt <= now + 7d` or overdue) and `unreadNotifications`; null for roles without `finance.payables.read`.
- Dashboard data: `GET /admin/finance/due?days=7` (instalments and receivables due or overdue, grouped) for the widget.
- `server.js`: register `financeReminderSweeper` (interval `config.finance.reminderSweepIntervalMs`, default 10 min) and clear it on shutdown; `config.finance` gains `reminderOffsetDays` (`FINANCE_REMINDER_OFFSET_DAYS` "7,3,1,0", validated non-negative integers at boot like `assertMailConfig`), `reminderSweepIntervalMs`, `opsEmail` (`FINANCE_OPS_EMAIL`), `overdueRepeatDays`.
- Dead-letter visibility: `GET /admin/outbox/failed` (`settings.write` or `audit.read`) listing events with `attempts >= 8` and `lastError`, plus `POST /admin/outbox/:id/retry` (reset `attempts`, `nextAttemptAt = now`) — small, and it closes the "silent loss" gap for every topic.

## 3.E Frontend implementation

- `AdminShell`: bell icon with unread count from `GET /admin/notifications/unread-count` (fetched in the `(panel)` layout alongside badges; refresh on `router.refresh()`), dropdown `NotificationList` reused from `components/driver/NotificationList.tsx` (generalise to a shared `components/notifications/NotificationList.tsx`), each row linking to `/admin/finance/payables/:id` or the receivable; `notifications/page.tsx` full list with mark-all-read.
- Finance overview widget `PaymentsDuePanel` (due in 7 days, overdue in red, "Mark paid" opening the payment modal from Phase 2); overview `(panel)/page.tsx` adds a "Payments due" StatCard for roles with the capability.
- Sidebar badge `paymentsDue` on Finance → Payables (`AdminBadgeKey`, `lib/api/admin.ts`, `NO_BADGES`).
- Reminder settings page `finance/settings/page.tsx` only if `FinanceSettings` is built (optional); otherwise document env settings in the help article `fn-reminders`.
- Portal: bell + `/portal/notifications` for partner users (receivable overdue, payment receipt).
- Hotel supplier-terms form (Phase 2) shows a preview "For a booking confirmed today arriving 20 Dec: deposit due 11 Oct 10:00, balance due 13 Dec 10:00 (Asia/Tbilisi)".

## 3.F Business logic

- Due dates are instants computed once at confirmation in the supplier's timezone at the cutoff hour; the sweeper compares instants only (no DST surprises later).
- Each offset fires once per instalment (unique row); a new offset added to config fires for existing instalments still inside the window; offsets already in the past are claimed in the same sweep and collapsed to one event.
- Payment or cancellation stops reminders: claim predicates exclude PAID/VOID/WAIVED; handlers re-read and skip; stamps are never deleted, so re-opening a row does not resend old offsets.
- Overdue: one alert when `dueAt` passes; optional daily repeat; receivable overdue also nudges the debtor.
- Multi-instance: xact advisory lock plus the unique-row claim (safe even without the lock); outbox drain already lease-based.
- Failure: handler throws → outbox retry; after 8 attempts the event appears in the failed list; finance sees a `FINANCE_*_SYNC_FAILED`-style notice only for invoice failures (Phase 4); for reminders the failed list is the safety net.

## 3.G Security

Notifications are per-recipient rows; the API returns only `recipientUserId = req.user.id`. Emails contain amounts and supplier names but no bank details. `FINANCE_OPS_EMAIL` is a shared mailbox the owner controls. Settings changes audited.

## 3.H Testing

- `test/finance.reminders.test.js`: instalment due in 3 days → reminders for 7 and 3 claimed once, one event; second sweep claims nothing; payment before due → no further events; overdue stamped once; receivable overdue once; two sweeps started concurrently (`Promise.all`) produce one set of rows; DST/timezone: a hotel in `Asia/Tbilisi` with cutoff 10:00 → `dueAt` equals 06:00 UTC.
- `test/notifications.admin.test.js`: list/mark-read scoped to the user; 403 for a role without the capability; unread count.
- `test/mailer.test.js`: new templates in `sampleData`.
- Outbox: handler skips a paid instalment; failed-list and retry endpoint.
- Acceptance: the client scenario (30% in 3 days, 70% seven days before arrival) produces two instalments; FINANCE users get in-app and email reminders at 7/3/1/0 days and an overdue alert; marking paid stops them; the bell and badge show the queue.

## 3.I Deployment

Env: `FINANCE_REMINDER_OFFSET_DAYS`, `FINANCE_REMINDER_SWEEP_INTERVAL_MS`, `FINANCE_OPS_EMAIL` (`render.yaml` `sync: false`, compose env, `.env.example`, DEPLOYMENT.md §3.2). Enum-values migration only. Sweeper starts on boot; first run claims every instalment inside the window for existing backfilled payables (expect a burst of notices once; run the backfill with `--since` to limit it, or set offsets after backfill).

## 3.J Effort and risks

| Item | Days |
|---|---|
| Sweeper + topics + handlers + templates + tests | 3 |
| Admin/partner notifications API + bell + list page | 2 |
| Badges, due endpoint, overview widget, portal bell | 1.5 |
| Failed-outbox list and retry | 1 |
| Docs, help, Postman | 0.5 |
| **Total** | **8–9** |

Risks: notification noise on first run (mitigated above); shared mailbox misconfiguration (boot check warns when unset in production); reliance on `gen_random_uuid()` (Postgres 17 has it).

---

# Phase 4 — InvoiceOcean API integration

## 4.A Current architecture (verified)

No invoice model, no provider abstraction, no outbound HTTP client, no PDF library (`server/package.json`); `INVOICE` only as a file category; `Partner.legalName`, `registrationNumber`, `email`, `legalAddress`, `city`, `country` exist (3434–3445); no VAT/tax-id field. Receivables (Phase 2) carry reference, debtor, currency, amount, paid. InvoiceOcean API verified from official docs (section C.3 of the audit): `api_token` param; `POST /invoices.json` with `kind` proforma|vat|correction, `from_invoice_id`, `oid`, `client_id`, positions; `GET /invoices.json?oid=`; `GET /invoices/ID.pdf`; `POST /invoices/ID/send_by_email.json`; `POST /invoices/ID/change_status.json?status=`; clients with `external_id` and `GET /clients.json?external_id=`; `POST /banking/payments.json` with `invoice_id`; webhooks `invoice:create|update` via `/webhooks.json` with a user-supplied secret echoed as `api_token`; 1,000 req/IP/min, 2 concurrent; `per_page` ≤ 100; no `updated_since` filter (sort `order=updated_at.desc` + period filters); languages exclude ka/he.

## 4.B Proposed architecture

Provider-agnostic `services/invoicing/` with `provider.js` (interface), `invoiceocean.adapter.js` (HTTP, mapping, limiter), `invoice.service.js` (orchestration), `sync.service.js` (webhook intake + polling). The booking transaction never calls the provider: it enqueues `INVOICE_ISSUE_REQUESTED`; the outbox handler creates the invoice and stores the external id, so provider outages retry with backoff. Webhook-first status sync with a 15-minute polling fallback keyed by a watermark. Duplicate prevention by (provider, externalId) unique, one-live-invoice-per-kind partial unique index, and an `oid` lookup before every create.

## 4.C Database changes (Prisma, for review)

Enums: `InvoicingProvider { INVOICEOCEAN }`, `InvoiceKind { PROFORMA VAT ADVANCE FINAL CORRECTION }`, `InvoiceStatus { DRAFT ISSUED SENT PAID PARTIAL CANCELLED ERROR }`, `InvoiceSyncSource { WEBHOOK POLL }`.

```prisma
model InvoicingCustomer {
  id               String            @id @default(cuid())
  provider         InvoicingProvider
  partnerId        String?           @map("partner_id")
  partner          Partner?          @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  guestEmail       String?           @map("guest_email")
  externalClientId String            @map("external_client_id")
  snapshot         Json              @default("{}")
  lastSyncedAt     DateTime?         @map("last_synced_at")
  createdAt        DateTime          @default(now()) @map("created_at")
  updatedAt        DateTime          @updatedAt @map("updated_at")
  @@unique([provider, partnerId])
  @@unique([provider, guestEmail])
  @@unique([provider, externalClientId])
  @@map("invoicing_customers")
}

model Invoice {
  id                String            @id @default(cuid())
  provider          InvoicingProvider @default(INVOICEOCEAN)
  receivableId      String            @map("receivable_id")
  receivable        Receivable        @relation(fields: [receivableId], references: [id], onDelete: Restrict)
  kind              InvoiceKind
  status            InvoiceStatus     @default(DRAFT)
  externalId        String?           @map("external_id")
  externalNumber    String?           @map("external_number")
  externalUpdatedAt DateTime?         @map("external_updated_at")
  fromInvoiceId     String?           @map("from_invoice_id")
  fromInvoice       Invoice?          @relation("InvoiceChain", fields: [fromInvoiceId], references: [id], onDelete: Restrict)
  derived           Invoice[]         @relation("InvoiceChain")
  currency          String            @db.Char(3)
  lang              String            @default("en")
  totalCents        Int               @map("total_cents")
  paidCents         Int               @default(0) @map("paid_cents")
  issueDate         DateTime          @map("issue_date") @db.Date
  sellDate          DateTime          @map("sell_date") @db.Date
  dueDate           DateTime?         @map("due_date") @db.Date
  buyerSnapshot     Json              @default("{}") @map("buyer_snapshot")
  publicToken       String?           @map("public_token")
  lastSyncedAt      DateTime?         @map("last_synced_at")
  syncError         String?           @map("sync_error")
  correctionReason  String?           @map("correction_reason")
  lines             InvoiceLine[]
  createdAt         DateTime          @default(now()) @map("created_at")
  updatedAt         DateTime          @updatedAt @map("updated_at")
  @@unique([provider, externalId])
  @@index([receivableId, kind])
  @@index([status, issueDate])
  @@map("invoices")
}

model InvoiceLine {
  id               String  @id @default(cuid())
  invoiceId        String  @map("invoice_id")
  invoice          Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  sortOrder        Int     @default(0) @map("sort_order")
  description      String
  quantity         Int     @default(1)
  taxRateBps       Int?    @map("tax_rate_bps")
  totalGrossCents  Int     @map("total_gross_cents")
  bookingReference String? @map("booking_reference")
  @@index([invoiceId, sortOrder])
  @@map("invoice_lines")
}

model InvoiceSyncEvent {
  id                String            @id @default(cuid())
  provider          InvoicingProvider
  source            InvoiceSyncSource
  externalId        String            @map("external_id")
  externalUpdatedAt DateTime          @map("external_updated_at")
  payload           Json
  processedAt       DateTime?         @map("processed_at")
  error             String?
  createdAt         DateTime          @default(now()) @map("created_at")
  @@unique([provider, externalId, externalUpdatedAt])
  @@index([processedAt, createdAt])
  @@map("invoice_sync_events")
}
```
Partner gains `taxId String? @map("tax_id")` and `invoiceLang String? @map("invoice_lang")`. Enum values (migration `20261115100000_invoicing_enum_values`): `AuditAction` + `INVOICE_ISSUED, INVOICE_SENT, INVOICE_CANCELLED, INVOICE_SYNCED, INVOICE_SYNC_FAILED, INVOICING_CUSTOMER_SYNCED`; `NotificationKind` values already added in Phase 3. Module migration `20261115100100_invoicing_module` with CHECKs: `invoicing_customers_exactly_one_subject`; partial unique `invoices_one_live_per_kind ON invoices(receivable_id, kind) WHERE status NOT IN ('CANCELLED','ERROR')`; `invoices_chain_coherent` (PROFORMA/ADVANCE have no `from_invoice_id`); `invoice_lines_quantity_positive`. `jsonFieldSchemas` + `InvoicingCustomer.snapshot`, `Invoice.buyerSnapshot`, `InvoiceSyncEvent.payload`. `AUDIT_ENTITY` + `invoice`, `invoicingCustomer`. Import of existing InvoiceOcean invoices: `scripts/import-invoiceocean.js --from YYYY-MM-DD` pages `GET /invoices.json?period=more&date_from&date_to&include_positions=true`, matches `oid` to receivable references, creates `Invoice` rows with `source` metadata, skips unknown `oid`s into a report; idempotent by `(provider, externalId)`.

## 4.D Backend implementation

- `services/invoicing/provider.js` — interface: `createInvoice(input)`, `getInvoice(externalId)`, `changeStatus(externalId, status)`, `getPdf(externalId)` (stream), `sendByEmail(externalId, to?)`, `findByOid(oid)`, `upsertClient(customer)`, `findClientByExternalId(externalId)`, `createPayment(input)`, `listInvoices({ dateFrom, dateTo, page })`.
- `services/invoicing/invoiceocean.adapter.js` — base `${config.finance.invoiceocean.domain}`; `api_token` in JSON body for POST/PUT and query for GET; global `fetch` with `AbortSignal.timeout(requestTimeoutMs)`; a 2-slot semaphore (documented concurrency limit) and a 1,000/min token bucket; retry once on 429/5xx with jitter; map 422 `{ code: 'error', message: {field: [...]} }` to `UnprocessableEntityError` with details; `BadGatewayError` for network/5xx. Bodies:
  - Proforma: `{ invoice: { kind: 'proforma', number: null, lang, currency, oid: receivable.reference, issue_date, sell_date, payment_to: dueDate, payment_type: 'transfer', department_id?, client_id, buyer_name, buyer_tax_no, buyer_email, buyer_street, buyer_city, buyer_country, positions: [{ name, quantity, tax: taxRateBps/100 | 'disabled', total_price_gross: (cents/100).toFixed(2) }] } }`.
  - VAT from proforma: `{ invoice: { kind: 'vat', from_invoice_id, issue_date, sell_date, paid: total, status: 'paid' } }`.
  - Correction: `{ invoice: { kind: 'correction', from_invoice_id, correction_reason, positions: [negative original line, positive cancellation-charge line] } }`.
  - Client: `GET /clients.json?external_id=` then `POST`/`PUT /clients.json` `{ client: { name, tax_no, email, street, city, country, external_id: partnerId | 'guest:'+email } }`.
  - Payment: `POST /banking/payments.json { banking_payment: { name: reference, price, invoice_id, paid: true, kind: 'api', currency, paid_date } }`.
  - Status: `POST /invoices/{id}/change_status.json?status=cancelled`.
- `services/invoicing/invoice.service.js` — `requestInvoice(receivableId, { kind, lang, dueDate, lines }, actor, req)` → creates `Invoice` DRAFT (partial unique → 409 `LIVE_INVOICE_EXISTS`) + enqueues; `issueInvoice(invoiceId)` (handler): ensure customer (`upsertClient` when snapshot differs), `findByOid(reference)` adopt-if-exists (same kind, not cancelled) else `createInvoice`; store `externalId`, `externalNumber`, `publicToken`, status ISSUED; audit `INVOICE_ISSUED`; notify finance `FINANCE_INVOICE_ISSUED`; on failure after retries → status ERROR, `syncError`, audit `INVOICE_SYNC_FAILED`, notify `FINANCE_INVOICE_SYNC_FAILED`. `sendInvoice(invoiceId, to)` → `sendByEmail`; `cancelProforma`; `recordProviderPayment(paymentRecord)` (from `PAYMENT_RECORDED` handler when a live VAT/PROFORMA exists; stores `externalPaymentId`); `issueVatOnPaid(receivableId)`; `issueCorrection(receivableId, delta, reason)`; `streamPdf(invoiceId)`.
- `services/invoicing/sync.service.js` — `ingestWebhook(body, secret)` (constant-time compare of the shared secret, length-checked; store `InvoiceSyncEvent(source WEBHOOK)` with `skipDuplicates`; 200 `{ received: true, duplicate? }`; processing in `applySyncEvents` via the outbox or a 1-minute sweeper), `pollInvoices()` every `pollIntervalMs` under `hashtext('invoiceocean_poll')` xact lock: watermark = max `Invoice.externalUpdatedAt` − 1 h; list by issue-date window from the oldest open invoice, keep rows with `updated_at ≥ watermark`, store as POLL events; `applySyncEvent(event)`: map status (issued→ISSUED, sent→SENT, paid→PAID, partial→PARTIAL, cancelled→CANCELLED), `paidCents` from `paid`, `externalNumber`, `externalUpdatedAt`; never moves money on the receivable (cash is recorded by us); audit `INVOICE_SYNCED` on change.
- Routes: `routes/admin.invoices.routes.js` at `/admin/invoices` (`invoices.read`/`invoices.write`): `GET /` (filters kind, status, receivableId, from, to, search), `GET /:id`, `GET /:id/pdf` (stream `application/pdf`, `Content-Disposition: inline`), `POST /:id/send` (202), `POST /:id/cancel` (PROFORMA only), `POST /:id/retry` (ERROR → DRAFT + enqueue); `POST /admin/finance/receivables/:id/invoices` (202 `{ invoice }`); `routes/integrations.invoiceocean.routes.js` at `/integrations/invoiceocean/webhook` (public; secret header `X-Webhook-Secret` or body `api_token` per InvoiceOcean's echo; `express.json` limit fine; global limiter); `routes/partner.finance.routes.js` + `GET /invoices`, `GET /invoices/:id/pdf` scoped by `receivable.debtorPartnerId`.
- Outbox: TOPICS `INVOICE_ISSUE_REQUESTED 'finance.invoice.issue_requested'`, `INVOICE_SEND_REQUESTED`, `INVOICE_ISSUED`, `INVOICE_SYNC_FAILED`; handlers call the service; `PAYMENT_RECORDED` handler extended to `recordProviderPayment`.
- Config `config.finance.invoiceocean`: `enabled` (`INVOICEOCEAN_ENABLED`), `domain`, `apiToken`, `webhookSecret`, `departmentId`, `lang` default `en`, `defaultTaxBps` 1800, `pollIntervalMs` 15 min, `requestTimeoutMs` 15 s; when `enabled` in production require token+secret (`requiredInProduction` conditional); redact `INVOICEOCEAN_API_TOKEN` (never log request bodies; add `api_token` to pino redaction if body logging is ever enabled).
- `server.js`: `invoicePollSweeper` and `invoiceSyncApplier` intervals; cleared on shutdown.
- Validation `validation/invoice.js`: `requestInvoiceSchema` (`kind ∈ PROFORMA|VAT|ADVANCE|FINAL`, `lang ∈ en|ru|de|…` (InvoiceOcean list), `dueDate` date-only, optional `lines`), `invoiceQuerySchema`, `sendInvoiceSchema`, `webhookSchema` (loose: `{ app_name?, api_token, deal | invoice }`).
- Docs: `API.md` "Invoicing"; `docs/API_TESTING_GUIDE.md` Part 8c; Postman `06o · Invoices`; `docs/DEPLOYMENT.md` InvoiceOcean setup (token, webhook registration via `POST /webhooks.json` or the UI, secret).

## 4.E Frontend implementation

- Finance → Invoices: `finance/invoices/page.tsx` (`InvoicesBrowser`: kind/status/date/search filters; status pills DRAFT neutral, ISSUED info, SENT info, PAID positive, PARTIAL attention, CANCELLED neutral, ERROR critical) and `finance/invoices/[id]/page.tsx` (lines, buyer snapshot, chain links, external number, "Open PDF" (new tab to the API stream), "Send by email", "Cancel proforma", "Retry", sync error banner).
- Receivable detail: "Invoices" panel with "Issue proforma/VAT" button (`invoices.write`), chain view.
- Partner detail: tax id and invoice language fields; portal settings "Company" section gains tax id (owner/admin).
- Portal `/portal/finance`: invoice rows with PDF links; `/portal/invoices/[id]/pdf` proxies via the API.
- API `client/lib/api/invoices.ts`; types `client/types/invoice.ts`; help `fn-invoices`.

## 4.F Business logic

1. Receivable created (Phase 2) → `INVOICE_ISSUE_REQUESTED PROFORMA` → handler ensures the InvoiceOcean client (external_id = partnerId or `guest:<email>`), looks up `oid`, creates the proforma, stores ids → ISSUED; optional auto-send (`INVOICEOCEAN_AUTO_SEND=true`).
2. Full payment recorded → receivable PAID → `INVOICE_ISSUE_REQUESTED VAT` with `from_invoice_id` = proforma external id, `paid` total; also `createPayment` on the provider for reconciliation.
3. Partial payment → provider payment recorded against the proforma (status `partial` arrives via sync).
4. Cancellation before VAT → proforma cancelled on the provider and locally; after VAT → CORRECTION for `(newAmount − vatTotal)` with reason; the receivable's new amount drives any further invoice.
5. Status changes made in InvoiceOcean (marked paid there, sent there) arrive by webhook or poll and update `Invoice` only; a finance user then records the cash in the platform (a "mark received as per InvoiceOcean" shortcut can prefill the payment modal).
6. Manual issue for receivables created before the integration (backfilled) via the button; import script for pre-existing invoices.
Edge cases: provider down (outbox retry; ERROR after 8; retry button); duplicate webhook (unique event key); webhook for an unknown `oid` (stored, flagged, listed under "unmatched"); currency not supported by the account (422 surfaced in `syncError`); language unsupported (fallback `en`); two concurrent issue requests (partial unique index); receivable amount changed after proforma (cancel + reissue proforma automatically when still unpaid).

## 4.G Security

Token and secret in env only; never in client code or logs; webhook endpoint validates secret with `timingSafeEqual`, rejects bodies > 100 kB, rate-limited, and does no processing inline; PDF streamed through the API with capability/tenant checks (never expose the provider token URL to partners — use the stream, or the public `token` link only if the owner accepts that it is unauthenticated); audit every issue/send/cancel/sync-failure; partner sees only invoices of its receivables.

## 4.H Testing

- `test/invoicing.adapter.unit.test.js`: request bodies for proforma/VAT/correction/client/payment built from fixtures; amount formatting (`48000 → "480.00"`); 422 mapping; 429 retry; timeout → BadGateway; concurrency limiter (2).
- `test/invoicing.flow.test.js` with a stub HTTP server standing in for InvoiceOcean (like the mailer capture transport): confirm → proforma issued once (replayed handler does not duplicate; `oid` adoption path); pay → VAT from proforma + provider payment; cancel before/after VAT; ERROR after max attempts and retry; webhook duplicate ignored; poll applies status; partner PDF access isolation; disabled flag → no events.
- `test/finance.access.test.js` extended for `invoices.*`.
- Sandbox end-to-end against a test InvoiceOcean account before go-live (documented checklist).
- Acceptance: a partner booking produces a proforma visible in the admin and portal with a PDF; recording full payment produces a VAT invoice linked to it; InvoiceOcean shows both with `oid` = booking reference; cancelling a VAT-invoiced booking produces a correction.

## 4.I Deployment

Env: `INVOICEOCEAN_ENABLED`, `INVOICEOCEAN_DOMAIN`, `INVOICEOCEAN_API_TOKEN`, `INVOICEOCEAN_WEBHOOK_SECRET`, `INVOICEOCEAN_DEPARTMENT_ID`, `INVOICEOCEAN_LANG`, `INVOICEOCEAN_DEFAULT_TAX_BPS`, `INVOICEOCEAN_POLL_INTERVAL_MS`, `INVOICEOCEAN_AUTO_SEND`. Feature flag = `INVOICEOCEAN_ENABLED` (default false): deploy with it off, run the import script, register the webhook pointing at `${APP_URL}/api/integrations/invoiceocean/webhook`, then enable. Rollback: disable the flag; invoices already issued remain readable. Monitoring: counter logs `invoicing.issue ok|error`, failed-outbox list, `FINANCE_INVOICE_SYNC_FAILED` notices.

## 4.J Effort and risks

| Item | Days |
|---|---|
| Schema, migrations, customers | 1.5 |
| Adapter + limiter + unit tests | 2.5 |
| invoice.service + outbox handlers + flows + tests (stub server) | 4 |
| Webhook + polling + apply + tests | 2 |
| Admin invoices UI + receivable panel + partner PDFs + help | 3–4 |
| Import script, docs, Postman, sandbox run | 1.5 |
| **Total** | **14–16** |

Risks: English docs thinner than Polish (advance/final kinds, `external_id`) — verify in the sandbox first; webhook retries undocumented → polling mandatory; account-level settings (numbering, departments, VAT) need client input (D1–D4); the public `token` URL is unauthenticated (use the API stream for partners).


---

# Implementation dependency analysis

```
Phase 0 Hardening ──┬──> Phase 1 Accounts & RBAC ──> Phase 2 Operational finance ──> Phase 3 Payment reminders
                    │                                        │
                    │                                        └──> Phase 4 InvoiceOcean (needs Receivable, Partner legal fields, FINANCE role)
                    └──> Phase 5 Maps (needs only 0.7 keys)        Phase 3 and Phase 4 are independent of each other
```

- **Critical path:** 0 → 1 → 2 → 4 (invoicing is the last client-visible milestone). Phase 3 hangs off Phase 2 and can run alongside Phase 4.
- **Parallel lanes (two engineers):** Lane A = 0.1–0.6, 1, 2, 3. Lane B = 0.7, 5, then 4 once Phase 2's `Receivable` model has landed (Phase 4 touches `services/invoicing/*`, `routes/admin.invoices.routes.js`, `client/.../invoices`, none of which Lane A edits).
- **Merge-conflict hot spots:** `server/prisma/schema.prisma` (every phase adds models: rebase often, keep each phase's models in a contiguous block with a `// --- Finance ---` header), `routes/index.js` (mount list: append-only), `middleware/auth.js` (Phase 0.2 and Phase 1 both touch it: do 0.2 first, then 1 builds on it), `lib/outbox.js` TOPICS + `outbox.service.js` handlers (Phases 3 and 4 both add entries: alphabetical insertion, separate blocks), `client/lib/admin/navigation.ts` (Phases 1, 2, 5 add groups: one group per phase), `server.js` interval list (Phases 3, 4, 5 add sweepers), `test/support/factories.js` (new factories appended), `config.js` sections (one new section per phase: `finance`, `invoicing`, `geo`).
- **What must not be parallelised:** the serializer money-gate conversion (Phase 1) and the Phase 0.2 serializer split, since they edit the same lines.

# Risk and compatibility analysis

| Risk | Impact | Mitigation |
|---|---|---|
| Existing bookings have no payables/receivables | Finance screens show empty history; reminders miss old bookings | Idempotent backfill script (Phase 2) run once after deploy; records marked `source: BACKFILL`; due dates null when no terms exist, listed in a "needs terms" filter |
| Migration failure mid-deploy | Render `preDeployCommand` aborts the deploy; compose `migrate` service exits non-zero and the API never starts | All migrations additive; enum values in their own earlier migration; rehearse on a dump (`docs/DEPLOYMENT.md` §5); never edit applied migrations (checksummed) |
| Financial integrity (double payment, over-allocation, currency mix) | Wrong balances, wrong invoices | `PaymentRecord.idempotencyKey` unique; allocation sum CHECK; row locks (`SELECT … FOR UPDATE`) on receivable/instalment during allocation; currency equality enforced in service and CHECK; integer cents only; audit every write |
| Authorization regressions during router conversion | A role loses or gains access silently | Table-driven `rbac.matrix.test.js` committed before conversion with today's expectations, then updated deliberately per router; fail-closed defaults for new roles |
| Cross-company exposure | Supplier/partner sees another's data | Phase 0.2 fix; every new list scoped by `partnerId`; 404 for foreign ids; serializer tests per viewer type |
| InvoiceOcean outage or rate limit | Invoices not created or stale | Outbox retry with backoff; dead-letter list screen; manual "issue invoice" fallback; polling watermark catches missed webhooks; limiter at 2 concurrent requests |
| Duplicate invoices or payments | Accounting mess with the client's legal invoices | Partial unique index per receivable and kind; `oid` lookup before create; `InvoiceSyncEvent` unique on provider event id; webhook handler idempotent |
| Notification delivery failures | Missed payment deadlines | At-least-once outbox; per-recipient sent stamps; overdue escalation repeats daily until paid; dead-letter visible in admin |
| Existing pricing behaviour (0.5 fix, road metrics) | Quotes change for live catalogue | List affected TRANSFER rules and uncurated pairs before deploy; `metricsSource` surfaced; owner sign-off |
| Google Maps cost | Unexpected bill | Essentials-only termination, region/type filters, internal-first search, 30-day pair cache, quotas and budget alerts, cost counter in logs |
| Deployment and rollback | Half-deployed client/server pair | Server first (additive responses), client second; feature flag for the picker; forward-fix policy for migrations |
| Help-registry test and typegen | CI red on new pages | Each page task includes its help article and `npx next typegen` |

# Client decisions required (before the phase that needs them)

| # | Decision | Needed by | Default assumed in this plan |
|---|---|---|---|
| D1 | Invoicing legal entity, VAT registration, address and bank details to appear on invoices | Phase 4 | "I am Georgia LLC" (`client/constants/site.ts:42`), VAT 18% included (seed `scripts/seed-catalogue.js:436-440`) |
| D2 | Invoice language per partner (InvoiceOcean has no Georgian or Hebrew) | Phase 4 | `en`; `ru` for partners whose preferred locale is ru |
| D3 | Invoice numbering series and department in InvoiceOcean | Phase 4 | Account default series; one department |
| D4 | Tax treatment of transfers/tours/services on invoices (VAT rate per product type; exempt supplies) | Phase 4 | Same 18% included for all; FINANCE can override per line |
| D5 | Partner payment terms (due days after confirmation) default and per-partner overrides | Phase 2 | **Decided 2026-10-09:** due days set per partner (no fixed platform rule; 14 only as the starting value for a new partner), and Finance may override the due date on a single receivable (`PATCH /admin/finance/receivables/:id` `dueAt`, audited) |
| D6 | Supplier payment terms per hotel contract (the 30%/3 days and 70%/−7 days example); whether a supplier is owed anything on cancellation | Phase 2/3 | **Decided 2026-10-09: depends on the supplier.** `SupplierPaymentTerms.cancellationLiability` ∈ `PROPORTIONAL` (owed the same share of net as the charge taken: 50% charged → 50% of net), `NONE_UNLESS_NON_REFUNDABLE`, `MANUAL` (payable flagged for Finance to set). Default `PROPORTIONAL` when a supplier has no terms. Finance can always adjust a single payable (audited, reason required). Replaces the `nonRefundable` boolean as the cancellation switch in `applyCancellationInTx` |
| D7 | Who receives payment reminders (FINANCE role users + a finance mailbox?) and at which offsets | Phase 3 | FINANCE and ADMIN in-app; `FINANCE_OPS_EMAIL`; offsets 7, 3, 1, 0 days and daily overdue |
| D8 | Reporting currency and whether to convert (no FX today) | Phase 2 | **Decided 2026-10-09:** report per currency, no conversion; NBG-rate conversion may be added later |
| D9 | Accounting software that receives exports (format) | Phase 2 optional | Generic CSV |
| D10 | Whether admin-verified catalogue coordinates count as platform data under Google's 30-day Places cache rule | Phase 5 | Refresh Places-sourced points monthly until legal confirms |
| D11 | Role behaviour changes: PARTNER_FINANCE loses booking rights; DISPATCHER loses cancel; ADMIN loses staff management | Phase 1 | **Confirmed 2026-10-08** and implemented |

---

# Detailed task breakdown

Conventions for every task: branch per task; the PR includes tests, `API.md`/Postman updates where routes change, and a help article for every new admin page (`test/help-registry.test.ts:154` fails otherwise). Definition of Done (DoD) for all tasks unless stated: tests listed pass locally (`npm test` in `server/`, waiting 70 s between runs; `npm run typecheck && npm run lint && npm test && npm run build` in `client/`), CI green, no `DROP INDEX "*_geo_idx"` in any migration, reviewer sign-off. Priority: P0 security/blocking, P1 essential, P2 optional. Effort in engineer-days.

## Phase 0 tasks

| ID | Title | Files | Exact change | Acceptance | Tests | Effort | Deps |
|---|---|---|---|---|---|---|---|
| T0.0 | Save this plan in the repo | `docs/plans/b2b-enterprise-implementation-plan.md` | Copy this file | File present; linked from `docs/README.md` | — | 0.1 | — |
| T0.1 | Gate public booking routes for non-approved partners (P0) | `middleware/auth.js`, `routes/hotels.bookings.routes.js:57`, `transfers.bookings.routes.js:48`, `tours.bookings.routes.js:51`, `orders.routes.js:40`, `services/hotel/pricingRule.service.js:59-114` | Add `requireTradeOrGuest`; mount after `optionalAuthenticate`; `resolveMarkup` ignores a partner whose `status !== 'APPROVED'` | Suspended/pending/rejected partner gets 403 on create/amend/cancel; quotes use public markup | `partners.access.test.js` +4 tests; `supplier.test.js` markup source | 1 | — |
| T0.2 | Split net vs margin visibility (P0) | `middleware/auth.js:83`, `serializers/booking.js:89-96`, `tourBooking.js:60-64`, `service.js:141-145`, `inventory.js:147-150`, `transfer.js`, `order.js`, `package.js` (grep `marginCents`/`markupBps`) | Add `canViewMargin = isAdmin`; emit markup/margin/partner only under it; supplier view gets `bookedVia` | Supplier sees net, never margin/markup/buyer | `supplier.test.js` +1; `transfers.pricing.test.js` green | 0.5 | — |
| T0.3 | Remove transfer cancel/amend from DISPATCHER (P0) | `routes/transfers.bookings.routes.js:239`, `services/transfer/booking.service.js:455-495,~665` | `requireAdmin` on cancel; `assertMayMutate` for amend/cancel | Dispatcher: read 200, cancel 403, public amend 404 | `transfers.foundation.test.js:140` +1 | 0.5 | — |
| T0.4 | Order foreign reference → 404; audit partner self-read of bank details (P1) | `services/order/order.service.js:658`, `routes/partner.routes.js:150` | `NotFoundError`; route through `readFinancial` | 404 for foreign order; `PARTNER_FINANCIAL_VIEWED` on self-read | `tours.access`-style test for orders; `partners.financial.test.js:134` | 0.5 | — |
| T0.5 | Fix TRANSFER pricing-rule matching (P1) | `services/transfer/quote.service.js:227-232`, `pricingRule.service.js:106-111`, `services/package/quote.service.js` transfer slot | Pass `productType: 'TRANSFER'`; transfer default fallback | A TRANSFER rule applies; fallback = transfer default | new unit/integration test | 0.5 | — |
| T0.6 | Forgot/reset password pages (P1) | `client/app/[locale]/(site)/forgot-password/page.tsx`, `reset-password/[token]/page.tsx`, `client/lib/api/auth.ts`, sign-in pages, `lib/i18n/ui/{en,ka,ru,he}.ts`, help articles `signing-in.ts`, `troubleshooting.ts` | Pages modelled on `(site)/activate/[token]`; API functions; links; i18n; `npx next typegen` | Email link opens the page; reset signs in | help-registry test; manual Mailtrap E2E | 1.5 | — |
| T0.7 | Places billing + key hygiene (P1) | `client/components/geo/PlaceSearch.tsx:72,200-206,245-254`, `client/lib/geo/place.ts:75-90`, `client/test/geo-place.test.ts`, `docs/DEPLOYMENT.md:282-283`, Google Cloud, Vercel env | Essentials-only `PLACE_FIELDS`; name from prediction; `includedPrimaryTypes`/`includedRegionCodes` props; two restricted keys; Map ID; quotas | Selection costs Essentials SKU; map uses a real Map ID | geo-place unit test | 1 | — |

## Phase 1 tasks

| ID | Title | Files | Exact change | Acceptance | Tests | Effort | Deps |
|---|---|---|---|---|---|---|---|
| T1.1 | Role and audit enum migration | `prisma/migrations/20261015100000_rbac_enum_values`, `schema.prisma` enums | ADD VALUE × 12 (section 1.C) | `prisma migrate deploy` ok on a dump | CI migrate | 0.3 | — |
| T1.2 | Users columns + CHECK migration | `…100100_rbac_users`, `model User` | Columns, FKs, re-created `users_partner_role_requires_partner` | Inserting MANAGEMENT with null partner passes; with partner fails | `transfers.foundation.test.js:53-61` extended | 0.5 | T1.1 |
| T1.3 | Permissions module | `lib/permissions.js`, `test/permissions.unit.test.js` | `CAPABILITIES`, `ROLE_CAPABILITIES` (matrix 1.D), `can`, `capabilitiesFor`, `assertCan` | Matrix test passes | unit | 1 | — |
| T1.4 | `requireCapability` + legacy guard wrappers + `/me` capabilities | `middleware/auth.js`, `services/auth.service.js identity`, `serializers/user.js`, `routes/auth.routes.js` | As 1.B/1.D | `/me` returns capabilities; old guards unchanged behaviour | `auth.test.js` +1; all suites green | 0.5 | T1.3 |
| T1.5 | Route matrix test (baseline) | `test/rbac.matrix.test.js`, `test/support/factories.js` | Walk `routes/index.js`; one user per role; expected status table (today's behaviour) | Table committed and green before conversion | itself | 1 | T1.2, T1.4 |
| T1.6 | Convert admin routers to capabilities | every `routes/admin.*.routes.js`, `routes/*.bookings.routes.js` admin sections, `routes/orders.routes.js:114`, `admin.badges.routes.js` | Replace `requireAdmin`/`requireTransferOps` per matrix; update T1.5 expectations deliberately | MANAGEMENT read-only, RESERVATIONS booking ops, FINANCE finance reads | matrix test | 2 | T1.5 |
| T1.7 | Convert serializers' money and partner gates | `serializers/*.js` (sites listed in 1.D) | `can(viewer,'finance.margin.read')` etc. | MANAGEMENT sees margin; RESERVATIONS does not | `supplier`, `transfers.foundation`, `admin.summaries` + new assertions | 1 | T1.4 |
| T1.8 | Partner sub-role enforcement on bookings | public booking routers + `partner.*` routers | `can(req.user,'partner.bookings.write')` when `partnerId` set | PARTNER_FINANCE 403 on create | `partners.access.test.js` +2 | 0.5 | T1.6 |
| T1.9 | user.service + validation + serializer | `services/user.service.js`, `validation/user.js`, `serializers/user.js` | Functions in 1.D; ceilings; last-admin/owner guards; activation token reuse | Unit-level behaviours | `users.admin.test.js` | 2 | T1.2 |
| T1.10 | Admin users router + mount + docs | `routes/admin.users.routes.js`, `routes/index.js`, `API.md`, Postman `01c` | Endpoints in 1.D; `inviteLimiter` | SUPER_ADMIN only; ADMIN 403 | `users.admin.test.js` | 1 | T1.9 |
| T1.11 | Partner team router | `routes/partner.team.routes.js`, `routes/index.js` | Endpoints scoped by `partnerId`; `PARTNER_TEAM_MAX` | Owner invites agent; cross-partner 404 | `partners.team.test.js` | 1 | T1.9 |
| T1.12 | Audit service + global reader + login audit | `services/audit.service.js`, `routes/admin.audit.routes.js`, `services/auth.service.js:151`, `partner.service.js:571-577` | `listAudit(filters)`; `USER_LOGIN_SUCCEEDED`/`USER_LOGGED_OUT` | Filters work; partner 403 | `audit.test.js` +3 | 1 | T1.1 |
| T1.13 | Client types, session, navigation by capability | `client/types/{partner,auth,user}.ts`, `lib/auth/session.ts`, `lib/admin/navigation.ts`, `AdminShell.tsx` | `capabilities` on session; `navigationFor(capabilities)`; People group; role labels | Sidebar matches role; typecheck | `help-registry`, typecheck | 1 | T1.4 |
| T1.14 | Admin Staff pages | `(panel)/users/page.tsx`, `users/[id]/page.tsx`, `components/admin/{UsersBrowser,InviteUserModal,UserActions,UserDangerZone}.tsx`, `lib/api/users.ts`, `lib/admin/users.ts`, help `people/staff.ts` | Browser/detail pattern; copy-link; confirm-by-email delete | Invite → link → activate → sign in | help-registry; manual | 2 | T1.10, T1.13 |
| T1.15 | Audit log page | `(panel)/audit/page.tsx`, `components/admin/AuditBrowser.tsx`, `lib/api/audit.ts`, `lib/admin/audit.ts`, help `people/audit-log.ts` | Filters; labels moved from `lib/admin/partners.ts:84-102` | Lists and filters | help-registry | 1 | T1.12, T1.13 |
| T1.16 | Portal Team page | `(portal)/portal/team/page.tsx`, `components/partners/TeamSection.tsx`, `PortalShell.tsx`, `PortalSettings.tsx:53` | Inline guard + capability; invite/role/deactivate/primary | Owner manages team; agent sees no Team | manual; typecheck | 1.5 | T1.11, T1.13 |
| T1.17 | Help and docs updates | `help/articles/getting-started/{accounts,roles,signing-in}.ts`, `reference/troubleshooting.ts`, `API.md`, `API_TESTING_GUIDE.md` | Describe staff/team creation, new roles | Articles accurate | help-registry | 0.5 | T1.14–T1.16 |

## Phase 2 tasks

| ID | Title | Files | Exact change | Acceptance | Tests | Effort | Deps |
|---|---|---|---|---|---|---|---|
| T2.1 | Finance enum-values migration | `…20261101100000_finance_enum_values`, `schema.prisma` | `AuditAction` ×13, `FileCategory PAYMENT_ATTACHMENT` | migrate ok | CI | 0.3 | T1.2 |
| T2.2 | Finance module migration + models | `…100100_finance_module`, `schema.prisma` (models in 2.C), `validation/domain.js jsonFieldSchemas`, `lib/audit.js AUDIT_ENTITY`, `services/media/upload.service.js:50` | Tables, CHECKs, indexes, back-relations; milestones zod | `prisma validate`; CHECKs reject bad rows | `finance.schema.test.js` (CHECK violations → 409 via `sqlStateOf`) | 1.5 | T2.1 |
| T2.3 | Test factories | `test/support/factories.js` | `makeSupplierTerms`, `makePayable`, `makeReceivable`, `makePayment` | used by later tests | — | 0.5 | T2.2 |
| T2.4 | ledger.service (pure + InTx) | `services/finance/ledger.service.js`, `test/finance.ledger.unit.test.js` | `buildInstalments`, `deriveStatus`, `createPayableInTx`, `createReceivableInTx`, `applyCancellationInTx`, `recomputePayable` | Unit matrix passes | unit | 2 | T2.2 |
| T2.5 | Hook confirm paths | `services/hotel/booking.service.js:305-450,459-524`, `transfer/booking.service.js:255-347,377-410`, `tour/booking.service.js:192,328,607,683`, `service/booking.service.js:172,254,464,518`, `order/order.service.js:454-589` | Calls per 2.D; hotel tx timeout | Records exist after every confirm path | `finance.records.test.js` | 1.5 | T2.4 |
| T2.6 | Hook cancel paths | the six cancel InTx functions | `applyCancellationInTx` | Amounts per 2.F | `finance.records.test.js` | 1 | T2.4 |
| T2.7 | payment.service + routes | `services/finance/payment.service.js`, `validation/finance.js`, `serializers/finance.js`, `routes/admin.finance.routes.js`, `routes/index.js` | Record/allocate/replay/locks; payables/receivables/payments endpoints | Contracts in 2.D | `finance.payments.test.js` incl. concurrency | 3 | T2.4 |
| T2.8 | Supplier and partner terms | `services/finance/terms.service.js`, sub-routers on hotels/tours/services/providers, `validation/partner.js:139-156`, `serializers/partner.js` | GET/PUT terms; partner due days | Terms saved; no reschedule | `finance.terms.test.js` | 1.5 | T2.2 |
| T2.9 | Reports + CSV | `services/finance/report.service.js`, routes | summary/margin/ageing; `$queryRaw` aggregates; CSV stream; audit | Per-currency numbers match fixtures | `finance.reports.test.js` | 2 | T2.5 |
| T2.10 | Partner statement | `routes/partner.finance.routes.js` | statement + supplier payables | Isolation | `finance.access.test.js` | 1 | T2.7 |
| T2.11 | Backfill script | `scripts/backfill-finance.js`, `server/README.md` script table, `docs/DEPLOYMENT.md` §3.4 | Idempotent, dry-run | Second run creates nothing | `finance.backfill.test.js` | 1 | T2.5 |
| T2.12 | Client finance section | `(panel)/finance/{page,payables,payables/[id],receivables,receivables/[id],payments,reports}.tsx`, `components/admin/{PayablesBrowser,ReceivablesBrowser,PaymentsBrowser,RecordPaymentModal,FinanceReports,FinancePanel}.tsx`, `lib/api/finance.ts`, `types/finance.ts`, `lib/admin/finance.ts`, `navigation.ts`, help `fn-*` | Pattern per 2.E | Screens work against the API | help-registry; typecheck; manual | 5 | T2.7, T2.9 |
| T2.13 | Supplier terms UI + partner terms panel | `hotels/[slug]/supplier-terms/page.tsx` + tile, `components/admin/SupplierTermsForm.tsx`, tour/service/provider pages, `partners/[id]` panel | Milestone editor with preview | Save/load | help-registry | 1.5 | T2.8 |
| T2.14 | Portal statement page | `(portal)/portal/finance/page.tsx`, `PortalShell.tsx` | Balances, rows, payments | Owner/finance see it; agent not | manual | 1 | T2.10 |
| T2.15 | Docs/Postman | `API.md`, `API_TESTING_GUIDE.md` 8b, Postman `06n` | — | Newman folder green | newman | 1 | T2.7–T2.10 |

## Phase 3 tasks

| ID | Title | Files | Exact change | Acceptance | Tests | Effort | Deps |
|---|---|---|---|---|---|---|---|
| T3.1 | Notification enum values | `…20261110100000_finance_notifications_enum_values`, `schema.prisma` | 5 kinds + 1 audit action | migrate ok | CI | 0.2 | T2.2 |
| T3.2 | Reminder sweeper | `services/finance/reminder.service.js`, `config.js finance.*`, `server.js` intervals + shutdown, `.env.example` | SQL in 3.D; collapse; config validation | Claims once; concurrency-safe | `finance.reminders.test.js` | 1.5 | T2.2 |
| T3.3 | Topics, handlers, templates, recipients | `lib/outbox.js`, `services/notifications/outbox.service.js`, `lib/mailer/templates.js`, `test/mailer.test.js:25-33` | 4 topics; `financeUserIds()`; 5 templates | Email + in-app per event; skip when paid | `finance.reminders.test.js`, `mailer.test.js` | 1.5 | T3.2 |
| T3.4 | Admin/partner notifications API + badges + due endpoint | `routes/admin.notifications.routes.js`, `routes/partner.notifications.routes.js`, `routes/admin.badges.routes.js`, `routes/admin.finance.routes.js /due`, `routes/index.js` | Endpoints in 3.D | Scoped to recipient | `notifications.admin.test.js` | 1 | T3.1 |
| T3.5 | Failed-outbox list + retry | `routes/admin.outbox.routes.js`, `services/notifications/outbox.service.js` | List `attempts >= MAX_ATTEMPTS`, retry resets | Retry re-delivers | test in `bookings.notifications` style | 1 | — |
| T3.6 | Bell, notifications page, badge, overview widget, portal bell | `AdminShell.tsx`, `components/notifications/NotificationList.tsx` (generalised from driver), `(panel)/notifications/page.tsx`, `(panel)/page.tsx`, `finance/page.tsx PaymentsDuePanel`, `navigation.ts`, `lib/api/admin.ts`, `lib/api/notifications.ts`, portal equivalents, help `fn-reminders` | Per 3.E | Unread count, list, mark read; widget | help-registry; manual | 2.5 | T3.4 |
| T3.7 | Docs/Postman/env | `API.md`, Postman `06n`, `render.yaml`, `docker-compose.prod.yml`, `DEPLOYMENT.md` | — | — | newman | 0.5 | T3.4 |

## Phase 4 tasks

| ID | Title | Files | Exact change | Acceptance | Tests | Effort | Deps |
|---|---|---|---|---|---|---|---|
| T4.1 | Invoicing enum + module migrations + models | `…20261115100000_invoicing_enum_values`, `…100100_invoicing_module`, `schema.prisma` (4.C), `validation/domain.js`, `lib/audit.js` | Tables, partial unique, CHECKs, Partner `taxId`/`invoiceLang` | migrate ok | `finance.schema.test.js` ext. | 1 | T2.2 |
| T4.2 | Provider interface + InvoiceOcean adapter | `services/invoicing/provider.js`, `invoiceocean.adapter.js`, `config.js finance.invoiceocean`, `.env.example` | HTTP, limiter, retry, bodies (4.D) | Unit fixtures match docs | `invoicing.adapter.unit.test.js` | 2.5 | — |
| T4.3 | invoice.service + outbox handlers | `services/invoicing/invoice.service.js`, `lib/outbox.js`, `outbox.service.js` (+ `PAYMENT_RECORDED` ext.), hooks in `ledger.service.js` (`INVOICE_ISSUE_REQUESTED`) and `payment.service.js` (VAT on paid) | Flows in 4.F | Stub-server flows pass | `invoicing.flow.test.js` | 3 | T4.1, T4.2, T2.7 |
| T4.4 | Webhook + polling + apply | `services/invoicing/sync.service.js`, `routes/integrations.invoiceocean.routes.js`, `server.js` | Secret check; events; watermark poll | Duplicate ignored; status applied | `invoicing.flow.test.js` | 2 | T4.3 |
| T4.5 | Admin invoice routes + partner PDFs + validation | `routes/admin.invoices.routes.js`, `routes/partner.finance.routes.js`, `validation/invoice.js`, `serializers/finance.js` | Endpoints in 4.D | Contracts | `finance.access.test.js` ext. | 1 | T4.3 |
| T4.6 | Import script | `scripts/import-invoiceocean.js`, README | Idempotent import by `oid` | Report of unmatched | manual against sandbox | 1 | T4.2 |
| T4.7 | Admin invoices UI + receivable panel + partner fields + portal | `finance/invoices/{page,[id]}.tsx`, `components/admin/{InvoicesBrowser,InvoiceActions}.tsx`, receivable detail panel, `partners/[id]` tax fields, `PortalSettings` tax id, `portal/finance` invoice rows, `lib/api/invoices.ts`, `types/invoice.ts`, help `fn-invoices` | Per 4.E | PDF opens; issue/send/cancel/retry | help-registry; manual | 3.5 | T4.5 |
| T4.8 | Docs, Postman, deployment, sandbox run | `API.md`, `API_TESTING_GUIDE.md` 8c, Postman `06o`, `DEPLOYMENT.md`, `render.yaml` | Setup steps, webhook registration | Sandbox checklist passed | newman | 1.5 | T4.4 |

## Phase 5 tasks

| ID | Title | Files | Exact change | Acceptance | Tests | Effort | Deps |
|---|---|---|---|---|---|---|---|
| T5.1 | Point review enum + hotel link + metrics table | `…20261020100000_transfer_points_review_enum`, `…100100_transfer_points_hotels_metrics`, `schema.prisma` | Per 5.C | migrate ok; unique placeId index | CI | 1 | T0.7 |
| T5.2 | location.service: search + resolve + review/merge | `services/transfer/location.service.js`, `lib/slug.js`, `services/package/recommendation.service.js` (export `nearestPoint` with cap), `validation/transfer.js`, `serializers/transfer.js`, `routes/transfers.routes.js`, `routes/admin.transfers.routes.js`, `middleware/rateLimit.js resolveLimiter`, `config.js geo` | Per 5.D | Dedupe, proximity, cap, review | `transfers.locations.test.js` | 3 | T5.1 |
| T5.3 | routes.service (Routes API) + cache + sweeper + quote/route integration | `services/geo/routes.service.js`, `services/transfer/quote.service.js:189-197`, `route.service.js:178-184`, `point.service.js updatePoint`, `server.js`, `.env.example` | Per 5.D; `metricsSource` | Cached road metrics used; fallback | `geo.routes.unit.test.js`, `transfers.pricing.test.js` ext. | 2 | T5.1 |
| T5.4 | Client LocationPicker + hook extraction + RouteMap + i18n | `components/transfers/{LocationPicker,RouteMap}.tsx`, `components/geo/useAutocompleteSuggestions.ts`, `PlaceSearch.tsx`, `TransferSearch.tsx`, `transfers/search/page.tsx`, `transfers/booking/page.tsx`, `GoogleMapsProvider.tsx:33 (+geometry)`, `lib/api/transfers.ts`, `types/transfer.ts`, `lib/i18n/ui/*.ts`, flag `NEXT_PUBLIC_TRANSFER_LOCATION_PICKER` | Per 5.E | "Biltmore" flow works | `transfer-location-picker.test.ts`; manual | 3.5 | T5.2, T5.3 |
| T5.5 | Admin review queue + badge + driver fallback | `transfers/points/page.tsx`, `components/admin/PointReviewActions.tsx`, `navigation.ts`, `lib/api/admin.ts`, `admin.badges.routes.js`, driver assignment page, help `tr-point-review` | Per 5.E | Approve/reject/merge | help-registry; manual | 1 | T5.2 |
| T5.6 | Keys, env, docs, monitoring | `render.yaml`, `docker-compose.prod.yml`, `DEPLOYMENT.md`, `.env.example`, Google Cloud | Per 5.I | Documented | — | 0.5 | T5.3 |

---

# Final deliverables

## 1. Executive summary

Six client requirements map onto five build phases plus a hardening phase. The strategy is: fix the four verified security defects and two cost/functional gaps first (days, not weeks); then give the platform a capability-based permission layer and real user management, because every later feature needs someone to assign it to and a role to protect it; then add an operational finance ledger (payables, receivables, payments) inside the existing booking transactions, which is the data every reminder and invoice hangs off; then the reminder engine on the existing outbox and sweeper infrastructure; then InvoiceOcean through a provider-agnostic adapter driven by outbox events; and, independently, the transfer search upgrade (internal hotels first, Google Places second, Routes API on the server). Nothing that works today is rebuilt: booking services, outbox, sweepers, audit, admin page patterns and the geo components are all extended in place. Total 76–93 engineer-days (Phases 0–5), about 15–19 weeks for one engineer or 9–11 calendar weeks for two.

## 2. Current vs target architecture

| Area | Today | Target |
|---|---|---|
| Identity | One `User` table, 8 roles, creation by partner invitation, driver account or CLI | Same table, 11 roles, staff and team invitations through the activation-token flow, per-user lifecycle, global audit reader |
| Authorization | Role-list guards per router; `isAdmin` in serializers | `lib/permissions.js` capability map, `requireCapability`, capabilities served on `/me`, client nav driven by them |
| Money | Frozen net/sell/markup per booking; margin derived in serializers | Plus payables with instalments, receivables, payments with allocations, refunds, terms, reports, CSV |
| Notifications | Outbox + sweepers; in-app rows readable by drivers only; one ops mailbox | Plus finance reminders/overdue events, finance recipient resolver, admin and partner notification APIs and bells, failed-event list |
| Invoicing | None | Provider interface + InvoiceOcean adapter, proforma→VAT→correction chain, webhook + poll sync, PDFs, partner access |
| Transfers | Catalogue-point search, haversine estimate, Google exact door at checkout | Unified internal+Google search, auto-registered pending points, Routes API road metrics cached per pair, map on results |

## 3. Implementation roadmap

| Phase | Engineer-days | Calendar (1 eng) | Calendar (2 eng) | Milestone the client sees |
|---|---|---|---|---|
| 0 Hardening | 5–6 | Week 1 | Week 1 (split) | Security fixes live; password reset works; Maps costs capped |
| 1 Accounts & RBAC | 14–17 | Weeks 2–5 | Weeks 2–4 (A) | Staff and agency team accounts with distinct roles |
| 5 Maps (lane B) | 10–12 | Weeks 16–18 | Weeks 2–4 (B) | Hotel-name transfer search with road distance |
| 2 Operational finance | 20–23 | Weeks 6–10 | Weeks 5–9 (A) | Payables, receivables, payments, reports |
| 3 Payment reminders | 8–9 | Weeks 11–12 | Weeks 10–11 (A) | Deposit/balance reminders and overdue alerts |
| 4 InvoiceOcean | 14–16 | Weeks 13–15 | Weeks 7–10 (B, after T2.2/T2.7) | Invoices flowing to InvoiceOcean |
| **Total** | **76–93** | **~18 weeks** | **~11 weeks** | |

Assumptions: one senior engineer per lane who knows the codebase; estimates include tests, docs and Postman; exclude client review cycles and decisions D1–D11; InvoiceOcean sandbox account available by week 7.

## 4. Complete engineering task list

See "Detailed task breakdown" above (T0.0–T5.6, 60 tasks). Order of execution = Phase order; within a phase, dependency column.

## 5. Database design

Consolidated in 1.C (users), 2.C (finance), 3.C (notification kinds), 4.C (invoicing), 5.C (points/metrics). Migration sequence (all after `20260924100000_places_on_locations`, enum-values migrations first, hand-written, geo-index DROP lines removed): `20261015100000_rbac_enum_values`, `20261015100100_rbac_users`, `20261020100000_transfer_points_review_enum`, `20261020100100_transfer_points_hotels_metrics`, `20261101100000_finance_enum_values`, `20261101100100_finance_module`, `20261110100000_finance_notifications_enum_values`, `20261115100000_invoicing_enum_values`, `20261115100100_invoicing_module`. Timestamps are placeholders: use the authoring date, keep enum-values before module, keep all later than any applied migration.

## 6. API design

Endpoints, contracts and permissions are specified per phase (1.D, 2.D, 3.D, 4.D, 5.D). Cross-cutting rules: list envelope `{ data, total, page, pageSize, totalPages }`; errors `{ error: { message, details: { reason } } }`; `Idempotency-Key` on every money-writing POST; capability names as in the matrix; 404 for foreign tenant ids; 202 for provider-backed asynchronous actions.

## 7. RBAC permission matrix

Section 1.D.

## 8. Testing and QA plan

- **Unit** (`node:test`, no DB): permissions matrix; ledger arithmetic and status derivation; allocation algorithm; instalment date math incl. DST; adapter request bodies; route metrics cache logic.
- **Integration** (supertest + dev DB, factories): per-phase suites listed in 1.H, 2.H, 3.H, 4.H, 5.H; the table-driven route matrix is the authorization regression net.
- **Concurrency**: parallel payments on one receivable; parallel sweeps; parallel point resolution with the same place id; idempotent replays.
- **Regression**: entire existing suite (888+ tests) green after every phase; Newman full collection (`--delay-request 650`) before each release.
- **E2E/manual**: scripted checklists per phase acceptance criteria; Mailtrap for email; InvoiceOcean sandbox; Google keys in a staging project.
- **Client**: `typecheck`, `lint`, `test` (help registry), `build`; manual responsive pass on new screens (admin at 1280/768/400 px).
- **Acceptance gates**: each phase's "Acceptance" bullet demonstrated to the owner on the dev stack before merge to `main`.

## 9. Deployment and migration strategy

- Render deploys on push to `main` with `preDeployCommand: npx prisma migrate deploy` (`render.yaml:41`); Compose runs the `migrate` one-shot before `api`. Every migration is additive; enum values land in their own earlier migration; no applied migration is edited.
- Order per phase: merge server → Render deploys and migrates → verify `/health/db` → merge client → Vercel deploys. The server never breaks the older client (fields are only added).
- Phase-specific: 2 → run `scripts/backfill-finance.js --dry-run` then live; 3 → set `FINANCE_OPS_EMAIL`, `FINANCE_REMINDER_OFFSET_DAYS`; 4 → deploy with `INVOICEOCEAN_ENABLED=false`, import, register webhook, enable; 5 → client flag `NEXT_PUBLIC_TRANSFER_LOCATION_PICKER`, server key.
- Monitoring: pino JSON logs (counters for `finance.payment.recorded`, `invoicing.issue`, `geo.routes`), failed-outbox admin list, Google Cloud quota alerts, Render health checks. No APM exists; adding one is out of scope.
- Rollback: Render "Rollback" is safe because migrations are additive; forward-fix for data. Feature flags for invoicing and the picker allow instant disable.

## 10. Client decisions required

Table D1–D11 above. Blocking for Phase 2 start: D5, D6, D8. Blocking for Phase 4 start: D1–D4. D11 before Phase 1 router conversion.

## 11. AI implementation handoff checklist

Work strictly in this order; after each checkpoint run the listed gates and stop for review.

1. **Checkpoint 0 (setup):** T0.0; confirm Docker DB up; run the full server suite once to baseline (expect green).
2. T0.1 → T0.2 → T0.3 → T0.4 → T0.5 (server, one PR each or one combined "security hardening" PR). Gate: server suite + `partners.access`, `supplier`, `transfers.foundation` new tests. **Checkpoint 0a.**
3. T0.6 → T0.7 (client). Gate: `npm run typecheck && npm run lint && npm test && npm run build`; manual reset-password E2E with Mailtrap. **Checkpoint 0b.** Owner creates Google keys and Map ID.
4. T1.1 → T1.2 → T1.3 → T1.4 → T1.5 (baseline matrix committed). **Checkpoint 1a.**
5. T1.6 → T1.7 → T1.8 (update matrix expectations deliberately; D11 confirmed). Gate: whole suite. **Checkpoint 1b.**
6. T1.9 → T1.10 → T1.11 → T1.12 (server users/team/audit). Gate: new suites. **Checkpoint 1c.**
7. T1.13 → T1.14 → T1.15 → T1.16 → T1.17 (client). Gate: client gates + help registry; demo: invite RESERVATIONS user end-to-end. **Checkpoint 1 complete.**
8. Lane B may start T5.1 → T5.2 → T5.3 → T5.4 → T5.5 → T5.6 now (independent). Gate per task; demo "Biltmore" flow. **Checkpoint 5 complete.**
9. T2.1 → T2.2 → T2.3 → T2.4 (schema + ledger unit). **Checkpoint 2a.**
10. T2.5 → T2.6 (hooks; whole suite must stay green). **Checkpoint 2b.**
11. T2.7 → T2.8 → T2.9 → T2.10 → T2.11 (routes, terms, reports, statement, backfill). **Checkpoint 2c.**
12. T2.12 → T2.13 → T2.14 → T2.15 (client + docs). Demo: confirm → records → pay → report. **Checkpoint 2 complete.** Run backfill on dev.
13. T3.1 → T3.2 → T3.3 → T3.4 → T3.5 (server). **Checkpoint 3a.** T3.6 → T3.7 (client, docs). Demo: client scenario reminders. **Checkpoint 3 complete.**
14. T4.1 → T4.2 → T4.3 → T4.4 → T4.5 → T4.6 (server; stub-server tests). **Checkpoint 4a.** T4.7 → T4.8 (client, docs, sandbox run with the client's InvoiceOcean test account). **Checkpoint 4 complete.**
15. Final: full Newman run; `docs/plans/b2b-enterprise-implementation-plan.md` updated with "done" marks; audit artifact refreshed.

Rules for the implementing agent: never edit applied migrations; strip `DROP INDEX "*_geo_idx"`; register Json columns in `jsonFieldSchemas`; add `AUDIT_ENTITY` keys and enum values before use; add every new topic's handler in the same PR; add a help article or exemption for every new panel page; run `npx next typegen` after adding routes; wait 70 s between server test runs; never commit secrets; follow memory notes in `MEMORY.md` (copy-link rule, heredoc limits, rate limiter).
