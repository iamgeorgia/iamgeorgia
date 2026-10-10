import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { CAPABILITIES } from '../lib/permissions.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makePartner,
    makePartnerUser,
    signIn,
    unique
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

/**
 * The roles API and the one rule under it: nobody hands out, or touches,
 * more than they hold.
 */
describe('roles, several per account, and overrides', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const customKeys = [];
    let superCookie;
    let adminCookie;

    before(async () => {
        superCookie = (await signIn(app, (await makeAdmin(tracker, { role: 'SUPER_ADMIN' })).email)).cookie;
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;
    });

    after(async () => {
        // Users first: a role still held cannot be deleted from under them.
        await tracker.cleanup();
        await prisma.accessRole.deleteMany({ where: { key: { in: customKeys } } });
        await disconnect();
    });

    const customKey = () => {
        const key = unique('role').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
        customKeys.push(key);
        return key;
    };

    const asSuper = (method, path, body) => request(app)[method](path).set('Cookie', superCookie).send(body);

    it('lists the roles with what each may do, to a super admin only', async () => {
        const res = await asSuper('get', '/api/admin/roles');

        assert.equal(res.status, 200);
        const tourOperator = res.body.data.find((role) => role.key === 'TOUR_OPERATOR');
        assert.ok(tourOperator.capabilities.includes(CAPABILITIES.TOURS_WRITE));
        assert.ok(!tourOperator.capabilities.includes(CAPABILITIES.PRICING_WRITE));
        assert.equal(tourOperator.isSystem, true);

        assert.equal((await request(app).get('/api/admin/roles').set('Cookie', adminCookie)).status, 403);

        const caps = await asSuper('get', '/api/admin/roles/capabilities');
        assert.equal(caps.status, 200);
        assert.ok(caps.body.data.some((group) => group.area === 'finance'));
        assert.ok(caps.body.protected.includes(CAPABILITIES.USERS_STAFF_MANAGE));
    });

    it('makes a role from capabilities the maker holds, on one side, and refuses the rest', async () => {
        const key = customKey();

        const wrongSide = await asSuper('post', '/api/admin/roles', { key, name: 'Mixed', side: 'PLATFORM', capabilities: [CAPABILITIES.PARTNER_TEAM_MANAGE] });
        assert.equal(wrongSide.status, 400);
        assert.equal(wrongSide.body.error.details.reason, 'CAPABILITY_WRONG_SIDE');

        const unknown = await asSuper('post', '/api/admin/roles', { key, name: 'Odd', side: 'PLATFORM', capabilities: ['nothing.here'] });
        assert.equal(unknown.status, 400);

        const shouting = await asSuper('post', '/api/admin/roles', { key: 'SHOUTING', name: 'Loud', side: 'PLATFORM', capabilities: [] });
        assert.equal(shouting.status, 400);

        const created = await asSuper('post', '/api/admin/roles', {
            key,
            name: 'Content editor',
            side: 'PLATFORM',
            capabilities: [CAPABILITIES.CATALOGUE_READ, CAPABILITIES.CATALOGUE_WRITE, CAPABILITIES.NOTIFICATIONS_READ]
        });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.equal(created.body.isSystem, false);
        assert.deepEqual(created.body.capabilities, [CAPABILITIES.CATALOGUE_READ, CAPABILITIES.CATALOGUE_WRITE, CAPABILITIES.NOTIFICATIONS_READ].sort());

        const audit = await prisma.auditLog.findFirst({ where: { action: 'ROLE_CREATED', entityId: created.body.id } });
        assert.ok(audit);

        assert.equal((await asSuper('post', '/api/admin/roles', { key, name: 'Again', side: 'PLATFORM', capabilities: [] })).status, 409);
    });

    it('edits what a role may do, with the change on the trail, and keeps a super admin and a driver fixed', async () => {
        const key = customKey();
        await asSuper('post', '/api/admin/roles', { key, name: 'Desk', side: 'PLATFORM', capabilities: [CAPABILITIES.CATALOGUE_READ] });

        const edited = await asSuper('patch', `/api/admin/roles/${key}`, { capabilities: [CAPABILITIES.CATALOGUE_READ, CAPABILITIES.BOOKINGS_READ], name: 'Desk, renamed' });
        assert.equal(edited.status, 200);
        assert.deepEqual(edited.body.capabilities, [CAPABILITIES.BOOKINGS_READ, CAPABILITIES.CATALOGUE_READ]);

        const audit = await prisma.auditLog.findFirst({ where: { action: 'ROLE_UPDATED', entityId: edited.body.id }, orderBy: { createdAt: 'desc' } });
        assert.deepEqual(audit.metadata.changes.capabilities, { added: [CAPABILITIES.BOOKINGS_READ], removed: [] });
        assert.equal(audit.metadata.changes.name.to, 'Desk, renamed');

        const locked = await asSuper('patch', '/api/admin/roles/SUPER_ADMIN', { capabilities: [CAPABILITIES.CATALOGUE_READ] });
        assert.equal(locked.status, 409);
        assert.equal(locked.body.error.details.reason, 'ROLE_LOCKED');

        assert.equal((await asSuper('patch', '/api/admin/roles/DRIVER', { capabilities: [] })).status, 409);
    });

    it('deletes a role nobody holds, and no system role', async () => {
        const key = customKey();
        await asSuper('post', '/api/admin/roles', { key, name: 'Temp', side: 'PLATFORM', capabilities: [] });

        const user = await makeAdmin(tracker, { role: 'MANAGEMENT' });
        const given = await asSuper('put', `/api/admin/users/${user.id}/roles`, { roles: ['MANAGEMENT', key] });
        assert.equal(given.status, 200, JSON.stringify(given.body));

        const inUse = await asSuper('delete', `/api/admin/roles/${key}`);
        assert.equal(inUse.status, 409);
        assert.equal(inUse.body.error.details.reason, 'ROLE_IN_USE');

        await asSuper('put', `/api/admin/users/${user.id}/roles`, { roles: ['MANAGEMENT'] });
        assert.equal((await asSuper('delete', `/api/admin/roles/${key}`)).status, 204);
        assert.equal((await asSuper('delete', '/api/admin/roles/DISPATCHER')).status, 409);
    });

    it('gives an account several roles, keeps a built-in one primary, and resolves the union', async () => {
        const key = customKey();
        await asSuper('post', '/api/admin/roles', { key, name: 'Also finance reader', side: 'PLATFORM', capabilities: [CAPABILITIES.FINANCE_PAYMENTS_READ] });

        const user = await makeAdmin(tracker, { role: 'TOUR_OPERATOR' });

        // A panel-made role alone can be the primary: the label is just a label.
        const onlyCustom = await asSuper('put', `/api/admin/users/${user.id}/roles`, { roles: [key] });
        assert.equal(onlyCustom.status, 200, JSON.stringify(onlyCustom.body));
        assert.equal(onlyCustom.body.role, key);
        assert.deepEqual(onlyCustom.body.roles.map((role) => role.key), [key]);

        const set = await asSuper('put', `/api/admin/users/${user.id}/roles`, { roles: ['TOUR_OPERATOR', key] });
        assert.equal(set.status, 200, JSON.stringify(set.body));
        assert.equal(set.body.role, 'TOUR_OPERATOR');
        assert.deepEqual(set.body.roles.map((role) => role.key).sort(), ['TOUR_OPERATOR', key].sort());
        assert.ok(set.body.capabilities.includes(CAPABILITIES.FINANCE_PAYMENTS_READ));
        assert.ok(set.body.capabilities.includes(CAPABILITIES.TOURS_WRITE));

        // The person sees it on their next sign-in.
        const { cookie } = await signIn(app, user.email);
        assert.equal((await request(app).get('/api/admin/finance/payments').set('Cookie', cookie)).status, 200);

        // Swapping the primary swaps the primary row and leaves the rest.
        const swapped = await asSuper('put', `/api/admin/users/${user.id}/roles`, { roles: ['MANAGEMENT', key] });
        assert.equal(swapped.body.role, 'MANAGEMENT');
        assert.deepEqual(swapped.body.roles.map((role) => role.key).sort(), ['MANAGEMENT', key].sort());

        const audit = await prisma.auditLog.findFirst({ where: { action: 'USER_ROLES_CHANGED', entityId: user.id }, orderBy: { createdAt: 'desc' } });
        assert.deepEqual(audit.metadata.to, ['MANAGEMENT', key].sort());

        // A company role by key, or a driver, is refused on the platform side.
        assert.equal((await asSuper('put', `/api/admin/users/${user.id}/roles`, { roles: ['PARTNER_AGENT'] })).body.error.details.reason, 'ROLE_WRONG_SIDE');
        assert.equal((await asSuper('put', `/api/admin/users/${user.id}/roles`, { roles: ['DRIVER'] })).status, 400);
    });

    it('writes an override the actor holds, never a protected one, and takes it back', async () => {
        const user = await makeAdmin(tracker, { role: 'MANAGEMENT' });
        const path = `/api/admin/users/${user.id}/overrides`;

        const protectedCap = await asSuper('post', path, { capability: CAPABILITIES.USERS_STAFF_MANAGE, effect: 'GRANT', reason: 'No' });
        assert.equal(protectedCap.status, 403);
        assert.equal(protectedCap.body.error.details.reason, 'PROTECTED_CAPABILITY');

        const wrongSide = await asSuper('post', path, { capability: CAPABILITIES.PARTNER_BOOKINGS_WRITE, effect: 'GRANT', reason: 'No' });
        assert.equal(wrongSide.status, 400);

        const granted = await asSuper('post', path, { capability: CAPABILITIES.BOOKINGS_WRITE, effect: 'GRANT', reason: 'Covering the desk this week' });
        assert.equal(granted.status, 201, JSON.stringify(granted.body));
        assert.ok(granted.body.capabilities.includes(CAPABILITIES.BOOKINGS_WRITE));
        assert.equal(granted.body.overrides[0].effect, 'GRANT');

        const denied = await asSuper('post', path, { capability: CAPABILITIES.FINANCE_MARGIN_READ, effect: 'DENY', reason: 'On loan to sales' });
        assert.ok(!denied.body.capabilities.includes(CAPABILITIES.FINANCE_MARGIN_READ));

        const { cookie } = await signIn(app, user.email);
        assert.equal((await request(app).get('/api/admin/pricing-rules').set('Cookie', cookie)).status, 403);

        const removed = await asSuper('delete', `${path}/${CAPABILITIES.FINANCE_MARGIN_READ}`);
        assert.equal(removed.status, 200);
        assert.ok(removed.body.capabilities.includes(CAPABILITIES.FINANCE_MARGIN_READ));
        assert.equal((await asSuper('delete', `${path}/${CAPABILITIES.FINANCE_MARGIN_READ}`)).status, 404);

        const rows = await prisma.auditLog.findMany({ where: { entityId: user.id, action: { in: ['USER_OVERRIDE_GRANTED', 'USER_OVERRIDE_REVOKED'] } } });
        assert.equal(rows.length, 3);
    });

    it("tells the caller what it may hand out, and holds a partner admin to the company's roles it dominates", async () => {
        const mine = await asSuper('get', `/api/admin/users/${(await makeAdmin(tracker)).id}/grantable`);
        assert.equal(mine.status, 200);
        const keys = mine.body.roles.map((role) => role.key);
        assert.ok(keys.includes('ADMIN') && keys.includes('SUPER_ADMIN') && keys.includes('FINANCE_OPERATOR'));
        assert.ok(!keys.includes('PARTNER_OWNER') && !keys.includes('DRIVER'));
        assert.ok(!mine.body.capabilities.includes(CAPABILITIES.USERS_STAFF_MANAGE), 'protected ones are not for writing by name');

        const partner = await makePartner(tracker);
        await makePartnerUser(tracker, partner);
        const teamAdmin = await makePartnerUser(tracker, partner, { role: 'PARTNER_ADMIN', isPrimaryContact: false });
        const agent = await makePartnerUser(tracker, partner, { role: 'PARTNER_AGENT', isPrimaryContact: false });
        const adminTeamCookie = (await signIn(app, teamAdmin.email)).cookie;

        const theirs = await request(app).get('/api/partner/team/grantable').set('Cookie', adminTeamCookie);
        assert.deepEqual(theirs.body.roles.map((role) => role.key), ['PARTNER_AGENT']);

        const up = await request(app).put(`/api/partner/team/${agent.id}/roles`).set('Cookie', adminTeamCookie).send({ roles: ['PARTNER_FINANCE'] });
        assert.equal(up.status, 403);
        assert.equal(up.body.error.details.reason, 'ROLE_ABOVE_CEILING');
        assert.ok(up.body.error.details.missing.includes(CAPABILITIES.PARTNER_FINANCIAL_WRITE));
    });
});
