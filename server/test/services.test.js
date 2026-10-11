import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { quoteService, unitsFor } from '../services/service/pricing.service.js';
import { sweepCompletedServiceBookings } from '../services/service/booking.service.js';
import {
    createTracker,
    databaseAvailable,
    futureDate,
    makeAdmin,
    makeDestination,
    makePartner,
    makePartnerUser,
    makeService,
    signIn
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

describe('service pricing (pure)', () => {
    const service = { basis: 'PER_PERSON_PER_DAY', netCents: 10_000, sellCents: null, currency: 'GEL' };

    it('multiplies the party and the days into units', () => {
        assert.equal(unitsFor({ basis: 'PER_PERSON' }, { quantity: 2, pax: 3, days: 4 }), 6);
        assert.equal(unitsFor({ basis: 'PER_GROUP' }, { quantity: 2, pax: 3, days: 4 }), 2);
        assert.equal(unitsFor({ basis: 'PER_DAY' }, { quantity: 2, pax: 3, days: 4 }), 8);
        assert.equal(unitsFor(service, { quantity: 1, pax: 3, days: 4 }), 12);
    });

    it('marks the net up per unit, and lets a fixed sell win', () => {
        const quote = quoteService({ service, quantity: 1, pax: 2, days: 2, markupBps: 1500 });
        assert.equal(quote.units, 4);
        assert.equal(quote.unitSellCents, 11_500);
        assert.deepEqual(quote.totals, { netCents: 40_000, sellCents: 46_000, totalCents: 46_000, markupBps: 1500, marginCents: 6_000 });

        const fixed = quoteService({ service: { ...service, sellCents: 12_000 }, pax: 1, markupBps: 1500 });
        assert.equal(fixed.unitSellCents, 12_000);
    });
});

/**
 * The service catalogue and its bookings: the lifecycle, the register, a
 * partner booking a service on its own, and the operator answering a request.
 */
describe('services', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let adminCookie;
    let partnerCookie;
    let otherPartnerCookie;
    let destination;
    const DATE = futureDate(40);

    before(async () => {
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;
        const partner = await makePartner(tracker);
        partnerCookie = (await signIn(app, (await makePartnerUser(tracker, partner)).email)).cookie;
        otherPartnerCookie = (await signIn(app, (await makePartnerUser(tracker, await makePartner(tracker))).email)).cookie;
        destination = await makeDestination(tracker);
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const lead = { firstName: 'Nino', lastName: 'Beridze', email: 'agency@example.test' };

    it('creates a draft, refuses per-night terms, and publishes against the checklist', async () => {
        const tiered = await prisma.cancellationPolicy.findFirst({ where: { hotelId: null, kind: 'TIERED' } });
        const flexible = await prisma.cancellationPolicy.findFirst({ where: { hotelId: null, kind: 'FLEXIBLE' } });

        const refused = await request(app)
            .post('/api/admin/services')
            .set('Cookie', adminCookie)
            .send({
                slug: `mashgiach-${Date.now().toString(36)}`,
                name: 'Mashgiach',
                category: 'MASHGIACH',
                basis: 'PER_DAY',
                netCents: 0,
                cancellationPolicyId: flexible.id,
                summary: 'Supervision for the kitchen.'
            });
        assert.equal(refused.status, 422, JSON.stringify(refused.body));

        const created = await request(app)
            .post('/api/admin/services')
            .set('Cookie', adminCookie)
            .send({
                slug: `mashgiach-${Date.now().toString(36)}`,
                name: 'Mashgiach',
                category: 'MASHGIACH',
                basis: 'PER_DAY',
                netCents: 0,
                cancellationPolicyId: tiered.id,
                summary: 'Supervision for the kitchen.'
            });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        tracker.service(created.body);
        assert.equal(created.body.status, 'DRAFT');
        assert.ok(created.body.publishChecklist.some((item) => item.code === 'price'));

        const notReady = await request(app).post(`/api/admin/services/${created.body.id}/publish`).set('Cookie', adminCookie);
        assert.equal(notReady.status, 422);

        await request(app).patch(`/api/admin/services/${created.body.id}`).set('Cookie', adminCookie).send({ netCents: 25_000 });

        // A partial update cannot be checked by the schema alone: a fixed sell
        // below the stored net is a 422 naming both figures, not a database 409.
        const belowNet = await request(app).patch(`/api/admin/services/${created.body.id}`).set('Cookie', adminCookie).send({ sellCents: 20_000 });
        assert.equal(belowNet.status, 422, JSON.stringify(belowNet.body));
        assert.equal(belowNet.body.error.details.reason, 'SELL_BELOW_NET');
        assert.equal(belowNet.body.error.details.netCents, 25_000);

        const published = await request(app).post(`/api/admin/services/${created.body.id}/publish`).set('Cookie', adminCookie);
        assert.equal(published.status, 200, JSON.stringify(published.body));
        assert.equal(published.body.status, 'ACTIVE');

        // Hidden from the public channel until switched on; a partner sees it.
        assert.equal((await request(app).get(`/api/services/${created.body.slug}`)).status, 404);
        const trade = await request(app).get(`/api/services/${created.body.slug}`).set('Cookie', partnerCookie);
        assert.equal(trade.status, 200);
        assert.equal(trade.body.netCents, undefined, 'a partner never sees the net');
        assert.equal(trade.body.unitPrice.amountCents, 27_500, 'quoted at the partner commission of 10%');
    });

    it('lets a partner book a service, replays on the same key, and cancels it', async () => {
        const service = await makeService(tracker, { destination });

        const body = { serviceId: service.id, date: DATE, days: 2, quantity: 1, pax: 3, lead, notes: 'No fish.' };
        const created = await request(app)
            .post('/api/service-bookings')
            .set('Cookie', partnerCookie)
            .set('Idempotency-Key', `svc-${Date.now()}`)
            .send(body);
        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.match(created.body.reference, /^SVC-\d{6}$/);
        assert.equal(created.body.status, 'CONFIRMED');
        // PER_PERSON: 3 people × 1 unit at 100.00 net + 10% = 330.00.
        assert.equal(created.body.totalCents, 33_000);
        assert.equal(created.body.days, 2);
        assert.equal(created.body.netTotalCents, undefined);

        const replay = await request(app)
            .post('/api/service-bookings')
            .set('Cookie', partnerCookie)
            .set('Idempotency-Key', created.request.getHeader('Idempotency-Key') ?? '')
            .send(body);
        assert.equal(replay.status, 200);
        assert.equal(replay.body.reference, created.body.reference);

        // Registers are scoped: the other partner cannot see it; admin can.
        assert.equal((await request(app).get(`/api/service-bookings/${created.body.reference}`).set('Cookie', otherPartnerCookie)).status, 404);
        const admin = await request(app).get(`/api/admin/services/bookings/${created.body.reference}`).set('Cookie', adminCookie);
        assert.equal(admin.status, 200);
        assert.equal(admin.body.netTotalCents, 30_000);
        assert.equal(admin.body.marginCents, 3_000);

        const cancelled = await request(app)
            .post(`/api/service-bookings/${created.body.reference}/cancel`)
            .set('Cookie', partnerCookie)
            .send({ reason: 'Plans changed' });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        assert.equal(cancelled.body.status, 'CANCELLED');
        assert.equal(cancelled.body.cancellation.chargeCents, 0, 'forty days out is inside the free window');

        assert.equal((await request(app).post(`/api/service-bookings/${created.body.reference}/cancel`).set('Cookie', partnerCookie).send({})).status, 409);
    });

    it('refuses too little notice and a quantity outside the range', async () => {
        const service = await makeService(tracker, { destination, noticeHours: 72, minQuantity: 2, maxQuantity: 4 });

        const soon = await request(app)
            .post('/api/service-bookings')
            .set('Cookie', partnerCookie)
            .send({ serviceId: service.id, date: futureDate(1), quantity: 2, pax: 1, lead });
        assert.equal(soon.status, 409);
        assert.equal(soon.body.error.details.reason, 'TOO_SOON');

        const many = await request(app)
            .post('/api/service-bookings')
            .set('Cookie', partnerCookie)
            .send({ serviceId: service.id, date: DATE, quantity: 5, pax: 1, lead });
        assert.equal(many.status, 422);
        assert.equal(many.body.error.details.reason, 'QUANTITY');
    });

    it('writes an on-request service as PENDING, lets the operator decline at no charge, and rolls finished ones to COMPLETED', async () => {
        const service = await makeService(tracker, { destination, confirmationMode: 'ON_REQUEST', basis: 'PER_GROUP' });

        const requested = await request(app)
            .post('/api/service-bookings')
            .set('Cookie', partnerCookie)
            .send({ serviceId: service.id, date: DATE, quantity: 1, pax: 4, lead });
        assert.equal(requested.status, 201, JSON.stringify(requested.body));
        assert.equal(requested.body.status, 'PENDING');
        assert.ok(requested.body.requestDeadlineAt);
        assert.equal(requested.body.totalCents, 11_000, 'per group: one unit');

        const queue = await request(app).get('/api/admin/services/bookings?status=PENDING').set('Cookie', adminCookie);
        assert.ok(queue.body.data.some((row) => row.reference === requested.body.reference));

        const declined = await request(app)
            .post(`/api/admin/services/bookings/${requested.body.reference}/decline`)
            .set('Cookie', adminCookie)
            .send({ reason: 'No supplier that day' });
        assert.equal(declined.status, 200, JSON.stringify(declined.body));
        assert.equal(declined.body.status, 'CANCELLED');
        assert.equal(declined.body.declineReason, 'No supplier that day');
        assert.equal(declined.body.cancellation.chargeCents, 0);

        assert.equal((await request(app).post(`/api/admin/services/bookings/${requested.body.reference}/confirm`).set('Cookie', adminCookie)).status, 409);

        // A second request, confirmed, then finished.
        const again = await request(app)
            .post('/api/service-bookings')
            .set('Cookie', partnerCookie)
            .send({ serviceId: service.id, date: DATE, quantity: 1, pax: 2, lead, idempotencyKey: `svc-again-${Date.now()}` });
        const confirmed = await request(app).post(`/api/admin/services/bookings/${again.body.reference}/confirm`).set('Cookie', adminCookie);
        assert.equal(confirmed.status, 200);
        assert.equal(confirmed.body.status, 'CONFIRMED');

        await prisma.serviceBooking.update({
            where: { reference: again.body.reference },
            data: { date: new Date('2020-01-01T00:00:00.000Z'), endDate: new Date('2020-01-01T00:00:00.000Z') }
        });
        const swept = await sweepCompletedServiceBookings();
        assert.ok(swept.completed >= 1);
        const closed = await prisma.serviceBooking.findUnique({ where: { reference: again.body.reference } });
        assert.equal(closed.status, 'COMPLETED');
    });
});
