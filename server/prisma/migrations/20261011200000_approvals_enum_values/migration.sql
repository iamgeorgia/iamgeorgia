-- Enum values for approval requests.
--
-- In their own migration, before anything that uses them: Postgres refuses to
-- use a value added to an enum inside the transaction that added it.

ALTER TYPE "audit_action" ADD VALUE 'APPROVAL_REQUESTED';
ALTER TYPE "audit_action" ADD VALUE 'APPROVAL_APPROVED';
ALTER TYPE "audit_action" ADD VALUE 'APPROVAL_REJECTED';
ALTER TYPE "audit_action" ADD VALUE 'APPROVAL_CANCELLED';
-- Notes on a payable or receivable were the one finance edit nothing recorded.
ALTER TYPE "audit_action" ADD VALUE 'PAYABLE_NOTES_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'RECEIVABLE_NOTES_CHANGED';

ALTER TYPE "notification_kind" ADD VALUE 'APPROVAL_REQUESTED';
ALTER TYPE "notification_kind" ADD VALUE 'APPROVAL_DECIDED';
