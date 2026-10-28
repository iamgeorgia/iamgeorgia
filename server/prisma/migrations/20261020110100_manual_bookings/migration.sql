-- Manual (desk) bookings: a customer who is not a partner, the member of
-- staff looking after a booking, the desk's notes, an audited adjustment on
-- the catalogue price (owner decision OD3), and `source` as a type.
--
-- Hand-written, in Prisma's own naming so a later `migrate dev` sees no
-- drift. (If it ever proposes `DROP INDEX "*_geo_idx"` alongside, strip those
-- lines: Prisma cannot see the PostGIS indexes.)

CREATE TABLE "customers" (
    "id"                 TEXT NOT NULL,
    "kind"               "customer_kind" NOT NULL DEFAULT 'INDIVIDUAL',
    "name"               TEXT NOT NULL,
    "contact_name"       TEXT,
    "email"              TEXT NOT NULL,
    "phone"              TEXT,
    "billing_address"    TEXT,
    "city"               TEXT,
    "country"            TEXT,
    "tax_id"             TEXT,
    "notes"              TEXT,
    "created_by_user_id" TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customers_email_idx" ON "customers"("email");
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- The desk's columns on every booking table. RESTRICT on the customer: a
-- customer with bookings is history, not something to delete; SET NULL on
-- the manager: a member of staff who leaves takes no booking with them.
ALTER TABLE "hotel_bookings"
    ADD COLUMN "customer_id"              TEXT,
    ADD COLUMN "assigned_manager_user_id" TEXT,
    ADD COLUMN "internal_notes"           TEXT,
    ADD COLUMN "price_adjustment_cents"   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "price_adjustment_reason"  TEXT;
ALTER TABLE "transfer_bookings"
    ADD COLUMN "customer_id"              TEXT,
    ADD COLUMN "assigned_manager_user_id" TEXT,
    ADD COLUMN "internal_notes"           TEXT,
    ADD COLUMN "price_adjustment_cents"   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "price_adjustment_reason"  TEXT;
ALTER TABLE "tour_bookings"
    ADD COLUMN "customer_id"              TEXT,
    ADD COLUMN "assigned_manager_user_id" TEXT,
    ADD COLUMN "internal_notes"           TEXT,
    ADD COLUMN "price_adjustment_cents"   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "price_adjustment_reason"  TEXT;
ALTER TABLE "service_bookings"
    ADD COLUMN "customer_id"              TEXT,
    ADD COLUMN "assigned_manager_user_id" TEXT,
    ADD COLUMN "internal_notes"           TEXT,
    ADD COLUMN "price_adjustment_cents"   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "price_adjustment_reason"  TEXT;
-- An order's adjustment lives on its items; the order carries the rest.
ALTER TABLE "orders"
    ADD COLUMN "customer_id"              TEXT,
    ADD COLUMN "assigned_manager_user_id" TEXT,
    ADD COLUMN "internal_notes"           TEXT;

ALTER TABLE "hotel_bookings"    ADD CONSTRAINT "hotel_bookings_customer_id_fkey"    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transfer_bookings" ADD CONSTRAINT "transfer_bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tour_bookings"     ADD CONSTRAINT "tour_bookings_customer_id_fkey"     FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_bookings"  ADD CONSTRAINT "service_bookings_customer_id_fkey"  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders"            ADD CONSTRAINT "orders_customer_id_fkey"            FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hotel_bookings"    ADD CONSTRAINT "hotel_bookings_assigned_manager_user_id_fkey"    FOREIGN KEY ("assigned_manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transfer_bookings" ADD CONSTRAINT "transfer_bookings_assigned_manager_user_id_fkey" FOREIGN KEY ("assigned_manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tour_bookings"     ADD CONSTRAINT "tour_bookings_assigned_manager_user_id_fkey"     FOREIGN KEY ("assigned_manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_bookings"  ADD CONSTRAINT "service_bookings_assigned_manager_user_id_fkey"  FOREIGN KEY ("assigned_manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders"            ADD CONSTRAINT "orders_assigned_manager_user_id_fkey"            FOREIGN KEY ("assigned_manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "hotel_bookings_assigned_manager_user_id_idx"    ON "hotel_bookings"("assigned_manager_user_id");
CREATE INDEX "hotel_bookings_customer_id_idx"                 ON "hotel_bookings"("customer_id");
CREATE INDEX "transfer_bookings_assigned_manager_user_id_idx" ON "transfer_bookings"("assigned_manager_user_id");
CREATE INDEX "transfer_bookings_customer_id_idx"              ON "transfer_bookings"("customer_id");
CREATE INDEX "tour_bookings_assigned_manager_user_id_idx"     ON "tour_bookings"("assigned_manager_user_id");
CREATE INDEX "tour_bookings_customer_id_idx"                  ON "tour_bookings"("customer_id");
CREATE INDEX "service_bookings_assigned_manager_user_id_idx"  ON "service_bookings"("assigned_manager_user_id");
CREATE INDEX "service_bookings_customer_id_idx"               ON "service_bookings"("customer_id");
CREATE INDEX "orders_assigned_manager_user_id_idx"            ON "orders"("assigned_manager_user_id");
CREATE INDEX "orders_customer_id_idx"                         ON "orders"("customer_id");

-- The buyer's side of the ledger and the provider's client record know a
-- customer the way they know a partner.
ALTER TABLE "receivables" ADD COLUMN "debtor_customer_id" TEXT;
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_debtor_customer_id_fkey" FOREIGN KEY ("debtor_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "receivables_debtor_customer_id_idx" ON "receivables"("debtor_customer_id");

ALTER TABLE "invoicing_customers" ADD COLUMN "customer_id" TEXT;
ALTER TABLE "invoicing_customers" ADD CONSTRAINT "invoicing_customers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "invoicing_customers_provider_customer_id_key" ON "invoicing_customers"("provider", "customer_id");

-- `source` was free text the client chose ("web", "partner", "admin", and
-- "demo" from the seeds). Upper-cased and typed; anything unknown is WEB.
ALTER TABLE "hotel_bookings"    ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "transfer_bookings" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "tour_bookings"     ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "service_bookings"  ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "orders"            ALTER COLUMN "source" DROP DEFAULT;

UPDATE "hotel_bookings"    SET "source" = CASE WHEN upper("source") IN ('WEB','PARTNER','ADMIN','PHONE','EMAIL','EXTERNAL_AGENCY','DIRECT','DEMO') THEN upper("source") ELSE 'WEB' END;
UPDATE "transfer_bookings" SET "source" = CASE WHEN upper("source") IN ('WEB','PARTNER','ADMIN','PHONE','EMAIL','EXTERNAL_AGENCY','DIRECT','DEMO') THEN upper("source") ELSE 'WEB' END;
UPDATE "tour_bookings"     SET "source" = CASE WHEN upper("source") IN ('WEB','PARTNER','ADMIN','PHONE','EMAIL','EXTERNAL_AGENCY','DIRECT','DEMO') THEN upper("source") ELSE 'WEB' END;
UPDATE "service_bookings"  SET "source" = CASE WHEN upper("source") IN ('WEB','PARTNER','ADMIN','PHONE','EMAIL','EXTERNAL_AGENCY','DIRECT','DEMO') THEN upper("source") ELSE 'WEB' END;
UPDATE "orders"            SET "source" = CASE WHEN upper("source") IN ('WEB','PARTNER','ADMIN','PHONE','EMAIL','EXTERNAL_AGENCY','DIRECT','DEMO') THEN upper("source") ELSE 'WEB' END;

ALTER TABLE "hotel_bookings"    ALTER COLUMN "source" TYPE "booking_source" USING "source"::"booking_source";
ALTER TABLE "transfer_bookings" ALTER COLUMN "source" TYPE "booking_source" USING "source"::"booking_source";
ALTER TABLE "tour_bookings"     ALTER COLUMN "source" TYPE "booking_source" USING "source"::"booking_source";
ALTER TABLE "service_bookings"  ALTER COLUMN "source" TYPE "booking_source" USING "source"::"booking_source";
ALTER TABLE "orders"            ALTER COLUMN "source" TYPE "booking_source" USING "source"::"booking_source";

ALTER TABLE "hotel_bookings"    ALTER COLUMN "source" SET DEFAULT 'WEB';
ALTER TABLE "transfer_bookings" ALTER COLUMN "source" SET DEFAULT 'WEB';
ALTER TABLE "tour_bookings"     ALTER COLUMN "source" SET DEFAULT 'WEB';
ALTER TABLE "service_bookings"  ALTER COLUMN "source" SET DEFAULT 'WEB';
ALTER TABLE "orders"            ALTER COLUMN "source" SET DEFAULT 'WEB';

-- Selling at other than the catalogue price is a figure, handed out with a role.
INSERT INTO "role_capabilities" ("role_id", "capability")
SELECT r."id", c.capability
  FROM "roles" r
  JOIN (VALUES
        ('SUPER_ADMIN', 'bookings.price.override'),
        ('ADMIN', 'bookings.price.override')
       ) AS c(role_key, capability) ON c.role_key = r."key"
ON CONFLICT DO NOTHING;
