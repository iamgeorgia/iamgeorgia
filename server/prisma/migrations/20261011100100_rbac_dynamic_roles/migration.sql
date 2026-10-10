-- Roles as data.
--
-- Hand-written, in Prisma's own naming so a later `migrate dev` sees no
-- drift. (If it ever proposes `DROP INDEX "*_geo_idx"` alongside, strip those
-- lines: Prisma cannot see the PostGIS indexes.)
--
-- A capability stays a string named in code: each one is a check somewhere,
-- and a row cannot invent a check. Which capabilities a role carries, which
-- roles a user holds, and the odd capability granted to or taken from a user
-- by name, become rows. `users.role` stays as the primary role for now,
-- kept in step with `user_roles` by a trigger, so nothing that creates a
-- user has to learn a second table until the column goes.

CREATE TYPE "role_side" AS ENUM ('PLATFORM', 'PARTNER');
CREATE TYPE "override_effect" AS ENUM ('GRANT', 'DENY');

CREATE TABLE "roles" (
    "id"          TEXT NOT NULL,
    "key"         TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "side"        "role_side" NOT NULL,
    "is_system"   BOOLEAN NOT NULL DEFAULT false,
    "sort_order"  INTEGER NOT NULL DEFAULT 0,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

CREATE TABLE "role_capabilities" (
    "role_id"    TEXT NOT NULL,
    "capability" TEXT NOT NULL,

    CONSTRAINT "role_capabilities_pkey" PRIMARY KEY ("role_id", "capability")
);

CREATE INDEX "role_capabilities_capability_idx" ON "role_capabilities"("capability");

ALTER TABLE "role_capabilities"
    ADD CONSTRAINT "role_capabilities_role_id_fkey"
        FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_roles" (
    "user_id"            TEXT NOT NULL,
    "role_id"            TEXT NOT NULL,
    "granted_by_user_id" TEXT,
    "granted_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id")
);

CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

