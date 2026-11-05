# Booking Management Programme: invoices, notifications, cart, deadlines, filters, manual bookings, approval

Branch: `feat/b2b-phase-0-hardening` at 253037d plus the uncommitted role-aware panel work (2026-10-15). Audit date: 2026-10-20. No code was changed while writing this plan. On approval, the first task copies this file to `docs/plans/booking-management-plan.md` so the status table lives with the code.

---

## Context

The owner's brief asks for seven improvements to the B2B platform: detailed invoice lines, a visible notification system, a unified cart, centralised deadlines with a calendar and reminders, advanced booking filters, admin-created bookings for unregistered customers, and an offline-payment approval workflow. The platform already has a mature finance module (Receivables, PaymentRecords, InvoiceOcean proformas and VAT invoices, supplier reminders, approvals), DB-backed RBAC with capabilities, a transactional outbox, and an Order/OrderItem model for packages. What it lacks is an approval step before confirmation, any way for staff to book on someone else's behalf, a cart, deadline records that can be queried, structured invoice lines, and list filters beyond status/date/search.

Three read-only audits (booking lifecycle and cart; finance, invoicing, notifications, reminders; admin tables, UI kit, shell) plus an architecture pass produced this plan. Every claim below was traced to a file.

### Owner decisions taken 2026-10-20 (do not re-ask)

| # | Decision | Consequence |
|---|---|---|
| OD1 | **Every booking waits for admin approval** (partner, guest, manual) once the feature ships. | `Partner.bookingApproval` column still exists (REQUIRED by default, every existing partner migrated to REQUIRED). `AUTO` is an admin-settable exception for later, never applied by migration. Rollout is gated by `BOOKING_APPROVAL_ENABLED`. |
| OD2 | **Packages inside the cart are flattened** into one CUSTOM order. | One Order, one OrderItem per booked service, `groupKey` ties package components together, one receivable, one proforma. |
| OD3 | **Manual bookings price from the catalogue plus an audited signed adjustment** behind a new capability `bookings.price.override`. | `priceAdjustmentCents/Reason` columns; room subtotals and cancellation schedules keep reconciling. |
| OD4 | **Invoice detail goes in the InvoiceOcean position `description`**, verified against the sandbox first; fallback is a multi-line position name. No own-PDF generator. | `InvoiceLine.detail Json` holds the structured data and its text rendering; the panel and portal render our own line table. |

Earlier decisions that still bind: partners settle per booking (one Receivable per booking/order); proforma at confirmation, VAT on full payment; per-partner due days with Finance override; reports per currency; roles and capability model from `docs/plans/rbac-finance-partner-plan.md`.

---

## 1. Executive summary

- **The backend already has the bones**: prepare/confirmInTx/cancelInTx per product, an Order orchestrator that commits several products in one transaction, a ledger that creates nothing while a booking is PENDING, an outbox with capability-scoped recipients, and InvoiceOcean issuing from `Receivable`. The programme extends these rather than adding a parallel system.
- **The single largest change is the lifecycle**: a new `PENDING_APPROVAL` status on hotel, transfer, tour, service and order (plus `AWAITING_APPROVAL` on order items). Approve = today's confirmation moment moved later; reject = cancel at zero charge. Inventory stays claimed while pending, exactly as ON_REQUEST tours do today.
- **Admin-created bookings reuse the public booking services** through an on-behalf actor shim (the buyer becomes the acting partner or a new `Customer` row), so pricing, credit limits, ledger, invoices and notifications all work unchanged.
- **The cart is `Order.kind = CUSTOM`**, which the schema reserved in September 2026 and nothing uses. `prepareOrder` is split into a package-group preparer and a custom-order preparer that reuses it.
- **Deadlines become a projection table** (`BookingDeadline`) fed from the real sources (Receivable.dueAt, frozen cancellation schedules, approval and supplier SLAs) so the calendar and reminders query one table while finance truth stays where it is.
- **Invoice lines get `kind`, `unitCents` and `detail Json`**; per-room and per-leg builders replace the one-line summary; tax is allocated with the existing largest-remainder helper so lines always sum to the receivable.
- **Filters get one shared server contract** and a maintained `booking_index` table (with a trigram index) that serves the cross-product list, the approvals queue and the dashboard.
- **Notifications gain category, dedupe key, server-side href, kind/category filters, a sidebar entry and 60-second polling.** No SSE in this programme.
- Ten additive migrations, four feature flags, rollback by flag then by `down.sql`.

---

## 2. Existing system audit (verified)

### 2.1 Booking models and lifecycle
- Tables: `HotelBooking` (BKG-), `TransferBooking` (TRF-, legs with `direction OUTBOUND|RETURN`, extras), `TourBooking` (TUR-), `ServiceBooking` (SVC-), `Order` (ORD-, `kind PACKAGE|CUSTOM`) + `OrderItem` (exactly one nullable child FK per product, CHECK `order_items_exactly_one_child`). `server/prisma/schema.prisma:2478, 4241, 1234, 1502, 1788, 1853`.
- Status enums for the four products: PENDING, CONFIRMED, CANCELLED, COMPLETED, NO_SHOW. Hotels and transfers are **always written CONFIRMED** (`server/services/hotel/booking.service.js:343`, `server/services/transfer/booking.service.js:269`). PENDING is written only for ON_REQUEST tours/services with a 48h `requestDeadlineAt` SLA and overdue sweepers. Order status is derived by `impliedOrderStatus` (`server/lib/order/machines.js:65-88`).
- Buyer identity always comes from the session: `partnerId: actor?.partnerId ?? null`, `bookedByUserId: actor?.id` (`hotel/booking.service.js:345-358`). No request schema accepts a buyer. `source` is a client-supplied string (`server/validation/booking.js:108`).
- Every booking stores lead name/email/phone, so an unregistered guest is already representable; there is no company, billing, tax id, assigned manager, internal notes or payment status column on any booking.
- Staff with `bookings.write` can already POST the public booking routes (`server/middleware/auth.js:502-511`); the result is a partner-less booking priced as a guest.
- Finance at confirm: `assertCreditInTx` → `confirmXInTx` (claims inventory, audit, outbox, `syncPayableInTx`) → `syncBookingReceivableInTx` (no-op while PENDING, `server/services/finance/ledger.service.js:508-513`; skipped for order children) → `createReceivable` → `onReceivableCreatedInTx` → proforma DRAFT → outbox `INVOICE_ISSUE_REQUESTED`.
- No PSP exists. "Payment" is Finance recording a `PaymentRecord` by hand (`server/services/finance/payment.service.js:385-410`). `Receivable.status` (OPEN/PARTIAL/PAID/VOID/WAIVED) is the de-facto payment status; no booking serializer exposes it. Overdue is computed (`dueAt < now`).

### 2.2 Cart and checkout
- No cart. Four single-product checkouts with separate `sessionStorage` drafts (`client/lib/booking/checkoutSession.ts:132-246`). The package checkout (`POST /orders`) is the only multi-product commit and requires a `packageToken` (`server/services/order/order.service.js:262-265`). `OrderKind.CUSTOM` is unused.
- Holds: hotel and tour 15 min (`server/config.js:338, 472`); transfer uses a `quoteToken`; service has none. `holdOrderOffers` already holds several slots in one transaction (`order.service.js:611-651`).

### 2.3 Invoicing
- `Invoice` + `InvoiceLine(description, quantity=1, taxRateBps, totalGrossCents, bookingReference)` (`schema.prisma:5373-5434`). No unit price, no structured detail.
- `buildLines` (`server/services/invoicing/invoice.service.js:80-125`) emits one summary line per booking from a narrow select (`:58-75`). Transfer date uses `toISOString()` on an instant (wrong day for early Tbilisi pickups); `@db.Date` columns are fine.
- InvoiceOcean positions carry only `name, quantity, tax, total_price_gross` (`server/services/invoicing/invoiceocean.adapter.js:182-187`). Custom lines accepted on `POST /admin/finance/receivables/:id/invoices`.
- Duplicate prevention is solid: partial unique index `invoices_one_live_per_kind`, `LIVE_INVOICE_EXISTS`, oid adoption, `@@unique(provider, externalId)`.
- Source data for detail exists: `HotelBookingRoom` (room type, rate plan, meal plan, adults, child ages, subtotal), `BookingGuest` (names, type, age), `hotelSnapshot` (name, countryCode, check-in/out times, timezone; **no city**), `TransferBookingLeg` (direction, from/to names, pickupAt, sellCents), `vehicleSnapshot`, one booking-level `flightNumber`.

