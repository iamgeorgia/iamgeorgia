import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { disconnect, prisma } from '../db/index.js';
import { clearOutbox, failDeliveryTo, outbox } from '../lib/mailer/index.js';
import { sweepCompletedHotelBookings } from '../services/hotel/booking.service.js';
import { processEvent } from '../services/notifications/outbox.service.js';
import {
    createTracker,
    databaseAvailable,
    futureDate,
    makeAdmin,
    makeDestination,
    makeDriver,
    makeDriverUser,
    makePartner,
    makePartnerUser,
    makeService,
    makeTour,
    makeTourOption,
    makeTransferBooking,
    makeTransferPoint,
    makeTransferProvider,
    makeTransferVehicle,
    signIn,
    unique
} from './support/factories.js';
import { makeSellableHotel } from './support/packages.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const CHECK_IN = '2027-08-10';
const CHECK_OUT = '2027-08-12';
const TOUR_DATE = '2027-08-11';

/**
 * Standalone bookings tell the guest and the supplier, through the outbox;
 * a refused email is retried rather than lost; and a stay whose check-out
 * has passed completes.
 *
 * Events are processed here with `processEvent` on the rows this file wrote,
 * never with `drainOutbox`: the runner gives every file its own process and
 * its own in-memory mail outbox, so an event claimed by another file's drain
 * would land its email somewhere these assertions cannot see.
 */
