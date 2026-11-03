import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import { createTracker, databaseAvailable, futureDate, makeAdmin, makeDestination, makePartner, makePartnerUser, signIn, unique } from './support/factories.js';
import { makeSellableHotel, makeService, makeTourDeparture, makeTransferLeg } from './support/packages.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const START = '2027-03-12';
const END = '2027-03-14';
const TOUR_DATE = '2027-03-13';

/**
 * The cart (OD2): hotels, transfers, tours and whole packages, booked as one
 * CUSTOM order. What these tests hold it to: one transaction and one
 * receivable for the lot; a package inside the cart keeps its group and its
 * discount, and nothing is counted twice; one currency per order; a replay is
 * the same order; the order is approved as one; and the desk's adjustment is
 * spread, audited, over the items.
 */
describe('custom orders (the cart)', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const saved = { ...config.booking };
    let adminCookie;
    let partner;
    let partnerCookie;
    let destination;
    let leg;

    before(async () => {
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;
        partner = await makePartner(tracker);
        partnerCookie = (await signIn(app, (await makePartnerUser(tracker, partner)).email)).cookie;
        destination = await makeDestination(tracker);
        leg = await makeTransferLeg(tracker, { destination });
    });

    after(async () => {
        Object.assign(config.booking, saved);
        await tracker.cleanup();
        await disconnect();
    });

    const lead = () => ({ firstName: 'Nino', lastName: 'Beridze', email: `nino.${unique('c')}@example.test` });

    const hotelOffer = async (cookie = partnerCookie, { currency = null, totalUnits = 5 } = {}) => {
        const sellable = await makeSellableHotel(app, adminCookie, tracker, { destination, checkIn: START, nights: 2, totalUnits });

        if (currency) {
            await prisma.ratePlan.update({ where: { id: sellable.ratePlan.id }, data: { currency } });
        }

        const offers = await request(app).get(`/api/search/hotels/${sellable.hotel.slug}?checkIn=${START}&checkOut=${END}&adults=2`).set('Cookie', cookie);
        assert.equal(offers.status, 200, JSON.stringify(offers.body));

        return { ...sellable, offer: offers.body.roomTypes[0].offers[0] };
    };

    const tourOffer = async (cookie = partnerCookie) => {
        const departure = await makeTourDeparture(tracker, { destination, date: TOUR_DATE });
        const search = await request(app).get(`/api/search/tours/${departure.tour.slug}?date=${TOUR_DATE}&adults=2`).set('Cookie', cookie);
        assert.equal(search.status, 200, JSON.stringify(search.body));

        return { ...departure, offer: search.body.options[0].dates[0] };
    };

    const transferQuote = async (cookie = partnerCookie) => {
        const query = new URLSearchParams({ from: leg.from.slug, to: leg.to.slug, date: START, time: '10:00', adults: '2', luggage: '2' });
        const quotes = await request(app).get(`/api/transfers/quotes?${query}`).set('Cookie', cookie);
        assert.equal(quotes.status, 200, JSON.stringify(quotes.body));
        const offer = quotes.body.offers.find((entry) => entry.vehicle.slug === leg.vehicle.slug);
        assert.ok(offer, 'the fixture vehicle should be quotable');

        return offer;
    };

    /** A published package with its own hotel and tour, quoted for the buyer. */
    const packageQuote = async (cookie = partnerCookie) => {
        const hotel = await makeSellableHotel(app, adminCookie, tracker, { destination, checkIn: START, nights: 3 });
        const tour = await makeTourDeparture(tracker, { destination, date: TOUR_DATE });
        const created = await request(app)
            .post('/api/admin/packages')
            .set('Cookie', adminCookie)
            .send({
                slug: `cart-${unique('p').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
                name: 'Weekend in the mountains',
                destinationId: destination.id,
                summary: 'Two nights and a trek.',
                image: '/images/packages/test.jpg',
                nights: 2,
                b2cEnabled: true,
                adjustmentKind: 'DISCOUNT_BPS',
                adjustmentValue: 300,
                components: [
                    { componentType: 'HOTEL_STAY', label: 'Two nights', nights: 2, hotelId: hotel.hotel.id },
                    { componentType: 'TOUR', label: 'The trek', dayOffset: 1, tourId: tour.tour.id }
                ]
            });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        tracker.package(created.body);
        await request(app).post(`/api/admin/packages/${created.body.id}/publish`).set('Cookie', adminCookie);

        const quote = await request(app).get(`/api/packages/${created.body.slug}/quote?startDate=${START}&adults=2`).set('Cookie', cookie);
        assert.equal(quote.status, 200, JSON.stringify(quote.body));
        assert.equal(quote.body.available, true, JSON.stringify(quote.body));

        return { pkg: created.body, hotel, tour, quote: quote.body };
    };

    const receivablesOf = (orderId) => prisma.receivable.findMany({ where: { orderId } });

    it('books a hotel, a transfer and a whole package as one order with one receivable', async () => {
        const hotel = await hotelOffer();
        const transfer = await transferQuote();
        const pkg = await packageQuote();

        const items = [
            { type: 'HOTEL_STAY', offerToken: hotel.offer.token },
            { type: 'TRANSFER', quoteToken: transfer.token, flights: { outbound: 'TK 382' } },
            { type: 'PACKAGE', packageToken: pkg.quote.token }
        ];

        // The cart page asks first; nothing is written.
        const quoted = await request(app).post('/api/orders/custom/quote').set('Cookie', partnerCookie).send({ items });
        assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
        assert.equal(quoted.body.available, true);
        assert.equal(quoted.body.currency, 'GEL');
        assert.equal(quoted.body.items.length, 4, 'one hotel, one transfer, and the package flattened into its two components');
        assert.equal(quoted.body.priceChanged, false);
        assert.equal(
            quoted.body.totals.sellTotalCents,
            quoted.body.items.reduce((sum, item) => sum + item.lineTotalCents, 0),
            'the order is the sum of its lines'
        );
        assert.equal(
            quoted.body.items.filter((item) => item.groupKey).reduce((sum, item) => sum + item.lineTotalCents, 0),
            pkg.quote.totals.sellTotalCents,
            'the package costs in the cart what it costs on its own: nothing counted twice'
        );
        assert.equal(quoted.body.items.find((item) => item.type === 'TRANSFER').currentCents, transfer.quote.totals.sellCents);
        assert.equal(quoted.body.totals.componentsNetCents, undefined, 'a partner never sees the supplier net');

        const response = await request(app).post('/api/orders/custom').set('Cookie', partnerCookie).send({ items, leadGuest: lead(), name: 'Spring break' });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.kind, 'CUSTOM');
        assert.equal(response.body.status, 'CONFIRMED');
        assert.equal(response.body.package.id, null, 'a custom order has no package of its own');
        assert.equal(response.body.items.length, 4);
        assert.equal(response.body.startDate, START);
        assert.equal(response.body.endDate, END, 'the order spans the longest item');

        const grouped = response.body.items.filter((item) => item.groupKey);
        const own = response.body.items.filter((item) => !item.groupKey);
        assert.equal(grouped.length, 2, 'the package components keep their group');
        assert.equal(own.length, 2);
        assert.ok(grouped.every((item) => item.packageId === pkg.pkg.id && item.adjustmentSource === 'PACKAGE' && item.adjustmentCents < 0));
        assert.ok(own.every((item) => item.packageId === null && item.adjustmentSource === 'NONE' && item.adjustmentCents === 0));
        assert.equal(new Set(grouped.map((item) => item.groupKey)).size, 1);
        assert.equal(
            grouped.reduce((sum, item) => sum + item.adjustmentCents, 0),
            pkg.quote.totals.adjustmentCents,
            'the package discount is the package quote’s, allocated over its own components and nowhere else'
        );
        assert.equal(response.body.adjustmentCents, pkg.quote.totals.adjustmentCents);
        assert.equal(response.body.totalCents, quoted.body.totals.sellTotalCents);

        const row = await prisma.order.findUnique({ where: { reference: response.body.reference } });
        assert.equal(row.kind, 'CUSTOM');
        assert.equal(row.packageId, null);
        assert.equal(row.partnerId, partner.id);
        assert.deepEqual(row.packageSnapshot.name, 'Spring break');

        const receivables = await receivablesOf(row.id);
        assert.equal(receivables.length, 1, 'one receivable for the lot');
        assert.equal(receivables[0].amountCents, row.sellTotalCents);
        assert.equal(response.body.payment?.status, 'UNPAID');

        // Every child points back at this order, and none has a receivable of its own.
        const children = await prisma.orderItem.findMany({ where: { orderId: row.id }, select: { hotelBookingId: true, transferBookingId: true, tourBookingId: true, serviceBookingId: true } });
        const hotelIds = children.map((item) => item.hotelBookingId).filter(Boolean);
        assert.equal(hotelIds.length, 2);
        assert.equal(await prisma.receivable.count({ where: { hotelBookingId: { in: hotelIds } } }), 0);

        // The transfer's leg carries its flight, as a transfer booked alone would.
        const transferId = children.find((item) => item.transferBookingId).transferBookingId;
        const legs = await prisma.transferBookingLeg.findMany({ where: { bookingId: transferId } });
        assert.equal(legs[0].flightNumber, 'TK 382');

        // A replay is the same order.
        const again = await request(app).post('/api/orders/custom').set('Cookie', partnerCookie).send({ items, leadGuest: { ...lead(), email: response.body.leadEmail ?? row.leadEmail } });
        assert.equal(again.status, 200, JSON.stringify(again.body));
        assert.equal(again.body.reference, response.body.reference);
    });

    it('refuses a cart that mixes currencies, and reports an item that went away', async () => {
        const gel = await hotelOffer();
        const usd = await hotelOffer(partnerCookie, { currency: 'USD' });

        const mixed = await request(app)
            .post('/api/orders/custom')
            .set('Cookie', partnerCookie)
            .send({ items: [{ type: 'HOTEL_STAY', offerToken: gel.offer.token }, { type: 'HOTEL_STAY', offerToken: usd.offer.token }], leadGuest: lead() });
        assert.equal(mixed.status, 422, JSON.stringify(mixed.body));
        assert.equal(mixed.body.error?.details?.reason, 'MIXED_CURRENCY');
        assert.deepEqual([...mixed.body.error.details.currencies].sort(), ['GEL', 'USD']);

        const quoted = await request(app).post('/api/orders/custom/quote').set('Cookie', partnerCookie).send({ items: [{ type: 'HOTEL_STAY', offerToken: gel.offer.token }, { type: 'HOTEL_STAY', offerToken: usd.offer.token }] });
        assert.equal(quoted.status, 200);
        assert.equal(quoted.body.available, false);
        assert.equal(quoted.body.reason, 'MIXED_CURRENCY');

        // A tour whose seats are gone: the whole cart is refused, naming the item.
        const tour = await tourOffer();
        await prisma.tourInventory.update({
            where: { tourOptionId_date: { tourOptionId: tour.option.id, date: new Date(`${TOUR_DATE}T00:00:00.000Z`) } },
            data: { totalUnits: 0 }
        });
        const gone = await request(app)
            .post('/api/orders/custom')
            .set('Cookie', partnerCookie)
            .send({ items: [{ type: 'HOTEL_STAY', offerToken: gel.offer.token }, { type: 'TOUR', offerToken: tour.offer.token }], leadGuest: lead() });
        assert.equal(gone.status, 409, JSON.stringify(gone.body));
        assert.equal(gone.body.error?.details?.reason, 'UNAVAILABLE');
        assert.equal(gone.body.error.details.items[0].index, 1);
        assert.equal(gone.body.error.details.items[0].type, 'TOUR');
        assert.equal(await prisma.hotelBooking.count({ where: { partnerId: partner.id, hotelId: gel.hotel.id } }), 0, 'nothing of a refused cart is written');
    });

    it('holds the rooms and seats for the checkout, books from the holds, and lets them go', async () => {
        const hotel = await hotelOffer(partnerCookie, { totalUnits: 1 });
        const tour = await tourOffer();
        const transfer = await transferQuote();
        const items = [{ type: 'HOTEL_STAY', offerToken: hotel.offer.token }, { type: 'TOUR', offerToken: tour.offer.token }, { type: 'TRANSFER', quoteToken: transfer.token }];

        const held = await request(app).post('/api/orders/custom/holds').set('Cookie', partnerCookie).send({ items });
        assert.equal(held.status, 201, JSON.stringify(held.body));
        assert.ok(held.body.holds['0'] && held.body.holds['1'], 'the hotel and the tour are held');
        assert.equal(held.body.holds['2'], undefined, 'a transfer needs no hold');
        assert.ok(held.body.expiresAt);

        // Held, the last room is not for sale to anyone else.
        const other = await request(app).get(`/api/search/hotels/${hotel.hotel.slug}?checkIn=${START}&checkOut=${END}&adults=2`);
        assert.equal(other.body.roomTypes?.[0]?.offers?.length ?? 0, 0, 'the held room is off the market');

        const response = await request(app)
            .post('/api/orders/custom')
            .set('Cookie', partnerCookie)
            .send({ items: items.map((item, index) => (held.body.holds[String(index)] ? { ...item, holdToken: held.body.holds[String(index)] } : item)), leadGuest: lead() });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.items.length, 3);

        const release = await request(app).delete('/api/orders/custom/holds').set('Cookie', partnerCookie).send({ holds: held.body.holds });
        assert.equal(release.status, 204);
    });

    it('is approved as one order, and only then carries a receivable', async () => {
        config.booking.approvalEnabled = true;

        try {
            const hotel = await hotelOffer();
            const tour = await tourOffer();
            const response = await request(app)
                .post('/api/orders/custom')
                .set('Cookie', partnerCookie)
                .send({ items: [{ type: 'HOTEL_STAY', offerToken: hotel.offer.token }, { type: 'TOUR', offerToken: tour.offer.token }], leadGuest: lead() });
            assert.equal(response.status, 201, JSON.stringify(response.body));
            assert.equal(response.body.status, 'PENDING_APPROVAL');
            assert.ok(response.body.items.every((item) => item.status === 'AWAITING_APPROVAL'));
            assert.equal(response.body.payment?.status, 'NONE');

            const row = await prisma.order.findUnique({ where: { reference: response.body.reference } });
            assert.equal((await receivablesOf(row.id)).length, 0, 'nothing is owed while the order waits');

            const approved = await request(app).post(`/api/admin/booking-approvals/ORDER/${response.body.reference}/approve`).set('Cookie', adminCookie).send({});
            assert.equal(approved.status, 200, JSON.stringify(approved.body));
            assert.equal(approved.body.status, 'CONFIRMED');
            assert.ok(approved.body.items.every((item) => item.status === 'CONFIRMED'));
            assert.equal((await receivablesOf(row.id)).length, 1);
            assert.equal(approved.body.payment?.status, 'UNPAID');
        } finally {
            config.booking.approvalEnabled = saved.approvalEnabled;
        }
    });

    it('is booked at the desk for a partner, with the adjustment spread over the items and audited', async () => {
        const hotel = await hotelOffer(adminCookie);
        const transfer = await transferQuote(adminCookie);
        const body = {
            buyer: { kind: 'PARTNER', partnerId: partner.id },
            channel: 'PHONE',
            confirmNow: true,
            priceAdjustment: { cents: -1500, reason: 'Loyal agency, agreed by phone' },
            internalNotes: 'Called twice.',
            booking: { items: [{ type: 'HOTEL_STAY', offerToken: hotel.offer.token }, { type: 'TRANSFER', quoteToken: transfer.token }], leadGuest: lead() }
        };

        // Searched as the admin, booked for the partner: the price is the
        // partner's, so the offer is priced for them before it is booked.
        const forPartner = await request(app).get(`/api/search/hotels/${hotel.hotel.slug}?checkIn=${START}&checkOut=${END}&adults=2`).set('Cookie', adminCookie).set('X-Act-As-Partner', partner.id);
        body.booking.items[0].offerToken = forPartner.body.roomTypes[0].offers[0].token;
        const transferForPartner = await request(app)
            .get(`/api/transfers/quotes?${new URLSearchParams({ from: leg.from.slug, to: leg.to.slug, date: START, time: '10:00', adults: '2', luggage: '2' })}`)
            .set('Cookie', adminCookie)
            .set('X-Act-As-Partner', partner.id);
        body.booking.items[1].quoteToken = transferForPartner.body.offers.find((entry) => entry.vehicle.slug === leg.vehicle.slug).token;

        // The desk re-prices the cart as the buyer too: the partner's tokens are not drift.
        const asBuyer = await request(app).post('/api/orders/custom/quote').set('Cookie', adminCookie).set('X-Act-As-Partner', partner.id).send({ items: body.booking.items });
        assert.equal(asBuyer.status, 200, JSON.stringify(asBuyer.body));
        assert.equal(asBuyer.body.available, true);
        assert.equal(asBuyer.body.priceChanged, false, 'quoted as the partner, the partner’s offers hold their price');

        const response = await request(app).post('/api/admin/orders/custom/manual').set('Cookie', adminCookie).send(body);
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.kind, 'CUSTOM');
        assert.equal(response.body.status, 'CONFIRMED', 'confirmed at once by someone who may approve');
        assert.equal(response.body.adjustmentCents, -1500);
        assert.equal(response.body.items.reduce((sum, item) => sum + item.adjustmentCents, 0), -1500, 'the lines add up to the order');
        assert.ok(response.body.items.every((item) => item.adjustmentSource === 'MANUAL'));
        assert.equal(response.body.desk?.source, 'PHONE');

        const row = await prisma.order.findUnique({ where: { reference: response.body.reference } });
        assert.equal(row.sellTotalCents, row.componentsSellCents - 1500);
        assert.equal(row.partnerId, partner.id);
        assert.equal(row.internalNotes, 'Called twice.');
        const receivables = await receivablesOf(row.id);
        assert.equal(receivables.length, 1);
        assert.equal(receivables[0].amountCents, row.sellTotalCents);
        assert.equal(receivables[0].debtorPartnerId, partner.id);

        const audit = await prisma.auditLog.findFirst({ where: { entityId: row.id, action: 'BOOKING_PRICE_ADJUSTED' } });
        assert.ok(audit, 'the adjustment is audited');
        assert.equal(audit.metadata.adjustmentCents, -1500);

        // A partner may not change the price, whoever they are.
        const partnerTry = await request(app).post('/api/admin/orders/custom/manual').set('Cookie', partnerCookie).send(body);
        assert.equal(partnerTry.status, 403);
    });

    it('takes a desk discount larger than the cart’s own items onto the package lines, never a line below zero (RA-04)', async () => {
        const pkg = await packageQuote();
        const service = await makeService(tracker, { destination });
        const items = [
            { type: 'PACKAGE', packageToken: pkg.quote.token },
            { type: 'SERVICE', serviceId: service.id, date: TOUR_DATE, pax: 2 }
        ];

        const quoted = await request(app).post('/api/orders/custom/quote').set('Cookie', partnerCookie).send({ items });
        assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
        assert.equal(quoted.body.available, true, JSON.stringify(quoted.body));
        const total = quoted.body.totals.sellTotalCents;
        const serviceCents = quoted.body.items.find((item) => item.type === 'SERVICE').lineTotalCents;
        // More than the service costs, less than the order: a discount the
        // order can carry, which the service alone cannot.
        const discount = serviceCents + 1_000;
        assert.ok(discount < total, `${discount} < ${total}`);

        const response = await request(app)
            .post('/api/admin/orders/custom/manual')
            .set('Cookie', adminCookie)
            .send({
                buyer: { kind: 'PARTNER', partnerId: partner.id },
                channel: 'PHONE',
                priceAdjustment: { cents: -discount, reason: 'The service thrown in, and a little more' },
                booking: { items, leadGuest: lead() }
            });
        // Before the fix: 409 "The request conflicts with current availability"
        // (the CHECK on order_items refusing the service line at −10.00).
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.totalCents, total - discount);
        assert.ok(response.body.items.every((item) => item.lineTotalCents >= 0), 'no line below zero');
        assert.equal(response.body.items.reduce((sum, item) => sum + item.lineTotalCents, 0), total - discount, 'the lines add up to the order');
        assert.equal(response.body.items.find((item) => item.componentType === 'SERVICE').lineTotalCents, 0, 'the service is given away first');
        const grouped = response.body.items.filter((item) => item.groupKey);
        assert.equal(
            grouped.reduce((sum, item) => sum + item.adjustmentCents, 0),
            pkg.quote.totals.adjustmentCents - 1_000,
            'what the service could not carry falls on the package lines'
        );

        const row = await prisma.order.findUnique({ where: { reference: response.body.reference } });
        assert.equal(row.sellTotalCents, total - discount);
        const [receivable] = await receivablesOf(row.id);
        assert.equal(receivable.amountCents, total - discount);
    });

    it('books a package at the desk at the agreed price, on the order, its lines, the receivable and the audit (BUG-08)', async () => {
        const { quote } = await packageQuote();
        const manualOrder = (cents) =>
            request(app)
                .post('/api/admin/orders/manual')
                .set('Cookie', adminCookie)
                .send({
                    buyer: { kind: 'PARTNER', partnerId: partner.id },
                    channel: 'PHONE',
                    priceAdjustment: { cents, reason: 'Agreed by phone' },
                    booking: { packageToken: quote.token, leadGuest: lead() }
                });

        // Below zero is refused before anything is written, as for every other product.
        const tooMuch = await manualOrder(-(quote.totals.sellTotalCents + 1));
        assert.equal(tooMuch.status, 422, JSON.stringify(tooMuch.body));
        assert.equal(tooMuch.body.error.details.reason, 'NEGATIVE_TOTAL');

        const response = await manualOrder(-2_500);
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.kind, 'PACKAGE');
        // Before the fix the order was written at the package price: the adjustment was dropped.
        assert.equal(response.body.totalCents, quote.totals.sellTotalCents - 2_500);
        assert.equal(response.body.adjustmentCents, quote.totals.adjustmentCents - 2_500);
        assert.equal(response.body.items.reduce((sum, item) => sum + item.adjustmentCents, 0), response.body.adjustmentCents, 'the lines carry it');
        assert.equal(response.body.items.reduce((sum, item) => sum + item.lineTotalCents, 0), response.body.totalCents);
        assert.ok(response.body.items.every((item) => item.lineTotalCents >= 0));

        const row = await prisma.order.findUnique({ where: { reference: response.body.reference } });
        assert.equal(row.sellTotalCents, quote.totals.sellTotalCents - 2_500);
        const [receivable] = await receivablesOf(row.id);
        assert.equal(receivable.amountCents, row.sellTotalCents, 'the partner owes the agreed price');

        const audit = await prisma.auditLog.findFirst({ where: { entityId: row.id, action: 'BOOKING_PRICE_ADJUSTED' } });
        assert.ok(audit, 'the adjustment is audited');
        assert.equal(audit.metadata.adjustmentCents, -2_500);
        assert.equal(audit.metadata.catalogueCents, quote.totals.sellTotalCents);
    });

    it('tells the cart an offer whose price expired apart from one that is gone (BUG-06)', async () => {
        const { offer, option } = await tourOffer();
        const items = [{ type: 'TOUR', offerToken: offer.token }];
        const saved = config.tour.offerTokenTtlMs;

        const fresh = await request(app).post('/api/orders/custom/quote').set('Cookie', partnerCookie).send({ items });
        assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
        assert.equal(fresh.body.available, true);

        // Thirty minutes later, as far as the token is concerned.
        config.tour.offerTokenTtlMs = -1;

        try {
            const stale = await request(app).post('/api/orders/custom/quote').set('Cookie', partnerCookie).send({ items });
            assert.equal(stale.status, 200, JSON.stringify(stale.body));
            assert.equal(stale.body.available, false);
            assert.equal(stale.body.items[0].reason, 'OFFER_EXPIRED', 'an expired price, not "no longer available"');

            // The product's own endpoint says the same in its 410.
            const direct = await request(app).post('/api/tours/bookings').set('Cookie', partnerCookie).send({ offerToken: offer.token, leadTraveller: lead() });
            assert.equal(direct.status, 410, JSON.stringify(direct.body));
            assert.equal(direct.body.error.details.reason, 'OFFER_EXPIRED');
        } finally {
            config.tour.offerTokenTtlMs = saved;
        }

        // A departure that really went is still reported as gone, not as expired.
        await prisma.tourInventory.updateMany({ where: { tourOptionId: option.id }, data: { totalUnits: 0 } });
        const gone = await request(app).post('/api/orders/custom/quote').set('Cookie', partnerCookie).send({ items });
        assert.equal(gone.status, 200, JSON.stringify(gone.body));
        assert.equal(gone.body.available, false);
        assert.notEqual(gone.body.items[0].reason, 'OFFER_EXPIRED');
    });

    it('lets the partner cancel their own standalone item, but not a package’s required component', async () => {
        const hotel = await hotelOffer();
        const pkg = await packageQuote();
        const response = await request(app)
            .post('/api/orders/custom')
            .set('Cookie', partnerCookie)
            .send({ items: [{ type: 'HOTEL_STAY', offerToken: hotel.offer.token }, { type: 'PACKAGE', packageToken: pkg.quote.token }], leadGuest: lead() });
        assert.equal(response.status, 201, JSON.stringify(response.body));

        const own = response.body.items.find((item) => !item.groupKey);
        const required = response.body.items.find((item) => item.groupKey && item.required);
        assert.ok(own && required);

        const refused = await request(app).post(`/api/orders/${response.body.reference}/items/${required.slotIndex}/cancel`).set('Cookie', partnerCookie).send({});
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.error.details.reason, 'REQUIRED_COMPONENT');

        const cancelled = await request(app).post(`/api/orders/${response.body.reference}/items/${own.slotIndex}/cancel`).set('Cookie', partnerCookie).send({});
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        assert.equal(cancelled.body.items.find((item) => item.slotIndex === own.slotIndex).status, 'CANCELLED');
        assert.equal(cancelled.body.status, 'PARTIALLY_CANCELLED');
    });

    it('is quoted on the public site as a guest, and booked with the guest’s email as the door', async () => {
        const hotel = await hotelOffer(undefined);
        const search = await request(app).get(`/api/search/hotels/${hotel.hotel.slug}?checkIn=${START}&checkOut=${END}&adults=2`);
        const guestLead = lead();
        const response = await request(app).post('/api/orders/custom').send({ items: [{ type: 'HOTEL_STAY', offerToken: search.body.roomTypes[0].offers[0].token }], leadGuest: guestLead });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.kind, 'CUSTOM');

        const read = await request(app).get(`/api/orders/${response.body.reference}?email=${encodeURIComponent(guestLead.email)}`);
        assert.equal(read.status, 200);
        const stranger = await request(app).get(`/api/orders/${response.body.reference}?email=${encodeURIComponent(`else.${unique('g')}@example.test`)}`);
        assert.equal(stranger.status, 404);
        assert.equal(futureDate(1) > '2026', true);
    });

    it('keys a cart of services on everything that books them, never replays one to a stranger, and books it again after a cancellation', async () => {
        const service = await makeService(tracker, { destination });
        const item = { type: 'SERVICE', serviceId: service.id, date: TOUR_DATE, pax: 2 };
        const buyer = lead();
        const checkout = (body, key = null) => {
            const post = request(app).post('/api/orders/custom').send(body);

            return key ? post.set('Idempotency-Key', key) : post;
        };

        const plain = await checkout({ items: [item], leadGuest: buyer });
        assert.equal(plain.status, 201, JSON.stringify(plain.body));

        // A service line carries nothing secret: somebody who knows the
        // buyer's email and surname, the service and the date books an order
        // of their own, and learns nothing about this one.
        const stranger = await checkout({ items: [item], leadGuest: { ...buyer, firstName: 'Somebody' } });
        assert.equal(stranger.status, 201, JSON.stringify(stranger.body));
        assert.notEqual(stranger.body.reference, plain.body.reference);

        // Six people are a different booking from two.
        const six = await checkout({ items: [{ ...item, pax: 6 }], leadGuest: buyer });
        assert.equal(six.status, 201, JSON.stringify(six.body));
        assert.notEqual(six.body.reference, plain.body.reference);
        const sixRow = await prisma.order.findUnique({ where: { reference: six.body.reference }, include: { items: { include: { serviceBooking: true } } } });
        assert.equal(sixRow.items[0].serviceBooking.pax, 6);

        // Cancelled, then booked again: a new order, never the cancelled one.
        const cancelled = await request(app).post(`/api/orders/${plain.body.reference}/cancel`).send({ email: buyer.email });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        const again = await checkout({ items: [item], leadGuest: buyer });
        assert.equal(again.status, 201, JSON.stringify(again.body));
        assert.notEqual(again.body.reference, plain.body.reference);
        assert.equal(again.body.status, 'CONFIRMED');

        // A key the client sends still makes a double click one order.
        const key = `cart-${unique('k')}`;
        const keyed = await checkout({ items: [item], leadGuest: buyer }, key);
        assert.equal(keyed.status, 201, JSON.stringify(keyed.body));
        const replay = await checkout({ items: [item], leadGuest: buyer }, key);
        assert.equal(replay.status, 200, JSON.stringify(replay.body));
        assert.equal(replay.body.reference, keyed.body.reference);
    });

    it('books a cart again once its order was cancelled, and still replays a retry of the new booking', async () => {
        const { offer } = await hotelOffer();
        const body = { items: [{ type: 'HOTEL_STAY', offerToken: offer.token }], leadGuest: lead() };
        const checkout = () => request(app).post('/api/orders/custom').set('Cookie', partnerCookie).send(body);
        const cancel = (reference) => request(app).post(`/api/orders/${reference}/cancel`).set('Cookie', partnerCookie).send({});

        const first = await checkout();
        assert.equal(first.status, 201, JSON.stringify(first.body));
        const retry = await checkout();
        assert.equal(retry.status, 200, 'a signed token keeps the derived key a replay');
        assert.equal(retry.body.reference, first.body.reference);

        let previous = first.body.reference;

        // Twice round: each cancellation makes way for one new order, and only one.
        for (let round = 0; round < 2; round += 1) {
            assert.equal((await cancel(previous)).status, 200);

            const next = await checkout();
            assert.equal(next.status, 201, JSON.stringify(next.body));
            assert.notEqual(next.body.reference, previous);
            assert.equal(next.body.status, 'CONFIRMED');

            const nextRetry = await checkout();
            assert.equal(nextRetry.status, 200, JSON.stringify(nextRetry.body));
            assert.equal(nextRetry.body.reference, next.body.reference);

            previous = next.body.reference;
        }
    });

    it('replays a signed-in partner’s cart of services without a key, and never across companies', async () => {
        const service = await makeService(tracker, { destination });
        const body = { items: [{ type: 'SERVICE', serviceId: service.id, date: TOUR_DATE, pax: 2 }], leadGuest: lead() };
        const checkout = (cookie = partnerCookie) => request(app).post('/api/orders/custom').set('Cookie', cookie).send(body);

        // A double click: one order, the second answer a replay of it.
        const clicks = await Promise.all([checkout(), checkout()]);
        assert.deepEqual(clicks.map((response) => response.status).sort(), [200, 201], JSON.stringify(clicks.map((response) => response.body)));
        assert.equal(clicks[0].body.reference, clicks[1].body.reference);
        const retry = await checkout();
        assert.equal(retry.status, 200, JSON.stringify(retry.body));
        assert.equal(retry.body.reference, clicks[0].body.reference);

        // Another company, the same lead and the same service: its own order, nothing of the first.
        const otherCookie = (await signIn(app, (await makePartnerUser(tracker, await makePartner(tracker))).email)).cookie;
        const theirs = await checkout(otherCookie);
        assert.equal(theirs.status, 201, JSON.stringify(theirs.body));
        assert.notEqual(theirs.body.reference, clicks[0].body.reference);

        // Cancelled, then booked again: a new order, and a retry of that replays it.
        assert.equal((await request(app).post(`/api/orders/${clicks[0].body.reference}/cancel`).set('Cookie', partnerCookie).send({})).status, 200);
        const again = await checkout();
        assert.equal(again.status, 201, JSON.stringify(again.body));
        assert.notEqual(again.body.reference, clicks[0].body.reference);
        const againRetry = await checkout();
        assert.equal(againRetry.status, 200, JSON.stringify(againRetry.body));
        assert.equal(againRetry.body.reference, again.body.reference);
    });

    it('turns a stranger away at once, without queueing behind the order’s lock', async () => {
        const service = await makeService(tracker, { destination });
        const guest = lead();
        const placed = await request(app).post('/api/orders/custom').send({ items: [{ type: 'SERVICE', serviceId: service.id, date: TOUR_DATE, pax: 2 }], leadGuest: guest });
        assert.equal(placed.status, 201, JSON.stringify(placed.body));
        const row = await prisma.order.findUnique({ where: { reference: placed.body.reference } });

        // Somebody else is in the middle of changing the order: its row is locked.
        let locked;
        let release;
        const lockTaken = new Promise((resolve) => { locked = resolve; });
        const released = new Promise((resolve) => { release = resolve; });
        let holderDone = false;
        const holder = prisma
            .$transaction(async (tx) => {
                await tx.$queryRaw`SELECT id FROM orders WHERE id = ${row.id} FOR UPDATE`;
                locked();
                await Promise.race([released, new Promise((resolve) => setTimeout(resolve, 5_000))]);
            }, { timeout: 10_000 })
            .then(() => { holderDone = true; });
        await lockTaken;

        const stranger = await request(app).post(`/api/orders/${placed.body.reference}/cancel`).send({ email: `else.${unique('g')}@example.test` });
        const answeredWhileLocked = !holderDone;
        release();
        await holder;

        assert.equal(stranger.status, 404, JSON.stringify(stranger.body));
        assert.ok(answeredWhileLocked, 'the stranger is answered without waiting for the lock');

        // The buyer, by contrast, may cancel once the lock is free.
        const cancelled = await request(app).post(`/api/orders/${placed.body.reference}/cancel`).send({ email: guest.email });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    });
});
