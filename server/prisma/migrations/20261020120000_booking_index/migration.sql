-- The cross-product booking index: one row per booking of any product, kept
-- in step by the services and rebuilt by `scripts/backfill-booking-index.js`.
--
-- Hand-written, in Prisma's own naming so a later `migrate dev` sees no
-- drift. (If it ever proposes `DROP INDEX "*_geo_idx"` alongside, strip those
-- lines: Prisma cannot see the PostGIS indexes.)

-- Trigram matching: what turns `ILIKE '%nino%'` over reference, name, email
-- and title into an index scan. One extension, one GIN, in place of twelve
-- btrees that `contains` could never use.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "booking_index" (
    "id"                       TEXT NOT NULL,
    "product"                  TEXT NOT NULL,
    "booking_id"               TEXT NOT NULL,
    "reference"                TEXT NOT NULL,
    "status"                   TEXT NOT NULL,
    "kind"                     TEXT,
    "partner_id"               TEXT,
    "customer_id"              TEXT,
    "assigned_manager_user_id" TEXT,
    "order_id"                 TEXT,
    "order_reference"          TEXT,
    "lead_name"                TEXT NOT NULL,
    "lead_email"               TEXT NOT NULL,
    "title"                    TEXT NOT NULL,
    "destination_id"           TEXT,
    "start_date"               DATE NOT NULL,
    "end_date"                 DATE NOT NULL,
    "start_at"                 TIMESTAMP(3) NOT NULL,
    "currency"                 CHAR(3) NOT NULL,
    "total_cents"              INTEGER NOT NULL,
    "receivable_id"            TEXT,
    "receivable_status"        TEXT,
    "due_at"                   TIMESTAMP(3),
    "paid_cents"               INTEGER NOT NULL DEFAULT 0,
    "approval_state"           TEXT,
    "approval_deadline_at"     TIMESTAMP(3),
    "source"                   "booking_source" NOT NULL,
    "search"                   TEXT NOT NULL,
    "created_at"               TIMESTAMP(3) NOT NULL,
    "confirmed_at"             TIMESTAMP(3),
    "cancelled_at"             TIMESTAMP(3),
    "updated_at"               TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_index_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "booking_index_reference_key" ON "booking_index"("reference");
CREATE UNIQUE INDEX "booking_index_product_booking_id_key" ON "booking_index"("product", "booking_id");
CREATE INDEX "booking_index_status_start_date_idx" ON "booking_index"("status", "start_date");
CREATE INDEX "booking_index_partner_id_created_at_idx" ON "booking_index"("partner_id", "created_at");
CREATE INDEX "booking_index_customer_id_created_at_idx" ON "booking_index"("customer_id", "created_at");
CREATE INDEX "booking_index_assigned_manager_user_id_start_date_idx" ON "booking_index"("assigned_manager_user_id", "start_date");
CREATE INDEX "booking_index_receivable_status_due_at_idx" ON "booking_index"("receivable_status", "due_at");
CREATE INDEX "booking_index_created_at_idx" ON "booking_index"("created_at");
CREATE INDEX "booking_index_status_approval_deadline_at_idx" ON "booking_index"("status", "approval_deadline_at");
CREATE INDEX "booking_index_search_idx" ON "booking_index" USING GIN ("search" gin_trgm_ops);

-- The default sort of every admin register, which no existing index served.
CREATE INDEX "hotel_bookings_created_at_idx"    ON "hotel_bookings"("created_at");
CREATE INDEX "transfer_bookings_created_at_idx" ON "transfer_bookings"("created_at");
CREATE INDEX "tour_bookings_created_at_idx"     ON "tour_bookings"("created_at");
CREATE INDEX "service_bookings_created_at_idx"  ON "service_bookings"("created_at");
CREATE INDEX "orders_created_at_idx"            ON "orders"("created_at");
