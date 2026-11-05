-- Enum values and types for manual (desk) bookings.
--
-- In their own migration, before anything that uses them: Postgres refuses to
-- use a value added to an enum inside the transaction that added it.

ALTER TYPE "audit_action" ADD VALUE 'BOOKING_PRICE_ADJUSTED';
ALTER TYPE "audit_action" ADD VALUE 'BOOKING_MANAGER_ASSIGNED';
ALTER TYPE "audit_action" ADD VALUE 'BOOKING_NOTES_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'CUSTOMER_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'CUSTOMER_UPDATED';

-- Where a booking came from, as a type rather than free text: the session
-- decides WEB / PARTNER / ADMIN, the desk names PHONE / EMAIL /
-- EXTERNAL_AGENCY / DIRECT, and seeded rows are DEMO.
CREATE TYPE "booking_source" AS ENUM ('WEB', 'PARTNER', 'ADMIN', 'PHONE', 'EMAIL', 'EXTERNAL_AGENCY', 'DIRECT', 'DEMO');
CREATE TYPE "customer_kind" AS ENUM ('INDIVIDUAL', 'COMPANY');
