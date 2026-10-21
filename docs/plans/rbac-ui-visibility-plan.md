# Role-aware panel: audit and implementation plan

Date 2026-10-15 · Branch `feat/b2b-phase-0-hardening` at `253037d` · Status: **approved 2026-10-15 with D1–D3 at their defaults; implemented, uncommitted**

Scope: make every staff member see only the screens, widgets and actions their capabilities open, without weakening or duplicating the server-side authorization that already exists. Companion documents: `docs/plans/rbac-finance-partner-plan.md` (roles-as-data, approvals, already shipped) and `docs/security-testing/02-vulnerability-assessment.md` (server findings, separate remediation).

---

## 1. Current-state audit

### 1.1 What exists and is sound

**Authorization model (server).** One capability table, `server/lib/permissions.js`, with 58 `area.verb` capabilities. Roles live in the database (`roles`, `role_capabilities`, `user_roles`, `user_capability_overrides`), seeded from `DEFAULT_ROLE_LISTS`, editable at `/admin/roles`. `authenticate` resolves `req.user.capabilities` once per request (`services/rbac/access.js`), so a role edit or an override applies on the next request with no session to revoke. Seven staff roles: SUPER_ADMIN, ADMIN, MANAGEMENT, TOUR_OPERATOR, ACCOUNTANT, FINANCE_OPERATOR, DISPATCHER; plus DRIVER and four PARTNER_* roles.

**Route enforcement.** Every `/admin/*` router mounts `authenticate` plus `requireCapability` or `requireCapabilityByMethod({read, write})`; priced fields need `requireFieldsCapability`; the public booking routers refuse staff writes without `bookings.write|cancel` (`rejectUnapprovedPartner`). The RBAC matrix test pins 462 routes × 13 callers (`server/test/fixtures/rbac-matrix.json`). Reach counts today: SUPER_ADMIN 422, ADMIN 386, TOUR_OPERATOR 213, ACCOUNTANT 161, MANAGEMENT 158, DISPATCHER 146, FINANCE_OPERATOR 137. MANAGEMENT reaches no admin write route; FINANCE_OPERATOR reaches only finance and approval writes; ACCOUNTANT reaches only finance, terms and credit writes. Serializers withhold margin (`canViewMargin`), buyer (`canViewBuyer`), bank details (`canViewFinancial`) and net rates by capability.

**Client foundations.** `/api/auth/me` serves `capabilities[]`; `can(viewer, ...anyOf)` in `client/types/auth.ts`; `navigationFor(capabilities)` in `client/lib/admin/navigation.ts` already filters items, drops empty sub-groups and groups; the panel layout guards sign-in (`requireAdminSession`); every Finance, Roles, Staff and Audit page checks its capability server-side and threads `canWrite`/`canEdit` props to its action components; `AdminViewerContext` exposes the session user to client components; `lib/admin/rbacErrors.ts` maps the server's `details.reason`. The sidebar is rendered from the server session, so there is no flash of restricted items.

### 1.2 What is wrong

**A. The sidebar is still generic because `BACK_OFFICE = catalogue.write | bookings.read`.** Every Inventory item (Destinations, Hotels, Routes, Pick-up points, Vehicle classes, Extras, Tours, Packages, Services) is offered to anyone with `bookings.read`, which is every staff role except DISPATCHER. An ACCOUNTANT or FINANCE_OPERATOR therefore sees 20+ sidebar entries: six operations items, nine inventory items, Partners and Applications, then Finance. A TOUR_OPERATOR sees the whole catalogue with "Add property" buttons it cannot use.

**B. Non-finance pages have no capability check and no read-only mode.** 62 of 90 panel pages contain no `can(` call. They render for anyone with `catalogue.read` because the API read succeeds, and they mount write controls unconditionally: `BookingActions` (cancel), `TourBookingActions`, `OrderActions`, `LegActions`/`AssignDriverModal`, `HotelActions` (publish/archive/delete), `TourActions`, `PackageActions`, `ServiceActions`, `PartnerActions` (approve/reject/suspend), `DriverVerification`, `RoomsManager`, `CalendarManager`, `TransferPriceGrid`, `TransferBulkPricer`, every `*DangerZone`, and the eleven "Add …" header buttons. MANAGEMENT (read-only by design) sees every one of them and gets a 403 toast on click. The server refuses correctly; the UI promises what it cannot deliver.

**C. One dashboard for everyone.** `(panel)/page.tsx` shows the same five tiles and three panels to every `bookings.read` holder, hard-codes the ADMIN quick-start card, and redirects everyone else to Dispatch. A finance operator lands on hotel arrivals and partner applications; the finance figures are a separate screen.

