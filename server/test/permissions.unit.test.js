import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    CAPABILITIES,
    ROLE_CAPABILITIES,
    ROLES,
    PLATFORM_ROLES,
    STAFF_ROLES,
    can,
    capabilitiesFor,
    assertCan
} from '../lib/permissions.js';

const C = CAPABILITIES;

const STAFF_ALL = ['SUPER_ADMIN', 'ADMIN', 'MANAGEMENT', 'RESERVATIONS', 'FINANCE'];
const FINANCE_READERS = ['SUPER_ADMIN', 'ADMIN', 'MANAGEMENT', 'FINANCE'];
/** Who moves money. An admin runs the company and reads every figure; the books are the finance desk's. */
const FINANCE_WRITERS = ['SUPER_ADMIN', 'FINANCE'];
const BANK_DETAIL_READERS = ['SUPER_ADMIN', 'ADMIN', 'FINANCE'];
const PARTNER_ALL = ['PARTNER_OWNER', 'PARTNER_ADMIN', 'PARTNER_AGENT', 'PARTNER_FINANCE'];

/** Who holds what, written out so a change to the table is a change here too. */
const EXPECTED = {
    [C.PLATFORM_ADMIN]: ['SUPER_ADMIN', 'ADMIN'],
    [C.USERS_STAFF_MANAGE]: ['SUPER_ADMIN'],
    [C.SETTINGS_WRITE]: ['SUPER_ADMIN'],
    [C.AUDIT_READ]: FINANCE_READERS,
    [C.CATALOGUE_READ]: [...STAFF_ALL, 'DISPATCHER'],
    [C.CATALOGUE_WRITE]: ['SUPER_ADMIN', 'ADMIN'],
    [C.PRICING_WRITE]: ['SUPER_ADMIN', 'ADMIN'],
    [C.BOOKINGS_READ]: STAFF_ALL,
    [C.BOOKINGS_WRITE]: ['SUPER_ADMIN', 'ADMIN', 'RESERVATIONS'],
    [C.BOOKINGS_CANCEL]: ['SUPER_ADMIN', 'ADMIN', 'RESERVATIONS'],
    [C.DISPATCH_READ]: ['SUPER_ADMIN', 'ADMIN', 'MANAGEMENT', 'RESERVATIONS', 'DISPATCHER'],
    [C.DISPATCH_WRITE]: ['SUPER_ADMIN', 'ADMIN', 'DISPATCHER'],
    [C.PARTNERS_READ]: STAFF_ALL,
    [C.PARTNERS_WRITE]: ['SUPER_ADMIN', 'ADMIN'],
    [C.PARTNERS_FINANCIAL_READ]: BANK_DETAIL_READERS,
    [C.FINANCE_MARGIN_READ]: FINANCE_READERS,
    [C.FINANCE_PAYABLES_READ]: FINANCE_READERS,
    [C.FINANCE_RECEIVABLES_READ]: FINANCE_READERS,
    [C.FINANCE_PAYMENTS_READ]: FINANCE_READERS,
    [C.FINANCE_PAYMENTS_WRITE]: FINANCE_WRITERS,
    [C.FINANCE_TERMS_WRITE]: FINANCE_WRITERS,
    [C.FINANCE_REPORTS_READ]: FINANCE_READERS,
    [C.FINANCE_EXPORT]: FINANCE_READERS,
    [C.INVOICES_READ]: FINANCE_READERS,
    [C.INVOICES_WRITE]: FINANCE_WRITERS,
    [C.NOTIFICATIONS_READ]: [...STAFF_ALL, 'DISPATCHER', 'DRIVER', ...PARTNER_ALL],
    [C.DRIVER_PANEL]: ['DRIVER'],
    [C.PARTNER_PROFILE_WRITE]: ['PARTNER_OWNER', 'PARTNER_ADMIN'],
    [C.PARTNER_FINANCIAL_READ]: ['PARTNER_OWNER', 'PARTNER_FINANCE'],
    [C.PARTNER_FINANCIAL_WRITE]: ['PARTNER_OWNER', 'PARTNER_FINANCE'],
    [C.PARTNER_TEAM_MANAGE]: ['PARTNER_OWNER', 'PARTNER_ADMIN'],
    [C.PARTNER_BOOKINGS_READ]: PARTNER_ALL,
    [C.PARTNER_BOOKINGS_WRITE]: ['PARTNER_OWNER', 'PARTNER_ADMIN', 'PARTNER_AGENT'],
    [C.PARTNER_BOOKINGS_CANCEL]: ['PARTNER_OWNER', 'PARTNER_ADMIN', 'PARTNER_AGENT'],
    [C.PARTNER_INVENTORY_WRITE]: ['PARTNER_OWNER', 'PARTNER_ADMIN'],
    [C.PARTNER_STATEMENT_READ]: ['PARTNER_OWNER', 'PARTNER_ADMIN', 'PARTNER_FINANCE'],
    [C.PARTNER_INVOICES_READ]: ['PARTNER_OWNER', 'PARTNER_ADMIN', 'PARTNER_FINANCE']
};

