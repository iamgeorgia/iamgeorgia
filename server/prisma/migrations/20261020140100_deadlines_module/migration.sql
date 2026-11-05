-- Booking deadlines: when the money is due, until when cancelling is free,
-- by when a booking must be answered — one table the calendar and the
-- reminders read, kept in step with the receivable, the frozen cancellation
-- schedule and the approval / request stamps. Plus the reminder schedule.
--
-- Hand-written, in Prisma's own naming so a later `migrate dev` sees no
-- drift. (If it ever proposes `DROP INDEX "*_geo_idx"` alongside, strip those
-- lines: Prisma cannot see the PostGIS indexes.)

CREATE TABLE "booking_deadlines" (
    "id"                       TEXT NOT NULL,
    "kind"                     "deadline_kind" NOT NULL,
    "status"                   "deadline_status" NOT NULL DEFAULT 'OPEN',
    "source"                   "deadline_source" NOT NULL DEFAULT 'SYSTEM',
    "product"                  TEXT NOT NULL,
    "booking_id"               TEXT NOT NULL,
    "reference"                TEXT NOT NULL,
    "receivable_id"            TEXT,
    "due_at"                   TIMESTAMP(3) NOT NULL,
    "timezone"                 TEXT NOT NULL,
    "partner_id"               TEXT,
    "customer_id"              TEXT,
    "assigned_manager_user_id" TEXT,
    "lead_name"                TEXT NOT NULL,
    "title"                    TEXT NOT NULL,
    "meta"                     JSONB NOT NULL DEFAULT '{}',
    "completed_at"             TIMESTAMP(3),
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_deadlines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "booking_deadlines_product_booking_id_kind_key" ON "booking_deadlines"("product", "booking_id", "kind");
CREATE INDEX "booking_deadlines_status_due_at_idx" ON "booking_deadlines"("status", "due_at");
CREATE INDEX "booking_deadlines_kind_status_due_at_idx" ON "booking_deadlines"("kind", "status", "due_at");
CREATE INDEX "booking_deadlines_partner_id_due_at_idx" ON "booking_deadlines"("partner_id", "due_at");
CREATE INDEX "booking_deadlines_assigned_manager_user_id_due_at_idx" ON "booking_deadlines"("assigned_manager_user_id", "due_at");
CREATE INDEX "booking_deadlines_receivable_id_idx" ON "booking_deadlines"("receivable_id");

CREATE TABLE "booking_deadline_history" (
    "id"                 TEXT NOT NULL,
    "deadline_id"        TEXT NOT NULL,
    "from_at"            TIMESTAMP(3),
    "to_at"              TIMESTAMP(3) NOT NULL,
    "source"             "deadline_source" NOT NULL,
    "reason"             TEXT,
    "changed_by_user_id" TEXT,
    "changed_by_name"    TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_deadline_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "booking_deadline_history_deadline_id_created_at_idx" ON "booking_deadline_history"("deadline_id", "created_at");
ALTER TABLE "booking_deadline_history" ADD CONSTRAINT "booking_deadline_history_deadline_id_fkey" FOREIGN KEY ("deadline_id") REFERENCES "booking_deadlines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The claim that makes a reminder fire once per (deadline, offset).
CREATE TABLE "deadline_reminders" (
    "id"          TEXT NOT NULL,
    "deadline_id" TEXT NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "sent_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deadline_reminders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deadline_reminders_deadline_id_offset_days_key" ON "deadline_reminders"("deadline_id", "offset_days");
ALTER TABLE "deadline_reminders" ADD CONSTRAINT "deadline_reminders_deadline_id_fkey" FOREIGN KEY ("deadline_id") REFERENCES "booking_deadlines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Who is told how many days before which kind of deadline. `scope` is
-- 'PLATFORM' or a partner id, so the unique holds for the platform row too.
CREATE TABLE "reminder_policies" (
    "id"                 TEXT NOT NULL,
    "kind"               "deadline_kind" NOT NULL,
    "scope"              TEXT NOT NULL DEFAULT 'PLATFORM',
    "partner_id"         TEXT,
    "offsets_days"       INTEGER[],
    "channels"           TEXT[],
    "recipients"         TEXT[],
    "enabled"            BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reminder_policies_kind_scope_key" ON "reminder_policies"("kind", "scope");
CREATE INDEX "reminder_policies_partner_id_idx" ON "reminder_policies"("partner_id");
ALTER TABLE "reminder_policies" ADD CONSTRAINT "reminder_policies_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The platform schedule, from today's defaults: the finance desk's 7/3/1/0
-- for money, 3 and 1 days before free cancellation ends, the day before and
-- the day of an answer deadline.
INSERT INTO "reminder_policies" ("id", "kind", "scope", "offsets_days", "channels", "recipients", "enabled", "created_at", "updated_at") VALUES
    ('rp_platform_payment',      'PAYMENT',           'PLATFORM', ARRAY[7, 3, 1, 0], ARRAY['IN_APP', 'EMAIL'], ARRAY['STAFF', 'PARTNER', 'GUEST'], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('rp_platform_cancellation', 'FREE_CANCELLATION', 'PLATFORM', ARRAY[3, 1],       ARRAY['IN_APP', 'EMAIL'], ARRAY['STAFF', 'PARTNER'],          true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('rp_platform_confirmation', 'CONFIRMATION',      'PLATFORM', ARRAY[1, 0],       ARRAY['IN_APP'],          ARRAY['STAFF'],                     true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
