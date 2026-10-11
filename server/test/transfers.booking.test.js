import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { disconnect, prisma } from '../db/index.js';
import { clearOutbox, outbox } from '../lib/mailer/index.js';
import {
    createTracker,
    databaseAvailable,
    futureDate,
    makeAdmin,
    makeTransferPoint,
    makeTransferPrice,
    makeTransferRoute,
    makeTransferVehicle,
    placeRef,
    signIn,
    unique
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

describe('transfer bookings', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let from;
    let to;
    let sedan;
    let route;
    let adminCookie;

    /** A fresh quote token for the standard journey. */
    const quoteFor = async (params = {}) => {
        const query = new URLSearchParams({
            from: from.slug,
            to: to.slug,
            date: futureDate(),
            time: '09:00',
            adults: '2',
            luggage: '2',
            ...params
        });

        const res = await request(app).get(`/api/transfers/quotes?${query}`);
        const offer = res.body.offers.find((entry) => entry.vehicle.slug === sedan.slug);

        assert.ok(offer, 'the fixture vehicle should be quotable');

        return offer;
    };

    const leadPassenger = () => ({
        firstName: 'Ana',
        lastName: 'Beridze',
        email: `ana.${unique('t')}@example.test`,
        phone: '+995 555 123 456'
    });

    before(async () => {
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;

        from = tracker.transferPoint(
            await makeTransferPoint({
                slug: unique('tbs'),
                name: 'Test Airport',
                kind: 'AIRPORT',
                latitude: 41.6692,
                longitude: 44.9547
            })
        );
        to = tracker.transferPoint(
            await makeTransferPoint({
                slug: unique('resort'),
                name: 'Test Resort',
                latitude: 42.4781,
                longitude: 44.4783
            })
        );

        sedan = tracker.transferVehicle(await makeTransferVehicle({ slug: unique('sedan') }));

        route = tracker.transferRoute(
            await makeTransferRoute({
                slug: unique('route'),
                fromPointId: from.id,
                toPointId: to.id,
                category: 'AIRPORT',
                distanceKm: 128
            })
        );

        await makeTransferPrice(route.id, sedan.id, { oneWayCents: 17_500 });
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('confirms a transfer and returns a quotable reference', async () => {
        clearOutbox();

        const offer = await quoteFor();
        const passenger = leadPassenger();

        const res = await request(app)
            .post('/api/transfers/bookings')
            .send({
                quoteToken: offer.token,
                leadPassenger: passenger,
                flightNumber: 'TK378',
                pickupAddress: 'Terminal 1, arrivals',
                pickupPlace: { latitude: 41.6692, longitude: 44.9547, place: placeRef() }
            });

        assert.equal(res.status, 201);
        assert.match(res.body.reference, /^TRF-\d{6}$/);
        assert.equal(res.body.status, 'CONFIRMED');
        assert.equal(res.body.totalCents, offer.quote.totals.sellCents);
        assert.equal(res.body.legs.length, 1);
        // The searched door travels with the booking: it is what a driver
        // navigates to, where the address text is what they read.
        assert.equal(res.body.pickupPlace.latitude, 41.6692);
        assert.equal(res.body.pickupPlace.place.city, 'Tbilisi');
        assert.equal(res.body.dropoffPlace, null);

        // The snapshot, not the live route: this is what a voucher reads.
        assert.equal(res.body.route.fromName, 'Test Airport');
        assert.equal(res.body.route.toName, 'Test Resort');
        assert.equal(res.body.vehicle.name, sedan.name);

        const sent = outbox.find((mail) => mail.to === passenger.email);
        assert.ok(sent, 'the voucher goes out');
        assert.match(sent.subject, /confirmed/i);
    });

    it('replays a retry instead of dispatching a second car', async () => {
        const offer = await quoteFor();
        const passenger = leadPassenger();
        const key = unique('idem');

        const body = { quoteToken: offer.token, leadPassenger: passenger };

        const first = await request(app)
            .post('/api/transfers/bookings')
            .set('idempotency-key', key)
            .send(body);
        const second = await request(app)
            .post('/api/transfers/bookings')
            .set('idempotency-key', key)
            .send(body);

        assert.equal(first.status, 201);
        assert.equal(second.status, 200, 'a replay is not a new booking');
        assert.equal(second.body.reference, first.body.reference);

        const count = await prisma.transferBooking.count({ where: { idempotencyKey: key } });
        assert.equal(count, 1, 'and there is only ever one row');
    });

    it('derives a key when the client sends none, so a double click is still safe', async () => {
        const offer = await quoteFor();
        const passenger = leadPassenger();
        const body = { quoteToken: offer.token, leadPassenger: passenger };

        const first = await request(app).post('/api/transfers/bookings').send(body);
        const second = await request(app).post('/api/transfers/bookings').send(body);

        assert.equal(first.status, 201);
        assert.equal(second.status, 200);
        assert.equal(second.body.reference, first.body.reference);
    });

    it('refuses a fare that has moved since it was quoted', async () => {
        const offer = await quoteFor();

        // The admin reprices while the traveller is filling in their details.
        await prisma.transferRoutePrice.updateMany({
            where: { routeId: route.id, vehicleId: sedan.id },
            data: { oneWayCents: 21_000 }
        });

        try {
            const res = await request(app)
                .post('/api/transfers/bookings')
                .send({ quoteToken: offer.token, leadPassenger: leadPassenger() });

            assert.equal(res.status, 409);
            assert.equal(res.body.error.details.reason, 'PRICE_CHANGED');
            assert.equal(res.body.error.details.quotedCents, 17_500);
            assert.equal(res.body.error.details.currentCents, 21_000);
        } finally {
            await prisma.transferRoutePrice.updateMany({
                where: { routeId: route.id, vehicleId: sedan.id },
                data: { oneWayCents: 17_500 }
            });
        }
    });

    it('rejects a tampered token', async () => {
        const offer = await quoteFor();
        const [payload] = offer.token.split('.');

        const res = await request(app)
            .post('/api/transfers/bookings')
            .send({ quoteToken: `${payload}.notthesignature`, leadPassenger: leadPassenger() });

        assert.equal(res.status, 400);
    });

    it('rejects a body that tries to name its own price', async () => {
        const offer = await quoteFor();

        const res = await request(app)
            .post('/api/transfers/bookings')
            .send({
                quoteToken: offer.token,
                leadPassenger: leadPassenger(),
                totalCents: 1
            });

        assert.equal(res.status, 400, 'the schema is strict, so an amount is refused rather than ignored');
    });

    it('lets the traveller read their own booking, and nobody else read it', async () => {
        const offer = await quoteFor();
        const passenger = leadPassenger();

        const created = await request(app)
            .post('/api/transfers/bookings')
            .send({ quoteToken: offer.token, leadPassenger: passenger });

        const { reference } = created.body;

        const withEmail = await request(app)
            .get(`/api/transfers/bookings/${reference}`)
            .query({ email: passenger.email });
        assert.equal(withEmail.status, 200);

        const withoutEmail = await request(app).get(`/api/transfers/bookings/${reference}`);
        assert.equal(withoutEmail.status, 404, 'a reference alone is not a credential');

        const wrongEmail = await request(app)
            .get(`/api/transfers/bookings/${reference}`)
            .query({ email: 'someone.else@example.test' });
        assert.equal(wrongEmail.status, 404, 'and a 404, never a 403, so nothing can be enumerated');
    });

    it('amends the paperwork but not the price', async () => {
        const offer = await quoteFor();
        const passenger = leadPassenger();

        const created = await request(app)
            .post('/api/transfers/bookings')
            .send({ quoteToken: offer.token, leadPassenger: passenger });

        const { reference, totalCents } = created.body;

        const amended = await request(app)
            .patch(`/api/transfers/bookings/${reference}`)
            .send({
                email: passenger.email,
                flightNumber: 'TK379',
                pickupAddress: 'Terminal 2, arrivals',
                dropoffPlace: { latitude: 42.4781, longitude: 44.4783, place: null }
            });

        assert.equal(amended.status, 200);
        assert.equal(amended.body.flightNumber, 'TK379');
        assert.equal(amended.body.totalCents, totalCents, 'nothing priced moved');
        assert.equal(amended.body.dropoffPlace.longitude, 44.4783, 'a pin dropped by hand is still a door');

        const placeless = await request(app)
            .patch(`/api/transfers/bookings/${reference}`)
            .send({ email: passenger.email, dropoffPlace: { place: placeRef() } });

        assert.equal(placeless.status, 400, 'a door with no position is nothing to drive to');

        const priced = await request(app)
            .patch(`/api/transfers/bookings/${reference}`)
            .send({ email: passenger.email, adults: 4 });

        assert.equal(priced.status, 400, 'the party is not in the amendment schema at all');
    });

    it('shows an admin the net fare and the margin', async () => {
        const offer = await quoteFor();
        const passenger = leadPassenger();

        const created = await request(app)
            .post('/api/transfers/bookings')
            .send({ quoteToken: offer.token, leadPassenger: passenger });

        const asAdmin = await request(app)
            .get(`/api/admin/transfers/bookings/${created.body.reference}`)
            .set('Cookie', adminCookie);

        assert.equal(asAdmin.status, 200);
        assert.equal(typeof asAdmin.body.netTotalCents, 'number');
        assert.equal(typeof asAdmin.body.marginCents, 'number');

        // The same record, read by the traveller, says nothing about either.
        const asGuest = await request(app)
            .get(`/api/transfers/bookings/${created.body.reference}`)
            .query({ email: passenger.email });

        assert.equal(Object.hasOwn(asGuest.body, 'netTotalCents'), false);
        assert.equal(Object.hasOwn(asGuest.body, 'marginCents'), false);
    });

    it('refuses a booking to nobody, and a booking with no journey', async () => {
        const offer = await quoteFor();

        const noPassenger = await request(app)
            .post('/api/transfers/bookings')
            .send({ quoteToken: offer.token });
        assert.equal(noPassenger.status, 400);

        const noToken = await request(app)
            .post('/api/transfers/bookings')
            .send({ leadPassenger: leadPassenger() });
        assert.equal(noToken.status, 400);
    });
});

describe('transfer cancellation', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let from;
    let to;
    let sedan;
    let route;

    before(async () => {
        // A policy with a real deadline, so there is something to be inside and
        // outside of. Twenty-four hours before the pick-up, then the whole fare.
        const policy = await prisma.cancellationPolicy.create({
            data: {
                name: unique('transfer-policy'),
                kind: 'TIERED',
                description: 'Free until 24 hours before pick-up.',
                rules: { create: [{ hoursBeforeCheckIn: 24, chargeBasis: 'PERCENT_OF_TOTAL', chargeValue: 10_000 }] }
            }
        });

        from = tracker.transferPoint(
            await makeTransferPoint({ slug: unique('from'), kind: 'AIRPORT', latitude: 41.6692, longitude: 44.9547 })
        );
        to = tracker.transferPoint(
            await makeTransferPoint({ slug: unique('to'), latitude: 42.4781, longitude: 44.4783 })
        );

        sedan = tracker.transferVehicle(
            await makeTransferVehicle({ slug: unique('sedan'), cancellationPolicyId: policy.id })
        );

        route = tracker.transferRoute(
            await makeTransferRoute({ slug: unique('route'), fromPointId: from.id, toPointId: to.id, distanceKm: 128 })
        );

        await makeTransferPrice(route.id, sedan.id, { oneWayCents: 17_500 });
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const book = async (daysAhead) => {
        const query = new URLSearchParams({
            from: from.slug,
            to: to.slug,
            date: futureDate(daysAhead),
            time: '09:00',
            adults: '2',
            luggage: '2'
        });

        const quoted = await request(app).get(`/api/transfers/quotes?${query}`);
        const offer = quoted.body.offers.find((entry) => entry.vehicle.slug === sedan.slug);
        const email = `ana.${unique('c')}@example.test`;

        const created = await request(app)
            .post('/api/transfers/bookings')
            .send({
                quoteToken: offer.token,
                leadPassenger: { firstName: 'Ana', lastName: 'Beridze', email }
            });

        assert.equal(created.status, 201);

        return { reference: created.body.reference, email, totalCents: created.body.totalCents };
    };

    it('quotes a free cancellation while the deadline is still ahead', async () => {
        const { reference, email } = await book(30);

        const res = await request(app)
            .get(`/api/transfers/bookings/${reference}/cancellation-quote`)
            .query({ email });

        assert.equal(res.status, 200);
        assert.equal(res.body.chargeCents, 0);
        assert.ok(res.body.freeUntil, 'and says exactly when that stops being true');
    });

    it('charges the whole fare inside the deadline', async () => {
        // Far enough ahead to book, then moved so the pick-up is tomorrow —
        // which is inside the 24-hour window. Rewriting the booking is the only
        // way to reach that state without waiting a month.
        const { reference, email, totalCents } = await book(30);

        const booking = await prisma.transferBooking.findUnique({ where: { reference } });
        const soon = new Date(Date.now() + 6 * 3600 * 1000);
        const schedule = booking.cancellationSchedule;

        // Re-anchor the frozen windows to the new pick-up, exactly as
        // confirmation would have written them for a booking made today.
        await prisma.transferBooking.update({
            where: { reference },
            data: {
                pickupAt: soon,
                cancellationSchedule: {
                    ...schedule,
                    windows: [
                        { fromAt: null, toAt: new Date(soon.getTime() - 24 * 3600 * 1000).toISOString(), chargeCents: 0, basis: 'FREE' },
                        { fromAt: new Date(soon.getTime() - 24 * 3600 * 1000).toISOString(), toAt: null, chargeCents: totalCents, basis: 'PERCENT_OF_TOTAL' }
                    ]
                }
            }
        });

        const quote = await request(app)
            .get(`/api/transfers/bookings/${reference}/cancellation-quote`)
            .query({ email });

        assert.equal(quote.body.chargeCents, totalCents);
        assert.equal(quote.body.refundCents, 0);
        assert.equal(quote.body.refundableCents, 0, "deprecated alias still served");
    });

    it('cancels, and records what it cost', async () => {
        const { reference, email } = await book(30);

        const res = await request(app)
            .post(`/api/transfers/bookings/${reference}/cancel`)
            .send({ email, reason: 'Plans changed' });

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'CANCELLED');
        assert.equal(res.body.cancellation.chargeCents, 0);

        const stored = await prisma.transferBooking.findUnique({ where: { reference } });
        assert.equal(stored.cancellationReason, 'Plans changed');
        assert.ok(stored.cancelledAt);
    });

    it('will not cancel the same booking twice', async () => {
        const { reference, email } = await book(30);

        await request(app).post(`/api/transfers/bookings/${reference}/cancel`).send({ email });
        const again = await request(app).post(`/api/transfers/bookings/${reference}/cancel`).send({ email });

        assert.equal(again.status, 409);
        assert.equal(again.body.error.details.reason, 'NOT_CANCELLABLE');
    });

    it('will not amend a cancelled booking', async () => {
        const { reference, email } = await book(30);

        await request(app).post(`/api/transfers/bookings/${reference}/cancel`).send({ email });

        const res = await request(app)
            .patch(`/api/transfers/bookings/${reference}`)
            .send({ email, flightNumber: 'TK999' });

        assert.equal(res.status, 409);
        assert.equal(res.body.error.details.reason, 'NOT_AMENDABLE');
    });
});
