-- Enum values for card payments through a provider (Flitt).
-- docs/plans/FLITT_INTEGRATION_PLAN.md §8.1.
--
-- In their own migration, before anything that writes them: Postgres refuses
-- to use a value added to an enum inside the transaction that added it.

ALTER TYPE "audit_action" ADD VALUE 'PSP_PAYMENT_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'PSP_PAYMENT_APPROVED';
ALTER TYPE "audit_action" ADD VALUE 'PSP_PAYMENT_DECLINED';
ALTER TYPE "audit_action" ADD VALUE 'PSP_PAYMENT_EXPIRED';
ALTER TYPE "audit_action" ADD VALUE 'PSP_PAYMENT_CANCELLED';
ALTER TYPE "audit_action" ADD VALUE 'PSP_PAYMENT_MISMATCH';
ALTER TYPE "audit_action" ADD VALUE 'PSP_PAYMENT_REVERSED';
ALTER TYPE "audit_action" ADD VALUE 'PSP_CALLBACK_REJECTED';
ALTER TYPE "audit_action" ADD VALUE 'PSP_STATUS_CHECKED';
ALTER TYPE "audit_action" ADD VALUE 'PSP_REFUND_REQUESTED';
ALTER TYPE "audit_action" ADD VALUE 'PSP_REFUND_APPROVED';
ALTER TYPE "audit_action" ADD VALUE 'PSP_REFUND_FAILED';
ALTER TYPE "audit_action" ADD VALUE 'PSP_RECONCILIATION_MISMATCH';
ALTER TYPE "audit_action" ADD VALUE 'BOOKING_AUTO_CANCELLED_UNPAID';

ALTER TYPE "notification_kind" ADD VALUE 'PSP_PAYMENT_MISMATCH';
ALTER TYPE "notification_kind" ADD VALUE 'PSP_CALLBACK_REJECTED';
ALTER TYPE "notification_kind" ADD VALUE 'PSP_REFUND_FAILED';
ALTER TYPE "notification_kind" ADD VALUE 'PSP_RECONCILIATION_MISMATCH';
ALTER TYPE "notification_kind" ADD VALUE 'PSP_ALERT';

CREATE TYPE "payment_provider" AS ENUM ('FLITT');
CREATE TYPE "psp_mode" AS ENUM ('TEST', 'LIVE');
CREATE TYPE "psp_payment_status" AS ENUM ('CREATED', 'REDIRECT_READY', 'PROCESSING', 'APPROVED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'REVERSED', 'MISMATCH', 'FAILED');
CREATE TYPE "psp_refund_status" AS ENUM ('REQUESTED', 'SUBMITTED', 'APPROVED', 'DECLINED', 'FAILED');
