-- Invoicing (Phase 4): invoices issued by a provider (InvoiceOcean) from the
-- receivables, the provider's client records, the document lines, and the
-- status changes the provider reports back. See
-- docs/plans/b2b-enterprise-implementation-plan.md, Phase 4, and owner
-- decisions D1–D4.
--
-- Hand-checked: the three `DROP INDEX "*_geo_idx"` lines `migrate dev`
-- generates (Prisma cannot see the PostGIS GiST indexes) are removed, and the
-- CHECKs and the partial unique index at the end are added by hand.

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "invoice_lang" TEXT,
ADD COLUMN     "tax_id" TEXT;

-- AlterTable
ALTER TABLE "payment_allocations" ADD COLUMN     "external_payment_id" TEXT;

-- CreateTable
CREATE TABLE "invoicing_customers" (
    "id" TEXT NOT NULL,
    "provider" "invoicing_provider" NOT NULL,
    "partner_id" TEXT,
    "guest_email" TEXT,
    "external_client_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoicing_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "provider" "invoicing_provider" NOT NULL DEFAULT 'INVOICEOCEAN',
    "receivable_id" TEXT NOT NULL,
    "kind" "invoice_kind" NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'DRAFT',
    "external_id" TEXT,
    "external_number" TEXT,
    "external_updated_at" TIMESTAMP(3),
    "from_invoice_id" TEXT,
    "currency" CHAR(3) NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "total_cents" INTEGER NOT NULL,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "issue_date" DATE NOT NULL,
    "sell_date" DATE NOT NULL,
    "due_date" DATE,
    "buyer_snapshot" JSONB NOT NULL DEFAULT '{}',
    "public_token" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "sync_error" TEXT,
    "correction_reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CONFIRM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "tax_rate_bps" INTEGER,
    "total_gross_cents" INTEGER NOT NULL,
    "booking_reference" TEXT,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sync_events" (
    "id" TEXT NOT NULL,
    "provider" "invoicing_provider" NOT NULL,
    "source" "invoice_sync_source" NOT NULL,
    "external_id" TEXT NOT NULL,
    "external_updated_at" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoicing_customers_provider_partner_id_key" ON "invoicing_customers"("provider", "partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoicing_customers_provider_guest_email_key" ON "invoicing_customers"("provider", "guest_email");

-- CreateIndex
CREATE UNIQUE INDEX "invoicing_customers_provider_external_client_id_key" ON "invoicing_customers"("provider", "external_client_id");

-- CreateIndex
CREATE INDEX "invoices_receivable_id_kind_idx" ON "invoices"("receivable_id", "kind");

-- CreateIndex
CREATE INDEX "invoices_status_issue_date_idx" ON "invoices"("status", "issue_date");

-- CreateIndex
CREATE INDEX "invoices_external_number_idx" ON "invoices"("external_number");

-- CreateIndex
CREATE INDEX "invoices_created_at_idx" ON "invoices"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_provider_external_id_key" ON "invoices"("provider", "external_id");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_id_sort_order_idx" ON "invoice_lines"("invoice_id", "sort_order");

-- CreateIndex
CREATE INDEX "invoice_sync_events_processed_at_created_at_idx" ON "invoice_sync_events"("processed_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_sync_events_provider_external_id_external_updated_a_key" ON "invoice_sync_events"("provider", "external_id", "external_updated_at");

-- AddForeignKey
ALTER TABLE "invoicing_customers" ADD CONSTRAINT "invoicing_customers_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_receivable_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_from_invoice_id_fkey" FOREIGN KEY ("from_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: the rules Prisma cannot express.
-- ---------------------------------------------------------------------------

-- A customer is a partner company or a guest email, never both or neither.
ALTER TABLE "invoicing_customers"
    ADD CONSTRAINT "invoicing_customers_exactly_one_subject"
        CHECK (("partner_id" IS NULL) <> ("guest_email" IS NULL));

-- One live document of each kind per receivable: a second proforma can only
-- be written once the first is cancelled or failed. This is what makes two
-- concurrent issue requests, or a replayed handler, produce one invoice.
CREATE UNIQUE INDEX "invoices_one_live_per_kind"
    ON "invoices"("receivable_id", "kind")
    WHERE "status" NOT IN ('CANCELLED', 'ERROR');

-- A proforma or an advance starts a chain; a correction always continues one.
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_chain_coherent"
        CHECK (
            ("kind" IN ('PROFORMA', 'ADVANCE') AND "from_invoice_id" IS NULL)
            OR ("kind" = 'CORRECTION' AND "from_invoice_id" IS NOT NULL)
            OR "kind" IN ('VAT', 'FINAL')
        );

-- An issued document has the provider's id; a draft, a failed one, or one
-- cancelled before it was ever issued may not.
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_issued_have_external_id"
        CHECK ("status" IN ('DRAFT', 'ERROR', 'CANCELLED') OR "external_id" IS NOT NULL);

ALTER TABLE "invoice_lines"
    ADD CONSTRAINT "invoice_lines_quantity_positive" CHECK ("quantity" > 0);
