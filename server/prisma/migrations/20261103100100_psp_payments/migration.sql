-- Card payments through a provider (Flitt): the attempt table, the callback
-- inbox, provider refunds, and the payment rule frozen on each receivable.
-- Payment policies grow owners and attachments beyond hotels.
-- docs/plans/FLITT_INTEGRATION_PLAN.md §8.
--
-- Hand-written against the Prisma schema; the sequence, the CHECKs and the
-- single-owner constraint at the end are not something `migrate dev` emits.

-- Payment policies: owners, product kind, the unpaid timeout, the card flag.
ALTER TABLE "payment_policies"
    ADD COLUMN "tour_id" TEXT,
    ADD COLUMN "product_kind" "finance_product",
    ADD COLUMN "unpaid_cancel_hours" INTEGER DEFAULT 24,
    ADD COLUMN "card_optional" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "payment_policies"
    ADD CONSTRAINT "payment_policies_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "payment_policies_tour_id_is_active_idx" ON "payment_policies"("tour_id", "is_active");
CREATE INDEX "payment_policies_product_kind_is_active_idx" ON "payment_policies"("product_kind", "is_active");

ALTER TABLE "payment_policies"
    ADD CONSTRAINT "payment_policies_single_owner" CHECK (num_nonnulls("hotel_id", "tour_id") <= 1),
    ADD CONSTRAINT "payment_policies_unpaid_hours_range" CHECK ("unpaid_cancel_hours" IS NULL OR ("unpaid_cancel_hours" BETWEEN 1 AND 720));

-- Where a policy attaches besides a rate plan.
ALTER TABLE "tour_options" ADD COLUMN "payment_policy_id" TEXT;
ALTER TABLE "tour_options"
    ADD CONSTRAINT "tour_options_payment_policy_id_fkey" FOREIGN KEY ("payment_policy_id") REFERENCES "payment_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "packages" ADD COLUMN "payment_policy_id" TEXT;
ALTER TABLE "packages"
    ADD CONSTRAINT "packages_payment_policy_id_fkey" FOREIGN KEY ("payment_policy_id") REFERENCES "payment_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transfer_providers" ADD COLUMN "payment_policy_id" TEXT;
ALTER TABLE "transfer_providers"
    ADD CONSTRAINT "transfer_providers_payment_policy_id_fkey" FOREIGN KEY ("payment_policy_id") REFERENCES "payment_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The rule a receivable was opened under.
ALTER TABLE "receivables"
    ADD COLUMN "payment_timing" "payment_timing",
    ADD COLUMN "unpaid_cancel_hours" INTEGER,
    ADD COLUMN "auto_cancel_at" TIMESTAMP(3),
    ADD COLUMN "auto_cancelled_at" TIMESTAMP(3);

CREATE INDEX "receivables_auto_cancel_at_status_idx" ON "receivables"("auto_cancel_at", "status");

-- The attempt.
CREATE SEQUENCE "psp_payment_reference_seq";

CREATE TABLE "psp_payments" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "provider" "payment_provider" NOT NULL DEFAULT 'FLITT',
    "mode" "psp_mode" NOT NULL,
    "status" "psp_payment_status" NOT NULL DEFAULT 'CREATED',
    "receivable_id" TEXT NOT NULL,
    "debtor_email" TEXT NOT NULL,
    "booking_type" "finance_product",
    "booking_reference" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "actual_amount_cents" INTEGER,
    "actual_currency" CHAR(3),
    "reversed_cents" INTEGER NOT NULL DEFAULT 0,
    "merchant_order_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "provider_transaction_id" TEXT,
    "checkout_url" TEXT,
    "checkout_token" TEXT,
    "provider_order_status" TEXT,
    "provider_order_time" TEXT,
    "response_code" INTEGER,
    "response_description" TEXT,
    "masked_card" TEXT,
    "card_type" TEXT,
    "card_bin" TEXT,
    "payment_system" TEXT,
    "approval_code" TEXT,
    "rrn" TEXT,
    "eci" TEXT,
    "payment_record_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "lang" CHAR(2),
    "created_ip" TEXT,
    "lifetime_seconds" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "redirect_ready_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "last_callback_at" TIMESTAMP(3),
    "last_status_check_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "reconciled_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "psp_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "psp_payments_reference_key" ON "psp_payments"("reference");
