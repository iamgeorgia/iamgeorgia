import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { buildLines, buyerFor, langFor } from '../services/invoicing/invoice.service.js';

/**
 * What goes on the document, per product and per buyer — the pure parts of
 * the invoice service — and what the configuration refuses at boot.
 *
 * Every line carries a one-line `description`, and a `detail` with the
 * structured fields and the multi-line `text` the provider prints under it
 * (owner decision OD4). Lines always add up to what is owed.
 */

const base = { reference: 'REF-1', amountCents: 10_000, currency: 'GEL', debtorName: 'Nino Guest', debtorEmail: 'nino@example.test', debtorPartner: null, debtorPartnerId: null, debtorCustomer: null, debtorCustomerId: null };
const sum = (lines) => lines.reduce((total, line) => total + line.totalGrossCents, 0);

const hotel = (overrides = {}) => ({
    reference: 'BKG-1',
    status: 'CONFIRMED',
    hotelSnapshot: { name: 'Rooms Hotel', countryCode: 'GE', checkIn: { from: '15:00', until: null }, checkOut: { from: null, until: '12:00' } },
    hotel: { destination: { name: 'Tbilisi', countryCode: 'GE' } },
    checkIn: new Date('2026-12-01T00:00:00Z'),
    checkOut: new Date('2026-12-05T00:00:00Z'),
    nights: 4,
    sellTotalCents: 9_000,
    taxTotalCents: 1_000,
    priceAdjustmentCents: 0,
    rooms: [
        {
            status: 'CONFIRMED',
            roomTypeName: 'Deluxe Double Room',
            ratePlanName: 'Breakfast, flexible',
            mealPlanCode: 'BB',
            mealPlanName: 'Breakfast Included',
            adults: 2,
            childAges: [],
            sellSubtotalCents: 9_000,
            guests: [
                { title: 'MR', firstName: 'Giorgi', lastName: 'Beridze', type: 'ADULT', isLead: true },
                { title: 'MRS', firstName: 'Nino', lastName: 'Beridze', type: 'ADULT', isLead: false }
            ]
        }
    ],
    ...overrides
});

