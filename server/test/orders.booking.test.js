import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { reconcileInventory } from '../services/hotel/availability.service.js';
import { reconcileTourInventory } from '../services/tour/availability.service.js';
import { createTracker, databaseAvailable, makeAdmin, makeDestination, makePartner, makePartnerUser, signIn } from './support/factories.js';
import { makeSellableHotel, makeService, makeTourDeparture, makeTransferLeg } from './support/packages.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const START = '2027-01-08';
const TOUR_DATE = '2027-01-09';

/**
 * The order: one transaction, four products.
 *
 * What these tests hold the orchestrator to: an order is all or nothing;
 * a replay is the same order; a moved price is one 409 naming every slot
 * that moved; a child of an order cannot be cancelled on its own; and the
 * database refuses an item that points at two children.
 */
describe('orders', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let adminCookie;
    let partnerCookie;
    let destination;
    let leg;
    let service;

    before(async () => {
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;
        partnerCookie = (await signIn(app, (await makePartnerUser(tracker, await makePartner(tracker))).email)).cookie;
        destination = await makeDestination(tracker);
        leg = await makeTransferLeg(tracker, { destination });
        service = await makeService(tracker, { destination });
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const lead = { firstName: 'Nino', lastName: 'Beridze', email: 'nino@example.test' };

    /** A published package with a fresh hotel and tour, so seat counts are the test's own. */
    const makePackage = async ({ seats = 12, rooms = 5, serviceRequired = false, extra = {} } = {}) => {
        const hotel = await makeSellableHotel(app, adminCookie, tracker, { destination, checkIn: START, nights: 3, totalUnits: rooms });
        const tour = await makeTourDeparture(tracker, { destination, date: TOUR_DATE });
        await prisma.tourInventory.update({
            where: { tourOptionId_date: { tourOptionId: tour.option.id, date: new Date(`${TOUR_DATE}T00:00:00.000Z`) } },
            data: { totalUnits: seats }
        });

        const created = await request(app)
            .post('/api/admin/packages')
            .set('Cookie', adminCookie)
            .send({
                slug: `order-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                name: 'Weekend in the mountains',
                destinationId: destination.id,
                summary: 'Two nights, a trek and a transfer.',
                image: '/images/packages/test.jpg',
                nights: 2,
                b2cEnabled: true,
                adjustmentKind: 'DISCOUNT_BPS',
                adjustmentValue: 1000,
                components: [
                    { componentType: 'HOTEL_STAY', label: 'Two nights', nights: 2, hotelId: hotel.hotel.id },
                    { componentType: 'TRANSFER', label: 'Airport pick-up', fromPointId: leg.from.id, toPointId: leg.to.id, timeOfDay: '11:00' },
                    { componentType: 'TOUR', label: 'The trek', dayOffset: 1, tourId: tour.tour.id },
                    { componentType: 'SERVICE', label: 'Kosher dinner', required: serviceRequired, serviceId: service.id, quantityRule: 'PER_PERSON' }
                ],
                ...extra
            });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        tracker.package(created.body);
        await request(app).post(`/api/admin/packages/${created.body.id}/publish`).set('Cookie', adminCookie);

        return { pkg: created.body, hotel, tour };
    };

    const quoteFor = async (pkg, cookie = null) => {
        const pin = encodeURIComponent(JSON.stringify({ 1: { vehicleId: leg.vehicle.id } }));
        const call = request(app).get(`/api/packages/${pkg.slug}/quote?startDate=${START}&adults=2&choices=${pin}`);
        const response = await (cookie ? call.set('Cookie', cookie) : call);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.available, true, JSON.stringify(response.body));

        return response.body;
    };

    const inventoryOf = async (tour) =>
        prisma.tourInventory.findUnique({
            where: { tourOptionId_date: { tourOptionId: tour.option.id, date: new Date(`${TOUR_DATE}T00:00:00.000Z`) } }
        });

    it('books a package whose hotel charges tax, at the price it quoted', async () => {
        const { pkg, hotel } = await makePackage();

        // A city tax included in the rate. Every real hotel has one; none of
        // the other fixtures did, which is how a package quote priced on the
        // room alone while the order committed on room-plus-tax went unnoticed
        // until a seeded property with a tax row was booked by hand.
        await prisma.hotelTaxFee.create({
            data: {
                hotelId: hotel.hotel.id,
                name: 'City tax',
                basis: 'PERCENT',
                value: 1800,
                currency: 'GEL',
                includedInRate: true
            }
        });

        const quote = await quoteFor(pkg);
        const stay = quote.components[0];
        assert.ok(stay.resolved.sellCents > 0);

        const created = await request(app)
            .post('/api/orders')
            .send({ packageToken: quote.token, leadGuest: lead });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.equal(created.body.totalCents, quote.totals.totalCents);
        assert.equal(created.body.items[0].sellCents, stay.resolved.sellCents);
    });

    it('confirms an order with one child per slot, atomically, and replays on the same key', async () => {
        const { pkg, hotel, tour } = await makePackage();
        const quote = await quoteFor(pkg);
        const key = `ord-${Date.now()}`;

        const created = await request(app)
            .post('/api/orders')
            .set('Idempotency-Key', key)
            .send({ packageToken: quote.token, leadGuest: lead, travellers: [{ firstName: 'Giorgi', lastName: 'Beridze' }] });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.match(created.body.reference, /^ORD-\d{6}$/);
        assert.equal(created.body.status, 'CONFIRMED');
        assert.equal(created.body.totalCents, quote.totals.totalCents);
        assert.equal(created.body.items.length, 4);
        assert.equal(created.body.componentsNetCents, undefined, 'order net is admin-only');

        const [stay, transfer, trek, dinner] = created.body.items;
        assert.match(stay.booking.reference, /^BKG-/);
        assert.match(transfer.booking.reference, /^TRF-/);
        assert.match(trek.booking.reference, /^TUR-/);
        assert.match(dinner.booking.reference, /^SVC-/);
        assert.equal(stay.status, 'CONFIRMED');
        assert.equal(stay.booking.hotel.id, hotel.hotel.id);
        assert.equal(created.body.items.reduce((sum, item) => sum + item.lineTotalCents, 0), created.body.totalCents);
        assert.ok(stay.adjustmentCents < 0, 'the discount landed on the required lines');
        assert.equal(dinner.adjustmentCents, 0);

        // Seats and rooms were claimed once each.
        assert.equal((await inventoryOf(tour)).bookedUnits, 2);
        const night = await prisma.roomInventory.findFirst({ where: { roomTypeId: hotel.roomType.id, date: new Date(`${START}T00:00:00.000Z`) } });
        assert.equal(night.bookedUnits, 1);

        // Replay: same key, same order, no second claim.
        const replay = await request(app)
            .post('/api/orders')
            .set('Idempotency-Key', key)
            .send({ packageToken: quote.token, leadGuest: lead });
        assert.equal(replay.status, 200);
        assert.equal(replay.body.reference, created.body.reference);
        assert.equal((await inventoryOf(tour)).bookedUnits, 2);

        // The guest reads it by email; a stranger does not.
        const mine = await request(app).get(`/api/orders/${created.body.reference}?email=${encodeURIComponent(lead.email)}`);
        assert.equal(mine.status, 200);
        assert.equal((await request(app).get(`/api/orders/${created.body.reference}?email=other@example.test`)).status, 404);

        // The children are reachable on their own registers, but cancelling one
        // there is refused: the order is the only door.
        const standalone = await request(app)
            .post(`/api/tours/bookings/${trek.booking.reference}/cancel`)
            .send({ email: lead.email });
        assert.equal(standalone.status, 409, JSON.stringify(standalone.body));
        assert.equal(standalone.body.error.details.reason, 'PART_OF_ORDER');
        assert.equal(standalone.body.error.details.orderReference, created.body.reference);

        const hotelStandalone = await request(app)
            .post(`/api/bookings/${stay.booking.reference}/cancel`)
            .send({ email: lead.email });
        assert.equal(hotelStandalone.status, 409);
        assert.equal(hotelStandalone.body.error.details.reason, 'PART_OF_ORDER');

        // Every audit row and outbox event is there, and the counters agree.
        assert.ok(await prisma.auditLog.findFirst({ where: { action: 'ORDER_CREATED', entityType: 'Order' } }));
        const event = await prisma.outboxEvent.findFirst({ where: { topic: 'order.confirmed', entityType: 'Order' }, orderBy: { createdAt: 'desc' } });
        assert.ok(event);
        assert.deepEqual((await reconcileTourInventory({ tourOptionIds: [tour.option.id] })).drift ?? [], []);
    });

    it('writes nothing when one slot cannot be claimed', async () => {
        const { pkg, hotel, tour } = await makePackage({ seats: 2 });
        const quote = await quoteFor(pkg);

        // Someone else takes the last two seats between the quote and the confirmation.
        await prisma.tourInventory.update({
            where: { tourOptionId_date: { tourOptionId: tour.option.id, date: new Date(`${TOUR_DATE}T00:00:00.000Z`) } },
            data: { bookedUnits: 2 }
        });

        // Scoped to this package's orders. Test files share one database and
        // run side by side, so a count of every `order.*` event moves whenever
        // another file confirms an order between the two reads.
        const orderEvents = async () => {
            const orders = await prisma.order.findMany({ where: { packageId: pkg.id }, select: { id: true } });

            return prisma.outboxEvent.count({
                where: { topic: { startsWith: 'order.' }, entityId: { in: orders.map(({ id }) => id) } }
            });
        };

        const before = {
            orders: await prisma.order.count({ where: { packageId: pkg.id } }),
            hotelBookings: await prisma.hotelBooking.count({ where: { hotelId: hotel.hotel.id } }),
            holds: await prisma.bookingHold.count({ where: { roomTypeId: hotel.roomType.id } }),
            outbox: await orderEvents()
        };

        const refused = await request(app).post('/api/orders').send({ packageToken: quote.token, leadGuest: lead });
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.error.details.reason, 'UNAVAILABLE');
        assert.deepEqual(
            refused.body.error.details.slots.map((slot) => slot.slotIndex),
            [2]
        );

        assert.equal(await prisma.order.count({ where: { packageId: pkg.id } }), before.orders);
        assert.equal(await prisma.hotelBooking.count({ where: { hotelId: hotel.hotel.id } }), before.hotelBookings);
        assert.equal(await prisma.bookingHold.count({ where: { roomTypeId: hotel.roomType.id } }), before.holds);
        assert.equal(await orderEvents(), before.outbox);
        const night = await prisma.roomInventory.findFirst({ where: { roomTypeId: hotel.roomType.id, date: new Date(`${START}T00:00:00.000Z`) } });
        assert.equal(night.bookedUnits, 0);
        assert.equal(night.heldUnits, 0);
    });

    it('refuses a moved price as one 409 naming every drifted slot', async () => {
        const { pkg, hotel, tour } = await makePackage();
        const quote = await quoteFor(pkg);

        await prisma.rate.updateMany({ where: { ratePlanId: hotel.ratePlan.id }, data: { netCents: 25_000 } });
        await prisma.tourSeasonTier.updateMany({ where: { season: { tourOptionId: tour.option.id } }, data: { adultNetCents: 12_000 } });

        const refused = await request(app).post('/api/orders').send({ packageToken: quote.token, leadGuest: lead });
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.error.details.reason, 'PRICE_CHANGED');
        assert.deepEqual(refused.body.error.details.components.map((slot) => slot.slotIndex), [0, 2]);
        assert.equal(refused.body.error.details.quotedCents, quote.totals.totalCents);
        assert.ok(refused.body.error.details.currentCents > quote.totals.totalCents);

        // A fresh quote books.
        const fresh = await quoteFor(pkg);
        const created = await request(app).post('/api/orders').send({ packageToken: fresh.token, leadGuest: lead });
        assert.equal(created.status, 201, JSON.stringify(created.body));
    });

    it('commits pre-held rooms and seats rather than claiming them twice', async () => {
        const { pkg, hotel, tour } = await makePackage({ seats: 2, rooms: 1 });
        const quote = await quoteFor(pkg);

        const held = await request(app).post('/api/orders/holds').send({ packageToken: quote.token });
        assert.equal(held.status, 201, JSON.stringify(held.body));
        assert.ok(held.body.holdTokens['0'] && held.body.holdTokens['2']);
        assert.ok(held.body.expiresAt);
        assert.equal((await inventoryOf(tour)).heldUnits, 2);

        const created = await request(app)
            .post('/api/orders')
            .send({ packageToken: quote.token, holdTokens: held.body.holdTokens, leadGuest: lead });
        assert.equal(created.status, 201, JSON.stringify(created.body));

        const row = await inventoryOf(tour);
        assert.equal(row.heldUnits, 0);
        assert.equal(row.bookedUnits, 2);
        const night = await prisma.roomInventory.findFirst({ where: { roomTypeId: hotel.roomType.id, date: new Date(`${START}T00:00:00.000Z`) } });
        assert.equal(night.heldUnits, 0);
        assert.equal(night.bookedUnits, 1);
        assert.deepEqual((await reconcileInventory({ roomTypeIds: [hotel.roomType.id] })).drift ?? [], []);
    });

    it('lets the database refuse an item that points at two children', async () => {
        const { pkg } = await makePackage();
        const quote = await quoteFor(pkg, partnerCookie);
        const created = await request(app).post('/api/orders').set('Cookie', partnerCookie).send({ packageToken: quote.token, leadGuest: lead });
        assert.equal(created.status, 201, JSON.stringify(created.body));

        const order = await prisma.order.findUnique({ where: { reference: created.body.reference }, include: { items: true } });
        const [stay, , trek] = order.items;

        await assert.rejects(
            prisma.orderItem.create({
                data: {
                    orderId: order.id,
                    slotIndex: 9,
                    componentType: 'TOUR',
                    label: 'Impossible',
                    status: 'CONFIRMED',
                    hotelBookingId: stay.hotelBookingId,
                    tourBookingId: trek.tourBookingId,
                    netCents: 0,
                    sellCents: 0,
                    lineTotalCents: 0
                }
            }),
            (error) => /order_items_exactly_one_child|order_items_child_matches_type/.test(error.message)
        );

        // And the partner register lists it; another partner's does not.
        const mine = await request(app).get('/api/partner/orders').set('Cookie', partnerCookie);
        assert.ok(mine.body.data.some((row) => row.reference === created.body.reference));
        const admin = await request(app).get(`/api/admin/orders/${created.body.reference}`).set('Cookie', adminCookie);
        assert.equal(admin.status, 200);
        assert.ok(admin.body.marginCents > 0);
    });
});