CREATE UNIQUE INDEX "psp_payments_payment_record_id_key" ON "psp_payments"("payment_record_id");
CREATE UNIQUE INDEX "psp_payments_idempotency_key_key" ON "psp_payments"("idempotency_key");
CREATE UNIQUE INDEX "psp_payments_provider_mode_merchant_order_id_key" ON "psp_payments"("provider", "mode", "merchant_order_id");
CREATE UNIQUE INDEX "psp_payments_provider_mode_provider_payment_id_key" ON "psp_payments"("provider", "mode", "provider_payment_id");
CREATE INDEX "psp_payments_receivable_id_status_idx" ON "psp_payments"("receivable_id", "status");
CREATE INDEX "psp_payments_status_expires_at_idx" ON "psp_payments"("status", "expires_at");
CREATE INDEX "psp_payments_status_last_status_check_at_idx" ON "psp_payments"("status", "last_status_check_at");
CREATE INDEX "psp_payments_debtor_email_idx" ON "psp_payments"("debtor_email");
CREATE INDEX "psp_payments_created_at_idx" ON "psp_payments"("created_at");

ALTER TABLE "psp_payments"
    ADD CONSTRAINT "psp_payments_receivable_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "psp_payments_payment_record_id_fkey" FOREIGN KEY ("payment_record_id") REFERENCES "payment_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "psp_payments_amount_positive" CHECK ("amount_cents" > 0),
    ADD CONSTRAINT "psp_payments_reversed_bounded" CHECK ("reversed_cents" >= 0 AND ("actual_amount_cents" IS NULL OR "reversed_cents" <= "actual_amount_cents"));

-- The callback inbox.
CREATE TABLE "psp_callback_events" (
    "id" TEXT NOT NULL,
    "provider" "payment_provider" NOT NULL DEFAULT 'FLITT',
    "mode" "psp_mode" NOT NULL,
    "body_hash" TEXT NOT NULL,
    "merchant_order_id" TEXT,
    "provider_payment_id" TEXT,
    "order_status" TEXT,
    "signature_valid" BOOLEAN NOT NULL,
    "source_ip" TEXT,
    "payload" JSONB NOT NULL,
    "payment_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "psp_callback_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "psp_callback_events_provider_body_hash_key" ON "psp_callback_events"("provider", "body_hash");
CREATE INDEX "psp_callback_events_processed_at_received_at_idx" ON "psp_callback_events"("processed_at", "received_at");
CREATE INDEX "psp_callback_events_payment_id_idx" ON "psp_callback_events"("payment_id");

ALTER TABLE "psp_callback_events"
    ADD CONSTRAINT "psp_callback_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "psp_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Provider refunds.
CREATE TABLE "psp_refunds" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "status" "psp_refund_status" NOT NULL DEFAULT 'REQUESTED',
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reverse_id" TEXT NOT NULL,
    "approval_request_id" TEXT,
    "payment_record_id" TEXT,
    "provider_transaction_id" TEXT,
    "response_code" INTEGER,
    "response_description" TEXT,
    "reason" TEXT NOT NULL,
    "requested_by_user_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "psp_refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "psp_refunds_reverse_id_key" ON "psp_refunds"("reverse_id");
CREATE UNIQUE INDEX "psp_refunds_payment_record_id_key" ON "psp_refunds"("payment_record_id");
CREATE INDEX "psp_refunds_payment_id_status_idx" ON "psp_refunds"("payment_id", "status");

ALTER TABLE "psp_refunds"
    ADD CONSTRAINT "psp_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "psp_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "psp_refunds_payment_record_id_fkey" FOREIGN KEY ("payment_record_id") REFERENCES "payment_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "psp_refunds_amount_positive" CHECK ("amount_cents" > 0);
