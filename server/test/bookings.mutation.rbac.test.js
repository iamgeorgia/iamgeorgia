import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { disconnect } from '../db/index.js';
import { amendBooking, cancelBooking } from '../services/hotel/booking.service.js';
import { createTracker, databaseAvailable, makeAdmin, makeDestination, signIn } from './support/factories.js';
import { makeSellableHotel } from './support/packages.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const CHECK_IN = '2027-09-06';
const CHECK_OUT = '2027-09-08';
const GUEST_EMAIL = 'nino@example.test';

/**
 * The service-level guard on changing a booking, below the routers.
 *
 * The public booking routers now refuse staff without a booking capability
 * before any service runs, so this is the net beneath that: whoever calls
 * `cancelBooking` or `amendBooking` with a viewer that merely *reads* every
 * booking — management, finance — is answered as a stranger would be, with a
 * 404, email or no email. Transfers have had this since the fleet work; the
 * hotel, tour and order services share the same shape now.
 */
describe('changing a booking needs more than reading it', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let adminCookie;
    let destination;

    before(async () => {
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;
        destination = await makeDestination(tracker);
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    /** A guest booking made through the website, as a guest would. */
    const guestBooking = async () => {
        const { hotel } = await makeSellableHotel(app, adminCookie, tracker, { destination, checkIn: CHECK_IN, nights: 2 });

        const offer = await request(app).get(`/api/search/hotels/${hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`);
        assert.equal(offer.status, 200, 'the fixture should be searchable');

        const hold = await request(app).post('/api/bookings/holds').send({ token: offer.body.roomTypes[0].offers[0].token });
        assert.equal(hold.status, 201);

        const booking = await request(app)
            .post('/api/bookings')
            .send({
                holdToken: hold.body.token,
                leadGuest: { firstName: 'Nino', lastName: 'Beridze', email: GUEST_EMAIL, phone: '+995322123456' }
            });
        assert.equal(booking.status, 201);

        return booking.body;
    };

    const isNotFound = (err) => err.status === 404;

    it('answers a desk that reads every booking as a stranger, even one quoting the lead email', async () => {
        const booking = await guestBooking();

        // Not a dispatcher: it reads no bookings, so with the lead email it is
        // a guest here like anyone else, and the router is what keeps it out.
        for (const role of ['MANAGEMENT', 'FINANCE']) {
            await assert.rejects(
                amendBooking(booking.reference, { specialRequests: 'Late arrival', email: GUEST_EMAIL }, { role }),
                isNotFound,
                `${role} amend`
            );
            await assert.rejects(
                cancelBooking(booking.reference, { reason: 'Guest asked', email: GUEST_EMAIL }, { role }),
                isNotFound,
                `${role} cancel`
            );
        }

        // A guest with the email, and the booking desk, still may.
        const amended = await amendBooking(booking.reference, { specialRequests: 'Late arrival', email: GUEST_EMAIL }, undefined);
        assert.equal(amended.specialRequests, 'Late arrival');

        const byDesk = await amendBooking(booking.reference, { specialRequests: 'Cot, please' }, { role: 'RESERVATIONS' });
        assert.equal(byDesk.specialRequests, 'Cot, please');

        const cancelled = await cancelBooking(booking.reference, { reason: 'Guest asked' }, { role: 'RESERVATIONS' });
        assert.equal(cancelled.booking.status, 'CANCELLED');
    });
});
