import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { disconnect, prisma } from '../db/index.js';
import { dateOnlyToUtc } from '../lib/time.js';
import { reconcileTourInventory } from '../services/tour/availability.service.js';
import { quoteTourCancellation } from '../services/tour/booking.service.js';
import {
    createTracker,
    databaseAvailable,
    makeDestination,
    makeTour,
    makeTourOption
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const DATE = '2027-08-14';

/**
 * The two things a tour booking must never get wrong about money and seats:
 * a retry that arrives while the first attempt is still open must not claim a
 * second time, and a cancellation must read the schedule frozen at booking
 * rather than the policy as it stands on the day.
 *
 * `tours.booking.test.js` covers the sequential replay and the oversell race
 * between *different* parties; what is adversarial here is the same party
 * twice at once, and a policy that moves underneath a live booking.
 */
describe('tour money and inventory', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let destination;

    before(async () => {
        destination = await makeDestination(tracker);
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const lead = (email) => ({ firstName: 'Nino', lastName: 'Beridze', email });

    const inventoryFor = (optionId) =>
        prisma.tourInventory.findUnique({
            where: { tourOptionId_date: { tourOptionId: optionId, date: dateOnlyToUtc(DATE) } }
        });

    /** A sellable tour with one departure, straight from the factories. */
    const sellable = async (optionOverrides = {}) => {
        const tour = await makeTour(tracker, { destination });
        const option = await makeTourOption(tour, { date: DATE, ...optionOverrides });

        return { tour, option };
    };

    const offerFor = async (tour, { adults = 2 } = {}) => {
        const response = await request(app).get(`/api/search/tours/${tour.slug}?date=${DATE}&adults=${adults}`);

        assert.equal(response.status, 200, JSON.stringify(response.body));
        const offer = response.body.options[0]?.dates[0];
        assert.ok(offer?.available, JSON.stringify(response.body));

        return offer;
    };

    it('prices a dated search for a tour whose net exceeds the int4 × basis-points range', async () => {
        // Regression: the candidate SQL multiplied int4 net cents by (10000 + markup) in int4, which
        // overflowed above ~186,000 cents and failed the whole dated search with "integer out of range".
        const { tour } = await sellable({ adultNetCents: 1_150_200, groupNetCents: 1_150_200 });

        const response = await request(app).get(`/api/search/tours?date=${DATE}&adults=2`);

        assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
        const card = response.body.data?.find((row) => row.tour?.id === tour.id || row.tour?.slug === tour.slug || row.id === tour.id || row.slug === tour.slug);
        assert.ok(card, `tour missing from dated search: ${JSON.stringify(response.body).slice(0, 300)}`);

        const perTour = await offerFor(tour);
        const total = card.cheapest?.quote?.totals?.totalCents ?? card.cheapestOffer?.quote?.totals?.totalCents ?? card.priceFrom?.totalCents;
        assert.equal(total, perTour.quote.totals.totalCents);
    });

    it('claims a departure once when the same request arrives twice at the same moment', async () => {
        const { tour, option } = await sellable({ totalUnits: 10 });
        const offer = await offerFor(tour, { adults: 2 });
        const key = `tour-double-submit-${tour.id}`;

        // A double-clicked checkout, or a client retrying a request whose
        // response it never saw: both are in flight before either has written.
        const [first, second] = await Promise.all([
            request(app)
                .post('/api/tours/bookings')
                .set('Idempotency-Key', key)
                .send({ offerToken: offer.token, leadTraveller: lead('double@example.test') }),
            request(app)
                .post('/api/tours/bookings')
                .set('Idempotency-Key', key)
                .send({ offerToken: offer.token, leadTraveller: lead('double@example.test') })
        ]);

        assert.deepEqual(
            [first.status, second.status].sort(),
            [200, 201],
            `one booking and one replay, got ${first.status}/${second.status}: ${JSON.stringify([first.body, second.body])}`
        );
        assert.equal(first.body.reference, second.body.reference, 'both answers name the same booking');

        const rows = await prisma.tourBooking.findMany({ where: { tourId: tour.id } });
        assert.equal(rows.length, 1, 'one booking row');
        assert.equal(rows[0].units, 2);

        // The loser's claim is rolled back with its transaction, so the seats
        // are taken once. Four here would be a silent double-claim.
        const inventory = await inventoryFor(option.id);
        assert.equal(inventory.bookedUnits, 2, 'the departure is claimed once');
        assert.equal(inventory.heldUnits, 0, 'no hold is stranded by the loser');

        // The control: it is the key that collapses the pair, not something
        // else swallowing the second request. A different key books again.
        const separate = await request(app)
            .post('/api/tours/bookings')
            .set('Idempotency-Key', `${key}-b`)
            .send({ offerToken: offer.token, leadTraveller: lead('double@example.test') });
        assert.equal(separate.status, 201, JSON.stringify(separate.body));
        assert.notEqual(separate.body.reference, first.body.reference);
        assert.equal((await inventoryFor(option.id)).bookedUnits, 4);

        const { drift } = await reconcileTourInventory({ tourOptionIds: [option.id] });
        assert.deepEqual(drift, []);
    });

    it('cancels against the schedule frozen at booking, not the policy as it stands today', async () => {
        const { tour, option } = await sellable();
        const offer = await offerFor(tour, { adults: 2 });

        const booked = await request(app)
            .post('/api/tours/bookings')
            .send({ offerToken: offer.token, leadTraveller: lead('snapshot@example.test') });
        assert.equal(booked.status, 201, JSON.stringify(booked.body));

        const frozen = (await prisma.tourBooking.findUnique({ where: { reference: booked.body.reference } }))
            .cancellationSchedule;

        // The operator moves the option onto a non-refundable policy after the
        // sale. The guest bought the tiered one, and 2027 is well outside its
        // first deadline, so cancelling now is still free.
        const nonRefundable = await prisma.cancellationPolicy.findFirst({
            where: { hotelId: null, kind: 'NON_REFUNDABLE' }
        });
        assert.ok(nonRefundable, 'seed-reference.js must have run');
        await prisma.tourOption.update({ where: { id: option.id }, data: { cancellationPolicyId: nonRefundable.id } });

        const quoted = await request(app)
            .get(`/api/tours/bookings/${booked.body.reference}/cancellation-quote?email=snapshot@example.test`);
        assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
        assert.equal(quoted.body.chargeCents, 0, 'the new policy does not reach a sold booking');
        assert.equal(quoted.body.refundCents, booked.body.totalCents);

        const cancelled = await request(app)
            .post(`/api/tours/bookings/${booked.body.reference}/cancel`)
            .send({ email: 'snapshot@example.test' });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        assert.equal(cancelled.body.cancellation.chargeCents, 0);

        const row = await prisma.tourBooking.findUnique({ where: { reference: booked.body.reference } });
        assert.equal(row.cancellationChargeCents, 0);
        assert.deepEqual(row.cancellationSchedule, frozen, 'the schedule is never rewritten');
        assert.equal((await inventoryFor(option.id)).bookedUnits, 0, 'the seats come back');
    });

    it('charges every window off the frozen schedule and never refunds more than was paid', async () => {
        const { tour } = await sellable();
        const offer = await offerFor(tour, { adults: 2 });

        const booked = await request(app)
            .post('/api/tours/bookings')
            .send({ offerToken: offer.token, leadTraveller: lead('windows@example.test') });
        assert.equal(booked.status, 201, JSON.stringify(booked.body));

        const row = await prisma.tourBooking.findUnique({ where: { reference: booked.body.reference } });
        const windows = row.cancellationSchedule.windows;
        assert.ok(windows.length >= 2, JSON.stringify(row.cancellationSchedule));

        // An instant inside each window, taken from the window's own bounds so
        // the test does not have to redo the tour's timezone arithmetic.
        const inside = (window) =>
            window.fromAt === null ? new Date(Date.parse(window.toAt) - 3_600_000) : new Date(Date.parse(window.fromAt) + 1_000);

        for (const window of windows) {
            const quote = quoteTourCancellation(row, inside(window));

            assert.equal(quote.chargeCents, window.chargeCents, `window ${window.basis} charges what it says`);
            assert.ok(quote.chargeCents <= row.sellTotalCents, 'a charge never exceeds the price paid');
            assert.equal(
                quote.chargeCents + quote.refundCents,
                row.sellTotalCents,
                'charge and refund account for the whole price, with nothing invented'
            );
            assert.ok(quote.refundCents >= 0, 'a refund is never negative');
        }

        assert.equal(windows[0].chargeCents, 0, 'booked far out, the first window is free');
        assert.equal(windows.at(-1).chargeCents, row.sellTotalCents, 'the last window charges in full');

        // The whole schedule is moot for a request nobody answered: withdrawing
        // one costs nothing whatever the calendar says.
        const pending = { ...row, status: 'PENDING' };
        assert.equal(quoteTourCancellation(pending, inside(windows.at(-1))).chargeCents, 0);
    });
});
