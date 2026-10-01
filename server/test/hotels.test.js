import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makeAmenity,
    makeDestination,
    makeFileAsset,
    makeHotel,
    makePartner,
    makePartnerUser,
    placeRef,
    signIn,
    unique
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

describe('hotels', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let adminCookie;
    let partnerCookie;
    let destination;

    before(async () => {
        const admin = await makeAdmin(tracker);
        adminCookie = (await signIn(app, admin.email)).cookie;

        const partner = await makePartner(tracker);
        const partnerUser = await makePartnerUser(tracker, partner);
        partnerCookie = (await signIn(app, partnerUser.email)).cookie;

        destination = await makeDestination(tracker, { countryCode: 'GE', timezone: 'Asia/Tbilisi' });
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const asAdmin = (method, path) => request(app)[method](path).set('Cookie', adminCookie);

    /** A DRAFT hotel created the way the wizard's first step creates one. */
    const createDraft = async (overrides = {}) => {
        const response = await asAdmin('post', '/api/admin/hotels').send({
            slug: unique('hotel'),
            name: 'Test Hotel',
            propertyType: 'Boutique',
            destinationId: destination.id,
            starRating: 4,
            ...overrides
        });

        if (response.status === 201) {
            tracker.hotel(response.body);
        }

        return response;
    };

    /** Fills in everything `buildPublishChecklist` asks for. */
    const makePublishable = async (hotelId) => {
        const amenity = await makeAmenity(tracker);
        const file = await makeFileAsset(tracker);

        // Since Phase 2 a hotel needs somewhere to sleep before it can go on
        // sale, and since Phase 3 that room needs a rate plan — a room with no
        // offer has no board, no cancellation terms and nothing to price.
        const roomType = await prisma.roomType.create({
            data: {
                hotelId,
                code: 'std',
                name: 'Standard Double',
                maxOccupancy: 2,
                maxAdults: 2,
                standardOccupancy: 2
            }
        });

        const [mealPlan, cancellation, payment] = await Promise.all([
            prisma.mealPlan.findUnique({ where: { code: 'BB' } }),
            prisma.cancellationPolicy.findFirst({ where: { hotelId: null, kind: 'FLEXIBLE' } }),
            prisma.paymentPolicy.findFirst({ where: { hotelId: null, timing: 'PAY_NOW' } })
        ]);

        await prisma.ratePlan.create({
            data: {
                roomTypeId: roomType.id,
                code: 'bb-flex',
                name: 'Breakfast, flexible',
                mealPlanId: mealPlan.id,
                cancellationPolicyId: cancellation.id,
                paymentPolicyId: payment.id,
                currency: 'GEL'
            }
        });

        await prisma.hotelImage.create({
            data: { hotelId, fileAssetId: file.id, category: 'Exterior', isCover: true }
        });

        await asAdmin('put', `/api/admin/hotels/${hotelId}/amenities`).send({
            amenities: [{ amenityId: amenity.id, note: 'Free in all rooms' }]
        });

        await asAdmin('patch', `/api/admin/hotels/${hotelId}`).send({
            // Everything is B2B by default; these fixtures are checked through
            // the anonymous catalogue, so they opt into the public channel.
            b2cEnabled: true,
            address: '12 Rustaveli Avenue',
            latitude: 41.7497,
            longitude: 43.5322,
            shortDescription: 'A boutique stay in the pines',
            description: ['A longer paragraph about the property.'],
            checkInFrom: '14:00',
            checkOutUntil: '12:00',
            policies: {
                checkIn: 'From 14:00',
                checkOut: 'Until 12:00',
                cancellation: 'Free until 24h before arrival',
                children: 'Children of all ages are welcome',
                pets: 'Pets are not allowed',
                payment: 'Card or cash on arrival',
                rules: ['No smoking indoors']
            }
        });

        return { amenity, file };
    };

    describe('authorization', () => {
        it('refuses an unauthenticated caller on every admin route', async () => {
            assert.equal((await request(app).get('/api/admin/hotels')).status, 401);
            assert.equal((await request(app).post('/api/admin/hotels').send({})).status, 401);
            assert.equal((await request(app).post('/api/admin/hotels/x/publish')).status, 401);
        });

        it('refuses a partner user', async () => {
            const response = await request(app).get('/api/admin/hotels').set('Cookie', partnerCookie);

            assert.equal(response.status, 403);
        });
    });

    describe('creating a draft', () => {
        it('creates a DRAFT from step one alone and inherits place-derived fields', async () => {
            const response = await createDraft();

            assert.equal(response.status, 201);
            assert.equal(response.body.status, 'DRAFT');
            assert.equal(response.body.countryCode, 'GE');
            assert.equal(response.body.timezone, 'Asia/Tbilisi');
            assert.equal(response.body.currency, 'GEL');
            assert.ok(response.body.publishChecklist.length > 0, 'a bare draft is not publishable');
        });

        it('refuses a destination that does not exist', async () => {
            const response = await createDraft({ destinationId: 'no-such-destination' });

            assert.equal(response.status, 400);
            assert.match(response.body.error.message, /Destination does not exist/);
        });

        it('refuses a duplicate slug with a 409', async () => {
            const first = await createDraft();
            const second = await createDraft({ slug: first.body.slug });

            assert.equal(second.status, 409);
        });
    });

    describe('location', () => {
        it('stores the searched place with the pin, and clears both together', async () => {
            const { body: draft } = await createDraft();
            const place = placeRef({ name: 'Stamba Hotel', types: ['lodging', 'point_of_interest'] });

            const placed = await asAdmin('patch', `/api/admin/hotels/${draft.id}`).send({
                latitude: 41.7076,
                longitude: 44.7867,
                place
            });

            assert.equal(placed.status, 200);
            assert.deepEqual(placed.body.place, place);

            const half = await asAdmin('patch', `/api/admin/hotels/${draft.id}`).send({ latitude: null });
            assert.equal(half.status, 400, 'the pair rule holds for null as it does for absent');

            const cleared = await asAdmin('patch', `/api/admin/hotels/${draft.id}`).send({
                latitude: null,
                longitude: null
            });

            assert.equal(cleared.status, 200);
            assert.equal(cleared.body.latitude, null);
            assert.equal(cleared.body.longitude, null);
            assert.equal(cleared.body.place, null, 'an address for a pin that is gone would be a lie');
        });
    });

    describe('publishing', () => {
        it('refuses to publish an incomplete hotel and returns the whole checklist', async () => {
            const draft = await createDraft();

            const response = await asAdmin('post', `/api/admin/hotels/${draft.body.id}/publish`);

            assert.equal(response.status, 422);
            const codes = response.body.error.details.missing.map((item) => item.code);
            // The whole list at once, not the first failure: the review step
            // has to show everything outstanding in one pass.
            assert.ok(codes.includes('address'));
            assert.ok(codes.includes('policies'));
            assert.ok(codes.includes('images'));
            assert.ok(codes.length >= 5);

            const unchanged = await prisma.hotel.findUnique({ where: { id: draft.body.id } });
            assert.equal(unchanged.status, 'DRAFT');
        });

        it('publishes once every requirement is met', async () => {
            const draft = await createDraft();
            await makePublishable(draft.body.id);

            const ready = await asAdmin('get', `/api/admin/hotels/${draft.body.id}`);
            assert.deepEqual(ready.body.publishChecklist, []);

            const response = await asAdmin('post', `/api/admin/hotels/${draft.body.id}/publish`);

            assert.equal(response.status, 200);
            assert.equal(response.body.status, 'ACTIVE');
        });

        it('refuses to publish a hotel that is already published', async () => {
            const draft = await createDraft();
            await makePublishable(draft.body.id);
            await asAdmin('post', `/api/admin/hotels/${draft.body.id}/publish`);

            const again = await asAdmin('post', `/api/admin/hotels/${draft.body.id}/publish`);

            assert.equal(again.status, 409);
            assert.match(again.body.error.message, /already published/);
        });

        it('takes a hotel back off sale, and refuses to unpublish one that is not on sale', async () => {
            const draft = await createDraft();
            await makePublishable(draft.body.id);
            await asAdmin('post', `/api/admin/hotels/${draft.body.id}/publish`);

            const off = await asAdmin('post', `/api/admin/hotels/${draft.body.id}/unpublish`);
            assert.equal(off.status, 200);
            assert.equal(off.body.status, 'INACTIVE');

            const again = await asAdmin('post', `/api/admin/hotels/${draft.body.id}/unpublish`);
            assert.equal(again.status, 409);
        });

        it('records the transition in the audit trail', async () => {
            const draft = await createDraft();
            await makePublishable(draft.body.id);
            await asAdmin('post', `/api/admin/hotels/${draft.body.id}/publish`);

            const audit = await prisma.auditLog.findFirst({
                where: { entityType: 'Hotel', entityId: draft.body.id, action: 'HOTEL_PUBLISHED' }
            });

            assert.ok(audit);
            assert.equal(audit.metadata.from, 'DRAFT');
        });
    });

    describe('archiving', () => {
        // There is no delete. A hotel that has ever been booked has to keep
        // resolving to something, so the lifecycle ends at ARCHIVED.
        it('archives instead of deleting, and refuses to edit afterwards', async () => {
            const draft = await createDraft();

            const archived = await asAdmin('post', `/api/admin/hotels/${draft.body.id}/archive`).send({
                reason: 'Property closed'
            });
            assert.equal(archived.status, 200);
            assert.equal(archived.body.status, 'ARCHIVED');

            const edit = await asAdmin('patch', `/api/admin/hotels/${draft.body.id}`).send({ name: 'New name' });
            assert.equal(edit.status, 409);
            assert.match(edit.body.error.message, /archived/);

            assert.equal(await prisma.hotel.count({ where: { id: draft.body.id } }), 1);
        });

    });

    describe('amenities', () => {
        it('replaces the whole set in one call', async () => {
            const draft = await createDraft();
            const [first, second, third] = [
                await makeAmenity(tracker),
                await makeAmenity(tracker),
                await makeAmenity(tracker)
            ];

            const set = await asAdmin('put', `/api/admin/hotels/${draft.body.id}/amenities`).send({
                amenities: [{ amenityId: first.id }, { amenityId: second.id, note: '15 GEL per night' }]
            });
            assert.equal(set.status, 200);
            assert.equal(set.body.amenities.length, 2);
            assert.equal(set.body.amenities.find((a) => a.id === second.id).note, '15 GEL per night');

            // Replacing, not merging: the previous two go.
            const replaced = await asAdmin('put', `/api/admin/hotels/${draft.body.id}/amenities`).send({
                amenities: [{ amenityId: third.id }]
            });
            assert.equal(replaced.body.amenities.length, 1);
            assert.equal(replaced.body.amenities[0].id, third.id);
        });

        it('refuses an amenity that does not exist and says which', async () => {
            const draft = await createDraft();

            const response = await asAdmin('put', `/api/admin/hotels/${draft.body.id}/amenities`).send({
                amenities: [{ amenityId: 'no-such-amenity' }]
            });

            assert.equal(response.status, 409);
            assert.deepEqual(response.body.error.details.unknown, ['no-such-amenity']);
        });
    });

    describe('images', () => {
        it('refuses a cover image that belongs to another hotel', async () => {
            const mine = await createDraft();
            const theirs = await createDraft();
            const file = await makeFileAsset(tracker);

            await prisma.hotelImage.create({ data: { hotelId: theirs.body.id, fileAssetId: file.id } });

            const response = await asAdmin('patch', `/api/admin/hotels/${mine.body.id}`).send({
                featuredImageId: file.id
            });

            assert.equal(response.status, 400);
            assert.match(response.body.error.message, /does not belong to this hotel/);
        });

        it('composes image URLs from config rather than storing them', async () => {
            const draft = await createDraft();
            const { file } = await makePublishable(draft.body.id);

            const response = await asAdmin('get', `/api/admin/hotels/${draft.body.id}`);
            const image = response.body.images[0];

            assert.ok(image.url.endsWith(file.objectKey), 'the key is what is stored');
            assert.ok(image.url.startsWith('http'), 'and the base comes from config');
            // The row itself holds no URL.
            const stored = await prisma.fileAsset.findUnique({ where: { id: file.id } });
            assert.equal(stored.objectKey, file.objectKey);
            assert.equal(stored.url, undefined);
        });
    });

    describe('the public catalogue', () => {
        it('never returns a draft, whatever the query string says', async () => {
            const draft = await createDraft({ name: unique('SecretDraft') });

            const list = await request(app).get(`/api/hotels?search=${draft.body.name}&status=DRAFT`);
            assert.equal(list.status, 200);
            assert.equal(list.body.data.length, 0);

            const detail = await request(app).get(`/api/hotels/${draft.body.slug}`);
            assert.equal(detail.status, 404);
        });

        it('shows a hotel once it is published and hides it again when it is not', async () => {
            const draft = await createDraft();
            await makePublishable(draft.body.id);
            await asAdmin('post', `/api/admin/hotels/${draft.body.id}/publish`);

            const published = await request(app).get(`/api/hotels/${draft.body.slug}`);
            assert.equal(published.status, 200);
            assert.equal(published.body.name, 'Test Hotel');

            await asAdmin('post', `/api/admin/hotels/${draft.body.id}/unpublish`);
            assert.equal((await request(app).get(`/api/hotels/${draft.body.slug}`)).status, 404);
        });

        // A public card must not leak who supplies a property, which channel
        // manager feeds it, or what state it is in.
        it('withholds supplier, source and status from an anonymous caller', async () => {
            const supplier = await makePartner(tracker);
            const draft = await createDraft({ supplierId: supplier.id });
            await makePublishable(draft.body.id);
            await asAdmin('post', `/api/admin/hotels/${draft.body.id}/publish`);

            const publicView = await request(app).get(`/api/hotels/${draft.body.slug}`);
            assert.equal(publicView.body.supplier, undefined);
            assert.equal(publicView.body.supplierId, undefined);
            assert.equal(publicView.body.sourceType, undefined);
            assert.equal(publicView.body.status, undefined);
            assert.equal(publicView.body.externalRef, undefined);

            const adminView = await asAdmin('get', `/api/admin/hotels/${draft.body.id}`);
            assert.equal(adminView.body.status, 'ACTIVE');
            assert.equal(adminView.body.supplier.id, supplier.id);
            assert.equal(adminView.body.sourceType, 'MANUAL');
        });

        it('requires every requested amenity, not just one of them', async () => {
            const [pool, parking] = [await makeAmenity(tracker), await makeAmenity(tracker)];

            const both = await createDraft();
            await makePublishable(both.body.id);
            await asAdmin('put', `/api/admin/hotels/${both.body.id}/amenities`).send({
                amenities: [{ amenityId: pool.id }, { amenityId: parking.id }]
            });
            await asAdmin('post', `/api/admin/hotels/${both.body.id}/publish`);

            const onlyPool = await createDraft();
            await makePublishable(onlyPool.body.id);
            await asAdmin('put', `/api/admin/hotels/${onlyPool.body.id}/amenities`).send({
                amenities: [{ amenityId: pool.id }]
            });
            await asAdmin('post', `/api/admin/hotels/${onlyPool.body.id}/publish`);

            const response = await request(app).get(
                `/api/hotels?amenity=${pool.code}&amenity=${parking.code}&pageSize=50`
            );

            const ids = response.body.data.map((hotel) => hotel.id);
            assert.ok(ids.includes(both.body.id));
            assert.ok(!ids.includes(onlyPool.body.id), 'a hotel with only one of the two must not match');
        });

        it('filters a whole country by destination path prefix', async () => {
            const country = await makeDestination(tracker);
            const resort = await makeDestination(tracker, { parent: country, type: 'RESORT' });
            const hotel = await makeHotel(tracker, { destination: resort, status: 'ACTIVE' });

            const response = await request(app).get(
                `/api/hotels?destinationPath=${encodeURIComponent(country.path)}&pageSize=50`
            );

            assert.ok(response.body.data.some((row) => row.id === hotel.id));
        });
    });

    describe('the sales channel', () => {
        it('defaults a new hotel to B2B only', async () => {
            const draft = await createDraft();

            const adminView = await asAdmin('get', `/api/admin/hotels/${draft.body.id}`);
            assert.equal(adminView.body.b2cEnabled, false);
        });

        it('hides a B2B-only hotel from anonymous callers but not from trade', async () => {
            const draft = await createDraft({ name: unique('TradeOnly') });
            await makePublishable(draft.body.id);
            // makePublishable switches B2C on; switch it back off for this one.
            await asAdmin('patch', `/api/admin/hotels/${draft.body.id}`).send({ b2cEnabled: false });
            await asAdmin('post', `/api/admin/hotels/${draft.body.id}/publish`);

            // Anonymous: the hotel does not exist on this channel. 404, not
            // 403 — saying more would confirm it exists somewhere.
            assert.equal((await request(app).get(`/api/hotels/${draft.body.slug}`)).status, 404);
            const anonymousList = await request(app).get(`/api/hotels?search=${draft.body.name}`);
            assert.equal(anonymousList.body.data.length, 0);

            // A signed-in partner buys at trade and sees the whole catalogue.
            const asPartner = await request(app)
                .get(`/api/hotels/${draft.body.slug}`)
                .set('Cookie', partnerCookie);
            assert.equal(asPartner.status, 200);

            // Switching the channel on makes it public.
            await asAdmin('patch', `/api/admin/hotels/${draft.body.id}`).send({ b2cEnabled: true });
            assert.equal((await request(app).get(`/api/hotels/${draft.body.slug}`)).status, 200);
        });

        it('never exposes the channel flag itself to the public', async () => {
            const draft = await createDraft();
            await makePublishable(draft.body.id);
            await asAdmin('post', `/api/admin/hotels/${draft.body.id}/publish`);

            const publicView = await request(app).get(`/api/hotels/${draft.body.slug}`);
            assert.equal(publicView.body.b2cEnabled, undefined);

            const adminView = await asAdmin('get', `/api/admin/hotels/${draft.body.id}`);
            assert.equal(adminView.body.b2cEnabled, true);
        });
    });

    describe('delete', () => {
        it('removes a never-sold hotel outright, orphaned gallery assets included', async () => {
            const draft = await createDraft();
            const { file } = await makePublishable(draft.body.id);

            const response = await asAdmin('delete', `/api/admin/hotels/${draft.body.id}`);
            assert.equal(response.status, 204);

            assert.equal((await asAdmin('get', `/api/admin/hotels/${draft.body.id}`)).status, 404);
            // The gallery was this asset's only reference, so the row goes too.
            assert.equal(await prisma.fileAsset.count({ where: { id: file.id } }), 0);
        });

        it('refuses once the hotel has booking history, cancelled or not', async () => {
            const draft = await createDraft();
            await prisma.hotelBooking.create({
                data: {
                    reference: unique('BKG'),
                    hotelId: draft.body.id,
                    status: 'CANCELLED',
                    cancelledAt: new Date(),
                    checkIn: new Date('2030-01-10'),
                    checkOut: new Date('2030-01-12'),
                    nights: 2,
                    currency: 'GEL',
                    netTotalCents: 20000,
                    sellTotalCents: 23000,
                    markupBps: 1500,
                    leadGuestName: 'Ana Beridze',
                    leadGuestEmail: 'ana@example.test',
                    hotelSnapshot: {}
                }
            });

            const response = await asAdmin('delete', `/api/admin/hotels/${draft.body.id}`);
            assert.equal(response.status, 409);

            // Still there: the delete must not have touched anything.
            assert.equal((await asAdmin('get', `/api/admin/hotels/${draft.body.id}`)).status, 200);
        });

        it('is closed to partner users', async () => {
            const draft = await createDraft();

            const response = await request(app)
                .delete(`/api/admin/hotels/${draft.body.id}`)
                .set('Cookie', partnerCookie);
            assert.equal(response.status, 403);
        });
    });

    describe('translations', () => {
        it('merges field by field and falls back to English for the rest', async () => {
            const draft = await createDraft({ name: 'Pine Lodge' });
            await makePublishable(draft.body.id);
            await asAdmin('post', `/api/admin/hotels/${draft.body.id}/publish`);

            const put = await asAdmin('put', `/api/admin/hotels/${draft.body.id}/translations/ka`).send({
                name: 'ფიჭვის ლოჟი'
            });
            assert.equal(put.status, 200);

            const georgian = await request(app).get(`/api/hotels/${draft.body.slug}?locale=ka`);
            assert.equal(georgian.body.name, 'ფიჭვის ლოჟი');
            // Untranslated prose stays English rather than blanking.
            assert.equal(georgian.body.shortDescription, 'A boutique stay in the pines');

            const english = await request(app).get(`/api/hotels/${draft.body.slug}`);
            assert.equal(english.body.name, 'Pine Lodge');
        });
    });
});