### 2.4 Deadlines and reminders
- Stored: `Receivable.dueAt` (editable, audited `RECEIVABLE_DUE_DATE_CHANGED`, approval kind `RECEIVABLE_DUE_DATE`), `PayableInstalment.dueAt`, `requestDeadlineAt` on tour/service/order. Free-cancellation deadline is derived from the frozen `cancellationSchedule` JSON via `freeCancellationUntil()` (`server/services/hotel/policy.service.js:176-186`), per room for hotels. No calendar, no history except receivable due dates.
- `sweepFinanceReminders` (`server/services/finance/reminder.service.js:57-151`) sends pre-due reminders for **supplier instalments only** (env `FINANCE_REMINDER_OFFSET_DAYS=7,3,1,0`, claim `PayableReminder` unique `(instalmentId, offsetDays)`, calendar days in the payable's timezone); receivables get overdue alerts only. No DB settings model. Thirteen sweepers in `server/server.js`.

### 2.5 Notifications
- `Notification(recipientUserId, kind, title, body, payload, entityType, entityId, readAt)` (`schema.prisma:4951-4972`); 24 kinds. Routes `/admin/notifications` (unread, page, pageSize), `/unread-count`, `POST /read-all`, `/:id/read`. No kind/category filter, no dedupe key, no href column (client computes it in `client/lib/api/notifications.ts:87-118`, missing Invoice/ApprovalRequest/Partner).
- Recipients resolve through `usersWithCapability()` (RBAC-scoped). Hotel bookings notify guests by email only; no in-app "new booking" notice to staff.
- Bell in the header (`client/components/admin/AdminShell.tsx:183-187`); **no sidebar item**; badges fetched once per layout render, no polling, no SSE.

### 2.6 Admin lists, filters and UI kit
- Hotel, tour and order lists: URL-state filters (`router.replace` in a transition, 300 ms debounce), one date range, status (single select; orders use multi chips), text search on reference/lead name/email via `contains insensitive`. Transfer bookings list: **no filters, no pager buttons, summary call that 403s for roles without `finance.margin.read`, sort reversed from its copy**. Service bookings: server API, no admin page. Portal: hotels/tours/orders tabs, no transfers tab.
- Server list schemas accept `status, from, to, search, partnerId (not transfer), hotelId/tourId/serviceId/packageId, page, pageSize`; no sort, no created-date range, no payment/invoice/manager filters; no join to Receivable. Indexes `[status, date]`, `[partnerId, createdAt]`; nothing on `createdAt` alone or on search columns; no `pg_trgm`.
- UI kit: `DataTable` (no sort, hand-written card lists below `lg`), `FormControls` (no DateInput/MultiSelect), `EntityPicker` + `OptionChecklist`, `StatusBadge` tones, `AdminPage` header/panel, `Modal` (only dialog), `ui/FilterChip` (unused by booking lists), three chip styles, no shared pager, no toasts, no month grid. Finance browsers (`InvoicesBrowser`, `ReceivablesBrowser`) are the newest pattern (chips, removable partner chip, active-filter count, Clear filters). Admin is English-only. Forms are native state + `ApiError.fieldErrors()`; `PartnerRegistrationWizard` is the only multi-step pattern.
- Access: every panel page calls `requireScreen()`; `SCREENS` in `client/lib/admin/access.ts:75-157` must list every new page (`test/access-screens.test.ts` enforces it). Sidebar from `navigationFor(capabilities)` with per-item `capability`/`acts`/`badgeKey`.

### 2.7 RBAC and audit
- Capabilities in `server/lib/permissions.js`, DB roles seeded by migration, `requireCapability`/`requireCapabilityByMethod`, service-level `assertMayRead/assertMayMutate`. New routes must be added to the matrix fixture (`RBAC_MATRIX_UPDATE=1 node --env-file=.env.test --test test/rbac.matrix.test.js`) and the diff reviewed.
- `recordAudit(client, {action, actor, entityType, entityId, summary, metadata, req})` (`server/lib/audit.js:13-25`); `AuditAction` enum grows by hand-named `_enum_values` migrations timestamped earlier than the module migration.

---

## 3. Feature-by-feature gap analysis

Legend: **A** already implemented, **P** partial, **M** missing, **B** needs business clarification (now resolved unless noted).

| Feature | Requirement | Status | Evidence / gap |
|---|---|---|---|
| F1 Invoice lines | hotel detail (city, room, meal, nights, rooms, times, PAX, price) | P | one summary line; source data exists; no city in snapshot; no honorific field |
| | transfer detail per leg (from/to, date, time, flight, vehicle, pax, arrival/departure) | P | one line for both legs; one flight number per booking; no per-leg flight/time |
| | combined invoice for an order | A (basic) | one receivable per order, one line per item label |
| | multi rooms / multi transfers | P | rooms rows exist; lines do not iterate them |
| | immutability of issued lines | P | code never updates lines; no DB trigger |
| | numbering, currency, tax, discounts, dedupe | A | provider numbering; one currency per order; `INVOICEOCEAN_DEFAULT_TAX_BPS`; partial unique index |
| | transmit detail to InvoiceOcean | B → OD4 | position `description` untested in sandbox |
| F2 Notifications | bell + unread badge | A | header bell; badge refreshes only on navigation |
| | sidebar entry, dedicated page | P | page exists, no nav item, no filters, fixed 50 rows |
| | categories listed in brief | P | 24 kinds cover finance/approvals/transfers; no booking-new/awaiting/approved/rejected/modified/deadline kinds |
| | mark one/all read | A | |
| | filter by category/read, sort | P | `unread` only |
| | deep links | P | client-side; invoice/approval/partner missing |
| | real-time | M | no polling/SSE |
| | dedupe | P | retry-only |
| | RBAC-scoped recipients | A | `usersWithCapability` |
| F3 Cart | multi-item cart, one checkout | P | Order orchestrator commits many products; only via package token; no client cart |
| | parent/child model | A | Order + OrderItem with per-item status/charges |
| | partial confirmation/failure | A | per-item REQUESTED/DECLINED, pro-rata adjustment, clawback |
| | packages in cart without double counting | B → OD2 | flatten |
| F4 Deadlines | payment deadline | P | `Receivable.dueAt`, editable, audited; no pre-due reminder to debtor |
| | free-cancellation deadline | P | derived from JSON, not queryable, no reminder |
| | confirmation deadline | P | `requestDeadlineAt` tour/service/order; none for hotel/transfer |
| | calendar, filters, assign/modify | M | only `/admin/finance/due` list |
| | configurable reminders | P | env only, supplier instalments only |
| | history, audit | P | receivable due date only |
| F5 Filters | status, text search, date range, URL state, server-side, debounce | A (hotel, tour, order) / M (transfer UI) | see 2.6 |
| | payment status, invoice status, payment method, manager, destination, created range, deadlines | M | no joins, no columns |
| | quick presets, removable chips, reset | P | orders "On request" chip; finance browsers have the pattern |
| | reusable filter system across sections | M | each browser hand-rolled |
| F6 Manual bookings | Create booking action | M | nothing in panel |
| | existing partner as buyer | M | buyer always the session |
| | unregistered customer with company/billing | P | lead contact fields exist; no company/billing/tax id |
| | manager, payment method, deadlines, notes, source tracking | M | no columns; `source` client-supplied |
| | audit of creator | P | `bookedByUserId` + audit rows |
| | finance integration | A | ledger keys off booking rows |
| F7 Approval | PENDING_APPROVAL state for hotel/transfer | M | always CONFIRMED |
| | approve/reject/request corrections | P | tour/service/order-item confirm/decline for supplier on-request only |
| | invoice only after approval | A by construction | ledger no-op while not CONFIRMED |
| | payment tracking separate from approval | A | Receivable/PaymentRecord |
| | duplicate approval prevention | P | status checks; needs state machine assertion |
| | status indicators incl. payment | P | no payment status on booking |

---

## 4. Recommended architecture

### 4.1 Lifecycle: `PENDING_APPROVAL` as a real status
- Add `PENDING_APPROVAL` to `HotelBookingStatus`, `TransferBookingStatus`, `TourBookingStatus`, `ServiceBookingStatus`, `OrderStatus`; add `AWAITING_APPROVAL` to `OrderItemStatus`. A distinct value (not reusing PENDING with a reason column) keeps every existing `=== 'PENDING'` branch (supplier sweepers, supplier emails, badges, cancellation quotes) correct by default and makes the places that must widen grep-able.
- Approval columns on the five tables (`approvalRequestedAt`, `approvalDeadlineAt`, `approvalOverdueAlertAt`, `approvedAt`, `approvedByUserId`, `rejectedAt`, `rejectedByUserId`, `rejectionReason`) with index `[status, approvalDeadlineAt]`. Columns, not a shared table: every sweeper, list and ledger read is per product; the cross-product queue reads `booking_index`.
- One decision function `server/lib/booking/approval.js: approvalModeFor(actor, {manual, confirmNow})`: flag off → AUTO; manual + confirmNow + `bookings.approve` → AUTO; partner session → `partner.bookingApproval` (REQUIRED for all after OD1); guest → REQUIRED.
- Inventory is claimed at creation and stays claimed while pending (the ON_REQUEST tour precedent, `server/services/tour/booking.service.js:40-44`). Rejection releases it with the same calls cancel uses.
- ON_REQUEST tours/services: platform approval first, then the supplier is asked (approval sets `requestedAt/requestDeadlineAt` and moves to PENDING).
- Orders: approval is one decision per order; items move AWAITING_APPROVAL → REQUESTED|CONFIRMED; `impliedOrderStatus` gains a first clause; `confirmOrderItem/declineOrderItem` stay supplier-only.
- State machines: new `server/lib/booking/machines.js` for hotel/tour/service via `defineMachine` (`server/lib/stateMachine.js:16-51`); extend `transferBookingMachine` and the order machines. Asserted in approve/reject and existing cancel paths.
- Expiry: sweeper alerts at `approvalDeadlineAt` (config `BOOKING_APPROVAL_SLA_HOURS`, default 24); system-rejects only once the service date has passed. No auto-penalty.
- Payment status for lists and detail: `server/lib/finance/paymentStatus.js: paymentStatusOf(receivable)` → NONE | UNPAID | PARTIAL | OVERDUE | PAID | WAIVED | VOID, serialized as `payment: {status, receivableId, dueAt, outstandingCents, via: BOOKING|ORDER}` to staff and the owning partner.

### 4.2 Admin-created bookings: on-behalf shim + `Customer` table
- `server/lib/booking/onBehalf.js: actorOnBehalfOf(staff, buyer)` returns a copy of the staff actor with `partnerId/partner` set to the chosen partner (must be APPROVED), or `partnerId null` + `onBehalf: {kind: CUSTOMER, customerId}`. Every pricing, access, credit and ledger path reads the actor, so nothing in prepare/confirm is re-threaded.
- `Customer` table (INDIVIDUAL | COMPANY, name, contactName, email, phone, billingAddress, city, country, taxId, notes, createdByUserId) with `customerId` on the five tables and `Receivable.debtorCustomerId`; `buyerFor`/`customerKeyFor` in `invoice.service.js:128-149` learn the customer shape so InvoiceOcean gets a proper client record.
- `source` becomes a Prisma enum `BookingSource` (WEB, PARTNER, ADMIN, PHONE, EMAIL, EXTERNAL_AGENCY, DIRECT) derived server-side; public schemas stop accepting it.
- New columns on the four bookings + Order: `assignedManagerUserId` (FK, indexed), `internalNotes`, `priceAdjustmentCents` (default 0), `priceAdjustmentReason`, `preferredDriverId/preferredFleetVehicleId` (transfer, so the driver pick survives the pending state). Buyer total = sell + tax + adjustment in `PRODUCTS.*.buyerTotal` (`ledger.service.js:46-84`) and `toBookingSummary.totalCents`; cancellation uses the order-item arithmetic (`order.service.js:781-794`).
- Endpoints per product under the existing admin routers (`POST /admin/bookings/manual`, `/admin/transfers/bookings/manual`, `/admin/tours/bookings/manual`, `/admin/service-bookings/manual`, `/admin/orders/manual`) sharing one zod envelope (`buyer`, `channel`, `confirmNow`, `priceAdjustment`, `assignedManagerUserId`, `internalNotes`) merged with the product's existing confirm schema minus `source`.
- `PATCH /admin/<product>/:reference/desk` for manager/notes after creation; `/admin/customers` CRUD (search by name/email).

### 4.3 Unified cart: `Order.kind = CUSTOM`
- Split `prepareOrder` (`order.service.js:262-394`) into `preparePackageGroup(packageToken, …)` and a new `prepareCustomOrder(items, actor)` that maps each cart item to `prepareSlot` (`:128-196`) or a package group, assigns sequential `slotIndex`, sorts lock keys as today (`:379-380`), enforces one currency (422 `MIXED_CURRENCY`), reports per-item drift as 409 `PRICE_CHANGED`.
- `confirmCustomOrder` = `confirmOrder` body with the new preparer; items gain `packageId`, `packageSlotIndex`, `groupKey`, `adjustmentSource` (PACKAGE | MANUAL | NONE). CHECK `orders_custom_has_no_package`. Required-component rule scoped by `groupKey`.
- Routes: `POST /orders/custom`, `POST /orders/custom/holds` (generalised `holdOrderOffers`), `POST /orders/custom/quote` (strict:false preflight returning per-item availability/price). Existing `POST /orders` and single-product checkouts untouched.
- Client store `client/lib/booking/cart.ts` (`localStorage` key `iag:cart`, versioned, one currency), pages `/cart` and `/cart/checkout`, "Add to cart" beside "Book now" on hotel, tour, transfer, service and package pages. Admin `/admin/bookings/new` builds the same item list with the buyer envelope.

### 4.4 Deadlines: projection table + policies
- `BookingDeadline` (kind PAYMENT | FREE_CANCELLATION | CONFIRMATION; status OPEN | MET | MISSED | CANCELLED; source SYSTEM | MANUAL; exactly-one subject FK; `receivableId` for PAYMENT; `dueAt`, `timezone`; denormalised `product, reference, partnerId, customerId, assignedManagerUserId, leadName` for the calendar query; `meta` e.g. `{awaiting: PLATFORM|SUPPLIER}`), `BookingDeadlineHistory`, `DeadlineReminder` (unique `(deadlineId, offsetDays)`), `ReminderPolicy` (kind, optional partnerId, offsetsDays[], channels, recipients, enabled).
- `syncDeadlinesInTx(tx, product, id)` is called from the ledger (`createReceivable`, `adjustReceivableInTx`), from confirm/approve/cancel/reject, and from payment allocation. Truth stays at the source: PAYMENT mirrors `Receivable.dueAt`; FREE_CANCELLATION = min `freeCancellationUntil` over live rooms/schedule; CONFIRMATION = `approvalDeadlineAt` or `requestDeadlineAt`.
- `PATCH /admin/deadlines/:id {dueAt, reason}`: PAYMENT delegates to `adjustReceivableInTx` under finance's existing execute-or-approval rule; FREE_CANCELLATION and CONFIRMATION need new `bookings.deadlines.write` and write back to the source (schedule window boundary via a new `moveFreeCancellationUntil` in `policy.service.js`; the SLA column), audit `BOOKING_DEADLINE_CHANGED`, history row.
- `sweepDeadlineReminders` beside `sweepFinanceReminders`, same advisory lock and claim SQL (`reminder.service.js:74-91`) against `booking_deadlines` joined to `reminder_policies` (partner row else platform row). Handler re-reads and bails unless OPEN (pattern at `outbox.service.js:727-732`). Supplier instalment reminders stay as they are.
- `GET /admin/deadlines?from&to&kind[]&status[]&product[]&partnerId&managerId&page` reads only `booking_deadlines`.

### 4.5 Invoice line detail
- `InvoiceLine` + `kind` (HOTEL_ROOM, TRANSFER_LEG, TOUR, SERVICE, EXTRA, ADJUSTMENT, CANCELLATION_CHARGE, MANUAL), `unitCents?`, `detail Json?` (structured fields + `text` rendering). `description` stays the one-line summary.
- `services/invoicing/lines/{hotel,transfer,tour,service,order}.js` replace the body of `buildLines`; `receivableForInvoicing` widens to rooms/guests/legs/vehicle/destination. Hotel: one line per confirmed room, `quantity = nights`, amounts via `allocate(amountCents, roomSubtotals)` (`server/services/package/quote.service.js:48`) so lines sum to the receivable; `priceAdjustmentCents` → ADJUSTMENT line; cancellation charge → single line. Transfer: one line per leg labelled Arrival/Departure from point kind, pickup rendered in `fromPoint.timezone`, per-leg flight, vehicle from snapshot, pax adults+children; extras aggregated into one EXTRA line.
- Schema additions: `snapshotHotel` gains `city`/`destinationName` (old rows fall back to the Hotel→Destination join); `TransferBookingLeg.flightNumber/flightAt` (backfilled from the booking column; quote/confirm accept `flights: {outbound, return}`); optional `title` on `BookingGuest`, `TourBookingTraveller` and lead inputs (PAX printed as `LASTNAME / FIRSTNAME MR.` only when a title exists; children as `(CHD 7)`). Nothing is invented when absent.
- Adapter sends `description: detail.text` per position (and `price_gross = unitCents` when set, `total_price_gross` authoritative); stub pins the body; **first task of the phase is a sandbox run** against `lulini.invoicceocean.com` to confirm the PDF prints the description with line breaks. Fallback: multi-line `name`.
- DB trigger `invoice_lines_immutable` refuses UPDATE/DELETE on lines of a non-DRAFT invoice. Fix `day()` for instants (`invoice.service.js:77`) using `lib/time.js` helpers.

### 4.6 Notifications
- Schema: `category` (BOOKING | DISPATCH | FINANCE | APPROVAL | DEADLINE | SYSTEM, backfilled by CASE over existing kinds), `dedupeKey` with `@@unique([recipientUserId, dedupeKey])`, index `[recipientUserId, category, readAt, createdAt]`. New kinds: BOOKING_NEW, BOOKING_AWAITING_APPROVAL, BOOKING_APPROVED, BOOKING_REJECTED, BOOKING_APPROVAL_OVERDUE, BOOKING_MODIFIED, DEADLINE_PAYMENT_UPCOMING, DEADLINE_CANCELLATION_UPCOMING, DEADLINE_CONFIRMATION_UPCOMING, SYSTEM. Existing FINANCE_INVOICE_ISSUED / FINANCE_PAYMENT_RECEIVED / FINANCE_RECEIVABLE_OVERDUE already cover the brief's invoice/payment categories.
- `notify()` (`outbox.service.js:132-183`) gains category and dedupeKey (`createMany skipDuplicates`). Recipients: awaiting-approval → `bookings.approve` holders minus the booker; new → `bookings.write` holders; approved/rejected → partner `partner.bookings.read` holders (+ booker when it belongs to the partner); modified → assigned manager else `bookings.write` holders; deadlines → policy recipients. Fix `partnerRecipient` (`outbox.service.js:113-122`) to require `bookedByUser.partnerId === booking.partnerId` so staff booking on behalf are not mailed instead of the partner.
- Server-side `serializers/notification.js` computes `href` for all entity types (adds Invoice, ApprovalRequest, Partner, HotelBooking, ServiceBooking, BookingDeadline, Customer); client `notificationHref` stays as fallback.
- API: `kind[]`, `category`, `unread`, `sort newest|oldest|unreadFirst`, pagination; `unread-count` returns total + per-category. Badges add `pendingBookingApprovals`.
- Client: `NotificationBell` polls `/admin/notifications/unread-count` and `/admin/badges` every 60 s while the tab is visible; sidebar item "Notifications" (badge `unreadNotifications`) in the Overview group; page with category tabs, read/unread toggle, sort, pager. SSE deferred.

### 4.7 Filters and the cross-product index
- `server/lib/listing/bookingFilters.js`: one zod field set (`status[]`, `paymentStatus[]`, `invoiceStatus[]`, `paymentMethod`, `createdFrom/To`, `partnerId`, `customerId`, `managerId`, `destinationId`, `source[]`, `deadlineKind + deadlineFrom/To`, `search`, `sort`, `page`, `pageSize`) merged into each product's query schema (transfer's `.strict()` schema included), and `bookingWhere(query, viewer, spec)` building Prisma relation filters (`receivable`, `orderItem.order.receivable`, `receivable.invoices`, `receivable.allocations.paymentRecord.method`, `deadlines`).
- `booking_index` table maintained in-transaction (`syncBookingIndexInTx` called wherever the ledger syncs plus approval/amend/desk edits/payment allocation), with `pg_trgm` GIN on a concatenated `search` column, backfill script and daily reconcile. Serves `GET /admin/bookings/all`, the approvals queue and the dashboard. Chosen over a UNION view (no single index, filters rewritten four times) and a materialised view (stale or expensive refresh).
- New btree indexes `[createdAt]` and `[assignedManagerUserId]` on the four booking tables.

