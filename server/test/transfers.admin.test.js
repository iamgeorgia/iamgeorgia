import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { disconnect, prisma } from '../db/index.js';
import {
    createTracker,
    databaseAvailable,
    futureDate,
    makeAdmin,
    makePartner,
    makePartnerUser,
    makeTransferPoint,
    makeTransferPrice,
    makeTransferProvider,
    makeTransferRoute,
    makeTransferVehicle,
    placeRef,
    signIn,
    unique
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

describe('the transfer catalogue', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let point;

    before(async () => {
        point = tracker.transferPoint(
            await makeTransferPoint({
                slug: unique('kutaisi'),
                name: 'Kutaisi Test Airport',
                kind: 'AIRPORT',
                iataCode: 'KUT',
                regionLabel: 'Imereti',
                latitude: 42.1767,
                longitude: 42.4826,
                popular: true
            })
        );
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('finds a point by name, by region and by IATA code', async () => {
        const byName = await request(app).get('/api/transfers/points').query({ search: 'Kutaisi Test' });
        assert.equal(byName.status, 200);
        assert.ok(byName.body.data.some((entry) => entry.slug === point.slug));

        const byRegion = await request(app).get('/api/transfers/points').query({ search: 'Imereti' });
        assert.ok(byRegion.body.data.some((entry) => entry.slug === point.slug));

        const byCode = await request(app).get('/api/transfers/points').query({ search: 'kut' });
        assert.ok(byCode.body.data.some((entry) => entry.slug === point.slug));
    });

    it('finds a point through its translation, so the picker works in every language', async () => {
        await prisma.transferPointTranslation.create({
            data: { pointId: point.id, locale: 'ru', name: 'Кутаиси' }
        });

        const res = await request(app).get('/api/transfers/points').query({ search: 'Кутаиси', locale: 'ru' });

        assert.equal(res.status, 200);

        const found = res.body.data.find((entry) => entry.slug === point.slug);
        assert.ok(found, 'a Russian reader finds the same row');
        assert.equal(found.name, 'Кутаиси', 'and reads it in their own language');
    });

    it('falls back to English for a field with no translation', async () => {
        const res = await request(app).get('/api/transfers/points').query({ search: 'Кутаиси', locale: 'ru' });
        const found = res.body.data.find((entry) => entry.slug === point.slug);

        assert.equal(found.region, 'Imereti', 'the region was never translated, so it stays English');
    });

    it('hides a retired point from the public list', async () => {
        const retired = tracker.transferPoint(
            await makeTransferPoint({ slug: unique('gone'), name: 'Retired Point', status: 'INACTIVE' })
        );

        const res = await request(app).get('/api/transfers/points').query({ search: 'Retired Point' });

        assert.ok(!res.body.data.some((entry) => entry.slug === retired.slug));
    });

    it('does not quote a journey to a place we do not serve', async () => {
        const res = await request(app).get('/api/transfers/quotes').query({
            from: point.slug,
            to: 'nowhere-at-all',
            date: futureDate(),
            time: '09:00'
        });

        assert.equal(res.status, 404);
    });
});

describe('the transfer panel', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let adminCookie;
    let partnerCookie;
    let from;
    let to;
    let sedan;
    let van;
    let route;

    before(async () => {
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;

        const partner = await makePartner(tracker, { status: 'APPROVED' });
        const partnerUser = await makePartnerUser(tracker, partner, { role: 'PARTNER_OWNER' });
        partnerCookie = (await signIn(app, partnerUser.email)).cookie;

        from = tracker.transferPoint(
            await makeTransferPoint({ slug: unique('from'), kind: 'AIRPORT', latitude: 41.6692, longitude: 44.9547 })
        );
        to = tracker.transferPoint(
            await makeTransferPoint({ slug: unique('to'), latitude: 42.4781, longitude: 44.4783 })
        );

        sedan = tracker.transferVehicle(await makeTransferVehicle({ slug: unique('sedan') }));
        van = tracker.transferVehicle(
            await makeTransferVehicle({ slug: unique('van'), vehicleClass: 'VAN', body: 'van', maxPassengers: 12, maxLuggage: 12 })
        );

        route = tracker.transferRoute(
            await makeTransferRoute({
                slug: unique('route'),
                fromPointId: from.id,
                toPointId: to.id,
                distanceKm: 128,
                status: 'DRAFT'
            })
        );
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('turns every write away without an admin session', async () => {
        const anonymous = await request(app).post('/api/admin/transfers/points').send({});
        assert.equal(anonymous.status, 401);

        const asPartner = await request(app)
            .post('/api/admin/transfers/points')
            .set('Cookie', partnerCookie)
            .send({});
        assert.equal(asPartner.status, 403, 'an approved partner is still not an admin');

        const readAsPartner = await request(app)
            .get('/api/admin/transfers/routes')
            .set('Cookie', partnerCookie);
        assert.equal(readAsPartner.status, 403);
    });

    it('shows an admin the draft routes the public cannot see', async () => {
        const asAdmin = await request(app)
            .get('/api/admin/transfers/routes')
            .set('Cookie', adminCookie)
            .query({ search: route.title });

        assert.equal(asAdmin.status, 200);
        assert.ok(asAdmin.body.data.some((entry) => entry.slug === route.slug));

        const asPublic = await request(app).get(`/api/transfers/routes/${route.slug}`);
        assert.equal(asPublic.status, 404, 'a draft is not a page');
    });

    it('refuses to publish a route with no price on it', async () => {
        const res = await request(app)
            .post(`/api/admin/transfers/routes/${route.id}/publish`)
            .set('Cookie', adminCookie);

        assert.equal(res.status, 422);
        assert.equal(res.body.error.details.missing[0].code, 'NO_PRICES');
    });

    it('publishes once the grid is filled in', async () => {
        const priced = await request(app)
            .put(`/api/admin/transfers/routes/${route.id}/prices`)
            .set('Cookie', adminCookie)
            .send({
                prices: [
                    { vehicleId: sedan.id, oneWayCents: 17_500 },
                    { vehicleId: van.id, oneWayCents: 31_500, returnCents: 56_000 }
                ]
            });

        assert.equal(priced.status, 200);
        assert.equal(priced.body.prices.length, 2);

        const published = await request(app)
            .post(`/api/admin/transfers/routes/${route.id}/publish`)
            .set('Cookie', adminCookie);

        assert.equal(published.status, 200);
        assert.equal(published.body.status, 'ACTIVE');

        const asPublic = await request(app).get(`/api/transfers/routes/${route.slug}`);
        assert.equal(asPublic.status, 200);
        assert.equal(asPublic.body.startingFromCents, 17_500, 'the cheapest fare is the "from" price');
    });

    it('replaces the whole price grid rather than merging into it', async () => {
        const res = await request(app)
            .put(`/api/admin/transfers/routes/${route.id}/prices`)
            .set('Cookie', adminCookie)
            .send({ prices: [{ vehicleId: sedan.id, oneWayCents: 18_000 }] });

        assert.equal(res.status, 200);
        assert.equal(res.body.prices.length, 1, 'the van price is gone, not left behind');
        assert.equal(res.body.prices[0].oneWayCents, 18_000);
    });

    it('never lets a price grid name a vehicle that does not exist', async () => {
        const res = await request(app)
            .put(`/api/admin/transfers/routes/${route.id}/prices`)
            .set('Cookie', adminCookie)
            .send({ prices: [{ vehicleId: 'not-a-vehicle', oneWayCents: 1000 }] });

        assert.equal(res.status, 404);
    });

    it('reprices in bulk, filling gaps without touching what is already set', async () => {
        const other = tracker.transferRoute(
            await makeTransferRoute({
                slug: unique('bulk'),
                fromPointId: from.id,
                toPointId: to.id,
                category: 'COMBINED',
                tier: 'TIER_3',
                distanceKm: 200,
                status: 'ACTIVE'
            })
        );

        const res = await request(app)
            .put('/api/admin/transfers/routes/prices')
            .set('Cookie', adminCookie)
            .send({
                routeIds: [route.id, other.id],
                vehicleIds: [sedan.id, van.id],
                perKmCents: 150
            });

        assert.equal(res.status, 200);
        assert.equal(res.body.kept, 1, 'the sedan price on the published route was left alone');
        assert.equal(res.body.written, 3);

        const untouched = await prisma.transferRoutePrice.findFirst({
            where: { routeId: route.id, vehicleId: sedan.id }
        });
        assert.equal(untouched.oneWayCents, 18_000);

        const written = await prisma.transferRoutePrice.findFirst({
            where: { routeId: other.id, vehicleId: sedan.id }
        });
        assert.equal(written.oneWayCents, 30_000, '200 km at 1.50 GEL/km');
    });

    it('overwrites only when told to', async () => {
        const res = await request(app)
            .put('/api/admin/transfers/routes/prices')
            .set('Cookie', adminCookie)
            .send({
                routeIds: [route.id],
                vehicleIds: [sedan.id],
                flatCents: 25_000,
                overwrite: true
            });

        assert.equal(res.status, 200);

        const updated = await prisma.transferRoutePrice.findFirst({
            where: { routeId: route.id, vehicleId: sedan.id }
        });
        assert.equal(updated.oneWayCents, 25_000);
    });

    it('will not reprice the whole catalogue on a mis-click', async () => {
        const res = await request(app)
            .put('/api/admin/transfers/routes/prices')
            .set('Cookie', adminCookie)
            .send({ vehicleIds: [sedan.id], flatCents: 1000 });

        assert.equal(res.status, 400, 'a filter is required — there is no "everything" option');
    });

    it('will not take both a per-km rate and a flat fare', async () => {
        const res = await request(app)
            .put('/api/admin/transfers/routes/prices')
            .set('Cookie', adminCookie)
            .send({ tier: 'TIER_1', vehicleIds: [sedan.id], flatCents: 1000, perKmCents: 100 });

        assert.equal(res.status, 400);
    });

    it('retires a point rather than deleting it out from under a route', async () => {
        const res = await request(app)
            .delete(`/api/admin/transfers/points/${to.id}`)
            .set('Cookie', adminCookie);

        assert.equal(res.status, 200);

        const stored = await prisma.transferPoint.findUnique({ where: { id: to.id } });
        assert.equal(stored.status, 'INACTIVE');
        assert.ok(stored, 'the row survives, because a route and a booking both point at it');

        // Put it back for the tests that follow.
        await prisma.transferPoint.update({ where: { id: to.id }, data: { status: 'ACTIVE' } });
    });

    it('archives a vehicle class and takes it off the public shelf', async () => {
        const doomed = tracker.transferVehicle(await makeTransferVehicle({ slug: unique('doomed') }));

        const res = await request(app)
            .post(`/api/admin/transfers/vehicles/${doomed.id}/archive`)
            .set('Cookie', adminCookie);

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'ARCHIVED');
        assert.equal(res.body.b2cEnabled, false);

        const published = await request(app).get('/api/transfers/vehicles');
        assert.ok(!published.body.data.some((entry) => entry.slug === doomed.slug));
    });

    it('closes a road and reopens it', async () => {
        const created = await request(app)
            .post('/api/admin/transfers/blackouts')
            .set('Cookie', adminCookie)
            .send({
                routeId: route.id,
                from: futureDate(25),
                to: futureDate(35),
                reason: 'Snow on the pass'
            });

        assert.equal(created.status, 201);
        assert.equal(created.body.reason, 'Snow on the pass');

        const listed = await request(app)
            .get('/api/admin/transfers/blackouts')
            .set('Cookie', adminCookie)
            .query({ routeId: route.id });
        assert.equal(listed.body.data.length, 1);

        const removed = await request(app)
            .delete(`/api/admin/transfers/blackouts/${created.body.id}`)
            .set('Cookie', adminCookie);
        assert.equal(removed.status, 204);
    });

    it('changes only the fields an extra is sent, and knows an extra it has never heard of', async () => {
        const code = unique('childSeat');
        const created = await request(app)
            .post('/api/admin/transfers/extras')
            .set('Cookie', adminCookie)
            .send({ code, name: 'Child seat', basis: 'PER_PASSENGER', priceCents: 1_500, currency: 'USD', appliesToClasses: ['VAN'], position: 4 });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        tracker.transferExtra(created.body);

        // The panel's "reactivate" sends only the flag: nothing else may move.
        const retired = await request(app).put(`/api/admin/transfers/extras/${code}`).set('Cookie', adminCookie).send({ isActive: false });
        assert.equal(retired.status, 200, JSON.stringify(retired.body));
        assert.equal(retired.body.isActive, false);
        assert.equal(retired.body.basis, 'PER_PASSENGER');
        assert.equal(retired.body.currency, 'USD');
        assert.equal(retired.body.priceCents, 1_500);
        assert.deepEqual(retired.body.appliesToClasses, ['VAN']);
        assert.equal(retired.body.position, 4);

        const unknown = await request(app).put(`/api/admin/transfers/extras/${unique('nothing')}`).set('Cookie', adminCookie).send({});
        assert.equal(unknown.status, 404, 'a code nobody created is not created by a PUT');
    });

    it('refuses a blackout that closes nothing, or ends before it starts', async () => {
        const nothing = await request(app)
            .post('/api/admin/transfers/blackouts')
            .set('Cookie', adminCookie)
            .send({ from: futureDate(25), to: futureDate(35) });
        assert.equal(nothing.status, 400);

        const backwards = await request(app)
            .post('/api/admin/transfers/blackouts')
            .set('Cookie', adminCookie)
            .send({ routeId: route.id, from: futureDate(35), to: futureDate(25) });
        assert.equal(backwards.status, 400);
    });

    it('creates a point and a route, and refuses a route to nowhere', async () => {
        const provider = tracker.transferProvider(await makeTransferProvider());
        assert.ok(provider.id);

        const point = await request(app)
            .post('/api/admin/transfers/points')
            .set('Cookie', adminCookie)
            .send({
                slug: unique('new-point'),
                name: 'New Point',
                kind: 'RESORT',
                regionLabel: 'Racha',
                latitude: 42.5205,
                longitude: 43.1583
            });

        assert.equal(point.status, 201);
        tracker.transferPoint(point.body);

        const circular = await request(app)
            .post('/api/admin/transfers/routes')
            .set('Cookie', adminCookie)
            .send({
                slug: unique('circular'),
                fromPointId: point.body.id,
                toPointId: point.body.id
            });

        assert.equal(circular.status, 400, 'a route from a place to itself is not a journey');

        const created = await request(app)
            .post('/api/admin/transfers/routes')
            .set('Cookie', adminCookie)
            .send({
                slug: unique('new-route'),
                fromPointId: from.id,
                toPointId: point.body.id,
                tier: 'TIER_2',
                category: 'RESORT'
            });

        assert.equal(created.status, 201);
        tracker.transferRoute(created.body);
        assert.ok(created.body.distanceKm > 0, 'the distance is derived from the coordinates');
        assert.equal(created.body.status, 'DRAFT', 'and it starts unpublished');
    });

    it('registers a searched place once, whatever it is called', async () => {
        const place = placeRef();
        const body = (slug) => ({
            slug: unique(slug),
            name: 'Tbilisi Airport',
            kind: 'AIRPORT',
            regionLabel: 'Tbilisi',
            latitude: 41.6692,
            longitude: 44.9547,
            place
        });

        const first = await request(app).post('/api/admin/transfers/points').set('Cookie', adminCookie).send(body('tbs'));
        assert.equal(first.status, 201);
        tracker.transferPoint(first.body);
        assert.equal(first.body.place.placeId, place.placeId);

        const again = await request(app)
            .post('/api/admin/transfers/points')
            .set('Cookie', adminCookie)
            .send(body('tbilisi-airport'));
        assert.equal(again.status, 409, 'two slugs for one terminal would quote a journey of zero kilometres');
        assert.equal(again.body.error.details.slug, first.body.slug, 'and it names the point that already exists');

        // The same point may keep its own place across an edit.
        const edited = await request(app)
            .patch(`/api/admin/transfers/points/${first.body.id}`)
            .set('Cookie', adminCookie)
            .send({ name: 'Tbilisi Shota Rustaveli Airport', place });
        assert.equal(edited.status, 200);

        const malformed = await request(app)
            .post('/api/admin/transfers/points')
            .set('Cookie', adminCookie)
            .send({ ...body('broken'), place: { formattedAddress: 'somewhere' } });
        assert.equal(malformed.status, 400, 'a place without its id is not a place');
    });

    it('translates a route without touching its numbers', async () => {
        const res = await request(app)
            .put(`/api/admin/transfers/routes/${route.id}/translations/ka`)
            .set('Cookie', adminCookie)
            .send({ title: 'თბილისის აეროპორტი — გუდაური' });

        assert.equal(res.status, 200);

        const inGeorgian = await request(app)
            .get(`/api/transfers/routes/${route.slug}`)
            .query({ locale: 'ka' });

        assert.equal(inGeorgian.body.title, 'თბილისის აეროპორტი — გუდაური');
        assert.equal(inGeorgian.body.distanceKm, 128, 'the distance is not language');

        const inEnglish = await request(app).get(`/api/transfers/routes/${route.slug}`);
        assert.notEqual(inEnglish.body.title, 'თბილისის აეროპორტი — გუდაური');
    });
});