describe('booking notifications', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const manualEvents = [];
    let adminCookie;
    let destination;
    let supplier;

    /** Every outbox row the facades wrote for one booking, in the order they were written. */
    const eventsFor = (entityId) => prisma.outboxEvent.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });

    const processAll = async (entityId) => {
        for (const event of await eventsFor(entityId)) {
            await processEvent(event);
        }
    };

    /** A copy of an event nobody else's drain will claim, so a failure can be watched in this process alone. */
    const manualCopy = async (event) => {
        const copy = await prisma.outboxEvent.create({
            data: {
                topic: event.topic,
                payload: event.payload,
                entityType: event.entityType,
                entityId: event.entityId,
                nextAttemptAt: new Date('2099-01-01T00:00:00.000Z')
            }
        });
        manualEvents.push(copy.id);

        return copy;
    };

    const mailsTo = (address, template) => outbox.filter((entry) => entry.to === address && entry.template === template);

    const lead = (email) => ({ firstName: 'Nino', lastName: 'Beridze', email, phone: '+995322123456' });

    const bookHotel = async (email) => {
        const { hotel } = await makeSellableHotel(app, adminCookie, tracker, {
            destination,
            checkIn: CHECK_IN,
            nights: 2,
            supplierId: supplier.id,
            email: 'desk@rooms.example.test'
        });
        const search = await request(app).get(`/api/search/hotels/${hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`);
        assert.equal(search.status, 200, JSON.stringify(search.body));
        const offer = search.body.roomTypes[0].offers[0];

        const created = await request(app)
            .post('/api/bookings')
            .send({ offerToken: offer.token, leadGuest: lead(email), specialRequests: 'A quiet room, please.' });
        assert.equal(created.status, 201, JSON.stringify(created.body));

        return { hotel, booking: created.body, id: (await prisma.hotelBooking.findUnique({ where: { reference: created.body.reference } })).id };
    };

    before(async () => {
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;
        destination = await makeDestination(tracker);
        supplier = await makePartner(tracker, { email: 'bookings@supplier.example.test' });
    });

    after(async () => {
        if (manualEvents.length > 0) {
            await prisma.notification.deleteMany({ where: { payload: { path: ['outboxEventId'], equals: manualEvents[0] } } });
            await prisma.outboxEvent.deleteMany({ where: { id: { in: manualEvents } } });
        }

        await tracker.cleanup();
        await disconnect();
    });

    it('emails the guest a voucher and the property a rooming line when a hotel is booked, and both again when it is cancelled', async () => {
        clearOutbox();
        const guest = unique('guest').toLowerCase() + '@example.test';
        const { booking, id } = await bookHotel(guest);

        const queued = await eventsFor(id);
        assert.deepEqual(
            queued.map((event) => event.topic).sort(),
            ['booking.created', 'hotel.booking.confirmed', 'supplier.booking.received'],
            'the voucher and the supplier notice are written with the booking'
        );
        assert.ok(queued.every((event) => event.processedAt === null), 'nothing is sent inside the request');

        await processAll(id);

        const voucher = mailsTo(guest, 'hotelBookingConfirmed');
        assert.equal(voucher.length, 1);
        assert.equal(voucher[0].data.reference, booking.reference);
        assert.equal(voucher[0].data.totalCents, booking.totalCents);
        assert.match(voucher[0].data.url, new RegExp(`/booking/manage/${booking.reference}\\?email=`));
        assert.match(voucher[0].text, /Nothing has been charged online/);
        assert.match(voucher[0].text, /A quiet room, please\./);

        // The property's own front-desk address wins over the company's.
        const desk = mailsTo('desk@rooms.example.test', 'supplierBookingReceived');
        assert.equal(desk.length, 1);
        assert.equal(desk[0].data.product, 'hotel');
        assert.equal(desk[0].data.reference, booking.reference);
        assert.equal(desk[0].data.guestName, 'Nino Beridze');
        assert.equal(desk[0].data.requested, false);
        assert.ok(desk[0].data.netCents > 0 && desk[0].data.netCents < booking.totalCents, 'the supplier sees net, not sell');
        assert.equal(mailsTo(supplier.email, 'supplierBookingReceived').length, 0);

        const cancelled = await request(app)
            .post(`/api/bookings/${booking.reference}/cancel`)
            .send({ email: guest, reason: 'Plans changed' });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));

        await processAll(id);

        const goodbye = mailsTo(guest, 'hotelBookingCancelled');
        assert.equal(goodbye.length, 1);
        assert.equal(goodbye[0].data.chargeCents, cancelled.body.cancellation.chargeCents);
        assert.equal(goodbye[0].data.reason, 'Plans changed');
        assert.equal(mailsTo('desk@rooms.example.test', 'supplierBookingCancelled').length, 1);
    });

    it('tells a traveller their request is with the operator, then that it was confirmed — or declined', async () => {
        clearOutbox();
        const tour = await makeTour(tracker, { destination, supplierId: supplier.id, title: 'Svaneti Trek' });
        const option = await makeTourOption(tour, { date: TOUR_DATE, confirmationMode: 'ON_REQUEST' });

        const bookRequest = async (email) => {
            const search = await request(app).get(`/api/search/tours/${tour.slug}?date=${TOUR_DATE}&adults=2`);
            assert.equal(search.status, 200, JSON.stringify(search.body));
            const offer = search.body.options.find((row) => row.id === option.id)?.dates[0] ?? search.body.options[0].dates[0];

            const created = await request(app).post('/api/tours/bookings').send({ offerToken: offer.token, leadTraveller: lead(email) });
            assert.equal(created.status, 201, JSON.stringify(created.body));
            assert.equal(created.body.status, 'PENDING');

            return { booking: created.body, id: (await prisma.tourBooking.findUnique({ where: { reference: created.body.reference } })).id };
        };

        const traveller = unique('traveller').toLowerCase() + '@example.test';
        const { booking, id } = await bookRequest(traveller);
        await processAll(id);

        const requested = mailsTo(traveller, 'tourBookingRequested');
        assert.equal(requested.length, 1);
        assert.equal(requested[0].data.tourTitle, 'Svaneti Trek');
        assert.ok(requested[0].data.requestDeadlineAt, 'the traveller is told when to expect an answer');
        assert.equal(mailsTo(traveller, 'tourBookingConfirmed').length, 0, 'a request is not a confirmation');

        // No front-desk address on a tour: the operator company's address is used, and it is a request.
        const operator = mailsTo(supplier.email, 'supplierBookingReceived');
        assert.equal(operator.length, 1);
        assert.equal(operator[0].data.product, 'tour');
        assert.equal(operator[0].data.requested, true);
        assert.match(operator[0].subject, /New request/);

        const confirmed = await request(app).post(`/api/admin/tours/bookings/${booking.reference}/confirm`).set('Cookie', adminCookie);
        assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
        await processAll(id);

        const yes = mailsTo(traveller, 'tourBookingConfirmed');
        assert.equal(yes.length, 1);
        assert.equal(yes[0].data.wasRequest, true);
        assert.match(yes[0].subject, /request is confirmed/);

        const other = unique('traveller').toLowerCase() + '@example.test';
        const second = await bookRequest(other);
        const declined = await request(app)
            .post(`/api/admin/tours/bookings/${second.booking.reference}/decline`)
            .set('Cookie', adminCookie)
            .send({ reason: 'Guide unavailable that week' });
        assert.equal(declined.status, 200, JSON.stringify(declined.body));
        await processAll(second.id);

        const no = mailsTo(other, 'tourBookingDeclined');
        assert.equal(no.length, 1);
        assert.equal(no[0].data.reason, 'Guide unavailable that week');
        assert.equal(mailsTo(other, 'tourBookingConfirmed').length, 0);
    });

    it('emails the buyer and the provider for a service, and both when it is cancelled', async () => {
        clearOutbox();
        const service = await makeService(tracker, { destination, supplierId: supplier.id, name: 'Shabbat dinner delivered' });
        const buyer = unique('buyer').toLowerCase() + '@example.test';
        const date = futureDate(40);

        // Services are sold to signed-in buyers; the traveller named on the
        // booking is still the one who is written to.
        const agency = await makePartner(tracker);
        const agencyCookie = (await signIn(app, (await makePartnerUser(tracker, agency)).email)).cookie;

        const created = await request(app)
            .post('/api/service-bookings')
            .set('Cookie', agencyCookie)
            .send({ serviceId: service.id, date, quantity: 1, pax: 2, lead: lead(buyer) });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.equal(created.body.status, 'CONFIRMED');
        const { id } = await prisma.serviceBooking.findUnique({ where: { reference: created.body.reference } });

        await processAll(id);
        const confirmed = mailsTo(buyer, 'serviceBookingConfirmed');
        assert.equal(confirmed.length, 1);
        assert.equal(confirmed[0].data.serviceName, 'Shabbat dinner delivered');
        assert.equal(confirmed[0].data.pax, 2);
        assert.equal(mailsTo(supplier.email, 'supplierBookingReceived').filter((m) => m.data.product === 'service').length, 1);

        const cancelled = await request(app)
            .post(`/api/service-bookings/${created.body.reference}/cancel`)
            .set('Cookie', agencyCookie)
            .send({});
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        await processAll(id);

        assert.equal(mailsTo(buyer, 'serviceBookingCancelled').length, 1);
        assert.equal(mailsTo(supplier.email, 'supplierBookingCancelled').filter((m) => m.data.product === 'service').length, 1);
    });

    it('keeps an event whose email the relay refused, and sends it on the next attempt', async () => {
        clearOutbox();
        const guest = unique('guest').toLowerCase() + '@example.test';
        const { id } = await bookHotel(guest);
        const original = (await eventsFor(id)).find((event) => event.topic === 'hotel.booking.confirmed');
        const event = await manualCopy(original);

        failDeliveryTo.add(guest);
        try {
            assert.equal(await processEvent(event), false, 'a refused email is a failed attempt, not a processed event');
        } finally {
            failDeliveryTo.delete(guest);
        }

        const afterFailure = await prisma.outboxEvent.findUnique({ where: { id: event.id } });
        assert.equal(afterFailure.processedAt, null, 'the event is still owed');
        assert.equal(afterFailure.attempts, 1);
        assert.match(afterFailure.lastError, /Simulated delivery failure/);
        assert.ok(afterFailure.nextAttemptAt > new Date(), 'it is retried later, with backoff');
        assert.equal(mailsTo(guest, 'hotelBookingConfirmed').length, 0);

        assert.equal(await processEvent(afterFailure), true);
        const delivered = await prisma.outboxEvent.findUnique({ where: { id: event.id } });
        assert.ok(delivered.processedAt, 'the retry succeeded and the event is closed');
        assert.equal(mailsTo(guest, 'hotelBookingConfirmed').length, 1, 'the voucher arrived exactly once');
    });

    it('does not hand out the same in-app notice twice when a handler is retried', async () => {
        clearOutbox();
        const dispatcher = await makeAdmin(tracker, { role: 'DISPATCHER' });
        const dispatcherCookie = (await signIn(app, dispatcher.email)).cookie;
        const provider = tracker.transferProvider(await makeTransferProvider());
        const vehicleClass = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        const from = tracker.transferPoint(await makeTransferPoint({ kind: 'AIRPORT' }));
        const to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));
        const driver = await makeDriver(tracker, { providerId: provider.id, firstName: 'Levan' });
        const driverUser = await makeDriverUser(tracker, driver);

        const booking = await makeTransferBooking(tracker, { vehicleId: vehicleClass.id, from, to, pickupAt: new Date(Date.now() + 30 * 86_400_000) });
        const offered = await request(app)
            .post(`/api/admin/transfers/dispatch/legs/${booking.legs[0].id}/assign`)
            .set('Cookie', dispatcherCookie)
            .send({ driverId: driver.id });
        assert.equal(offered.status, 201, JSON.stringify(offered.body));

        const original = await prisma.outboxEvent.findFirst({
            where: { topic: 'transfer.assignment.offered', payload: { path: ['legId'], equals: booking.legs[0].id } }
        });
        assert.ok(original, 'the offer wrote an event');
        const event = await manualCopy(original);

        const noticesFor = () =>
            prisma.notification.count({
                where: { recipientUserId: driverUser.id, payload: { path: ['outboxEventId'], equals: event.id } }
            });

        // The notice is written, then the email is refused: a half-done handler.
        failDeliveryTo.add(driverUser.email);
        try {
            assert.equal(await processEvent(event), false);
        } finally {
            failDeliveryTo.delete(driverUser.email);
        }
        assert.equal(await noticesFor(), 1, 'the driver was told in-app before the email failed');
        assert.equal(mailsTo(driverUser.email, 'transferAssignmentOffered').length, 0);

        const retry = await prisma.outboxEvent.findUnique({ where: { id: event.id } });
        assert.equal(retry.attempts, 1);
        assert.equal(await processEvent(retry), true);

        assert.equal(await noticesFor(), 1, 'the retry did not repeat the notice');
        assert.equal(mailsTo(driverUser.email, 'transferAssignmentOffered').length, 1, 'but it did send the email');

        await prisma.notification.deleteMany({ where: { recipientUserId: driverUser.id } });
    });

    it('rolls a confirmed stay to COMPLETED once check-out has passed, and refuses to cancel it after', async () => {
        const guest = unique('guest').toLowerCase() + '@example.test';
        const { booking, id } = await bookHotel(guest);

        // Still ahead of the guest: the sweep leaves it alone.
        await sweepCompletedHotelBookings();
        assert.equal((await prisma.hotelBooking.findUnique({ where: { id } })).status, 'CONFIRMED');

        await prisma.hotelBooking.update({
            where: { id },
            data: { checkIn: new Date('2020-01-01T00:00:00.000Z'), checkOut: new Date('2020-01-03T00:00:00.000Z') }
        });

        const swept = await sweepCompletedHotelBookings();
        assert.ok(swept.completed >= 1);

        const closed = await prisma.hotelBooking.findUnique({ where: { id } });
        assert.equal(closed.status, 'COMPLETED');
        assert.ok(closed.completedAt);

        const trail = await prisma.auditLog.findFirst({ where: { entityId: id, action: 'BOOKING_COMPLETED' } });
        assert.ok(trail, 'the completion is on the audit trail');
        assert.equal(trail.actorEmail, 'system');

        // Idempotent: a second pass finds nothing of ours to do.
        await sweepCompletedHotelBookings();
        assert.equal((await prisma.auditLog.count({ where: { entityId: id, action: 'BOOKING_COMPLETED' } })), 1);

        const seen = await request(app).get(`/api/bookings/${booking.reference}?email=${encodeURIComponent(guest)}`);
        assert.equal(seen.status, 200);
        assert.equal(seen.body.status, 'COMPLETED');
        assert.ok(seen.body.completedAt);

        const tooLate = await request(app).post(`/api/bookings/${booking.reference}/cancel`).send({ email: guest });
        assert.equal(tooLate.status, 409);
    });
});
