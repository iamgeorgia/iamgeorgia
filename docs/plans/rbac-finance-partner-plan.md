# Roles, permissions and financial controls — implementation plan

Date 2026-10-11 · Branch `feat/b2b-phase-0-hardening` · Audit report: https://claude.ai/artifact/44Tdq7kRCNXV7ya4A8zL82

## Context

The 2026-10-10 audit compared the platform with the client's five-role specification (Super Admin, Tour Operator, Accountant, Partner, Finance Operator). Findings: the capability system is sound and server-enforced, but roles are hard-coded, one per user, with no overrides; Tour Operator cannot be expressed because one `catalogue.write` covers tours *and* hotel prices; eleven confirmed security defects (S1 high: read-only staff can cancel/amend/create bookings through the public routes); no approval step on refunds and write-offs; partners get working logins before any contract; no commission, penalty, credit-limit or per-partner product-access data.

**Owner decisions (2026-10-11):** replace FINANCE→ACCOUNTANT and RESERVATIONS→TOUR_OPERATOR (widened), keep MANAGEMENT, add FINANCE_OPERATOR, migrate users automatically · approvals via new `finance.refunds.approve` / `finance.adjustments.approve`, any holder may approve, never their own request, SUPER_ADMIN holds them by default · scope = audit roadmap phases 1–5 · keep the supplier fixed sell price but require sell ≥ net.

**Assumptions (say so if wrong):** contract = signed PDF uploaded by an admin with a signed-on date (no e-signature); existing APPROVED partners are grandfathered (`contractRequired=false`); partner agents keep seeing the whole company's bookings; credit limit mode per partner, default BLOCK; `*.execute` (bypass approval) is held by nobody by default, SUPER_ADMIN included, and must be granted explicitly.

**Working-tree constraint.** Peer session `i-am-georgia-18` is building plan Phase 3 (finance reminders + admin notifications), uncommitted, in: `config.js, lib/audit.js, lib/mailer/templates.js, lib/outbox.js, prisma/schema.prisma, server.js, services/finance/payment.service.js, validation/finance.js, routes/admin.finance.routes.js, routes/index.js, serializers/finance.js, services/notifications/*, routes/admin.badges.routes.js` (+ new notification/outbox routes, `services/finance/reminder.service.js`, migration `20261010100000_finance_notifications_enum_values`). **Phase A below touches none of those and can start now. Every later phase (needs `schema.prisma` / `routes/index.js`) starts after that work is committed** and reuses its `notify()` and admin notifications API for approval notices.

## What is reused (do not rebuild)

`can/assertCan/requireCapability/requireCapabilityByMethod` (`lib/permissions.js`, `middleware/auth.js`) · `assertMayMutate` pattern (`services/transfer/booking.service.js:512-522`) · `recordAudit` (`lib/audit.js`) with `{changes:{field:{from,to}}}` metadata · `lockRows` (`services/finance/payment.service.js:55` → move to `lib/db/locks.js`) · `enqueueEvent`/`TOPICS` (`lib/outbox.js`) + `notify()` (`services/notifications/outbox.service.js:106`) · `uploadFile`/`issueSignedUrl` (`services/media/upload.service.js:153,320`) · `nextReference(client,kind)` (`lib/reference.js:35`) · `sqlStateOf` 23514→409 (`middleware/errors.js`) · settlement/payment/ledger services · `requireHotelAccess` · user/team services and screens · `PartnerTermsPanel`, `canWrite` page pattern (`finance/payables/[id]/page.tsx:76-95,343`) · RBAC matrix test + `routeWalker` · factories `makeAdmin/makePartnerUser/makeDriverUser` · migration conventions (enum values in their own `*_enum_values` migration first; hand-check; strip `DROP INDEX "*_geo_idx"`).

---

## Phase A — Security fixes on untouched files (start now) · ~4–5 days

