-- Enum values for the booking approval step (owner decision OD1, 2026-10-20).
--
-- In their own migration, before anything that uses them: Postgres refuses to
-- use a value added to an enum inside the transaction that added it.

-- The platform's wait, distinct from PENDING (the supplier's wait) so that
-- every existing `= 'PENDING'` branch — the on-request sweepers, the
-- supplier emails, the badges — stays right by default.
ALTER TYPE "hotel_booking_status" ADD VALUE 'PENDING_APPROVAL' BEFORE 'PENDING';
ALTER TYPE "transfer_booking_status" ADD VALUE 'PENDING_APPROVAL' BEFORE 'PENDING';
ALTER TYPE "tour_booking_status" ADD VALUE 'PENDING_APPROVAL' BEFORE 'PENDING';
ALTER TYPE "service_booking_status" ADD VALUE 'PENDING_APPROVAL' BEFORE 'PENDING';
ALTER TYPE "order_status" ADD VALUE 'PENDING_APPROVAL' BEFORE 'PENDING_CONFIRMATION';
ALTER TYPE "order_item_status" ADD VALUE 'AWAITING_APPROVAL' BEFORE 'REQUESTED';

CREATE TYPE "booking_approval_mode" AS ENUM ('AUTO', 'REQUIRED');

ALTER TYPE "audit_action" ADD VALUE 'BOOKING_APPROVED';
ALTER TYPE "audit_action" ADD VALUE 'BOOKING_REJECTED';
ALTER TYPE "audit_action" ADD VALUE 'BOOKING_APPROVAL_EXPIRED';
ALTER TYPE "audit_action" ADD VALUE 'PARTNER_BOOKING_APPROVAL_CHANGED';

ALTER TYPE "notification_kind" ADD VALUE 'BOOKING_NEW';
ALTER TYPE "notification_kind" ADD VALUE 'BOOKING_AWAITING_APPROVAL';
ALTER TYPE "notification_kind" ADD VALUE 'BOOKING_APPROVED';
ALTER TYPE "notification_kind" ADD VALUE 'BOOKING_REJECTED';
ALTER TYPE "notification_kind" ADD VALUE 'BOOKING_APPROVAL_OVERDUE';
ALTER TYPE "notification_kind" ADD VALUE 'BOOKING_MODIFIED';
ALTER TYPE "notification_kind" ADD VALUE 'SYSTEM';
