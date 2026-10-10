-- Enum values for roles kept as data.
--
-- In their own migration, before anything that uses them: Postgres refuses to
-- use a value added to an enum inside the transaction that added it. Same
-- discipline as 20261008130000_rbac_enum_values.

-- Roles are edited and users given several, so the trail says who changed
-- what a role may do, who was given or relieved of a role, and who was
-- granted or denied a capability by name.
ALTER TYPE "audit_action" ADD VALUE 'ROLE_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'ROLE_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'ROLE_DELETED';
ALTER TYPE "audit_action" ADD VALUE 'USER_ROLES_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'USER_OVERRIDE_GRANTED';
ALTER TYPE "audit_action" ADD VALUE 'USER_OVERRIDE_REVOKED';
