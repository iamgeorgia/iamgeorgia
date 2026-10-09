-- The finance module: supplier payment terms, what we owe suppliers (payables
-- and their instalments), what buyers owe us (receivables), and the payments
-- that settle either. See docs/plans/b2b-enterprise-implementation-plan.md,
-- Phase 2, and owner decisions D5, D6 and D8.
--
-- Hand-checked: the three `DROP INDEX "*_geo_idx"` lines `migrate dev`
-- generates (Prisma cannot see the PostGIS GiST indexes) are removed.

-- CreateEnum
CREATE TYPE "finance_product" AS ENUM ('HOTEL', 'TRANSFER', 'TOUR', 'SERVICE');

-- CreateEnum
CREATE TYPE "settlement_status" AS ENUM ('OPEN', 'PARTIAL', 'PAID', 'VOID', 'WAIVED');

-- CreateEnum
CREATE TYPE "instalment_kind" AS ENUM ('DEPOSIT', 'BALANCE');

-- CreateEnum
CREATE TYPE "cancellation_liability" AS ENUM ('PROPORTIONAL', 'NONE_UNLESS_NON_REFUNDABLE', 'MANUAL');

-- CreateEnum
CREATE TYPE "receivable_due_anchor" AS ENUM ('CONFIRMATION', 'ARRIVAL');

-- CreateEnum
CREATE TYPE "payment_direction" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "payment_kind" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('BANK_TRANSFER', 'CASH', 'CARD', 'OTHER');

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "payment_due_anchor" "receivable_due_anchor" NOT NULL DEFAULT 'CONFIRMATION',
ADD COLUMN     "payment_due_days" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "payment_terms_note" TEXT;

