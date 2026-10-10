-- Enum values for the contract gate, the two new partner statuses and
-- per-partner product access.
--
-- In their own migration, before anything that uses them: Postgres refuses to
-- use a value added to an enum inside the transaction that added it.

ALTER TYPE "partner_status" ADD VALUE 'BLOCKED';
ALTER TYPE "partner_status" ADD VALUE 'TERMINATED';

ALTER TYPE "audit_action" ADD VALUE 'PARTNER_CONTRACT_UPLOADED';
ALTER TYPE "audit_action" ADD VALUE 'PARTNER_TERMS_ACCEPTED';
ALTER TYPE "audit_action" ADD VALUE 'PARTNER_BLOCKED';
ALTER TYPE "audit_action" ADD VALUE 'PARTNER_UNBLOCKED';
ALTER TYPE "audit_action" ADD VALUE 'PARTNER_TERMINATED';
ALTER TYPE "audit_action" ADD VALUE 'PARTNER_PRODUCT_ACCESS_CHANGED';

CREATE TYPE "access_mode" AS ENUM ('ALLOW', 'DENY');
