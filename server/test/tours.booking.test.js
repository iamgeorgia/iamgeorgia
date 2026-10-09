import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { dateOnlyToUtc } from '../lib/time.js';
import { reconcileTourInventory } from '../services/tour/availability.service.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makeDestination,
    makePartner,
    makePartnerUser,
    signIn,
    purgeFinance,
    unique
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const DATE = '2027-08-10';

/**
 * The tour vertical end to end: catalogue -> option -> price sheet ->
 * departures -> publish -> dated search -> hold -> confirm -> cancel, with the
 * one guarantee that matters most — a departure is never oversold — driven by
 * concurrent confirmations.
 */
describe('tour bookings', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const tourIds = new Set();
    let adminCookie;
    let partnerCookie;
    let destination;
    let policy;

    before(async () => {
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;
        const partner = await makePartner(tracker);
        partnerCookie = (await signIn(app, (await makePartnerUser(tracker, partner)).email)).cookie;
        destination = await makeDestination(tracker);
        policy = await prisma.cancellationPolicy.findFirst({ where: { hotelId: null, kind: 'TIERED' } });
        assert.ok(policy, 'seed-reference.js must have run');
    });

    after(async () => {
        if (tourIds.size > 0) {
            const ids = [...tourIds];
            const bookings = await prisma.tourBooking.findMany({ where: { tourId: { in: ids } }, select: { id: true } });
            const bookingIds = bookings.map(({ id }) => id);

            await prisma.tourHold.updateMany({ where: { bookingId: { in: bookingIds } }, data: { bookingId: null } });
            await purgeFinance({ tourIds: ids });
            await prisma.tourBooking.deleteMany({ where: { id: { in: bookingIds } } });
            await prisma.tour.deleteMany({ where: { id: { in: ids } } });
            await prisma.auditLog.deleteMany({ where: { entityId: { in: [...ids, ...bookingIds] } } });
        }

        await tracker.cleanup();
        await disconnect();
    });

    /** A published tour with one shared option, one price sheet and one departure. */
    const makeSellable = async ({ totalUnits = 12, kind = 'SHARED', pricingBasis = 'PER_PERSON', confirmationMode = 'INSTANT' } = {}) => {
        const created = await request(app)
            .post('/api/admin/tours')
            .set('Cookie', adminCookie)
            .send({
                slug: unique('tour'),
                title: 'Kazbegi Day Trip',
                location: 'Kazbegi',
                destinationId: destination.id,
                category: 'nature',
                summary: 'A day beneath Mount Kazbek.',
                description: ['Up the Georgian Military Road and back.'],
                durationDays: 1,
                durationLabel: '1 day',
                groupSize: '2-12',
                difficulty: 'Easy',
                meetingPoint: 'Your hotel lobby, 08:00',
                image: '/images/tours/kazbegi.jpg',
                b2cEnabled: true,
                itinerary: [{ day: 1, title: 'Tbilisi to Kazbegi', description: 'Drive, walk, return.', meals: ['lunch'] }]
            });

        assert.equal(created.status, 201, JSON.stringify(created.body));
        const tour = created.body;
        tourIds.add(tour.id);

        const option = await request(app)
            .post(`/api/admin/tours/${tour.id}/options`)
            .set('Cookie', adminCookie)
            .send({
                code: 'main',
                name: kind === 'SHARED' ? 'Shared minibus seat' : 'Private car',
                kind,
                pricingBasis,
                scheduleKind: 'SCHEDULED',
                confirmationMode,
                maxPax: 12,
                startTime: '08:00',
                cancellationPolicyId: policy.id
            });
        assert.equal(option.status, 201, JSON.stringify(option.body));

        const season = await request(app)
            .post(`/api/admin/tours/${tour.id}/options/${option.body.id}/seasons`)
            .set('Cookie', adminCookie)
            .send({
                name: 'Summer',
                validFrom: '2027-06-01',
                validUntil: '2027-09-30',
                tiers: [{ minPax: 1, adultNetCents: 10_000, childNetCents: 5_000, groupNetCents: 40_000 }]
            });
        assert.equal(season.status, 201, JSON.stringify(season.body));

        const inventory = await request(app)
            .put(`/api/admin/tours/${tour.id}/options/${option.body.id}/inventory`)
            .set('Cookie', adminCookie)
            .send({ from: DATE, to: DATE, totalUnits });
        assert.equal(inventory.status, 200, JSON.stringify(inventory.body));
        assert.equal(inventory.body.departures, 1);

        const published = await request(app).post(`/api/admin/tours/${tour.id}/publish`).set('Cookie', adminCookie);
        assert.equal(published.status, 200, JSON.stringify(published.body));
        assert.equal(published.body.status, 'ACTIVE');

        return { tour, option: option.body };
    };

    const offerFor = async (tour, { adults = 2, childAges = [], cookie } = {}) => {
        const ages = childAges.map((age) => `&childAges=${age}`).join('');
        const call = request(app).get(`/api/search/tours/${tour.slug}?date=${DATE}&adults=${adults}${ages}`);
        const response = await (cookie ? call.set('Cookie', cookie) : call);

        assert.equal(response.status, 200, JSON.stringify(response.body));
        const offer = response.body.options[0].dates[0];
        assert.equal(offer.available, true, JSON.stringify(offer));
        return offer;
    };

    const lead = (email) => ({ firstName: 'Nino', lastName: 'Beridze', email, phone: '+995322123456' });

    const inventoryFor = (optionId) =>
        prisma.tourInventory.findUnique({ where: { tourOptionId_date: { tourOptionId: optionId, date: dateOnlyToUtc(DATE) } } });

    it('prices a party per person with a child rate and books through a hold', async () => {
        const { tour, option } = await makeSellable();
        const offer = await offerFor(tour, { adults: 2, childAges: [6] });

        // 10 000 net marked up 15% = 11 500 per adult, 5 750 per child.
        assert.equal(offer.quote.totals.totalCents, 11_500 * 2 + 5_750);
        assert.equal(offer.units, 3);
        assert.equal(offer.quote.lines.find((line) => line.travellerType === 'CHILD').count, 1);
        assert.equal(offer.quote.totals.netCents, undefined, 'net is not for the public');

        const hold = await request(app).post('/api/tours/bookings/holds').send({ token: offer.token });
        assert.equal(hold.status, 201, JSON.stringify(hold.body));
        assert.equal(hold.body.units, 3);
        assert.equal((await inventoryFor(option.id)).heldUnits, 3);

        const confirmed = await request(app)
            .post('/api/tours/bookings')
            .send({
                holdToken: hold.body.token,
                leadTraveller: lead('nino@example.test'),
                travellers: [
                    { firstName: 'Giorgi', lastName: 'Beridze' },
                    { type: 'CHILD', firstName: 'Ana', lastName: 'Beridze', age: 6 }
                ]
            });

        assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
        assert.match(confirmed.body.reference, /^TUR-\d{6}$/);
        assert.equal(confirmed.body.status, 'CONFIRMED');
        assert.equal(confirmed.body.totalCents, 28_750);
        assert.equal(confirmed.body.travellers.length, 3);
        assert.equal(confirmed.body.tourSnapshot.title, 'Kazbegi Day Trip');

        const row = await inventoryFor(option.id);
        assert.equal(row.heldUnits, 0);
        assert.equal(row.bookedUnits, 3);

        // The same request again is a replay, not a second booking.
        const replay = await request(app)
            .post('/api/tours/bookings')
            .send({ holdToken: hold.body.token, leadTraveller: lead('nino@example.test') });
        assert.equal(replay.status, 200);
        assert.equal(replay.body.reference, confirmed.body.reference);

        // Cancelling inside the free window gives everything back.
        const cancelled = await request(app)
            .post(`/api/tours/bookings/${confirmed.body.reference}/cancel`)
            .send({ email: 'nino@example.test' });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        assert.equal(cancelled.body.status, 'CANCELLED');
        assert.equal(cancelled.body.cancellation.chargeCents, 0);
        assert.equal((await inventoryFor(option.id)).bookedUnits, 0);

        const { drift } = await reconcileTourInventory({ tourOptionIds: [option.id] });
        assert.deepEqual(drift, []);
    });

    it('never oversells a departure under concurrent confirmations', async () => {
        const { tour, option } = await makeSellable({ totalUnits: 7 });
        const offer = await offerFor(tour, { adults: 2 });

        const attempts = await Promise.all(
            Array.from({ length: 5 }, (_, index) =>
                request(app)
                    .post('/api/tours/bookings')
                    .send({ offerToken: offer.token, leadTraveller: lead(`racer${index}@example.test`) })
            )
        );

        const won = attempts.filter((response) => response.status === 201);
        const lost = attempts.filter((response) => response.status === 409);

        // Seven seats, two per booking: three succeed, two are told it is gone.
        assert.equal(won.length, 3, attempts.map((r) => r.status).join(','));
        assert.equal(lost.length, 2);
        assert.equal(lost[0].body.error.details.reason, 'UNAVAILABLE');
        assert.equal((await inventoryFor(option.id)).bookedUnits, 6);

        const { drift } = await reconcileTourInventory({ tourOptionIds: [option.id] });
        assert.deepEqual(drift, []);
    });

    it('books a private group as one unit at the group price, on request', async () => {
        const { tour, option } = await makeSellable({
            totalUnits: 1,
            kind: 'PRIVATE',
            pricingBasis: 'PER_GROUP',
            confirmationMode: 'ON_REQUEST'
        });
        const offer = await offerFor(tour, { adults: 4, cookie: partnerCookie });

        assert.equal(offer.units, 1);
        // The partner's commission (10%) is the markup: 40 000 -> 44 000.
        assert.equal(offer.quote.totals.totalCents, 44_000);

        const requested = await request(app)
            .post('/api/tours/bookings')
            .set('Cookie', partnerCookie)
            .send({ offerToken: offer.token, leadTraveller: lead('agency@example.test') });

        assert.equal(requested.status, 201, JSON.stringify(requested.body));
        assert.equal(requested.body.status, 'PENDING');
        assert.ok(requested.body.requestDeadlineAt);
        // The departure is held for the request: nobody else can take it.
        assert.equal((await inventoryFor(option.id)).bookedUnits, 1);

        const second = await offerFor(tour, { adults: 2, cookie: partnerCookie }).catch(() => null);
        assert.equal(second, null, 'a sold-out departure is not offered');

        const declined = await request(app)
            .post(`/api/admin/tours/bookings/${requested.body.reference}/decline`)
            .set('Cookie', adminCookie)
            .send({ reason: 'Guide unavailable' });

        assert.equal(declined.status, 200, JSON.stringify(declined.body));
        assert.equal(declined.body.status, 'CANCELLED');
        assert.equal(declined.body.cancellation.chargeCents, 0);
        assert.equal(declined.body.declineReason, 'Guide unavailable');
        assert.equal((await inventoryFor(option.id)).bookedUnits, 0);
    });
});
