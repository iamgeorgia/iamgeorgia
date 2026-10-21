-- Enum values for the Gmail API mail transport and its administrator OAuth flow.
--
-- In their own migration, before anything that uses them: Postgres refuses to
-- use a value added to an enum inside the transaction that added it.

ALTER TYPE "audit_action" ADD VALUE 'MAIL_PROVIDER_CONNECTED';
ALTER TYPE "audit_action" ADD VALUE 'MAIL_PROVIDER_CONNECT_REJECTED';
ALTER TYPE "audit_action" ADD VALUE 'MAIL_PROVIDER_DISCONNECTED';
ALTER TYPE "audit_action" ADD VALUE 'MAIL_PROVIDER_REVOKED';
ALTER TYPE "audit_action" ADD VALUE 'MAIL_PROVIDER_TEST_SENT';

ALTER TYPE "notification_kind" ADD VALUE 'MAIL_PROVIDER_ALERT';
