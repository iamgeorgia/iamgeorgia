-- Enum values for invoicing (Phase 4, InvoiceOcean).
--
-- In their own migration, before anything that writes them: Postgres refuses
-- to use a value added to an enum inside the transaction that added it. The
-- notification kinds FINANCE_INVOICE_ISSUED and FINANCE_INVOICE_SYNC_FAILED
-- were reserved in 20261010100000_finance_notifications_enum_values.

ALTER TYPE "audit_action" ADD VALUE 'INVOICE_REQUESTED';
ALTER TYPE "audit_action" ADD VALUE 'INVOICE_ISSUED';
ALTER TYPE "audit_action" ADD VALUE 'INVOICE_SENT';
ALTER TYPE "audit_action" ADD VALUE 'INVOICE_CANCELLED';
ALTER TYPE "audit_action" ADD VALUE 'INVOICE_SYNCED';
ALTER TYPE "audit_action" ADD VALUE 'INVOICE_SYNC_FAILED';
ALTER TYPE "audit_action" ADD VALUE 'INVOICE_IMPORTED';
ALTER TYPE "audit_action" ADD VALUE 'INVOICING_CUSTOMER_SYNCED';

CREATE TYPE "invoicing_provider" AS ENUM ('INVOICEOCEAN');
CREATE TYPE "invoice_kind" AS ENUM ('PROFORMA', 'VAT', 'ADVANCE', 'FINAL', 'CORRECTION');
CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'ISSUED', 'SENT', 'PAID', 'PARTIAL', 'CANCELLED', 'ERROR');
CREATE TYPE "invoice_sync_source" AS ENUM ('WEBHOOK', 'POLL');