describe('invoice lines', () => {
    it('describes a hotel room with its city, meal plan, dates, times and PAX', () => {
        const [line] = buildLines({ ...base, hotelBooking: hotel() }, { taxRateBps: 1800 });

        assert.equal(line.kind, 'HOTEL_ROOM');
        assert.equal(line.description, 'Rooms Hotel · Deluxe Double Room, Breakfast Included · 01.12.2026 – 05.12.2026 (4 nights) · BKG-1');
        assert.deepEqual([line.quantity, line.unitCents, line.taxRateBps, line.totalGrossCents, line.bookingReference], [4, 2_500, 1800, 10_000, 'REF-1']);
        assert.equal(line.detail.hotel.city, 'Tbilisi');
        assert.equal(line.detail.hotel.country, 'GE');
        assert.deepEqual(line.detail.pax.map((p) => p.text), ['BERIDZE / GIORGI MR.', 'BERIDZE / NINO MRS.']);
        assert.equal(
            line.detail.text,
            'HOTEL Rooms Hotel · GE / Tbilisi\nRoom: Deluxe Double Room · Meal plan: Breakfast Included\nCheck-in 01.12.2026 / 15:00 · Check-out 05.12.2026 / 12:00 · 4 nights\nPAX: BERIDZE / GIORGI MR., BERIDZE / NINO MRS.'
        );
    });

    it('writes one line per room that add up to what is owed, and leaves a title out when there is none', () => {
        const two = hotel({
            sellTotalCents: 9_000,
            rooms: [
                { ...hotel().rooms[0], sellSubtotalCents: 4_500, guests: [{ firstName: 'Ana', lastName: 'Kapanadze', type: 'ADULT', isLead: true }, { firstName: 'Luka', lastName: 'Kapanadze', type: 'CHILD', age: 7 }] },
                { ...hotel().rooms[0], roomTypeName: 'Standard Twin', sellSubtotalCents: 4_500, guests: [] }
            ]
        });
        const lines = buildLines({ ...base, amountCents: 10_001, hotelBooking: two }, { taxRateBps: 1800 });

        assert.equal(lines.length, 2);
        assert.equal(sum(lines), 10_001, 'largest remainder: the odd cent lands somewhere');
        assert.ok(lines[0].detail.text.includes('Room 1 of 2'));
        assert.deepEqual(lines[0].detail.pax.map((p) => p.text), ['KAPANADZE / ANA', 'KAPANADZE / LUKA (CHD 7)']);
        assert.ok(!lines[1].detail.text.includes('PAX:'), 'no names, no PAX line');
    });

    it('puts the desk\'s adjustment on its own line and a cancellation on one line for the charge', () => {
        const discounted = buildLines({ ...base, amountCents: 8_500, hotelBooking: hotel({ priceAdjustmentCents: -1_500, priceAdjustmentReason: 'Loyal agency' }) }, { taxRateBps: 1800 });
        assert.equal(discounted.length, 2);
        assert.equal(discounted[0].totalGrossCents, 10_000, 'the room at the catalogue price');
        assert.deepEqual([discounted[1].kind, discounted[1].totalGrossCents, discounted[1].description], ['ADJUSTMENT', -1_500, 'Discount: Loyal agency · BKG-1']);
        assert.equal(sum(discounted), 8_500);

        const cancelled = buildLines({ ...base, amountCents: 3_000, hotelBooking: hotel({ status: 'CANCELLED', cancellationChargeCents: 3_000 }) }, { taxRateBps: 1800 });
        assert.equal(cancelled.length, 1);
        assert.equal(cancelled[0].kind, 'CANCELLATION_CHARGE');
        assert.equal(cancelled[0].totalGrossCents, 3_000);
    });

    it('describes a transfer leg by leg: arrival and departure, flight, vehicle, passengers, in the airport\'s own time', () => {
        const transfer = {
            reference: 'TRF-1',
            status: 'CONFIRMED',
            pickupAt: new Date('2026-12-01T21:30:00Z'),
            returnPickupAt: new Date('2026-12-05T06:00:00Z'),
            adults: 2,
            children: 1,
            flightNumber: 'TK 382',
            routeSnapshot: { fromName: 'Tbilisi Airport', toName: 'Tbilisi', fromTimezone: 'Asia/Tbilisi' },
            vehicleSnapshot: { name: 'Minivan' },
            sellTotalCents: 40_000,
            priceAdjustmentCents: 0,
            legs: [
                { direction: 'OUTBOUND', fromPointName: 'Tbilisi Airport', toPointName: 'Tbilisi', pickupAt: new Date('2026-12-01T21:30:00Z'), sellCents: 20_000, flightNumber: 'TK 382', fromPoint: { kind: 'AIRPORT', timezone: 'Asia/Tbilisi' }, toPoint: { kind: 'CITY' } },
                { direction: 'RETURN', fromPointName: 'Tbilisi', toPointName: 'Tbilisi Airport', pickupAt: new Date('2026-12-05T06:00:00Z'), sellCents: 20_000, flightNumber: 'TK 383', fromPoint: { kind: 'CITY', timezone: 'Asia/Tbilisi' }, toPoint: { kind: 'AIRPORT' } }
            ],
            extras: []
        };
        const lines = buildLines({ ...base, amountCents: 40_000, transferBooking: transfer }, { taxRateBps: 1800 });

        assert.equal(lines.length, 2);
        assert.equal(sum(lines), 40_000);
        assert.equal(lines[0].description, 'Arrival transfer Tbilisi Airport → Tbilisi, 02.12.2026 01:30 · TRF-1', 'a 21:30 UTC pick-up is the next day in Tbilisi');
        assert.equal(lines[0].detail.text, 'TRANSFER — ARRIVAL\nFrom: Tbilisi Airport · To: Tbilisi\nArrival date: 02.12.2026 · Time: 01:30\nFlight: TK 382\nVehicle: Minivan · Passengers: 3');
        assert.equal(lines[1].detail.label, 'DEPARTURE');
        assert.equal(lines[1].detail.text, 'TRANSFER — DEPARTURE\nFrom: Tbilisi · To: Tbilisi Airport\nDeparture date: 05.12.2026 · Pick-up: 10:00\nFlight: TK 383\nVehicle: Minivan · Passengers: 3');
    });

    it('describes a tour with its option, party and names, and a service', () => {
        const [tour] = buildLines(
            {
                ...base,
                tourBooking: {
                    reference: 'TUR-1',
                    status: 'CONFIRMED',
                    tourSnapshot: { title: 'Kazbegi day trip', option: { name: 'Private', departureTime: '08:00' }, meetingPointName: 'Freedom Square' },
                    date: new Date('2026-12-01T00:00:00Z'),
                    endDate: new Date('2026-12-01T00:00:00Z'),
                    adults: 2,
                    childAges: [7],
                    sellTotalCents: 10_000,
                    priceAdjustmentCents: 0,
                    travellers: [{ firstName: 'Nino', lastName: 'Beridze', type: 'ADULT', isLead: true }, { firstName: 'Giorgi', lastName: 'Beridze', type: 'ADULT' }, { firstName: 'Luka', lastName: 'Beridze', type: 'CHILD', age: 7 }]
                }
            },
            { taxRateBps: 1800 }
        );
        const [service] = buildLines({ ...base, serviceBooking: { reference: 'SVC-1', status: 'CONFIRMED', serviceSnapshot: { name: 'Airport meet & greet' }, date: new Date('2026-12-01T00:00:00Z'), quantity: 1, sellTotalCents: 10_000, priceAdjustmentCents: 0 } }, { taxRateBps: 1800 });

        assert.equal(tour.description, 'Kazbegi day trip (Private), 01.12.2026, 3 travellers · TUR-1');
        assert.equal(tour.detail.text, 'TOUR Kazbegi day trip · Private\nDate: 01.12.2026 · Departs 08:00 · Meeting point: Freedom Square\nPAX: BERIDZE / NINO, BERIDZE / GIORGI, BERIDZE / LUKA (CHD 7)');
        assert.equal(service.description, 'Airport meet & greet, 01.12.2026 · SVC-1');
        assert.equal(service.kind, 'SERVICE');
    });

    it('writes one line per order item when they add up, each with its child\'s detail, with a cancelled item at its charge', () => {
        const order = {
            reference: 'ORD-1',
            kind: 'PACKAGE',
            packageSnapshot: { name: 'Georgia in a week' },
            startDate: new Date('2026-12-01T00:00:00Z'),
            items: [
                { label: 'Rooms Hotel, 4 nights', status: 'CONFIRMED', lineTotalCents: 60_000, cancellationChargeCents: null, hotelBooking: hotel({ sellTotalCents: 60_000, taxTotalCents: 0 }) },
                { label: 'Airport transfer', status: 'CANCELLED', lineTotalCents: 20_000, cancellationChargeCents: 5_000, transferBooking: null },
                { label: 'Wine tour', status: 'DECLINED', lineTotalCents: 30_000, cancellationChargeCents: null }
            ]
        };
        const lines = buildLines({ ...base, amountCents: 65_000, order }, { taxRateBps: 1800 });

        assert.deepEqual(
            lines.map((line) => [line.description, line.totalGrossCents]),
            [
                ['Georgia in a week · Rooms Hotel · Deluxe Double Room, Breakfast Included · 01.12.2026 – 05.12.2026 (4 nights) · BKG-1', 60_000],
                ['Georgia in a week · Airport transfer (cancellation charge) · ORD-1', 5_000]
            ]
        );
        assert.ok(lines[0].detail.text.startsWith('HOTEL Rooms Hotel'));
        assert.equal(sum(lines), 65_000);
    });

    it('falls back to one line for the whole amount when the items do not add up to what is owed', () => {
        const order = { reference: 'ORD-2', packageSnapshot: { name: 'Weekend' }, startDate: new Date('2026-12-01T00:00:00Z'), items: [{ label: 'A', status: 'CONFIRMED', lineTotalCents: 1_000, cancellationChargeCents: null }] };
        const lines = buildLines({ ...base, amountCents: 5_000, order }, { taxRateBps: 1800 });

        assert.equal(lines.length, 1);
        assert.equal(lines[0].description, 'Weekend, from 01.12.2026 · ORD-2');
        assert.equal(lines[0].totalGrossCents, 5_000);
    });
});

