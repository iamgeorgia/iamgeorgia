-- 20261020110100_manual_bookings gave the provider's client record a third
-- subject, a desk customer, but left the check that allowed only a partner or
-- a guest email. Every proforma for a customer's booking failed on it.
-- A customer is now a partner company, a desk customer or a guest email:
-- exactly one of the three.
ALTER TABLE "invoicing_customers" DROP CONSTRAINT "invoicing_customers_exactly_one_subject";

ALTER TABLE "invoicing_customers"
    ADD CONSTRAINT "invoicing_customers_exactly_one_subject"
        CHECK (
            (CASE WHEN "partner_id" IS NULL THEN 0 ELSE 1 END)
          + (CASE WHEN "customer_id" IS NULL THEN 0 ELSE 1 END)
          + (CASE WHEN "guest_email" IS NULL THEN 0 ELSE 1 END) = 1
        );