---

## 5. Database changes

Ten hand-named migrations, Prisma naming, enum-values migration strictly earlier than its module (template: `20261011200000/200100`). All additive; `source` is the only type change.

| # | Name | Contents |
|---|---|---|
| 1 | `20261020100000_booking_lifecycle_enum_values` | `PENDING_APPROVAL` on 5 status enums, `AWAITING_APPROVAL` on `order_item_status`, audit actions `BOOKING_APPROVED/REJECTED/APPROVAL_EXPIRED`, `PARTNER_BOOKING_APPROVAL_CHANGED`, notification kinds BOOKING_* and SYSTEM, `booking_approval_mode` type |
| 2 | `20261020100100_booking_lifecycle` | `partners.booking_approval` (default REQUIRED; existing rows REQUIRED per OD1); approval columns + `[status, approval_deadline_at]` on 5 tables; transfer `preferred_driver_id/preferred_fleet_vehicle_id`; `role_capabilities` rows for `bookings.approve` |
| 3 | `20261020101000_notifications_module` | `notification_category` type; `category` backfilled then NOT NULL; `dedupe_key` + unique `(recipient_user_id, dedupe_key)`; category index |
| 4 | `20261020110000_manual_bookings_enum_values` | audit actions `BOOKING_PRICE_ADJUSTED`, `BOOKING_MANAGER_ASSIGNED`, `BOOKING_NOTES_CHANGED`, `CUSTOMER_CREATED/UPDATED`; `booking_source`, `customer_kind` types |
| 5 | `20261020110100_manual_bookings` | `customers`; `customer_id` on 5 tables, `receivables.debtor_customer_id`, `invoicing_customers.customer_id` (partial unique); `assigned_manager_user_id` (+index), `internal_notes`, `price_adjustment_cents/reason`; `source` → enum (`UPDATE upper()` then `ALTER … USING`); `role_capabilities` for `bookings.price.override` |
| 6 | `20261020120000_booking_index` | `CREATE EXTENSION IF NOT EXISTS pg_trgm`; `booking_index` + indexes + GIN; `created_at` indexes on 4 booking tables |
| 7 | `20261020130000_invoice_line_detail` | `invoice_lines.kind, unit_cents, detail`; `transfer_booking_legs.flight_number, flight_at` (backfill OUTBOUND from booking); `booking_guests.title`, `tour_booking_travellers.title`; trigger `invoice_lines_immutable` |
| 8 | `20261020140000_deadlines_enum_values` | `deadline_kind/status/source` types; audit `BOOKING_DEADLINE_CHANGED`, `REMINDER_POLICY_UPDATED`; notification kinds DEADLINE_* |
| 9 | `20261020140100_deadlines_module` | `booking_deadlines` (+ CHECK exactly-one subject, per-kind uniques, indexes), `booking_deadline_history`, `deadline_reminders`, `reminder_policies` + seed rows (PAYMENT 7,3,1,0; FREE_CANCELLATION 3,1; CONFIRMATION 1,0); `role_capabilities` for `bookings.deadlines.write` |
| 10 | `20261020150000_custom_orders` | `order_items.package_id, package_slot_index, group_key, adjustment_source`; CHECK `orders_custom_has_no_package` |

