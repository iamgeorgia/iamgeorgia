import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';

import { createApp } from '../app.js';
import { disconnect, prisma } from '../db/index.js';
import { clearOutbox, outbox } from '../lib/mailer/index.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makeAssignment,
    makeDriver,
    makeDriverUser,
    makeFleetVehicle,
    makeTransferBooking,
    makeTransferPoint,
    makeTransferProvider,
    makeTransferVehicle,
    signIn,
    testEmail,
    TEST_PASSWORD,
    unique
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const pngBuffer = (width = 640, height = 480) =>
    sharp({ create: { width, height, channels: 3, background: { r: 30, g: 80, b: 200 } } })
        .png()
        .toBuffer();

const pdfBuffer = () =>
    Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

/**
 * Phase 2 of the fleet module: cars and drivers, their photographs and their
 * private documents, and the login a driver signs in with.
 */
describe('the fleet and its drivers', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let adminCookie;
    let dispatcherCookie;
    let provider;
    let vehicleClass;
    let from;
    let to;

    const upload = async (cookie, category, buffer, filename, contentType) => {
        const res = await request(app)
            .post('/api/admin/media')
            .set('Cookie', cookie)
            .field('category', category)
            .attach('file', buffer, { filename, contentType });

        if (res.status === 201) {
            tracker.file(res.body);
        }

        return res;
    };

    before(async () => {
        const admin = await makeAdmin(tracker);
        const dispatcher = await makeAdmin(tracker, { role: 'DISPATCHER' });
        provider = tracker.transferProvider(await makeTransferProvider());
        vehicleClass = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        from = tracker.transferPoint(await makeTransferPoint());
        to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));

        adminCookie = (await signIn(app, admin.email)).cookie;
        dispatcherCookie = (await signIn(app, dispatcher.email)).cookie;
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const carBody = (overrides = {}) => ({
        providerId: provider.id,
        vehicleClassId: vehicleClass.id,
        make: 'Toyota',
        model: 'Alphard',
        year: 2021,
        colour: 'Silver',
        body: 'minivan',
        plateNumber: unique('tb').slice(0, 12),
        passengerCapacity: 6,
        luggageCapacity: 5,
        features: ['airConditioning', 'wheelchairAccessible'],
        status: 'ACTIVE',
        ...overrides
    });

    describe('cars', () => {
        it('lets a dispatcher add a car, and refuses the same plate spelt differently', async () => {
            const plate = `TB ${unique('x').slice(-6).toUpperCase()} AB`;
            const created = await request(app)
                .post('/api/admin/transfers/fleet')
                .set('Cookie', dispatcherCookie)
                .send(carBody({ plateNumber: plate.toLowerCase() }));

            assert.equal(created.status, 201, JSON.stringify(created.body));
            tracker.transferFleetVehicle(created.body);
            assert.equal(created.body.plateNumber, plate.toLowerCase());
            assert.equal(created.body.status, 'ACTIVE');
            assert.deepEqual(created.body.features, ['airConditioning', 'wheelchairAccessible']);
            assert.equal(created.body.vehicleClass.id, vehicleClass.id);

            const duplicate = await request(app)
                .post('/api/admin/transfers/fleet')
                .set('Cookie', dispatcherCookie)
                .send(carBody({ plateNumber: plate.replaceAll(' ', '-') }));

            assert.equal(duplicate.status, 409);
            assert.equal(duplicate.body.error.details.field, 'plateNumber');

            const found = await request(app)
                .get('/api/admin/transfers/fleet')
                .set('Cookie', dispatcherCookie)
                .query({ search: plate.replaceAll(' ', '').slice(0, 6) });

            assert.equal(found.status, 200);
            assert.ok(found.body.data.some((row) => row.id === created.body.id));
        });

        it('rejects a car with no seats, and a status change to ARCHIVED by edit', async () => {
            const noSeats = await request(app)
                .post('/api/admin/transfers/fleet')
                .set('Cookie', adminCookie)
                .send(carBody({ passengerCapacity: 0 }));
            assert.equal(noSeats.status, 400);

            const car = await makeFleetVehicle(tracker, { providerId: provider.id, vehicleClassId: vehicleClass.id });
            const archived = await request(app)
                .patch(`/api/admin/transfers/fleet/${car.id}`)
                .set('Cookie', adminCookie)
                .send({ status: 'ARCHIVED' });
            assert.equal(archived.status, 400);
            assert.equal(archived.body.error.details.field, 'status');

            const notes = await request(app)
                .patch(`/api/admin/transfers/fleet/${car.id}`)
                .set('Cookie', dispatcherCookie)
                .send({ internalNotes: 'Winter tyres from November' });
            assert.equal(notes.status, 200);
            assert.equal(notes.body.internalNotes, 'Winter tyres from November');
        });

        it('keeps a gallery whose cover is the main image', async () => {
            const car = await makeFleetVehicle(tracker, { providerId: provider.id, vehicleClassId: vehicleClass.id });

            const first = await upload(dispatcherCookie, 'FLEET_IMAGE', await pngBuffer(), 'front.png', 'image/png');
            assert.equal(first.status, 201, JSON.stringify(first.body));
            const second = await upload(dispatcherCookie, 'FLEET_IMAGE', await pngBuffer(400, 300), 'side.png', 'image/png');
            assert.equal(second.status, 201);

            const attachFirst = await request(app)
                .post(`/api/admin/transfers/fleet/${car.id}/images`)
                .set('Cookie', dispatcherCookie)
                .send({ fileAssetId: first.body.id, caption: 'Front' });
            assert.equal(attachFirst.status, 201, JSON.stringify(attachFirst.body));
            assert.equal(attachFirst.body.isCover, true);

            const attachSecond = await request(app)
                .post(`/api/admin/transfers/fleet/${car.id}/images`)
                .set('Cookie', dispatcherCookie)
                .send({ fileAssetId: second.body.id });
            assert.equal(attachSecond.body.isCover, false);

            let detail = await request(app).get(`/api/admin/transfers/fleet/${car.id}`).set('Cookie', adminCookie);
            assert.equal(detail.body.mainImage.id, first.body.id);
            assert.equal(detail.body.images.length, 2);

            const removed = await request(app)
                .delete(`/api/admin/transfers/fleet/${car.id}/images/${attachFirst.body.imageId}`)
                .set('Cookie', dispatcherCookie);
            assert.equal(removed.status, 204);

            detail = await request(app).get(`/api/admin/transfers/fleet/${car.id}`).set('Cookie', adminCookie);
            assert.equal(detail.body.images.length, 1);
            assert.equal(detail.body.images[0].isCover, true);
            assert.equal(detail.body.mainImage.id, second.body.id);
        });

        it('lets a dispatcher upload fleet files only', async () => {
            const hotel = await upload(dispatcherCookie, 'HOTEL_IMAGE', await pngBuffer(), 'lobby.png', 'image/png');
            assert.equal(hotel.status, 403);

            const contract = await upload(adminCookie, 'CONTRACT', pdfBuffer(), 'contract.pdf', 'application/pdf');
            assert.equal(contract.status, 201);

            const probe = await request(app).get(`/api/admin/media/${contract.body.id}`).set('Cookie', dispatcherCookie);
            assert.equal(probe.status, 404);

            const link = await request(app)
                .get(`/api/admin/media/${contract.body.id}/url`)
                .set('Cookie', dispatcherCookie);
            assert.equal(link.status, 404);

            const listing = await request(app)
                .get('/api/admin/media')
                .set('Cookie', dispatcherCookie)
                .query({ category: 'CONTRACT' });
            assert.equal(listing.status, 403);
        });

        it('files insurance as a private document reachable only by an audited link', async () => {
            const car = await makeFleetVehicle(tracker, { providerId: provider.id, vehicleClassId: vehicleClass.id });

            const scan = await upload(dispatcherCookie, 'VEHICLE_DOCUMENT', pdfBuffer(), 'insurance.pdf', 'application/pdf');
            assert.equal(scan.status, 201, JSON.stringify(scan.body));
            assert.equal('url' in scan.body, false);

            const attached = await request(app)
                .post(`/api/admin/transfers/fleet/${car.id}/documents`)
                .set('Cookie', dispatcherCookie)
                .send({ fileAssetId: scan.body.id, docType: 'INSURANCE', validUntil: '2027-03-31' });
            assert.equal(attached.status, 201, JSON.stringify(attached.body));
            assert.equal(attached.body.validUntil, '2027-03-31');
            assert.equal('url' in attached.body, false);

            const photo = await upload(dispatcherCookie, 'FLEET_IMAGE', await pngBuffer(), 'not-a-doc.png', 'image/png');
            const wrong = await request(app)
                .post(`/api/admin/transfers/fleet/${car.id}/documents`)
                .set('Cookie', dispatcherCookie)
                .send({ fileAssetId: photo.body.id, docType: 'OTHER' });
            assert.equal(wrong.status, 400);

            const link = await request(app)
                .get(`/api/admin/transfers/fleet/${car.id}/documents/${attached.body.id}/url`)
                .set('Cookie', dispatcherCookie);
            assert.equal(link.status, 200);
            assert.match(link.body.url, /media\/private/);

            const audited = await prisma.auditLog.findFirst({
                where: { action: 'PRIVATE_FILE_ACCESSED', entityId: scan.body.id }
            });
            assert.ok(audited, 'reading a document is recorded');

            const detail = await request(app).get(`/api/admin/transfers/fleet/${car.id}`).set('Cookie', adminCookie);
            assert.equal(detail.body.documents.length, 1);
            assert.equal(detail.body.documents[0].docType, 'INSURANCE');
        });

        it('refuses to archive a car with a job ahead of it', async () => {
            const car = await makeFleetVehicle(tracker, { providerId: provider.id, vehicleClassId: vehicleClass.id });
            const driver = await makeDriver(tracker, { providerId: provider.id });
            const booking = await makeTransferBooking(tracker, { vehicleId: vehicleClass.id, from, to });
            const pickupAt = booking.legs[0].pickupAt;
            const assignment = await makeAssignment(booking.legs[0], {
                driverId: driver.id,
                fleetVehicleId: car.id,
                windowStart: new Date(pickupAt.getTime() - 45 * 60_000),
                windowEnd: new Date(pickupAt.getTime() + 120 * 60_000)
            });

            const refused = await request(app)
                .post(`/api/admin/transfers/fleet/${car.id}/archive`)
                .set('Cookie', dispatcherCookie);
            assert.equal(refused.status, 409);
            assert.equal(refused.body.error.details.reason, 'ACTIVE_ASSIGNMENTS');
            assert.equal(refused.body.error.details.assignments[0].bookingReference, booking.reference);

            await prisma.transferAssignment.update({
                where: { id: assignment.id },
                data: { status: 'REVOKED', revokedAt: new Date() }
            });

            const archived = await request(app)
                .post(`/api/admin/transfers/fleet/${car.id}/archive`)
                .set('Cookie', dispatcherCookie);
            assert.equal(archived.status, 200);
            assert.equal(archived.body.status, 'ARCHIVED');

            // The plate is free again for its replacement.
            const replacement = await request(app)
                .post('/api/admin/transfers/fleet')
                .set('Cookie', adminCookie)
                .send(carBody({ plateNumber: car.plateNumber }));
            assert.equal(replacement.status, 201);
            tracker.transferFleetVehicle(replacement.body);

            // ...and the archived one cannot come back while it is taken.
            const revived = await request(app)
                .post(`/api/admin/transfers/fleet/${car.id}/activate`)
                .set('Cookie', adminCookie);
            assert.equal(revived.status, 409);
        });
    });

    describe('drivers', () => {
        it('creates a profile whose private half only operations see', async () => {
            const created = await request(app)
                .post('/api/admin/transfers/drivers')
                .set('Cookie', dispatcherCookie)
                .send({
                    providerId: provider.id,
                    firstName: 'Tamar',
                    lastName: 'Kvaratskhelia',
                    phone: '+995 555 12 34 56',
                    languages: ['ka', 'en', 'ru'],
                    yearsExperience: 12,
                    licenceNumber: 'GE-DL-77',
                    licenceExpiresOn: '2029-05-01',
                    dateOfBirth: '1984-11-20'
                });

            assert.equal(created.status, 201, JSON.stringify(created.body));
            tracker.transferDriver(created.body);
            assert.equal(created.body.phone, '+995555123456');
            assert.equal(created.body.licenceNumber, 'GE-DL-77');
            assert.equal(created.body.verificationStatus, 'UNVERIFIED');
            assert.equal(created.body.verified, false);
            assert.equal(created.body.user, null);
            assert.deepEqual(created.body.documents, []);

            const bad = await request(app)
                .post('/api/admin/transfers/drivers')
                .set('Cookie', dispatcherCookie)
                .send({ providerId: provider.id, firstName: 'X', lastName: 'Y', phone: '123', languages: ['klingon'] });
            assert.equal(bad.status, 400);
        });

        it('records who verified a driver and forgets it when the status moves back', async () => {
            const driver = await makeDriver(tracker, {
                providerId: provider.id,
                verificationStatus: 'PENDING',
                verifiedAt: null
            });

            const verified = await request(app)
                .post(`/api/admin/transfers/drivers/${driver.id}/verify`)
                .set('Cookie', adminCookie)
                .send({ status: 'VERIFIED', note: 'Licence and ID checked in person' });
            assert.equal(verified.status, 200, JSON.stringify(verified.body));
            assert.equal(verified.body.verified, true);
            assert.ok(verified.body.verifiedAt);
            assert.ok(verified.body.verifiedBy?.email);

            const pending = await request(app)
                .post(`/api/admin/transfers/drivers/${driver.id}/verify`)
                .set('Cookie', adminCookie)
                .send({ status: 'PENDING' });
            assert.equal(pending.body.verifiedAt, null);
            assert.equal(pending.body.verifiedBy, null);
        });

        it('links the cars a driver usually takes, with at most one primary', async () => {
            const driver = await makeDriver(tracker, { providerId: provider.id });
            const carA = await makeFleetVehicle(tracker, { providerId: provider.id, vehicleClassId: vehicleClass.id });
            const carB = await makeFleetVehicle(tracker, { providerId: provider.id, vehicleClassId: vehicleClass.id });

            const linked = await request(app)
                .put(`/api/admin/transfers/drivers/${driver.id}/vehicles`)
                .set('Cookie', dispatcherCookie)
                .send({ vehicles: [{ fleetVehicleId: carA.id, isPrimary: true }, { fleetVehicleId: carB.id }] });
            assert.equal(linked.status, 200, JSON.stringify(linked.body));
            assert.equal(linked.body.vehicles.length, 2);
            assert.equal(linked.body.vehicles[0].id, carA.id);
            assert.equal(linked.body.vehicles[0].isPrimary, true);

            const twoPrimaries = await request(app)
                .put(`/api/admin/transfers/drivers/${driver.id}/vehicles`)
                .set('Cookie', dispatcherCookie)
                .send({ vehicles: [{ fleetVehicleId: carA.id, isPrimary: true }, { fleetVehicleId: carB.id, isPrimary: true }] });
            assert.equal(twoPrimaries.status, 400);

            const carDetail = await request(app).get(`/api/admin/transfers/fleet/${carA.id}`).set('Cookie', adminCookie);
            assert.equal(carDetail.body.drivers[0].id, driver.id);
            assert.equal(carDetail.body.drivers[0].isPrimary, true);
        });

        it('creates a login, emails the activation link, and signs the driver in on activation', async () => {
            clearOutbox();
            const driver = await makeDriver(tracker, { providerId: provider.id, firstName: 'Giorgi' });
            const email = testEmail('driver-login');

            const created = await request(app)
                .post(`/api/admin/transfers/drivers/${driver.id}/account`)
                .set('Cookie', dispatcherCookie)
                .send({ email });
            assert.equal(created.status, 201, JSON.stringify(created.body));
            assert.equal(created.body.driver.user.email, email);
            assert.equal(created.body.driver.user.isPending, true);
            assert.equal(created.body.driver.user.role, 'DRIVER');
            tracker.user({ id: (await prisma.user.findUnique({ where: { email } })).id });

            const mail = outbox.find((entry) => entry.to === email && entry.template === 'driverAccountActivation');
            assert.ok(mail, 'the activation email was sent');
            // The admin gets the same link back, to copy if the email never lands.
            assert.equal(created.body.link.kind, 'activation');
            assert.equal(created.body.link.url, mail.data.url);
            assert.equal(created.body.email, email);
            assert.equal(created.body.emailSent, true);
            assert.match(mail.data.url, /\/activate\//);

            const again = await request(app)
                .post(`/api/admin/transfers/drivers/${driver.id}/account`)
                .set('Cookie', dispatcherCookie)
                .send({ email: testEmail('other') });
            assert.equal(again.status, 409);

            const resent = await request(app)
                .post(`/api/admin/transfers/drivers/${driver.id}/account/resend`)
                .set('Cookie', dispatcherCookie);
            assert.equal(resent.status, 200);
            const second = outbox.filter((entry) => entry.to === email);
            assert.equal(second.length, 2);
            assert.equal(resent.body.link.url, second[1].data.url);
            assert.notEqual(resent.body.link.url, created.body.link.url);

            const token = second[1].data.url.split('/activate/')[1];
            const activated = await request(app)
                .post(`/api/auth/activation/${token}`)
                .send({ password: TEST_PASSWORD });
            assert.equal(activated.status, 200, JSON.stringify(activated.body));
            assert.equal(activated.body.driver?.id, driver.id);

            const me = await request(app).get('/api/auth/me').set('Cookie', activated.headers['set-cookie']);
            assert.equal(me.status, 200);
            assert.equal(me.body.driver.firstName, 'Giorgi');
            assert.equal('licenceNumber' in me.body.driver, false);

            const resendActive = await request(app)
                .post(`/api/admin/transfers/drivers/${driver.id}/account/resend`)
                .set('Cookie', dispatcherCookie);
            assert.equal(resendActive.status, 409);
        });

        it('refuses to deactivate a driver with a job ahead, then forces it and ends the session', async () => {
            const driver = await makeDriver(tracker, { providerId: provider.id });
            const email = testEmail('driver-out');
            const created = await request(app)
                .post(`/api/admin/transfers/drivers/${driver.id}/account`)
                .set('Cookie', adminCookie)
                .send({ email });
            assert.equal(created.status, 201);
            const user = await prisma.user.findUnique({ where: { email } });
            tracker.user(user);
            const { passwordHash } = await prisma.user.findFirst({ where: { primaryRole: { key: 'ADMIN' }, passwordHash: { not: null } } });
            await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
            const driverCookie = (await signIn(app, email)).cookie;
            assert.equal((await request(app).get('/api/auth/me').set('Cookie', driverCookie)).status, 200);

            const booking = await makeTransferBooking(tracker, { vehicleId: vehicleClass.id, from, to });
            const pickupAt = booking.legs[0].pickupAt;
            await prisma.transferBookingLeg.update({ where: { id: booking.legs[0].id }, data: { status: 'ACCEPTED' } });
            const assignment = await makeAssignment(booking.legs[0], {
                driverId: driver.id,
                status: 'ACCEPTED',
                acceptedAt: new Date(),
                windowStart: new Date(pickupAt.getTime() - 45 * 60_000),
                windowEnd: new Date(pickupAt.getTime() + 120 * 60_000)
            });

            const refused = await request(app)
                .post(`/api/admin/transfers/drivers/${driver.id}/deactivate`)
                .set('Cookie', dispatcherCookie)
                .send({ reason: 'Left the company' });
            assert.equal(refused.status, 409);
            assert.equal(refused.body.error.details.reason, 'ACTIVE_ASSIGNMENTS');

            const forced = await request(app)
                .post(`/api/admin/transfers/drivers/${driver.id}/deactivate`)
                .set('Cookie', dispatcherCookie)
                .send({ reason: 'Left the company', force: true });
            assert.equal(forced.status, 200, JSON.stringify(forced.body));
            assert.equal(forced.body.isActive, false);
            assert.equal(forced.body.deactivationReason, 'Left the company');

            const revoked = await prisma.transferAssignment.findUnique({ where: { id: assignment.id } });
            assert.equal(revoked.status, 'REVOKED');
            assert.equal(revoked.revokeReason, 'DRIVER_DEACTIVATED');
            const leg = await prisma.transferBookingLeg.findUnique({ where: { id: booking.legs[0].id } });
            assert.equal(leg.status, 'UNASSIGNED');

            const afterwards = await request(app).get('/api/auth/me').set('Cookie', driverCookie);
            assert.equal(afterwards.status, 401);
            assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).isActive, false);

            const back = await request(app)
                .post(`/api/admin/transfers/drivers/${driver.id}/activate`)
                .set('Cookie', adminCookie);
            assert.equal(back.status, 200);
            assert.equal(back.body.isActive, true);
            assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).isActive, true);
        });

        it('keeps a licence scan on file for operations and out of the driver\'s own view', async () => {
            const driver = await makeDriver(tracker, { providerId: provider.id });

            const scan = await upload(dispatcherCookie, 'DRIVER_DOCUMENT', pdfBuffer(), 'licence.pdf', 'application/pdf');
            assert.equal(scan.status, 201);

            const attached = await request(app)
                .post(`/api/admin/transfers/drivers/${driver.id}/documents`)
                .set('Cookie', dispatcherCookie)
                .send({ fileAssetId: scan.body.id, docType: 'DRIVING_LICENCE', label: 'Category B' });
            assert.equal(attached.status, 201, JSON.stringify(attached.body));

            const photo = await upload(dispatcherCookie, 'DRIVER_PHOTO', await pngBuffer(300, 300), 'tamar.png', 'image/png');
            assert.equal(photo.status, 201);
            const withPhoto = await request(app)
                .patch(`/api/admin/transfers/drivers/${driver.id}`)
                .set('Cookie', dispatcherCookie)
                .send({ photoFileAssetId: photo.body.id });
            assert.equal(withPhoto.status, 200, JSON.stringify(withPhoto.body));
            assert.equal(withPhoto.body.photo.id, photo.body.id);
            assert.equal(withPhoto.body.documents.length, 1);
            assert.equal(withPhoto.body.documents[0].label, 'Category B');

            const asDocument = await request(app)
                .patch(`/api/admin/transfers/drivers/${driver.id}`)
                .set('Cookie', dispatcherCookie)
                .send({ photoFileAssetId: scan.body.id });
            assert.equal(asDocument.status, 400);

            const detached = await request(app)
                .delete(`/api/admin/transfers/drivers/${driver.id}/documents/${attached.body.id}`)
                .set('Cookie', dispatcherCookie);
            assert.equal(detached.status, 204);
        });
    });

    describe('deleting', () => {
        it('lets an admin, and only an admin, delete a car that has never been on a job', async () => {
            const car = await makeFleetVehicle(tracker, { providerId: provider.id, vehicleClassId: vehicleClass.id });
            const photo = await upload(adminCookie, 'FLEET_IMAGE', await pngBuffer(), 'gone.png', 'image/png');
            assert.equal(photo.status, 201);
            const attached = await request(app)
                .post(`/api/admin/transfers/fleet/${car.id}/images`)
                .set('Cookie', adminCookie)
                .send({ fileAssetId: photo.body.id });
            assert.equal(attached.status, 201);

            const asDispatcher = await request(app).delete(`/api/admin/transfers/fleet/${car.id}`).set('Cookie', dispatcherCookie);
            assert.equal(asDispatcher.status, 403);

            const deleted = await request(app).delete(`/api/admin/transfers/fleet/${car.id}`).set('Cookie', adminCookie);
            assert.equal(deleted.status, 204, JSON.stringify(deleted.body));

            const gone = await request(app).get(`/api/admin/transfers/fleet/${car.id}`).set('Cookie', adminCookie);
            assert.equal(gone.status, 404);
            assert.equal(await prisma.fileAsset.count({ where: { id: photo.body.id } }), 0, 'a photograph nothing else used goes too');

            const audit = await prisma.auditLog.findFirst({ where: { action: 'TRANSFER_FLEET_VEHICLE_DELETED', entityId: car.id } });
            assert.ok(audit, 'the deletion is on the record');
            assert.equal(audit.metadata.plateNumber, car.plateNumber);
        });

        it('refuses to delete a car or a driver that has ever been on a job', async () => {
            const car = await makeFleetVehicle(tracker, { providerId: provider.id, vehicleClassId: vehicleClass.id });
            const driver = await makeDriver(tracker, { providerId: provider.id, firstName: 'Giorgi' });
            const pickupAt = new Date(Date.now() - 30 * 86_400_000);
            const booking = await makeTransferBooking(tracker, { vehicleId: vehicleClass.id, from, to, pickupAt });
            await makeAssignment(booking.legs[0], {
                driverId: driver.id,
                fleetVehicleId: car.id,
                windowStart: new Date(pickupAt.getTime() - 45 * 60_000),
                windowEnd: new Date(pickupAt.getTime() + 120 * 60_000),
                status: 'COMPLETED'
            });

            const carRes = await request(app).delete(`/api/admin/transfers/fleet/${car.id}`).set('Cookie', adminCookie);
            assert.equal(carRes.status, 409);
            assert.equal(carRes.body.error.details.reason, 'HAS_ASSIGNMENTS');
            assert.equal(carRes.body.error.details.assignments, 1);

            const driverRes = await request(app).delete(`/api/admin/transfers/drivers/${driver.id}`).set('Cookie', adminCookie);
            assert.equal(driverRes.status, 409);
            assert.equal(driverRes.body.error.details.reason, 'HAS_ASSIGNMENTS');

            assert.equal(await prisma.transferFleetVehicle.count({ where: { id: car.id } }), 1);
            assert.equal(await prisma.transferDriver.count({ where: { id: driver.id } }), 1);
        });

        it('deletes a driver together with their login', async () => {
            const driver = await makeDriver(tracker, { providerId: provider.id, firstName: 'Tamar' });
            const user = await makeDriverUser(tracker, driver);
            const { cookie } = await signIn(app, user.email);

            const asDispatcher = await request(app).delete(`/api/admin/transfers/drivers/${driver.id}`).set('Cookie', dispatcherCookie);
            assert.equal(asDispatcher.status, 403);

            const deleted = await request(app).delete(`/api/admin/transfers/drivers/${driver.id}`).set('Cookie', adminCookie);
            assert.equal(deleted.status, 204, JSON.stringify(deleted.body));

            assert.equal(await prisma.transferDriver.count({ where: { id: driver.id } }), 0);
            assert.equal(await prisma.user.count({ where: { id: user.id } }), 0, 'the login goes with the profile');

            const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
            assert.equal(me.status, 401, 'and its session with it');

            const audit = await prisma.auditLog.findFirst({ where: { action: 'TRANSFER_DRIVER_DELETED', entityId: driver.id } });
            assert.ok(audit);
            assert.equal(audit.metadata.accountRemoved, user.email);
        });
    });
});
