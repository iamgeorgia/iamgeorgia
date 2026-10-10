-- The renamed roles, as data, and the primary-role CHECK told the new names.
--
-- Hand-written; the enum values came in the migration before this one.
-- Capabilities are untouched here: this commit only renames, so that the
-- route-by-role matrix proves the rename pure before anything widens.

UPDATE "roles"
   SET "key" = 'ACCOUNTANT', "name" = 'Accountant', "updated_at" = now()
 WHERE "key" = 'FINANCE';

UPDATE "roles"
   SET "key" = 'TOUR_OPERATOR', "name" = 'Tour operator', "updated_at" = now()
 WHERE "key" = 'RESERVATIONS';

-- The CHECK's stored expression followed the rename by itself (enum labels
-- are compared by identity, not by text); it is recreated so that it reads
-- as it enforces, and so FINANCE_OPERATOR is a platform role from the start.
ALTER TABLE "users" DROP CONSTRAINT "users_partner_role_requires_partner";
ALTER TABLE "users" ADD CONSTRAINT "users_partner_role_requires_partner" CHECK (
    ("role" IN ('SUPER_ADMIN', 'ADMIN', 'MANAGEMENT', 'TOUR_OPERATOR', 'ACCOUNTANT', 'FINANCE_OPERATOR', 'DISPATCHER', 'DRIVER') AND "partner_id" IS NULL)
    OR ("role" IN ('PARTNER_OWNER', 'PARTNER_ADMIN', 'PARTNER_AGENT', 'PARTNER_FINANCE') AND "partner_id" IS NOT NULL)
);