Rollback: enum values cannot be dropped (code stops writing them); each module migration ships a `down.sql` beside it (documented in `server/README.md`, not run by Prisma); derived tables (`booking_index`, `booking_deadlines`) rebuild from their backfill scripts; feature flags `BOOKING_APPROVAL_ENABLED`, `CART_ENABLED`, `INVOICE_LINE_DETAIL=summary|detailed`, `DEADLINE_REMINDERS_ENABLED` turn behaviour off before any schema rollback. Dev DB pitfall: hand-named migrations must sort after `20261011900000`; never run `migrate dev` without checking for the stray geo-index drop.

---

## 6. Backend implementation plan

### Phase 0 Foundations
- `server/lib/booking/approval.js` (`approvalModeFor`), `server/lib/booking/machines.js`, `server/lib/booking/onBehalf.js`, `server/lib/finance/paymentStatus.js`, `server/lib/listing/bookingFilters.js` skeleton.
- `server/lib/permissions.js`: capabilities `bookings.approve` (SUPER_ADMIN, ADMIN, TOUR_OPERATOR), `bookings.price.override` (SUPER_ADMIN, ADMIN), `bookings.deadlines.write` (ADMIN, TOUR_OPERATOR), `settings.reminders.write` (SUPER_ADMIN, ADMIN); `DEFAULT_ROLE_LISTS` updated; `scripts/print-role-capabilities.js` regenerates the client fixture.
- `server/config.js`: `booking.approvalEnabled`, `booking.approvalSlaHours`, `booking.opsEmail`, `cart.enabled`, `finance.invoiceLineDetail`, `finance.deadlineRemindersEnabled`; `.env.example`, `.env.test` pins flags off.
- `sourceFor(actor)` in each facade; public schemas drop `source`.

### Phase 1 Lifecycle and approval
- Migrations 1–2; schema models.
- `confirmHotelBookingInTx` (`hotel/booking.service.js:309-460`), `confirmTransferBookingInTx` (`transfer/booking.service.js:261-357`), `confirmTourBookingInTx`, `confirmServiceBookingInTx`: status from `prepared.approval`, approval stamps, supplier event only when not pending, deferred preferred driver.
- Facades: outbox topic `BOOKING_AWAITING_APPROVAL` when pending; `assertCreditInTx` also inside approval.
- `services/booking/approval.service.js`: `approveBooking(product, reference, {note}, actor, req)`, `rejectBooking(product, reference, {reason}, …)`; per-product `approvePendingXInTx` mirroring `confirmPendingTourBookingInTx` (`tour/booking.service.js:637-661`); order approval walks items then `rollUpOrderStatus` (`order.service.js:420-460`); order reject = `cancelOrderInTx(…, {waiveCharges: true})`.
- `lib/order/machines.js`: `PENDING_APPROVAL`/`AWAITING_APPROVAL` transitions, `impliedOrderStatus` first clause, `LIVE_ITEM_STATUSES` + AWAITING_APPROVAL; `ledger.service.js orderItemOwed` returns 0 for AWAITING_APPROVAL.
- Cancellation quotes return 0 for PENDING_APPROVAL; `CANCELLABLE_STATUSES`/`AMENDABLE_STATUSES` widened.
- Sweeper `sweepBookingApprovals` in `server/server.js` (10 min).
- Routes `routes/admin.bookingApprovals.routes.js` at `/admin/booking-approvals`: `GET /`, `POST /:product/:reference/approve`, `POST /:product/:reference/reject` (`bookings.approve`). Partner-side status rides existing GETs.
- Status-list widenings: badges `ACTIVE_BOOKING_STATUSES` (`routes/admin.badges.routes.js:30`), dispatch badge and `listDispatchLegs` add `booking.status = CONFIRMED`, `summarizeBookings`, validation status enums, `Partner.bookingApproval` on the admin partner PATCH (audited).
- Templates `bookingAwaitingApproval`, `bookingRejected`; outbox topics `BOOKING_AWAITING_APPROVAL/APPROVED/REJECTED/APPROVAL_OVERDUE`.

