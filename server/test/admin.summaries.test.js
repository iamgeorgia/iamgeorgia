import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makeHotel,
    makePartner,
    makePartnerUser,
    makeTransferBooking,
    makeTransferPoint,
    makeTransferProvider,
    makeTransferVehicle,
    signIn,
    unique
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const DAY = 86_400_000;

/**
 * The aggregate endpoints behind the admin panel's sidebar badges and
 * dashboard tiles. They replace lists fetched with `pageSize: 1` for their
 * `total` and pages of a hundred rows summed in the client, so the tests
 * pin down two things: who may read which figure, and that the sums are the
 * database's, not a sample's.
 */
describe('admin summaries', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const bookingIds = [];

    let adminCookie;
    let dispatcherCookie;
    let partnerCookie;
    let hotel;
    let vehicleClass;
    let airport;
    let city;

    const seedHotelBooking = async (overrides = {}) => {
        const booking = await prisma.hotelBooking.create({
            data: {
                reference: unique('BKG'),
                hotelId: hotel.id,
                status: 'CONFIRMED',
                checkIn: new Date('2031-01-10'),
                checkOut: new Date('2031-01-12'),
                nights: 2,
                currency: 'GEL',
                netTotalCents: 20000,
                sellTotalCents: 23000,
                markupBps: 1500,
                leadGuestName: 'Ana Beridze',
                leadGuestEmail: 'ana@example.test',
                hotelSnapshot: {},
                ...overrides
            }
        });
        bookingIds.push(booking.id);
        return booking;
    };

    before(async () => {
        const admin = await makeAdmin(tracker);
        const dispatcher = await makeAdmin(tracker, { role: 'DISPATCHER' });
        const partner = await makePartner(tracker);
        const partnerUser = await makePartnerUser(tracker, partner);

        adminCookie = (await signIn(app, admin.email)).cookie;
        dispatcherCookie = (await signIn(app, dispatcher.email)).cookie;
        partnerCookie = (await signIn(app, partnerUser.email)).cookie;

        hotel = await makeHotel(tracker);

        const provider = tracker.transferProvider(await makeTransferProvider());
        vehicleClass = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        airport = tracker.transferPoint(await makeTransferPoint({ kind: 'AIRPORT' }));
        city = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));
    });

    after(async () => {
        // Bookings first: the hotel cannot be deleted while it has history.
        await prisma.hotelBooking.deleteMany({ where: { id: { in: bookingIds } } });
        await tracker.cleanup();
        await disconnect();
    });

    // --- Authorization ------------------------------------------------------

    it('refuses the badges, the booking summary and the transfer summary unauthenticated', async () => {
        for (const path of ['/api/admin/badges', '/api/admin/bookings/summary', '/api/admin/transfers/bookings/summary']) {
            const res = await request(app).get(path);
            assert.equal(res.status, 401, path);
        }
    });

    it('refuses a partner every one of them', async () => {
        for (const path of ['/api/admin/badges', '/api/admin/bookings/summary', '/api/admin/transfers/bookings/summary']) {
            const res = await request(app).get(path).set('Cookie', partnerCookie);
            assert.equal(res.status, 403, path);
        }
    });

    it('keeps the hotel booking summary from a dispatcher, but not the badges or the transfer summary', async () => {
        assert.equal((await request(app).get('/api/admin/bookings/summary').set('Cookie', dispatcherCookie)).status, 403);
        assert.equal((await request(app).get('/api/admin/badges').set('Cookie', dispatcherCookie)).status, 200);
        assert.equal(
            (await request(app).get('/api/admin/transfers/bookings/summary').set('Cookie', dispatcherCookie)).status,
            200
        );
    });

    // --- Badges -------------------------------------------------------------

    it('answers an admin with every count as a number', async () => {
        const res = await request(app).get('/api/admin/badges').set('Cookie', adminCookie);

        assert.equal(res.status, 200);
        for (const key of ['pendingPartners', 'activeBookings', 'unassignedLegs', 'pendingTourRequests', 'pendingOrders']) {
            assert.equal(typeof res.body[key], 'number', key);
        }
    });

    it('answers a dispatcher with the legs count only; the rest is null, not zero', async () => {
        const res = await request(app).get('/api/admin/badges').set('Cookie', dispatcherCookie);

        assert.equal(res.status, 200);
        assert.equal(typeof res.body.unassignedLegs, 'number');
        assert.equal(res.body.pendingPartners, null);
        assert.equal(res.body.activeBookings, null);
        assert.equal(res.body.pendingTourRequests, null);
        assert.equal(res.body.pendingOrders, null);
    });

    it('counts a live booking and a pending application, and moves when they do', async () => {
        const before = (await request(app).get('/api/admin/badges').set('Cookie', adminCookie)).body;

        await seedHotelBooking({ status: 'PENDING' });
        await seedHotelBooking({ status: 'CANCELLED', cancelledAt: new Date() });
        await makePartner(tracker, { status: 'PENDING_APPROVAL' });

        const after = (await request(app).get('/api/admin/badges').set('Cookie', adminCookie)).body;

        assert.equal(after.activeBookings, before.activeBookings + 1);
        assert.equal(after.pendingPartners, before.pendingPartners + 1);
    });

    it('counts an unassigned leg inside the window and ignores one beyond it', async () => {
        const before = (await request(app).get('/api/admin/badges').set('Cookie', dispatcherCookie)).body;

        await makeTransferBooking(tracker, {
            vehicleId: vehicleClass.id,
            from: airport,
            to: city,
            pickupAt: new Date(Date.now() + 3 * DAY)
        });
        await makeTransferBooking(tracker, {
            vehicleId: vehicleClass.id,
            from: airport,
            to: city,
            pickupAt: new Date(Date.now() + 60 * DAY)
        });

        const after = (await request(app).get('/api/admin/badges').set('Cookie', dispatcherCookie)).body;

        assert.equal(after.unassignedLegs, before.unassignedLegs + 1);
    });

    // --- Hotel booking summary ---------------------------------------------

    it('rejects a window that is not a positive number of days', async () => {
        for (const days of ['0', '-3', 'week', '400']) {
            const res = await request(app).get('/api/admin/bookings/summary').query({ days }).set('Cookie', adminCookie);
            assert.equal(res.status, 400, days);
        }
    });

    it('sums recent live bookings by currency and leaves cancellations out', async () => {
        const before = (await request(app).get('/api/admin/bookings/summary').set('Cookie', adminCookie)).body;
        const gelBefore = before.recent.byCurrency.find((row) => row.currency === 'GEL') ?? { amountCents: 0, count: 0 };
        const usdBefore = before.recent.byCurrency.find((row) => row.currency === 'USD') ?? { amountCents: 0, count: 0 };

        await seedHotelBooking({ status: 'CONFIRMED', sellTotalCents: 23000 });
        await seedHotelBooking({ status: 'PENDING', sellTotalCents: 7000 });
        await seedHotelBooking({ status: 'CANCELLED', cancelledAt: new Date(), sellTotalCents: 99000 });
        await seedHotelBooking({ status: 'CONFIRMED', currency: 'USD', sellTotalCents: 5000 });
        // Booked long ago: outside the window whatever its check-in date.
        await seedHotelBooking({ status: 'CONFIRMED', sellTotalCents: 50000, createdAt: new Date(Date.now() - 45 * DAY) });

        const res = await request(app).get('/api/admin/bookings/summary').query({ days: 30 }).set('Cookie', adminCookie);

        assert.equal(res.status, 200);
        assert.equal(typeof res.body.activeCount, 'number');
        assert.equal(res.body.recent.days, 30);
        assert.ok(Date.parse(res.body.recent.from) > 0);

        const gel = res.body.recent.byCurrency.find((row) => row.currency === 'GEL');
        const usd = res.body.recent.byCurrency.find((row) => row.currency === 'USD');
        assert.equal(gel.amountCents, gelBefore.amountCents + 30000);
        assert.equal(gel.count, gelBefore.count + 2);
        assert.equal(usd.amountCents, usdBefore.amountCents + 5000);
        assert.equal(usd.count, usdBefore.count + 1);

        // Largest first, so the tile can show the leading currency.
        const amounts = res.body.recent.byCurrency.map((row) => row.amountCents);
        assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
    });

    it('widens with the window', async () => {
        const narrow = (await request(app).get('/api/admin/bookings/summary').query({ days: 30 }).set('Cookie', adminCookie)).body;
        const wide = (await request(app).get('/api/admin/bookings/summary').query({ days: 60 }).set('Cookie', adminCookie)).body;

        const sum = (body) => body.recent.byCurrency.reduce((total, row) => total + row.amountCents, 0);
        // The 45-day-old booking above is inside 60 days and outside 30.
        assert.ok(sum(wide) >= sum(narrow) + 50000);
    });

    // --- Transfer booking summary -------------------------------------------

    it('counts every transfer booking and sums the confirmed ones', async () => {
        const before = (await request(app).get('/api/admin/transfers/bookings/summary').set('Cookie', adminCookie)).body;
        const gelBefore = before.confirmedValue.byCurrency.find((row) => row.currency === 'GEL') ?? { amountCents: 0 };

        await makeTransferBooking(tracker, { vehicleId: vehicleClass.id, from: airport, to: city });
        await makeTransferBooking(tracker, { vehicleId: vehicleClass.id, from: airport, to: city, status: 'CANCELLED' });

        const res = await request(app).get('/api/admin/transfers/bookings/summary').set('Cookie', adminCookie);

        assert.equal(res.status, 200);
        assert.equal(res.body.total, before.total + 2);
        assert.equal(res.body.confirmed, before.confirmed + 1);
        const gel = res.body.confirmedValue.byCurrency.find((row) => row.currency === 'GEL');
        assert.equal(gel.amountCents, gelBefore.amountCents + 20000);
    });

    it('does not mistake the word for a reference', async () => {
        const res = await request(app).get('/api/admin/transfers/bookings/summary').set('Cookie', adminCookie);

        assert.equal(res.status, 200);
        assert.ok(!('reference' in res.body));
    });
});
