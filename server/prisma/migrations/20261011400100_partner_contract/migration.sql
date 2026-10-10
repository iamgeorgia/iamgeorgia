-- A signed contract before approval, accepted terms before the portal opens,
-- two more ways out of the relationship, and what each partner may sell.
--
-- Hand-written, in Prisma's own naming so a later `migrate dev` sees no
-- drift. (If it ever proposes `DROP INDEX "*_geo_idx"` alongside, strip those
-- lines: Prisma cannot see the PostGIS indexes.)

-- ---------------------------------------------------------------------------
-- Contract and terms on the partner.
-- ---------------------------------------------------------------------------
ALTER TABLE "partners"
    ADD COLUMN "contract_asset_id"            TEXT,
    ADD COLUMN "contract_signed_at"           TIMESTAMP(3),
    ADD COLUMN "contract_version"             TEXT,
    ADD COLUMN "contract_uploaded_at"         TIMESTAMP(3),
    ADD COLUMN "contract_uploaded_by_user_id" TEXT,
    ADD COLUMN "contract_required"            BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "terms_version"                TEXT,
    ADD COLUMN "terms_accepted_at"            TIMESTAMP(3),
    ADD COLUMN "terms_accepted_by_user_id"    TEXT,
    ADD COLUMN "blocked_at"                   TIMESTAMP(3),
    ADD COLUMN "blocked_by_user_id"           TEXT,
    ADD COLUMN "blocked_reason"               TEXT,
    ADD COLUMN "terminated_at"                TIMESTAMP(3),
    ADD COLUMN "terminated_by_user_id"        TEXT,
    ADD COLUMN "terminated_reason"            TEXT;

CREATE UNIQUE INDEX "partners_contract_asset_id_key" ON "partners"("contract_asset_id");

ALTER TABLE "partners"
    ADD CONSTRAINT "partners_contract_asset_id_fkey"
        FOREIGN KEY ("contract_asset_id") REFERENCES "file_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "partners_contract_uploaded_by_user_id_fkey"
        FOREIGN KEY ("contract_uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "partners_terms_accepted_by_user_id_fkey"
        FOREIGN KEY ("terms_accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "partners_blocked_by_user_id_fkey"
        FOREIGN KEY ("blocked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "partners_terminated_by_user_id_fkey"
        FOREIGN KEY ("terminated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Companies already trading were approved before a contract was asked for
-- on the platform; the gate applies from the next application on. The terms
-- are a different matter: every company accepts the current version on its
-- next visit, which is what the portal now asks for.
UPDATE "partners" SET "contract_required" = false WHERE "status" = 'APPROVED';

-- ---------------------------------------------------------------------------
-- Product access.
-- ---------------------------------------------------------------------------
CREATE TABLE "partner_product_access" (
    "id"                 TEXT NOT NULL,
    "partner_id"         TEXT NOT NULL,
    "product_type"       "pricing_product_type" NOT NULL,
    "product_id"         TEXT NOT NULL,
    "mode"               "access_mode" NOT NULL,
    "note"               TEXT,
    "created_by_user_id" TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_product_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_product_access_partner_id_product_type_product_id_key"
    ON "partner_product_access"("partner_id", "product_type", "product_id");
CREATE INDEX "partner_product_access_product_type_product_id_idx"
    ON "partner_product_access"("product_type", "product_id");

ALTER TABLE "partner_product_access"
    ADD CONSTRAINT "partner_product_access_partner_id_fkey"
        FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "partner_product_access_created_by_user_id_fkey"
        FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Who uploads a contract, who shapes a partner's catalogue, and who accepts
-- the terms for a company: added to the seeded roles, nothing taken away.
-- ---------------------------------------------------------------------------
INSERT INTO "role_capabilities" ("role_id", "capability")
SELECT r."id", c.capability
  FROM "roles" r
  JOIN (VALUES
        ('SUPER_ADMIN', 'partners.contract.write'),
        ('ADMIN', 'partners.contract.write'),
        ('SUPER_ADMIN', 'partners.access.write'),
        ('ADMIN', 'partners.access.write'),
        ('PARTNER_OWNER', 'partner.terms.accept')
       ) AS c(role_key, capability) ON c.role_key = r."key"
ON CONFLICT DO NOTHING;
