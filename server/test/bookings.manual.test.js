import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import { clearOutbox, outbox } from '../lib/mailer/index.js';
import { processEvent } from '../services/notifications/outbox.service.js';
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
import { makeSellableHotel, makeService, makeTourDeparture, makeTransferLeg } from './support/packages.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const CHECK_IN = '2027-05-10';
const CHECK_OUT = '2027-05-12';

/**
 * Bookings made at the desk: for a partner, or for a customer with no
 * account; at the catalogue price or with an audited adjustment (OD3);
 * waiting for approval like any other, or confirmed at once by someone who
 * may approve.
 */
describe('manual bookings', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const saved = { ...config.booking };
    let admin;
    let adminCookie;
    let operatorCookie;
    let partner;
    let partnerUser;
    let partnerCookie;
    let destination;

    before(async () => {
        config.booking.approvalEnabled = true;

        admin = await makeAdmin(tracker);
        adminCookie = (await signIn(app, admin.email)).cookie;
        operatorCookie = (await signIn(app, (await makeAdmin(tracker, { role: 'TOUR_OPERATOR' })).email)).cookie;
        partner = await makePartner(tracker);
        partnerUser = await makePartnerUser(tracker, partner);
        partnerCookie = (await signIn(app, partnerUser.email)).cookie;
        destination = await makeDestination(tracker);
    });

    /** Customers the BUG-07 test wrote, removed once nothing refers to them. */
    const createdCustomerIds = new Set();

    after(async () => {
        Object.assign(config.booking, saved);
        await tracker.cleanup();
        await prisma.customer.deleteMany({
            where: {
                id: { in: [...createdCustomerIds] },
                hotelBookings: { none: {} },
                transferBookings: { none: {} },
                tourBookings: { none: {} },
                serviceBookings: { none: {} },
                orders: { none: {} },
                receivables: { none: {} },
                invoicingCustomers: { none: {} }
            }
        });
        await disconnect();
    });

    const lead = () => ({ firstName: 'Giorgi', lastName: 'Kapanadze', email: `giorgi.${unique('m')}@example.test` });

    /** An offer the desk can book from, searched as the buyer it will be booked for. */
    const hotelOffer = async (cookie = adminCookie, { asPartner = null } = {}) => {
        const sellable = await makeSellableHotel(app, adminCookie, tracker, { destination, checkIn: CHECK_IN, nights: 2 });
        const search = request(app).get(`/api/search/hotels/${sellable.hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`).set('Cookie', cookie);
        const offers = await (asPartner ? search.set('X-Act-As-Partner', asPartner) : search);
        assert.equal(offers.status, 200, JSON.stringify(offers.body));

        return { ...sellable, offer: offers.body.roomTypes[0].offers[0] };
    };

    const customer = () => ({
        kind: 'COMPANY',
        name: `Caucasus Travel ${unique('c')}`,
        contactName: 'Tamar Lomidze',
        email: `tamar.${unique('c')}@example.test`,
        phone: '+995 599 000 111',
        billingAddress: '12 Rustaveli Avenue',
        city: 'Tbilisi',
        country: 'GE',
        taxId: '404404404'
    });

    const manual = (body, cookie = adminCookie) => request(app).post('/api/admin/bookings/manual').set('Cookie', cookie).send(body);

    it('books for a partner as that partner: its price, its credit, its debt', async () => {
        const { offer } = await hotelOffer(partnerCookie);

        const response = await manual({
            buyer: { kind: 'PARTNER', partnerId: partner.id },
            channel: 'PHONE',
            assignedManagerUserId: admin.id,
            internalNotes: 'Called at 10:15, wants a quiet room',
            booking: { offerToken: offer.token, leadGuest: lead() }
        });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.status, 'PENDING_APPROVAL', 'the desk waits for approval like everyone else');
        assert.equal(response.body.partner.id, partner.id);
        assert.equal(response.body.source, 'PHONE');
        assert.equal(response.body.desk.assignedManager.id, admin.id);
        assert.equal(response.body.desk.internalNotes, 'Called at 10:15, wants a quiet room');
        assert.equal(response.body.desk.priceAdjustment, null);

        const row = await prisma.hotelBooking.findUnique({ where: { reference: response.body.reference } });
        assert.equal(row.partnerId, partner.id);
        assert.equal(row.bookedByUserId, admin.id, 'who made it is still the member of staff');
        assert.equal(row.customerId, null);

        // The partner reads it as its own, without the desk's fields.
        const seen = await request(app).get(`/api/bookings/${row.reference}`).set('Cookie', partnerCookie);
        assert.equal(seen.status, 200);
        assert.equal(seen.body.desk, undefined, 'the desk block is the platform\'s');
        assert.equal(seen.body.source, 'PHONE');

        // A member of staff who may not create bookings is refused.
        const accountant = (await signIn(app, (await makeAdmin(tracker, { role: 'ACCOUNTANT' })).email)).cookie;
        assert.equal((await manual({ buyer: { kind: 'PARTNER', partnerId: partner.id }, channel: 'PHONE', booking: { offerToken: offer.token, leadGuest: lead() } }, accountant)).status, 403);
    });

    it('books for a new customer, and the customer is who owes the money and gets the documents', async () => {
        const { offer } = await hotelOffer();
        const buyer = customer();
        clearOutbox();

        const response = await manual({
            buyer: { kind: 'CUSTOMER', customer: buyer },
            channel: 'EMAIL',
            confirmNow: true,
            booking: { offerToken: offer.token, leadGuest: lead() }
        });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.status, 'CONFIRMED', 'an admin who may approve may confirm at once');
        assert.equal(response.body.approval, null);
        assert.equal(response.body.partner, null);
        assert.equal(response.body.desk.customer.name, buyer.name);
        assert.equal(response.body.desk.customer.kind, 'COMPANY');
        assert.equal(response.body.payment.status, 'UNPAID');

        const row = await prisma.hotelBooking.findUnique({ where: { reference: response.body.reference } });
        const stored = await prisma.customer.findUnique({ where: { id: row.customerId } });
        assert.equal(stored.email, buyer.email);
        assert.equal(stored.createdByUserId, admin.id);
        assert.ok(await prisma.auditLog.findFirst({ where: { entityId: stored.id, action: 'CUSTOMER_CREATED' } }));

        const receivable = await prisma.receivable.findUnique({ where: { hotelBookingId: row.id } });
        assert.equal(receivable.debtorCustomerId, stored.id);
        assert.equal(receivable.debtorName, buyer.name, 'the company pays, not the traveller');
        assert.equal(receivable.debtorEmail, buyer.email);
        assert.equal(receivable.debtorPartnerId, null);

        // The customer is reusable, searchable and has the booking under it.
        const found = await request(app).get(`/api/admin/customers?q=${encodeURIComponent('Caucasus Travel')}`).set('Cookie', adminCookie);
        assert.ok(found.body.data.some((entry) => entry.id === stored.id));
        // An empty edit changes nothing, and resets nothing (a default `kind` once crept in here).
        const empty = await request(app).patch(`/api/admin/customers/${stored.id}`).set('Cookie', adminCookie).send({});
        assert.equal(empty.status, 400, JSON.stringify(empty.body));
        const onlyNotes = await request(app).patch(`/api/admin/customers/${stored.id}`).set('Cookie', adminCookie).send({ notes: 'Prefers email.' });
        assert.equal(onlyNotes.status, 200, JSON.stringify(onlyNotes.body));
        assert.equal(onlyNotes.body.kind, 'COMPANY', 'the kind survives an edit that does not mention it');

        const page = await request(app).get(`/api/admin/customers/${stored.id}`).set('Cookie', adminCookie);
        assert.equal(page.status, 200);
        assert.ok(page.body.bookings.some((entry) => entry.reference === row.reference && entry.product === 'HOTEL'));

        const again = await manual({
            buyer: { kind: 'CUSTOMER', customerId: stored.id },
            channel: 'DIRECT',
            booking: { offerToken: (await hotelOffer()).offer.token, leadGuest: lead() }
        });
        assert.equal(again.status, 201, JSON.stringify(again.body));
        assert.equal(again.body.desk.customer.id, stored.id);
        assert.equal(again.body.status, 'PENDING_APPROVAL', 'without confirmNow the desk waits like everyone else');
    });

    it('writes one customer for one description: a double click, and a manual booking replayed on its key (BUG-07)', async () => {
        const twin = { ...customer(), name: `Desk Twin ${unique('t')}` };
        const create = (body = twin) => request(app).post('/api/admin/customers').set('Cookie', adminCookie).send(body);

        // Two identical creates at once: one row, the second answer is that row.
        const clicks = await Promise.all([create(), create()]);
        assert.deepEqual(clicks.map((r) => r.status).sort(), [200, 201], JSON.stringify(clicks.map((r) => r.body)));
        assert.equal(clicks[0].body.id, clicks[1].body.id);
        createdCustomerIds.add(clicks[0].body.id);
        assert.equal(await prisma.customer.count({ where: { email: twin.email } }), 1);
        assert.equal(await prisma.auditLog.count({ where: { entityId: clicks[0].body.id, action: 'CUSTOMER_CREATED' } }), 1);

        // Sent again later, in another case: still the same customer.
        const later = await create({ ...twin, email: twin.email.toUpperCase() });
        assert.equal(later.status, 200, JSON.stringify(later.body));
        assert.equal(later.body.id, clicks[0].body.id);

        // Only an exact twin is reused: another phone at the same address is another record.
        const other = await create({ ...twin, phone: '+995 599 000 222' });
        assert.equal(other.status, 201, JSON.stringify(other.body));
        assert.notEqual(other.body.id, clicks[0].body.id);
        createdCustomerIds.add(other.body.id);

        // A manual booking for a new customer, retried twice with its key: one
        // booking (the retries are replays) and one customer, not three.
        const { offer } = await hotelOffer();
        const buyer = { ...customer(), name: `Desk Replay ${unique('r')}` };
        const leadGuest = lead();
        const key = `desk-${unique('k')}`;
        const send = () =>
            request(app)
                .post('/api/admin/bookings/manual')
                .set('Cookie', adminCookie)
                .set('Idempotency-Key', key)
                .send({ buyer: { kind: 'CUSTOMER', customer: buyer }, channel: 'PHONE', booking: { offerToken: offer.token, leadGuest } });

        const first = await send();
        assert.equal(first.status, 201, JSON.stringify(first.body));
        const retries = [await send(), await send()];
        assert.deepEqual(retries.map((r) => r.status), [200, 200], JSON.stringify(retries.map((r) => r.body)));
        assert.ok(retries.every((r) => r.body.reference === first.body.reference));

        const stored = await prisma.customer.findMany({ where: { email: buyer.email } });
        stored.forEach((row) => createdCustomerIds.add(row.id));
        assert.equal(stored.length, 1, 'the retries found the customer the first attempt wrote');
        assert.equal(first.body.desk.customer.id, stored[0].id);
    });

    it('sells at an audited adjustment on the catalogue price, for those who may', async () => {
        // Searched as the partner it will be booked for: the desk's header.
        const { offer } = await hotelOffer(adminCookie, { asPartner: partner.id });

        const refused = await manual(
            { buyer: { kind: 'PARTNER', partnerId: partner.id }, channel: 'PHONE', priceAdjustment: { cents: -1500, reason: 'Loyal agency' }, booking: { offerToken: offer.token, leadGuest: lead() } },
            operatorCookie
        );
        assert.equal(refused.status, 403, 'a tour operator sells at the catalogue price');
        assert.deepEqual(refused.body.error.details.fields, ['priceAdjustment']);

        const response = await manual({
            buyer: { kind: 'PARTNER', partnerId: partner.id },
            channel: 'EXTERNAL_AGENCY',
            confirmNow: true,
            priceAdjustment: { cents: -1500, reason: 'Loyal agency' },
            booking: { offerToken: offer.token, leadGuest: lead() }
        });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        const row = await prisma.hotelBooking.findUnique({ where: { reference: response.body.reference }, include: { rooms: true } });
        const catalogueCents = row.sellTotalCents + row.taxTotalCents;
        assert.ok(catalogueCents > 1500);
        assert.equal(response.body.totalCents, catalogueCents - 1500, 'the buyer pays the adjusted total');
        assert.deepEqual(response.body.desk.priceAdjustment, { cents: -1500, reason: 'Loyal agency' });

        assert.equal(row.priceAdjustmentCents, -1500);
        assert.equal(row.rooms.reduce((sum, room) => sum + room.sellSubtotalCents, 0), row.sellTotalCents, 'rooms still add up');

        const receivable = await prisma.receivable.findUnique({ where: { hotelBookingId: row.id } });
        assert.equal(receivable.amountCents, catalogueCents - 1500, 'the ledger follows the adjusted total');
        assert.ok(await prisma.auditLog.findFirst({ where: { entityId: row.id, action: 'BOOKING_PRICE_ADJUSTED' } }));

        // Cancelling refunds what was paid for, never the catalogue price.
        const quote = await request(app).get(`/api/admin/bookings/${row.reference}`).set('Cookie', adminCookie);
        assert.equal(quote.body.totalCents, catalogueCents - 1500);
    });

    it('counts the adjusted total, not the catalogue price, in the approval queue and against the credit limit', async () => {
        const agency = await makePartner(tracker);
        const { offer } = await hotelOffer(adminCookie, { asPartner: agency.id });
        const surchargeCents = 50_000;

        const response = await manual({
            buyer: { kind: 'PARTNER', partnerId: agency.id },
            channel: 'PHONE',
            priceAdjustment: { cents: surchargeCents, reason: 'Private guide on request' },
            booking: { offerToken: offer.token, leadGuest: lead() }
        });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.status, 'PENDING_APPROVAL');

        const row = await prisma.hotelBooking.findUnique({ where: { reference: response.body.reference } });
        const catalogueCents = row.sellTotalCents + row.taxTotalCents;
        const owedCents = catalogueCents + surchargeCents;
        assert.equal(response.body.totalCents, owedCents);

        const queue = await request(app).get(`/api/admin/booking-approvals?search=${row.reference}`).set('Cookie', adminCookie);
        assert.equal(queue.status, 200, JSON.stringify(queue.body));
        assert.equal(queue.body.data.find((entry) => entry.reference === row.reference)?.totalCents, owedCents, 'the queue shows what the buyer pays');

        // A blocking limit between the catalogue price and what the agency will actually owe.
        await prisma.partner.update({ where: { id: agency.id }, data: { creditLimitCents: catalogueCents + 100, creditLimitCurrency: row.currency, creditLimitMode: 'BLOCK' } });

        const approve = () => request(app).post(`/api/admin/booking-approvals/HOTEL/${row.reference}/approve`).set('Cookie', adminCookie).send({});
        const refused = await approve();
        assert.equal(refused.status, 422, JSON.stringify(refused.body));
        assert.equal(refused.body.error.details.reason, 'CREDIT_LIMIT_EXCEEDED');
        assert.equal(refused.body.error.details.requestedCents, owedCents);
        assert.equal((await prisma.hotelBooking.findUnique({ where: { id: row.id } })).status, 'PENDING_APPROVAL', 'still waiting');

        // Room for all of it: the yes goes through, and the ledger opens the sum the check counted.
        await prisma.partner.update({ where: { id: agency.id }, data: { creditLimitCents: owedCents } });
        const approved = await approve();
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        assert.equal((await prisma.receivable.findUnique({ where: { hotelBookingId: row.id } })).amountCents, owedCents);
    });

    it('refuses an adjustment that takes the total below zero, for every product and for the cart', async () => {
        const agency = await makePartner(tracker);
        const envelope = (priceAdjustment, extra = {}) => ({ buyer: { kind: 'PARTNER', partnerId: agency.id }, channel: 'PHONE', priceAdjustment, ...extra });
        const below = { cents: -10_000_000, reason: 'More than the whole price' };
        const refused = (response) => {
            assert.equal(response.status, 422, JSON.stringify(response.body));
            assert.equal(response.body.error.details.reason, 'NEGATIVE_TOTAL');
            assert.equal(response.body.error.details.field, 'priceAdjustment');

            return response.body.error.details;
        };

        // A hotel, waiting for approval or confirmed at once: refused at creation, no room taken.
        const { offer, roomType } = await hotelOffer(adminCookie, { asPartner: agency.id });
        refused(await manual({ ...envelope(below), booking: { offerToken: offer.token, leadGuest: lead() } }));
        refused(await manual({ ...envelope(below, { confirmNow: true }), booking: { offerToken: offer.token, leadGuest: lead() } }));
        const rooms = await prisma.roomInventory.findMany({ where: { roomTypeId: roomType.id } });
        assert.ok(rooms.every((night) => night.bookedUnits === 0), 'nothing was claimed');

        const leg = await makeTransferLeg(tracker, { destination });
        const query = new URLSearchParams({ from: leg.from.slug, to: leg.to.slug, date: futureDate(12), time: '10:00', adults: '2', luggage: '2' });
        const transfer = (await request(app).get(`/api/transfers/quotes?${query}`).set('Cookie', adminCookie).set('X-Act-As-Partner', agency.id)).body.offers.find((entry) => entry.vehicle.slug === leg.vehicle.slug);
        refused(
            await request(app)
                .post('/api/admin/transfers/bookings/manual')
                .set('Cookie', adminCookie)
                .send({ ...envelope(below), booking: { quoteToken: transfer.token, leadPassenger: lead() } })
        );

        // Inside the fixture option's season (2027).
        const tourDate = '2027-05-11';
        const { tour } = await makeTourDeparture(tracker, { destination, date: tourDate });
        const tourOffer = (await request(app).get(`/api/search/tours/${tour.slug}?date=${tourDate}&adults=2`).set('Cookie', adminCookie).set('X-Act-As-Partner', agency.id)).body.options[0].dates[0];
        refused(await request(app).post('/api/admin/tours/bookings/manual').set('Cookie', adminCookie).send({ ...envelope(below), booking: { offerToken: tourOffer.token, leadTraveller: lead() } }));

        const service = await makeService(tracker, { destination });
        const serviceBooking = { serviceId: service.id, date: futureDate(20), pax: 2, lead: lead() };
        const serviceManual = (priceAdjustment) =>
            request(app).post('/api/admin/services/bookings/manual').set('Cookie', adminCookie).send({ ...envelope(priceAdjustment), booking: serviceBooking });
        const { catalogueCents } = refused(await serviceManual(below));

        // The cart at the desk: the adjustment against everything in it.
        refused(
            await request(app)
                .post('/api/admin/orders/custom/manual')
                .set('Cookie', adminCookie)
                .send({ ...envelope(below), booking: { items: [{ type: 'SERVICE', serviceId: service.id, date: serviceBooking.date, pax: 2 }], leadGuest: lead() } })
        );

        const partnerId = agency.id;
        const written = await Promise.all([
            prisma.hotelBooking.count({ where: { partnerId } }),
            prisma.transferBooking.count({ where: { partnerId } }),
            prisma.tourBooking.count({ where: { partnerId } }),
            prisma.serviceBooking.count({ where: { partnerId } }),
            prisma.order.count({ where: { partnerId } })
        ]);
        assert.deepEqual(written, [0, 0, 0, 0, 0], 'nothing was written for any of them');

        // Down to nothing is a price; one cent below it is not.
        refused(await serviceManual({ cents: -(catalogueCents + 1), reason: 'One cent too far' }));
        const free = await serviceManual({ cents: -catalogueCents, reason: 'On the house' });
        assert.equal(free.status, 201, JSON.stringify(free.body));
        assert.equal(free.body.totalCents, 0);
    });

    it('confirms at once only for someone who may approve, and books a transfer with its voucher', async () => {
        const leg = await makeTransferLeg(tracker, { destination });
        const query = new URLSearchParams({ from: leg.from.slug, to: leg.to.slug, date: futureDate(12), time: '10:00', adults: '2', luggage: '2' });
        const quotes = await request(app).get(`/api/transfers/quotes?${query}`).set('Cookie', adminCookie);
        const offer = quotes.body.offers.find((entry) => entry.vehicle.slug === leg.vehicle.slug);
        assert.ok(offer, 'the fixture vehicle should be quotable');
        clearOutbox();

        const body = {
            buyer: { kind: 'CUSTOMER', customer: { ...customer(), kind: 'INDIVIDUAL', name: 'Ana Beridze' } },
            channel: 'PHONE',
            confirmNow: true,
            booking: { quoteToken: offer.token, leadPassenger: { firstName: 'Ana', lastName: 'Beridze', email: `ana.${unique('t')}@example.test` }, flightNumber: 'TK 382' }
        };

        const response = await request(app).post('/api/admin/transfers/bookings/manual').set('Cookie', adminCookie).send(body);
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.status, 'CONFIRMED');
        assert.equal(outbox.filter((entry) => entry.template === 'transferConfirmed').length, 1, 'the voucher goes out as it would from the public route');

        // The desk's fields can be changed afterwards, and are audited.
        const desk = await request(app)
            .patch(`/api/admin/transfers/bookings/${response.body.reference}/desk`)
            .set('Cookie', adminCookie)
            .send({ assignedManagerUserId: admin.id, internalNotes: 'Meet at arrivals, gate B' });
        assert.equal(desk.status, 200, JSON.stringify(desk.body));
        assert.equal(desk.body.desk.assignedManager.id, admin.id);
        assert.equal(desk.body.desk.internalNotes, 'Meet at arrivals, gate B');
        const row = await prisma.transferBooking.findUnique({ where: { reference: response.body.reference } });
        assert.ok(await prisma.auditLog.findFirst({ where: { entityId: row.id, action: 'BOOKING_MANAGER_ASSIGNED' } }));
        assert.ok(await prisma.auditLog.findFirst({ where: { entityId: row.id, action: 'BOOKING_NOTES_CHANGED' } }));

        // A partner's user cannot be a manager; a guest cannot be assigned.
        const wrong = await request(app).patch(`/api/admin/transfers/bookings/${response.body.reference}/desk`).set('Cookie', adminCookie).send({ assignedManagerUserId: partnerUser.id });
        assert.equal(wrong.status, 422);
        assert.equal(wrong.body.error.details.reason, 'NOT_STAFF');
    });

    it('refuses an inactive partner, validates the envelope, and keeps the act-as header for the desk', async () => {
        const { offer, hotel } = await hotelOffer();
        const suspended = await makePartner(tracker, { status: 'SUSPENDED' });

        const asPartner = await request(app).get(`/api/search/hotels/${hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`).set('Cookie', partnerCookie).set('X-Act-As-Partner', partner.id);
        assert.equal(asPartner.status, 403, 'a partner cannot act as a partner');
        const asAnonymous = await request(app).get(`/api/search/hotels/${hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`).set('X-Act-As-Partner', partner.id);
        assert.equal(asAnonymous.status, 403);

        const inactive = await manual({ buyer: { kind: 'PARTNER', partnerId: suspended.id }, channel: 'PHONE', booking: { offerToken: offer.token, leadGuest: lead() } });
        assert.equal(inactive.status, 422);
        assert.equal(inactive.body.error.details.reason, 'PARTNER_INACTIVE');

        const both = await manual({ buyer: { kind: 'CUSTOMER', customerId: 'x', customer: customer() }, channel: 'PHONE', booking: { offerToken: offer.token, leadGuest: lead() } });
        assert.equal(both.status, 400);

        const noChannel = await manual({ buyer: { kind: 'PARTNER', partnerId: partner.id }, booking: { offerToken: offer.token, leadGuest: lead() } });
        assert.equal(noChannel.status, 400);

        const withAmount = await manual({ buyer: { kind: 'PARTNER', partnerId: partner.id }, channel: 'PHONE', booking: { offerToken: offer.token, leadGuest: lead(), totalCents: 1 } });
        assert.equal(withAmount.status, 400, 'the product body is as strict as ever: no amount');
    });

    it('tells the desk about the arrival as it would for any booking, minus the person who made it', async () => {
        const { offer } = await hotelOffer(adminCookie, { asPartner: partner.id });
        const response = await manual({ buyer: { kind: 'PARTNER', partnerId: partner.id }, channel: 'PHONE', confirmNow: true, booking: { offerToken: offer.token, leadGuest: lead() } });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        const row = await prisma.hotelBooking.findUnique({ where: { reference: response.body.reference } });

        for (const event of await prisma.outboxEvent.findMany({ where: { entityId: row.id }, orderBy: { createdAt: 'asc' } })) {
            await processEvent(event);
        }

        assert.equal(await prisma.notification.count({ where: { recipientUserId: admin.id, kind: 'BOOKING_NEW', entityId: row.id } }), 0, 'not told of their own booking');
        assert.equal(outbox.filter((entry) => entry.template === 'hotelBookingConfirmed' && entry.to === row.leadGuestEmail).length, 1, 'the guest gets the voucher');
    });
});