### Phase 2 Notifications infrastructure
- Migration 3; `notify()` category/dedupe; `serializers/notification.js`; `validation/notification.js` filters; `notification.service.js` list/sort/per-category counts; badges `pendingBookingApprovals`; `partnerRecipient` fix; handlers for the new kinds.

### Phase 3 Manual bookings
- Migrations 4–5; `Customer` service + routes `/admin/customers`; `validation/manualBooking.js`; per-product manual routes; `actorOnBehalfOf`; `confirmXInTx` writes customer/manager/notes/adjustment; `ledger.service.js createReceivable` customer debtor; `invoice.service.js buyerFor/customerKeyFor` customer branch; `PATCH …/desk`; audit actions.

### Phase 4 Booking index and shared filters
- Migration 6; `services/booking/index.service.js` (`syncBookingIndexInTx`, `reconcileBookingIndex`), hooks in ledger/payment/approval/amend/desk; `scripts/backfill-booking-index.js`; `bookingWhere` wired into the five list services; `GET /admin/bookings/all`; transfer list schema widened; `sort` support.

### Phase 5 Invoice line detail (parallel with 3–4)
- Sandbox verification task first (position `description`, line breaks, `price_gross` rounding) and record the result in `docs/`.
- Migration 7; per-product line builders; `receivableForInvoicing` widening; adapter `description`/`price_gross`; stub update; `snapshotHotel` city; leg flights in transfer quote/confirm; guest `title` in validation/serializers; `day()` fix; trigger.

### Phase 6 Deadlines and reminders
- Migrations 8–9; `services/booking/deadline.service.js` (`syncDeadlinesInTx`, `listDeadlines`, `moveDeadline`); `policy.service.js moveFreeCancellationUntil`; `reminder.service.js sweepDeadlineReminders`; outbox `DEADLINE_UPCOMING` handler; routes `/admin/deadlines`, `PATCH /admin/deadlines/:id`, `/admin/settings/reminder-policies` (GET/PUT); backfill `scripts/backfill-deadlines.js`.

### Phase 7 Unified cart
- Migration 10; `preparePackageGroup` extraction; `prepareCustomOrder`, `confirmCustomOrder`, `holdCustomOffers`, `quoteCustomOrder`; `validation/order.js` cart schemas; routes `/orders/custom`, `/orders/custom/holds`, `/orders/custom/quote`, `/admin/orders/manual`; `orderMailData` for CUSTOM; required-component rule by `groupKey`.

### Phase 8 Integration
- `API.md` sections, Postman folders, RBAC matrix regeneration, deployment notes (backfills in the deploy step, flags on Render), help articles, `rbac.fixture-sync` client fixture.

---

## 7. Frontend and UI/UX implementation plan

Reuse: `AdminPage` (`AdminPageHeader`, `AdminPanel`), `DataTable`, `FormControls`, `EntityPicker`/`OptionChecklist`, `StatusBadge` tones, `Modal`, `ui/FilterChip`, finance browser patterns (`InvoicesBrowser`, `ReceivablesBrowser`), `PartnerRegistrationWizard` stepper, `CalendarManager` date helpers (`client/lib/admin/dates.ts`), `NotificationBell`/`NotificationList`, portal `PortalShell`. English-only admin; portal strings go through `t`. Every new page gets a `SCREENS` rule and a nav item with a capability.

### 7.1 Shared primitives (built once, used by every list)
- `components/admin/filters/FilterBar.tsx`: search input (debounced 300 ms), `FilterSelect` (single), `FilterMultiChips` (OptionChecklist-based), `DateRangeFields` (two native date inputs with presets Today / 7 days / 30 days), `QuickPresets` chips, `ActiveFilterChips` (removable, with "Clear filters"), results count line. Writes URL with `router.replace` in a transition (pattern `BookingsBrowser.tsx:65-79`).
- `components/admin/Pager.tsx` (Prev/Next + "Page X of Y"), replacing four hand-written pagers.
- `components/admin/PaymentStatusBadge.tsx` (NONE neutral, UNPAID attention, PARTIAL info, OVERDUE critical, PAID positive, WAIVED/VOID neutral) and `ApprovalStatusBadge`.
- `client/lib/admin/bookingFilters.ts`: one `bookingQueryFromParams` with the new keys (`search`, repeated `status`, repeated `paymentStatus`, `createdFrom/To`, `partnerId`, `managerId`, `destinationId`, `sort`, `page`) and `bookingQueryToParams`.
- Toast: keep inline `role="status"` notices (no new dependency).

### 7.2 Sidebar and header
- `client/lib/admin/navigation.ts`: Overview group gains "Notifications" (badge `unreadNotifications`, capability `notifications.read`); Operations gains "Booking approvals" (badge `pendingBookingApprovals`, capability `bookings.approve`), "All bookings" (`bookings.read`), "Service bookings" (`bookings.read`), "Deadlines" (`bookings.read`), "Customers" (`bookings.write`); Finance gains nothing new; a "Settings" group with "Reminders" (`settings.reminders.write`).
- `AdminShell.tsx` header: replace the inert search box with a real quick-search that navigates to `/admin/bookings/all?search=` on Enter; bell stays right-aligned with the unread pill; both bell and sidebar pill read the same polled count (context in `AdminShell`, `setInterval` 60 s, paused when hidden). Mobile: bell remains in the header; the drawer shows the Notifications row with its badge.
- "Create booking" primary button in the `AdminPageHeader` actions slot of Hotel bookings, Transfer bookings, Tour bookings, Orders and All bookings (shown when `useCan('bookings.write')`).

### 7.3 Notifications page (`/admin/notifications`)
- Category tabs (All, Bookings, Approvals, Finance, Deadlines, Dispatch, System) with per-category unread counts; Unread-only toggle; sort select; `NotificationList` rows with category icon, bold title when unread, relative time, "Open" link from `href`, per-row mark read; "Mark all read" in the header actions; `Pager`. Empty state per tab; loading via `(panel)/loading.tsx`; error boundary existing.
- Portal `/portal/notifications` gets the same tabs limited to partner categories.

### 7.4 Booking tables
- Hotel, Transfer, Tour, Service (new page) and Orders browsers adopt `FilterBar`: search; status multi chips; payment status multi chips; date range (section-specific label: Arriving / Pick-up / Departing / Travelling) plus Created range; partner `EntityPicker` (admin only); manager `EntityPicker` (staff users); hotel/tour/destination picker where relevant; source select; invoice status chips; quick presets (All, Pending approval, Awaiting payment, Confirmed, Upcoming arrivals, Overdue payments, Recently created). Columns add Payment (badge + due date) and Manager (initials); Status cell shows approval deadline when pending. Sort select (Created, Service date, Due date). Cards below `lg` keep today's hand-written pattern, generated from the same row model.
- Transfer bookings: fix the summary 403 (guard the call with `useCan`/server `can`), fix sort to soonest first, add the pager.
- `/admin/bookings/all`: cross-product table from `booking_index` (Type column with product icon, Reference, Buyer, Service dates, Status, Payment, Total, Manager), same `FilterBar` with Booking type chips; row links to the product detail page.
- `/admin/bookings/approvals`: queue sorted by `approvalDeadlineAt`, overdue rows tinted `bg-error/5` (OrdersBrowser pattern), inline Approve / Reject (reason required) with confirmation modal, bulk approve for selected rows (sequential calls, per-row result).
- Portal lists: add payment status column and badge, add a Transfers tab (API already exists), status chips show "Awaiting approval".

### 7.5 Booking detail pages
- Add panels: **Approval** (status, requested/deadline, approved/rejected by + when, reason; Approve/Reject buttons for `bookings.approve`), **Payment** (status badge, receivable link, due date, outstanding, invoices list via existing `ReceivableInvoicesPanel`, Record payment via existing `RecordPaymentModal` for finance capabilities), **Deadlines** (three rows with kind, due, status, source, Edit for `bookings.deadlines.write`, history disclosure), **Desk** (assigned manager picker, internal notes textarea, source, customer card with link; editable with `bookings.write`; hidden from partners). Transfer detail gets a booking-level Cancel action (missing today).
- Timeline panel reads audit rows for the entity (`GET /admin/audit?entityType&entityId`, exists) so status changes, approvals, price adjustments and deadline moves show in one list.

### 7.6 Create booking (`/admin/bookings/new`)
- Wizard modelled on `PartnerRegistrationWizard`: 1 Buyer (existing partner via `EntityPicker` | existing customer via search | new customer form with company toggle, billing, tax id), 2 Services (cart-style list; "Add hotel / transfer / tour / service / package" opens the product search in a `Modal size=lg` reusing the public search components: hotel search + `RoomOffers`, transfer quote form, tour departures, service form, package builder), 3 Travellers (lead + PAX with optional title), 4 Terms (channel, assigned manager, internal notes, payment due date override shown read-only from partner terms with Finance edit link, cancellation terms summary per item, price adjustment per item behind `bookings.price.override` with reason), 5 Review (totals per item and combined, "Confirm now" checkbox for `bookings.approve`, submit). Server errors reopen the earliest failing step; `PRICE_CHANGED`/`UNAVAILABLE` render per item like `OrderCheckoutForm`.
- Single-service shortcut: a one-item wizard posts to the product's `/manual` route; multi-item posts to `/admin/orders/manual`.
- `/admin/customers` list + `[id]` with bookings tab.

