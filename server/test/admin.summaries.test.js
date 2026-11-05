import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

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
    purgeFinance,
    unique
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const DAY = 86_400_000;

/**
 * These figures are the whole platform's, and other files book, cancel and
 * apply at the same moment, so one reading can move by somebody else's row.
 * `measure` seeds its own rows between two readings and returns how far the
 * figures moved; it is tried afresh up to five times until it moves by
 * `expected`. A summary that counts the wrong rows is off on every try, not
 * just one.
 */
const untilSteady = async (measure, expected) => {
    const seen = [];

    for (let attempt = 0; attempt < 5; attempt++) {
        seen.push(await measure());
        if (isDeepStrictEqual(seen.at(-1), expected)) return;
    }

    assert.deepEqual(seen.at(-1), expected, `moved by ${JSON.stringify(seen)}`);
};

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
        await purgeFinance({ hotelIds: [hotel.id] });
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

    it('keeps both booking summaries from a dispatcher, but not the badges', async () => {
        assert.equal((await request(app).get('/api/admin/bookings/summary').set('Cookie', dispatcherCookie)).status, 403);
        assert.equal((await request(app).get('/api/admin/badges').set('Cookie', dispatcherCookie)).status, 200);
        // The transfer tiles sum revenue: a dispatcher reads the list, not the money.
        assert.equal(
            (await request(app).get('/api/admin/transfers/bookings/summary').set('Cookie', dispatcherCookie)).status,
            403
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
        await untilSteady(
            async () => {
                const before = (await request(app).get('/api/admin/badges').set('Cookie', adminCookie)).body;

                await seedHotelBooking({ status: 'PENDING' });
                await seedHotelBooking({ status: 'CANCELLED', cancelledAt: new Date() });
                await makePartner(tracker, { status: 'PENDING_APPROVAL' });

                const after = (await request(app).get('/api/admin/badges').set('Cookie', adminCookie)).body;
                return { activeBookings: after.activeBookings - before.activeBookings, pendingPartners: after.pendingPartners - before.pendingPartners };
            },
            { activeBookings: 1, pendingPartners: 1 }
        );
    });

    it('counts an unassigned leg inside the window and ignores one beyond it', async () => {
        await untilSteady(async () => {
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
            return after.unassignedLegs - before.unassignedLegs;
        }, 1);
    });

    // --- Hotel booking summary ---------------------------------------------

    it('rejects a window that is not a positive number of days', async () => {
        for (const days of ['0', '-3', 'week', '400']) {
            const res = await request(app).get('/api/admin/bookings/summary').query({ days }).set('Cookie', adminCookie);
            assert.equal(res.status, 400, days);
        }
    });

    it('sums recent live bookings by currency and leaves cancellations out', async () => {
        const inCurrency = (body, currency) => body.recent.byCurrency.find((row) => row.currency === currency) ?? { amountCents: 0, count: 0 };
        let res;

        await untilSteady(
            async () => {
                const before = (await request(app).get('/api/admin/bookings/summary').set('Cookie', adminCookie)).body;

                await seedHotelBooking({ status: 'CONFIRMED', sellTotalCents: 23000 });
                await seedHotelBooking({ status: 'PENDING', sellTotalCents: 7000 });
                await seedHotelBooking({ status: 'CANCELLED', cancelledAt: new Date(), sellTotalCents: 99000 });
                await seedHotelBooking({ status: 'CONFIRMED', currency: 'USD', sellTotalCents: 5000 });
                // Booked long ago: outside the window whatever its check-in date.
                await seedHotelBooking({ status: 'CONFIRMED', sellTotalCents: 50000, createdAt: new Date(Date.now() - 45 * DAY) });

                res = await request(app).get('/api/admin/bookings/summary').query({ days: 30 }).set('Cookie', adminCookie);
                assert.equal(res.status, 200);

                const moved = (currency) => ({
                    amountCents: inCurrency(res.body, currency).amountCents - inCurrency(before, currency).amountCents,
                    count: inCurrency(res.body, currency).count - inCurrency(before, currency).count
                });
                return { GEL: moved('GEL'), USD: moved('USD') };
            },
            { GEL: { amountCents: 30000, count: 2 }, USD: { amountCents: 5000, count: 1 } }
        );

        assert.equal(typeof res.body.activeCount, 'number');
        assert.equal(res.body.recent.days, 30);
        assert.ok(Date.parse(res.body.recent.from) > 0);

        // Largest first, so the tile can show the leading currency.
        const amounts = res.body.recent.byCurrency.map((row) => row.amountCents);
        assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
    });

    it('widens with the window', async () => {
        const sum = (body) => body.recent.byCurrency.reduce((total, row) => total + row.amountCents, 0);

        // The 45-day-old booking above is inside 60 days and outside 30.
        await untilSteady(async () => {
            const narrow = (await request(app).get('/api/admin/bookings/summary').query({ days: 30 }).set('Cookie', adminCookie)).body;
            const wide = (await request(app).get('/api/admin/bookings/summary').query({ days: 60 }).set('Cookie', adminCookie)).body;
            return sum(wide) >= sum(narrow) + 50000;
        }, true);
    });

    // --- Transfer booking summary -------------------------------------------

    it('counts every transfer booking and sums the confirmed ones', async () => {
        // In francs: every other file's transfer booking is the factory's
        // GEL 200.00, created and purged all through the run, so the sum is
        // only this file's in a currency nobody else books in.
        const chfOf = (body) => (body.confirmedValue.byCurrency.find((row) => row.currency === 'CHF') ?? { amountCents: 0 }).amountCents;

        await untilSteady(
            async () => {
                const before = (await request(app).get('/api/admin/transfers/bookings/summary').set('Cookie', adminCookie)).body;

                await makeTransferBooking(tracker, { vehicleId: vehicleClass.id, from: airport, to: city, currency: 'CHF' });
                await makeTransferBooking(tracker, { vehicleId: vehicleClass.id, from: airport, to: city, currency: 'CHF', status: 'CANCELLED' });

                const res = await request(app).get('/api/admin/transfers/bookings/summary').set('Cookie', adminCookie);
                assert.equal(res.status, 200);

                return { total: res.body.total - before.total, confirmed: res.body.confirmed - before.confirmed, chfCents: chfOf(res.body) - chfOf(before) };
            },
            { total: 2, confirmed: 1, chfCents: 20000 }
        );
    });

    it('does not mistake the word for a reference', async () => {
        const res = await request(app).get('/api/admin/transfers/bookings/summary').set('Cookie', adminCookie);

        assert.equal(res.status, 200);
        assert.ok(!('reference' in res.body));
    });
});