describe('invoice buyer', () => {
    it('addresses a company by its legal name and tax id, and a guest by name and email', () => {
        const partner = { name: 'Caucasus', legalName: 'Caucasus Travel LLC', taxId: '405123456', email: 'ap@caucasus.test', legalAddress: '12 Rustaveli Ave', city: 'Tbilisi', country: 'GE', invoiceLang: 'ru' };

        assert.deepEqual(buyerFor({ ...base, debtorPartnerId: 'p1', debtorPartner: partner }), { name: 'Caucasus Travel LLC', taxId: '405123456', email: 'ap@caucasus.test', street: '12 Rustaveli Ave', city: 'Tbilisi', country: 'GE' });
        assert.deepEqual(buyerFor(base), { name: 'Nino Guest', taxId: null, email: 'nino@example.test', street: null, city: null, country: null });
        assert.equal(buyerFor({ ...base, debtorPartnerId: 'p1', debtorPartner: { ...partner, legalName: null, email: null } }).name, 'Caucasus');
        assert.equal(buyerFor({ ...base, debtorPartnerId: 'p1', debtorPartner: { ...partner, legalName: null, email: null } }).email, 'nino@example.test');
        assert.equal(langFor({ ...base, debtorPartner: partner }), 'ru');
        assert.equal(langFor(base), 'en');

        // A desk customer (manual bookings) is addressed like a company of its own.
        const customer = { id: 'c1', kind: 'COMPANY', name: 'Caucasus Travel', contactName: 'Tamar', email: 'tamar@ct.test', taxId: '404404404', billingAddress: '12 Rustaveli', city: 'Tbilisi', country: 'GE' };
        assert.deepEqual(buyerFor({ ...base, debtorCustomer: customer, debtorCustomerId: 'c1' }), { name: 'Caucasus Travel', taxId: '404404404', email: 'tamar@ct.test', street: '12 Rustaveli', city: 'Tbilisi', country: 'GE' });
    });
});

