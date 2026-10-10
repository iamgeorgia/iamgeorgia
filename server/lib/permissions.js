import { ForbiddenError } from './errors.js';

/**
 * What a role may do, in one place.
 *
 * Routers and serializers ask `can(viewer, capability)` rather than comparing
 * role names, so adding a role is a matter of listing its capabilities here —
 * and a role that is not listed can do nothing, which is the safe way for a
 * new one to arrive. The client never holds a copy of this table: `/me`
 * serves the signed-in user's capabilities and the UI reads those.
 *
 * Names are `area.verb`. The platform-side areas are gated on the whole
 * company's data; the `partner.*` ones are always scoped by the viewer's
 * partnerId in the service that honours them.
 */
export const CAPABILITIES = Object.freeze({
    /** Legacy alias for "is an admin". Only the pre-capability guards use it. */
    PLATFORM_ADMIN: 'platform.admin',
    USERS_STAFF_MANAGE: 'users.staff.manage',
    SETTINGS_WRITE: 'settings.write',
    AUDIT_READ: 'audit.read',

    CATALOGUE_READ: 'catalogue.read',
    CATALOGUE_WRITE: 'catalogue.write',
    PRICING_WRITE: 'pricing.write',

    BOOKINGS_READ: 'bookings.read',
    BOOKINGS_WRITE: 'bookings.write',
    BOOKINGS_CANCEL: 'bookings.cancel',

    DISPATCH_READ: 'dispatch.read',
    DISPATCH_WRITE: 'dispatch.write',

    PARTNERS_READ: 'partners.read',
    PARTNERS_WRITE: 'partners.write',
    PARTNERS_FINANCIAL_READ: 'partners.financial.read',

    FINANCE_MARGIN_READ: 'finance.margin.read',
    FINANCE_PAYABLES_READ: 'finance.payables.read',
    FINANCE_RECEIVABLES_READ: 'finance.receivables.read',
    FINANCE_PAYMENTS_READ: 'finance.payments.read',
    FINANCE_PAYMENTS_WRITE: 'finance.payments.write',
    FINANCE_TERMS_WRITE: 'finance.terms.write',
    FINANCE_REPORTS_READ: 'finance.reports.read',
    FINANCE_EXPORT: 'finance.export',

    INVOICES_READ: 'invoices.read',
    INVOICES_WRITE: 'invoices.write',

    NOTIFICATIONS_READ: 'notifications.read',

    PARTNER_PROFILE_WRITE: 'partner.profile.write',
    PARTNER_FINANCIAL_READ: 'partner.financial.read',
    PARTNER_FINANCIAL_WRITE: 'partner.financial.write',
    PARTNER_TEAM_MANAGE: 'partner.team.manage',
    PARTNER_BOOKINGS_READ: 'partner.bookings.read',
    PARTNER_BOOKINGS_WRITE: 'partner.bookings.write',
    PARTNER_BOOKINGS_CANCEL: 'partner.bookings.cancel',
    PARTNER_INVENTORY_WRITE: 'partner.inventory.write',
    PARTNER_STATEMENT_READ: 'partner.statement.read',
    PARTNER_INVOICES_READ: 'partner.invoices.read'
});

const C = CAPABILITIES;

/** Every capability that lets a role read the admin panel's data. */
const PLATFORM_READ = [
    C.CATALOGUE_READ,
    C.BOOKINGS_READ,
    C.DISPATCH_READ,
    C.PARTNERS_READ,
    C.NOTIFICATIONS_READ
];

const FINANCE_READ = [
    C.FINANCE_MARGIN_READ,
    C.FINANCE_PAYABLES_READ,
    C.FINANCE_RECEIVABLES_READ,
    C.FINANCE_PAYMENTS_READ,
    C.FINANCE_REPORTS_READ,
    C.FINANCE_EXPORT,
    C.INVOICES_READ,
    C.PARTNERS_FINANCIAL_READ
];

const FINANCE_WRITE = [C.FINANCE_PAYMENTS_WRITE, C.FINANCE_TERMS_WRITE, C.INVOICES_WRITE];

/**
 * Everything an ADMIN does: the whole operation, short of managing staff and
 * settings — and short of moving money. An admin reads every figure, sets
 * prices and commission, approves partners and edits their bank details;
 * recording a payment or a refund, writing a debt off and setting payment
 * terms is the finance desk's, and comes to an admin only by being given it.
 * Running the company and keeping its books are two jobs on purpose.
 */
const ADMIN = [
    C.PLATFORM_ADMIN,
    C.AUDIT_READ,
    ...PLATFORM_READ,
    C.CATALOGUE_WRITE,
    C.PRICING_WRITE,
    C.BOOKINGS_WRITE,
    C.BOOKINGS_CANCEL,
    C.DISPATCH_WRITE,
    C.PARTNERS_WRITE,
    ...FINANCE_READ
];

const PARTNER_MEMBER = [C.NOTIFICATIONS_READ, C.PARTNER_BOOKINGS_READ];

