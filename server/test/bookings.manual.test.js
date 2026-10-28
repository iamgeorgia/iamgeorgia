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
import { makeSellableHotel, makeTransferLeg } from './support/packages.js';

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

    after(async () => {
        Object.assign(config.booking, saved);
        await tracker.cleanup();
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