| ID | Fix | Files | Exact change | Tests |
|---|---|---|---|---|
| A1 | **S1** staff mutate via public routes | `services/hotel/booking.service.js` (cancel :776, amend :824, confirm :465), `services/tour/booking.service.js` (:593, :727), `services/order/order.service.js` (cancelOrder :888, cancelOrderItem :818, amendOrder :1011), `services/service/booking.service.js` (:306 → 404 not 403, cancel :452) | Add `assertMayMutate(booking, viewer, {capability, email})` per service, copied from transfers: holder of the capability passes; staff reader without it → 404; else `assertMayRead`. Cancel = `BOOKINGS_CANCEL`, amend = `BOOKINGS_WRITE`. In `middleware/auth.js rejectUnapprovedPartner`: a staff session (`isStaff`) on a non-read method must hold `bookings.write` (covers create on all five public routers in one place). | New `test/bookings.mutation.rbac.test.js`: MANAGEMENT/ACCOUNTANT-equivalent/DISPATCHER/DRIVER get 404 on cancel+amend and 403 on create for hotel, tour, order, service, transfer; RESERVATIONS and partner still succeed; guest with email still succeeds. |
| A2 | **S2** bank details | `routes/admin.partners.routes.js:154,170,231`, `serializers/partner.js:82`, `routes/auth.routes.js:46-53` | `GET/PUT /:id/financial` add `requireCapability(PARTNERS_FINANCIAL_READ)` (PUT keeps `partners.write` too); `/:id/audit` add `AUDIT_READ`; stop embedding `financial` in `/auth/me` and `/partner/me` (dedicated `GET /partner/financial` already exists). | `partners.financial.test.js` +3 (MANAGEMENT 403, RESERVATIONS 403, FINANCE 200, `/me` has no `financial`). |
| A3 | **S3** team escalation (interim) | `services/user.service.js:25-54` | Replace `RANK`/`withinCeiling` with `assertDominates(actor, capsOf(role))`: actor must hold every capability of the role it grants/touches (computed from `ROLE_CAPABILITIES` now; Phase C swaps the source to DB). Self-change guards stay. Keep client `lib/partners/team.ts invitableRoles/assignableRoles` consistent (derive from the same rule). | `partners.team.test.js`: PARTNER_ADMIN cannot invite/promote to PARTNER_FINANCE or OWNER; OWNER can. `users.admin.test.js` unchanged behaviour for SUPER_ADMIN. |
| A4 | **S5** sell < net | `validation/inventory.js:56-76`, `services/hotel/inventory.service.js:186-264`, new migration `20261011000000_rates_sell_gte_net` (SQL only, no schema change) | zod refine `sellCents == null \|\| netCents == null \|\| sellCents >= netCents`; in the upsert SQL compare the effective sell against the effective net (`COALESCE(new, existing)`) and raise 422 `SELL_BELOW_NET`; DB `CHECK (sell_cents IS NULL OR sell_cents >= net_cents)` — migration first `UPDATE rates SET sell_cents = NULL WHERE sell_cents < net_cents` and logs the count in a comment; add `sellCents` to `RATE_UPDATED` metadata. Same refine on `validation/service.js:40-42` (`netCents/sellCents`). | `inventory.test.js` +2 (admin and partner extranet 422); migration applied to dev DB. |
| A5 | **S9** read breadth | `routes/transfers.bookings.routes.js:212` summary → `requireCapability(FINANCE_MARGIN_READ)`; `services/media/upload.service.js:281 reachesAllFiles` → `isAdmin \|\| can(catalogue.write)` | — | `rbac.roles.test.js` +2; matrix fixture re-baselined (summary row only). |
| A6 | **S10** sign-in hardening | `middleware/rateLimit.js:204,250` | Login: keep `ip:email` bucket and add a per-IP bucket (30/15 min); forgot-password: key `ip:email` + per-IP bucket. `config.js` keys stay. | `auth.test.js` +2. |
| A7 | **S11** lifecycle edges | `services/transfer/driver.service.js:298-307`, `services/user.service.js:96-119`, `services/partner.service.js:305-407` | Driver deactivation spends open `authToken`s (`updateMany {usedAt}` as `user.service.js:320`); `assertNotLast` and `transitionPartner` take `pg_advisory_xact_lock(hashtext('rbac:last:'‖scope))` / `('partner:'‖id)` and re-read inside the tx. | `users.admin.test.js` concurrent-deactivate test (two SUPER_ADMINs, one must 409); `partners.approval.test.js` concurrent approve+reject. |
| A8 | Latent | `middleware/hotelAccess.js:41-55`, `services/transfer/vehicle.service.js:46 visibilityScope`, client `(site)/hotels/[slug]/page.tsx:155`, `(site)/transfers/booking/page.tsx:53` | Staff on the partner extranet with `manage` must hold `catalogue.write`; `visibilityScope` uses `isTrade(viewer)` not any `partnerId`; client `isTrade = can(session,'bookings.read') \|\| session.partner?.status==='APPROVED'`; `canChooseDriver = can(session,'bookings.write','dispatch.write') \|\| approved partner`. | `supplier.test.js` +1; client typecheck. |

