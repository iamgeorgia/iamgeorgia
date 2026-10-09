-- Enum values for the finance module.
--
-- In their own migration, before the tables that use them: Postgres refuses
-- to use a value added to an enum inside the transaction that added it.
-- Same discipline as 20261008130000_rbac_enum_values.

ALTER TYPE "audit_action" ADD VALUE 'SUPPLIER_TERMS_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'PARTNER_TERMS_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'PAYABLE_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'PAYABLE_AMOUNT_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'PAYABLE_VOIDED';
ALTER TYPE "audit_action" ADD VALUE 'PAYABLE_WAIVED';
ALTER TYPE "audit_action" ADD VALUE 'RECEIVABLE_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'RECEIVABLE_AMOUNT_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'RECEIVABLE_DUE_DATE_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'RECEIVABLE_VOIDED';
ALTER TYPE "audit_action" ADD VALUE 'RECEIVABLE_WAIVED';
ALTER TYPE "audit_action" ADD VALUE 'PAYMENT_RECORDED';
ALTER TYPE "audit_action" ADD VALUE 'PAYMENT_ALLOCATED';
ALTER TYPE "audit_action" ADD VALUE 'REFUND_RECORDED';
ALTER TYPE "audit_action" ADD VALUE 'FINANCE_REPORT_EXPORTED';

-- Proof of a payment — a bank slip, a transfer confirmation. Private.
ALTER TYPE "file_category" ADD VALUE 'PAYMENT_ATTACHMENT';
