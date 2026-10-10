-- Enum values for commission records, cancellation penalties and credit limits.
--
-- In their own migration, before anything that uses them: Postgres refuses to
-- use a value added to an enum inside the transaction that added it.

ALTER TYPE "audit_action" ADD VALUE 'PARTNER_CREDIT_LIMIT_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'PARTNER_CREDIT_WARNING';
ALTER TYPE "audit_action" ADD VALUE 'PENALTY_OVERRIDDEN';

-- A penalty override is one more thing a second person decides.
ALTER TYPE "approval_kind" ADD VALUE 'PENALTY_OVERRIDE';

ALTER TYPE "notification_kind" ADD VALUE 'FINANCE_CREDIT_WARNING';