### 7.7 Public cart and checkout (`CART_ENABLED`)
- Header cart icon with item count (site `Header`), `/cart` page (item cards with summary, price, remove, edit returns to the product page with state restored, currency guard, "Refresh prices" via quote, combined total), `/cart/checkout` (holds taken on entry with `HoldCountdown`, lead + travellers + per-item requests, submit `POST /orders/custom` with idempotency key, confirmation page branch for CUSTOM in `/booking/confirmation/[reference]` and manage view in `OrderManageView`). Partner portal shows CUSTOM orders in the Orders tab with item groups.
- Empty cart state, hold-expired state (re-hold), partial failure state (409 per item, keep the rest).

### 7.8 Invoice detail
- Admin `finance/invoices/[id]` and portal invoice rows render lines with `kind` icon, description, expandable `detail.text`, quantity, unit, VAT, gross; Issue-a-document modal previews the generated lines before issuing.

### 7.9 Deadline calendar (`/admin/deadlines`)
- Month grid (new `components/admin/MonthGrid.tsx`, 7 columns, weekend tint via `weekdayOfISO`, RTL-safe logical classes) with per-day chips coloured by kind (PAYMENT info, FREE_CANCELLATION warning, CONFIRMATION attention; overdue critical), week view reusing `ScheduleView`'s day-grouped agenda, day view as a list. `FilterBar` with kind, status, product, partner, manager; URL state `view=month|week|day&from`. Clicking a chip opens a side `Modal` with the booking summary, Open booking link, and Edit deadline (reason required) for the permitted kinds. Upcoming/overdue counters in `StatCard`s. Portal gets a read-only "Upcoming deadlines" list on `/portal/bookings`.
- Settings `/admin/settings/reminders`: table of policies per kind (offsets as chips, channels, recipients, enabled), platform row plus per-partner overrides via `EntityPicker`.

### 7.10 Approval workflow UI
- Status indicators everywhere: Pending approval (attention), Confirmed · Awaiting payment, Confirmed · Partially paid, Confirmed · Paid (positive), Rejected (critical), Cancelled (neutral), Completed. Approval actions only for `bookings.approve` (`useCan`); Reject requires a reason; approve shows the credit-limit result if WARN.
- Dashboard widget "Awaiting approval" in `client/lib/admin/dashboard.ts` for `bookings.approve` holders.

### 7.11 States and responsiveness
- Every list: loading (`(panel)/loading.tsx`), empty (`ui/EmptyState` with reset action when filters are active), error boundary. Every form: field errors from `ApiError.fieldErrors()`, `FormError`, `SubmitButton` busy state. Tables at `lg`+, cards below; filters wrap into two rows at `md`, collapse into a "Filters" disclosure below `md`; calendar month grid scrolls horizontally below `md` with week view as the default on phones.

---

## 8. Booking and payment state diagrams

```
Hotel / Transfer / Tour(INSTANT) / Service(INSTANT)
  create ──flag off──────────────────────────► CONFIRMED ──► CANCELLED | COMPLETED | NO_SHOW
  create ──flag on──► PENDING_APPROVAL ──approve──► CONFIRMED
                                        ──reject | withdraw | expire──► CANCELLED (charge 0, confirmedAt null)

Tour / Service (ON_REQUEST)
  create ──► PENDING_APPROVAL ──approve──► PENDING (supplier asked, requestDeadlineAt) ──confirm──► CONFIRMED
                                                                                         ──decline──► CANCELLED

Order (kind PACKAGE or CUSTOM)
  PENDING_APPROVAL ──approve──► PENDING_CONFIRMATION | CONFIRMED ──► PARTIALLY_CANCELLED | CANCELLED | COMPLETED
  PENDING_APPROVAL ──reject───► CANCELLED
OrderItem
  AWAITING_APPROVAL ──► REQUESTED | CONFIRMED | DECLINED | CANCELLED ; then as today

Payment (Receivable, created only on CONFIRMED)
  (none while pending)  ──confirm──► OPEN ──partial──► PARTIAL ──full──► PAID
                                      OPEN/PARTIAL with dueAt < now  = OVERDUE (computed)
                                      ──waive──► WAIVED      ──cancel to 0──► VOID
Invoice
  proforma DRAFT ──issue──► ISSUED ──send──► SENT ; full payment ──► VAT invoice from proforma ; cancel/correction as today
```

Manual bookings: `confirmNow` + `bookings.approve` enters the diagram at CONFIRMED (audited `BOOKING_APPROVED` with `via: MANUAL`); otherwise at PENDING_APPROVAL.

---

## 9. API and integration changes

| Area | Endpoint | Capability |
|---|---|---|
| Approvals | `GET /admin/booking-approvals`; `POST /admin/booking-approvals/:product/:reference/{approve,reject}` | `bookings.approve` |
| Manual | `POST /admin/bookings/manual`, `/admin/transfers/bookings/manual`, `/admin/tours/bookings/manual`, `/admin/service-bookings/manual`, `/admin/orders/manual`; `PATCH /admin/<product>/:reference/desk` | `bookings.write` (+ `bookings.price.override` for adjustments, `bookings.approve` for confirmNow) |
| Customers | `GET/POST /admin/customers`, `GET/PATCH /admin/customers/:id` | `bookings.write` (read: `bookings.read`) |
| Cart | `POST /orders/custom`, `/orders/custom/holds`, `/orders/custom/quote` | public/partner (`rejectUnapprovedPartner`) |
| Lists | shared filter fields on the five admin and partner lists; `GET /admin/bookings/all` | existing read caps |
| Deadlines | `GET /admin/deadlines`, `PATCH /admin/deadlines/:id`; `GET/PUT /admin/settings/reminder-policies`; `GET /partner/deadlines` | `bookings.read` / `bookings.deadlines.write` or finance execute / `settings.reminders.write` / `partner.bookings.read` |
| Notifications | filters on `GET /admin|partner/notifications`; `unread-count` per category; `href` in responses | existing |
| Partners | `bookingApproval` on admin partner PATCH + serializer | `partners.write` |
| Invoices | positions carry `description` and `price_gross`; `InvoiceLine` responses carry `kind/unitCents/detail` | existing |
| Badges | `pendingBookingApprovals` | existing |

Serializer additions: `payment` block and approval block on all booking/order serializers for staff and owning partner; `customer` and desk fields for staff only (`canViewBuyer`). Every new route goes into the RBAC matrix fixture and Postman collection.

InvoiceOcean: unchanged contract except positions; webhook/poll untouched. The sandbox check is a deliverable, not an assumption.

---

## 10. Security and RBAC requirements

- New capabilities: `bookings.approve`, `bookings.price.override`, `bookings.deadlines.write`, `settings.reminders.write`; seeded via `role_capabilities` inserts; `PROTECTED_CAPABILITIES` gains `bookings.price.override`.
- Self-approval: a staff member who created a manual booking may still approve it (ops desk reality) but the audit row records both; a partner user can never approve.
- Service-level guards: `assertMayMutate` on approve/reject/desk; manual routes refuse partners (`partnerId` on the session → 403); `actorOnBehalfOf` requires `bookings.write` and an APPROVED partner; customer PII only to staff with `bookings.read` (never serialized to other partners); `internalNotes`, `assignedManager`, `priceAdjustment` never leave the staff serializers.
- Price manipulation: public schemas carry no amounts (already); adjustments only via the envelope with capability + reason + audit; cart `quotedSellCents` is compared to the catalogue and refused with 409 like today.
- Ownership: list filters keep `partnerId` scoping for partners (`bookingWhere` applies viewer scope first); `booking_index` queries always add the viewer predicate; deadline endpoints scope by partner for the portal.
- Notifications: recipients only via `usersWithCapability` and partner membership; `dedupeKey` per recipient; href computed server-side from the viewer scope.
- Approval replay: state machine assertion returns 409 `INVALID_TRANSITION` on a second approve; row lock (`lockRows` in `lib/locks.js`) inside the approval transaction.
- Audit: every new mutation writes `recordAudit` with the new actions; audit rows surface on the detail Timeline.

---

## 11. Testing strategy

Server `node:test` + supertest, run with `--env-file=.env.test` (global limiter) and expect the shared-dev-DB count races noted in memory.

