import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { reconcileBookingIndex } from '../services/booking/index.service.js';
import { createTracker, databaseAvailable, makeAdmin, makeDestination, makePartner, makePartnerUser, signIn, unique } from './support/factories.js';
import { makeSellableHotel } from './support/packages.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const CHECK_IN = '2027-06-10';
const CHECK_OUT = '2027-06-12';

/**
 * The cross-product booking index and the filters every register shares.
 *
 * The index is a projection the services keep in step: a booking's row
 * appears when it is made, follows its status, its payment and its desk
 * fields, and is rebuilt by the reconcile when something slipped.
 */
describe('booking index and shared filters', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let admin;
    let adminCookie;
    let accountantCookie;
    let partner;
    let partnerCookie;
    let otherPartnerCookie;
    let destination;

    before(async () => {
        admin = await makeAdmin(tracker);
        adminCookie = (await signIn(app, admin.email)).cookie;
        accountantCookie = (await signIn(app, (await makeAdmin(tracker, { role: 'ACCOUNTANT' })).email)).cookie;
        partner = await makePartner(tracker);
        partnerCookie = (await signIn(app, (await makePartnerUser(tracker, partner)).email)).cookie;
        otherPartnerCookie = (await signIn(app, (await makePartnerUser(tracker, await makePartner(tracker))).email)).cookie;
        destination = await makeDestination(tracker);
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const lead = () => ({ firstName: 'Lika', lastName: unique('Ix').replace(/[^A-Za-z]/g, ''), email: `lika.${unique('i')}@example.test` });

    const bookHotel = async (cookie = partnerCookie) => {
        const sellable = await makeSellableHotel(app, adminCookie, tracker, { destination, checkIn: CHECK_IN, nights: 2 });
        const offers = await request(app).get(`/api/search/hotels/${sellable.hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`).set('Cookie', cookie);
        const guest = lead();
        const response = await request(app).post('/api/bookings').set('Cookie', cookie).send({ offerToken: offers.body.roomTypes[0].offers[0].token, leadGuest: guest });
        assert.equal(response.status, 201, JSON.stringify(response.body));

        const row = await prisma.hotelBooking.findUnique({ where: { reference: response.body.reference }, include: { receivable: true } });

        return { ...sellable, booking: response.body, row, guest };
    };

    const indexRow = (reference) => prisma.bookingIndex.findUnique({ where: { reference } });
    const all = (query, cookie = adminCookie) => request(app).get(`/api/admin/bookings/all?${new URLSearchParams(query)}`).set('Cookie', cookie);

    it('indexes a booking when it is made and follows its status, money and desk fields', async () => {
        const { row, guest, hotel } = await bookHotel();

        const indexed = await indexRow(row.reference);
        assert.ok(indexed, 'the facade wrote the row');
        assert.equal(indexed.product, 'HOTEL');
        assert.equal(indexed.status, 'CONFIRMED');
        assert.equal(indexed.partnerId, partner.id);
        assert.equal(indexed.receivableId, row.receivable.id);
        assert.equal(indexed.receivableStatus, 'OPEN');
        assert.equal(indexed.totalCents, row.sellTotalCents + row.taxTotalCents);
        assert.equal(indexed.title, hotel.name);
        assert.ok(indexed.search.includes(guest.lastName.toLowerCase()));
        assert.ok(indexed.search.includes(partner.name.toLowerCase()));

        // The desk assigns a manager: the row follows.
        const desk = await request(app).patch(`/api/admin/bookings/${row.reference}/desk`).set('Cookie', adminCookie).send({ assignedManagerUserId: admin.id });
        assert.equal(desk.status, 200, JSON.stringify(desk.body));
        assert.equal((await indexRow(row.reference)).assignedManagerUserId, admin.id);

        // Finance records a payment: the row follows.
        const paid = await request(app)
            .post('/api/admin/finance/payments')
            .set('Cookie', accountantCookie)
            .set('Idempotency-Key', unique('pay'))
            .send({
                direction: 'IN',
                method: 'BANK_TRANSFER',
                currency: 'GEL',
                paidAt: new Date().toISOString(),
                amountCents: row.receivable.amountCents,
                reference: 'TBC-1',
                allocations: [{ receivableId: row.receivable.id, amountCents: row.receivable.amountCents }]
            });
        assert.equal(paid.status, 201, JSON.stringify(paid.body));
        const afterPayment = await indexRow(row.reference);
        assert.equal(afterPayment.receivableStatus, 'PAID');
        assert.equal(afterPayment.paidCents, row.receivable.amountCents);

        // Cancelled: the row follows.
        const cancelled = await request(app).post(`/api/admin/bookings/${row.reference}/cancel`).set('Cookie', adminCookie).send({ reason: 'Test' });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        assert.equal((await indexRow(row.reference)).status, 'CANCELLED');
    });

    it('lists every product in one register with the shared filters, and scopes a partner to its own', async () => {
        const mine = await bookHotel();
        const theirs = await bookHotel(otherPartnerCookie);

        const bySearch = await all({ search: mine.guest.lastName });
        assert.equal(bySearch.status, 200, JSON.stringify(bySearch.body));
        assert.equal(bySearch.body.data.length, 1);
        const entry = bySearch.body.data[0];
        assert.equal(entry.reference, mine.row.reference);
        assert.equal(entry.product, 'HOTEL');
        assert.equal(entry.href, `/admin/bookings/${mine.row.reference}`);
        assert.deepEqual(entry.partner, { id: partner.id, name: partner.name }, 'the row carries the partner by name, looked up per page');
        assert.equal(entry.customer, null);
        assert.equal(entry.payment.status, 'UNPAID');
        assert.equal(entry.startDate, CHECK_IN);

        const unpaid = await all({ paymentStatus: 'UNPAID', partnerId: partner.id, product: 'HOTEL' });
        assert.ok(unpaid.body.data.some((row) => row.reference === mine.row.reference));
        assert.ok(!unpaid.body.data.some((row) => row.reference === theirs.row.reference), 'the partner filter holds');

        const paidOnly = await all({ paymentStatus: 'PAID', search: mine.guest.lastName });
        assert.equal(paidOnly.body.data.length, 0);

        const byDestination = await all({ destinationId: destination.id, search: mine.guest.lastName });
        assert.equal(byDestination.body.data.length, 1);

        const created = await all({ createdFrom: '2020-01-01', createdTo: '2020-01-02', search: mine.guest.lastName });
        assert.equal(created.body.data.length, 0);

        const sorted = await all({ sort: 'total:asc', pageSize: '100' });
        const totals = sorted.body.data.map((row) => row.totalCents);
        assert.deepEqual(totals, [...totals].sort((a, b) => a - b));

        assert.equal((await all({ product: 'CAR' })).status, 400);
        assert.equal((await request(app).get('/api/admin/bookings/all').set('Cookie', otherPartnerCookie)).status, 403);

        const portal = await request(app).get(`/api/partner/bookings/all?search=${encodeURIComponent('lika')}&pageSize=100`).set('Cookie', partnerCookie);
        assert.equal(portal.status, 200, JSON.stringify(portal.body));
        assert.ok(portal.body.data.some((row) => row.reference === mine.row.reference));
        assert.equal(portal.body.data.find((row) => row.reference === mine.row.reference).href, `/portal/bookings/${mine.row.reference}`, 'a partner is led into the portal');
        assert.ok(!portal.body.data.some((row) => row.reference === theirs.row.reference), 'a partner sees its own and nobody else\'s');
    });

    it('applies the shared filters to the product registers too', async () => {
        const { row, guest } = await bookHotel();
        const list = (query) => request(app).get(`/api/admin/bookings?${new URLSearchParams(query)}`).set('Cookie', adminCookie);

        const unpaid = await list({ paymentStatus: 'UNPAID', search: guest.lastName });
        assert.equal(unpaid.status, 200, JSON.stringify(unpaid.body));
        assert.ok(unpaid.body.data.some((entry) => entry.reference === row.reference));

        const paid = await list({ paymentStatus: 'PAID', search: guest.lastName });
        assert.equal(paid.body.data.length, 0);

        const none = await list({ paymentStatus: 'NONE', search: guest.lastName });
        assert.equal(none.body.data.length, 0, 'a confirmed booking has a bill');

        const overdue = await list({ paymentStatus: 'OVERDUE', search: guest.lastName });
        assert.equal(overdue.body.data.length, 0, 'not due yet');

        await prisma.receivable.update({ where: { hotelBookingId: row.id }, data: { dueAt: new Date(Date.now() - 86_400_000) } });
        const nowOverdue = await list({ paymentStatus: 'OVERDUE', search: guest.lastName });
        assert.equal(nowOverdue.body.data.length, 1);
        assert.equal(nowOverdue.body.data[0].payment.status, 'OVERDUE');

        const byManager = await list({ managerId: admin.id, search: guest.lastName });
        assert.equal(byManager.body.data.length, 0);

        const byDestination = await list({ destinationId: destination.id, search: guest.lastName });
        assert.equal(byDestination.body.data.length, 1);

        const invoiced = await list({ invoiceStatus: 'ISSUED', search: guest.lastName });
        assert.equal(invoiced.status, 200);
        assert.equal(invoiced.body.data.length, 0, 'invoicing is off in the suite');

        const sorted = await list({ sort: 'created:asc', pageSize: '5' });
        assert.equal(sorted.status, 200);

        // The transfer register takes the same fields (its schema is strict).
        assert.equal((await request(app).get('/api/admin/transfers/bookings?paymentStatus=UNPAID&sort=date:asc').set('Cookie', adminCookie)).status, 200);
        assert.equal((await request(app).get('/api/admin/tours/bookings?paymentStatus=PAID&managerId=x').set('Cookie', adminCookie)).status, 200);
        assert.equal((await request(app).get('/api/admin/orders?paymentStatus=NONE&invoiceStatus=DRAFT').set('Cookie', adminCookie)).status, 200);
        assert.equal((await request(app).get('/api/admin/services/bookings?source=PHONE').set('Cookie', adminCookie)).status, 200);
    });

    it('rebuilds a row the reconcile finds missing or stale', async () => {
        const { row } = await bookHotel();

        await prisma.bookingIndex.delete({ where: { reference: row.reference } });
        assert.equal(await indexRow(row.reference), null);

        const counts = await reconcileBookingIndex({ since: new Date(Date.now() - 60_000) });
        assert.ok(counts.HOTEL >= 1);
        const rebuilt = await indexRow(row.reference);
        assert.ok(rebuilt);
        assert.equal(rebuilt.status, 'CONFIRMED');

        await prisma.bookingIndex.update({ where: { reference: row.reference }, data: { status: 'WRONG', updatedAt: new Date(Date.now() - 7 * 86_400_000) } });
        await reconcileBookingIndex({ since: new Date(Date.now() - 60_000) });
        assert.equal((await indexRow(row.reference)).status, 'CONFIRMED', 'a stale row is rewritten');
    });
});