describe('invoicing configuration at boot', () => {
    const boot = (env) =>
        spawnSync(process.execPath, ['--env-file=.env.test', '-e', "import('./config.js').then(() => console.log('booted'))"], {
            env: { ...process.env, INVOICEOCEAN_ENABLED: '', INVOICEOCEAN_DOMAIN: '', INVOICEOCEAN_API_TOKEN: '', INVOICEOCEAN_WEBHOOK_SECRET: '', ...env },
            encoding: 'utf8'
        });

    it('boots with invoicing off and nothing else set', () => {
        const result = boot({});
        assert.match(result.stdout, /booted/);
    });

    it('refuses to boot with invoicing on but no account', () => {
        const result = boot({ INVOICEOCEAN_ENABLED: 'true' });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /INVOICEOCEAN_ENABLED=true needs INVOICEOCEAN_DOMAIN, INVOICEOCEAN_API_TOKEN/);
    });

    it('refuses a language InvoiceOcean cannot print, and a tax rate that is not basis points', () => {
        assert.match(boot({ INVOICEOCEAN_LANG: 'ka' }).stderr, /INVOICEOCEAN_LANG must be/);
        assert.match(boot({ INVOICEOCEAN_DEFAULT_TAX_BPS: '18' }).stdout, /booted/, '18 basis points is a legal, if odd, rate');
        assert.match(boot({ INVOICEOCEAN_DEFAULT_TAX_BPS: '18%' }).stderr, /must be a number/);
    });

    it('refuses a short webhook secret', () => {
        assert.match(boot({ INVOICEOCEAN_ENABLED: 'true', INVOICEOCEAN_DOMAIN: 'acme', INVOICEOCEAN_API_TOKEN: 'x', INVOICEOCEAN_WEBHOOK_SECRET: 'short' }).stderr, /at least 16 characters/);
    });
});
