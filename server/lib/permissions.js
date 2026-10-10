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

    /** Edit the roles themselves: what each may do, and who holds which. */
    ROLES_MANAGE: 'roles.manage',

    CATALOGUE_READ: 'catalogue.read',
    /** Every product's content and availability. Hotel prices need `pricing.write` as well. */
    CATALOGUE_WRITE: 'catalogue.write',
    /** Tours alone: content, options, seasons, departures. The tour operator's door into the catalogue. */
    TOURS_WRITE: 'tours.write',
    /** What a hotel costs and what it sells for: rates, rate plans, taxes, policies, child charges, and the markup rules. */
    PRICING_WRITE: 'pricing.write',

    BOOKINGS_READ: 'bookings.read',
    BOOKINGS_WRITE: 'bookings.write',
    BOOKINGS_CANCEL: 'bookings.cancel',

    DISPATCH_READ: 'dispatch.read',
    DISPATCH_WRITE: 'dispatch.write',

    PARTNERS_READ: 'partners.read',
    PARTNERS_WRITE: 'partners.write',
    PARTNERS_FINANCIAL_READ: 'partners.financial.read',
    /** How much a partner may owe before a booking is refused or finance told. */
    PARTNERS_CREDIT_WRITE: 'partners.credit.write',

    FINANCE_MARGIN_READ: 'finance.margin.read',
    FINANCE_PAYABLES_READ: 'finance.payables.read',
    FINANCE_RECEIVABLES_READ: 'finance.receivables.read',
    FINANCE_PAYMENTS_READ: 'finance.payments.read',
    FINANCE_PAYMENTS_WRITE: 'finance.payments.write',
    FINANCE_TERMS_WRITE: 'finance.terms.write',
    FINANCE_REPORTS_READ: 'finance.reports.read',
    FINANCE_EXPORT: 'finance.export',
    /** What each agency earned us and was owed: the commission report. */
    FINANCE_COMMISSION_READ: 'finance.commission.read',
    /** A partner's commission rate: the one figure on a partner that is money. */
    FINANCE_COMMISSION_WRITE: 'finance.commission.write',
    /** The free-text notes on a payable or receivable. */
    FINANCE_NOTES_WRITE: 'finance.notes.write',
    /**
     * Refunds and adjustments (write-offs, overrides, moved deadlines) are
     * asked for by one person and approved by another. `request` opens one,
     * `approve` decides it — never one's own — and `execute` does it with no
     * second person, which nobody is seeded with.
     */
    FINANCE_REFUNDS_REQUEST: 'finance.refunds.request',
    FINANCE_REFUNDS_APPROVE: 'finance.refunds.approve',
    FINANCE_REFUNDS_EXECUTE: 'finance.refunds.execute',
    FINANCE_ADJUSTMENTS_REQUEST: 'finance.adjustments.request',
    FINANCE_ADJUSTMENTS_APPROVE: 'finance.adjustments.approve',
    FINANCE_ADJUSTMENTS_EXECUTE: 'finance.adjustments.execute',

    INVOICES_READ: 'invoices.read',
    INVOICES_WRITE: 'invoices.write',

    NOTIFICATIONS_READ: 'notifications.read',
    /** The driver panel: a linked driver's own jobs. Held by the DRIVER role alone. */
    DRIVER_PANEL: 'driver.panel',

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
    C.FINANCE_COMMISSION_READ,
    C.INVOICES_READ,
    C.PARTNERS_FINANCIAL_READ
];

const FINANCE_WRITE = [C.FINANCE_PAYMENTS_WRITE, C.FINANCE_TERMS_WRITE, C.INVOICES_WRITE];

/** Opening a refund or an adjustment for someone else to approve, and the notes beside it. */
const FINANCE_ASK = [C.FINANCE_NOTES_WRITE, C.FINANCE_REFUNDS_REQUEST, C.FINANCE_ADJUSTMENTS_REQUEST];

