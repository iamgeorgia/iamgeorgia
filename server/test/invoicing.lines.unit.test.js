import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { buildLines, buyerFor, langFor } from '../services/invoicing/invoice.service.js';

/**
 * What goes on the document, per product and per buyer — the pure parts of
 * the invoice service — and what the configuration refuses at boot.
 */

const base = { reference: 'REF-1', amountCents: 10_000, currency: 'GEL', debtorName: 'Nino Guest', debtorEmail: 'nino@example.test', debtorPartner: null, debtorPartnerId: null };

describe('invoice lines', () => {
    it('describes a hotel stay', () => {
        const [line] = buildLines({ ...base, hotelBooking: { reference: 'BKG-1', hotelSnapshot: { name: 'Rooms Hotel' }, checkIn: new Date('2026-12-01T00:00:00Z'), checkOut: new Date('2026-12-04T00:00:00Z'), nights: 3 } }, { taxRateBps: 1800 });

        assert.equal(line.description, 'Rooms Hotel: 3 nights, 2026-12-01 – 2026-12-04 · BKG-1');
        assert.deepEqual([line.quantity, line.taxRateBps, line.totalGrossCents, line.bookingReference], [1, 1800, 10_000, 'REF-1']);
    });

    it('describes a transfer, with its return leg', () => {
        const legs = [{ fromPointName: 'Tbilisi Airport', toPointName: 'Tbilisi' }, { fromPointName: 'Tbilisi', toPointName: 'Tbilisi Airport' }];
        const [line] = buildLines({ ...base, transferBooking: { reference: 'TRF-1', pickupAt: new Date('2026-12-01T06:00:00Z'), legs } }, { taxRateBps: 1800 });

        assert.equal(line.description, 'Transfer Tbilisi Airport → Tbilisi and return, 2026-12-01 · TRF-1');
    });

    it('describes a tour with its option and party, and a service', () => {
        const [tour] = buildLines({ ...base, tourBooking: { reference: 'TUR-1', tourSnapshot: { title: 'Kazbegi day trip', option: { name: 'Private' } }, date: new Date('2026-12-01T00:00:00Z'), adults: 2, childAges: [7] } }, { taxRateBps: 1800 });
        const [service] = buildLines({ ...base, serviceBooking: { reference: 'SVC-1', serviceSnapshot: { name: 'Airport meet & greet' }, date: new Date('2026-12-01T00:00:00Z'), quantity: 1 } }, { taxRateBps: 1800 });

        assert.equal(tour.description, 'Kazbegi day trip (Private), 2026-12-01, 3 travellers · TUR-1');
        assert.equal(service.description, 'Airport meet & greet, 2026-12-01 · SVC-1');
    });

    it('writes one line per order item when they add up, with a cancelled item at its charge', () => {
        const order = {
            reference: 'ORD-1',
            packageSnapshot: { name: 'Georgia in a week' },
            startDate: new Date('2026-12-01T00:00:00Z'),
            items: [
                { label: 'Rooms Hotel, 3 nights', status: 'CONFIRMED', lineTotalCents: 60_000, cancellationChargeCents: null },
                { label: 'Airport transfer', status: 'CANCELLED', lineTotalCents: 20_000, cancellationChargeCents: 5_000 },
                { label: 'Wine tour', status: 'DECLINED', lineTotalCents: 30_000, cancellationChargeCents: null }
            ]
        };
        const lines = buildLines({ ...base, amountCents: 65_000, order }, { taxRateBps: 1800 });

        assert.deepEqual(
            lines.map((line) => [line.description, line.totalGrossCents]),
            [
                ['Georgia in a week · Rooms Hotel, 3 nights · ORD-1', 60_000],
                ['Georgia in a week · Airport transfer (cancellation charge) · ORD-1', 5_000]
            ]
        );
        assert.equal(lines.reduce((sum, line) => sum + line.totalGrossCents, 0), 65_000);
    });

    it('falls back to one line for the whole amount when the items do not add up to what is owed', () => {
        const order = { reference: 'ORD-2', packageSnapshot: { name: 'Weekend' }, startDate: new Date('2026-12-01T00:00:00Z'), items: [{ label: 'Hotel', status: 'CONFIRMED', lineTotalCents: 60_000 }] };
        const lines = buildLines({ ...base, amountCents: 50_000, order }, { taxRateBps: 1800 });

        assert.deepEqual(lines.map((line) => [line.description, line.totalGrossCents]), [['Weekend, from 2026-12-01 · ORD-2', 50_000]]);
    });

    it('addresses a company by its legal name and tax id, and a guest by name and email', () => {
        const partner = { name: 'Caucasus', legalName: 'Caucasus Travel LLC', taxId: '405123456', email: 'ap@caucasus.test', legalAddress: '12 Rustaveli Ave', city: 'Tbilisi', country: 'GE', invoiceLang: 'ru' };

        assert.deepEqual(buyerFor({ ...base, debtorPartnerId: 'p1', debtorPartner: partner }), { name: 'Caucasus Travel LLC', taxId: '405123456', email: 'ap@caucasus.test', street: '12 Rustaveli Ave', city: 'Tbilisi', country: 'GE' });
        assert.deepEqual(buyerFor(base), { name: 'Nino Guest', taxId: null, email: 'nino@example.test', street: null, city: null, country: null });
        assert.equal(buyerFor({ ...base, debtorPartnerId: 'p1', debtorPartner: { ...partner, legalName: null, email: null } }).name, 'Caucasus');
        assert.equal(buyerFor({ ...base, debtorPartnerId: 'p1', debtorPartner: { ...partner, legalName: null, email: null } }).email, 'nino@example.test');
        assert.equal(langFor({ ...base, debtorPartner: partner }), 'ru');
        assert.equal(langFor(base), 'en');
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
