import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { toBookingSummary } from '../serializers/booking.js';
import { toTourBookingSummary } from '../serializers/tourBooking.js';
import { resolveMarkup } from '../services/hotel/pricingRule.service.js';

/**
 * A supplier is entitled to its own net rate. The markup on top of it, the
 * margin, and which agency bought are the platform's business, so they go to
 * admins only — never to the property, whatever the supplier's sub-role.
 */
const supplierId = 'supplier-1';
const admin = { id: 'u-admin', role: 'ADMIN', partnerId: null };
const supplierOwner = { id: 'u-owner', role: 'PARTNER_OWNER', partnerId: supplierId, partner: { status: 'APPROVED' } };
const supplierAgent = { id: 'u-agent', role: 'PARTNER_AGENT', partnerId: supplierId, partner: { status: 'APPROVED' } };
const stranger = { id: 'u-other', role: 'PARTNER_OWNER', partnerId: 'agency-9', partner: { status: 'APPROVED' } };

const money = {
    currency: 'GEL',
    sellTotalCents: 23_000,
    netTotalCents: 20_000,
    markupBps: 1500,
    partnerId: 'agency-7',
    partner: { id: 'agency-7', name: 'Rival Travel' },
    createdAt: new Date('2026-10-01T00:00:00Z')
};

const hotelBooking = {
    ...money,
    reference: 'BKG-000123',
    status: 'CONFIRMED',
    hotelId: 'h1',
    hotel: { id: 'h1', supplierId },
    checkIn: new Date('2027-01-10T00:00:00Z'),
    checkOut: new Date('2027-01-12T00:00:00Z'),
    nights: 2
};

const tourBooking = {
    ...money,
    reference: 'TUR-000123',
    status: 'CONFIRMED',
    tourId: 't1',
    tour: { id: 't1', supplierId },
    date: new Date('2027-01-10T00:00:00Z'),
    endDate: new Date('2027-01-10T00:00:00Z')
};

const PLATFORM_FIELDS = ['markupBps', 'marginCents', 'partner'];

describe('margin visibility', () => {
    for (const [label, serialize, booking] of [
        ['hotel booking', toBookingSummary, hotelBooking],
        ['tour booking', toTourBookingSummary, tourBooking]
    ]) {
        it(`shows an admin the net, the markup, the margin and the buyer on a ${label}`, () => {
            const summary = serialize(booking, admin);

            assert.equal(summary.netTotalCents, 20_000);
            assert.equal(summary.markupBps, 1500);
            assert.equal(summary.marginCents, 3_000);
            assert.equal(summary.partner.name, 'Rival Travel');
        });

        for (const [who, viewer] of [['owner', supplierOwner], ['agent', supplierAgent]]) {
            it(`shows the supplier's ${who} its net on a ${label}, never the platform's side`, () => {
                const summary = serialize(booking, viewer);

                assert.equal(summary.netTotalCents, 20_000);

                for (const field of PLATFORM_FIELDS) {
                    assert.equal(field in summary, false, `${field} leaked to the supplier ${who}`);
                }

                assert.equal(summary.bookedVia, 'AGENCY');
            });
        }

        it(`shows a stranger none of the money on a ${label}`, () => {
            const summary = serialize(booking, stranger);

            for (const field of ['netTotalCents', 'bookedVia', ...PLATFORM_FIELDS]) {
                assert.equal(field in summary, false, `${field} leaked to a stranger`);
            }
        });
    }
});

describe('transfer pricing rules', { skip: process.env.DATABASE_URL ? false : 'needs the database' }, () => {
    // The staff desks, by what each one's job needs: management and finance
    // read the money; reservations reads which agency booked but never what
    // we earn on it; a dispatcher sees neither.
    const staff = (role) => ({ id: `u-${role}`, role, partnerId: null });

    for (const [label, serialize, booking] of [
        ['hotel booking', toBookingSummary, hotelBooking],
        ['tour booking', toTourBookingSummary, tourBooking]
    ]) {
        it(`gives each desk role its own view of a ${label}`, () => {
            for (const role of ['MANAGEMENT', 'ACCOUNTANT']) {
                const summary = serialize(booking, staff(role));

                assert.equal(summary.netTotalCents, 20_000, role);
                assert.equal(summary.marginCents, 3_000, role);
                assert.equal(summary.markupBps, 1500, role);
                assert.equal(summary.partner.id, 'agency-7', role);
            }

            const desk = serialize(booking, staff('TOUR_OPERATOR'));

            assert.equal(desk.partner.id, 'agency-7');
            for (const field of ['netTotalCents', 'markupBps', 'marginCents', 'bookedVia']) {
                assert.ok(!(field in desk), `reservations sees ${field}`);
            }

            const dispatcher = serialize(booking, staff('DISPATCHER'));

            for (const field of ['netTotalCents', 'markupBps', 'marginCents', 'partner', 'bookedVia']) {
                assert.ok(!(field in dispatcher), `dispatcher sees ${field}`);
            }
        });
    }

    it('falls back to the transfer default, not the hotel default, for a transfer', async () => {
        const resolved = await resolveMarkup({ productType: 'TRANSFER' });

        assert.equal(resolved.source, 'PLATFORM_DEFAULT');
        const { config } = await import('../config.js');
        assert.equal(resolved.markupBps, config.transfer.defaultMarkupBps);
    });
});
