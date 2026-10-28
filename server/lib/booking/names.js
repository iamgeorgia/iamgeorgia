import { prisma } from '../../db/index.js';

/**
 * The names behind a page of projected rows — the partner, the customer,
 * the manager — looked up once per page rather than denormalised into the
 * projection, where a rename would leave them stale.
 */
export const namesFor = async (rows) => {
    const ids = (key) => [...new Set(rows.map((row) => row[key]).filter(Boolean))];
    const [partners, customers, managers] = await Promise.all([
        ids('partnerId').length ? prisma.partner.findMany({ where: { id: { in: ids('partnerId') } }, select: { id: true, name: true } }) : [],
        ids('customerId').length ? prisma.customer.findMany({ where: { id: { in: ids('customerId') } }, select: { id: true, name: true, kind: true } }) : [],
        ids('assignedManagerUserId').length ? prisma.user.findMany({ where: { id: { in: ids('assignedManagerUserId') } }, select: { id: true, firstName: true, lastName: true, email: true } }) : []
    ]);

    return {
        partners: new Map(partners.map((partner) => [partner.id, { id: partner.id, name: partner.name }])),
        customers: new Map(customers.map((customer) => [customer.id, { id: customer.id, name: customer.name, kind: customer.kind }])),
        managers: new Map(managers.map((user) => [user.id, { id: user.id, name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email }]))
    };
};

/** The three name blocks a serialized row carries, from a page's lookup. */
export const namedBlocks = (row, names) => ({
    partner: row.partnerId ? (names?.partners.get(row.partnerId) ?? { id: row.partnerId, name: null }) : null,
    customer: row.customerId ? (names?.customers.get(row.customerId) ?? { id: row.customerId, name: null, kind: null }) : null,
    assignedManager: row.assignedManagerUserId ? (names?.managers.get(row.assignedManagerUserId) ?? { id: row.assignedManagerUserId, name: null }) : null
});