- **New files**: `test/booking.approval.test.js` (pending on create for hotel/transfer/tour-on-request/order; inventory still claimed; reject releases; withdraw at 0; approve creates receivable + proforma exactly once; double approve 409; credit re-check at approve; expiry sweeper; partner cannot approve), `test/bookings.manual.test.js` (partner buyer → partner debtor + commission + credit; customer buyer → receivable debtor + InvoiceOcean client; adjustment arithmetic incl. cancellation; confirmNow gating; source derived; PII not in partner serializer), `test/bookings.index.test.js` (sync on every transition, backfill equals live, trigram search), `test/bookings.filters.test.js` (paymentStatus/invoiceStatus/paymentMethod/manager/destination/created/deadline per product; partner scoping), `test/orders.custom.test.js` (mixed items; flattened package with shares; mixed currency 422; per-item 409 drift; approval per order; required-by-group; holds/quote), `test/deadlines.test.js` (PAYMENT mirrors receivable incl. Finance move; FREE_CANCELLATION from schedule and manual move changes the charge; CONFIRMATION from SLA; reminder claims and policy resolution; stop after payment/cancel; timezone days), `test/notifications.filters.test.js` (category/kind/sort; dedupe on retry; href per scope; recipients for each new kind).
- **Extend**: `invoicing.lines.unit` (per-room allocation sums to receivable; per-leg labels; tz), `invoicing.adapter.unit` (description/price_gross), `invoicing.flow`, `finance.ledger.unit` (no rows while pending; adjustment in buyer total), `finance.reminders`, `orders.onRequest`, `orders.cancellation`, `cancellation`, `tours.booking`, `transfers.booking`, `transfers.dispatch` (pending legs hidden), `notifications.admin`, `bookings.notifications` (on-behalf recipient), `rbac.matrix` (regenerate, review every changed cell), `rbac.seed`, `stateMachine.unit`, `permissions.unit`, `app.test`.
- **Security**: matrix fixture for every new route; explicit tests for unauthorized approve (partner, TOUR_OPERATOR without cap), unauthorized invoice read across partners, price override without cap (403 `details.fields`), customer PII isolation, ownership on `/orders/custom/:reference`.
- **Reliability**: concurrent `POST /orders/custom` with the same idempotency key (one order); concurrent approve (one wins); duplicate proforma impossible (partial unique index test exists, extend for approval path); outbox failure on `bookingAwaitingApproval` leaves the booking pending and retries; deadline reminder claim under two parallel sweeps (pattern from `finance.reminders`); index reconcile after a simulated missed sync.
- **Client**: `test/access-screens.test.ts` (new SCREENS), `navigation-access.test.ts` (new items per role), `dashboard-widgets.test.ts`, new `bookingFilters.test.ts` (params round-trip), `cart.test.ts` (store, currency guard, versioning). Playwright per-role walk extended with: approve from the queue, create manual booking, cart checkout, calendar edit (`qa/e2e/`).
- **Regression**: full server suite, newman collection (expect the known pre-existing failures only), client tsc/lint/test/build, sandbox invoice chain (proforma → send → payment → VAT) once more with detailed lines.

---

## 12. Implementation phases and dependencies

| # | Phase | Depends on | Risk | Complexity |
|---|---|---|---|---|
| 0 | Foundations (libs, capabilities, flags, server-side source) | — | low | S |
| 1 | Lifecycle and approval (migrations 1–2, services, routes, sweeper, templates, status-list widenings) + client approvals queue, detail approval panel, badges | 0 | **high** (touches every status list; inventory held while pending) | L |
| 2 | Notifications (migration 3, categories, dedupe, href, filters, polling, sidebar item, page) | 1 for kinds | low | M |
| 3 | Manual bookings (migrations 4–5, customers, shim, adjustments, desk fields) + wizard, customers pages | 0, 1 | medium (`source` type change; debtor) | L |
| 4 | Booking index + shared filters (migration 6) + FilterBar, Pager, badges, all-bookings page, transfer list fixes, service bookings page, portal transfers tab | 1, 3 | medium (drift, backfill) | L |
| 5 | Invoice line detail (migration 7) + line rendering in panel/portal; sandbox check first | 0 | low–medium (provider rendering) | M |
| 6 | Deadlines and reminders (migrations 8–9) + calendar, detail panel, settings page | 1, 2, 4 | medium (schedule rewrite on manual move) | L |
| 7 | Unified cart (migration 10) + public cart/checkout, admin multi-item create | 1, 3 | **high** (orchestrator refactor) | L |
| 8 | Integration: docs, Postman, fixtures, deploy notes, cross-feature walk, regression | all | low | M |

Phases 5 and 2 can run in parallel with 3–4. No calendar-time estimates by request.

Per-phase acceptance criteria (summary): 1 — a partner booking lands PENDING_APPROVAL with inventory claimed, no receivable, admin notified; approve creates receivable + proforma once and emails the partner; reject releases inventory at zero charge; flag off reproduces today's behaviour byte-for-byte in the existing tests. 3 — admin books for a partner and for a new company customer; both invoice correctly; adjustment audited. 4 — every list filters by payment status and manager; all-bookings search hits any product in under 100 ms on the perf DB. 5 — a two-room hotel plus round-trip transfer invoice shows two room lines and two leg lines summing to the receivable; sandbox PDF prints the detail. 6 — calendar shows the three deadline kinds; moving a payment deadline follows Finance's approval rule; reminders fire at configured offsets and stop after payment. 7 — hotel + transfer + package in one cart checks out as one CUSTOM order with one receivable and one proforma; a package hotel cannot be self-cancelled by the partner; mixed currency refused.

---

## 13. Risks and breaking changes

- **Behaviour change on launch (OD1)**: every booking waits. Mitigation: `BOOKING_APPROVAL_ENABLED` off until the queue UI, notifications and partner-facing copy ship; announce to partners; `AUTO` per-partner remains available as an escape hatch.
- **Status widenings**: any missed `=== 'CONFIRMED'`/`'PENDING'` branch (dispatch board, completion sweeps, supplier mail, summaries, portal labels) misbehaves silently. Mitigation: grep-driven checklist in Phase 1 PR, TypeScript `Record<Status,…>` labels force client edits, test for pending legs hidden from dispatch.
- **Inventory held while pending** reduces availability for others until approval or expiry; the SLA alert and the arrival-date expiry bound it. Owner may later want a shorter hard expiry.
- **`source` type change** touches five tables; expand/contract with `USING` and a verified backfill.
- **Index drift** in `booking_index`: mitigated by in-transaction sync, backfill script and daily reconcile; the per-product lists remain the truth.
- **Provider rendering**: if InvoiceOcean ignores `description` on the PDF, fallback to multi-line `name` (verified in the same task).
- **Credit limit timing**: pending bookings do not count toward the limit until approved; the approval transaction re-checks.
- **Pre-existing defects fixed in passing** (list for the PR): transfer bookings summary 403 for non-margin roles, reversed sort and missing pager; hotel sidebar badge counts CONFIRMED as pending; `notificationHref` missing types; transfer invoice date in UTC; no admin service-bookings page; portal lacks transfers tab; unused `lockedStatuses` prop and `AdminCardList` comment.
- **Not changed**: existing single-product checkouts, `POST /orders` for packages, supplier payable reminders, approval requests module, InvoiceOcean issuing rules.

---

## 14. Unresolved business questions

Defaults are applied; change them before the phase named.

