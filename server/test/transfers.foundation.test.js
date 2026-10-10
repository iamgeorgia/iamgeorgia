import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { disconnect, prisma } from '../db/index.js';
import { primaryRoleIdFor } from '../services/rbac/access.js';
import { errorHandler, sqlStateOf } from '../middleware/errors.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makeAssignment,
    makeDriver,
    makeDriverUser,
    makeFleetVehicle,
    makePartner,
    makePartnerUser,
    makeTransferBooking,
    makeTransferPoint,
    makeTransferProvider,
    makeTransferVehicle,
    signIn,
    testEmail
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

/**
 * Phase 1 of the fleet module: the roles exist, the partner routers name
 * their audience, operations staff read what admins read (minus the money),
 * and the database refuses to double-book a driver or a car.
 */

describe('the users role constraint', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let partner;

    before(async () => {
        partner = await makePartner(tracker);
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const attempt = async ({ role, ...data }) =>
        prisma.user.create({
            data: { email: testEmail('role'), firstName: 'Role', lastName: 'Check', primaryRoleId: await primaryRoleIdFor(prisma, role), ...data }
        });

    it('lets a driver and a dispatcher exist only on the platform side', async () => {
        tracker.user(await attempt({ role: 'DRIVER' }));
        tracker.user(await attempt({ role: 'DISPATCHER' }));

        await assert.rejects(attempt({ role: 'DRIVER', partnerId: partner.id }));
        await assert.rejects(attempt({ role: 'DISPATCHER', partnerId: partner.id }));
    });

    it('keeps the desk roles on the platform side too', async () => {
        for (const role of ['MANAGEMENT', 'TOUR_OPERATOR', 'ACCOUNTANT']) {
            tracker.user(await attempt({ role }));
            await assert.rejects(attempt({ role, partnerId: partner.id }), role);
        }
    });

    it('still requires a company for every partner role', async () => {
        await assert.rejects(attempt({ role: 'PARTNER_AGENT' }));
        tracker.user(await attempt({ role: 'PARTNER_AGENT', partnerId: partner.id }));
    });
});

describe('who reaches what', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let adminCookie;
    let dispatcherCookie;
    let partnerCookie;
    let driverCookie;
    let unlinkedDriverCookie;
    let driver;
    let partner;
    let ownBooking;
    let platformBooking;

    before(async () => {
        const admin = await makeAdmin(tracker);
        const dispatcher = await makeAdmin(tracker, { role: 'DISPATCHER' });
        partner = await makePartner(tracker);
        const partnerUser = await makePartnerUser(tracker, partner);

        const provider = tracker.transferProvider(await makeTransferProvider());
        driver = await makeDriver(tracker, {
            providerId: provider.id,
            licenceNumber: 'GE-LIC-000123',
            dateOfBirth: new Date('1985-03-04'),
            internalNotes: 'Prefers airport runs'
        });
        const driverUser = await makeDriverUser(tracker, driver);

        const unlinked = tracker.user(
            await prisma.user.create({
                data: {
                    email: testEmail('driver-unlinked'),
                    firstName: 'No',
                    lastName: 'Profile',
                    primaryRoleId: await primaryRoleIdFor(prisma, 'DRIVER'),
                    passwordHash: (await prisma.user.findUnique({ where: { id: driverUser.id } })).passwordHash
                }
            })
        );

        const vehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        const from = tracker.transferPoint(await makeTransferPoint());
        const to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));

        ownBooking = await makeTransferBooking(tracker, { vehicleId: vehicle.id, from, to, partnerId: partner.id });
        platformBooking = await makeTransferBooking(tracker, { vehicleId: vehicle.id, from, to });

        adminCookie = (await signIn(app, admin.email)).cookie;
        dispatcherCookie = (await signIn(app, dispatcher.email)).cookie;
        partnerCookie = (await signIn(app, partnerUser.email)).cookie;
        driverCookie = (await signIn(app, driverUser.email)).cookie;
        unlinkedDriverCookie = (await signIn(app, unlinked.email)).cookie;
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('keeps a driver out of the partner portal and the admin panel', async () => {
        for (const path of [
            '/api/partner/me',
            '/api/partner/transfers/bookings',
            '/api/partner/bookings',
            '/api/partner/hotels',
            '/api/admin/transfers/bookings',
            '/api/admin/transfers/vehicles',
            '/api/admin/partners'
        ]) {
            const res = await request(app).get(path).set('Cookie', driverCookie);
            assert.equal(res.status, 403, `${path} answered ${res.status}`);
        }
    });

    it('lets a dispatcher read bookings and the catalogue, but not change the catalogue or see the partners', async () => {
        const list = await request(app)
            .get('/api/admin/transfers/bookings')
            .set('Cookie', dispatcherCookie)
            .query({ search: ownBooking.reference });
        assert.equal(list.status, 200);
        assert.ok(list.body.data.some((row) => row.reference === ownBooking.reference));

        // Reading the catalogue is part of running the fleet; changing it is not.
        const vehicles = await request(app).get('/api/admin/transfers/vehicles').set('Cookie', dispatcherCookie);
        assert.equal(vehicles.status, 200);

        const newVehicle = await request(app).post('/api/admin/transfers/vehicles').set('Cookie', dispatcherCookie).send({});
        assert.equal(newVehicle.status, 403);
        assert.deepEqual(newVehicle.body.error.details.required, ['catalogue.write']);

        const partners = await request(app).get('/api/admin/partners').set('Cookie', dispatcherCookie);
        assert.equal(partners.status, 403);
    });

    it('lets a dispatcher read a booking but neither cancel nor amend it', async () => {
        const cancel = await request(app)
            .post(`/api/admin/transfers/bookings/${platformBooking.reference}/cancel`)
            .set('Cookie', dispatcherCookie)
            .send({ reason: 'test' });
        assert.equal(cancel.status, 403);

        // The public door refuses a staff session with no booking capability
        // before any service runs; the service beneath answers it as a
        // stranger (404) should anything ever reach it.
        const publicCancel = await request(app)
            .post(`/api/transfers/bookings/${platformBooking.reference}/cancel`)
            .set('Cookie', dispatcherCookie)
            .send({ reason: 'test' });
        assert.equal(publicCancel.status, 403);
        assert.equal(publicCancel.body.error.details.reason, 'INSUFFICIENT_CAPABILITY');

        const amend = await request(app)
            .patch(`/api/transfers/bookings/${platformBooking.reference}`)
            .set('Cookie', dispatcherCookie)
            .send({ specialRequests: 'changed by a dispatcher' });
        assert.equal(amend.status, 403);

        const after = await prisma.transferBooking.findUnique({ where: { id: platformBooking.id } });
        assert.equal(after.status, platformBooking.status);
        assert.notEqual(after.specialRequests, 'changed by a dispatcher');

        const read = await request(app)
            .get(`/api/admin/transfers/bookings/${platformBooking.reference}`)
            .set('Cookie', dispatcherCookie);
        assert.equal(read.status, 200);
    });

    it('withholds the money from a dispatcher that an admin sees', async () => {
        const asDispatcher = await request(app)
            .get(`/api/admin/transfers/bookings/${platformBooking.reference}`)
            .set('Cookie', dispatcherCookie);
        assert.equal(asDispatcher.status, 200);
        assert.equal(asDispatcher.body.reference, platformBooking.reference);
        assert.equal('netTotalCents' in asDispatcher.body, false);
        assert.equal('marginCents' in asDispatcher.body, false);
        assert.equal(asDispatcher.body.totalCents, 20000);

        const asAdmin = await request(app)
            .get(`/api/admin/transfers/bookings/${platformBooking.reference}`)
            .set('Cookie', adminCookie);
        assert.equal(asAdmin.status, 200);
        assert.equal(asAdmin.body.netTotalCents, 17000);
    });

    it('still gives a partner its own transfer bookings and nobody else\'s', async () => {
        const res = await request(app).get('/api/partner/transfers/bookings').set('Cookie', partnerCookie);
        assert.equal(res.status, 200);
        assert.ok(res.body.data.some((row) => row.reference === ownBooking.reference));
        assert.equal(
            res.body.data.some((row) => row.reference === platformBooking.reference),
            false
        );
    });

    it('answers /me with the driver profile, without the private half', async () => {
        const res = await request(app).get('/api/auth/me').set('Cookie', driverCookie);
        assert.equal(res.status, 200);
        assert.equal(res.body.user.role, 'DRIVER');
        assert.equal(res.body.partner, null);
        assert.equal(res.body.driver.id, driver.id);
        assert.equal(res.body.driver.phone, driver.phone);
        assert.equal(res.body.driver.verified, true);
        assert.equal(res.body.driver.verificationStatus, 'VERIFIED');
        assert.deepEqual(res.body.driver.vehicles, []);

        for (const key of ['licenceNumber', 'dateOfBirth', 'internalNotes', 'user', 'documents']) {
            assert.equal(key in res.body.driver, false, `${key} leaked into the driver's own view`);
        }
    });

    it('answers /me with a null driver for an account that has no profile yet, and for an admin', async () => {
        const unlinked = await request(app).get('/api/auth/me').set('Cookie', unlinkedDriverCookie);
        assert.equal(unlinked.status, 200);
        assert.equal(unlinked.body.driver, null);

        const admin = await request(app).get('/api/auth/me').set('Cookie', adminCookie);
        assert.equal(admin.body.driver, null);
        assert.equal('driver' in admin.body, true);
    });
});

