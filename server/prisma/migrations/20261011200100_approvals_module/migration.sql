-- Approval requests: a money action one person asks for and another approves.
--
-- Hand-written, in Prisma's own naming so a later `migrate dev` sees no
-- drift. (If it ever proposes `DROP INDEX "*_geo_idx"` alongside, strip those
-- lines: Prisma cannot see the PostGIS indexes.)

CREATE TYPE "approval_kind" AS ENUM ('REFUND', 'PAYABLE_OVERRIDE', 'PAYABLE_WAIVE', 'RECEIVABLE_DUE_DATE', 'RECEIVABLE_WAIVE');
CREATE TYPE "approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- Quotable like a booking: APR-000001.
CREATE SEQUENCE "approval_reference_seq";

CREATE TABLE "approval_requests" (
    "id"                   TEXT NOT NULL,
    "reference"            TEXT NOT NULL,
    "kind"                 "approval_kind" NOT NULL,
    "status"               "approval_status" NOT NULL DEFAULT 'PENDING',
    "subject_type"         TEXT NOT NULL,
    "subject_id"           TEXT NOT NULL,
    "payload"              JSONB NOT NULL,
    "amount_cents"         INTEGER,
    "currency"             CHAR(3),
    "summary"              TEXT NOT NULL,
    "requested_by_user_id" TEXT,
    "request_note"         TEXT,
    "decided_by_user_id"   TEXT,
    "decided_at"           TIMESTAMP(3),
    "decision_note"        TEXT,
    "executed_entity_type" TEXT,
    "executed_entity_id"   TEXT,
    "last_error"           TEXT,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approval_requests_reference_key" ON "approval_requests"("reference");
CREATE INDEX "approval_requests_status_created_at_idx" ON "approval_requests"("status", "created_at");
CREATE INDEX "approval_requests_requested_by_user_id_status_idx" ON "approval_requests"("requested_by_user_id", "status");
CREATE INDEX "approval_requests_subject_type_subject_id_status_idx" ON "approval_requests"("subject_type", "subject_id", "status");

-- SET NULL: the audit trail keeps who asked and who decided by email; a
-- deleted account must not take the record of the decision with it.
ALTER TABLE "approval_requests"
    ADD CONSTRAINT "approval_requests_requested_by_user_id_fkey"
        FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approval_requests"
    ADD CONSTRAINT "approval_requests_decided_by_user_id_fkey"
        FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Who may ask and who may approve, added to the seeded roles (and nothing
-- taken away, so a role edited in the panel keeps its edits). Executing a
-- refund or an adjustment without a second person is a capability nobody
-- is seeded with — a super admin included — and comes only by being given.
INSERT INTO "role_capabilities" ("role_id", "capability")
SELECT r."id", c.capability
  FROM "roles" r
  JOIN (VALUES
        ('SUPER_ADMIN', 'finance.notes.write'),
        ('SUPER_ADMIN', 'finance.refunds.request'),
        ('SUPER_ADMIN', 'finance.refunds.approve'),
        ('SUPER_ADMIN', 'finance.adjustments.request'),
        ('SUPER_ADMIN', 'finance.adjustments.approve'),
        ('ACCOUNTANT', 'finance.notes.write'),
        ('ACCOUNTANT', 'finance.refunds.request'),
        ('ACCOUNTANT', 'finance.adjustments.request'),
        ('FINANCE_OPERATOR', 'finance.notes.write'),
        ('FINANCE_OPERATOR', 'finance.refunds.request'),
        ('FINANCE_OPERATOR', 'finance.adjustments.request')
       ) AS c(role_key, capability) ON c.role_key = r."key"
ON CONFLICT DO NOTHING;