ALTER TABLE "user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT: a role with members cannot be deleted from under them.
ALTER TABLE "user_roles"
    ADD CONSTRAINT "user_roles_role_id_fkey"
        FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "user_capability_overrides" (
    "id"                 TEXT NOT NULL,
    "user_id"            TEXT NOT NULL,
    "capability"         TEXT NOT NULL,
    "effect"             "override_effect" NOT NULL,
    "reason"             TEXT NOT NULL,
    "expires_at"         TIMESTAMP(3),
    "granted_by_user_id" TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_capability_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_capability_overrides_user_id_capability_key"
    ON "user_capability_overrides"("user_id", "capability");

ALTER TABLE "user_capability_overrides"
    ADD CONSTRAINT "user_capability_overrides_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A user's roles sit on one side, and that side matches the account: a
-- platform role on an account with no partner, a partner role on one with.
-- The CHECK on users.role says the same for the primary role; this says it
-- for all of them, which a CHECK cannot, because it would have to look
-- across a table.
CREATE OR REPLACE FUNCTION rbac_check_user_sides(the_user_id TEXT) RETURNS void AS $$
DECLARE
    has_partner    BOOLEAN;
    platform_count INTEGER;
    partner_count  INTEGER;
BEGIN
    SELECT ("partner_id" IS NOT NULL) INTO has_partner FROM "users" WHERE "id" = the_user_id;

    IF has_partner IS NULL THEN
        RETURN;
    END IF;

    SELECT COUNT(*) FILTER (WHERE r."side" = 'PLATFORM'), COUNT(*) FILTER (WHERE r."side" = 'PARTNER')
      INTO platform_count, partner_count
      FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id"
     WHERE ur."user_id" = the_user_id;

    IF platform_count > 0 AND partner_count > 0 THEN
        RAISE EXCEPTION 'rbac_user_roles_one_side' USING ERRCODE = '23514';
    END IF;

    IF platform_count > 0 AND has_partner THEN
        RAISE EXCEPTION 'rbac_platform_role_requires_no_partner' USING ERRCODE = '23514';
    END IF;

    IF partner_count > 0 AND NOT has_partner THEN
        RAISE EXCEPTION 'rbac_partner_role_requires_partner' USING ERRCODE = '23514';
    END IF;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION rbac_user_roles_side_trg() RETURNS trigger AS $$
BEGIN
    PERFORM rbac_check_user_sides(NEW."user_id");
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "user_roles_side"
    AFTER INSERT OR UPDATE ON "user_roles"
    FOR EACH ROW EXECUTE FUNCTION rbac_user_roles_side_trg();

CREATE OR REPLACE FUNCTION rbac_users_side_trg() RETURNS trigger AS $$
BEGIN
    PERFORM rbac_check_user_sides(NEW."id");
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_side"
    AFTER UPDATE OF "partner_id" ON "users"
    FOR EACH ROW EXECUTE FUNCTION rbac_users_side_trg();

-- The primary role, kept in step: whatever writes users.role — a sign-up, a
-- seed, a factory, the CLI — gives the account the matching row here, and a
-- change of primary role swaps that one row and leaves any others the user
-- was given alone.
CREATE OR REPLACE FUNCTION rbac_sync_primary_role() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD."role" IS DISTINCT FROM NEW."role" THEN
        DELETE FROM "user_roles"
         WHERE "user_id" = NEW."id"
           AND "role_id" = (SELECT "id" FROM "roles" WHERE "key" = OLD."role"::text);
    END IF;

    INSERT INTO "user_roles" ("user_id", "role_id")
    SELECT NEW."id", r."id" FROM "roles" r WHERE r."key" = NEW."role"::text
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_primary_role"
    AFTER INSERT OR UPDATE OF "role" ON "users"
    FOR EACH ROW EXECUTE FUNCTION rbac_sync_primary_role();

-- The system roles and what each may do, generated from lib/permissions.js
-- DEFAULT_ROLE_LISTS as it stood when this migration was written, so the
-- seed is provably the table the code enforced up to now.
INSERT INTO "roles" ("id", "key", "name", "description", "side", "is_system", "sort_order", "created_at", "updated_at") VALUES
    ('role_super_admin', 'SUPER_ADMIN', 'Super admin', 'Everything, including the staff accounts and the audit log.', 'PLATFORM', true, 10, now(), now()),
    ('role_admin', 'ADMIN', 'Administrator', 'Runs everything except the staff accounts and the books: reads every figure, records no payments.', 'PLATFORM', true, 20, now(), now()),
    ('role_management', 'MANAGEMENT', 'Management', 'Reads everything, margins included; changes nothing.', 'PLATFORM', true, 30, now(), now()),
    ('role_reservations', 'RESERVATIONS', 'Reservations', 'Runs the bookings desk: creates, amends, cancels; never sees a margin.', 'PLATFORM', true, 40, now(), now()),
    ('role_finance', 'FINANCE', 'Finance', 'Records the money and reads what it needs to reconcile it.', 'PLATFORM', true, 50, now(), now()),
    ('role_dispatcher', 'DISPATCHER', 'Dispatcher', 'Assigns drivers and cars; reads the catalogue to do it; no money, no partners.', 'PLATFORM', true, 60, now(), now()),
    ('role_driver', 'DRIVER', 'Driver', 'A linked driver: its own jobs, in its own panel.', 'PLATFORM', true, 70, now(), now()),
    ('role_partner_owner', 'PARTNER_OWNER', 'Owner', 'The company: profile, bank details, team, bookings, inventory, statement.', 'PARTNER', true, 80, now(), now()),
    ('role_partner_admin', 'PARTNER_ADMIN', 'Admin', 'Profile, team, bookings and inventory; not the bank details.', 'PARTNER', true, 90, now(), now()),
    ('role_partner_agent', 'PARTNER_AGENT', 'Agent', 'Books, amends and cancels for the company.', 'PARTNER', true, 100, now(), now()),
    ('role_partner_finance', 'PARTNER_FINANCE', 'Finance', 'Reads bookings and the statement; keeps the bank details; books nothing.', 'PARTNER', true, 110, now(), now());

INSERT INTO "role_capabilities" ("role_id", "capability") VALUES
    ('role_super_admin', 'audit.read'),
    ('role_super_admin', 'bookings.cancel'),
    ('role_super_admin', 'bookings.read'),
    ('role_super_admin', 'bookings.write'),
    ('role_super_admin', 'catalogue.read'),
    ('role_super_admin', 'catalogue.write'),
    ('role_super_admin', 'dispatch.read'),
    ('role_super_admin', 'dispatch.write'),
    ('role_super_admin', 'finance.export'),
    ('role_super_admin', 'finance.margin.read'),
    ('role_super_admin', 'finance.payables.read'),
    ('role_super_admin', 'finance.payments.read'),
    ('role_super_admin', 'finance.payments.write'),
    ('role_super_admin', 'finance.receivables.read'),
    ('role_super_admin', 'finance.reports.read'),
    ('role_super_admin', 'finance.terms.write'),
    ('role_super_admin', 'invoices.read'),
    ('role_super_admin', 'invoices.write'),
    ('role_super_admin', 'notifications.read'),
    ('role_super_admin', 'partners.financial.read'),
    ('role_super_admin', 'partners.read'),
    ('role_super_admin', 'partners.write'),
    ('role_super_admin', 'platform.admin'),
    ('role_super_admin', 'pricing.write'),
    ('role_super_admin', 'settings.write'),
    ('role_super_admin', 'users.staff.manage'),
    ('role_admin', 'audit.read'),
    ('role_admin', 'bookings.cancel'),
    ('role_admin', 'bookings.read'),
    ('role_admin', 'bookings.write'),
    ('role_admin', 'catalogue.read'),
    ('role_admin', 'catalogue.write'),
    ('role_admin', 'dispatch.read'),
    ('role_admin', 'dispatch.write'),
    ('role_admin', 'finance.export'),
    ('role_admin', 'finance.margin.read'),
    ('role_admin', 'finance.payables.read'),
    ('role_admin', 'finance.payments.read'),
    ('role_admin', 'finance.receivables.read'),
    ('role_admin', 'finance.reports.read'),
    ('role_admin', 'invoices.read'),
    ('role_admin', 'notifications.read'),
    ('role_admin', 'partners.financial.read'),
    ('role_admin', 'partners.read'),
    ('role_admin', 'partners.write'),
    ('role_admin', 'platform.admin'),
    ('role_admin', 'pricing.write'),
    ('role_management', 'audit.read'),
    ('role_management', 'bookings.read'),
    ('role_management', 'catalogue.read'),
    ('role_management', 'dispatch.read'),
    ('role_management', 'finance.export'),
    ('role_management', 'finance.margin.read'),
    ('role_management', 'finance.payables.read'),
    ('role_management', 'finance.payments.read'),
    ('role_management', 'finance.receivables.read'),
    ('role_management', 'finance.reports.read'),
    ('role_management', 'invoices.read'),
    ('role_management', 'notifications.read'),
    ('role_management', 'partners.read'),
    ('role_reservations', 'bookings.cancel'),
    ('role_reservations', 'bookings.read'),
    ('role_reservations', 'bookings.write'),
    ('role_reservations', 'catalogue.read'),
    ('role_reservations', 'dispatch.read'),
    ('role_reservations', 'notifications.read'),
    ('role_reservations', 'partners.read'),
    ('role_finance', 'audit.read'),
    ('role_finance', 'bookings.read'),
    ('role_finance', 'catalogue.read'),
    ('role_finance', 'finance.export'),
    ('role_finance', 'finance.margin.read'),
    ('role_finance', 'finance.payables.read'),
    ('role_finance', 'finance.payments.read'),
    ('role_finance', 'finance.payments.write'),
    ('role_finance', 'finance.receivables.read'),
    ('role_finance', 'finance.reports.read'),
    ('role_finance', 'finance.terms.write'),
    ('role_finance', 'invoices.read'),
    ('role_finance', 'invoices.write'),
    ('role_finance', 'notifications.read'),
    ('role_finance', 'partners.financial.read'),
    ('role_finance', 'partners.read'),
    ('role_dispatcher', 'catalogue.read'),
    ('role_dispatcher', 'dispatch.read'),
    ('role_dispatcher', 'dispatch.write'),
    ('role_dispatcher', 'notifications.read'),
    ('role_driver', 'driver.panel'),
    ('role_driver', 'notifications.read'),
    ('role_partner_owner', 'notifications.read'),
    ('role_partner_owner', 'partner.bookings.cancel'),
    ('role_partner_owner', 'partner.bookings.read'),
    ('role_partner_owner', 'partner.bookings.write'),
    ('role_partner_owner', 'partner.financial.read'),
    ('role_partner_owner', 'partner.financial.write'),
    ('role_partner_owner', 'partner.inventory.write'),
    ('role_partner_owner', 'partner.invoices.read'),
    ('role_partner_owner', 'partner.profile.write'),
    ('role_partner_owner', 'partner.statement.read'),
    ('role_partner_owner', 'partner.team.manage'),
    ('role_partner_admin', 'notifications.read'),
    ('role_partner_admin', 'partner.bookings.cancel'),
    ('role_partner_admin', 'partner.bookings.read'),
    ('role_partner_admin', 'partner.bookings.write'),
    ('role_partner_admin', 'partner.inventory.write'),
    ('role_partner_admin', 'partner.invoices.read'),
    ('role_partner_admin', 'partner.profile.write'),
    ('role_partner_admin', 'partner.statement.read'),
    ('role_partner_admin', 'partner.team.manage'),
    ('role_partner_agent', 'notifications.read'),
    ('role_partner_agent', 'partner.bookings.cancel'),
    ('role_partner_agent', 'partner.bookings.read'),
    ('role_partner_agent', 'partner.bookings.write'),
    ('role_partner_finance', 'notifications.read'),
    ('role_partner_finance', 'partner.bookings.read'),
    ('role_partner_finance', 'partner.financial.read'),
    ('role_partner_finance', 'partner.financial.write'),
    ('role_partner_finance', 'partner.invoices.read'),
    ('role_partner_finance', 'partner.statement.read');

-- Every existing account gets the row for its primary role.
INSERT INTO "user_roles" ("user_id", "role_id")
SELECT u."id", r."id" FROM "users" u JOIN "roles" r ON r."key" = u."role"::text
ON CONFLICT DO NOTHING;
