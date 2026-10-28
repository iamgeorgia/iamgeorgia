-- Enum values and types for booking deadlines and their reminders.
--
-- In their own migration, before anything that uses them: Postgres refuses to
-- use a value added to an enum inside the transaction that added it.

CREATE TYPE "deadline_kind" AS ENUM ('PAYMENT', 'FREE_CANCELLATION', 'CONFIRMATION');
CREATE TYPE "deadline_status" AS ENUM ('OPEN', 'MET', 'MISSED', 'CANCELLED');
CREATE TYPE "deadline_source" AS ENUM ('SYSTEM', 'MANUAL');

ALTER TYPE "audit_action" ADD VALUE 'BOOKING_DEADLINE_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'REMINDER_POLICY_UPDATED';

ALTER TYPE "notification_kind" ADD VALUE 'DEADLINE_PAYMENT_UPCOMING';
ALTER TYPE "notification_kind" ADD VALUE 'DEADLINE_CANCELLATION_UPCOMING';
ALTER TYPE "notification_kind" ADD VALUE 'DEADLINE_CONFIRMATION_UPCOMING';
