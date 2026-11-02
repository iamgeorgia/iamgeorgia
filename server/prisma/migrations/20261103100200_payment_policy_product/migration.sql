-- Payment policy templates are for hotels, tours, transfers or packages.
-- `product_kind` was first typed with the ledger's finance_product, which has
-- no PACKAGE; it gets a list of its own. Every existing row is null (hotel),
-- so the cast is trivial.

CREATE TYPE "payment_policy_product" AS ENUM ('HOTEL', 'TOUR', 'TRANSFER', 'PACKAGE');

DROP INDEX IF EXISTS "payment_policies_product_kind_is_active_idx";

ALTER TABLE "payment_policies"
    ALTER COLUMN "product_kind" TYPE "payment_policy_product" USING ("product_kind"::text::"payment_policy_product");

CREATE INDEX "payment_policies_product_kind_is_active_idx" ON "payment_policies"("product_kind", "is_active");