-- CreateTable
CREATE TABLE "supplier_payment_terms" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT,
    "transfer_provider_id" TEXT,
    "tour_id" TEXT,
    "service_id" TEXT,
    "milestones" JSONB NOT NULL DEFAULT '[]',
    "cancellation_liability" "cancellation_liability" NOT NULL DEFAULT 'PROPORTIONAL',
    "cutoff_time" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payment_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payables" (
    "id" TEXT NOT NULL,
    "product" "finance_product" NOT NULL,
    "hotel_booking_id" TEXT,
    "transfer_booking_id" TEXT,
    "tour_booking_id" TEXT,
    "service_booking_id" TEXT,
    "supplier_partner_id" TEXT,
    "booking_reference" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "original_amount_cents" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "amount_override_cents" INTEGER,
    "override_reason" TEXT,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "settlement_status" NOT NULL DEFAULT 'OPEN',
    "next_due_at" TIMESTAMP(3),
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "review_reason" TEXT,
    "cancellation_liability" "cancellation_liability",
    "voided_at" TIMESTAMP(3),
    "waived_at" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'CONFIRM',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_instalments" (
    "id" TEXT NOT NULL,
    "payable_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "instalment_kind" NOT NULL,
    "original_amount_cents" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMP(3),
    "status" "settlement_status" NOT NULL DEFAULT 'OPEN',
    "overdue_alert_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payable_instalments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_reminders" (
    "id" TEXT NOT NULL,
    "instalment_id" TEXT NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payable_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" TEXT NOT NULL,
    "hotel_booking_id" TEXT,
    "transfer_booking_id" TEXT,
    "tour_booking_id" TEXT,
    "service_booking_id" TEXT,
    "order_id" TEXT,
    "reference" TEXT NOT NULL,
    "debtor_partner_id" TEXT,
    "debtor_email" TEXT NOT NULL,
    "debtor_name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "original_amount_cents" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "settlement_status" NOT NULL DEFAULT 'OPEN',
    "due_at" TIMESTAMP(3),
    "overdue_alert_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "waived_at" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'CONFIRM',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_records" (
    "id" TEXT NOT NULL,
    "direction" "payment_direction" NOT NULL,
    "kind" "payment_kind" NOT NULL DEFAULT 'PAYMENT',
    "method" "payment_method" NOT NULL,
    "counterparty_partner_id" TEXT,
    "counterparty_name" TEXT,
    "counterparty_email" TEXT,
    "currency" CHAR(3) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reference" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "reason" TEXT,
    "recorded_by_user_id" TEXT,
    "attachment_asset_id" TEXT,
    "idempotency_key" TEXT,
    "external_payment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "payment_record_id" TEXT NOT NULL,
    "receivable_id" TEXT,
    "payable_instalment_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_terms_hotel_id_key" ON "supplier_payment_terms"("hotel_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_terms_transfer_provider_id_key" ON "supplier_payment_terms"("transfer_provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_terms_tour_id_key" ON "supplier_payment_terms"("tour_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_terms_service_id_key" ON "supplier_payment_terms"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payables_hotel_booking_id_key" ON "supplier_payables"("hotel_booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payables_transfer_booking_id_key" ON "supplier_payables"("transfer_booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payables_tour_booking_id_key" ON "supplier_payables"("tour_booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payables_service_booking_id_key" ON "supplier_payables"("service_booking_id");

-- CreateIndex
CREATE INDEX "supplier_payables_status_next_due_at_idx" ON "supplier_payables"("status", "next_due_at");

-- CreateIndex
CREATE INDEX "supplier_payables_supplier_partner_id_status_created_at_idx" ON "supplier_payables"("supplier_partner_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "supplier_payables_product_created_at_idx" ON "supplier_payables"("product", "created_at");

-- CreateIndex
CREATE INDEX "supplier_payables_currency_status_idx" ON "supplier_payables"("currency", "status");

-- CreateIndex
CREATE INDEX "payable_instalments_status_due_at_idx" ON "payable_instalments"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "payable_instalments_payable_id_sequence_key" ON "payable_instalments"("payable_id", "sequence");

-- CreateIndex
CREATE INDEX "payable_reminders_sent_at_idx" ON "payable_reminders"("sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "payable_reminders_instalment_id_offset_days_key" ON "payable_reminders"("instalment_id", "offset_days");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_hotel_booking_id_key" ON "receivables"("hotel_booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_transfer_booking_id_key" ON "receivables"("transfer_booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_tour_booking_id_key" ON "receivables"("tour_booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_service_booking_id_key" ON "receivables"("service_booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_order_id_key" ON "receivables"("order_id");

-- CreateIndex
CREATE INDEX "receivables_status_due_at_idx" ON "receivables"("status", "due_at");

-- CreateIndex
CREATE INDEX "receivables_debtor_partner_id_status_created_at_idx" ON "receivables"("debtor_partner_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "receivables_debtor_email_idx" ON "receivables"("debtor_email");

-- CreateIndex
CREATE INDEX "receivables_currency_status_idx" ON "receivables"("currency", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_records_idempotency_key_key" ON "payment_records"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_records_paid_at_idx" ON "payment_records"("paid_at");

-- CreateIndex
CREATE INDEX "payment_records_counterparty_partner_id_paid_at_idx" ON "payment_records"("counterparty_partner_id", "paid_at");

-- CreateIndex
CREATE INDEX "payment_records_direction_kind_paid_at_idx" ON "payment_records"("direction", "kind", "paid_at");

-- CreateIndex
CREATE INDEX "payment_allocations_receivable_id_idx" ON "payment_allocations"("receivable_id");

-- CreateIndex
CREATE INDEX "payment_allocations_payable_instalment_id_idx" ON "payment_allocations"("payable_instalment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_payment_record_id_idx" ON "payment_allocations"("payment_record_id");

-- AddForeignKey
ALTER TABLE "supplier_payment_terms" ADD CONSTRAINT "supplier_payment_terms_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_terms" ADD CONSTRAINT "supplier_payment_terms_transfer_provider_id_fkey" FOREIGN KEY ("transfer_provider_id") REFERENCES "transfer_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_terms" ADD CONSTRAINT "supplier_payment_terms_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_terms" ADD CONSTRAINT "supplier_payment_terms_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_hotel_booking_id_fkey" FOREIGN KEY ("hotel_booking_id") REFERENCES "hotel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_transfer_booking_id_fkey" FOREIGN KEY ("transfer_booking_id") REFERENCES "transfer_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_tour_booking_id_fkey" FOREIGN KEY ("tour_booking_id") REFERENCES "tour_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_service_booking_id_fkey" FOREIGN KEY ("service_booking_id") REFERENCES "service_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_supplier_partner_id_fkey" FOREIGN KEY ("supplier_partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_instalments" ADD CONSTRAINT "payable_instalments_payable_id_fkey" FOREIGN KEY ("payable_id") REFERENCES "supplier_payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_reminders" ADD CONSTRAINT "payable_reminders_instalment_id_fkey" FOREIGN KEY ("instalment_id") REFERENCES "payable_instalments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_hotel_booking_id_fkey" FOREIGN KEY ("hotel_booking_id") REFERENCES "hotel_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_transfer_booking_id_fkey" FOREIGN KEY ("transfer_booking_id") REFERENCES "transfer_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_tour_booking_id_fkey" FOREIGN KEY ("tour_booking_id") REFERENCES "tour_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_service_booking_id_fkey" FOREIGN KEY ("service_booking_id") REFERENCES "service_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_debtor_partner_id_fkey" FOREIGN KEY ("debtor_partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_counterparty_partner_id_fkey" FOREIGN KEY ("counterparty_partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_attachment_asset_id_fkey" FOREIGN KEY ("attachment_asset_id") REFERENCES "file_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_record_id_fkey" FOREIGN KEY ("payment_record_id") REFERENCES "payment_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_receivable_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payable_instalment_id_fkey" FOREIGN KEY ("payable_instalment_id") REFERENCES "payable_instalments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity the application relies on, enforced where no code path can skip it.

-- A terms row describes exactly one supplier product.
ALTER TABLE "supplier_payment_terms" ADD CONSTRAINT "supplier_payment_terms_exactly_one_subject" CHECK (
    (CASE WHEN "hotel_id" IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN "transfer_provider_id" IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN "tour_id" IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN "service_id" IS NULL THEN 0 ELSE 1 END) = 1
);

-- A payable belongs to exactly one booking, of the product it names.
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_child_matches_product" CHECK (
    ("product" = 'HOTEL' AND "hotel_booking_id" IS NOT NULL AND "transfer_booking_id" IS NULL AND "tour_booking_id" IS NULL AND "service_booking_id" IS NULL)
 OR ("product" = 'TRANSFER' AND "transfer_booking_id" IS NOT NULL AND "hotel_booking_id" IS NULL AND "tour_booking_id" IS NULL AND "service_booking_id" IS NULL)
 OR ("product" = 'TOUR' AND "tour_booking_id" IS NOT NULL AND "hotel_booking_id" IS NULL AND "transfer_booking_id" IS NULL AND "service_booking_id" IS NULL)
 OR ("product" = 'SERVICE' AND "service_booking_id" IS NOT NULL AND "hotel_booking_id" IS NULL AND "transfer_booking_id" IS NULL AND "tour_booking_id" IS NULL)
);

-- Owed never exceeds what was booked, and nothing is negative.
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_amounts_sane" CHECK (
    "original_amount_cents" >= 0
    AND "amount_cents" BETWEEN 0 AND "original_amount_cents"
    AND ("amount_override_cents" IS NULL OR "amount_override_cents" BETWEEN 0 AND "original_amount_cents")
    AND "paid_cents" >= 0
);

-- VOID means nothing owed and nothing paid, and says when.
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_void_coherent" CHECK (
    ("status" = 'VOID') = ("voided_at" IS NOT NULL) AND ("status" <> 'VOID' OR "paid_cents" = 0)
);

ALTER TABLE "payable_instalments" ADD CONSTRAINT "payable_instalments_amounts_sane" CHECK (
    "sequence" >= 1
    AND "original_amount_cents" >= 0
    AND "amount_cents" BETWEEN 0 AND "original_amount_cents"
    AND "paid_cents" >= 0
);

ALTER TABLE "payable_reminders" ADD CONSTRAINT "payable_reminders_offset_sane" CHECK ("offset_days" >= 0);

-- A receivable belongs to exactly one booking or order.
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_exactly_one_subject" CHECK (
    (CASE WHEN "hotel_booking_id" IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN "transfer_booking_id" IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN "tour_booking_id" IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN "service_booking_id" IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN "order_id" IS NULL THEN 0 ELSE 1 END) = 1
);

ALTER TABLE "receivables" ADD CONSTRAINT "receivables_amounts_sane" CHECK (
    "original_amount_cents" >= 0
    AND "amount_cents" BETWEEN 0 AND "original_amount_cents"
    AND "paid_cents" >= 0
);

ALTER TABLE "receivables" ADD CONSTRAINT "receivables_void_coherent" CHECK (
    ("status" = 'VOID') = ("voided_at" IS NOT NULL) AND ("status" <> 'VOID' OR "paid_cents" = 0)
);

-- A payment is a positive amount of money from or to someone named.
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_amount_positive" CHECK ("amount_cents" > 0);
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_counterparty_present" CHECK (
    "counterparty_partner_id" IS NOT NULL OR "counterparty_name" IS NOT NULL OR "counterparty_email" IS NOT NULL
);
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_refund_has_reason" CHECK (
    "kind" <> 'REFUND' OR ("reason" IS NOT NULL AND length(trim("reason")) > 0)
);

-- An allocation settles exactly one thing, by a non-zero amount.
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_exactly_one_target" CHECK (
    ("receivable_id" IS NOT NULL) <> ("payable_instalment_id" IS NOT NULL)
);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_non_zero" CHECK ("amount_cents" <> 0);

ALTER TABLE "partners" ADD CONSTRAINT "partners_payment_due_days_sane" CHECK ("payment_due_days" BETWEEN 0 AND 365);
