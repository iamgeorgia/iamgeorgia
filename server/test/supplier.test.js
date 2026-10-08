import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { resolveMarkup } from '../services/hotel/pricingRule.service.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makeDestination,
    makeHotel,
    makePartner,
    makePartnerUser,
    signIn,
    unique
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const CHECK_IN = '2027-08-10';
const CHECK_OUT = '2027-08-13';
const LAST_NIGHT = '2027-08-12';

describe('suppliers and B2B pricing', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const ruleIds = [];
    let adminCookie;
    let ownerCookie;
    let agentCookie;
    let rivalCookie;
    let supplier;
    let rival;
    let mine;
    let theirs;

    /** A hotel belonging to a supplier, fully sellable. */
    const makeSupplierHotel = async (supplierId, { netCents = 20_000 } = {}) => {
        const hotel = await makeHotel(tracker, {
            destination: await makeDestination(tracker),
            status: 'ACTIVE',
            supplierId,
            checkInFrom: '14:00'
        });

        const roomType = await prisma.roomType.create({
            data: {
                hotelId: hotel.id,
                code: 'std',
                name: 'Standard',
                maxOccupancy: 3,
                maxAdults: 2,
                standardOccupancy: 2
            }
        });

        const [mealPlan, cancellation, payment] = await Promise.all([
            prisma.mealPlan.findUnique({ where: { code: 'BB' } }),
            prisma.cancellationPolicy.findFirst({ where: { hotelId: null, kind: 'FLEXIBLE' } }),
            prisma.paymentPolicy.findFirst({ where: { hotelId: null, timing: 'PAY_NOW' } })
        ]);

        const ratePlan = await prisma.ratePlan.create({
            data: {
                roomTypeId: roomType.id,
                code: unique('rp').slice(0, 40),
                name: 'BB flexible',
                mealPlanId: mealPlan.id,
                cancellationPolicyId: cancellation.id,
                paymentPolicyId: payment.id,
                currency: 'GEL'
            }
        });

        await request(app)
            .put(`/api/admin/hotels/${hotel.id}/room-types/${roomType.id}/inventory`)
            .set('Cookie', adminCookie)
            .send({ from: CHECK_IN, to: LAST_NIGHT, totalUnits: 5 });
        await request(app)
            .put(`/api/admin/hotels/${hotel.id}/room-types/${roomType.id}/rate-plans/${ratePlan.id}/rates`)
            .set('Cookie', adminCookie)
            .send({ from: CHECK_IN, to: LAST_NIGHT, netCents });

        return { hotel, roomType, ratePlan };
    };

    before(async () => {
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;

        supplier = await makePartner(tracker, { kind: 'HOTEL' });
        rival = await makePartner(tracker, { kind: 'HOTEL' });

        const owner = await makePartnerUser(tracker, supplier, { role: 'PARTNER_OWNER' });
        const agent = await makePartnerUser(tracker, supplier, { role: 'PARTNER_AGENT' });
        const rivalOwner = await makePartnerUser(tracker, rival, { role: 'PARTNER_OWNER' });

        ownerCookie = (await signIn(app, owner.email)).cookie;
        agentCookie = (await signIn(app, agent.email)).cookie;
        rivalCookie = (await signIn(app, rivalOwner.email)).cookie;

        mine = await makeSupplierHotel(supplier.id);
        theirs = await makeSupplierHotel(rival.id);
    });

    after(async () => {
        await prisma.pricingRule.deleteMany({ where: { id: { in: ruleIds } } });
        await prisma.auditLog.deleteMany({ where: { entityId: { in: ruleIds } } });
        await tracker.cleanup();
        await disconnect();
    });

    const asOwner = (method, path) => request(app)[method](path).set('Cookie', ownerCookie);

    const makeRule = async (body) => {
        const response = await request(app)
            .post('/api/admin/pricing-rules')
            .set('Cookie', adminCookie)
            .send(body);

        if (response.status === 201) {
            ruleIds.push(response.body.id);
        }

        return response;
    };

    describe('supplier isolation', () => {
        it('lists only its own properties', async () => {
            const response = await asOwner('get', '/api/partner/hotels');

            assert.equal(response.status, 200);
            const ids = response.body.data.map((row) => row.id);
            assert.ok(ids.includes(mine.hotel.id));
            assert.ok(!ids.includes(theirs.hotel.id), 'another supplier property must not appear');
        });

        // A 404 rather than a 403: a 403 answers the question the prober asked.
        it('answers 404, not 403, for a property belonging to someone else', async () => {
            const response = await asOwner('get', `/api/partner/hotels/${theirs.hotel.id}`);

            assert.equal(response.status, 404);
        });

        it('refuses to write inventory on another supplier property', async () => {
            const response = await asOwner(
                'put',
                `/api/partner/hotels/${theirs.hotel.id}/room-types/${theirs.roomType.id}/inventory`
            ).send({ from: CHECK_IN, to: LAST_NIGHT, totalUnits: 99 });

            assert.equal(response.status, 404);

            const untouched = await prisma.roomInventory.findFirst({
                where: { roomTypeId: theirs.roomType.id }
            });
            assert.equal(untouched.totalUnits, 5, 'and nothing changed');
        });

        it('lets a supplier manage inventory on its own property', async () => {
            const response = await asOwner(
                'put',
                `/api/partner/hotels/${mine.hotel.id}/room-types/${mine.roomType.id}/inventory`
            ).send({ from: CHECK_IN, to: LAST_NIGHT, totalUnits: 8 });

            assert.equal(response.status, 200);
            assert.equal(response.body.nights, 3);

            const updated = await prisma.roomInventory.findFirst({ where: { roomTypeId: mine.roomType.id } });
            assert.equal(updated.totalUnits, 8);
        });

        it('lets a supplier change its own rates', async () => {
            const response = await asOwner(
                'put',
                `/api/partner/hotels/${mine.hotel.id}/room-types/${mine.roomType.id}/rate-plans/${mine.ratePlan.id}/rates`
            ).send({ from: CHECK_IN, to: LAST_NIGHT, netCents: 24_000 });

            assert.equal(response.status, 200);
        });

        // Ownership says which property; the role says what may be done to it.
        it('refuses an agent the right to rewrite the rate calendar', async () => {
            const response = await request(app)
                .put(`/api/partner/hotels/${mine.hotel.id}/room-types/${mine.roomType.id}/inventory`)
                .set('Cookie', agentCookie)
                .send({ from: CHECK_IN, to: LAST_NIGHT, totalUnits: 1 });

            assert.equal(response.status, 403);
            assert.match(response.body.error.message, /role cannot change/);
        });

        it('still lets that agent read the property', async () => {
            const response = await request(app)
                .get(`/api/partner/hotels/${mine.hotel.id}`)
                .set('Cookie', agentCookie);

            assert.equal(response.status, 200);
        });

        it('refuses a supplier the admin hotel routes entirely', async () => {
            assert.equal((await asOwner('get', '/api/admin/hotels')).status, 403);
            assert.equal(
                (await asOwner('post', `/api/admin/hotels/${mine.hotel.id}/publish`)).status,
                403
            );
        });

        it('shows a supplier the arrivals at its own property', async () => {
            const response = await asOwner('get', `/api/partner/hotels/${mine.hotel.id}/bookings`);

            assert.equal(response.status, 200);
            assert.ok(Array.isArray(response.body.data));

            assert.equal(
                (await request(app)
                    .get(`/api/partner/hotels/${theirs.hotel.id}/bookings`)
                    .set('Cookie', ownerCookie)).status,
                404
            );
        });
    });

    describe('net rate visibility', () => {
        // The net rate is the supplier's own contracted cost. Hiding a
        // supplier's own cost from it would be absurd; showing it to anyone
        // else exposes the margin.
        it('shows a supplier the net rate on its own calendar', async () => {
            const response = await asOwner(
                'get',
                `/api/partner/hotels/${mine.hotel.id}/room-types/${mine.roomType.id}/inventory/calendar?from=${CHECK_IN}&to=${LAST_NIGHT}`
            );

            assert.equal(response.status, 200);
            const rate = response.body.nights[0].rates[0];
            assert.ok(rate.netCents > 0, 'the supplier sees what it charges us');
        });

        it('shows a supplier the status and source of its own property', async () => {
            const response = await asOwner('get', `/api/partner/hotels/${mine.hotel.id}`);

            assert.equal(response.body.status, 'ACTIVE');
            assert.equal(response.body.sourceType, 'MANUAL');
        });

        it('never shows any of it to a guest', async () => {
            const search = await request(app).get(
                `/api/search?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2&pageSize=50`
            );

            const serialized = JSON.stringify(search.body);
            assert.ok(!serialized.includes('netCents'));
            assert.ok(!serialized.includes('markupBps'));
            assert.ok(!serialized.includes('supplierId'));
        });

        it('never shows one supplier the cost side of another', async () => {
            const response = await request(app)
                .get(`/api/search/hotels/${theirs.hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`)
                .set('Cookie', ownerCookie);

            assert.equal(response.status, 200);
            assert.ok(!JSON.stringify(response.body).includes('netCents'));
        });
    });

    describe('pricing rules', () => {
        it('falls back to the partner commission when no rule matches', async () => {
            const resolved = await resolveMarkup({ partner: supplier, hotel: mine.hotel });

            assert.equal(resolved.markupBps, supplier.commissionRateBps);
            assert.equal(resolved.source, 'PARTNER_COMMISSION');
        });

        it('falls back to the platform default for an anonymous buyer', async () => {
            const resolved = await resolveMarkup({ hotel: mine.hotel });

            assert.equal(resolved.source, 'PLATFORM_DEFAULT');
            assert.ok(resolved.markupBps > 0);
        });

        it('applies a rule written for transfers to a transfer, and not to a hotel', async () => {
            // Scoped to a destination nothing else uses, so a parallel test
            // file quoting transfers never sees it.
            const destination = await makeDestination(tracker);
            const created = await makeRule({ productType: 'TRANSFER', destinationId: destination.id, markupBps: 900 });
            assert.equal(created.status, 201);

            const transfer = await resolveMarkup({ productType: 'TRANSFER', destinationId: destination.id });
            assert.equal(transfer.source, 'RULE');
            assert.equal(transfer.markupBps, 900);

            const hotel = await resolveMarkup({ productType: 'HOTEL', destinationId: destination.id });
            assert.notEqual(hotel.markupBps, 900);
        });

        it('prefers a rule over the commission rate', async () => {
            const created = await makeRule({ partnerId: supplier.id, markupBps: 700, label: 'Negotiated' });
            assert.equal(created.status, 201);

            const resolved = await resolveMarkup({ partner: supplier, hotel: mine.hotel });

            assert.equal(resolved.markupBps, 700);
            assert.equal(resolved.source, 'RULE');
        });

        // Specificity is counted rather than ordered by hand, so adding a
        // dimension later does not reshuffle existing precedence.
        it('prefers the more specific rule when two match', async () => {
            await makeRule({ partnerId: supplier.id, markupBps: 700 });
            await makeRule({ partnerId: supplier.id, hotelId: mine.hotel.id, markupBps: 400 });

            const atThisHotel = await resolveMarkup({ partner: supplier, hotel: mine.hotel });
            const elsewhere = await resolveMarkup({ partner: supplier, hotel: theirs.hotel });

            assert.equal(atThisHotel.markupBps, 400, 'the hotel-specific rate wins here');
            assert.equal(elsewhere.markupBps, 700, 'and the blanket rate applies everywhere else');
        });

        it('ignores a rule outside its date window', async () => {
            await makeRule({
                partnerId: supplier.id,
                markupBps: 100,
                validFrom: '2020-01-01',
                validUntil: '2020-12-31'
            });

            const resolved = await resolveMarkup({ partner: supplier, hotel: theirs.hotel });

            assert.notEqual(resolved.markupBps, 100, 'an expired rule must not apply');
        });

        it('ignores a deactivated rule', async () => {
            const created = await makeRule({ partnerId: rival.id, markupBps: 50 });

            assert.equal(
                (await resolveMarkup({ partner: rival, hotel: theirs.hotel })).markupBps,
                50
            );

            await request(app)
                .put(`/api/admin/pricing-rules/${created.body.id}`)
                .set('Cookie', adminCookie)
                .send({ partnerId: rival.id, markupBps: 50, isActive: false });

            const after = await resolveMarkup({ partner: rival, hotel: theirs.hotel });
            assert.notEqual(after.markupBps, 50);
        });

        it('changes what a partner is actually quoted', async () => {
            const cheap = await makePartner(tracker, { commissionRateBps: 1_000 });
            const cheapUser = await makePartnerUser(tracker, cheap);
            const cheapCookie = (await signIn(app, cheapUser.email)).cookie;

            const before = await request(app)
                .get(`/api/search/hotels/${mine.hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`)
                .set('Cookie', cheapCookie);

            await makeRule({ partnerId: cheap.id, markupBps: 0, label: 'At cost' });

            const after = await request(app)
                .get(`/api/search/hotels/${mine.hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`)
                .set('Cookie', cheapCookie);

            const beforeTotal = before.body.roomTypes[0].offers[0].quote.totals.totalCents;
            const afterTotal = after.body.roomTypes[0].offers[0].quote.totals.totalCents;

            assert.ok(afterTotal < beforeTotal, 'a rule at zero markup is cheaper than a 10% commission');
        });

        it('explains where a markup came from', async () => {
            await makeRule({ partnerId: supplier.id, markupBps: 700, label: 'Negotiated' });

            const response = await request(app)
                .get(`/api/admin/pricing-rules/explain?partnerId=${supplier.id}&hotelId=${mine.hotel.id}`)
                .set('Cookie', adminCookie);

            assert.equal(response.status, 200);
            assert.equal(response.body.source, 'RULE');
            assert.ok(response.body.ruleId);
        });

        it('is admin-only', async () => {
            assert.equal((await asOwner('get', '/api/admin/pricing-rules')).status, 403);
            assert.equal(
                (await asOwner('post', '/api/admin/pricing-rules').send({ markupBps: 0 })).status,
                403
            );
        });

        it('refuses a negative markup and a backwards window', async () => {
            assert.equal((await makeRule({ markupBps: -100 })).status, 400);
            assert.equal(
                (await makeRule({ markupBps: 100, validFrom: '2027-12-31', validUntil: '2027-01-01' })).status,
                400
            );
        });
    });
});