Checkpoint A: server suite green; matrix fixture diff shows only A5; client typecheck/lint/build; commit `fix(server): Close the booking, bank-detail and pricing holes found by the RBAC audit.`

---

## Phase B — Finance integrity (after Phase 3 commit) · ~1.5 days

| ID | Fix | Files | Exact change | Tests |
|---|---|---|---|---|
| B1 | **S4** duplicate allocations | `validation/finance.js:62-71` (`allocationSchema` array refine: unique target ids), `services/finance/payment.service.js planAllocations/applyPlan` (merge entries by id before planning; `applyPlan` reads `paidCents` from the locked row once), `recomputePayable` (lock `supplier_payables` via `lockRows` first), new unique index `payment_allocations (payment_record_id, receivable_id)` and `(payment_record_id, payable_instalment_id)` in migration `20261011010000_payment_allocation_unique` | Also: explicit allocation target's `debtorPartnerId` / `payable.supplierPartnerId` must equal `counterpartyPartnerId` when given (422 `COUNTERPARTY_MISMATCH`); `attachmentAssetId` must be a READY `PAYMENT_ATTACHMENT` asset (422). Move `lockRows` to `lib/db/locks.js`. | `finance.payments.test.js` +4 (duplicate 400, counterparty 422, attachment 422, concurrent two-instalment pay keeps `paidCents` correct). |
| B2 | **S6** admin bundle | `lib/permissions.js:86-111` | Remove `FINANCE_WRITE` from `ADMIN` (ADMIN keeps all finance reads). | `permissions.unit.test.js` EXPECTED; matrix re-baselined (finance write rows for ADMIN only). |

---

## Phase C — Roles in the database, no behaviour change · ~5–6 days

**C1 schema + migrations.** `20261011100000_rbac_dynamic_enum_values`: `AuditAction` + `ROLE_CREATED, ROLE_UPDATED, ROLE_DELETED, USER_ROLES_CHANGED, USER_OVERRIDE_GRANTED, USER_OVERRIDE_REVOKED`. `20261011100100_rbac_dynamic_roles`:

