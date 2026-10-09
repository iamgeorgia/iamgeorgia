import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { dateOnlyToUtc } from '../lib/time.js';
import { reconcileInventory, sweepExpiredHolds } from '../services/hotel/availability.service.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makeAmenity,
    makeDestination,
    makeHotel,
    makePartner,
    makePartnerUser,
    signIn,
    unique
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const CHECK_IN = '2027-07-05';
const CHECK_OUT = '2027-07-08';
const LAST_NIGHT = '2027-07-07';

describe('bookings', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let adminCookie;
    let partnerCookie;
    let partner;
    let country;

    before(async () => {
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;
        partner = await makePartner(tracker);
        partnerCookie = (await signIn(app, (await makePartnerUser(tracker, partner)).email)).cookie;
        country = await makeDestination(tracker);
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    /** A property that can actually be sold, with a known price and stock. */
    const makeSellable = async ({ totalUnits = 5, netCents = 20_000, cancellationKind = 'FLEXIBLE' } = {}) => {
        const hotel = await makeHotel(tracker, {
            destination: await makeDestination(tracker, { parent: country, type: 'RESORT' }),
            status: 'ACTIVE',
            checkInFrom: '14:00',
            checkOutUntil: '12:00'
        });

        const roomType = await prisma.roomType.create({
            data: {
                hotelId: hotel.id,
                code: 'std',
                name: 'Standard Double',
                maxOccupancy: 3,
                maxAdults: 2,
                maxChildren: 1,
                standardOccupancy: 2
            }
        });

        const [mealPlan, cancellation, payment, king] = await Promise.all([
            prisma.mealPlan.findUnique({ where: { code: 'BB' } }),
            prisma.cancellationPolicy.findFirst({ where: { hotelId: null, kind: cancellationKind } }),
            prisma.paymentPolicy.findFirst({ where: { hotelId: null, timing: 'PAY_NOW' } }),
            prisma.bedType.findUnique({ where: { code: 'KING' } })
        ]);

        await prisma.roomBed.create({ data: { roomTypeId: roomType.id, bedTypeId: king.id, quantity: 1 } });

        const ratePlan = await prisma.ratePlan.create({
            data: {
                roomTypeId: roomType.id,
                code: unique('rp').slice(0, 40),
                name: 'Breakfast, flexible',
                mealPlanId: mealPlan.id,
                cancellationPolicyId: cancellation.id,
                paymentPolicyId: payment.id,
                currency: 'GEL'
            }
        });

        await request(app)
            .put(`/api/admin/hotels/${hotel.id}/room-types/${roomType.id}/inventory`)
            .set('Cookie', adminCookie)
            .send({ from: CHECK_IN, to: LAST_NIGHT, totalUnits });

        await request(app)
            .put(`/api/admin/hotels/${hotel.id}/room-types/${roomType.id}/rate-plans/${ratePlan.id}/rates`)
            .set('Cookie', adminCookie)
            .send({ from: CHECK_IN, to: LAST_NIGHT, netCents });

        return { hotel, roomType, ratePlan };
    };

    /**
     * Searches as whoever is passed, because who is searching changes the price:
     * a partner is quoted at its own commission rate, an anonymous guest at the
     * platform markup. An offer token therefore belongs to the viewer it was
     * issued to.
     */
    const offerFor = async (hotel, cookie) => {
        const call = request(app).get(
            `/api/search/hotels/${hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`
        );

        const response = await (cookie ? call.set('Cookie', cookie) : call);

        assert.equal(response.status, 200, 'the fixture should be searchable');
        return response.body.roomTypes[0].offers[0];
    };

    const leadGuest = (email = 'nino@example.test') => ({
        firstName: 'Nino',
        lastName: 'Beridze',
        email,
        phone: '+995322123456'
    });

    const inventoryFor = (roomTypeId, date = CHECK_IN) =>
        prisma.roomInventory.findUnique({
            where: { roomTypeId_date: { roomTypeId, date: dateOnlyToUtc(date) } }
        });

    describe('holds', () => {
        it('claims inventory for every night of the stay', async () => {
            const { hotel, roomType } = await makeSellable({ totalUnits: 3 });
            const offer = await offerFor(hotel);

            const response = await request(app).post('/api/bookings/holds').send({ token: offer.token });

            assert.equal(response.status, 201);
            assert.ok(response.body.token);
            assert.ok(new Date(response.body.expiresAt) > new Date());

            for (const date of [CHECK_IN, '2027-07-06', LAST_NIGHT]) {
                assert.equal((await inventoryFor(roomType.id, date)).heldUnits, 1, `${date} should be held`);
            }
        });

        it('reduces what the next search can see', async () => {
            const { hotel } = await makeSellable({ totalUnits: 1 });
            const offer = await offerFor(hotel);

            await request(app).post('/api/bookings/holds').send({ token: offer.token });

            const after = await request(app).get(
                `/api/search/hotels/${hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`
            );

            assert.deepEqual(after.body.roomTypes, [], 'the last room is spoken for');
        });

        it('refuses a hold when the rooms have gone', async () => {
            const { hotel, roomType } = await makeSellable({ totalUnits: 1 });
            const offer = await offerFor(hotel);

            await prisma.roomInventory.update({
                where: { roomTypeId_date: { roomTypeId: roomType.id, date: dateOnlyToUtc('2027-07-06') } },
                data: { bookedUnits: 1 }
            });

            const response = await request(app).post('/api/bookings/holds').send({ token: offer.token });

            assert.equal(response.status, 409);
            assert.equal(response.body.error.details.reason, 'UNAVAILABLE');
        });

        it('gives the rooms back when checkout is abandoned', async () => {
            const { hotel, roomType } = await makeSellable({ totalUnits: 2 });
            const offer = await offerFor(hotel);

            const hold = await request(app).post('/api/bookings/holds').send({ token: offer.token });
            assert.equal((await inventoryFor(roomType.id)).heldUnits, 1);

            const released = await request(app).delete(`/api/bookings/holds/${hold.body.token}`);

            assert.equal(released.status, 204);
            assert.equal((await inventoryFor(roomType.id)).heldUnits, 0);
        });

        it('treats releasing twice as success rather than an error', async () => {
            const { hotel } = await makeSellable();
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            await request(app).delete(`/api/bookings/holds/${hold.body.token}`);
            assert.equal((await request(app).delete(`/api/bookings/holds/${hold.body.token}`)).status, 204);
        });
    });

    describe('hold expiry', () => {
        it('returns the rooms once a hold has expired', async () => {
            const { hotel, roomType } = await makeSellable({ totalUnits: 1 });
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            assert.equal((await inventoryFor(roomType.id)).heldUnits, 1);

            // Reach into the past rather than waiting fifteen minutes.
            await prisma.bookingHold.update({
                where: { token: hold.body.token },
                data: { expiresAt: new Date(Date.now() - 1_000) }
            });

            const { swept } = await sweepExpiredHolds();

            assert.ok(swept >= 1);
            assert.equal((await inventoryFor(roomType.id)).heldUnits, 0);
            assert.equal(
                (await prisma.bookingHold.findUnique({ where: { token: hold.body.token } })).status,
                'EXPIRED'
            );
        });

        // The sweeper runs on an interval, so a hold that expired seconds ago
        // must not be committable merely because nobody has tidied it up.
        it('refuses to confirm an expired hold even before the sweep runs', async () => {
            const { hotel } = await makeSellable();
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            await prisma.bookingHold.update({
                where: { token: hold.body.token },
                data: { expiresAt: new Date(Date.now() - 1_000) }
            });

            const response = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            assert.equal(response.status, 410);
            assert.equal(response.body.error.details.reason, 'HOLD_EXPIRED');
        });

        it('never releases a hold that has already been committed', async () => {
            const { hotel, roomType } = await makeSellable({ totalUnits: 1 });
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            // Backdate the committed hold; the sweeper must leave it alone.
            await prisma.bookingHold.update({
                where: { token: hold.body.token },
                data: { expiresAt: new Date(Date.now() - 1_000) }
            });

            await sweepExpiredHolds();

            const inventory = await inventoryFor(roomType.id);
            assert.equal(inventory.bookedUnits, 1, 'the booking still owns the room');
            assert.equal(inventory.heldUnits, 0);
        });
    });

    describe('confirming', () => {
        it('turns a hold into a booking and moves the rooms from held to booked', async () => {
            const { hotel, roomType } = await makeSellable({ totalUnits: 2 });
            const offer = await offerFor(hotel);
            const hold = await request(app).post('/api/bookings/holds').send({ token: offer.token });

            const response = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest(), specialRequests: 'High floor' });

            assert.equal(response.status, 201);
            assert.match(response.body.reference, /^BKG-\d{6,}$/);
            assert.equal(response.body.status, 'CONFIRMED');
            assert.equal(response.body.nights, 3);
            assert.equal(response.body.totalCents, offer.quote.totals.totalCents);

            const inventory = await inventoryFor(roomType.id);
            assert.equal(inventory.heldUnits, 0);
            assert.equal(inventory.bookedUnits, 1);
        });

        it('reports the total the guest was quoted, tax included in the rate and all', async () => {
            const { hotel } = await makeSellable();
            await prisma.hotelTaxFee.create({
                data: { hotelId: hotel.id, name: 'VAT', basis: 'PERCENT', value: 1800, currency: 'GEL', includedInRate: true }
            });
            const offer = await offerFor(hotel);
            const hold = await request(app).post('/api/bookings/holds').send({ token: offer.token });

            const response = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            assert.equal(response.status, 201);
            assert.ok(offer.quote.totals.taxIncludedCents > 0, 'the fixture really carries an included tax');
            // The booking page and the checkout must agree: before this, the
            // booking answered the room price alone and read short by the tax.
            assert.equal(response.body.totalCents, offer.quote.totals.totalCents);
            assert.equal(response.body.taxIncludedCents, offer.quote.totals.taxIncludedCents);
        });

        it('books straight from an offer token, without a hold', async () => {
            const { hotel, roomType } = await makeSellable();
            const offer = await offerFor(hotel);

            const response = await request(app)
                .post('/api/bookings')
                .send({ offerToken: offer.token, leadGuest: leadGuest() });

            assert.equal(response.status, 201);
            assert.equal((await inventoryFor(roomType.id)).bookedUnits, 1);
        });

        it('refuses a body that carries both a hold and an offer', async () => {
            const { hotel } = await makeSellable();
            const offer = await offerFor(hotel);
            const hold = await request(app).post('/api/bookings/holds').send({ token: offer.token });

            const response = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, offerToken: offer.token, leadGuest: leadGuest() });

            assert.equal(response.status, 400);
        });

        // Nothing about money may come from the client.
        it('has no way to send an amount', async () => {
            const { hotel } = await makeSellable();
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            const response = await request(app).post('/api/bookings').send({
                holdToken: hold.body.token,
                leadGuest: leadGuest(),
                totalCents: 1
            });

            assert.equal(response.status, 400, 'a strict schema refuses the field outright');
        });

        // The hold guarantees the rooms, not the price.
        it('refuses when the rate moved while the guest was typing', async () => {
            const { hotel, roomType, ratePlan } = await makeSellable({ netCents: 20_000 });
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            await request(app)
                .put(`/api/admin/hotels/${hotel.id}/room-types/${roomType.id}/rate-plans/${ratePlan.id}/rates`)
                .set('Cookie', adminCookie)
                .send({ from: CHECK_IN, to: LAST_NIGHT, netCents: 40_000 });

            const response = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            assert.equal(response.status, 409);
            assert.equal(response.body.error.details.reason, 'PRICE_CHANGED');
            assert.ok(response.body.error.details.currentCents > response.body.error.details.quotedCents);
        });

        it('refuses to reuse a hold that has already been booked', async () => {
            const { hotel } = await makeSellable();
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            const second = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest('someone.else@example.test') });

            assert.equal(second.status, 409);
            assert.equal(second.body.error.details.reason, 'ALREADY_COMMITTED');
        });
    });

    describe('idempotency', () => {
        it('returns the original booking when the same request is retried', async () => {
            const { hotel, roomType } = await makeSellable({ totalUnits: 3 });
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            const body = { holdToken: hold.body.token, leadGuest: leadGuest() };
            const key = unique('idem');

            const first = await request(app).post('/api/bookings').set('Idempotency-Key', key).send(body);
            const retry = await request(app).post('/api/bookings').set('Idempotency-Key', key).send(body);

            assert.equal(first.status, 201);
            assert.equal(retry.status, 200, 'a replay is not a new booking');
            assert.equal(retry.body.reference, first.body.reference);

            assert.equal((await inventoryFor(roomType.id)).bookedUnits, 1, 'and it took only one room');
            assert.equal(
                await prisma.hotelBooking.count({ where: { reference: first.body.reference } }),
                1
            );
        });

        // A double-submitted form has no header, so the key is derived.
        it('recognises a duplicate submission with no key at all', async () => {
            const { hotel, roomType } = await makeSellable({ totalUnits: 3 });
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            const body = { holdToken: hold.body.token, leadGuest: leadGuest() };

            const first = await request(app).post('/api/bookings').send(body);
            const second = await request(app).post('/api/bookings').send(body);

            assert.equal(first.status, 201);
            assert.equal(second.status, 200);
            assert.equal(second.body.reference, first.body.reference);
            assert.equal((await inventoryFor(roomType.id)).bookedUnits, 1);
        });

        // Booking straight from an offer claims a hold inside the booking's
        // own transaction. Two identical requests that both get past the
        // replay check each claim one; the loser's insert then fails on the
        // key, and its hold has to roll back with it — a hold that committed
        // on its own would keep blocking the room until the sweeper found it.
        it('leaves no hold behind when a lost idempotency race rolls the booking back', async () => {
            const { hotel, roomType } = await makeSellable({ totalUnits: 3 });
            const offer = await offerFor(hotel);
            const key = unique('race');

            const responses = await Promise.all(
                Array.from({ length: 2 }, () =>
                    request(app)
                        .post('/api/bookings')
                        .set('Idempotency-Key', key)
                        .send({ offerToken: offer.token, leadGuest: leadGuest() })
                )
            );

            const created = responses.filter((response) => response.status === 201);
            assert.equal(created.length, 1, 'one booking, not two');
            assert.equal(
                new Set(responses.map((response) => response.body.reference)).size,
                1,
                'the loser is answered with the winner'
            );

            const inventory = await inventoryFor(roomType.id);
            assert.equal(inventory.bookedUnits, 1);
            assert.equal(inventory.heldUnits, 0, 'the losing claim rolled back with its booking');
            assert.equal(
                await prisma.bookingHold.count({ where: { roomTypeId: roomType.id, status: 'ACTIVE' } }),
                0
            );
        });
    });

    // The test the whole design exists for.
    describe('concurrency', () => {
        it('sells the last room exactly once when two guests race for it', async () => {
            const { hotel, roomType } = await makeSellable({ totalUnits: 1 });
            const offer = await offerFor(hotel);

            // Both hold attempts race for the same single room.
            const [a, b] = await Promise.all([
                request(app).post('/api/bookings/holds').send({ token: offer.token }),
                request(app).post('/api/bookings/holds').send({ token: offer.token })
            ]);

            const codes = [a.status, b.status].sort((x, y) => x - y);
            assert.deepEqual(codes, [201, 409], 'exactly one wins');

            const inventory = await inventoryFor(roomType.id);
            assert.equal(inventory.heldUnits, 1, 'and only one room is spoken for');
            assert.ok(
                inventory.bookedUnits + inventory.heldUnits + inventory.blockedUnits <= inventory.totalUnits,
                'the counters never exceed the total'
            );
        });

        it('never oversells when many guests race for a small allocation', async () => {
            const { hotel, roomType } = await makeSellable({ totalUnits: 3 });
            const offer = await offerFor(hotel);

            const attempts = await Promise.all(
                Array.from({ length: 10 }, () =>
                    request(app).post('/api/bookings/holds').send({ token: offer.token })
                )
            );

            const won = attempts.filter((response) => response.status === 201).length;
            const lost = attempts.filter((response) => response.status === 409).length;

            assert.equal(won, 3, 'exactly the three that existed');
            assert.equal(lost, 7);

            for (const date of [CHECK_IN, '2027-07-06', LAST_NIGHT]) {
                const inventory = await inventoryFor(roomType.id, date);
                assert.equal(inventory.heldUnits, 3, `${date} holds exactly three`);
            }
        });

        it('races two confirmations of the same hold and confirms once', async () => {
            const { hotel, roomType } = await makeSellable({ totalUnits: 1 });
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            const [a, b] = await Promise.all([
                request(app)
                    .post('/api/bookings')
                    .send({ holdToken: hold.body.token, leadGuest: leadGuest('one@example.test') }),
                request(app)
                    .post('/api/bookings')
                    .send({ holdToken: hold.body.token, leadGuest: leadGuest('two@example.test') })
            ]);

            const created = [a, b].filter((response) => response.status === 201);
            assert.equal(created.length, 1, 'one booking, not two');

            const inventory = await inventoryFor(roomType.id);
            assert.equal(inventory.bookedUnits, 1);
            assert.equal(inventory.heldUnits, 0);
        });

        it('leaves the counters agreeing with the rows that explain them', async () => {
            const { roomType } = await makeSellable({ totalUnits: 4 });

            const { drift } = await reconcileInventory({ roomTypeIds: [roomType.id] });

            assert.deepEqual(drift, [], 'no drift between counters and their source rows');
        });
    });

    describe('the snapshot', () => {
        it('survives the hotel renaming everything afterwards', async () => {
            const { hotel, roomType, ratePlan } = await makeSellable();
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            const booked = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            const originalName = booked.body.hotelSnapshot.name;
            const originalRoom = booked.body.bookingRooms[0].roomTypeName;

            await prisma.hotel.update({ where: { id: hotel.id }, data: { name: 'Renamed Property' } });
            await prisma.roomType.update({ where: { id: roomType.id }, data: { name: 'Renamed Room' } });
            await prisma.ratePlan.update({ where: { id: ratePlan.id }, data: { name: 'Renamed Rate' } });

            const reread = await request(app).get(
                `/api/bookings/${booked.body.reference}?email=${encodeURIComponent(leadGuest().email)}`
            );

            assert.equal(reread.body.hotelSnapshot.name, originalName);
            assert.equal(reread.body.bookingRooms[0].roomTypeName, originalRoom);
            assert.notEqual(originalRoom, 'Renamed Room');
        });

        it('freezes every night, so a total can be explained', async () => {
            const { hotel } = await makeSellable({ netCents: 20_000 });
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            const booked = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            const nights = booked.body.bookingRooms[0].nights;

            assert.equal(nights.length, 3);
            assert.deepEqual(
                nights.map((night) => night.date),
                [CHECK_IN, '2027-07-06', LAST_NIGHT]
            );
            assert.equal(
                nights.reduce((sum, night) => sum + night.sellCents, 0),
                booked.body.bookingRooms[0].sellSubtotalCents
            );
        });

        it('records the bed configuration as it was sold', async () => {
            const { hotel } = await makeSellable();
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            const booked = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            assert.match(booked.body.bookingRooms[0].bedConfiguration, /King/);
        });

        it('never shows a net rate or margin to a guest', async () => {
            const { hotel } = await makeSellable();
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            const booked = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            const serialized = JSON.stringify(booked.body);
            assert.ok(!serialized.includes('netCents'));
            assert.ok(!serialized.includes('marginCents'));

            const asAdmin = await request(app)
                .get(`/api/admin/bookings/${booked.body.reference}`)
                .set('Cookie', adminCookie);

            assert.ok(asAdmin.body.netTotalCents > 0, 'but an admin sees both sides');
            assert.equal(asAdmin.body.marginCents, asAdmin.body.totalCents - asAdmin.body.netTotalCents);
        });
    });

    describe('cancelling', () => {
        const bookOne = async (options = {}) => {
            const { hotel, roomType } = await makeSellable(options);
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });

            const booked = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            return { booking: booked.body, roomType, hotel };
        };

        it('quotes the charge from the frozen schedule, before doing anything', async () => {
            const { booking } = await bookOne();

            const quote = await request(app).get(
                `/api/bookings/${booking.reference}/cancellation-quote?email=${encodeURIComponent(leadGuest().email)}`
            );

            assert.equal(quote.status, 200);
            // Far from check-in under a flexible policy, so nothing is charged.
            assert.equal(quote.body.chargeCents, 0);
            assert.equal(quote.body.refundCents, booking.totalCents);

            const unchanged = await prisma.hotelBooking.findFirst({
                where: { reference: booking.reference }
            });
            assert.equal(unchanged.status, 'CONFIRMED', 'quoting changes nothing');
        });

        it('gives the rooms back and records the charge', async () => {
            const { booking, roomType } = await bookOne();

            const response = await request(app).post(`/api/bookings/${booking.reference}/cancel`).send({
                reason: 'Change of plans',
                email: leadGuest().email
            });

            assert.equal(response.status, 200);
            assert.equal(response.body.status, 'CANCELLED');
            assert.equal(response.body.cancellation.chargeCents, 0);

            const inventory = await inventoryFor(roomType.id);
            assert.equal(inventory.bookedUnits, 0, 'the room is back on sale');
        });

        // The reason the schedule is frozen onto the booking.
        it('is unaffected by the hotel tightening its policy afterwards', async () => {
            const { booking, hotel } = await bookOne();

            const policy = await prisma.cancellationPolicy.create({
                data: {
                    hotelId: hotel.id,
                    name: 'Suddenly strict',
                    kind: 'NON_REFUNDABLE',
                    rules: { create: [{ hoursBeforeCheckIn: 87_600, chargeBasis: 'PERCENT_OF_TOTAL', chargeValue: 10_000 }] }
                }
            });
            await prisma.ratePlan.updateMany({
                where: { roomType: { hotelId: hotel.id } },
                data: { cancellationPolicyId: policy.id }
            });

            const quote = await request(app).get(
                `/api/bookings/${booking.reference}/cancellation-quote?email=${encodeURIComponent(leadGuest().email)}`
            );

            assert.equal(quote.body.chargeCents, 0, 'the terms agreed at booking still stand');
            assert.equal(quote.body.refundCents, booking.totalCents);
        });

        it('charges in full for a non-refundable rate', async () => {
            const { booking } = await bookOne({ cancellationKind: 'NON_REFUNDABLE' });

            const quote = await request(app).get(
                `/api/bookings/${booking.reference}/cancellation-quote?email=${encodeURIComponent(leadGuest().email)}`
            );

            assert.equal(quote.body.chargeCents, booking.totalCents);
            assert.equal(quote.body.refundCents, 0);
            assert.equal(quote.body.refundable, false);
        });

        it('refuses to cancel twice', async () => {
            const { booking } = await bookOne();

            await request(app)
                .post(`/api/bookings/${booking.reference}/cancel`)
                .send({ email: leadGuest().email });
            const again = await request(app)
                .post(`/api/bookings/${booking.reference}/cancel`)
                .send({ email: leadGuest().email });

            assert.equal(again.status, 409);
        });

        it('leaves no counter drift behind', async () => {
            const { booking, roomType } = await bookOne({ totalUnits: 2 });
            await request(app)
                .post(`/api/bookings/${booking.reference}/cancel`)
                .send({ email: leadGuest().email });

            const { drift } = await reconcileInventory({ roomTypeIds: [roomType.id] });

            assert.deepEqual(drift, []);
        });
    });

    describe('who can see a booking', () => {
        it('scopes a partner to its own bookings', async () => {
            const { hotel } = await makeSellable();
            const hold = await request(app)
                .post('/api/bookings/holds')
                .set('Cookie', partnerCookie)
                .send({ token: (await offerFor(hotel, partnerCookie)).token });

            const mine = await request(app)
                .post('/api/bookings')
                .set('Cookie', partnerCookie)
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            assert.equal(mine.status, 201);

            const list = await request(app).get('/api/partner/bookings').set('Cookie', partnerCookie);
            assert.ok(list.body.data.some((row) => row.reference === mine.body.reference));

            // Another partner must not reach it, and gets a 404 rather than a
            // 403 so a reference cannot be probed for existence.
            const otherPartner = await makePartner(tracker);
            const otherCookie = (await signIn(app, (await makePartnerUser(tracker, otherPartner)).email))
                .cookie;

            const probe = await request(app)
                .get(`/api/bookings/${mine.body.reference}`)
                .set('Cookie', otherCookie);

            assert.equal(probe.status, 404);
        });

        // Who searched decides the markup, so a token minted for a guest cannot
        // be redeemed at partner pricing — the re-quote simply disagrees.
        it('refuses an offer token issued to a different kind of buyer', async () => {
            const { hotel } = await makeSellable();
            const guestOffer = await offerFor(hotel);
            const partnerOffer = await offerFor(hotel, partnerCookie);

            assert.notEqual(
                guestOffer.quote.totals.totalCents,
                partnerOffer.quote.totals.totalCents,
                'the two buyers are quoted differently in the first place'
            );

            const response = await request(app)
                .post('/api/bookings/holds')
                .set('Cookie', partnerCookie)
                .send({ token: guestOffer.token });

            assert.equal(response.status, 409);
            assert.equal(response.body.error.details.reason, 'PRICE_CHANGED');
        });

        it('refuses a partner user on the admin booking list', async () => {
            assert.equal(
                (await request(app).get('/api/admin/bookings').set('Cookie', partnerCookie)).status,
                403
            );
        });

        // References come from a sequence, so a reference alone must never be
        // enough to read someone else's booking.
        it('refuses a guest booking looked up without the matching email', async () => {
            const { hotel } = await makeSellable();
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });
            const booked = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            assert.equal((await request(app).get(`/api/bookings/${booked.body.reference}`)).status, 404);
            assert.equal(
                (await request(app).get(`/api/bookings/${booked.body.reference}?email=wrong@example.test`))
                    .status,
                404
            );
            assert.equal(
                (await request(app).get(
                    `/api/bookings/${booked.body.reference}?email=${encodeURIComponent(leadGuest().email)}`
                )).status,
                200
            );
        });

        it('answers 404 for a reference that does not exist', async () => {
            assert.equal((await request(app).get('/api/bookings/BKG-999999')).status, 404);
        });
    });

    /**
     * Amendments.
     *
     * The interesting assertions are the negative ones: what a PATCH *cannot*
     * reach is the whole reason the endpoint is safe to expose to a partner.
     */
    /**
     * Structured requirements on a booking.
     *
     * The distinction being tested throughout: a **capability** says the
     * property can, a **request** says this guest needs. The two are different
     * records, they are validated against each other, and neither one is
     * allowed to be read as the other.
     */
    describe('requirements', () => {
        /** Gives a property a kosher facility, so it can be asked for one. */
        const withFacility = async (hotelId, category = 'Shabbat') => {
            const amenity = await makeAmenity(tracker, {
                code: unique('shabbatLift'),
                category
            });

            await prisma.hotelAmenity.create({ data: { hotelId, amenityId: amenity.id } });

            return amenity;
        };

        it('records what was asked for, and leaves the booking confirmed', async () => {
            const { hotel } = await makeSellable();
            const facility = await withFacility(hotel.id);
            const offer = await offerFor(hotel);

            const response = await request(app)
                .post('/api/bookings')
                .send({
                    offerToken: offer.token,
                    leadGuest: leadGuest(),
                    requests: [{ code: facility.code, note: 'Two kosher dinners, Fri and Sat' }]
                });

            assert.equal(response.status, 201);
            // The rooms were claimed and priced; a meal still being arranged
            // does not put them back in doubt.
            assert.equal(response.body.status, 'CONFIRMED');
            assert.equal(response.body.requests.length, 1);
            assert.equal(response.body.requests[0].status, 'REQUESTED');
            assert.equal(response.body.requests[0].note, 'Two kosher dinners, Fri and Sat');
            assert.equal(response.body.requestsPending, 1);
        });

        it('refuses a requirement the property does not offer', async () => {
            const { hotel } = await makeSellable();
            const offer = await offerFor(hotel);

            const response = await request(app)
                .post('/api/bookings')
                .send({
                    offerToken: offer.token,
                    leadGuest: leadGuest(),
                    requests: [{ code: 'mikvehOnSite' }]
                });

            // 422 rather than 400: the request is well formed, it is the
            // property that cannot meet it.
            assert.equal(response.status, 422);
            assert.deepEqual(response.body.error.details.unsupported, ['mikvehOnSite']);
        });

        it('claims no inventory when a requirement is refused', async () => {
            const { hotel, roomType } = await makeSellable();
            const offer = await offerFor(hotel);

            await request(app)
                .post('/api/bookings')
                .send({
                    offerToken: offer.token,
                    leadGuest: leadGuest(),
                    requests: [{ code: 'mikvehOnSite' }]
                });

            const inventory = await inventoryFor(roomType.id);

            // The check runs before anything is claimed, so a refused booking
            // leaves no held or booked room behind it.
            assert.equal(inventory.bookedUnits, 0);
            assert.equal(inventory.heldUnits, 0);
        });

        it('always allows a kosher meal to be asked for', async () => {
            // A property that serves kosher food can be asked for a kosher meal
            // whether or not anybody remembered to tick the box.
            const { hotel } = await makeSellable();
            const offer = await offerFor(hotel);

            const response = await request(app)
                .post('/api/bookings')
                .send({
                    offerToken: offer.token,
                    leadGuest: leadGuest(),
                    requests: [{ code: 'kosherMealOnRequest' }]
                });

            assert.equal(response.status, 201);
        });

        it('refuses the same requirement twice in one request', async () => {
            const { hotel } = await makeSellable();
            const facility = await withFacility(hotel.id);
            const offer = await offerFor(hotel);

            const response = await request(app)
                .post('/api/bookings')
                .send({
                    offerToken: offer.token,
                    leadGuest: leadGuest(),
                    requests: [{ code: facility.code }, { code: facility.code }]
                });

            assert.equal(response.status, 400);
        });

        it('lets the property confirm one, and requires a reason to decline', async () => {
            const { hotel } = await makeSellable();
            const facility = await withFacility(hotel.id);
            const offer = await offerFor(hotel);

            const booked = await request(app)
                .post('/api/bookings')
                .send({
                    offerToken: offer.token,
                    leadGuest: leadGuest(),
                    requests: [{ code: facility.code }, { code: 'kosherMealOnRequest' }]
                });

            const [first, second] = booked.body.requests;
            const base = `/api/admin/bookings/${booked.body.reference}/requests`;

            const confirmed = await request(app)
                .post(`${base}/${first.id}`)
                .set('Cookie', adminCookie)
                .send({ status: 'CONFIRMED' });

            assert.equal(confirmed.status, 200);
            assert.equal(confirmed.body.requestsPending, 1);

            const bare = await request(app)
                .post(`${base}/${second.id}`)
                .set('Cookie', adminCookie)
                .send({ status: 'DECLINED' });
            assert.equal(bare.status, 400, 'a refusal an agency cannot explain is not a decision');

            const declined = await request(app)
                .post(`${base}/${second.id}`)
                .set('Cookie', adminCookie)
                .send({ status: 'DECLINED', responseNote: 'The chef is away that week.' });

            assert.equal(declined.status, 200);
            assert.equal(declined.body.requestsPending, 0);
            // Declining a requirement does not cancel a reservation.
            assert.equal(declined.body.status, 'CONFIRMED');
        });

        it('will not let a partner answer its own request', async () => {
            const { hotel } = await makeSellable();
            const facility = await withFacility(hotel.id);
            const offer = await offerFor(hotel, partnerCookie);

            const booked = await request(app)
                .post('/api/bookings')
                .set('Cookie', partnerCookie)
                .send({
                    offerToken: offer.token,
                    leadGuest: leadGuest(),
                    requests: [{ code: facility.code }]
                });

            const response = await request(app)
                .post(
                    `/api/admin/bookings/${booked.body.reference}/requests/${booked.body.requests[0].id}`
                )
                .set('Cookie', partnerCookie)
                .send({ status: 'CONFIRMED' });

            // A booking that confirms its own requirements is not a
            // confirmation of anything.
            assert.equal(response.status, 403);
        });

        it('refuses to answer the same requirement twice', async () => {
            const { hotel } = await makeSellable();
            const facility = await withFacility(hotel.id);
            const offer = await offerFor(hotel);

            const booked = await request(app)
                .post('/api/bookings')
                .send({
                    offerToken: offer.token,
                    leadGuest: leadGuest(),
                    requests: [{ code: facility.code }]
                });

            const url = `/api/admin/bookings/${booked.body.reference}/requests/${booked.body.requests[0].id}`;

            await request(app).post(url).set('Cookie', adminCookie).send({ status: 'CONFIRMED' });
            const again = await request(app)
                .post(url)
                .set('Cookie', adminCookie)
                .send({ status: 'CONFIRMED' });

            assert.equal(again.status, 409);
        });

        it('withdraws a requirement left out of an amendment, rather than deleting it', async () => {
            const { hotel } = await makeSellable();
            const facility = await withFacility(hotel.id);
            const offer = await offerFor(hotel);

            const booked = await request(app)
                .post('/api/bookings')
                .send({
                    offerToken: offer.token,
                    leadGuest: leadGuest(),
                    requests: [{ code: facility.code }, { code: 'kosherMealOnRequest' }]
                });

            const amended = await request(app)
                .patch(`/api/bookings/${booked.body.reference}`)
                .set('Cookie', adminCookie)
                .send({ requests: [{ code: 'kosherMealOnRequest' }] });

            const byCode = Object.fromEntries(
                amended.body.requests.map((request_) => [request_.code, request_])
            );

            assert.equal(amended.status, 200);
            // Still on the record: "they asked and changed their mind" is worth
            // being able to see.
            assert.equal(byCode[facility.code].status, 'WITHDRAWN');
            assert.equal(byCode.kosherMealOnRequest.status, 'REQUESTED');
        });

        it('cannot un-decline a requirement by asking again', async () => {
            const { hotel } = await makeSellable();
            const offer = await offerFor(hotel);

            const booked = await request(app)
                .post('/api/bookings')
                .send({
                    offerToken: offer.token,
                    leadGuest: leadGuest(),
                    requests: [{ code: 'kosherMealOnRequest' }]
                });

            await request(app)
                .post(
                    `/api/admin/bookings/${booked.body.reference}/requests/${booked.body.requests[0].id}`
                )
                .set('Cookie', adminCookie)
                .send({ status: 'DECLINED', responseNote: 'No kosher kitchen that week.' });

            const amended = await request(app)
                .patch(`/api/bookings/${booked.body.reference}`)
                .set('Cookie', adminCookie)
                .send({ requests: [{ code: 'kosherMealOnRequest', note: 'Please reconsider' }] });

            // The note may be corrected; the answer stands.
            assert.equal(amended.body.requests[0].status, 'DECLINED');
            assert.equal(amended.body.requests[0].note, 'Please reconsider');
        });

        it('adds a requirement through an amendment, checked against the property', async () => {
            const { hotel } = await makeSellable();
            const offer = await offerFor(hotel);

            const booked = await request(app)
                .post('/api/bookings')
                .send({ offerToken: offer.token, leadGuest: leadGuest() });

            assert.deepEqual(booked.body.requests, []);

            const added = await request(app)
                .patch(`/api/bookings/${booked.body.reference}`)
                .set('Cookie', adminCookie)
                .send({ requests: [{ code: 'kosherMealOnRequest' }] });

            assert.equal(added.body.requests.length, 1);

            const refused = await request(app)
                .patch(`/api/bookings/${booked.body.reference}`)
                .set('Cookie', adminCookie)
                .send({ requests: [{ code: 'mikvehOnSite' }] });

            assert.equal(refused.status, 422);
        });

        it('leaves a booking made without any requirements exactly as it was', async () => {
            // Backward compatibility, as an assertion: every booking made before
            // this feature existed reads as an empty list and a zero count.
            const { hotel } = await makeSellable();
            const offer = await offerFor(hotel);

            const response = await request(app)
                .post('/api/bookings')
                .send({ offerToken: offer.token, leadGuest: leadGuest() });

            assert.equal(response.status, 201);
            assert.deepEqual(response.body.requests, []);
            assert.equal(response.body.requestsPending, 0);
        });

        it('writes an audit row when the property answers', async () => {
            const { hotel } = await makeSellable();
            const offer = await offerFor(hotel);

            const booked = await request(app)
                .post('/api/bookings')
                .send({
                    offerToken: offer.token,
                    leadGuest: leadGuest(),
                    requests: [{ code: 'kosherMealOnRequest' }]
                });

            const requestId = booked.body.requests[0].id;

            await request(app)
                .post(`/api/admin/bookings/${booked.body.reference}/requests/${requestId}`)
                .set('Cookie', adminCookie)
                .send({ status: 'CONFIRMED' });

            const entries = await prisma.auditLog.findMany({
                where: { action: 'BOOKING_REQUEST_ANSWERED', entityId: requestId }
            });

            assert.equal(entries.length, 1);
            assert.equal(entries[0].metadata.code, 'kosherMealOnRequest');
        });
    });

    describe('amending a booking', () => {
        const bookAsPartner = async () => {
            const { hotel } = await makeSellable();
            const hold = await request(app)
                .post('/api/bookings/holds')
                .set('Cookie', partnerCookie)
                .send({ token: (await offerFor(hotel, partnerCookie)).token });

            const booked = await request(app)
                .post('/api/bookings')
                .set('Cookie', partnerCookie)
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            return booked.body;
        };

        it('corrects the lead guest everywhere the name is held', async () => {
            const booking = await bookAsPartner();

            const response = await request(app)
                .patch(`/api/bookings/${booking.reference}`)
                .set('Cookie', partnerCookie)
                .send({
                    leadGuest: { firstName: 'Nino', lastName: 'Beridze-Kapanadze', phone: null },
                    specialRequests: 'High floor, late arrival'
                });

            assert.equal(response.status, 200);
            assert.equal(response.body.leadGuestName, 'Nino Beridze-Kapanadze');
            assert.equal(response.body.leadGuestPhone, null);
            assert.equal(response.body.specialRequests, 'High floor, late arrival');

            // The rooming list the property works from must agree with the
            // summary; a correction that reached only one is the bug.
            const rows = await prisma.bookingGuest.findMany({
                where: { bookingRoom: { booking: { reference: booking.reference } }, isLead: true }
            });

            assert.ok(rows.length > 0);
            assert.ok(rows.every((row) => row.lastName === 'Beridze-Kapanadze'));
        });

        it('leaves the money and the stay untouched', async () => {
            const booking = await bookAsPartner();

            const response = await request(app)
                .patch(`/api/bookings/${booking.reference}`)
                .set('Cookie', partnerCookie)
                .send({ specialRequests: 'Cot in the room' });

            assert.equal(response.body.totalCents, booking.totalCents);
            assert.equal(response.body.checkIn, booking.checkIn);
            assert.equal(response.body.checkOut, booking.checkOut);
            assert.equal(response.body.rooms, booking.rooms);
        });

        // The schema is strict, so a body that could name a price or a date is
        // rejected outright rather than silently ignored.
        for (const body of [{ totalCents: 1 }, { checkIn: '2027-08-01' }, { status: 'COMPLETED' }]) {
            it(`refuses a body carrying ${Object.keys(body)[0]}`, async () => {
                const booking = await bookAsPartner();

                const response = await request(app)
                    .patch(`/api/bookings/${booking.reference}`)
                    .set('Cookie', partnerCookie)
                    .send(body);

                assert.equal(response.status, 400);
            });
        }

        it('refuses another partner, with a 404', async () => {
            const booking = await bookAsPartner();
            const other = await makePartner(tracker);
            const otherCookie = (await signIn(app, (await makePartnerUser(tracker, other)).email)).cookie;

            const response = await request(app)
                .patch(`/api/bookings/${booking.reference}`)
                .set('Cookie', otherCookie)
                .send({ specialRequests: 'Not mine to change' });

            assert.equal(response.status, 404);
        });

        it('refuses to amend a cancelled booking', async () => {
            const booking = await bookAsPartner();

            await request(app)
                .post(`/api/bookings/${booking.reference}/cancel`)
                .set('Cookie', partnerCookie)
                .send({});

            const response = await request(app)
                .patch(`/api/bookings/${booking.reference}`)
                .set('Cookie', partnerCookie)
                .send({ specialRequests: 'Too late' });

            assert.equal(response.status, 409);
            assert.equal(response.body.error.details.status, 'CANCELLED');
        });

        it('lets a guest amend theirs only by quoting the lead email', async () => {
            const { hotel } = await makeSellable();
            const hold = await request(app)
                .post('/api/bookings/holds')
                .send({ token: (await offerFor(hotel)).token });
            const booked = await request(app)
                .post('/api/bookings')
                .send({ holdToken: hold.body.token, leadGuest: leadGuest() });

            assert.equal(
                (await request(app)
                    .patch(`/api/bookings/${booked.body.reference}`)
                    .send({ specialRequests: 'No email, no entry' })).status,
                404
            );

            const allowed = await request(app)
                .patch(`/api/bookings/${booked.body.reference}`)
                .send({ email: leadGuest().email, specialRequests: 'Quiet room please' });

            assert.equal(allowed.status, 200);
            assert.equal(allowed.body.specialRequests, 'Quiet room please');
        });
    });
});