describe('the no-double-booking constraints', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let driverA;
    let driverB;
    let car;
    let legs;

    const at = (hour, minute = 0) => new Date(Date.UTC(2030, 5, 1, hour, minute));

    before(async () => {
        const provider = tracker.transferProvider(await makeTransferProvider());
        const vehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        const from = tracker.transferPoint(await makeTransferPoint());
        const to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));

        driverA = await makeDriver(tracker, { providerId: provider.id });
        driverB = await makeDriver(tracker, { providerId: provider.id, firstName: 'Nika' });
        car = await makeFleetVehicle(tracker, { providerId: provider.id, vehicleClassId: vehicle.id });

        legs = [];
        for (let index = 0; index < 5; index += 1) {
            const booking = await makeTransferBooking(tracker, { vehicleId: vehicle.id, from, to, pickupAt: at(10 + index) });
            legs.push(booking.legs[0]);
        }
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('refuses a second live assignment for the same driver in an overlapping window', async () => {
        await makeAssignment(legs[0], { driverId: driverA.id, windowStart: at(10), windowEnd: at(12) });

        await assert.rejects(
            makeAssignment(legs[1], { driverId: driverA.id, windowStart: at(11), windowEnd: at(13) }),
            (err) => sqlStateOf(err) === '23P01'
        );
    });

    it('lets the same driver take a job that starts exactly when the last one ends', async () => {
        const next = await makeAssignment(legs[1], { driverId: driverA.id, windowStart: at(12), windowEnd: at(13) });
        assert.equal(next.status, 'OFFERED');
    });

    it('stops counting an assignment once it is declined, revoked or finished', async () => {
        const offered = await makeAssignment(legs[2], { driverId: driverB.id, windowStart: at(14), windowEnd: at(16) });

        await assert.rejects(
            makeAssignment(legs[3], { driverId: driverB.id, windowStart: at(15), windowEnd: at(17) }),
            (err) => sqlStateOf(err) === '23P01'
        );

        await prisma.transferAssignment.update({
            where: { id: offered.id },
            data: { status: 'DECLINED', declinedAt: new Date() }
        });

        const replacement = await makeAssignment(legs[3], { driverId: driverB.id, windowStart: at(15), windowEnd: at(17) });
        assert.equal(replacement.status, 'OFFERED');
    });

    it('refuses the same car under two drivers at once, and allows no car at all', async () => {
        // Leg 4 is free; leg 1 is driver A's 12:00-13:00 job. Give driver B
        // the car for 12:30-14:00 on leg 4 first...
        await makeAssignment(legs[4], {
            driverId: driverB.id,
            fleetVehicleId: car.id,
            windowStart: at(12, 30),
            windowEnd: at(14)
        });

        // ...then try to put driver A's overlapping job in the same car. The
        // driver is free (A holds 12:00-13:00 on leg 1 only), the car is not.
        await prisma.transferAssignment.updateMany({
            where: { legId: legs[1].id, status: 'OFFERED' },
            data: { status: 'REVOKED', revokedAt: new Date() }
        });

        await assert.rejects(
            makeAssignment(legs[1], {
                driverId: driverA.id,
                fleetVehicleId: car.id,
                windowStart: at(12),
                windowEnd: at(13)
            }),
            (err) => sqlStateOf(err) === '23P01'
        );

        // Two driver-only assignments in the same window never conflict on the
        // (null) car: NULL is not equal to NULL.
        const withoutCar = await makeAssignment(legs[1], { driverId: driverA.id, windowStart: at(12), windowEnd: at(13) });
        assert.equal(withoutCar.fleetVehicleId, null);
    });

    it('allows one live offer per leg', async () => {
        // Leg 0 already holds driver A's OFFERED assignment.
        await assert.rejects(
            makeAssignment(legs[0], { driverId: driverB.id, windowStart: at(20), windowEnd: at(21) }),
            (err) => sqlStateOf(err) === '23505' || err.code === 'P2002'
        );
    });

    it('reads an exclusion violation as a 409, not an internal error', async () => {
        let caught;

        try {
            await makeAssignment(legs[2], { driverId: driverA.id, windowStart: at(10, 30), windowEnd: at(11) });
        } catch (err) {
            caught = err;
        }

        assert.ok(caught, 'expected the overlapping insert to fail');

        let status;
        let body;
        const res = {
            status(code) {
                status = code;
                return this;
            },
            json(payload) {
                body = payload;
            }
        };

        errorHandler(caught, { log: { error() {}, warn() {} } }, res, () => {});

        assert.equal(status, 409);
        assert.match(body.error.message, /already scheduled/);
    });
});