```prisma
enum RoleSide { PLATFORM PARTNER }          enum OverrideEffect { GRANT DENY }
model Role { id; key String @unique; name; description?; side RoleSide; isSystem Boolean; sortOrder Int;
             capabilities RoleCapability[]; members UserRole[]; createdAt; updatedAt }           // roles
model RoleCapability { roleId; capability String; @@id([roleId, capability]) }                   // role_capabilities
model UserRole { userId; roleId (Restrict); grantedByUserId?; grantedAt; @@id([userId, roleId]) } // user_roles
model UserCapabilityOverride { id; userId; capability; effect OverrideEffect; reason String; expiresAt?; grantedByUserId?; createdAt; @@unique([userId, capability]) }
```
`User` gains `roles`, `capabilityOverrides`. **`User.role` stays as the primary role** (lowest `sortOrder` held; written by the service; never read for authorization) until Phase H. Trigger `rbac_assert_side()` on `user_roles` insert/update and `users.partner_id` update: PLATFORM roles need `partner_id IS NULL`, PARTNER roles need it NOT NULL, no mixed sides (raises 23514 → 409 via `middleware/errors.js`). Seed: 11 `roles` rows + `role_capabilities` generated by a read-only `scripts/print-role-seed.js` from the current `ROLE_LISTS` (pasted in, so the seed is provably today's table); backfill `INSERT INTO user_roles SELECT u.id, r.id FROM users u JOIN roles r ON r.key = u.role::text`.

**C2 resolver.** `lib/permissions.js`: `ROLE_LISTS`→`DEFAULT_ROLE_LISTS` (seed/tests), add pure `resolveCapabilities({roles, overrides}, now)` = union of role caps (SUPER_ADMIN key ⇒ every `CAPABILITIES` value minus `EXECUTE_CAPS`), + live GRANT − live DENY, unknown strings dropped. `can()` reads `viewer.capabilities` (Set or array) and falls back to `ROLE_CAPABILITIES[viewer.role]` for synthetic viewers (`services/package/priceFrom.service.js:27`, unit tests). New `services/rbac/access.js withAccess(user)` sets `capabilities`, `roleKeys`, `side`. Load once per request: extend the include in `middleware/auth.js resolveToken:174` (`roles:{include:{role:{include:{capabilities:true}}}}, capabilityOverrides:true`), same in `optionalAuthenticate`, `auth.service.js login:114`, `consumeAuthToken:301`, `routes/auth.routes.js identity()`. `serializers/user.js toSessionUser` → `capabilities` from the Set, plus `roles:[{key,name}]`. No cache: one cheap join per request means edits apply on the next request on every instance.

**C3 convert direct `.role` reads** (list from exploration): `requireDriver` → `can(DRIVER_PANEL)` (new cap, DRIVER only); `requireApprovedPartner`/`requirePartner` → `isAdmin(req.user) || partnerId` (delete `requireRole`, `ADMIN_ROLES`, `PARTNER_ROLES`, `TRANSFER_OPS_ROLES`); `outbox.service.js opsUserIds` → `usersWithCapability(cap,{partnerId?})` SQL in `services/rbac/access.js`; `user.service.js scopeWhere/listUsers/assertNotLast` via `user_roles ⋈ roles.key`; `dispatch.service.js:80,799`; `hotelAccess.js:50`; `admin.users.routes.js ROLE_LABELS` from `roles.name`; `validation/user.js` → `roles: z.array(roleKey).min(1).max(8)` validated against the table; scripts `create-admin.js`, `seed-b2b-demo.js`, `seed-fleet.js` → `assignRolesByKey`; factories `makeAdmin/makePartnerUser/makeDriverUser` create the `user_roles` row (callers unchanged).

**C4 role/grant services.** `services/rbac/role.service.js` (list/create/update/delete roles; capability edits audited `ROLE_UPDATED {changes:{capabilities:{added,removed}}}`; SUPER_ADMIN and DRIVER locked), `services/rbac/grant.service.js` (`assertDominates` from A3 now reads DB caps; `PROTECTED` caps grantable only through roles by an actor holding the cap **and** `roles.manage`/`partner.team.manage`, never via override; `setUserRoles`, `grantOverride`, `revokeOverride`, all audited, `assertNotSelf`).

**C5 proof.** `test/rbac.seed.test.js` (each seeded role's caps deepEqual `DEFAULT_ROLE_LISTS`); run `rbac.matrix.test.js` **without** update: fixture must be byte-identical. Commit.

---

## Phase D — New roles, capability split, role editor · ~7–8 days

**D1 rename (own commit).** `20261011130000_rbac_role_rename_enum_values`: `ALTER TYPE "role" RENAME VALUE 'FINANCE' TO 'ACCOUNTANT'`, `'RESERVATIONS' TO 'TOUR_OPERATOR'`, `ADD VALUE 'FINANCE_OPERATOR'`; `UPDATE roles SET key=…`; recreate `users_partner_role_requires_partner` with the new labels. Rename literals word-bounded across `server/` (validation, permissions, scripts, docs, tests, fixture keys, Postman folder 06n) and `client/` (`types/partner.ts Role`, `lib/admin/users.ts`, help articles, `AdminShell ROLE_LABELS`). Matrix must pass with renamed keys only (proves the rename is pure). Note: `PartnerKind.TOUR_OPERATOR` already exists as a partner *kind*; keep, document.

**D2 new capabilities** in `CAPABILITIES`: `tours.write`, `driver.panel`, `roles.manage`, `finance.notes.write`, `finance.refunds.request/approve/execute`, `finance.adjustments.request/approve/execute`, `finance.commission.read/write`, `partners.credit.write`, `partners.contract.write`, `partners.access.write`, `partner.terms.accept`. `pricing.write` becomes *the* hotel/package price capability (no new `hotels.pricing.write`). `EXECUTE_CAPS = [finance.refunds.execute, finance.adjustments.execute]` excluded from SUPER_ADMIN's computed set.

**D3 guards.** Extra `requireCapability(PRICING_WRITE)` on: rates PUT `admin.inventory.routes.js:57`, tax-fees `:77-94`, rate-plan POST/PATCH `admin.ratePlans.routes.js:71,86`, policies `:175-228`, child policy `admin.roomTypes.routes.js:221`. New `requireFieldsCapability(fields, cap)` middleware (403 `{reason:'PRICING_FIELDS', fields}` — refuse, never silently strip) on hotel PATCH (`supplierId`,`currency`), package POST/PATCH (`adjustmentKind/Value/AppliesTo`, `validation/package.js:95,139`), partner PATCH (`commissionRateBps` → `finance.commission.write`). `admin.tours.routes.js:76` write → `CATALOGUE_WRITE | TOURS_WRITE`.

**D4 role table (seed update, audited as ROLE_UPDATED).** PLATFORM_READ = catalogue/bookings/dispatch/partners/notifications read; FIN_READ = finance.margin/payables/receivables/payments/reports.read, finance.export, invoices.read, finance.commission.read.

| Role | Capabilities |
|---|---|
| SUPER_ADMIN | all computed, minus `*.execute` |
| ADMIN | platform.admin, audit.read, PLATFORM_READ, catalogue.write, tours.write, pricing.write, bookings.write/cancel, dispatch.write, partners.write, partners.financial.read, partners.contract.write, partners.access.write, partners.credit.write, FIN_READ |
| MANAGEMENT | audit.read, PLATFORM_READ, FIN_READ (no partners.financial.read) |
| TOUR_OPERATOR | PLATFORM_READ, bookings.write, bookings.cancel, tours.write, dispatch.write |
| ACCOUNTANT | audit.read, catalogue/bookings/partners/notifications.read, FIN_READ, partners.financial.read, finance.payments.write, finance.terms.write, invoices.write, finance.notes.write, finance.refunds.request, finance.adjustments.request, finance.commission.write, partners.credit.write |
| FINANCE_OPERATOR | catalogue/bookings/partners/notifications.read, finance.payables/receivables/payments.read, finance.payments.write, finance.notes.write, finance.refunds.request, finance.adjustments.request |
| DISPATCHER | catalogue.read, dispatch.read, dispatch.write, notifications.read |
| DRIVER | notifications.read, driver.panel |
| PARTNER_OWNER | today + partner.terms.accept · other partner roles unchanged |

TOUR_OPERATOR holds neither `catalogue.write` nor `pricing.write`, so every hotel price lever is closed at sub-router and field level. (Open: does the owner want TOUR_OPERATOR to also edit transfers/services catalogue? Default here: no, only `tours.write` + dispatch.)

**D5 routes + client.** `routes/admin.roles.routes.js` (`/admin/roles`, `roles.manage`: list/create/update/delete), `PUT /admin/users/:id/roles`, `POST/DELETE /admin/users/:id/overrides`, `GET /admin/users/:id/grantable`, `PUT /partner/team/:id/roles`, `GET /partner/team/grantable`. Client: `types/auth.ts Role → string`, `SessionUser.roles`; `lib/api/roles.ts`, `lib/admin/capabilities.ts` (labels grouped by `area.`); `/admin/roles` + `/admin/roles/[key]` editor; `/admin/users/[id]` Roles panel (multi-select from `/grantable`), Overrides panel, effective capabilities; `InviteUserModal`/`UserActions`/`TeamSection` multi-role from grantable lists; delete client `RANK` mirror; `isAdmin/isDriver/homePathFor/requireDriverSession` → capability checks; nav item “Roles” under People.

**D6 proof.** Second fixture commit: `RBAC_MATRIX_UPDATE=1 …`; review the diff (only TOUR_OPERATOR gains, ACCOUNTANT unchanged vs FINANCE, FINANCE_OPERATOR new column, ADMIN finance-write losses from B2, pricing rows). `permissions.unit.test.js` EXPECTED updated; `rbac.roles.test.js` + “tour operator cannot change a hotel price” across every price route and indirect lever; `users.admin.test.js` multi-role, override expiry, protected cap refused via override.

---

## Phase E — Approval requests · ~5–6 days

`20261011200000_approvals_enum_values` (`ApprovalKind {REFUND, WRITE_OFF, PAYABLE_OVERRIDE, RECEIVABLE_DUE_DATE, PENALTY_OVERRIDE}`, `ApprovalStatus {PENDING, APPROVED, REJECTED, CANCELLED}`, AuditAction `APPROVAL_REQUESTED/APPROVED/REJECTED/CANCELLED`, `PAYABLE_NOTES_CHANGED`, `RECEIVABLE_NOTES_CHANGED`, NotificationKind `APPROVAL_REQUESTED/DECIDED`) · `20261011200100_approvals_module`: `ApprovalRequest { id; reference (APR-… via nextReference); kind; status; subjectType; subjectId; payload Json; amountCents?; currency?; summary; requestedByUserId; requestNote?; decidedByUserId?; decidedAt?; decisionNote?; executedEntityType?; executedEntityId?; lastError?; indexes (status,createdAt), (requestedByUserId,status), (subjectType,subjectId,status) }`.

- Split `recordPayment`, `adjustPayable`, `adjustReceivable` into `XInTx(tx, input, actor, req, via?)` + thin wrappers (idempotency/P2002 stays in the wrapper). `via = {approvalId, requestedByUserId}` is added to the audit metadata.
- `services/finance/approval.service.js`: `KINDS` table (requestCap, approveCap, executeCap, zod schema, `execute(tx, request, actor, req)`); `requestApproval` (assertCan requestCap, parse, precondition check, create, audit, `enqueueEvent APPROVAL_REQUESTED`); `decide(id,{decision,note})` in one tx under `lockRows('approval_requests')`: PENDING only, `requestedByUserId === actor.id` → 403 `SELF_APPROVAL`, assertCan approveCap; APPROVE executes in the same tx (failure rolls back, request stays PENDING, `lastError` stored separately); REJECT/CANCEL. Outbox handlers (in `outbox.service.js`, now committed): notify `usersWithCapability(approveCap)` minus requester, email `config.finance.opsEmail`; decided → notify requester.
- Routes `/admin/approvals` (`routes/admin.approvals.routes.js`, `validation/approval.js`): list (approvers see all, requesters only theirs), get, create, approve, reject, cancel.
- Direct routes: `POST /payments kind=REFUND`, `PATCH /payables/:id {amountOverrideCents|waive}`, `PATCH /receivables/:id {dueAt|waive}` now need the matching `*.execute` cap, else 403 `{reason:'APPROVAL_REQUIRED', kind}`; `notes`-only PATCH needs `finance.notes.write` and is audited.
- Client: `/admin/finance/approvals` inbox (filters, detail, approve/reject with note), “Request approval” dialogs replacing the direct refund/waive/override/due-date buttons when `!canExecute && canRequest`; nav item + badge count (`admin.badges.routes.js`).
- Tests `finance.approvals.test.js`: request→approve executes and audits with `approvalId`; self-approve 403; wrong cap 403; approve twice 409; executor failure leaves PENDING; direct refund by ACCOUNTANT 403; by an `execute` holder 201.

---

## Phase F — Commission, penalties, credit limits · ~4–5 days

- **Commission (derived, rate frozen).** Add `commissionRateBps Int?` to HotelBooking/TourBooking/ServiceBooking/TransferBooking/Order, set in each `confirm*InTx` from `partner.commissionRateBps` (backfill existing partner bookings from the partner's current rate, noted as backfilled). SQL view `commission_entries` (UNION over the five tables: partner, product, booking, reference, currency, sell/net, markupBps, commissionRateBps, `commission_cents`, status, confirmedAt) read via `$queryRaw` in `report.service.js commission()`; `GET /admin/finance/reports/commission` (`finance.commission.read`, csv via `exportGate`); `GET /partner/finance/commission` scoped by session partner. Client report tab.
- **Penalties.** `PenaltyEntry { bookingType FinanceProduct; bookingId; reference; partnerId?; currency; chargeCents; overrideCents?; overrideReason?; approvalId?; createdByUserId?; @@unique([bookingType,bookingId]) }` written in every cancel path beside the receivable sync; `syncBookingReceivableInTx` uses `overrideCents ?? chargeCents` for cancelled bookings; `overridePenaltyInTx` reachable only through `PENALTY_OVERRIDE` approvals; `GET /admin/finance/penalties` (`finance.receivables.read`) + client list.
- **Credit limits.** `Partner.creditLimitCents?`, `creditLimitCurrency?`, `creditLimitMode CreditLimitMode @default(BLOCK)` (`{BLOCK, WARN}`). `services/finance/credit.service.js assertCreditInTx(tx, partnerId, {addCents, currency})` under `pg_advisory_xact_lock(hashtext('partner_credit:'‖id))`, summing open receivables in that currency; BLOCK → 422 `CREDIT_LIMIT_EXCEEDED {limit, outstanding, requested}`; WARN → audit `PARTNER_CREDIT_WARNING` + outbox notify finance. Called as the first statement in each confirm tx (hotel `:488`, tour `:355`, transfer `:412`, service `:278`, order `:479`) when `actor.partnerId`, with `addCents` from the ledger's `spec.buyerTotal`. `PATCH /admin/partners/:id/credit` (`partners.credit.write`, audited), `GET /partner/finance/credit`; client `PartnerCreditPanel` + portal balance card.
- Migrations `20261011300000_commission_penalty_credit_enum_values` / `…300100_commission_penalty_credit`. Tests: commission report sums; penalty entry on cancel + override via approval re-syncs receivable; credit BLOCK 422 / WARN 201 / concurrent confirms serialize.

---

## Phase G — Contract gate, statuses, product access · ~6–7 days

- **Fields on Partner:** `contractAssetId? @unique`, `contractSignedAt?`, `contractVersion?`, `contractUploadedByUserId?`, `termsVersion?`, `termsAcceptedAt?`, `termsAcceptedByUserId?`, `contractRequired Boolean @default(true)`, `blockedAt/By/Reason`, `terminatedAt/By/Reason`. `20261011400000_partner_contract_enum_values` (`PartnerStatus` + `BLOCKED, TERMINATED`; AuditAction `PARTNER_CONTRACT_UPLOADED, PARTNER_TERMS_ACCEPTED, PARTNER_BLOCKED, PARTNER_UNBLOCKED, PARTNER_TERMINATED, PARTNER_PRODUCT_ACCESS_CHANGED, PARTNER_CREDIT_LIMIT_CHANGED`) · `…400100_partner_contract` with grandfather `UPDATE partners SET contract_required=false WHERE status='APPROVED'`.
- **Config:** `PARTNER_TERMS_VERSION`, `PARTNER_TERMS_URL` (`config.partners`).
- **Registration:** `registrationSchema` + `terms:{accepted:literal(true), version}`; `acceptInvitation` → 400 `TERMS_VERSION_STALE` unless current; stamps terms fields. Wizard step 5 “Terms”. Re-acceptance: `requireApprovedPartner`/`rejectUnapprovedPartner` → 403 `TERMS_OUTDATED` for partner users when `termsVersion !== current`; `POST /partner/terms/accept` (`partner.terms.accept`); portal `/portal/terms` page.
- **Contract:** `POST /admin/partners/:id/contract` (multipart, `partners.contract.write`) → `uploadFile({category:'CONTRACT', partnerId})` + partner update + audit; `GET /admin/partners/:id/contract` and `GET /partner/contract` → `issueSignedUrl`. `assertReadyForApproval`: when `contractRequired` → `CONTRACT_MISSING` / `TERMS_NOT_ACCEPTED`. `adminCreatePartner` mode `approve` requires `contractAssetId` + `contractSignedAt` (asset uploaded first via `/admin/media`; service re-parents it).
- **Login:** `auth.service.js login` refuses `BLOCKED`, `TERMINATED`, `REJECTED` partner users (403 after password check, audited); PENDING/SUSPENDED still sign in to the explanatory portal page (bookings already closed by `rejectUnapprovedPartner`).
- **Transitions:** `block {APPROVED,SUSPENDED→BLOCKED}`, `unblock {BLOCKED→APPROVED}`, `terminate {any but TERMINATED→TERMINATED}`; effects under the partner advisory lock: revoke sessions (+ drivers); TERMINATED also `users.isActive=false`, spends tokens, expires invitations. `deletePartner` → 409 `USE_TERMINATE` when any booking/receivable/payable exists. `requireDriver` provider status list gains both.
- **Product access:** `PartnerProductAccess { partnerId; productType PricingProductType; productId; mode AccessMode {ALLOW, DENY}; note?; createdByUserId?; @@unique([partnerId,productType,productId]) }`. Policy: default everything; DENY always excludes; ≥1 ALLOW row for a type makes that type allow-list. `services/partner/access.service.js accessFor(viewer,type)` → `{allow|null, deny}`; plug into `hotel/providers/manual.js:113-130` (intersect `hotelIds`, add `NOT (h.id = ANY($deny))`), `tour/candidate.service.js:153-157`, `transfer/vehicle.service.js visibilityScope`, packages/services `buildWhere`, and each `prepare*` (hold/quote by token). `GET/PUT /admin/partners/:id/product-access` (replace-all, audited `{added,removed}`).
- Client: `PartnerContractPanel` (modelled on `PartnerTermsPanel`), `PartnerProductAccessPanel`, `PartnerActions` CAN table + block/unblock/terminate (typed confirmation), portal status copy for BLOCKED/TERMINATED, wizard step, `/portal/terms`.
- Tests: `partners.registration.test.js` (stale/missing terms 400), `partners.approval.test.js` (approve without contract 400; grandfathered partner approves), `partners.access.test.js` (BLOCKED/TERMINATED login 403; terminate deactivates users; delete refused), `partners.productAccess.test.js` (denied hotel absent from search and 409 on hold; allow-list), `auth.test.js` TERMS_OUTDATED.

---

## Phase H — Cleanup · ~2 days

`20261011900000_rbac_drop_user_role`: `User.primaryRoleId` FK (backfilled), drop `users.role`, drop enum `role` and the CHECK (trigger remains). Client `Role` string cleanup, `AdminShell` labels from `roles.name`, help articles updated (`getting-started/roles.ts`, `people/staff.ts`), `API.md`, `API_TESTING_GUIDE.md`, Postman folders (06n, new 06p approvals, 06q roles), `seed-b2b-demo.js` demo accounts for the new roles, memory/plan status.

---

## Client cross-cutting (done inside D–G)

`components/auth/Can.tsx` (async server component) + `CanClient.tsx`/`useCan()` via `AdminViewerContext` (+ new `PortalViewerContext`); `lib/auth/session.ts requireAdminPage(href)` resolving the capability from `adminNavigation` and redirecting, applied on every `app/[locale]/(admin)/admin/(panel)/**/page.tsx`; write controls wrapped in `<Can>` across hotels, tours, transfers, services, packages, destinations, bookings, dispatch, fleet, drivers, partners (closes the “read-only roles see every button” follow-up). Client tests in `client/test/`: `can.test.ts`, page→capability mapping test, approval state table.

---

## Verification

Per phase: hand-check each migration (`npm run prisma:migrate` on the dev DB, inspect SQL, strip geo-index drops), `node --env-file=.env.test --test --test-force-exit "test/*.test.js"` (wait ≥70 s between runs — limiter), regenerate the RBAC matrix **only** in the designated commits (C5 identical; D1 rename-only; D6 re-baseline) and review the fixture diff as the privilege-change artefact; client `tsc`, lint, `node --test`, `next build`. End-to-end on the dev DB with `scripts/seed-b2b-demo.js` (extended with ACCOUNTANT/TOUR_OPERATOR/FINANCE_OPERATOR accounts): tour operator edits a tour and is refused on a hotel rate (422/403), cancels a booking; accountant requests a refund, super admin approves, payment appears with `approvalId`; partner admin cannot invite a finance user; new partner registers with terms, cannot be approved without a contract, is approved after upload; blocked partner cannot sign in; denied hotel invisible to one partner; credit-limited partner blocked on the booking that exceeds the limit. Postman folders 06n/06p/06q run via newman. Deploy: `prisma:deploy` before the server rollout; all migrations are additive until Phase H, so the previous server version keeps running during the roll.

## Effort and order

A (4–5, now) → [Phase 3 commit] → B (1.5) → C (5–6) → D (7–8) → E (5–6) → F (4–5) → G (6–7, needs only C/D) → H (2). ≈ 36–41 engineer-days. G can run in parallel with E–F by a second engineer.

## Open items for the owner (defaults applied unless told otherwise)

1. TOUR_OPERATOR also edits transfer/service catalogue? (default no: `tours.write` + dispatch only)
2. Who should hold `*.execute` to bypass approvals? (default nobody; grant by override with reason)
3. Contract = uploaded signed PDF (default) vs e-signature.
4. Grandfather existing APPROVED partners (default yes).

## Status — 2026-10-11

| Phase | Server | Client | Commits |
|---|---|---|---|
| A security fixes | done | done | `8514047` |
| B finance integrity | done | — | `f6fe8b4` |
| C roles as data | done | — | `66b7df5` |
| D rename, split, role editor | done | done | `19a16d0`, `0604a37`, `c2a3102` |
| E approval requests | done | done | `ce8d03e`, `dcab2ab` |
| F commission, penalties, credit | done | done | `b7bb47d`, `2bbecc2` |
| G contract, terms, statuses, product access | done | done | `e1516a8`, `13ae557` |
| H drop `users.role` | done (primary role is a reference into `roles`; any role may be primary) | labels only | — |

Deviations from the plan, all deliberate: a REJECTED partner may still sign in (the portal explains the decision; BLOCKED and TERMINATED are refused at sign-in); the terms gate is enforced at portal use rather than at approval, so an admin-created company is approved on its contract and accepts the terms on its first visit; approval requests for penalties use the kind `PENALTY_OVERRIDE` (no separate `WRITE_OFF` kind — waivers are `PAYABLE_WAIVE` / `RECEIVABLE_WAIVE`); product access gates a package as a package, not its components.

Left: Postman folders for the new routes (the collection is being edited by the notifications work); the finance help articles for approvals and credit are written but registered in a file that work also edits; the admin shell's role labels still come from a client table rather than `roles.name`.
