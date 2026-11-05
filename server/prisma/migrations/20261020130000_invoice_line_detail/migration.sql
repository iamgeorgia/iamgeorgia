-- Detailed invoice lines: one per room and per transfer leg, with the
-- structured description the provider prints under each (owner decision
-- OD4); the flight per transfer leg; an optional honorific on guests.
--
-- Hand-written, in Prisma's own naming so a later `migrate dev` sees no
-- drift. (If it ever proposes `DROP INDEX "*_geo_idx"` alongside, strip those
-- lines: Prisma cannot see the PostGIS indexes.)

ALTER TABLE "invoice_lines"
    ADD COLUMN "kind"       TEXT,
    ADD COLUMN "unit_cents" INTEGER,
    ADD COLUMN "detail"     JSONB;

-- Lines are written once with the document. An issued document's lines are
-- history: the provider holds the same figures under its own number, and a
-- row that changed here would describe a document that no longer exists.
CREATE OR REPLACE FUNCTION "invoice_lines_immutable"() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "invoices" i WHERE i."id" = OLD."invoice_id" AND i."status" <> 'DRAFT') THEN
        RAISE EXCEPTION 'The lines of an issued document cannot be changed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_lines_immutable"
    BEFORE UPDATE ON "invoice_lines"
    FOR EACH ROW EXECUTE FUNCTION "invoice_lines_immutable"();

-- The flight each leg meets or catches. The outbound leg takes the booking's
-- existing flight number; the return has none until a traveller gives one.
ALTER TABLE "transfer_booking_legs" ADD COLUMN "flight_number" TEXT;

UPDATE "transfer_booking_legs" l
   SET "flight_number" = b."flight_number"
  FROM "transfer_bookings" b
 WHERE l."booking_id" = b."id" AND l."direction" = 'OUTBOUND' AND b."flight_number" IS NOT NULL;

-- An honorific, printed as "LASTNAME / FIRSTNAME MR." only when given.
ALTER TABLE "booking_guests"           ADD COLUMN "title" TEXT;
ALTER TABLE "tour_booking_travellers"  ADD COLUMN "title" TEXT;
