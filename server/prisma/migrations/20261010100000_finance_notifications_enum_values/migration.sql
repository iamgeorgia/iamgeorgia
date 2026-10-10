-- Enum values for supplier payment reminders (Phase 3).
--
-- In their own migration, before anything that writes them: Postgres refuses
-- to use a value added to an enum inside the transaction that added it.
-- Same discipline as 20261009090000_finance_enum_values.

-- What the finance desk and a partner are told in-app.
ALTER TYPE "notification_kind" ADD VALUE 'FINANCE_PAYABLE_DUE';
ALTER TYPE "notification_kind" ADD VALUE 'FINANCE_PAYABLE_OVERDUE';
ALTER TYPE "notification_kind" ADD VALUE 'FINANCE_RECEIVABLE_OVERDUE';
ALTER TYPE "notification_kind" ADD VALUE 'FINANCE_PAYMENT_RECEIVED';
-- Reserved for Phase 4 (InvoiceOcean), added here so that phase needs no
-- second enum migration.
ALTER TYPE "notification_kind" ADD VALUE 'FINANCE_INVOICE_ISSUED';
ALTER TYPE "notification_kind" ADD VALUE 'FINANCE_INVOICE_SYNC_FAILED';

-- Reminder settings are environment-only today; the action is reserved for a
-- runtime settings screen. The retry is live: an administrator re-queuing an
-- outbox event that exhausted its attempts.
ALTER TYPE "audit_action" ADD VALUE 'FINANCE_REMINDER_SETTINGS_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'OUTBOX_EVENT_RETRIED';
