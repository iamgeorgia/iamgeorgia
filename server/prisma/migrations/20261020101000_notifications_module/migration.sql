-- Notifications: a category per row, and a key that makes a notice happen once.
--
-- Hand-written, in Prisma's own naming so a later `migrate dev` sees no
-- drift. (If it ever proposes `DROP INDEX "*_geo_idx"` alongside, strip those
-- lines: Prisma cannot see the PostGIS indexes.)

CREATE TYPE "notification_category" AS ENUM ('BOOKING', 'DISPATCH', 'FINANCE', 'APPROVAL', 'DEADLINE', 'SYSTEM');

ALTER TABLE "notifications"
    ADD COLUMN "category"   "notification_category" NOT NULL DEFAULT 'SYSTEM',
    ADD COLUMN "dedupe_key" TEXT;

-- What every existing row is, by its kind. Mirrors CATEGORY_OF in
-- lib/notifications/categories.js at the time of writing.
UPDATE "notifications" SET "category" = CASE
    WHEN "kind"::text LIKE 'TRANSFER_%'                                            THEN 'DISPATCH'::"notification_category"
    WHEN "kind" IN ('TOUR_REQUEST_OVERDUE', 'ORDER_REQUEST_OVERDUE')             THEN 'BOOKING'::"notification_category"
    WHEN "kind" IN ('FINANCE_PAYABLE_DUE', 'FINANCE_PAYABLE_OVERDUE',
                    'FINANCE_RECEIVABLE_OVERDUE')                                  THEN 'DEADLINE'::"notification_category"
    WHEN "kind"::text LIKE 'FINANCE_%'                                             THEN 'FINANCE'::"notification_category"
    WHEN "kind" IN ('APPROVAL_REQUESTED', 'APPROVAL_DECIDED',
                    'BOOKING_AWAITING_APPROVAL', 'BOOKING_APPROVED',
                    'BOOKING_REJECTED', 'BOOKING_APPROVAL_OVERDUE')               THEN 'APPROVAL'::"notification_category"
    WHEN "kind"::text LIKE 'BOOKING_%'                                             THEN 'BOOKING'::"notification_category"
    ELSE 'SYSTEM'::"notification_category"
END;

CREATE UNIQUE INDEX "notifications_recipient_user_id_dedupe_key_key" ON "notifications"("recipient_user_id", "dedupe_key");
CREATE INDEX "notifications_recipient_user_id_category_read_at_created_at_idx" ON "notifications"("recipient_user_id", "category", "read_at", "created_at");
