-- The last of the hard-coded role: users.role (an enum) becomes a foreign
-- key to the roles table, so any role — a panel-made one included — can be
-- an account's primary role, and the enum goes.
--
-- Hand-written, in Prisma's own naming so a later `migrate dev` sees no
-- drift. (If it ever proposes `DROP INDEX "*_geo_idx"` alongside, strip those
-- lines: Prisma cannot see the PostGIS indexes.)

ALTER TABLE "users" ADD COLUMN "primary_role_id" TEXT;

UPDATE "users" u SET "primary_role_id" = r."id" FROM "roles" r WHERE r."key" = u."role"::text;

ALTER TABLE "users" ALTER COLUMN "primary_role_id" SET NOT NULL;

ALTER TABLE "users"
    ADD CONSTRAINT "users_primary_role_id_fkey"
        FOREIGN KEY ("primary_role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "users_primary_role_id_idx" ON "users"("primary_role_id");

-- The primary role, kept in step with the user_roles rows exactly as before,
-- now from the foreign key: whatever creates an account gives it the
-- matching row, and a change of primary role swaps that one row and leaves
-- any others the user was given alone.
DROP TRIGGER IF EXISTS "users_primary_role" ON "users";

CREATE OR REPLACE FUNCTION rbac_sync_primary_role() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD."primary_role_id" IS DISTINCT FROM NEW."primary_role_id" THEN
        DELETE FROM "user_roles" WHERE "user_id" = NEW."id" AND "role_id" = OLD."primary_role_id";
    END IF;

    INSERT INTO "user_roles" ("user_id", "role_id")
    VALUES (NEW."id", NEW."primary_role_id")
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_primary_role"
    AFTER INSERT OR UPDATE OF "primary_role_id" ON "users"
    FOR EACH ROW EXECUTE FUNCTION rbac_sync_primary_role();

-- The side rule lived in a CHECK on the enum column; rbac_check_user_sides
-- (Phase C) says the same for every role an account holds, and fires on the
-- row the trigger above inserts.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_partner_role_requires_partner";
DROP INDEX IF EXISTS "users_role_idx";
ALTER TABLE "users" DROP COLUMN "role";
DROP TYPE "role";
