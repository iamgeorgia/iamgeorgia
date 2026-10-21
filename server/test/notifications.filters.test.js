import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { processEvent } from '../services/notifications/outbox.service.js';
import { createTracker, databaseAvailable, makeAdmin, makeDestination, makePartner, makePartnerUser, signIn, unique } from './support/factories.js';
import { makeSellableHotel } from './support/packages.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const CHECK_IN = '2027-04-10';
const CHECK_OUT = '2027-04-12';

/**
 * The bell's tabs: a category on every notice, a link the server decides,
 * filters by tab and kind, and a key that makes a notice happen once.
 * Plus the two notices the desk gets about every booking: it arrived, and
 * its paperwork changed.
 */
describe('notification categories, links and dedupe', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let admin;
    let adminCookie;
    let partner;
    let partnerUser;
    let partnerCookie;
    let destination;

    before(async () => {
        admin = await makeAdmin(tracker);
        adminCookie = (await signIn(app, admin.email)).cookie;
        partner = await makePartner(tracker);
        partnerUser = await makePartnerUser(tracker, partner);
        partnerCookie = (await signIn(app, partnerUser.email)).cookie;
        destination = await makeDestination(tracker);
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const eventsFor = (entityId, topic) => prisma.outboxEvent.findMany({ where: { entityId, ...(topic ? { topic } : {}) }, orderBy: { createdAt: 'asc' } });
    const mine = (where = {}) => prisma.notification.findMany({ where: { recipientUserId: admin.id, ...where }, orderBy: { createdAt: 'asc' } });

    const bookHotel = async () => {
        const { hotel } = await makeSellableHotel(app, adminCookie, tracker, { destination, checkIn: CHECK_IN, nights: 2 });
        const offers = await request(app).get(`/api/search/hotels/${hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`).set('Cookie', partnerCookie);
        const offer = offers.body.roomTypes[0].offers[0];
        const response = await request(app)
            .post('/api/bookings')
            .set('Cookie', partnerCookie)
            .send({ offerToken: offer.token, leadGuest: { firstName: 'Nino', lastName: 'Beridze', email: `nino.${unique('n')}@example.test` } });
        assert.equal(response.status, 201, JSON.stringify(response.body));

        return prisma.hotelBooking.findUnique({ where: { reference: response.body.reference } });
    };

    it('tells the desk once about a new booking, however many times the event runs, and once per amendment', async () => {
        const row = await bookHotel();
        assert.equal(row.status, 'CONFIRMED', 'approval is off for this suite');

        const [created] = await eventsFor(row.id, 'booking.created');
        assert.ok(created, 'the facade wrote the arrival event');

        await processEvent(created);
        await processEvent({ ...created, attempts: 1 });

        const arrivals = await mine({ kind: 'BOOKING_NEW', entityId: row.id });
        assert.equal(arrivals.length, 1, 'one notice, whatever the retries');
        assert.equal(arrivals[0].category, 'BOOKING');
        assert.equal(arrivals[0].dedupeKey, `booking:HOTEL:${row.id}:new`);
        assert.equal(await prisma.notification.count({ where: { recipientUserId: partnerUser.id, kind: 'BOOKING_NEW', entityId: row.id } }), 0, 'the booker is not told of their own booking');

        const amended = await request(app).patch(`/api/bookings/${row.reference}`).set('Cookie', partnerCookie).send({ specialRequests: 'Late arrival' });
        assert.equal(amended.status, 200, JSON.stringify(amended.body));

        const [modified] = await eventsFor(row.id, 'booking.modified');
        assert.ok(modified);
        assert.deepEqual(modified.payload.fields, ['specialRequests']);

        await processEvent(modified);
        await processEvent({ ...modified, attempts: 1 });

        const changes = await mine({ kind: 'BOOKING_MODIFIED', entityId: row.id });
        assert.equal(changes.length, 1);
        assert.equal(changes[0].dedupeKey, `booking:HOTEL:${row.id}:modified:${modified.id}`);
    });

    it('filters by tab and by kind, sorts, counts per tab, links each notice, and marks one tab read', async () => {
        const row = await bookHotel();
        await processEvent((await eventsFor(row.id, 'booking.created'))[0]);

        // A finance notice beside the booking ones, written directly.
        await prisma.notification.create({
            data: {
                recipientUserId: admin.id,
                kind: 'FINANCE_INVOICE_ISSUED',
                category: 'FINANCE',
                title: 'Invoice',
                body: 'issued',
                payload: {},
                entityType: 'Invoice',
                entityId: 'inv-1'
            }
        });

        const bookingTab = await request(app).get('/api/admin/notifications?category=BOOKING').set('Cookie', adminCookie);
        assert.equal(bookingTab.status, 200, JSON.stringify(bookingTab.body));
        assert.ok(bookingTab.body.data.length >= 1);
        assert.ok(bookingTab.body.data.every((notice) => notice.category === 'BOOKING'));
        assert.ok(typeof bookingTab.body.unreadByCategory.BOOKING === 'number');

        const arrival = bookingTab.body.data.find((notice) => notice.entityId === row.id);
        assert.ok(arrival);
        assert.equal(arrival.href, `/admin/bookings/${row.reference}`, 'the link is the server\'s word');

        const byKind = await request(app).get('/api/admin/notifications?kind=FINANCE_INVOICE_ISSUED').set('Cookie', adminCookie);
        assert.ok(byKind.body.data.length >= 1);
        assert.ok(byKind.body.data.every((notice) => notice.kind === 'FINANCE_INVOICE_ISSUED'));
        assert.equal(byKind.body.data[0].href, '/admin/finance/invoices/inv-1');

        const oldest = await request(app).get('/api/admin/notifications?sort=oldest&pageSize=100').set('Cookie', adminCookie);
        const stamps = oldest.body.data.map((notice) => new Date(notice.createdAt).getTime());
        assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b));

        const count = await request(app).get('/api/admin/notifications/unread-count').set('Cookie', adminCookie);
        assert.ok(count.body.unreadCount >= 2);
        assert.ok(count.body.byCategory.FINANCE >= 1);
        assert.ok(count.body.byCategory.BOOKING >= 1);

        const readFinance = await request(app).post('/api/admin/notifications/read-all').set('Cookie', adminCookie).send({ category: 'FINANCE' });
        assert.equal(readFinance.status, 200);
        assert.ok(readFinance.body.count >= 1);

        const after = await request(app).get('/api/admin/notifications/unread-count').set('Cookie', adminCookie);
        assert.equal(after.body.byCategory.FINANCE, 0);
        assert.ok(after.body.byCategory.BOOKING >= 1, 'the other tab is untouched');

        assert.equal((await request(app).get('/api/admin/notifications?category=NOPE').set('Cookie', adminCookie)).status, 400);
    });

    it('links a partner\'s notice into the portal', async () => {
        await prisma.notification.create({
            data: {
                recipientUserId: partnerUser.id,
                kind: 'BOOKING_APPROVED',
                category: 'APPROVAL',
                title: 'Approved',
                body: 'BKG-1',
                payload: { bookingReference: 'BKG-000001' },
                entityType: 'HotelBooking',
                entityId: 'x'
            }
        });

        const list = await request(app).get('/api/partner/notifications?category=APPROVAL').set('Cookie', partnerCookie);
        assert.equal(list.status, 200, JSON.stringify(list.body));
        const notice = list.body.data.find((row) => row.payload.bookingReference === 'BKG-000001');
        assert.ok(notice);
        assert.equal(notice.href, '/portal/bookings/BKG-000001');
        assert.equal(notice.category, 'APPROVAL');
    });
});