**D. Hard-coded role names remain in the client.** `isAdmin()` / `ADMIN_ROLES` gate the driver and fleet delete buttons (should be `platform.admin`); `session.user.role === "DISPATCHER"` picks the dispatch quick-start; `ROLE_LABELS` in `AdminShell` and `staffRoleLabels` are static maps (a custom role shows its raw key); the `Role` type is a closed union although custom roles can be primary; `InviteUserModal` offers the hard-coded `STAFF_INVITE_ROLES` rather than the roles that exist; the help system knows two roles (`HelpRole = "ADMIN" | "DISPATCHER"`) and `helpRoleOf` maps every other role to ADMIN, so a finance operator's manual leads with "Create a hotel".

**E. Deep links are not denied.** A URL typed by hand opens any page the API will read; there is no access-denied screen, only redirects to `/admin` on the finance pages and nothing elsewhere. The panel's 403 handling is the generic error boundary.

**F. Server exposures that belong to this work** (the broader list is in `docs/security-testing/`):
- SRV-1 `serializers/partner.js toPartnerDetail` sends `commissionRateBps`, `creditLimitCents`, `creditLimitCurrency`, `creditLimitMode` to every `partners.read` holder. Commission is gated for *writing* by `finance.commission.write` and for the report by `finance.commission.read`, but the figure itself reaches TOUR_OPERATOR and FINANCE_OPERATOR on `GET /admin/partners/:id`.
- SRV-2 `GET /admin/bookings/summary` (booked value by currency, last N days) needs only `bookings.read`. It is sell-side money, not margin, so it is defensible; the owner should decide (D1 below).
- SRV-3 (portal) `PortalBookingEditor` and the cancel flows render for PARTNER_FINANCE, which holds no `partner.bookings.write|cancel`; the server refuses, the UI does not know.

**G. Secondary surfaces.** The header search box is presentational (no index, nothing to leak). Quick actions exist only as the "Add …" buttons and the quick-start card. The help hub's categories and articles carry `roles: ["ADMIN" | "DISPATCHER"]` on 120 files.

---

## 2. Role-permission matrix (as seeded today, unchanged by this plan)

Rows are capability groups; cells show which seeded roles hold them. SA = SUPER_ADMIN (holds everything computed except `partner.*` and the two `*.execute` caps). Custom roles hold whatever the role editor gives them; the UI must follow the capability, never the key.

| Module / capability | ADMIN | MANAGEMENT | TOUR_OPERATOR | ACCOUNTANT | FINANCE_OPERATOR | DISPATCHER |
|---|---|---|---|---|---|---|
| **Reservations** `bookings.read` | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `bookings.write` (confirm, amend, create) | ✓ | – | ✓ | – | – | – |
| `bookings.cancel` | ✓ | – | ✓ | – | – | – |
| **Operations** `dispatch.read` | ✓ | ✓ | ✓ | – | – | ✓ |
| `dispatch.write` (assign, fleet, drivers) | ✓ | – | ✓ | – | – | ✓ |
| `catalogue.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `catalogue.write` (all products, media) | ✓ | – | – | – | – | – |
| `tours.write` | ✓ | – | ✓ | – | – | – |
| `pricing.write` (hotel rates, plans, taxes, rules) | ✓ | – | – | – | – | – |
| **Partners** `partners.read` | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `partners.write` (approve, edit, suspend) | ✓ | – | – | – | – | – |
| `partners.financial.read` (bank details) | ✓ | – | – | ✓ | – | – |
| `partners.contract.write` / `partners.access.write` | ✓ | – | – | – | – | – |
| `partners.credit.write` | ✓ | – | – | ✓ | – | – |
| `finance.commission.write` | ✓ | – | – | ✓ | – | – |
| **Finance** `finance.payables.read` / `receivables.read` / `payments.read` | ✓ | ✓ | – | ✓ | ✓ | – |
| `finance.margin.read` | ✓ | ✓ | – | ✓ | – | – |
| `finance.reports.read` / `finance.export` / `finance.commission.read` | ✓ | ✓ | – | ✓ | – | – |
| `invoices.read` | ✓ | ✓ | – | ✓ | – | – |
| `finance.payments.write` | – | – | – | ✓ | ✓ | – |
| `finance.terms.write` / `invoices.write` | – | – | – | ✓ | – | – |
| `finance.notes.write`, `finance.refunds.request`, `finance.adjustments.request` | – | – | – | ✓ | ✓ | – |
| `finance.refunds.approve` / `finance.adjustments.approve` | – | – | – | – | – | – |
| `finance.*.execute` (bypass approval) | nobody by default | | | | | |
| **Administration** `users.staff.manage`, `roles.manage`, `settings.write` | – | – | – | – | – | – |
| `audit.read` | ✓ | ✓ | – | ✓ | – | – |
| `platform.admin` (hard deletes, outbox retry) | ✓ | – | – | – | – | – |
| `notifications.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Mapping to the brief's examples: Reservations Manager = TOUR_OPERATOR, Finance Manager = ACCOUNTANT (FINANCE_OPERATOR is the narrower desk), Top Management = MANAGEMENT. No capability is added, removed or re-seeded by this plan; two checks are *tightened* on the server (§4, SRV-1 and, if the owner agrees, SRV-2).

