import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makeDestination,
    makeHotel,
    makePartner,
    makePartnerUser,
    placeRef,
    signIn,
    unique
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

describe('destinations', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let adminCookie;
    let partnerCookie;

    before(async () => {
        const admin = await makeAdmin(tracker);
        adminCookie = (await signIn(app, admin.email)).cookie;

        const partner = await makePartner(tracker);
        const partnerUser = await makePartnerUser(tracker, partner);
        partnerCookie = (await signIn(app, partnerUser.email)).cookie;
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    // Track anything the API creates, so cleanup can reach it too.
    const post = async (body, cookie = adminCookie) => {
        const response = await request(app).post('/api/admin/destinations').set('Cookie', cookie).send(body);

        if (response.status === 201) {
            tracker.destination(response.body);
        }

        return response;
    };

    describe('authorization', () => {
        it('refuses an unauthenticated caller', async () => {
            assert.equal((await request(app).get('/api/admin/destinations')).status, 401);
            assert.equal((await request(app).post('/api/admin/destinations').send({})).status, 401);
        });

        it('refuses a partner user', async () => {
            const response = await request(app).get('/api/admin/destinations').set('Cookie', partnerCookie);

            assert.equal(response.status, 403);
        });

        it('serves the public tree with no credential at all', async () => {
            const response = await request(app).get('/api/destinations');

            assert.equal(response.status, 200);
            assert.ok(Array.isArray(response.body.data));
        });
    });

    describe('the tree', () => {
        it('derives the path of a root from its slug', async () => {
            const slug = unique('country');
            const response = await post({ slug, name: 'Georgia', type: 'COUNTRY', countryCode: 'ge' });

            assert.equal(response.status, 201);
            assert.equal(response.body.path, `/${slug}`);
            // countryCode is normalised to upper case on the way in.
            assert.equal(response.body.countryCode, 'GE');
            assert.equal(response.body.parentId, null);
        });

        it('derives a child path and inherits country and time zone from the parent', async () => {
            const country = await makeDestination(tracker, {
                countryCode: 'GE',
                timezone: 'Asia/Tbilisi'
            });

            const slug = unique('resort');
            const response = await post({ slug, name: 'Bakuriani', type: 'RESORT', parentId: country.id });

            assert.equal(response.status, 201);
            assert.equal(response.body.path, `${country.path}/${slug}`);
            assert.equal(response.body.countryCode, 'GE');
            assert.equal(response.body.timezone, 'Asia/Tbilisi');
        });

        it('refuses a country with a parent, and a resort without one', async () => {
            const country = await makeDestination(tracker);

            const nested = await post({
                slug: unique('c'),
                name: 'Nested country',
                type: 'COUNTRY',
                parentId: country.id
            });
            assert.equal(nested.status, 400);
            assert.match(nested.body.error.message, /always a root/);

            const orphan = await post({ slug: unique('r'), name: 'Orphan resort', type: 'RESORT' });
            assert.equal(orphan.status, 400);
            assert.match(orphan.body.error.message, /must have a parent/);
        });

        it('refuses to file a broader level inside a narrower one', async () => {
            const country = await makeDestination(tracker);
            const city = await makeDestination(tracker, { parent: country, type: 'CITY' });

            const response = await post({
                slug: unique('region'),
                name: 'Region inside a city',
                type: 'REGION',
                parentId: city.id
            });

            assert.equal(response.status, 400);
            assert.match(response.body.error.message, /cannot sit inside/);
        });

        it('will not accept a path from the client', async () => {
            const response = await post({
                slug: unique('spoof'),
                name: 'Spoofed',
                type: 'COUNTRY',
                countryCode: 'GE',
                path: '/somewhere-else'
            });

            // Strict schemas reject unknown keys outright rather than ignoring
            // them: silently dropping a path would leave the caller believing
            // it had been honoured.
            assert.equal(response.status, 400);
        });
    });

    describe('moving and renaming', () => {
        // The whole reason `path` exists is prefix search. If a rename left a
        // stale prefix behind, every hotel under it would vanish from results
        // for that country while still looking fine in the admin panel.
        it('rewrites descendant paths when a parent is renamed', async () => {
            const country = await makeDestination(tracker);
            const region = await makeDestination(tracker, { parent: country, type: 'REGION' });
            const resort = await makeDestination(tracker, { parent: region, type: 'RESORT' });

            const renamed = unique('renamed');
            const response = await request(app)
                .patch(`/api/admin/destinations/${country.id}`)
                .set('Cookie', adminCookie)
                .send({ slug: renamed });

            assert.equal(response.status, 200);
            assert.equal(response.body.path, `/${renamed}`);

            const after = await prisma.destination.findMany({
                where: { id: { in: [region.id, resort.id] } },
                orderBy: { path: 'asc' }
            });

            assert.equal(after[0].path, `/${renamed}/${region.slug}`);
            assert.equal(after[1].path, `/${renamed}/${region.slug}/${resort.slug}`);
        });

        it('rewrites descendant paths when a subtree is moved', async () => {
            const from = await makeDestination(tracker);
            const to = await makeDestination(tracker);
            const region = await makeDestination(tracker, { parent: from, type: 'REGION' });
            const resort = await makeDestination(tracker, { parent: region, type: 'RESORT' });

            const response = await request(app)
                .patch(`/api/admin/destinations/${region.id}`)
                .set('Cookie', adminCookie)
                .send({ parentId: to.id });

            assert.equal(response.status, 200);
            assert.equal(response.body.path, `${to.path}/${region.slug}`);

            const moved = await prisma.destination.findUnique({ where: { id: resort.id } });
            assert.equal(moved.path, `${to.path}/${region.slug}/${resort.slug}`);
        });

        it('refuses to move a destination inside its own subtree', async () => {
            const country = await makeDestination(tracker);
            const region = await makeDestination(tracker, { parent: country, type: 'REGION' });

            const response = await request(app)
                .patch(`/api/admin/destinations/${country.id}`)
                .set('Cookie', adminCookie)
                .send({ parentId: region.id, type: 'CITY' });

            assert.equal(response.status, 409);
            assert.match(response.body.error.message, /inside itself/);

            // And nothing moved.
            const unchanged = await prisma.destination.findUnique({ where: { id: country.id } });
            assert.equal(unchanged.parentId, null);
            assert.equal(unchanged.path, country.path);
        });
    });

    describe('deleting', () => {
        it('refuses to delete a destination that still holds hotels, and says what is in the way', async () => {
            const destination = await makeDestination(tracker);
            await makeHotel(tracker, { destination });

            const response = await request(app)
                .delete(`/api/admin/destinations/${destination.id}`)
                .set('Cookie', adminCookie);

            assert.equal(response.status, 409);
            assert.equal(response.body.error.details.blockedBy.hotels, 1);
            assert.equal(await prisma.destination.count({ where: { id: destination.id } }), 1);
        });

        it('refuses to delete a destination that still has children', async () => {
            const country = await makeDestination(tracker);
            await makeDestination(tracker, { parent: country, type: 'REGION' });

            const response = await request(app)
                .delete(`/api/admin/destinations/${country.id}`)
                .set('Cookie', adminCookie);

            assert.equal(response.status, 409);
            assert.equal(response.body.error.details.blockedBy.children, 1);
        });

        it('deletes a leaf and records it in the audit trail', async () => {
            const destination = await makeDestination(tracker);

            const response = await request(app)
                .delete(`/api/admin/destinations/${destination.id}`)
                .set('Cookie', adminCookie);

            assert.equal(response.status, 204);
            assert.equal(await prisma.destination.count({ where: { id: destination.id } }), 0);

            const audit = await prisma.auditLog.findFirst({
                where: { entityType: 'Destination', entityId: destination.id, action: 'DESTINATION_DELETED' }
            });
            assert.ok(audit, 'a deletion must leave a trail');
            assert.equal(audit.metadata.path, destination.path);
        });
    });

    describe('validation', () => {
        it('rejects a slug that would break prefix matching', async () => {
            for (const slug of ['Old Town', 'old/town', 'a', '']) {
                const response = await post({ slug, name: 'Bad', type: 'COUNTRY', countryCode: 'GE' });
                assert.equal(response.status, 400, `expected ${JSON.stringify(slug)} to be rejected`);
            }
        });

        it('rejects half a coordinate pair', async () => {
            const response = await post({
                slug: unique('half'),
                name: 'Half',
                type: 'COUNTRY',
                countryCode: 'GE',
                latitude: 41.7
            });

            assert.equal(response.status, 400);
            assert.match(response.body.error.message, /Invalid request body/);
        });

        it('rejects a place with no position to attach it to', async () => {
            const response = await post({
                slug: unique('placeless'),
                name: 'Placeless',
                type: 'COUNTRY',
                countryCode: 'GE',
                place: placeRef()
            });

            assert.equal(response.status, 400);
            assert.equal(response.body.error.details[0].path[0], 'place');
        });

        it('rejects a time zone the runtime cannot resolve', async () => {
            const response = await post({
                slug: unique('tz'),
                name: 'Nowhere',
                type: 'COUNTRY',
                countryCode: 'GE',
                timezone: 'Mars/Olympus'
            });

            assert.equal(response.status, 400);
        });
    });

    describe('translations', () => {
        it('merges a translation field by field and falls back to English for the rest', async () => {
            const destination = await makeDestination(tracker, {
                name: 'Bakuriani',
                tagline: 'Powder and pine',
                summary: 'A ski resort in Samtskhe-Javakheti'
            });

            const put = await request(app)
                .put(`/api/admin/destinations/${destination.id}/translations/ka`)
                .set('Cookie', adminCookie)
                // Only the name is translated; the tagline is deliberately left
                // out, which is the case that matters.
                .send({ name: 'ბაკურიანი' });

            assert.equal(put.status, 200);
            assert.equal(put.body.name, 'ბაკურიანი');

            const georgian = await request(app).get(`/api/destinations/${destination.slug}?locale=ka`);
            assert.equal(georgian.status, 200);
            assert.equal(georgian.body.name, 'ბაკურიანი');
            assert.equal(georgian.body.tagline, 'Powder and pine');

            const english = await request(app).get(`/api/destinations/${destination.slug}`);
            assert.equal(english.body.name, 'Bakuriani');
        });

        it('refuses a translation into the default locale', async () => {
            const destination = await makeDestination(tracker);

            const response = await request(app)
                .put(`/api/admin/destinations/${destination.id}/translations/en`)
                .set('Cookie', adminCookie)
                .send({ name: 'English' });

            assert.equal(response.status, 400);
        });

        it('falls back to English for a locale nobody has translated into', async () => {
            const destination = await makeDestination(tracker, { name: 'Untranslated' });

            const response = await request(app).get(`/api/destinations/${destination.slug}?locale=he`);

            assert.equal(response.status, 200);
            assert.equal(response.body.name, 'Untranslated');
        });

        it('degrades an unknown locale to English rather than failing', async () => {
            const destination = await makeDestination(tracker, { name: 'Untranslated' });

            const response = await request(app).get(`/api/destinations/${destination.slug}?locale=klingon`);

            assert.equal(response.status, 400);
        });
    });

    describe('reading', () => {
        it('lists in tree order, so a parent always precedes its children', async () => {
            const country = await makeDestination(tracker);
            const region = await makeDestination(tracker, { parent: country, type: 'REGION' });

            const response = await request(app)
                .get(`/api/admin/destinations?search=${country.slug.slice(0, 20)}&pageSize=100`)
                .set('Cookie', adminCookie);

            assert.equal(response.status, 200);
            const paths = response.body.data.map((row) => row.path);
            assert.ok(paths.indexOf(country.path) < paths.indexOf(region.path) || paths.length < 2);
        });

        it('nests children under their parent in the tree endpoint', async () => {
            const country = await makeDestination(tracker);
            const region = await makeDestination(tracker, { parent: country, type: 'REGION' });

            const response = await request(app).get('/api/destinations');
            const root = response.body.data.find((node) => node.id === country.id);

            assert.ok(root, 'the root should be present');
            assert.ok(root.children.some((child) => child.id === region.id));
        });

        it('answers 404 for a destination that does not exist', async () => {
            const response = await request(app).get('/api/destinations/no-such-destination');

            assert.equal(response.status, 404);
        });

        it('never exposes the PostGIS point, only the coordinates', async () => {
            const destination = await makeDestination(tracker);
            const response = await request(app).get(`/api/destinations/${destination.slug}`);

            assert.equal(response.body.latitude, 41.7497);
            assert.equal(response.body.longitude, 43.5322);
            assert.equal(response.body.geo, undefined);
        });

        it('keeps what the place search said beside the coordinates, and drops it with the pin', async () => {
            const place = placeRef({ name: 'Kazbegi', types: ['locality', 'political'] });
            const created = await post({
                slug: unique('placed'),
                name: 'Kazbegi',
                type: 'COUNTRY',
                countryCode: 'GE',
                latitude: 42.6569,
                longitude: 44.6427,
                place
            });

            assert.equal(created.status, 201);
            assert.deepEqual(created.body.place, place);

            const shown = await request(app).get(`/api/destinations/${created.body.slug}`);
            assert.equal(shown.body.place.placeId, place.placeId, 'the public read carries the address too');

            // Taking the pin off the map: the coordinates go, the PostGIS
            // point goes with them, and so does the address that described
            // the position that no longer exists.
            const cleared = await request(app)
                .patch(`/api/admin/destinations/${created.body.id}`)
                .set('Cookie', adminCookie)
                .send({ latitude: null, longitude: null });

            assert.equal(cleared.status, 200);
            assert.equal(cleared.body.latitude, null);
            assert.equal(cleared.body.place, null);

            const [row] = await prisma.$queryRaw`
                SELECT geo IS NULL AS empty FROM destinations WHERE id = ${created.body.id}
            `;
            assert.equal(row.empty, true);
        });
    });
});
