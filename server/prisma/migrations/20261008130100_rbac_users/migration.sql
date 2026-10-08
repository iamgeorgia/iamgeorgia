-- Users: who invited and who deactivated an account, and the new staff roles
-- admitted to the platform side of the role/partner CHECK.

ALTER TABLE "users"
    ADD COLUMN "invited_by_user_id" TEXT,
    ADD COLUMN "invited_at" TIMESTAMP(3),
    ADD COLUMN "deactivated_by_user_id" TEXT,
    ADD COLUMN "deactivated_at" TIMESTAMP(3);

-- SET NULL, not CASCADE: deleting the inviter must not take the invitee with
-- it, and the audit log keeps the inviter's email anyway.
ALTER TABLE "users"
    ADD CONSTRAINT "users_invited_by_user_id_fkey"
        FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users"
    ADD CONSTRAINT "users_deactivated_by_user_id_fkey"
        FOREIGN KEY ("deactivated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- MANAGEMENT, RESERVATIONS and FINANCE are platform staff: never attached to a
-- partner, like SUPER_ADMIN and ADMIN. The CHECK is what keeps a role that
-- unlocks every booking from ever being combined with a partner scope.
ALTER TABLE "users" DROP CONSTRAINT "users_partner_role_requires_partner";
ALTER TABLE "users" ADD CONSTRAINT "users_partner_role_requires_partner" CHECK (
    ("role" IN ('SUPER_ADMIN', 'ADMIN', 'MANAGEMENT', 'RESERVATIONS', 'FINANCE', 'DISPATCHER', 'DRIVER') AND "partner_id" IS NULL)
    OR ("role" IN ('PARTNER_OWNER', 'PARTNER_ADMIN', 'PARTNER_AGENT', 'PARTNER_FINANCE') AND "partner_id" IS NOT NULL)
);
