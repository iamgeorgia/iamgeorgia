import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { CAPABILITIES, DEFAULT_ROLE_LISTS, ROLES, resolveCapabilities, sideOf } from '../lib/permissions.js';
import { usersWithCapability } from '../services/rbac/access.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makePartner,
    makePartnerUser,
    signIn
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

/**
 * Roles as data: the seed matches the table in code, the triggers keep a
 * user's primary role and its sides straight, and what a request may do is
 * read from the rows — so an override applies on the very next request.
 */
describe('roles as data', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let roles;

    before(async () => {
        roles = Object.fromEntries((await prisma.accessRole.findMany({ include: { capabilities: true } })).map((role) => [role.key, role]));
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('seeds every system role with exactly the capabilities the code lists', () => {
        for (const key of ROLES) {
            const seeded = roles[key];

            assert.ok(seeded, `${key} is seeded`);
            assert.equal(seeded.isSystem, true, key);
            assert.equal(seeded.side, sideOf(key), key);
            assert.deepEqual(
                seeded.capabilities.map((row) => row.capability).sort(),
                [...DEFAULT_ROLE_LISTS[key]].sort(),
                key
            );
        }
    });

    it('gives a new account the row for its primary role, and swaps it when the role changes', async () => {
        const user = await makeAdmin(tracker, { role: 'RESERVATIONS' });
        const held = () => prisma.userRole.findMany({ where: { userId: user.id }, select: { roleId: true } });

        assert.deepEqual((await held()).map((row) => row.roleId), [roles.RESERVATIONS.id]);

        await prisma.user.update({ where: { id: user.id }, data: { role: 'FINANCE' } });
        assert.deepEqual((await held()).map((row) => row.roleId), [roles.FINANCE.id]);
    });

    it('keeps a platform role off a partner account and the two sides apart', async () => {
        const partner = await makePartner(tracker);
        const member = await makePartnerUser(tracker, partner, { role: 'PARTNER_AGENT' });
        const staff = await makeAdmin(tracker, { role: 'DISPATCHER' });

        await assert.rejects(
            prisma.userRole.create({ data: { userId: member.id, roleId: roles.MANAGEMENT.id } }),
            /rbac_user_roles_one_side|rbac_platform_role_requires_no_partner/
        );
        await assert.rejects(
            prisma.userRole.create({ data: { userId: staff.id, roleId: roles.PARTNER_AGENT.id } }),
            /rbac_user_roles_one_side|rbac_partner_role_requires_partner/
        );
    });

    it('resolves what a session may do from the rows, overrides included, on the next request', async () => {
        const user = await makeAdmin(tracker, { role: 'MANAGEMENT' });
        const { cookie } = await signIn(app, user.email);
        const me = () => request(app).get('/api/auth/me').set('Cookie', cookie);

        const before = await me();
        assert.equal(before.status, 200);
        assert.deepEqual(before.body.user.roles.map((role) => role.key), ['MANAGEMENT']);
        assert.ok(before.body.user.capabilities.includes(CAPABILITIES.FINANCE_MARGIN_READ));
        assert.ok(!before.body.user.capabilities.includes(CAPABILITIES.BOOKINGS_WRITE));

        await prisma.userCapabilityOverride.createMany({
            data: [
                { userId: user.id, capability: CAPABILITIES.BOOKINGS_WRITE, effect: 'GRANT', reason: 'Covering the desk' },
                { userId: user.id, capability: CAPABILITIES.FINANCE_MARGIN_READ, effect: 'DENY', reason: 'On loan to sales' },
                {
                    userId: user.id,
                    capability: CAPABILITIES.PRICING_WRITE,
                    effect: 'GRANT',
                    reason: 'Last week',
                    expiresAt: new Date(Date.now() - 60_000)
                }
            ]
        });

        const after = await me();
        assert.ok(after.body.user.capabilities.includes(CAPABILITIES.BOOKINGS_WRITE), 'a grant adds');
        assert.ok(!after.body.user.capabilities.includes(CAPABILITIES.FINANCE_MARGIN_READ), 'a denial wins over the role');
        assert.ok(!after.body.user.capabilities.includes(CAPABILITIES.PRICING_WRITE), 'an expired grant is nothing');

        // The guards read the same answer: the denied margin is gone from a response that carried it.
        const rules = await request(app).get('/api/admin/pricing-rules').set('Cookie', cookie);
        assert.equal(rules.status, 403);
    });

    it('finds who holds a capability the same way, grants and denials included', async () => {
        const partner = await makePartner(tracker);
        const owner = await makePartnerUser(tracker, partner);
        const agent = await makePartnerUser(tracker, partner, { role: 'PARTNER_AGENT', isPrimaryContact: false });
        const quiet = await makePartnerUser(tracker, partner, { role: 'PARTNER_FINANCE', isPrimaryContact: false });

        await prisma.userCapabilityOverride.create({
            data: { userId: agent.id, capability: CAPABILITIES.PARTNER_STATEMENT_READ, effect: 'GRANT', reason: 'Stands in' }
        });
        await prisma.userCapabilityOverride.create({
            data: { userId: quiet.id, capability: CAPABILITIES.PARTNER_STATEMENT_READ, effect: 'DENY', reason: 'Left' }
        });

        const readers = await usersWithCapability(CAPABILITIES.PARTNER_STATEMENT_READ, { partnerId: partner.id });
        assert.deepEqual(readers.sort(), [owner.id, agent.id].sort());
    });

    it('computes a super admin as holding everything on its own side, and nothing of a company', () => {
        const held = resolveCapabilities({ roles: [{ role: { key: 'SUPER_ADMIN', capabilities: [] } }] });

        assert.ok(held.has(CAPABILITIES.USERS_STAFF_MANAGE));
        assert.ok(held.has(CAPABILITIES.FINANCE_PAYMENTS_WRITE), 'computed, not listed');
        // A partner capability is always scoped by a partnerId a platform
        // account does not have; holding one would reach a company's routes
        // with no company behind them.
        assert.ok(!held.has(CAPABILITIES.PARTNER_BOOKINGS_WRITE));
        assert.ok(!held.has(CAPABILITIES.PARTNER_TEAM_MANAGE));
    });
});