---

## 3. UI visibility matrix (target)

Principle: **a screen is offered when the viewer can do that screen's job.** Registers, queues, boards and reports are offered on their *read* capability; maintenance screens (catalogue editors, fleet editors, partner applications) on the *write* capability that makes them useful. A read-only role can still open a maintenance screen by link and sees it in read-only mode. Every cell is derived from capabilities, so a custom role falls out of the same table.

### 3.1 Sidebar

| Screen | Capability (any of) | ADMIN | MGMT | TOUR_OP | ACCT | FIN_OP | DISP | Change from today |
|---|---|---|---|---|---|---|---|---|
| Overview `/admin` | *(every staff; content adapts)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | DISPATCHER gains a personalised overview instead of a redirect |
| Hotel bookings | `bookings.read` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| Transfer bookings | `bookings.read`, `dispatch.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| Tour bookings, Orders | `bookings.read` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| Dispatch | `dispatch.read` | ✓ | ✓ | ✓ | – | – | ✓ | – |
| Destinations | `catalogue.write` | ✓ | – | – | – | – | – | hidden from MGMT, TOUR_OP, ACCT, FIN_OP |
| Hotels | `catalogue.write`, `pricing.write`, `bookings.write` | ✓ | – | ✓ | – | – | – | hidden from MGMT, ACCT, FIN_OP (desk keeps it for availability look-ups) |
| Transfers › Routes, Pick-up points, Vehicle classes, Extras | `catalogue.write`, `pricing.write` | ✓ | – | – | – | – | – | hidden from MGMT, TOUR_OP, ACCT, FIN_OP |
| Transfers › Fleet, Drivers | `dispatch.write` | ✓ | – | ✓ | – | – | ✓ | hidden from MGMT (kept reachable by link) |
| Transfers › Schedule, Ratings | `dispatch.read` | ✓ | ✓ | ✓ | – | – | ✓ | – |
| Tours | `catalogue.write`, `tours.write` | ✓ | – | ✓ | – | – | – | hidden from MGMT, ACCT, FIN_OP |
| Packages, Services | `catalogue.write` | ✓ | – | – | – | – | – | hidden from MGMT, TOUR_OP, ACCT, FIN_OP |
| Partners | `partners.read` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| Applications | `partners.write` | ✓ | – | – | – | – | – | hidden from MGMT, TOUR_OP, ACCT, FIN_OP (queue needs the decision right) |
| Finance overview, Payables | `finance.payables.read` | ✓ | ✓ | – | ✓ | ✓ | – | – |
| Receivables, Penalties | `finance.receivables.read` | ✓ | ✓ | – | ✓ | ✓ | – | – |
| Payments | `finance.payments.read` | ✓ | ✓ | – | ✓ | ✓ | – | – |
| Invoices | `invoices.read` | ✓ | ✓ | – | ✓ | – | – | – |
| Approvals | request/approve caps | – | – | – | ✓ | ✓ | – | – |
| Reports | `finance.reports.read` | ✓ | ✓ | – | ✓ | – | – | – |
| Staff, Roles | `users.staff.manage`, `roles.manage` | – | – | – | – | – | – | – |
| Audit log | `audit.read` | ✓ | ✓ | – | ✓ | – | – | – |
| Help | *(everyone)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | content filtered by what the viewer can open |

Resulting sidebar sizes: ADMIN 30 items, MANAGEMENT 17, TOUR_OPERATOR 14, ACCOUNTANT 14, FINANCE_OPERATOR 12, DISPATCHER 8 (today: 30 / 22 / 24 / 22 / 20 / 8).

**Group order and landing page follow the viewer.** Groups are ordered so the first group containing a screen the viewer can *write to* comes first: Finance leads for ACCOUNTANT and FINANCE_OPERATOR, Operations for TOUR_OPERATOR, ADMIN and DISPATCHER, the default order for MANAGEMENT. `landingFor(capabilities)` = the first offered screen; the sign-in redirect and the Overview's "start of day" link use it.

### 3.2 Dashboard widgets (Overview)

Each widget declares the capability that both shows it and permits its request; nothing is fetched for a hidden widget. Widgets are grouped as **Needs a decision** (queues the viewer can act on) and **Watch** (read-only figures), in that order.

| Widget | Shown when | ADMIN | MGMT | TOUR_OP | ACCT | FIN_OP | DISP |
|---|---|---|---|---|---|---|---|
| Pending tour requests / pending orders (counts + list) | `bookings.write` | ✓ | – | ✓ | – | – | – |
| Legs without a driver (next 7 days) | `dispatch.write` | ✓ | – | ✓ | – | – | ✓ |
| Partner applications queue | `partners.write` | ✓ | – | – | – | – | – |
| Supplier payments due this week (+ pay) | `finance.payables.read` (+ `payments.write` for the button) | ✓ | ✓ | – | ✓ | ✓ | – |
| Overdue receivables | `finance.receivables.read` | ✓ | ✓ | – | ✓ | ✓ | – |
| Approvals waiting for me | approve caps | – | – | – | – | – | – |
| Invoices in ERROR | `invoices.read` | ✓ | ✓ | – | ✓ | – | – |
| Active bookings, arriving next, latest bookings | `bookings.read` | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| Booked value, last 30 days | **D1**: `bookings.read` (today) or `finance.reports.read` | ✓ | ✓ | D1 | ✓ | D1 | – |
| Revenue / margin per currency (from finance summary) | `finance.reports.read` | ✓ | ✓ | – | ✓ | – | – |
| Dispatch board figures (legs today, offered, accepted) | `dispatch.read` | ✓ | ✓ | ✓ | – | – | ✓ |
| Quick-start checklist | steps filtered by capability | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### 3.3 Actions and controls on pages

| Control | Capability | Behaviour without it |
|---|---|---|
| "Add property / destination / tour / package / service / route / point / class" | `catalogue.write` (`tours.write` for tours) | not rendered |
| "Add driver / Add car", driver and fleet editors, verification decisions | `dispatch.write` | editors render read-only; decisions hidden |
| Hard delete of a driver, car or media (`DangerZone`s using `isAdmin`) | `platform.admin` | not rendered |
| Cancel a hotel / transfer / tour / order / service booking | `bookings.cancel` | status shown, no button, one-line note "Cancelling needs Bookings: cancel" |
| Confirm/decline requests, amend a booking | `bookings.write` | hidden |
| Assign / reassign a driver, release a leg | `dispatch.write` | hidden |
| Publish, unpublish, archive, delete a product; edit forms | `catalogue.write` (or `tours.write` for tours) | forms read-only (inputs disabled, no Save) |
| Rooms & rates, Inventory & pricing calendar, transfer price grid, bulk pricer, pricing rules, rate plans, taxes, policies | `pricing.write` | tables render read-only; the hotel hub tile says "view" |
| Approve / reject / suspend / block / terminate a partner, edit profile | `partners.write` | hidden |
| Commission field | `finance.commission.write` | read-only field (server already refuses) |
| Credit limit, contract, product access panels | their existing caps (done) | – |
| Partner bank details panel | `partners.financial.read` (done server-side) | not rendered |
| Role dropdown in Invite staff | from `GET /admin/users/:id/grantable`-style data | roles the viewer may hand out, custom included |
| Portal: make / amend / cancel a booking | `partner.bookings.write` / `partner.bookings.cancel` | hidden; PARTNER_FINANCE sees records only |

---

## 4. Security gap analysis

| ID | Severity | Finding | Fix (phase) |
|---|---|---|---|
| SRV-1 | Medium | `toPartnerDetail` exposes commission rate and credit limit to any `partners.read` holder (TOUR_OPERATOR, FINANCE_OPERATOR). | Attach `commissionRateBps` only for `finance.commission.read|write`, credit fields only for `partners.credit.write|finance.receivables.read`; absent, not null. Client `PartnerCreditPanel`/commission field already tolerate absence. Test in `partners.financial.test.js`. (Phase 0) |
| SRV-2 | Low / decision | Booked-value aggregate reachable on `bookings.read`. | **D1.** If the owner wants it finance-only: `requireCapability(FINANCE_REPORTS_READ)` on `/admin/bookings/summary`, matrix re-baselined (one row), dashboard tile follows. (Phase 0) |
| UI-1 | Medium (UX, not a boundary) | 62 pages render write controls to read-only roles; every click fails with 403. | `useCan`/`can(session)` on every control listed in §3.3. (Phase 3) |
| UI-2 | Medium | No deny-by-default for deep links; a new page is reachable by anyone with `catalogue.read` until someone remembers a check. | Central screen table + guard in the panel layout; unknown path ⇒ denied. (Phase 1) |
| UI-3 | Low | `isAdmin()`/`ADMIN_ROLES`, `role === "DISPATCHER"`, static role labels, closed `Role` type, hard-coded invite roles, two-role help model. | Replace with capability checks and `roles[].name`; widen types. (Phases 1, 5) |
| UI-4 | Low | Dashboard fetches partner applications and booking lists for roles that do not act on them; finance figures live on another screen. | Widget registry gated per capability. (Phase 4) |
| UI-5 | Low | Portal booking editors rendered to PARTNER_FINANCE. | Gate on `partner.bookings.*`. (Phase 5) |
| UI-6 | Info | Permission changes: server applies them on the next request; the client shell re-reads `/me` on every server render, but a long-lived client component keeps the old `capabilities` until navigation. | On any 403 `INSUFFICIENT_CAPABILITY` from a client action, call `router.refresh()` so the sidebar and buttons re-sync; show the capability name in the message. (Phase 1) |

Cross-tenant scoping, hold flooding, PKG-01 and the other server findings are tracked in `docs/security-testing/09-remediation-roadmap.md` and are not re-opened here.

---

## 5. Implementation plan

Estimated 9–11 engineer-days, six phases, each independently shippable. No migration, no new capability, no Postman change except where D1 changes one route.

### Phase 0 — Server tightening (0.5 day)
- SRV-1 in `serializers/partner.js`; test.
- D1 if approved: guard on the summary route; `RBAC_MATRIX_UPDATE=1` re-baseline, review the one-row diff.
- Checkpoint: `node --env-file=.env.test --test` green; matrix diff reviewed.

### Phase 1 — Access foundation in the client (2 days)
- **Screen table.** `client/lib/admin/access.ts`: `SCREENS: ScreenRule[]` with `{ pattern, capability }` for every panel route, listed screens generated from `adminNavigation` and detail/new/sub-screens declared explicitly (e.g. `/admin/hotels/:id/rooms` → `catalogue.read`; `/admin/users/:id` → `users.staff.manage`). Exports `screenFor(pathname)`, `canOpenPath(capabilities, pathname)`, `landingFor(capabilities)`, `requiredFor(pathname)`.
- **Central guard.** `proxy.ts` sets `x-pathname` on panel requests (it already handles every request for locale routing); `(panel)/layout.tsx` reads `headers()` and, when `canOpenPath` is false or the path is unknown, redirects to `/admin/denied?for=<path>`. Pages keep their own `can()` for *content* decisions; the layout decides *entry*. A page not in the table is denied: deny-by-default for everything added later. Fallback if `headers()` proves unreliable for a route: a one-line `await requireScreen()` at the top of each page (same table, same behaviour).
- **Denied screen.** `(panel)/denied/page.tsx` inside the shell: "This screen needs *Catalogue: edit*" via `capabilityLabel`, links to the viewer's landing page and to Help › Roles.
- **Hooks and helpers.** `useCan(...anyOf)` on `AdminViewerContext`; `requireCapabilities(...anyOf)` in `lib/auth/session.ts` (redirects to `/admin/denied`); `homePathFor` → `landingFor` for staff; `isAdmin`/`ADMIN_ROLES` removed in favour of `can(viewer, "platform.admin")`; `Role` type widened to `string` with a `SystemRole` union kept for the seeded keys; `roleLabel` falls back to `user.roles[0].name`.
- **403 handling.** `describeError` recognises `INSUFFICIENT_CAPABILITY` and names the capability; a shared `onForbidden(router)` calls `router.refresh()`.
- Checkpoint: typecheck, lint, existing 25 client tests; new `test/access-screens.test.ts` asserts every `page.tsx` under `(panel)` resolves to a screen rule (mirrors `help-registry.test.ts`).

### Phase 2 — Navigation (1 day)
- Per-item capabilities per §3.1; delete `BACK_OFFICE`.
- `navigationFor` returns groups ordered by "first writable group" (`groupOrderFor(capabilities)`); landing = first item.
- Overview item has no capability; the Overview page no longer redirects dispatchers.
- `AdminShell` shows `user.roles.map(r => r.name)` instead of `ROLE_LABELS`.
- `adminScreenLabel` (loading skeleton) unchanged; sub-group captions and dividers already collapse correctly.
- Checkpoint: `test/navigation-access.test.ts` with a fixture of the seeded role→capability lists (`client/test/fixtures/role-capabilities.json`, generated by `server/scripts/print-role-capabilities.js` and asserted in sync by a server unit test) — expected item set per role, no empty groups, no item without a capability except Overview and Help, landing per role.

### Phase 3 — Page guards, read-only modes and actions (3 days)
- Pass `can` flags from server pages or call `useCan` in the client components listed in §3.3. Pattern already used by the finance pages (`canWrite`, `canEdit`).
- Read-only mode for editors: `RoomsManager`, `CalendarManager`, `TransferPriceGrid`, `TransferBulkPricer`, `TransferRouteEditor`, `HotelDetailsEditor`, `TourDetailsEditor`, `PackageDetailsEditor`, `ServiceEditor`, `DriverEditor`, `FleetVehicleEditor`, `TransferVehicleEditor`, `DestinationForm`: a `readOnly` prop disables inputs and hides Save/Delete; a short note names the capability.
- Hide the eleven "Add …" buttons without the write capability; hotel hub tiles say "View" instead of "Edit" where appropriate.
- `*DangerZone` on `platform.admin`.
- Checkpoint: per-role browser walk (§7.3) shows no write control for MANAGEMENT anywhere; no 403 in the network log for any role on any offered screen.

### Phase 4 — Dashboard personalisation (1.5 days)
- `client/lib/admin/dashboard.ts`: `DASHBOARD_WIDGETS: Widget[]` with `{ id, section: "decide" | "watch", capability, load(session), render }`. The Overview filters by `can`, runs the permitted loaders in one `Promise.all`, renders sections in order; an empty "decide" section is omitted. Widgets from §3.2; reuse `PaymentsDuePanel`, `FinanceOverviewReceivables`, `FinanceOverviewCurrency`, `getAdminBadges` counts, `listDispatchLegs`, `listApprovals`, `listInvoices({status:"ERROR"})`.
- Quick-start: `quickStartFor(capabilities)` filters steps by a `capability` field; title derived from the steps present.
- Greeting unchanged; the page title stays "Overview".
- Checkpoint: `test/dashboard-widgets.test.ts` — widget set per seeded role; no widget whose loader would call an endpoint the role cannot reach (cross-check against the RBAC fixture by endpoint path).

### Phase 5 — Secondary surfaces (1.5 days)
- **Help**: article and category visibility derived from their `routes` via `canOpenPath`; articles without routes stay visible; `HelpRole` and `helpRoleOf` removed; `ContextualHelpButton` and the hub filter through the same function. The 120 `roles:` fields become dead data and are removed in the same commit (mechanical).
- **Invite staff**: role options from the server (`/admin/users/:id/grantable` already exists for edits; add `GET /admin/users/grantable` for the actor, same service call) so custom roles can be invited and SUPER_ADMIN stays excluded by the server rule.
- **Portal**: `PortalBookingsBrowser`, `PortalBookingEditor`, `PortalTourBookingEditor`, `PortalTransferBooking`, the dashboard's "new booking" link — gated on `partner.bookings.write|cancel`.
- **Search**: the header input stays presentational; `docs` note that any future index must filter results through `canOpenPath`.
- **Notifications bell**: unchanged (viewer's own rows).

### Phase 6 — Verification and docs (1 day)
- Playwright per-role walk (§7.3) committed under `qa/` beside the existing harness; `client/README` and `server/API.md` "Users, roles and capabilities" gain a "What each role sees" section pointing at `access.ts`; help article `gs-roles` updated; `docs/plans/rbac-ui-visibility-plan.md` status table filled in.

---

## 6. File-level change plan

**Server (modify):** `serializers/partner.js` · `routes/hotels.bookings.routes.js` (D1 only) · `test/partners.financial.test.js` · `test/fixtures/rbac-matrix.json` (D1 only) · `routes/admin.users.routes.js` + `services/rbac/grant.service.js` (actor-level grantable) · `API.md`.
**Server (new):** `scripts/print-role-capabilities.js` · `test/rbac.fixture-sync.unit.test.js`.

**Client (new):** `lib/admin/access.ts` · `lib/admin/dashboard.ts` · `app/[locale]/(admin)/admin/(panel)/denied/page.tsx` · `components/admin/AccessDenied.tsx` · `components/admin/ReadOnlyNote.tsx` · `components/admin/dashboard/*` (one file per widget that is not already a reusable panel) · `test/access-screens.test.ts` · `test/navigation-access.test.ts` · `test/dashboard-widgets.test.ts` · `test/fixtures/role-capabilities.json` · `qa/rbac-walk.mjs`.

**Client (modify):**
- Foundation: `proxy.ts` · `app/[locale]/(admin)/admin/(panel)/layout.tsx` · `lib/auth/session.ts` · `types/auth.ts` · `types/partner.ts` (Role) · `types/user.ts` · `lib/admin/users.ts` · `lib/api/client.ts` (403 wording) · `components/admin/AdminViewerContext.tsx` (`useCan`) · `components/admin/AdminShell.tsx` (role names).
- Navigation: `lib/admin/navigation.ts` · `components/admin/AdminSidebar.tsx` (group order only).
- Dashboard: `app/[locale]/(admin)/admin/(panel)/page.tsx` · `lib/admin/help/quickStart.ts` · `components/admin/help/QuickStartCard.tsx` · `app/.../transfers/dispatch/page.tsx` (drop the role check).
- Actions and read-only modes (pages pass flags, components accept them): `BookingActions`, `BookingRequests`, `TourBookingActions`, `OrderActions`, `OrderParts`, `LegActions`, `AssignDriverModal`, `DispatchBoard`, `RatingsQueue`, `HotelActions`, `TourActions`, `PackageActions`, `ServiceActions`, `PartnerActions`, `PartnerDangerZone`, `DriverVerification`, `DriverEditor`, `DriverDangerZone`, `FleetVehicleEditor`, `FleetVehicleDangerZone`, `TransferVehicleEditor`, `TransferVehicleDangerZone`, `TransferRouteEditor`, `TransferRouteDangerZone`, `TransferPointForm`, `TransferPointDangerZone`, `TransferExtrasEditor`, `TransferPriceGrid`, `TransferBulkPricer`, `TransferBlackouts`, `RoomsManager`, `CalendarManager`, `RoomGalleries`, `GalleryManager`, `HotelDetailsEditor`, `HotelLocationEditor`, `HotelKosherEditor`, `KosherCertifications`, `KosherDocuments`, `DocumentsPanel`, `TourDetailsEditor`, `TourOptionsManager`, `TourCalendarManager`, `TourGalleryManager`, `TourTranslationsEditor`, `PackageDetailsEditor`, `PackageComponentsBuilder`, `PackageGalleryManager`, `PackageKosherEditor`, `PackageTranslationsEditor`, `ServiceEditor`, `ServiceTranslationsEditor`, `ServiceDangerZone`, `DestinationForm`, `DestinationDangerZone`, `InviteUserModal`; and the pages under `bookings/`, `orders/`, `tours/`, `transfers/`, `hotels/`, `packages/`, `services/`, `destinations/`, `partners/` that mount them (≈45 page files, each a few lines: read `getSession`, compute flags, pass them).
- Help: `lib/admin/help/index.ts`, `types.ts`, `categories.ts`, `routes.ts`, `components/admin/help/ContextualHelpButton.tsx`, `HelpHub.tsx`, `HelpCategoryList.tsx`, the 120 article files (remove `roles`).
- Portal: `components/partners/PortalShell.tsx` (unchanged logic, uses shared helper), `PortalBookingsBrowser.tsx`, `PortalBookingEditor.tsx`, `PortalTourBookingEditor.tsx`, `PortalTransferBooking.tsx`, `app/[locale]/(portal)/portal/dashboard/page.tsx`, `bookings/[reference]/page.tsx`.

Nothing is deleted from the API; no route changes its path; no capability is renamed.

---

## 7. Testing strategy

### 7.1 Server (node:test + supertest, existing harness)
1. `partners.financial.test.js`: TOUR_OPERATOR and FINANCE_OPERATOR get no `commissionRateBps`/credit fields on `GET /admin/partners/:id`; ACCOUNTANT and ADMIN do (SRV-1).
2. `rbac.matrix.test.js`: unchanged unless D1; the diff is reviewed row by row as before.
3. `rbac.fixture-sync.unit.test.js`: `client/test/fixtures/role-capabilities.json` equals `DEFAULT_ROLE_LISTS` (fails CI when the seed changes without regenerating the client fixture).
4. Existing suites cover direct URL/API access, cross-company scoping (`partners.access`, `tours.access`, `users.admin` scope tests), approvals and finance writes; they are the regression net for "do not break existing workflows".

### 7.2 Client (node:test with the ts hook, `client/test`)
5. `access-screens.test.ts`: every `page.tsx` under `(panel)` matches exactly one screen rule; every rule names a capability or is on the allow-list (Overview, Help, Denied, Notifications).
6. `navigation-access.test.ts`: for each seeded role, the exact sidebar item set from §3.1; no empty group or sub-group; group order and `landingFor` per role; a capability-less custom role gets Overview and Help only; a role with a single finance capability gets exactly that screen.
7. `dashboard-widgets.test.ts`: widget set per role from §3.2; each widget's endpoint is REACHED for that role in the server fixture (read the JSON directly).
8. `help-registry.test.ts` extended: help visible to a role ⊆ screens that role can open.

### 7.3 Browser (Playwright via Edge, `qa/` harness; demo accounts from `scripts/seed-b2b-demo.js`)
9. For each of the six demo staff accounts and one custom role created through `/admin/roles`: sign in, snapshot the sidebar text (golden file per role), visit every screen in `SCREENS`; expect the denied page where `canOpenPath` is false and no network 403 where it is true; assert no element with `data-write-control` is present for MANAGEMENT; at 400 px and 768 px confirm the drawer renders the same item set.
10. Role change during a session: as SUPER_ADMIN deny `bookings.cancel` on the reservations demo user via an override; in the other session click Cancel → message names the capability, the sidebar and buttons re-sync after the automatic refresh; remove the override and confirm the reverse.
11. Session expiry: revoke the session row; the next navigation lands on sign-in, not on the denied page.
12. Regression: the existing Postman run (`newman`, 788 requests) and the finance browser walk from Phase 4 of the B2B plan.

Positive and negative cases are paired in 5–9 by construction: the same table says what must appear and what must not.

---

## 8. Risks and compatibility

- **Sidebar shrinks for MANAGEMENT, ACCOUNTANT, FINANCE_OPERATOR, TOUR_OPERATOR.** Deliberate, but staff who bookmarked Inventory screens keep deep-link access in read-only mode; the help hub explains the change. Reversible per item by editing one capability string.
- **Central guard via `proxy.ts` header.** If `headers()` is unavailable in a layout for some render mode, fall back to the explicit `requireScreen()` call per page (same table). Both paths are covered by test 5.
- **Deny-by-default means a forgotten rule blocks a new page.** That is the point; test 5 turns it into a CI failure rather than a production surprise.
- **Custom roles.** Widening `Role` to `string` touches type-only code; a few switch statements on role keys (status badges, labels) need a default branch. Covered by typecheck.
- **Help data change is wide but mechanical** (120 files lose a field). Keep it in its own commit.
- **D1** changes one API guard that the Postman folder 06 and the overview rely on; re-baseline the matrix and the Postman expectation together.
- **No partner-facing or guest-facing behaviour changes** except hiding write controls from PARTNER_FINANCE, which the server already refuses.
- **Peer sessions.** `AdminShell.tsx`, `navigation.ts` and `lib/api/admin.ts` have been edited by parallel sessions before; coordinate before Phase 2.

---

## Owner decisions needed before starting

- **D1** Booked-value tile and `GET /admin/bookings/summary`: keep on `bookings.read` (recommended: it is sell-side turnover the desks already see per booking) or restrict to `finance.reports.read`.
- **D2** Inventory screens hidden from MANAGEMENT's sidebar (recommended) or kept as read-only entries.
- **D3** Approve the group-order rule (first writable group leads) and the derived landing page, or keep the fixed order with Overview as everyone's landing.

Defaults applied if unanswered: D1 keep, D2 hide, D3 derived order.

## Status

Owner approved on 2026-10-15 with every decision at its recommended default: D1 keep the booked-value tile on `bookings.read`, D2 hide Inventory from read-only roles, D3 order groups by the first writable group.

| Phase | State |
|---|---|
| 0 Server tightening | Done. SRV-1: commission and credit fields gated in `serializers/partner.js`, test in `partners.financial.test.js`. D1 kept, so no guard change. New `GET /admin/users/grantable` for the invite form; matrix +1 route, nothing else changed. |
| 1 Foundation | Done. `lib/admin/access.ts` screen table; `requireScreen()` on all 90 panel pages via the `x-pathname` header stamped by `proxy.ts`; `/admin/denied`; `useCan()`; `isAdmin`/`ADMIN_ROLES` removed; `Role` type open to custom keys; capability-aware 403 wording in `describeError`. |
| 2 Navigation | Done. Per-item `capability` and `acts`, `BACK_OFFICE` removed, overview pinned first, groups ordered by what the viewer can act on, `landingFor`. Shell shows role names from the session. |
| 3 Read-only modes | Done across bookings, dispatch, fleet, drivers, partners, hotels, destinations, transfer catalogue, tours, packages and services, with `ReadOnlyNote`. |
| 4 Dashboard | Done. `lib/admin/dashboard.ts` widget registry, overview rewritten, quick start filtered by capability. |
| 5 Secondary surfaces | Done. Help readability derived from routes and the navigation (no more `roles` on 97 articles); invite form reads grantable roles; portal amend/cancel gated on `partner.bookings.*`. |
| 5b Role editor preview | Done. **What this role sees** on the new-role and edit-role screens, from the same navigation and dashboard tables. |
| 6 Verification | Client tests: `access-screens`, `navigation-access`, `dashboard-widgets`, help registry updated. Server: `rbac.fixture-sync.unit.test.js` keeps `client/test/fixtures/role-capabilities.json` in step. Playwright per-role walk not run in this session. |
