-- Locations learn where they came from.
--
-- Admins used to type latitude and longitude by hand; now they search Google
-- Places and the coordinates come along. What Places said — place id,
-- formatted address, city, country — is kept next to the coordinates so the
-- panel can show an address instead of a pair of numbers, and so the same
-- airport cannot be registered twice. The coordinate columns, the PostGIS
-- trigger and the CHECK constraints are untouched: they remain the source of
-- truth for pricing, sunset times and nearest-point queries.
--
-- Transfer bookings gain the same for the traveller's own doors, so a driver
-- gets something to navigate to rather than "Hotel Vera, reception".
--
-- All nullable, no backfill: every row written before this migration reads
-- back with `place` null, which the panel renders as "placed on the map, no
-- address on file".
--
-- Hand-written, so the `DROP INDEX "*_geo_idx"` lines Prisma proposes for every
-- migration are not here — see 20260906100000_restore_geo_indexes.

ALTER TABLE "destinations" ADD COLUMN "place" JSONB;
ALTER TABLE "hotels" ADD COLUMN "place" JSONB;
ALTER TABLE "transfer_points" ADD COLUMN "place" JSONB;

ALTER TABLE "transfer_bookings" ADD COLUMN "pickup_place" JSONB;
ALTER TABLE "transfer_bookings" ADD COLUMN "dropoff_place" JSONB;
