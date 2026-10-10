import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { dateOnlyToUtc } from '../lib/time.js';
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

describe('inventory and rates', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let adminCookie;
    let partnerCookie;
    let hotel;
    let roomType;
    let ratePlan;

    before(async () => {
        const admin = await makeAdmin(tracker);
        adminCookie = (await signIn(app, admin.email)).cookie;
        const partner = await makePartner(tracker);
        partnerCookie = (await signIn(app, (await makePartnerUser(tracker, partner)).email)).cookie;

        hotel = await makeHotel(tracker, { destination: await makeDestination(tracker) });
        roomType = await prisma.roomType.create({
            data: { hotelId: hotel.id, code: 'deluxe', name: 'Deluxe', maxOccupancy: 3, maxAdults: 2 }
        });

        const [mealPlan, cancellation, payment] = await Promise.all([
            prisma.mealPlan.findUnique({ where: { code: 'BB' } }),
            prisma.cancellationPolicy.findFirst({ where: { hotelId: null, kind: 'FLEXIBLE' } }),
            prisma.paymentPolicy.findFirst({ where: { hotelId: null, timing: 'PAY_NOW' } })
        ]);

        ratePlan = await prisma.ratePlan.create({
            data: {
                roomTypeId: roomType.id,
                code: 'bb-flex',
                name: 'BB flexible',
                mealPlanId: mealPlan.id,
                cancellationPolicyId: cancellation.id,
                paymentPolicyId: payment.id,
                currency: 'GEL'
            }
        });
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const asAdmin = (method, path) => request(app)[method](path).set('Cookie', adminCookie);
    const inventoryPath = (rt = roomType.id) =>
        `/api/admin/hotels/${hotel.id}/room-types/${rt}/inventory`;
    const ratesPath = (rp = ratePlan.id) =>
        `/api/admin/hotels/${hotel.id}/room-types/${roomType.id}/rate-plans/${rp}/rates`;

    /** A fresh room type, so ranges in one test cannot collide with another. */
    const freshRoom = async () =>
        prisma.roomType.create({
            data: {
                hotelId: hotel.id,
                code: unique('rt').slice(0, 40),
                name: 'Scratch',
                maxOccupancy: 4,
                maxAdults: 2
            }
        });

    const nightsOf = (roomTypeId) =>
        prisma.roomInventory.findMany({ where: { roomTypeId }, orderBy: { date: 'asc' } });

    describe('authorization', () => {
        it('refuses an unauthenticated caller and a partner user', async () => {
            assert.equal((await request(app).put(inventoryPath()).send({})).status, 401);
            assert.equal(
                (await request(app).put(inventoryPath()).set('Cookie', partnerCookie).send({})).status,
                403
            );
        });
    });

    describe('bulk range writes', () => {
        it('writes a whole month in one call', async () => {
            const room = await freshRoom();

            const response = await asAdmin('put', inventoryPath(room.id)).send({
                from: '2027-01-01',
                to: '2027-01-31',
                totalUnits: 5
            });

            assert.equal(response.status, 200);
            assert.equal(response.body.nights, 31);
            assert.equal((await nightsOf(room.id)).length, 31);
        });

        // The requirement in the brief: Mon-Thu at one price, Fri-Sun at
        // another, as two calls rather than sixty-two.
        it('applies a weekday mask', async () => {
            const room = await freshRoom();

            const midweek = await asAdmin('put', inventoryPath(room.id)).send({
                from: '2027-02-01',
                to: '2027-02-28',
                weekdays: [1, 2, 3, 4],
                totalUnits: 3
            });
            const weekend = await asAdmin('put', inventoryPath(room.id)).send({
                from: '2027-02-01',
                to: '2027-02-28',
                weekdays: [5, 6, 7],
                totalUnits: 8
            });

            assert.equal(midweek.body.nights + weekend.body.nights, 28);

            const rows = await nightsOf(room.id);
            const byWeekday = new Map(
                rows.map((row) => [row.date.getUTCDay() === 0 ? 7 : row.date.getUTCDay(), row.totalUnits])
            );

            assert.equal(byWeekday.get(1), 3, 'Monday is midweek');
            assert.equal(byWeekday.get(6), 8, 'Saturday is weekend');
        });

        // This is what makes "close December to arrivals" a call that does not
        // have to restate the room counts to avoid wiping them.
        it('leaves untouched what a later call does not mention', async () => {
            const room = await freshRoom();

            await asAdmin('put', inventoryPath(room.id)).send({
                from: '2027-03-01',
                to: '2027-03-05',
                totalUnits: 4,
                minStay: 2
            });
            await asAdmin('put', inventoryPath(room.id)).send({
                from: '2027-03-01',
                to: '2027-03-05',
                closedToArrival: true
            });

            const rows = await nightsOf(room.id);

            assert.equal(rows[0].totalUnits, 4, 'the count survived');
            assert.equal(rows[0].minStay, 2, 'so did the minimum stay');
            assert.equal(rows[0].closedToArrival, true, 'and the new value applied');
        });

        it('is idempotent', async () => {
            const room = await freshRoom();
            const body = { from: '2027-04-01', to: '2027-04-10', totalUnits: 2 };

            await asAdmin('put', inventoryPath(room.id)).send(body);
            await asAdmin('put', inventoryPath(room.id)).send(body);

            assert.equal((await nightsOf(room.id)).length, 10, 'no duplicate rows');
        });

        it('refuses a range that ends before it begins, or one that is too long', async () => {
            const room = await freshRoom();

            assert.equal(
                (await asAdmin('put', inventoryPath(room.id)).send({ from: '2027-05-10', to: '2027-05-01', totalUnits: 1 }))
                    .status,
                400
            );
            assert.equal(
                (await asAdmin('put', inventoryPath(room.id)).send({ from: '2027-01-01', to: '2032-01-01', totalUnits: 1 }))
                    .status,
                400
            );
        });

        it('refuses a call that sets nothing', async () => {
            const room = await freshRoom();

            const response = await asAdmin('put', inventoryPath(room.id)).send({
                from: '2027-06-01',
                to: '2027-06-05'
            });

            assert.equal(response.status, 400);
        });

        it('writes one audit row for a range, not one per night', async () => {
            const room = await freshRoom();

            await asAdmin('put', inventoryPath(room.id)).send({
                from: '2027-07-01',
                to: '2027-07-31',
                totalUnits: 2
            });

            const audits = await prisma.auditLog.findMany({
                where: { entityType: 'RoomType', entityId: room.id, action: 'INVENTORY_UPDATED' }
            });

            assert.equal(audits.length, 1, 'a July update must not bury the trail under 31 entries');
            assert.equal(audits[0].metadata.nights, 31);
        });
    });

    describe('the oversell guard', () => {
        it('refuses to cut the total below what is already committed, and says which nights', async () => {
            const room = await freshRoom();

            await asAdmin('put', inventoryPath(room.id)).send({
                from: '2027-08-01',
                to: '2027-08-05',
                totalUnits: 5
            });

            // Simulate three rooms already sold on one night.
            await prisma.roomInventory.update({
                where: { roomTypeId_date: { roomTypeId: room.id, date: dateOnlyToUtc('2027-08-03') } },
                data: { bookedUnits: 3 }
            });

            const response = await asAdmin('put', inventoryPath(room.id)).send({
                from: '2027-08-01',
                to: '2027-08-05',
                totalUnits: 2
            });

            assert.equal(response.status, 409);
            assert.equal(response.body.error.details.conflicts[0].date, '2027-08-03');
            assert.equal(response.body.error.details.conflicts[0].committed, 3);

            // And nothing moved, including the nights that would have been fine.
            const rows = await nightsOf(room.id);
            assert.ok(rows.every((row) => row.totalUnits === 5), 'the whole range is one transaction');
        });

        // The constraint is the real guarantee, not the pre-check.
        it('rejects an oversell at the database even when the service is bypassed', async () => {
            const room = await freshRoom();
            await asAdmin('put', inventoryPath(room.id)).send({
                from: '2027-09-01',
                to: '2027-09-02',
                totalUnits: 1
            });

            await assert.rejects(
                () =>
                    prisma.roomInventory.update({
                        where: { roomTypeId_date: { roomTypeId: room.id, date: dateOnlyToUtc('2027-09-01') } },
                        data: { bookedUnits: 2 }
                    }),
                (err) => /no_oversell/.test(err.message)
            );
        });

        it('allows a reduction down to exactly what is committed', async () => {
            const room = await freshRoom();
            await asAdmin('put', inventoryPath(room.id)).send({
                from: '2027-10-01',
                to: '2027-10-02',
                totalUnits: 5
            });
            await prisma.roomInventory.update({
                where: { roomTypeId_date: { roomTypeId: room.id, date: dateOnlyToUtc('2027-10-01') } },
                data: { bookedUnits: 2 }
            });

            const response = await asAdmin('put', inventoryPath(room.id)).send({
                from: '2027-10-01',
                to: '2027-10-02',
                totalUnits: 2
            });

            assert.equal(response.status, 200);
        });
    });

    describe('rates', () => {
        it('writes a seasonal price across a range', async () => {
            const response = await asAdmin('put', ratesPath()).send({
                from: '2027-01-01',
                to: '2027-01-31',
                netCents: 12_500
            });

            assert.equal(response.status, 200);
            assert.equal(response.body.nights, 31);
        });

        it('splits midweek and weekend pricing', async () => {
            await asAdmin('put', ratesPath()).send({
                from: '2027-11-01',
                to: '2027-11-30',
                weekdays: [1, 2, 3, 4],
                netCents: 10_000
            });
            await asAdmin('put', ratesPath()).send({
                from: '2027-11-01',
                to: '2027-11-30',
                weekdays: [5, 6, 7],
                netCents: 12_500
            });

            const rows = await prisma.rate.findMany({
                where: {
                    ratePlanId: ratePlan.id,
                    date: { gte: dateOnlyToUtc('2027-11-01'), lte: dateOnlyToUtc('2027-11-30') }
                }
            });

            assert.equal(rows.length, 30);
            const monday = rows.find((row) => row.date.getUTCDay() === 1);
            const saturday = rows.find((row) => row.date.getUTCDay() === 6);
            assert.equal(monday.netCents, 10_000);
            assert.equal(saturday.netCents, 12_500);
        });

        it('lets a holiday overwrite the season it sits inside', async () => {
            await asAdmin('put', ratesPath()).send({ from: '2027-12-01', to: '2027-12-31', netCents: 15_000 });
            await asAdmin('put', ratesPath()).send({ from: '2027-12-24', to: '2027-12-26', netCents: 30_000 });

            const rows = await prisma.rate.findMany({
                where: {
                    ratePlanId: ratePlan.id,
                    date: { gte: dateOnlyToUtc('2027-12-23'), lte: dateOnlyToUtc('2027-12-27') }
                },
                orderBy: { date: 'asc' }
            });

            assert.deepEqual(
                rows.map((row) => row.netCents),
                [15_000, 30_000, 30_000, 30_000, 15_000]
            );
        });

        // A stay spanning two currencies would produce a total that means
        it('refuses a fixed sell price below net, from either side', async () => {
            const room = await freshRoom();
            const plan = await prisma.ratePlan.create({
                data: {
                    roomTypeId: room.id,
                    code: 'floor',
                    name: 'Floor',
                    mealPlanId: (await prisma.mealPlan.findUnique({ where: { code: 'RO' } })).id,
                    cancellationPolicyId: (await prisma.cancellationPolicy.findFirst({ where: { hotelId: null } })).id,
                    paymentPolicyId: (await prisma.paymentPolicy.findFirst({ where: { hotelId: null } })).id,
                    currency: 'GEL'
                }
            });
            const path = `/api/admin/hotels/${hotel.id}/room-types/${room.id}/rate-plans/${plan.id}/rates`;
            const range = { from: '2027-04-01', to: '2027-04-07' };

            // Both figures in one call: the schema catches it.
            const together = await asAdmin('put', path).send({ ...range, netCents: 10_000, sellCents: 9_000 });
            assert.equal(together.status, 400);

            assert.equal((await asAdmin('put', path).send({ ...range, netCents: 10_000, sellCents: 10_000 })).status, 200);

            // A sell under a net already on the calendar.
            const under = await asAdmin('put', path).send({ ...range, sellCents: 9_999 });
            assert.equal(under.status, 422);
            assert.equal(under.body.error.details.reason, 'SELL_BELOW_NET');
            assert.equal(under.body.error.details.netCents, 10_000);

            // A net over a sell already fixed.
            const over = await asAdmin('put', path).send({ ...range, netCents: 10_001 });
            assert.equal(over.status, 422);
            assert.equal(over.body.error.details.sellCents, 10_000);

            // Clearing the fixed price frees the net again, and the audit row says what was fixed.
            assert.equal((await asAdmin('put', path).send({ ...range, sellCents: null })).status, 200);
            assert.equal((await asAdmin('put', path).send({ ...range, netCents: 12_000 })).status, 200);

            const audit = await prisma.auditLog.findFirst({
                where: { action: 'RATE_UPDATED', entityId: plan.id, metadata: { path: ['sellCents'], equals: 10_000 } }
            });
            assert.ok(audit, 'the fixed sell price is in the audit trail');

            // And the database refuses it even when the service is bypassed.
            await assert.rejects(
                prisma.$executeRaw`UPDATE rates SET sell_cents = net_cents - 1 WHERE rate_plan_id = ${plan.id}`,
                /rates_sell_gte_net/
            );
        });

        // nothing, so the plan's currency is the only one its rates may use.
        it('refuses a rate in a different currency from its plan', async () => {
            const response = await asAdmin('put', ratesPath()).send({
                from: '2027-01-01',
                to: '2027-01-05',
                netCents: 10_000,
                currency: 'EUR'
            });

            assert.equal(response.status, 400);
            assert.match(response.body.error.message, /same currency/);
        });

        it('refuses a negative price at the database', async () => {
            await assert.rejects(
                () =>
                    prisma.rate.create({
                        data: {
                            ratePlanId: ratePlan.id,
                            date: dateOnlyToUtc('2029-01-01'),
                            currency: 'GEL',
                            netCents: -100
                        }
                    }),
                (err) => /amounts_non_negative/.test(err.message)
            );
        });
    });

    describe('the calendar', () => {
        it('returns inventory and every rate plan beside it, night by night', async () => {
            const room = await freshRoom();
            const plan = await prisma.ratePlan.create({
                data: {
                    roomTypeId: room.id,
                    code: 'cal',
                    name: 'Calendar plan',
                    mealPlanId: (await prisma.mealPlan.findUnique({ where: { code: 'RO' } })).id,
                    cancellationPolicyId: (
                        await prisma.cancellationPolicy.findFirst({ where: { hotelId: null } })
                    ).id,
                    paymentPolicyId: (await prisma.paymentPolicy.findFirst({ where: { hotelId: null } })).id,
                    currency: 'GEL'
                }
            });

            await asAdmin('put', inventoryPath(room.id)).send({
                from: '2028-01-01',
                to: '2028-01-03',
                totalUnits: 4,
                blockedUnits: 1
            });
            await asAdmin(
                'put',
                `/api/admin/hotels/${hotel.id}/room-types/${room.id}/rate-plans/${plan.id}/rates`
            ).send({ from: '2028-01-01', to: '2028-01-03', netCents: 9_900 });

            const response = await asAdmin(
                'get',
                `${inventoryPath(room.id)}/calendar?from=2028-01-01&to=2028-01-03`
            );

            assert.equal(response.status, 200);
            assert.equal(response.body.nights.length, 3);

            const first = response.body.nights[0];
            assert.equal(first.date, '2028-01-01');
            assert.equal(first.totalUnits, 4);
            assert.equal(first.blockedUnits, 1);
            // Derived, never stored: a fifth number could disagree with the four.
            assert.equal(first.availableUnits, 3);
            assert.equal(first.rates.length, 1);
            assert.equal(first.rates[0].netCents, 9_900);
        });

        it('shows a priced night that has no inventory, rather than hiding it', async () => {
            const room = await freshRoom();
            const plan = await prisma.ratePlan.create({
                data: {
                    roomTypeId: room.id,
                    code: 'orphan',
                    name: 'Priced but unstocked',
                    mealPlanId: (await prisma.mealPlan.findUnique({ where: { code: 'RO' } })).id,
                    cancellationPolicyId: (
                        await prisma.cancellationPolicy.findFirst({ where: { hotelId: null } })
                    ).id,
                    paymentPolicyId: (await prisma.paymentPolicy.findFirst({ where: { hotelId: null } })).id,
                    currency: 'GEL'
                }
            });

            await asAdmin(
                'put',
                `/api/admin/hotels/${hotel.id}/room-types/${room.id}/rate-plans/${plan.id}/rates`
            ).send({ from: '2028-02-01', to: '2028-02-02', netCents: 5_000 });

            const response = await asAdmin(
                'get',
                `${inventoryPath(room.id)}/calendar?from=2028-02-01&to=2028-02-02`
            );

            // Exactly the mistake that makes a hotel look bookable in search
            // and then fail at checkout, so the calendar surfaces it.
            assert.equal(response.body.nights.length, 2);
            assert.equal(response.body.nights[0].availableUnits, 0);
            assert.equal(response.body.nights[0].rates.length, 1);
        });
    });

    describe('taxes and fees', () => {
        const taxPath = () => `/api/admin/hotels/${hotel.id}/tax-fees`;

        it('stores a percentage tax included in the rate', async () => {
            const response = await asAdmin('post', taxPath()).send({
                name: 'VAT',
                basis: 'PERCENT',
                value: 1_800,
                includedInRate: true
            });

            assert.equal(response.status, 201);
            assert.equal(response.body.currency, 'GEL', 'inherited from the hotel');
            assert.equal(response.body.includedInRate, true);
        });

        it('stores a per-person resort fee payable at the property', async () => {
            const response = await asAdmin('post', taxPath()).send({
                name: 'Resort fee',
                basis: 'PER_NIGHT_PER_PERSON',
                value: 500,
                includedInRate: false,
                appliesToChildren: false
            });

            assert.equal(response.status, 201);
            assert.equal(response.body.appliesToChildren, false);
        });

        it('refuses a percentage above 100%', async () => {
            const response = await asAdmin('post', taxPath()).send({
                name: 'Absurd',
                basis: 'PERCENT',
                value: 12_000
            });

            assert.equal(response.status, 400);
        });

        it('removes a fee', async () => {
            const created = await asAdmin('post', taxPath()).send({
                name: unique('temp'),
                basis: 'PER_STAY',
                value: 1_000
            });

            assert.equal((await asAdmin('delete', `${taxPath()}/${created.body.id}`)).status, 204);
        });
    });
});