| # | Question | Default applied | Phase |
|---|---|---|---|
| Q1 | Hard auto-reject at the approval SLA, or alert only and reject at the service date? | Alert at SLA (24h), system-reject at service date | 1 |
| Q2 | Does moving a FREE_CANCELLATION deadline change what cancelling costs? | Yes: it rewrites the frozen schedule boundary, audited | 6 |
| Q3 | Should staff booking for a non-partner customer see trade (B2B-only) inventory and default markup? | Yes, audited | 3 |
| Q4 | Who may hold `bookings.price.override` by default? | SUPER_ADMIN + ADMIN | 0 |
| Q5 | Add optional honorific (`title`) to guest and traveller forms now? | Yes, optional; PAX printed without it when absent | 5 |
| Q6 | Cancelling one item of a flattened package group: item only (today's rule) or the whole group? | Item only; `required` components blocked for partners | 7 |
| Q7 | Reminder recipients for partner deadlines: all partner booking readers, or only the booker and primary contact? | All `partner.bookings.read` holders of the partner | 6 |
| Q8 | Should the public site cart be exposed to guests, or partners only, at launch? | Both, behind `CART_ENABLED` | 7 |

---

## 15. Final prioritised development checklist

1. Copy this plan to `docs/plans/booking-management-plan.md`; add a Status table.
2. Phase 0: libs (`approval.js`, `machines.js`, `onBehalf.js`, `paymentStatus.js`, `bookingFilters.js`), capabilities, config flags, server-side `source`, fixture regeneration.
3. Phase 1 server: migrations 1–2, confirmInTx branches, approval service + routes, machines, sweeper, templates, status-list widenings, tests.
4. Phase 1 client: approvals queue, approval panel, badges, status labels, portal "Awaiting approval".
5. Phase 2: notifications migration + category/dedupe/href/filters/polling; sidebar item; page tabs; portal.
6. Phase 3 server: migrations 4–5, customers, manual routes, shim, adjustments, desk edits, ledger/invoice buyer, tests.
7. Phase 3 client: create-booking wizard, customers pages, desk panel, "Create booking" buttons.
8. Phase 5 (parallel): sandbox description check; migration 7; line builders; adapter; stub; guest title; leg flights; trigger; line rendering.
9. Phase 4 server: migration 6, index service + backfill + reconcile, shared `bookingWhere`, all-bookings route, sort.
10. Phase 4 client: FilterBar, Pager, PaymentStatusBadge, all five browsers migrated, all-bookings page, service bookings page, transfer list fixes, portal transfers tab.
11. Phase 6 server: migrations 8–9, deadline service, policies, reminder sweep, routes, backfill.
12. Phase 6 client: calendar (month/week/day), deadline panels, settings page, portal upcoming list.
13. Phase 7 server: migration 10, `preparePackageGroup`/`prepareCustomOrder`, routes, tests.
14. Phase 7 client: cart store, header icon, `/cart`, `/cart/checkout`, confirmation/manage branches, admin multi-item create.
15. Phase 8: API.md, Postman folders, help articles, DEPLOYMENT/render.yaml flags, RBAC matrix review, newman + full suite + client gates + Playwright walk, sandbox invoice chain.

---

## Verification (end-to-end, after each phase and at the end)

1. Server: `cd server && node --env-file=.env.test --test` (full suite; wait 70 s between runs for the limiter), then `RBAC_MATRIX_UPDATE=1 … rbac.matrix.test.js` and review the fixture diff cell by cell.
2. Client: `npx tsc --noEmit`, `npx eslint .`, `node --import ./scripts/ts-resolve-hook.mjs --test test/*.test.ts`, `npx next build`.
3. Dev DB: apply migrations (`npx prisma migrate deploy`), run `scripts/backfill-booking-index.js` and `scripts/backfill-deadlines.js` (dry run first), seed demo data (`scripts/seed-b2b-demo.js`).
4. Browser walk (Chrome extension or Playwright/Edge per `qa/e2e`): partner books hotel + transfer + package through the cart without payment → appears in Booking approvals with notification and badge → admin approves → proforma issued with per-room/per-leg lines (sandbox PDF checked) → deadlines appear on the calendar → reminder fires on a forced offset → Finance records a payment → VAT invoice → booking shows Confirmed · Paid in every list and filter. Repeat for an admin-created booking for a new company customer with `confirmNow`.
5. Newman: `npx newman run` the collection with the new folders; only the known pre-existing failures may remain.

---

## Status (updated 2026-10-20)

| Phase | State | Notes |
|---|---|---|
| 0 Foundations | DONE 2026-10-20 | caps `bookings.approve` / `bookings.price.override` / `bookings.deadlines.write` / `settings.reminders.write`; `config.booking`; `lib/booking/{approval,machines,source}.js`, `lib/finance/paymentStatus.js`; `source` derived from the session |
| 1 Lifecycle and approval | server DONE 2026-10-20, client in progress | migrations `20261020100000/100100`; `services/booking/approval.service.js`; routes `/admin/booking-approvals`; `approval` + `payment` blocks on every booking/order; sweeper; 4 templates; `test/booking.approval.test.js` (12); matrix +3 routes; full suite 1209/1210 (known count race). Flag `BOOKING_APPROVAL_ENABLED` off until the client ships |
| 2 Notifications | server DONE 2026-10-20, client pending | migration `20261020101000`; `category` + `dedupeKey` on notifications; `lib/notifications/categories.js`; `serializers/notification.js` (server-side `href`); list filters `category`/`kind[]`/`sort`; `unread-count` per tab; read-all per tab; events `booking.created`/`booking.modified` → `BOOKING_NEW`/`BOOKING_MODIFIED`; `test/notifications.filters.test.js` (3). Client: sidebar item, tabs, 60 s polling still to do |
| 3 Manual bookings | server DONE 2026-10-20, client pending | migrations `20261020110000/110100`; `Customer` table; `source` is now `BookingSource` (WEB/PARTNER/ADMIN/PHONE/EMAIL/EXTERNAL_AGENCY/DIRECT/DEMO); desk columns (customer, manager, notes, price adjustment) on 5 tables; `lib/booking/{desk,onBehalf}.js`; `services/booking/{customer,manual}.service.js`; routes `/admin/customers`, `…/manual`, `…/:reference/desk` ×5; `X-Act-As-Partner` header on search/quote routers; ledger/invoicing debtor customer; `test/bookings.manual.test.js` (6); matrix +14 routes. Client: create-booking wizard, customers pages, desk panel still to do |
| 4 Booking index and filters | server DONE 2026-10-20, client pending | migration `20261020120000` (`booking_index` + pg_trgm GIN + created_at indexes); `services/booking/index.service.js` (sync hooked into the three ledger syncs, payments, settlement, amends, desk; daily reconcile; `scripts/backfill-booking-index.js` run on the dev DB: 325 rows); `lib/listing/bookingFilters.js` on all five registers; `GET /admin/bookings/all` + `/partner/bookings/all`; `test/bookings.index.test.js` (4); matrix +2 routes. Client: FilterBar, Pager, all-bookings page, service bookings page, transfer list fixes still to do |
| 5 Invoice line detail | server DONE 2026-10-20 (sandbox check still owed) | migration `20261020130000` (`invoice_lines.kind/unit_cents/detail` + immutability trigger, `transfer_booking_legs.flight_number`, guest/traveller `title`); `services/invoicing/lines.js` builds one line per room / per leg with structured `detail` + `text`; adapter sends `description` per position; `flights: {outbound, return}` on transfer confirm/amend; `title` on leads/guests/travellers; `test/invoicing.lines.unit.test.js` rewritten. NOT verified against the real InvoiceOcean account: whether the PDF prints `description` with line breaks — run one proforma from the owner's test account and look |
| 6 Deadlines and reminders | DONE 2026-10-20 (server + client) | migrations `20261020140000/140100` (`booking_deadlines`, history, `deadline_reminders`, `reminder_policies` seeded 7/3/1/0 · 3/1 · 1/0); `services/booking/deadline.service.js` (projection synced beside the index; `moveDeadline` by kind: PAYMENT via `adjustReceivableInTx` + Finance's second-person rule, FREE_CANCELLATION rewrites the frozen schedule via `moveFreeCancellationUntil`, CONFIRMATION moves the SLA columns; `sweepDeadlineReminders` claims per policy; handler `DEADLINE_UPCOMING` + template `deadlineReminder`); routes `/admin/deadlines`, `/admin/settings/reminder-policies`, `/partner/deadlines`; flag `DEADLINE_REMINDERS_ENABLED` (off); `test/deadlines.test.js` (7); matrix +6 routes. Client done by agent: `/admin/deadlines` (MonthGrid month/week/day, DeadlineModal with edit + history), `BookingDeadlinesPanel` on 5 detail pages, `/admin/settings/reminders` (`ReminderPoliciesEditor`), dashboard widget `deadlinesWeek`, portal `PortalDeadlinesPanel`; `?reference=`/`?bookingId=` added to the deadline list, names on rows, `remove: true` needs no schedule. ka/ru/he strings machine-translated — native review owed |
| 7 Unified cart | DONE 2026-10-20 (server + client) | migration `20261020150000_custom_orders` (`order_items.package_id/package_slot_index/group_key/adjustment_source`, CHECK `orders_custom_has_no_package`, package orders' items backfilled); `prepareOrder` split into `preparePackageGroup` + `services/order/cart.service.js` (`prepareCustomOrder`, `quoteCustomOrder`, `holdCustomOffers`, `confirmCustomOrder`); routes `POST /orders/custom`, `/orders/custom/quote`, `POST/DELETE /orders/custom/holds` behind `CART_ENABLED` (404 `CART_DISABLED`), `POST /admin/orders/custom/manual` (desk, always on); item serializer carries `packageId/packageSlotIndex/groupKey/adjustmentSource`; `test/orders.custom.test.js` (7); matrix +5 routes. Public client done by agent: `lib/booking/cart.ts` (`iag:cart`, v1, one currency, 20 items), `AddToCartButton` on rooms/departures/transfer form/package builder, header `CartLink`, `/cart` (`CartView` with quote refresh), `/cart/checkout` (`CartCheckoutForm`: holds + countdown + per-item 409 handling), CUSTOM branch in `OrderDetail`/`OrderItems`; flag `NEXT_PUBLIC_CART_ENABLED` (`.env.local.example`); the quote now hides `componentsNetCents` from non-margin viewers. Desk multi-item create done by agent: wizard holds a list of lines (hotel/transfer/tour/service/package via `PackageQuotePanel`), Review re-prices through `POST /orders/custom/quote` as the buyer (`X-Act-As-Partner` now honoured on `/orders/custom/quote` and `/holds`), one line → product `/manual`, several or a package → `createManualBooking('CART')` → `/admin/orders/custom/manual`, 409 per-item errors mapped back to lines; `BookingDeadlinesPanel` reads `?reference=`; all-bookings Buyer column shows names. No browser walk done |
| 8 Integration | in progress 2026-10-20 | API.md complete through the cart; `docs/DEPLOYMENT.md` flag rows; full server suite after Phase 7: 1229/1234, the five failures (`admin.summaries`, `notifications.admin`, `deadlines` history count, `tours.admin` whole-file) pass on their own — cross-file count races, pre-existing kind. Postman: 7 folders (`04g`, `06r`–`06w`, 165 requests) + guide Parts 13–19 + `docs/postman/README.md` by agent; newman 879/882 — the 3 failures were real defects, all fixed the same day (cart quote net leak, customer PATCH `{}` resetting kind, partner `/bookings/all` admin hrefs) plus transfer rows now carry `source`. Final client gates green after the last agent (tsc clean, eslint 0 errors/15 pre-existing warnings, 121 tests, build OK); final server suite 1232/1236 (known races). Still owed: a browser walk of the new flows with the flags on, the InvoiceOcean sandbox PDF check, native review of ka/ru/he strings, turning `BOOKING_APPROVAL_ENABLED` / `CART_ENABLED` / `NEXT_PUBLIC_CART_ENABLED` / `DEADLINE_REMINDERS_ENABLED` on at deploy |
