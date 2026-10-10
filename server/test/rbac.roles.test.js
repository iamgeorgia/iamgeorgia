import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { CAPABILITIES } from '../lib/permissions.js';
import {
    createTracker,
    makeAdmin,
    makePartner,
    makePartnerUser,
    makeTransferProvider,
    makeTransferVehicle,
    makeTransferPoint,
    makeTransferBooking,
    signIn,
    databaseAvailable
} from './support/factories.js';

/**
 * The staff desks and the partner finance user, end to end.
 *
 * The route matrix proves who gets past each guard; this proves what each
 * role then sees and changes, on real rows: management reads the money and
 * changes nothing, reservations works the bookings without seeing a margin,
 * finance reads but does not cancel, and a partner's finance user reads the
 * company's bookings and makes none.
 */
const app = createApp();
const dbAvailable = await databaseAvailable();

describe('the staff desks and partner sub-roles', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const cookies = {};
    let agency;
    let vehicle;
    let from;
    let to;

    before(async () => {
        for (const role of ['MANAGEMENT', 'TOUR_OPERATOR', 'ACCOUNTANT', 'DISPATCHER']) {
            cookies[role] = (await signIn(app, (await makeAdmin(tracker, { role })).email)).cookie;
        }

        agency = await makePartner(tracker, { kind: 'TOUR_OPERATOR' });
        const finance = await makePartnerUser(tracker, agency, { role: 'PARTNER_FINANCE', isPrimaryContact: false });
        cookies.PARTNER_FINANCE = (await signIn(app, finance.email)).cookie;

        const provider = tracker.transferProvider(await makeTransferProvider());
        vehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        from = tracker.transferPoint(await makeTransferPoint());
        to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const agencyBooking = () => makeTransferBooking(tracker, { vehicleId: vehicle.id, from, to, partnerId: agency.id });

    const cancel = (reference, role) =>
        request(app)
            .post(`/api/admin/transfers/bookings/${reference}/cancel`)
            .set('Cookie', cookies[role])
            .send({ reason: 'Guest asked' });

    it('lets management read the money and the agency on a booking, and change nothing', async () => {
        const booking = await agencyBooking();

        const read = await request(app).get(`/api/admin/transfers/bookings/${booking.reference}`).set('Cookie', cookies.MANAGEMENT);

        assert.equal(read.status, 200);
        assert.equal(typeof read.body.marginCents, 'number');
        assert.equal(typeof read.body.netTotalCents, 'number');
        assert.equal(read.body.partner.id, agency.id);

        const refused = await cancel(booking.reference, 'MANAGEMENT');

        assert.equal(refused.status, 403);
        assert.deepEqual(refused.body.error.details.required, ['bookings.cancel']);

        const catalogue = await request(app)
            .post('/api/admin/transfers/points')
            .set('Cookie', cookies.MANAGEMENT)
            .send({});
        assert.equal(catalogue.status, 403);
    });

    it('lets reservations cancel a booking, and see the agency but never the margin', async () => {
        const booking = await agencyBooking();

        const read = await request(app)
            .get(`/api/admin/transfers/bookings/${booking.reference}`)
            .set('Cookie', cookies.TOUR_OPERATOR);

        assert.equal(read.status, 200);
        assert.equal(read.body.partner.id, agency.id);
        for (const field of ['netTotalCents', 'markupBps', 'marginCents']) {
            assert.ok(!(field in read.body), `reservations sees ${field}`);
        }

        const done = await cancel(booking.reference, 'TOUR_OPERATOR');

        assert.equal(done.status, 200);
        assert.equal((await prisma.transferBooking.findUnique({ where: { id: booking.id } })).status, 'CANCELLED');

        const pricing = await request(app).get('/api/admin/pricing-rules').set('Cookie', cookies.TOUR_OPERATOR);
        assert.equal(pricing.status, 403);
    });

    it('lets finance read bookings and partners but not cancel', async () => {
        const booking = await agencyBooking();

        assert.equal((await cancel(booking.reference, 'ACCOUNTANT')).status, 403);
        assert.equal(
            (await request(app).get(`/api/admin/transfers/bookings/${booking.reference}`).set('Cookie', cookies.ACCOUNTANT)).status,
            200
        );
        assert.equal((await request(app).get('/api/admin/partners').set('Cookie', cookies.ACCOUNTANT)).status, 200);

        // Finance does not run the fleet.
        assert.equal((await request(app).get('/api/admin/transfers/dispatch/legs').set('Cookie', cookies.ACCOUNTANT)).status, 403);
    });

    it('lets the tour operator run tours and the fleet, and never a hotel price', async () => {
        const as = (role) => (method, path, body = {}) => request(app)[method](path).set('Cookie', cookies[role]).send(body);
        const op = as('TOUR_OPERATOR');
        const hotel = 'rbacmissinghotel';

        // Its own doors: tours and the fleet (judged on their merits past the guard).
        assert.equal((await op('post', '/api/admin/tours')).status, 400);
        assert.equal((await op('post', '/api/admin/transfers/drivers')).status, 400);

        // Every hotel price lever, and the rest of the catalogue, is closed.
        const closed = [
            ['put', `/api/admin/hotels/${hotel}/room-types/x/rate-plans/y/rates`],
            ['post', `/api/admin/hotels/${hotel}/tax-fees`],
            ['post', `/api/admin/hotels/${hotel}/room-types/x/rate-plans`],
            ['post', `/api/admin/hotels/${hotel}/policies/cancellation`],
            ['put', `/api/admin/hotels/${hotel}/child-policy`],
            ['patch', `/api/admin/hotels/${hotel}`, { currency: 'USD' }],
            ['post', '/api/admin/hotels'],
            ['post', '/api/admin/packages'],
            ['post', '/api/admin/pricing-rules'],
            ['post', '/api/admin/transfers/vehicles'],
            ['post', '/api/admin/services']
        ];

        for (const [method, path, body] of closed) {
            const res = await op(method, path, body);
            assert.equal(res.status, 403, `${method.toUpperCase()} ${path}`);
            assert.equal(res.body.error.details.reason, 'INSUFFICIENT_CAPABILITY', path);
        }
    });

    it('keeps hotel prices and the commission behind their own capability even for a catalogue editor', async () => {
        // A tour operator handed the whole catalogue by name still cannot price a hotel.
        const editor = await makeAdmin(tracker, { role: 'TOUR_OPERATOR' });
        await prisma.userCapabilityOverride.create({
            data: { userId: editor.id, capability: CAPABILITIES.CATALOGUE_WRITE, effect: 'GRANT', reason: 'Content' }
        });
        const cookie = (await signIn(app, editor.email)).cookie;
        const hotel = 'rbacmissinghotel';
        const as = (method, path, body = {}) => request(app)[method](path).set('Cookie', cookie).send(body);

        // Content passes the guard (and meets the missing hotel); prices do not.
        assert.equal((await as('patch', `/api/admin/hotels/${hotel}`, { name: 'Renamed' })).status, 404);

        const currency = await as('patch', `/api/admin/hotels/${hotel}`, { currency: 'USD' });
        assert.equal(currency.status, 403);
        assert.deepEqual(currency.body.error.details.fields, ['currency']);
        assert.deepEqual(currency.body.error.details.required, [CAPABILITIES.PRICING_WRITE]);

        const rates = await as('put', `/api/admin/hotels/${hotel}/room-types/x/rate-plans/y/rates`, { from: '2027-01-01', to: '2027-01-02', netCents: 100 });
        assert.equal(rates.status, 403);
        assert.deepEqual(rates.body.error.details.required, [CAPABILITIES.PRICING_WRITE]);

        const discount = await as('patch', '/api/admin/packages/rbacmissingpackage', { adjustmentKind: 'FIXED_SELL', adjustmentValue: 1 });
        assert.equal(discount.status, 403);
        assert.deepEqual(discount.body.error.details.fields.sort(), ['adjustmentKind', 'adjustmentValue']);

        // And an admin denied the commission capability by name keeps everything else on a partner.
        const admin = await makeAdmin(tracker, { role: 'ADMIN' });
        await prisma.userCapabilityOverride.create({
            data: { userId: admin.id, capability: CAPABILITIES.FINANCE_COMMISSION_WRITE, effect: 'DENY', reason: 'Sales only' }
        });
        const adminCookie = (await signIn(app, admin.email)).cookie;
        const commission = await request(app).patch(`/api/admin/partners/${agency.id}`).set('Cookie', adminCookie).send({ commissionRateBps: 500 });
        assert.equal(commission.status, 403);
        assert.deepEqual(commission.body.error.details.fields, ['commissionRateBps']);
        assert.equal((await request(app).patch(`/api/admin/partners/${agency.id}`).set('Cookie', adminCookie).send({ notes: 'Fine' })).status, 200);
    });

    it('keeps the revenue tiles from a dispatcher who reads the same list', async () => {
        const list = (role) => request(app).get('/api/admin/transfers/bookings').set('Cookie', cookies[role]);
        const summary = (role) => request(app).get('/api/admin/transfers/bookings/summary').set('Cookie', cookies[role]);

        assert.equal((await list('DISPATCHER')).status, 200);
        assert.equal((await summary('DISPATCHER')).status, 403);
        assert.equal((await summary('TOUR_OPERATOR')).status, 403);
        assert.equal((await summary('MANAGEMENT')).status, 200);
    });

    it('answers a desk that reads every booking but may not change one as it would a stranger', async () => {
        const booking = await agencyBooking();
        const paths = [
            ['post', `/api/transfers/bookings/${booking.reference}/cancel`, { reason: 'Guest asked' }],
            ['patch', `/api/transfers/bookings/${booking.reference}`, { flightNumber: 'TK 379' }],
            ['post', '/api/bookings', {}],
            ['post', '/api/tours/bookings', {}],
            ['post', '/api/orders', {}],
            ['post', '/api/transfers/bookings', {}]
        ];

        for (const role of ['MANAGEMENT', 'ACCOUNTANT', 'DISPATCHER']) {
            for (const [method, path, body] of paths) {
                const res = await request(app)[method](path).set('Cookie', cookies[role]).send(body);

                assert.equal(res.status, 403, `${role} ${method.toUpperCase()} ${path}`);
                assert.equal(res.body.error.details.reason, 'INSUFFICIENT_CAPABILITY', `${role} ${path}`);
            }

            // Reading stays open to the desks that read everything.
            const read = await request(app).get(`/api/transfers/bookings/${booking.reference}`).set('Cookie', cookies[role]);
            assert.equal(read.status, 200, role);
        }

        // The booking desk makes and changes bookings; what it sends is then judged on its merits.
        assert.equal((await request(app).post('/api/bookings').set('Cookie', cookies.TOUR_OPERATOR).send({})).status, 400);
        const amend = await request(app)
            .patch(`/api/transfers/bookings/${booking.reference}`)
            .set('Cookie', cookies.TOUR_OPERATOR)
            .send({ flightNumber: 'TK 379' });
        assert.equal(amend.status, 200);
    });

    it('sizes the badges to the role: each queue for the people who work it', async () => {
        const finance = await request(app).get('/api/admin/badges').set('Cookie', cookies.ACCOUNTANT);

        assert.equal(finance.status, 200);
        assert.equal(typeof finance.body.pendingPartners, 'number');
        assert.equal(typeof finance.body.activeBookings, 'number');
        assert.equal(finance.body.unassignedLegs, null);

        const dispatcher = await request(app).get('/api/admin/badges').set('Cookie', cookies.DISPATCHER);

        assert.equal(typeof dispatcher.body.unassignedLegs, 'number');
        assert.equal(dispatcher.body.pendingPartners, null);
        assert.equal(dispatcher.body.activeBookings, null);
    });

    it('keeps a hotel contract from a dispatcher who may read the hotel', async () => {
        const hotelId = 'rbacmissinghotel';

        const docs = await request(app).get(`/api/admin/hotels/${hotelId}/documents`).set('Cookie', cookies.DISPATCHER);
        assert.equal(docs.status, 403);

        const docsAsDesk = await request(app).get(`/api/admin/hotels/${hotelId}/documents`).set('Cookie', cookies.TOUR_OPERATOR);
        assert.equal(docsAsDesk.status, 200);
    });

    it("lets a partner's finance user read the company's bookings and make or cancel none", async () => {
        const booking = await agencyBooking();

        const list = await request(app)
            .get('/api/partner/transfers/bookings')
            .set('Cookie', cookies.PARTNER_FINANCE);
        assert.equal(list.status, 200);
        assert.ok(list.body.data.some((row) => row.reference === booking.reference));

        const create = await request(app).post('/api/transfers/bookings').set('Cookie', cookies.PARTNER_FINANCE).send({});
        assert.equal(create.status, 403);
        assert.equal(create.body.error.details.reason, 'INSUFFICIENT_CAPABILITY');

        const cancelled = await request(app)
            .post(`/api/transfers/bookings/${booking.reference}/cancel`)
            .set('Cookie', cookies.PARTNER_FINANCE)
            .send({ reason: 'test' });
        assert.equal(cancelled.status, 403);
        assert.equal((await prisma.transferBooking.findUnique({ where: { id: booking.id } })).status, booking.status);

        const read = await request(app)
            .get(`/api/transfers/bookings/${booking.reference}`)
            .set('Cookie', cookies.PARTNER_FINANCE);
        assert.equal(read.status, 200);
    });
});
