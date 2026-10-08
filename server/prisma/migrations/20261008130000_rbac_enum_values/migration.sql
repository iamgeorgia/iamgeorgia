-- Enum values for staff roles and user lifecycle auditing.
--
-- In their own migration, before anything that uses them: Postgres refuses to
-- use a value added to an enum inside the transaction that added it, so the
-- CHECK constraint in the next migration that names the new roles would fail
-- here. Same discipline as 20260905181000_packages_orders_enum_values.

-- Three more platform-side roles. Each is narrower than ADMIN, which until now
-- was the only staff role with a seat in the admin panel.
ALTER TYPE "role" ADD VALUE 'MANAGEMENT';
ALTER TYPE "role" ADD VALUE 'RESERVATIONS';
ALTER TYPE "role" ADD VALUE 'FINANCE';

-- The user lifecycle, now that accounts are created and retired by other
-- users rather than by the CLI alone.
ALTER TYPE "audit_action" ADD VALUE 'USER_INVITED';
ALTER TYPE "audit_action" ADD VALUE 'USER_ROLE_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'USER_DEACTIVATED';
ALTER TYPE "audit_action" ADD VALUE 'USER_REACTIVATED';
ALTER TYPE "audit_action" ADD VALUE 'USER_DELETED';
ALTER TYPE "audit_action" ADD VALUE 'USER_SESSIONS_REVOKED';
ALTER TYPE "audit_action" ADD VALUE 'USER_LOGIN_SUCCEEDED';
ALTER TYPE "audit_action" ADD VALUE 'USER_LOGGED_OUT';
ALTER TYPE "audit_action" ADD VALUE 'USER_PRIMARY_CONTACT_CHANGED';
