-- Hand-written. No change to schema.prisma: a CHECK is not something Prisma
-- models, so `migrate dev` has nothing to diff here. (And if it ever proposes
-- `DROP INDEX "*_geo_idx"` alongside this, strip those lines: Prisma cannot
-- see the PostGIS indexes.)
--
-- A fixed sell price replaces the platform markup entirely (pricing.service
-- quoteStay), so a sell below net is a loss on every night it covers. Rates
-- are written through one raw upsert in inventory.service.js, by admins and
-- by the supplier extranet alike; the service now refuses the half-updates
-- that could get a night here, and this is the backstop beneath it.
--
-- Any night already below net is a mistake nobody meant: clearing the fixed
-- sell puts it back on net + markup, which is what every other night does.
-- The count is logged so the rollout can say how many there were.
DO $$
DECLARE cleared integer;
BEGIN
    UPDATE "rates" SET "sell_cents" = NULL WHERE "sell_cents" IS NOT NULL AND "sell_cents" < "net_cents";
    GET DIAGNOSTICS cleared = ROW_COUNT;
    RAISE NOTICE 'rates_sell_gte_net: cleared % fixed sell price(s) that were below net', cleared;
END $$;

ALTER TABLE "rates"
    ADD CONSTRAINT "rates_sell_gte_net" CHECK ("sell_cents" IS NULL OR "sell_cents" >= "net_cents");

-- Services carry the same pair of figures with the same meaning.
DO $$
DECLARE cleared integer;
BEGIN
    UPDATE "services" SET "sell_cents" = NULL WHERE "sell_cents" IS NOT NULL AND "sell_cents" < "net_cents";
    GET DIAGNOSTICS cleared = ROW_COUNT;
    RAISE NOTICE 'services_sell_gte_net: cleared % fixed sell price(s) that were below net', cleared;
END $$;

ALTER TABLE "services"
    ADD CONSTRAINT "services_sell_gte_net" CHECK ("sell_cents" IS NULL OR "sell_cents" >= "net_cents");