describe('permissions', () => {
    it('knows every role the schema declares, and no other', () => {
        assert.deepEqual([...ROLES].sort(), [...STAFF_ALL, 'DISPATCHER', 'DRIVER', ...PARTNER_ALL].sort());
        assert.deepEqual([...PLATFORM_ROLES].sort(), [...STAFF_ALL, 'DISPATCHER', 'DRIVER'].sort());
        assert.ok(!STAFF_ROLES.includes('DRIVER'));
        assert.ok(STAFF_ROLES.includes('FINANCE'));
    });

    it('grants each capability to exactly the roles the matrix says', () => {
        assert.deepEqual(Object.keys(EXPECTED).sort(), Object.values(C).sort(), 'every capability is covered');

        for (const [capability, holders] of Object.entries(EXPECTED)) {
            const actual = ROLES.filter((role) => ROLE_CAPABILITIES[role].has(capability));
            assert.deepEqual(actual.sort(), [...holders].sort(), capability);
        }
    });

    it('never lets a role hold a capability outside its side of the platform', () => {
        for (const role of PLATFORM_ROLES) {
            for (const capability of ROLE_CAPABILITIES[role]) {
                assert.ok(!capability.startsWith('partner.'), `${role} holds ${capability}`);
            }
        }

        for (const role of PARTNER_ALL) {
            for (const capability of ROLE_CAPABILITIES[role]) {
                assert.ok(
                    capability.startsWith('partner.') || capability === C.NOTIFICATIONS_READ,
                    `${role} holds ${capability}`
                );
            }
        }
    });

    it('keeps money away from the desk roles', () => {
        assert.equal(can({ role: 'DISPATCHER' }, C.FINANCE_MARGIN_READ), false);
        assert.equal(can({ role: 'RESERVATIONS' }, C.FINANCE_MARGIN_READ), false);
        assert.equal(can({ role: 'DRIVER' }, C.CATALOGUE_READ), false);
        assert.equal(can({ role: 'MANAGEMENT' }, C.BOOKINGS_WRITE), false);
        assert.equal(can({ role: 'ADMIN' }, C.USERS_STAFF_MANAGE), false);
    });

    it('answers "any of" and fails closed for nobody and for an unknown role', () => {
        assert.equal(can({ role: 'FINANCE' }, C.CATALOGUE_WRITE, C.FINANCE_PAYMENTS_WRITE), true);
        assert.equal(can({ role: 'FINANCE' }, C.CATALOGUE_WRITE, C.PRICING_WRITE), false);
        assert.equal(can(undefined, C.NOTIFICATIONS_READ), false);
        assert.equal(can(null, C.NOTIFICATIONS_READ), false);
        assert.equal(can({ role: 'GHOST' }, C.NOTIFICATIONS_READ), false);
        assert.equal(can({ role: 'ADMIN' }), false);
    });

    it('lists capabilities sorted, and empty for an unknown role', () => {
        const list = capabilitiesFor('SUPER_ADMIN');

        assert.deepEqual(list, [...list].sort());
        assert.ok(list.includes(C.USERS_STAFF_MANAGE));
        assert.deepEqual(capabilitiesFor('GHOST'), []);
        assert.deepEqual(capabilitiesFor(undefined), []);
    });

    it('throws a 403 that names what was missing', () => {
        assert.doesNotThrow(() => assertCan({ role: 'ADMIN' }, C.CATALOGUE_WRITE));
        assert.throws(() => assertCan({ role: 'DISPATCHER' }, C.CATALOGUE_WRITE), (error) => {
            assert.equal(error.status, 403);
            assert.deepEqual(error.details, { reason: 'INSUFFICIENT_CAPABILITY', required: [C.CATALOGUE_WRITE] });
            return true;
        });
    });

    it('cannot be edited at runtime', () => {
        assert.throws(() => ROLE_CAPABILITIES.ADMIN.add(C.USERS_STAFF_MANAGE), TypeError);
        assert.equal(Object.isFrozen(CAPABILITIES), true);
    });
});
