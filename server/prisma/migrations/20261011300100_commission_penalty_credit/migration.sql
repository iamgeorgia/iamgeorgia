-- Commission frozen on every booking, cancellation penalties as rows, and a
-- credit limit per partner.
--
-- Hand-written, in Prisma's own naming so a later `migrate dev` sees no
-- drift. (If it ever proposes `DROP INDEX "*_geo_idx"` alongside, strip those
-- lines: Prisma cannot see the PostGIS indexes.)

-- ---------------------------------------------------------------------------
-- Commission. The markup a booking was sold at is already frozen on it
-- (`markup_bps`); what the agency's own rate was at the time is not, and the
-- two differ whenever a pricing rule won. Backfilled from the agency's rate
-- today for the bookings that have one: the best the past can be read as.
-- ---------------------------------------------------------------------------
ALTER TABLE "hotel_bookings"    ADD COLUMN "commission_rate_bps" INTEGER;
ALTER TABLE "transfer_bookings" ADD COLUMN "commission_rate_bps" INTEGER;
ALTER TABLE "tour_bookings"     ADD COLUMN "commission_rate_bps" INTEGER;
ALTER TABLE "service_bookings"  ADD COLUMN "commission_rate_bps" INTEGER;
ALTER TABLE "orders"            ADD COLUMN "commission_rate_bps" INTEGER;

UPDATE "hotel_bookings"    b SET "commission_rate_bps" = p."commission_rate_bps" FROM "partners" p WHERE p."id" = b."partner_id";
UPDATE "transfer_bookings" b SET "commission_rate_bps" = p."commission_rate_bps" FROM "partners" p WHERE p."id" = b."partner_id";
UPDATE "tour_bookings"     b SET "commission_rate_bps" = p."commission_rate_bps" FROM "partners" p WHERE p."id" = b."partner_id";
UPDATE "service_bookings"  b SET "commission_rate_bps" = p."commission_rate_bps" FROM "partners" p WHERE p."id" = b."partner_id";
UPDATE "orders"            b SET "commission_rate_bps" = p."commission_rate_bps" FROM "partners" p WHERE p."id" = b."partner_id";

-- One row per confirmed partner booking, read by the commission report and
-- the partner's own statement. A view, not a table: the figures are the
-- booking's, and a copy would need keeping in step.
CREATE OR REPLACE VIEW "commission_entries" AS
    SELECT 'HOTEL'::text AS product, b."id" AS booking_id, b."reference", b."partner_id", b."currency", b."status"::text AS status, b."confirmed_at",
           b."sell_total_cents" + b."tax_total_cents" AS sell_cents, b."net_total_cents" AS net_cents, b."markup_bps", b."commission_rate_bps"
      FROM "hotel_bookings" b WHERE b."partner_id" IS NOT NULL AND b."confirmed_at" IS NOT NULL
    UNION ALL
    SELECT 'TRANSFER', b."id", b."reference", b."partner_id", b."currency", b."status"::text, b."confirmed_at",
           b."sell_total_cents", b."net_total_cents", b."markup_bps", b."commission_rate_bps"
      FROM "transfer_bookings" b WHERE b."partner_id" IS NOT NULL AND b."confirmed_at" IS NOT NULL
    UNION ALL
    SELECT 'TOUR', b."id", b."reference", b."partner_id", b."currency", b."status"::text, b."confirmed_at",
           b."sell_total_cents", b."net_total_cents", b."markup_bps", b."commission_rate_bps"
      FROM "tour_bookings" b WHERE b."partner_id" IS NOT NULL AND b."confirmed_at" IS NOT NULL
    UNION ALL
    SELECT 'SERVICE', b."id", b."reference", b."partner_id", b."currency", b."status"::text, b."confirmed_at",
           b."sell_total_cents", b."net_total_cents", b."markup_bps", b."commission_rate_bps"
      FROM "service_bookings" b WHERE b."partner_id" IS NOT NULL AND b."confirmed_at" IS NOT NULL
    UNION ALL
    SELECT 'ORDER', o."id", o."reference", o."partner_id", o."currency", o."status"::text, o."confirmed_at",
           o."sell_total_cents", o."components_net_cents", NULL::integer, o."commission_rate_bps"
      FROM "orders" o WHERE o."partner_id" IS NOT NULL AND o."confirmed_at" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Penalties. What a cancellation cost the buyer is on the booking
-- (`cancellation_charge_cents`); this is the row finance works from — the
-- charge as calculated, and the figure a second person approved in its
-- place, which the ledger then owes instead.
-- ---------------------------------------------------------------------------
CREATE TABLE "penalty_entries" (
    "id"                 TEXT NOT NULL,
    "booking_type"       "finance_product" NOT NULL,
    "booking_id"         TEXT NOT NULL,
    "reference"          TEXT NOT NULL,
    "partner_id"         TEXT,
    "currency"           CHAR(3) NOT NULL,
    "charge_cents"       INTEGER NOT NULL,
    "override_cents"     INTEGER,
    "override_reason"    TEXT,
    "approval_id"        TEXT,
    "created_by_user_id" TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "penalty_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "penalty_entries_amounts_sane" CHECK ("charge_cents" >= 0 AND ("override_cents" IS NULL OR "override_cents" >= 0))
);

CREATE UNIQUE INDEX "penalty_entries_booking_type_booking_id_key" ON "penalty_entries"("booking_type", "booking_id");
CREATE INDEX "penalty_entries_partner_id_created_at_idx" ON "penalty_entries"("partner_id", "created_at");

ALTER TABLE "penalty_entries"
    ADD CONSTRAINT "penalty_entries_partner_id_fkey"
        FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Credit limits. Null is no limit. The limit is in one currency and counts
-- only that currency's open receivables; nothing is summed across rates.
-- ---------------------------------------------------------------------------
CREATE TYPE "credit_limit_mode" AS ENUM ('BLOCK', 'WARN');

ALTER TABLE "partners"
    ADD COLUMN "credit_limit_cents"    INTEGER,
    ADD COLUMN "credit_limit_currency" CHAR(3),
    ADD COLUMN "credit_limit_mode"     "credit_limit_mode" NOT NULL DEFAULT 'BLOCK',
    ADD CONSTRAINT "partners_credit_limit_sane" CHECK (
        ("credit_limit_cents" IS NULL AND "credit_limit_currency" IS NULL)
        OR ("credit_limit_cents" >= 0 AND "credit_limit_currency" IS NOT NULL)
    );

-- Who reads commission and who sets a credit limit, added to the seeded
-- roles and nothing taken away.
INSERT INTO "role_capabilities" ("role_id", "capability")
SELECT r."id", c.capability
  FROM "roles" r
  JOIN (VALUES
        ('SUPER_ADMIN', 'finance.commission.read'),
        ('ADMIN', 'finance.commission.read'),
        ('MANAGEMENT', 'finance.commission.read'),
        ('ACCOUNTANT', 'finance.commission.read'),
        ('SUPER_ADMIN', 'partners.credit.write'),
        ('ADMIN', 'partners.credit.write'),
        ('ACCOUNTANT', 'partners.credit.write')
       ) AS c(role_key, capability) ON c.role_key = r."key"
ON CONFLICT DO NOTHING;