/**
 * Role → capabilities. Listed per role rather than inherited, so that what a
 * role can do is read off one line and a capability never leaks in through a
 * base it was not meant to be in.
 */
const ROLE_LISTS = {
    SUPER_ADMIN: [...ADMIN, ...FINANCE_WRITE, C.USERS_STAFF_MANAGE, C.SETTINGS_WRITE],
    ADMIN,
    /** Reads everything, margins included; writes nothing. */
    MANAGEMENT: [C.AUDIT_READ, ...PLATFORM_READ, ...FINANCE_READ.filter((cap) => cap !== C.PARTNERS_FINANCIAL_READ)],
    /** Runs the bookings desk: creates, amends, cancels; never sees a margin. */
    RESERVATIONS: [...PLATFORM_READ, C.BOOKINGS_WRITE, C.BOOKINGS_CANCEL],
    /** Records the money and reads what it needs to reconcile it. */
    FINANCE: [
        C.AUDIT_READ,
        C.CATALOGUE_READ,
        C.BOOKINGS_READ,
        C.PARTNERS_READ,
        C.NOTIFICATIONS_READ,
        ...FINANCE_READ,
        ...FINANCE_WRITE
    ],
    /** Assigns drivers and cars; reads the catalogue to do it; no money, no partners. */
    DISPATCHER: [C.CATALOGUE_READ, C.DISPATCH_READ, C.DISPATCH_WRITE, C.NOTIFICATIONS_READ],
    DRIVER: [C.NOTIFICATIONS_READ],

    PARTNER_OWNER: [
        ...PARTNER_MEMBER,
        C.PARTNER_PROFILE_WRITE,
        C.PARTNER_FINANCIAL_READ,
        C.PARTNER_FINANCIAL_WRITE,
        C.PARTNER_TEAM_MANAGE,
        C.PARTNER_BOOKINGS_WRITE,
        C.PARTNER_BOOKINGS_CANCEL,
        C.PARTNER_INVENTORY_WRITE,
        C.PARTNER_STATEMENT_READ,
        C.PARTNER_INVOICES_READ
    ],
    PARTNER_ADMIN: [
        ...PARTNER_MEMBER,
        C.PARTNER_PROFILE_WRITE,
        C.PARTNER_TEAM_MANAGE,
        C.PARTNER_BOOKINGS_WRITE,
        C.PARTNER_BOOKINGS_CANCEL,
        C.PARTNER_INVENTORY_WRITE,
        C.PARTNER_STATEMENT_READ,
        C.PARTNER_INVOICES_READ
    ],
    PARTNER_AGENT: [...PARTNER_MEMBER, C.PARTNER_BOOKINGS_WRITE, C.PARTNER_BOOKINGS_CANCEL],
    PARTNER_FINANCE: [
        ...PARTNER_MEMBER,
        C.PARTNER_FINANCIAL_READ,
        C.PARTNER_FINANCIAL_WRITE,
        C.PARTNER_STATEMENT_READ,
        C.PARTNER_INVOICES_READ
    ]
};

/** A Set that refuses to change: `Object.freeze` alone does not stop `add`. */
const readOnlySet = (list) => {
    const set = new Set(list);
    const refuse = () => {
        throw new TypeError('The capability table is read-only');
    };

    return Object.freeze(Object.assign(set, { add: refuse, delete: refuse, clear: refuse }));
};

/** Role → read-only Set of capability strings. */
export const ROLE_CAPABILITIES = Object.freeze(
    Object.fromEntries(Object.entries(ROLE_LISTS).map(([role, list]) => [role, readOnlySet(list)]))
);

/** Every role the platform knows, in the order the enum declares them. */
export const ROLES = Object.freeze(Object.keys(ROLE_LISTS));

/** Platform-side roles: no partnerId, by the database CHECK. */
export const PLATFORM_ROLES = Object.freeze(ROLES.filter((role) => !role.startsWith('PARTNER_')));

/** Roles that sit in the admin panel. Drivers have their own panel. */
export const STAFF_ROLES = Object.freeze(PLATFORM_ROLES.filter((role) => role !== 'DRIVER'));

/**
 * Whether a viewer holds any of the given capabilities.
 *
 * Takes a viewer that may be undefined (an anonymous caller holds none) and a
 * role it has never heard of (holds none either), so a guard built on this
 * fails closed in both directions.
 */
export const can = (viewer, ...anyOf) => {
    const held = viewer?.role ? ROLE_CAPABILITIES[viewer.role] : undefined;

    if (!held) {
        return false;
    }

    return anyOf.some((capability) => held.has(capability));
};

/** The capabilities of a role, sorted, for the `/me` payload. Empty for an unknown role. */
export const capabilitiesFor = (role) => [...(ROLE_CAPABILITIES[role] ?? [])].sort();

/** `can`, or a 403 that names what was missing. */
export const assertCan = (viewer, ...anyOf) => {
    if (!can(viewer, ...anyOf)) {
        throw new ForbiddenError('Insufficient permissions', {
            reason: 'INSUFFICIENT_CAPABILITY',
            required: anyOf
        });
    }
};
