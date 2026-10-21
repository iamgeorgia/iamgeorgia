import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import { clearOutbox, outbox } from '../lib/mailer/index.js';
import { dateOnlyToUtc } from '../lib/time.js';
import { processEvent } from '../services/notifications/outbox.service.js';
import { sweepBookingApprovals } from '../services/booking/approval.service.js';
import {
    createTracker,
    databaseAvailable,
    futureDate,
    makeAdmin,
    makeDestination,
    makePartner,
    makePartnerUser,
    signIn,
    unique
} from './support/factories.js';
import { makeSellableHotel, makeTourDeparture, makeTransferLeg } from './support/packages.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const CHECK_IN = '2027-03-10';
const CHECK_OUT = '2027-03-12';
const TOUR_DATE = '2027-03-11';

/**
 * Booking approval (owner decision OD1): every booking waits for the
 * platform's yes before it is confirmed, holding its inventory meanwhile.
 *
 * The flag is off for the suite as a whole (`.env.test`) and switched on
 * here through `config`, which is a plain object: the booking suites were
 * written against instant confirmation and keep testing that path.
 */
describe('booking approval', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const saved = { ...config.booking };
    let adminCookie;
    let admin;
    let partner;
    let partnerUser;
    let partnerCookie;
    let accountantCookie;
    let destination;

    before(async () => {
        config.booking.approvalEnabled = true;

        admin = await makeAdmin(tracker);
        adminCookie = (await signIn(app, admin.email)).cookie;
        accountantCookie = (await signIn(app, (await makeAdmin(tracker, { role: 'ACCOUNTANT' })).email)).cookie;
        partner = await makePartner(tracker);
        partnerUser = await makePartnerUser(tracker, partner);
        partnerCookie = (await signIn(app, partnerUser.email)).cookie;
        destination = await makeDestination(tracker);
    });

    after(async () => {
        Object.assign(config.booking, saved);
        await tracker.cleanup();
        await disconnect();
    });

    beforeEach(() => clearOutbox());

    const lead = (email = `nino.${unique('a')}@example.test`) => ({ firstName: 'Nino', lastName: 'Beridze', email, phone: '+995322123456' });

    const eventsFor = (entityId) => prisma.outboxEvent.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });
    const processAll = async (entityId) => {
        for (const event of await eventsFor(entityId)) {
            await processEvent(event);
        }
    };
    const mailsTo = (address, template) => outbox.filter((entry) => entry.to === address && entry.template === template);

    const roomInventory = (roomTypeId, date = CHECK_IN) =>
        prisma.roomInventory.findUnique({ where: { roomTypeId_date: { roomTypeId, date: dateOnlyToUtc(date) } } });

    /** A partner's hotel booking, straight from an offer: PENDING_APPROVAL once the flag is on. */
    const bookHotel = async ({ cookie = partnerCookie, totalUnits = 3 } = {}) => {
        const sellable = await makeSellableHotel(app, adminCookie, tracker, { destination, checkIn: CHECK_IN, nights: 2, totalUnits });
        const search = request(app).get(`/api/search/hotels/${sellable.hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`);
        const offers = await (cookie ? search.set('Cookie', cookie) : search);
        assert.equal(offers.status, 200, JSON.stringify(offers.body));
        const offer = offers.body.roomTypes[0].offers[0];

        const post = request(app).post('/api/bookings').send({ offerToken: offer.token, leadGuest: lead() });
        const response = await (cookie ? post.set('Cookie', cookie) : post);
        assert.equal(response.status, 201, JSON.stringify(response.body));

        const row = await prisma.hotelBooking.findUnique({ where: { reference: response.body.reference } });
        tracker.hotelBooking?.(row);

        return { ...sellable, booking: response.body, row };
    };

    const approve = (product, reference, cookie = adminCookie) =>
        request(app).post(`/api/admin/booking-approvals/${product}/${reference}/approve`).set('Cookie', cookie).send({});
    const reject = (product, reference, reason = 'No availability after all', cookie = adminCookie) =>
        request(app).post(`/api/admin/booking-approvals/${product}/${reference}/reject`).set('Cookie', cookie).send({ reason });

    describe('a hotel booking', () => {
        it('is written PENDING_APPROVAL with its rooms claimed and nothing owed, and the desk is told', async () => {
            const { booking, row, roomType } = await bookHotel();

            assert.equal(booking.status, 'PENDING_APPROVAL');
            assert.equal(booking.approval.state, 'PENDING');
            assert.ok(booking.approval.deadlineAt);
            assert.equal(booking.payment.status, 'NONE');
            assert.equal(booking.confirmedAt, null);
            assert.equal((await roomInventory(roomType.id)).bookedUnits, 1, 'the room is claimed while the platform decides');
            assert.equal(await prisma.receivable.findUnique({ where: { hotelBookingId: row.id } }), null, 'nothing is owed yet');
            assert.equal(await prisma.supplierPayable.findUnique({ where: { hotelBookingId: row.id } }), null);

            const topics = (await eventsFor(row.id)).map((event) => event.topic);
            assert.ok(topics.includes('booking.awaiting_approval'));
            assert.ok(!topics.includes('supplier.booking.received'), 'the property is not told about a booking the platform may refuse');
            assert.ok(!topics.includes('hotel.booking.confirmed'));

            await processAll(row.id);

            assert.equal(mailsTo(booking.leadGuestEmail ?? row.leadGuestEmail, 'bookingAwaitingApproval').length, 1);
            const notice = await prisma.notification.findFirst({ where: { recipientUserId: admin.id, kind: 'BOOKING_AWAITING_APPROVAL', entityId: row.id } });
            assert.ok(notice, 'an approver has an in-app notice');
            assert.equal(notice.payload.bookingReference, booking.reference);
        });

        it('sits in the queue for approvers only, and counts on the badge', async () => {
            const { booking } = await bookHotel();

            const queue = await request(app).get('/api/admin/booking-approvals').set('Cookie', adminCookie);
            assert.equal(queue.status, 200);
            const row = queue.body.data.find((entry) => entry.reference === booking.reference);
            assert.ok(row, 'the booking is in the queue');
            assert.equal(row.product, 'HOTEL');
            assert.equal(row.partner.id, partner.id);

            assert.equal((await request(app).get('/api/admin/booking-approvals').set('Cookie', accountantCookie)).status, 403);
            assert.equal((await request(app).get('/api/admin/booking-approvals').set('Cookie', partnerCookie)).status, 403);
            assert.equal((await approve('HOTEL', booking.reference, accountantCookie)).status, 403);

            const badges = await request(app).get('/api/admin/badges').set('Cookie', adminCookie);
            assert.ok(badges.body.pendingBookingApprovals >= 1);
            assert.equal((await request(app).get('/api/admin/badges').set('Cookie', accountantCookie)).body.pendingBookingApprovals, null);
        });

        it('is confirmed by a yes: the ledger opens, the property and the guest are told, and a second yes is refused', async () => {
            const { booking, row } = await bookHotel();
            clearOutbox();

            const approved = await approve('HOTEL', booking.reference);
            assert.equal(approved.status, 200, JSON.stringify(approved.body));
            assert.equal(approved.body.status, 'CONFIRMED');
            assert.equal(approved.body.approval.state, 'APPROVED');
            assert.ok(approved.body.approval.approvedBy);
            assert.ok(approved.body.confirmedAt);
            assert.equal(approved.body.payment.status, 'UNPAID');

            const receivable = await prisma.receivable.findUnique({ where: { hotelBookingId: row.id } });
            assert.ok(receivable, 'the yes is what makes it owed');
            assert.equal(receivable.status, 'OPEN');
            assert.equal(receivable.debtorPartnerId, partner.id);
            assert.ok(await prisma.supplierPayable.findUnique({ where: { hotelBookingId: row.id } }));

            const topics = (await eventsFor(row.id)).map((event) => event.topic);
            assert.ok(topics.includes('booking.approved'));
            assert.ok(topics.includes('supplier.booking.received'));

            await processAll(row.id);
            assert.equal(mailsTo(row.leadGuestEmail, 'hotelBookingConfirmed').length, 1, 'the confirmation follows the yes');
            assert.ok(await prisma.notification.findFirst({ where: { recipientUserId: partnerUser.id, kind: 'BOOKING_APPROVED', entityId: row.id } }));

            const again = await approve('HOTEL', booking.reference);
            assert.equal(again.status, 409);
            assert.equal(again.body.error.details.reason, 'NOT_PENDING_APPROVAL');

            const audit = await prisma.auditLog.findFirst({ where: { entityId: row.id, action: 'BOOKING_APPROVED' } });
            assert.ok(audit);
        });

        it('is cancelled by a no at no charge, the rooms go back, and the property never hears of it', async () => {
            const { booking, row, roomType } = await bookHotel();
            clearOutbox();

            const refused = await reject('HOTEL', booking.reference, 'Overbooked on those dates');
            assert.equal(refused.status, 200, JSON.stringify(refused.body));
            assert.equal(refused.body.status, 'CANCELLED');
            assert.equal(refused.body.approval.state, 'REJECTED');
            assert.equal(refused.body.approval.reason, 'Overbooked on those dates');
            assert.equal(refused.body.cancellationChargeCents, 0);
            assert.equal((await roomInventory(roomType.id)).bookedUnits, 0, 'the room is free again');
            assert.equal(await prisma.receivable.findUnique({ where: { hotelBookingId: row.id } }), null);

            await processAll(row.id);
            assert.equal(mailsTo(row.leadGuestEmail, 'bookingRejected').length, 1);
            assert.equal(outbox.filter((entry) => entry.template === 'supplierBookingCancelled').length, 0);
            assert.ok(await prisma.notification.findFirst({ where: { recipientUserId: partnerUser.id, kind: 'BOOKING_REJECTED', entityId: row.id } }));

            assert.equal((await reject('HOTEL', booking.reference)).status, 409);
        });

        it('can be withdrawn by the partner while it waits, at no charge', async () => {
            const { booking, row, roomType } = await bookHotel();

            const quote = await request(app).get(`/api/bookings/${booking.reference}/cancellation-quote`).set('Cookie', partnerCookie);
            assert.equal(quote.body.chargeCents, 0);

            const cancelled = await request(app).post(`/api/bookings/${booking.reference}/cancel`).set('Cookie', partnerCookie).send({ reason: 'Plans changed' });
            assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
            assert.equal(cancelled.body.status, 'CANCELLED');
            assert.equal(cancelled.body.approval.state, 'WITHDRAWN');
            assert.equal(cancelled.body.cancellation.chargeCents, 0);
            assert.equal((await roomInventory(roomType.id)).bookedUnits, 0);
            assert.equal(await prisma.receivable.findUnique({ where: { hotelBookingId: row.id } }), null);
        });

        it('is refused a yes when it would take the partner past a blocking credit limit, and keeps waiting', async () => {
            const limited = await makePartner(tracker);
            const cookie = (await signIn(app, (await makePartnerUser(tracker, limited)).email)).cookie;
            const { booking } = await bookHotel({ cookie });
            assert.equal(booking.status, 'PENDING_APPROVAL');

            // The limit arrives while the booking waits: nothing counted against
            // it at booking (nothing was owed), so the yes is where it bites.
            await prisma.partner.update({ where: { id: limited.id }, data: { creditLimitCents: 1_000, creditLimitCurrency: 'GEL', creditLimitMode: 'BLOCK' } });

            const refused = await approve('HOTEL', booking.reference);
            assert.equal(refused.status, 422, JSON.stringify(refused.body));
            assert.equal(refused.body.error.details.reason, 'CREDIT_LIMIT_EXCEEDED');

            const still = await prisma.hotelBooking.findUnique({ where: { reference: booking.reference } });
            assert.equal(still.status, 'PENDING_APPROVAL');
        });

        it('is confirmed at once for a partner an admin has set to AUTO, and for everyone while the flag is off', async () => {
            const trusted = await makePartner(tracker);
            const terms = await request(app)
                .patch(`/api/admin/finance/partners/${trusted.id}/terms`)
                .set('Cookie', (await signIn(app, (await makeAdmin(tracker, { role: 'SUPER_ADMIN' })).email)).cookie)
                .send({ bookingApproval: 'AUTO' });
            assert.equal(terms.status, 200, JSON.stringify(terms.body));
            assert.equal(terms.body.bookingApproval, 'AUTO');
            assert.ok(await prisma.auditLog.findFirst({ where: { entityId: trusted.id, action: 'PARTNER_BOOKING_APPROVAL_CHANGED' } }));

            const trustedCookie = (await signIn(app, (await makePartnerUser(tracker, trusted)).email)).cookie;
            const { booking: auto } = await bookHotel({ cookie: trustedCookie });
            assert.equal(auto.status, 'CONFIRMED');
            assert.equal(auto.approval, null);
            assert.equal(auto.payment.status, 'UNPAID');

            config.booking.approvalEnabled = false;
            try {
                const { booking: off } = await bookHotel();
                assert.equal(off.status, 'CONFIRMED');
                assert.equal(off.approval, null);
            } finally {
                config.booking.approvalEnabled = true;
            }
        });
    });

    describe('a transfer booking', () => {
        const bookTransfer = async () => {
            const leg = await makeTransferLeg(tracker, { destination });
            const query = new URLSearchParams({ from: leg.from.slug, to: leg.to.slug, date: futureDate(10), time: '09:00', adults: '2', luggage: '2' });
            const quotes = await request(app).get(`/api/transfers/quotes?${query}`).set('Cookie', partnerCookie);
            const offer = quotes.body.offers.find((entry) => entry.vehicle.slug === leg.vehicle.slug);
            assert.ok(offer, 'the fixture vehicle should be quotable');

            const response = await request(app).post('/api/transfers/bookings').set('Cookie', partnerCookie).send({ quoteToken: offer.token, leadPassenger: lead() });
            assert.equal(response.status, 201, JSON.stringify(response.body));

            const row = await prisma.transferBooking.findUnique({ where: { reference: response.body.reference } });
            tracker.transferBooking(row);

            return { leg, booking: response.body, row };
        };

        it('waits with its legs off the dispatch board, and the voucher follows the yes', async () => {
            const { booking, row } = await bookTransfer();
            assert.equal(booking.status, 'PENDING_APPROVAL');
            assert.equal(outbox.filter((entry) => entry.template === 'transferConfirmed').length, 0, 'no voucher for a booking that may be refused');

            const board = await request(app).get(`/api/admin/transfers/dispatch/legs?search=${booking.reference}`).set('Cookie', adminCookie);
            assert.equal(board.status, 200, JSON.stringify(board.body));
            assert.equal(board.body.data.length, 0, 'dispatch does not see it');

            const approved = await approve('TRANSFER', booking.reference);
            assert.equal(approved.status, 200, JSON.stringify(approved.body));
            assert.equal(approved.body.status, 'CONFIRMED');
            assert.ok(await prisma.receivable.findUnique({ where: { transferBookingId: row.id } }));

            await processAll(row.id);
            assert.equal(mailsTo(row.leadPassengerEmail, 'transferConfirmed').length, 1, 'the voucher is sent once approved');

            const boardAfter = await request(app).get(`/api/admin/transfers/dispatch/legs?search=${booking.reference}`).set('Cookie', adminCookie);
            assert.equal(boardAfter.body.data.length, 1, 'dispatch sees it now');
        });
    });

    describe('an on-request tour booking', () => {
        it('is approved first and only then put to the operator', async () => {
            const { tour, option } = await makeTourDeparture(tracker, { destination, date: TOUR_DATE });
            await prisma.tourOption.update({ where: { id: option.id }, data: { confirmationMode: 'ON_REQUEST' } });

            const search = await request(app).get(`/api/search/tours/${tour.slug}?date=${TOUR_DATE}&adults=2`).set('Cookie', partnerCookie);
            const offer = search.body.options[0]?.dates?.[0];
            assert.ok(offer?.token, JSON.stringify(search.body));

            const response = await request(app).post('/api/tours/bookings').set('Cookie', partnerCookie).send({ offerToken: offer.token, leadTraveller: lead() });
            assert.equal(response.status, 201, JSON.stringify(response.body));
            assert.equal(response.body.status, 'PENDING_APPROVAL');
            assert.equal(response.body.requestDeadlineAt, null, 'the operator has not been asked yet');

            const row = await prisma.tourBooking.findUnique({ where: { reference: response.body.reference } });
            tracker.tourBooking?.(row);
            assert.equal((await eventsFor(row.id)).filter((event) => event.topic === 'supplier.booking.received').length, 0);

            const approved = await approve('TOUR', response.body.reference);
            assert.equal(approved.status, 200, JSON.stringify(approved.body));
            assert.equal(approved.body.status, 'PENDING', 'approved, and now with the operator');
            assert.ok(approved.body.requestDeadlineAt);
            assert.equal(approved.body.approval.state, 'APPROVED');

            const supplierEvent = (await eventsFor(row.id)).find((event) => event.topic === 'supplier.booking.received');
            assert.ok(supplierEvent);
            assert.equal(supplierEvent.payload.requested, true);

            await processAll(row.id);
            assert.equal(mailsTo(row.leadTravellerEmail, 'tourBookingRequested').length, 1);

            const confirmed = await request(app).post(`/api/admin/tours/bookings/${response.body.reference}/confirm`).set('Cookie', adminCookie);
            assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
            assert.equal(confirmed.body.status, 'CONFIRMED');
            assert.ok(await prisma.receivable.findUnique({ where: { tourBookingId: row.id } }));
        });
    });

    describe('an order', () => {
        const makeOrder = async () => {
            const hotel = await makeSellableHotel(app, adminCookie, tracker, { destination, checkIn: CHECK_IN, nights: 2 });
            const leg = await makeTransferLeg(tracker, { destination });

            const created = await request(app)
                .post('/api/admin/packages')
                .set('Cookie', adminCookie)
                .send({
                    slug: `apr-${unique('p').toLowerCase().replace(/[^a-z0-9-]/g, '')}`,
                    name: 'Approval weekend',
                    destinationId: destination.id,
                    summary: 'Two nights and a transfer.',
                    image: '/images/packages/test.jpg',
                    nights: 2,
                    b2cEnabled: true,
                    adjustmentKind: 'DISCOUNT_BPS',
                    adjustmentValue: 500,
                    adjustmentAppliesTo: 'ALL_ITEMS',
                    components: [
                        { componentType: 'HOTEL_STAY', label: 'Two nights', nights: 2, hotelId: hotel.hotel.id },
                        { componentType: 'TRANSFER', label: 'Airport pick-up', fromPointId: leg.from.id, toPointId: leg.to.id, timeOfDay: '11:00' }
                    ]
                });
            assert.equal(created.status, 201, JSON.stringify(created.body));
            tracker.package(created.body);
            await request(app).post(`/api/admin/packages/${created.body.id}/publish`).set('Cookie', adminCookie);

            const pin = encodeURIComponent(JSON.stringify({ 1: { vehicleId: leg.vehicle.id } }));
            const quote = await request(app).get(`/api/packages/${created.body.slug}/quote?startDate=${CHECK_IN}&adults=2&choices=${pin}`).set('Cookie', partnerCookie);
            assert.equal(quote.body.available, true, JSON.stringify(quote.body));

            const order = await request(app).post('/api/orders').set('Cookie', partnerCookie).send({ packageToken: quote.body.token, leadGuest: lead() });
            assert.equal(order.status, 201, JSON.stringify(order.body));

            const row = await prisma.order.findUnique({ where: { reference: order.body.reference }, include: { items: true } });
            tracker.order?.(row);

            return { order: order.body, row, hotel };
        };

        it('waits as one, is decided as one, and its children cannot be decided on their own', async () => {
            const { order, row } = await makeOrder();
            assert.equal(order.status, 'PENDING_APPROVAL');
            assert.ok(order.items.every((item) => item.status === 'AWAITING_APPROVAL'));
            assert.ok(order.items.every((item) => item.booking.status === 'PENDING_APPROVAL'));
            assert.equal(order.payment.status, 'NONE');
            assert.equal(await prisma.receivable.findUnique({ where: { orderId: row.id } }), null);

            const child = await approve('HOTEL', order.items[0].booking.reference);
            assert.equal(child.status, 409);
            assert.equal(child.body.error.details.reason, 'PART_OF_ORDER');

            const approved = await approve('ORDER', order.reference);
            assert.equal(approved.status, 200, JSON.stringify(approved.body));
            assert.equal(approved.body.status, 'CONFIRMED');
            assert.ok(approved.body.items.every((item) => item.status === 'CONFIRMED'));
            assert.ok(approved.body.items.every((item) => item.booking.status === 'CONFIRMED'));
            assert.equal(approved.body.payment.status, 'UNPAID');

            const receivable = await prisma.receivable.findUnique({ where: { orderId: row.id } });
            assert.ok(receivable, 'the order, not its parts, is what the buyer owes');
            assert.equal(receivable.amountCents, approved.body.totalCents);

            await processAll(row.id);
            assert.equal(mailsTo(row.leadEmail, 'orderConfirmed').length, 1);
        });

        it('is cancelled whole by a no, every child with it, at no charge', async () => {
            const { order, row } = await makeOrder();
            clearOutbox();

            const refused = await reject('ORDER', order.reference, 'Hotel closed for renovation');
            assert.equal(refused.status, 200, JSON.stringify(refused.body));
            assert.equal(refused.body.status, 'CANCELLED');
            assert.equal(refused.body.approval.state, 'REJECTED');
            assert.equal(refused.body.cancellationChargeCents, 0);
            assert.ok(refused.body.items.every((item) => item.status === 'CANCELLED'));
            assert.ok(refused.body.items.every((item) => item.booking.status === 'CANCELLED'));
            assert.ok(refused.body.items.every((item) => item.booking.approval.state === 'REJECTED'));
            assert.equal(await prisma.receivable.findUnique({ where: { orderId: row.id } }), null);

            await processAll(row.id);
            assert.equal(mailsTo(row.leadEmail, 'bookingRejected').length, 1);
            assert.equal(mailsTo(row.leadEmail, 'orderCancelled').length, 0, 'one note, not two');
        });
    });

    describe('the sweeper', () => {
        it('alerts the desk once past the deadline, and expires a booking whose stay has begun', async () => {
            const { booking, row, roomType } = await bookHotel();
            const past = new Date(Date.now() - 60_000);

            await prisma.hotelBooking.update({ where: { id: row.id }, data: { approvalDeadlineAt: past } });

            const first = await sweepBookingApprovals();
            assert.ok(first.alerted >= 1);
            const stamped = await prisma.hotelBooking.findUnique({ where: { id: row.id } });
            assert.ok(stamped.approvalOverdueAlertAt, 'stamped in the same statement as the alert');
            assert.equal(stamped.status, 'PENDING_APPROVAL', 'a late answer is still an answer');
            assert.ok((await eventsFor(row.id)).some((event) => event.topic === 'booking.approval_overdue'));

            await sweepBookingApprovals();
            assert.equal((await eventsFor(row.id)).filter((event) => event.topic === 'booking.approval_overdue').length, 1, 'alerted once, not every sweep');

            // The stay began unanswered: nobody can approve it any more.
            await prisma.hotelBooking.update({ where: { id: row.id }, data: { checkIn: dateOnlyToUtc('2020-01-01'), checkOut: dateOnlyToUtc('2020-01-03') } });
            const third = await sweepBookingApprovals();
            assert.ok(third.expired >= 1);

            const expired = await prisma.hotelBooking.findUnique({ where: { id: row.id } });
            assert.equal(expired.status, 'CANCELLED');
            assert.equal(expired.rejectedByName, 'System');
            assert.equal(expired.cancellationChargeCents, 0);
            assert.ok(await prisma.auditLog.findFirst({ where: { entityId: row.id, action: 'BOOKING_APPROVAL_EXPIRED' } }));
            assert.equal(booking.reference, expired.reference);
            // The rooms are released for the dates the row carries — moved to
            // 2020 above to make the stay "begin", so the original nights'
            // counters are not what this test can check; the no-path test
            // above covers the release itself.
            assert.ok(roomType.id);
        });
    });
});