/** Deciding what others asked for. Seeded on the super admin alone; given to others by role. */
const FINANCE_APPROVE = [C.FINANCE_REFUNDS_APPROVE, C.FINANCE_ADJUSTMENTS_APPROVE];

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
    C.FINANCE_COMMISSION_WRITE,
    C.PARTNERS_CREDIT_WRITE,
    ...FINANCE_READ
];

const PARTNER_MEMBER = [C.NOTIFICATIONS_READ, C.PARTNER_BOOKINGS_READ];

/**
 * Role → capabilities, as seeded.
 *
 * Listed per role rather than inherited, so that what a role can do is read
 * off one line and a capability never leaks in through a base it was not
 * meant to be in. This is the *default* table: the `roles` and
 * `role_capabilities` tables are seeded from it by migration and are what a
 * request is actually resolved against (see `resolveCapabilities`), so a role
 * edited in the panel differs from this list on purpose. It still serves the
 * seed, the tests, and any viewer built from a bare `{ role }`.
 */
export const DEFAULT_ROLE_LISTS = {
    SUPER_ADMIN: [...ADMIN, ...FINANCE_WRITE, ...FINANCE_ASK, ...FINANCE_APPROVE, C.USERS_STAFF_MANAGE, C.ROLES_MANAGE, C.SETTINGS_WRITE],
    ADMIN,
    /** Reads everything, margins included; writes nothing. */
    MANAGEMENT: [C.AUDIT_READ, ...PLATFORM_READ, ...FINANCE_READ.filter((cap) => cap !== C.PARTNERS_FINANCIAL_READ)],
    /**
     * Runs the operation: the bookings desk, the tours, the fleet and its
     * drivers. Never a hotel price — those are `catalogue.write` and
     * `pricing.write`, neither of which it holds — and never a margin.
     */
    TOUR_OPERATOR: [...PLATFORM_READ, C.BOOKINGS_WRITE, C.BOOKINGS_CANCEL, C.TOURS_WRITE, C.DISPATCH_WRITE],
    /** Keeps the books: records the money, sets terms and commission, reads what it needs to reconcile. */
    ACCOUNTANT: [
        C.AUDIT_READ,
        C.CATALOGUE_READ,
        C.BOOKINGS_READ,
        C.PARTNERS_READ,
        C.NOTIFICATIONS_READ,
        ...FINANCE_READ,
        ...FINANCE_WRITE,
        ...FINANCE_ASK,
        C.FINANCE_COMMISSION_WRITE,
        C.PARTNERS_CREDIT_WRITE
    ],
    /** Confirms the day's payments and watches the debts; narrower than the accountant. */
    FINANCE_OPERATOR: [
        C.CATALOGUE_READ,
        C.BOOKINGS_READ,
        C.PARTNERS_READ,
        C.NOTIFICATIONS_READ,
        C.FINANCE_PAYABLES_READ,
        C.FINANCE_RECEIVABLES_READ,
        C.FINANCE_PAYMENTS_READ,
        C.FINANCE_PAYMENTS_WRITE,
        ...FINANCE_ASK
    ],
    /** Assigns drivers and cars; reads the catalogue to do it; no money, no partners. */
    DISPATCHER: [C.CATALOGUE_READ, C.DISPATCH_READ, C.DISPATCH_WRITE, C.NOTIFICATIONS_READ],
    DRIVER: [C.NOTIFICATIONS_READ, C.DRIVER_PANEL],

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

/** Role → read-only Set of capability strings, as seeded. */
export const ROLE_CAPABILITIES = Object.freeze(
    Object.fromEntries(Object.entries(DEFAULT_ROLE_LISTS).map(([role, list]) => [role, readOnlySet(list)]))
);

/** Every system role, in the order the enum declares them. */
export const ROLES = Object.freeze(Object.keys(DEFAULT_ROLE_LISTS));

/** Platform-side roles: no partnerId, by the database CHECK. */
export const PLATFORM_ROLES = Object.freeze(ROLES.filter((role) => !role.startsWith('PARTNER_')));

/** Roles that sit in the admin panel. Drivers have their own panel. */
export const STAFF_ROLES = Object.freeze(PLATFORM_ROLES.filter((role) => role !== 'DRIVER'));

/** Which side a system role is on, for the seed. */
export const sideOf = (role) => (role.startsWith('PARTNER_') ? 'PARTNER' : 'PLATFORM');

/** Every capability there is. */
export const ALL_CAPABILITIES = readOnlySet(Object.values(C));

/**
 * The `partner.*` capabilities are a company's, always scoped by the viewer's
 * partnerId in the service that honours them; a platform account has no
 * company, so it holds none of them, super admin included — "everything" is
 * everything on its own side.
 */
export const isPartnerCapability = (capability) => capability.startsWith('partner.');

/**
 * Capabilities a super admin does not get by merely being one.
 *
 * A super admin holds everything *computed*, so a capability added in code
 * is theirs with no data change — except these, which are the ones a role
 * must be given on purpose: moving money with no second person.
 */
export const WITHHELD_FROM_SUPER_ADMIN = Object.freeze([C.FINANCE_REFUNDS_EXECUTE, C.FINANCE_ADJUSTMENTS_EXECUTE]);

/**
 * What an account may do, from what was loaded for it.
 *
 * The union of its roles' capabilities, with a super admin holding all of
 * them computed; then the overrides written for it by name — a GRANT adds,
 * a DENY wins over anything a role gave — each counted only while it is
 * live. A string no capability in code answers to is dropped: a capability
 * renamed in code is a capability nobody holds until a role is re-saved,
 * which is the safe way round.
 */
export const resolveCapabilities = ({ roles = [], overrides = [] }, now = new Date()) => {
    const held = new Set();

    for (const { role } of roles) {
        if (role.key === 'SUPER_ADMIN') {
            for (const capability of ALL_CAPABILITIES) {
                if (!isPartnerCapability(capability)) held.add(capability);
            }
            for (const capability of WITHHELD_FROM_SUPER_ADMIN) held.delete(capability);
            continue;
        }

        for (const { capability } of role.capabilities ?? []) held.add(capability);
    }

    const live = overrides.filter((override) => !override.expiresAt || override.expiresAt > now);

    for (const { capability, effect } of live) {
        if (effect === 'GRANT') held.add(capability);
    }

    for (const { capability, effect } of live) {
        if (effect === 'DENY') held.delete(capability);
    }

    for (const capability of held) {
        if (!ALL_CAPABILITIES.has(capability)) held.delete(capability);
    }

    return held;
};

/**
 * What a viewer holds.
 *
 * A session's user carries its resolved `capabilities`; a viewer built from a
 * bare `{ role }` — a system caller, a unit test — is answered from the seed
 * table. An anonymous caller, and a role nobody has heard of, hold nothing,
 * so a guard built on this fails closed in both directions.
 */
const heldBy = (viewer) => {
    if (viewer?.capabilities instanceof Set) return viewer.capabilities;
    if (Array.isArray(viewer?.capabilities)) return new Set(viewer.capabilities);
    return viewer?.role ? ROLE_CAPABILITIES[viewer.role] : undefined;
};

/** Whether a viewer holds any of the given capabilities. */
export const can = (viewer, ...anyOf) => {
    const held = heldBy(viewer);

    if (!held) {
        return false;
    }

    return anyOf.some((capability) => held.has(capability));
};

/** The capabilities of a system role as seeded, sorted. Empty for an unknown role. */
export const capabilitiesFor = (role) => [...(ROLE_CAPABILITIES[role] ?? [])].sort();

/** What a loaded user holds, sorted, for the `/me` payload. */
export const capabilitiesOf = (user) => [...(heldBy(user) ?? [])].sort();

/** `can`, or a 403 that names what was missing. */
export const assertCan = (viewer, ...anyOf) => {
    if (!can(viewer, ...anyOf)) {
        throw new ForbiddenError('Insufficient permissions', {
            reason: 'INSUFFICIENT_CAPABILITY',
            required: anyOf
        });
    }
};
