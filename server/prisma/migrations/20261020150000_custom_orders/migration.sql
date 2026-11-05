-- The cart (owner decision OD2): a CUSTOM order flattens packages beside
-- standalone items. Each item remembers the package it came from, its slot
-- there and the group it belongs to; the adjustment says whose figure it is.
--
-- Hand-written, in Prisma's own naming so a later `migrate dev` sees no
-- drift. (If it ever proposes `DROP INDEX "*_geo_idx"` alongside, strip those
-- lines: Prisma cannot see the PostGIS indexes.)

ALTER TABLE "order_items"
    ADD COLUMN "package_id"         TEXT,
    ADD COLUMN "package_slot_index" INTEGER,
    ADD COLUMN "group_key"          TEXT,
    ADD COLUMN "adjustment_source"  TEXT NOT NULL DEFAULT 'NONE';

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A package order's items came from its package, by definition; a custom
-- order has no package of its own (its items may).
ALTER TABLE "orders" ADD CONSTRAINT "orders_custom_has_no_package" CHECK ("kind" <> 'CUSTOM' OR "package_id" IS NULL);

-- Every item of a package order came from that package.
UPDATE "order_items" i
   SET "package_id" = o."package_id", "package_slot_index" = i."slot_index", "group_key" = 'pkg:' || o."package_id", "adjustment_source" = CASE WHEN i."adjustment_cents" <> 0 THEN 'PACKAGE' ELSE 'NONE' END
  FROM "orders" o
 WHERE i."order_id" = o."id" AND o."kind" = 'PACKAGE' AND o."package_id" IS NOT NULL;
