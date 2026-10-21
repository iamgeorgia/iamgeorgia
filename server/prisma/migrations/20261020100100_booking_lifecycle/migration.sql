-- Booking approval (owner decision OD1, 2026-10-20): every booking waits for
-- an operator's yes before it is confirmed, holding its inventory meanwhile.
--
-- Hand-written, in Prisma's own naming so a later `migrate dev` sees no
-- drift. (If it ever proposes `DROP INDEX "*_geo_idx"` alongside, strip those
-- lines: Prisma cannot see the PostGIS indexes.)

-- Per partner: REQUIRED for everyone, existing companies included. AUTO is
-- an admin's exception for a trusted agency and is never set by migration.
ALTER TABLE "partners" ADD COLUMN "booking_approval" "booking_approval_mode" NOT NULL DEFAULT 'REQUIRED';

-- The approval stamps, on every booking table and on orders. Names are a
-- snapshot beside the id, so a deleted account still signs the decision.
ALTER TABLE "hotel_bookings"
    ADD COLUMN "approval_requested_at"     TIMESTAMP(3),
    ADD COLUMN "approval_deadline_at"      TIMESTAMP(3),
    ADD COLUMN "approval_overdue_alert_at" TIMESTAMP(3),
    ADD COLUMN "approved_at"               TIMESTAMP(3),
    ADD COLUMN "approved_by_user_id"       TEXT,
    ADD COLUMN "approved_by_name"          TEXT,
    ADD COLUMN "rejected_at"               TIMESTAMP(3),
    ADD COLUMN "rejected_by_user_id"       TEXT,
    ADD COLUMN "rejected_by_name"          TEXT,
    ADD COLUMN "rejection_reason"          TEXT;

ALTER TABLE "transfer_bookings"
    ADD COLUMN "approval_requested_at"     TIMESTAMP(3),
    ADD COLUMN "approval_deadline_at"      TIMESTAMP(3),
    ADD COLUMN "approval_overdue_alert_at" TIMESTAMP(3),
    ADD COLUMN "approved_at"               TIMESTAMP(3),
    ADD COLUMN "approved_by_user_id"       TEXT,
    ADD COLUMN "approved_by_name"          TEXT,
    ADD COLUMN "rejected_at"               TIMESTAMP(3),
    ADD COLUMN "rejected_by_user_id"       TEXT,
    ADD COLUMN "rejected_by_name"          TEXT,
    ADD COLUMN "rejection_reason"          TEXT,
    -- A partner's chosen driver and car, offered at approval rather than at booking.
    ADD COLUMN "preferred_driver_id"        TEXT,
    ADD COLUMN "preferred_fleet_vehicle_id" TEXT;

ALTER TABLE "tour_bookings"
    ADD COLUMN "approval_requested_at"     TIMESTAMP(3),
    ADD COLUMN "approval_deadline_at"      TIMESTAMP(3),
    ADD COLUMN "approval_overdue_alert_at" TIMESTAMP(3),
    ADD COLUMN "approved_at"               TIMESTAMP(3),
    ADD COLUMN "approved_by_user_id"       TEXT,
    ADD COLUMN "approved_by_name"          TEXT,
    ADD COLUMN "rejected_at"               TIMESTAMP(3),
    ADD COLUMN "rejected_by_user_id"       TEXT,
    ADD COLUMN "rejected_by_name"          TEXT,
    ADD COLUMN "rejection_reason"          TEXT;

ALTER TABLE "service_bookings"
    ADD COLUMN "approval_requested_at"     TIMESTAMP(3),
    ADD COLUMN "approval_deadline_at"      TIMESTAMP(3),
    ADD COLUMN "approval_overdue_alert_at" TIMESTAMP(3),
    ADD COLUMN "approved_at"               TIMESTAMP(3),
    ADD COLUMN "approved_by_user_id"       TEXT,
    ADD COLUMN "approved_by_name"          TEXT,
    ADD COLUMN "rejected_at"               TIMESTAMP(3),
    ADD COLUMN "rejected_by_user_id"       TEXT,
    ADD COLUMN "rejected_by_name"          TEXT,
    ADD COLUMN "rejection_reason"          TEXT;

ALTER TABLE "orders"
    ADD COLUMN "approval_requested_at"     TIMESTAMP(3),
    ADD COLUMN "approval_deadline_at"      TIMESTAMP(3),
    ADD COLUMN "approval_overdue_alert_at" TIMESTAMP(3),
    ADD COLUMN "approved_at"               TIMESTAMP(3),
    ADD COLUMN "approved_by_user_id"       TEXT,
    ADD COLUMN "approved_by_name"          TEXT,
    ADD COLUMN "rejected_at"               TIMESTAMP(3),
    ADD COLUMN "rejected_by_user_id"       TEXT,
    ADD COLUMN "rejected_by_name"          TEXT,
    ADD COLUMN "rejection_reason"          TEXT;

-- The approvals queue sorts on the deadline and the sweeper reads past it.
CREATE INDEX "hotel_bookings_status_approval_deadline_at_idx" ON "hotel_bookings"("status", "approval_deadline_at");
CREATE INDEX "transfer_bookings_status_approval_deadline_at_idx" ON "transfer_bookings"("status", "approval_deadline_at");
CREATE INDEX "tour_bookings_status_approval_deadline_at_idx" ON "tour_bookings"("status", "approval_deadline_at");
CREATE INDEX "service_bookings_status_approval_deadline_at_idx" ON "service_bookings"("status", "approval_deadline_at");
CREATE INDEX "orders_status_approval_deadline_at_idx" ON "orders"("status", "approval_deadline_at");

-- Who may approve, override a price, move a deadline and set the reminder
-- schedule, added to the seeded roles (and nothing taken away, so a role
-- edited in the panel keeps its edits). Mirrors DEFAULT_ROLE_LISTS in
-- lib/permissions.js; `test/rbac.seed.test.js` checks the two agree.
INSERT INTO "role_capabilities" ("role_id", "capability")
SELECT r."id", c.capability
  FROM "roles" r
  JOIN (VALUES
        ('SUPER_ADMIN', 'bookings.approve'),
        ('ADMIN', 'bookings.approve'),
        ('TOUR_OPERATOR', 'bookings.approve'),
        ('SUPER_ADMIN', 'bookings.price.override'),
        ('ADMIN', 'bookings.price.override'),
        ('SUPER_ADMIN', 'bookings.deadlines.write'),
        ('ADMIN', 'bookings.deadlines.write'),
        ('TOUR_OPERATOR', 'bookings.deadlines.write'),
        ('SUPER_ADMIN', 'settings.reminders.write'),
        ('ADMIN', 'settings.reminders.write')
       ) AS c(role_key, capability) ON c.role_key = r."key"
ON CONFLICT DO NOTHING;
