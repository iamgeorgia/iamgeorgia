import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { outbox, clearOutbox } from '../lib/mailer/index.js';
import {
    createTracker,
    makeAdmin,
    makePartner,
    makePartnerUser,
    makeAuthToken,
    signIn,
    testEmail,
    databaseAvailable
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const NEW_PASSWORD = 'Correct-Horse-Battery-9';

const tokenOf = (link) => link.url.split('/activate/')[1];

describe('staff accounts', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let superAdmin;
    let superCookie;
    let adminCookie;

    before(async () => {
        superAdmin = await makeAdmin(tracker, { role: 'SUPER_ADMIN' });
        superCookie = (await signIn(app, superAdmin.email)).cookie;
        adminCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;
    });

    beforeEach(clearOutbox);

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const invite = async (overrides = {}, cookie = superCookie) => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Cookie', cookie)
            .send({ email: testEmail('staff'), firstName: 'Tamar', lastName: 'Kiknadze', role: 'RESERVATIONS', ...overrides });

        if (res.body.user?.id) {
            tracker.user(res.body.user);
        }

        return res;
    };

    const auditRows = (entityId, action) =>
        prisma.auditLog.findMany({ where: { entityType: 'User', entityId, action }, orderBy: { createdAt: 'desc' } });

    it('is a super admin matter: an admin is refused and told why', async () => {
        const res = await request(app).get('/api/admin/users').set('Cookie', adminCookie);

        assert.equal(res.status, 403);
        assert.equal(res.body.error.details.reason, 'INSUFFICIENT_CAPABILITY');
        assert.deepEqual(res.body.error.details.required, ['users.staff.manage']);

        const list = await request(app).get(`/api/admin/users?q=${superAdmin.email}`).set('Cookie', superCookie);

        assert.equal(list.status, 200);
        assert.deepEqual(
            list.body.data.map((user) => user.id),
            [superAdmin.id]
        );
        assert.equal(typeof list.body.totalPages, 'number');
    });

    it('invites a staff member, emails the link, returns it, and the invitee signs in with the role', async () => {
        const res = await invite({ role: 'FINANCE' });

        assert.equal(res.status, 201);
        assert.equal(res.body.user.status, 'INVITED');
        assert.equal(res.body.user.role, 'FINANCE');
        assert.equal(res.body.user.invitedBy.id, superAdmin.id);
        assert.equal(res.body.emailSent, true);
        assert.match(res.body.link.url, /\/activate\//);
        assert.equal(outbox[0].to, res.body.user.email);
        assert.equal(outbox[0].template, 'staffAccountActivation');

        const [invited] = await auditRows(res.body.user.id, 'USER_INVITED');
        assert.equal(invited.actorUserId, superAdmin.id);
        assert.equal(invited.metadata.role, 'FINANCE');

        const activated = await request(app)
            .post(`/api/auth/activation/${tokenOf(res.body.link)}`)
            .send({ password: NEW_PASSWORD });

        assert.equal(activated.status, 200);

        const session = await signIn(app, res.body.user.email, NEW_PASSWORD);

        assert.equal(session.status, 200);
        assert.equal(session.body.user.role, 'FINANCE');
        assert.ok(session.body.user.capabilities.includes('finance.payments.write'));
        assert.ok(!session.body.user.capabilities.includes('catalogue.write'));

        const detail = await request(app).get(`/api/admin/users/${res.body.user.id}`).set('Cookie', superCookie);
        assert.equal(detail.body.status, 'ACTIVE');
    });

    it('refuses a taken address, a super admin seat, and an unknown field', async () => {
        const taken = await invite({ email: superAdmin.email });
        assert.equal(taken.status, 409);
        assert.equal(taken.body.error.details.field, 'email');

        assert.equal((await invite({ role: 'SUPER_ADMIN' })).status, 400);
        assert.equal((await invite({ role: 'PARTNER_AGENT' })).status, 400);
        assert.equal((await invite({ isActive: false })).status, 400);
    });

    it('re-sends the activation link and spends the old one', async () => {
        const first = await invite();
        const resent = await request(app)
            .post(`/api/admin/users/${first.body.user.id}/activation/resend`)
            .set('Cookie', superCookie);

        assert.equal(resent.status, 200);
        assert.notEqual(tokenOf(resent.body.link), tokenOf(first.body.link));
        assert.equal(outbox.at(-1).template, 'staffAccountActivation');

        const stale = await request(app).get(`/api/auth/activation/${tokenOf(first.body.link)}`);
        assert.equal(stale.status, 409);

        const fresh = await request(app).get(`/api/auth/activation/${tokenOf(resent.body.link)}`);
        assert.equal(fresh.status, 200);
    });

    it('changes a role and ends the sessions that were opened under the old one', async () => {
        const user = await makeAdmin(tracker, { role: 'DISPATCHER' });
        const { cookie } = await signIn(app, user.email);

        const res = await request(app)
            .patch(`/api/admin/users/${user.id}/role`)
            .set('Cookie', superCookie)
            .send({ role: 'MANAGEMENT' });

        assert.equal(res.status, 200);
        assert.equal(res.body.role, 'MANAGEMENT');
        assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);

        const [row] = await auditRows(user.id, 'USER_ROLE_CHANGED');
        assert.deepEqual(row.metadata, { from: 'DISPATCHER', to: 'MANAGEMENT' });

        const again = await signIn(app, user.email);
        assert.equal(again.body.user.role, 'MANAGEMENT');
    });

    it('does not let anyone change, deactivate or delete their own account here', async () => {
        const role = await request(app)
            .patch(`/api/admin/users/${superAdmin.id}/role`)
            .set('Cookie', superCookie)
            .send({ role: 'ADMIN' });
        assert.equal(role.status, 400);
        assert.equal(role.body.error.details.reason, 'SELF');

        const off = await request(app).post(`/api/admin/users/${superAdmin.id}/deactivate`).set('Cookie', superCookie).send({});
        assert.equal(off.status, 400);

        const gone = await request(app)
            .delete(`/api/admin/users/${superAdmin.id}`)
            .set('Cookie', superCookie)
            .send({ confirm: superAdmin.email });
        assert.equal(gone.status, 400);
    });

    it('deactivates an account, which ends its access at once, and reactivates it', async () => {
        const user = await makeAdmin(tracker, { role: 'RESERVATIONS' });
        const { cookie } = await signIn(app, user.email);

        const off = await request(app)
            .post(`/api/admin/users/${user.id}/deactivate`)
            .set('Cookie', superCookie)
            .send({ reason: 'Left the company' });

        assert.equal(off.status, 200);
        assert.equal(off.body.status, 'DEACTIVATED');
        assert.equal(off.body.deactivatedBy.id, superAdmin.id);
        assert.ok(off.body.deactivatedAt);
        assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
        assert.equal((await signIn(app, user.email)).status, 401);

        const [row] = await auditRows(user.id, 'USER_DEACTIVATED');
        assert.equal(row.metadata.reason, 'Left the company');

        const on = await request(app).post(`/api/admin/users/${user.id}/reactivate`).set('Cookie', superCookie);

        assert.equal(on.status, 200);
        assert.equal(on.body.status, 'ACTIVE');
        assert.equal(on.body.deactivatedBy, null);
        assert.equal((await signIn(app, user.email)).status, 200);
    });

    it('spends a pending reset link when it deactivates, so the link cannot switch the account back on', async () => {
        const user = await makeAdmin(tracker, { role: 'FINANCE' });
        const { token } = await makeAuthToken({ userId: user.id, purpose: 'PASSWORD_RESET' });

        await request(app).post(`/api/admin/users/${user.id}/deactivate`).set('Cookie', superCookie).send({});

        const reset = await request(app).post(`/api/auth/password/reset/${token}`).send({ password: NEW_PASSWORD });

        assert.equal(reset.status, 409);
        assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).isActive, false);
    });

    it('deletes an invitation or a deactivated account, never an active one, and only with the address typed back', async () => {
        const invited = await invite();
        const id = invited.body.user.id;

        const off = await request(app).post(`/api/admin/users/${id}/deactivate`).set('Cookie', superCookie).send({});
        assert.equal(off.status, 409);
        assert.equal(off.body.error.details.reason, 'NOT_ACTIVATED');

        const wrong = await request(app)
            .delete(`/api/admin/users/${id}`)
            .set('Cookie', superCookie)
            .send({ confirm: 'someone-else@example.com' });
        assert.equal(wrong.status, 400);
        assert.equal(wrong.body.error.details.reason, 'CONFIRM_MISMATCH');

        const gone = await request(app)
            .delete(`/api/admin/users/${id}`)
            .set('Cookie', superCookie)
            .send({ confirm: invited.body.user.email });
        assert.equal(gone.status, 204);
        assert.equal((await request(app).get(`/api/admin/users/${id}`).set('Cookie', superCookie)).status, 404);

        const [row] = await auditRows(id, 'USER_DELETED');
        assert.equal(row.actorEmail, superAdmin.email);
        assert.equal(row.metadata.email, invited.body.user.email);

        const active = await makeAdmin(tracker, { role: 'ADMIN' });
        const refused = await request(app)
            .delete(`/api/admin/users/${active.id}`)
            .set('Cookie', superCookie)
            .send({ confirm: active.email });
        assert.equal(refused.status, 409);
        assert.equal(refused.body.error.details.reason, 'STILL_ACTIVE');
    });

    it('signs an account out everywhere without touching its password', async () => {
        const user = await makeAdmin(tracker, { role: 'ADMIN' });
        const { cookie } = await signIn(app, user.email);

        const res = await request(app).post(`/api/admin/users/${user.id}/sessions/revoke`).set('Cookie', superCookie);

        assert.equal(res.status, 200);
        assert.equal(res.body.revoked, 1);
        assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
        assert.equal((await signIn(app, user.email)).status, 200);
    });

    it('lists staff only — not drivers, not partner users — and filters', async () => {
        const partner = await makePartner(tracker);
        const partnerUser = await makePartnerUser(tracker, partner);
        const driver = await makeAdmin(tracker, { role: 'DRIVER' });
        const invited = await invite({ firstName: 'Zurab', lastName: 'Unique-Surname' });

        const all = await request(app).get('/api/admin/users?pageSize=100').set('Cookie', superCookie);
        const ids = all.body.data.map((user) => user.id);

        assert.ok(!ids.includes(partnerUser.id));
        assert.ok(!ids.includes(driver.id));
        assert.ok(ids.includes(invited.body.user.id));
        assert.equal((await request(app).get(`/api/admin/users/${partnerUser.id}`).set('Cookie', superCookie)).status, 404);

        const byStatus = await request(app)
            .get('/api/admin/users?status=INVITED&role=RESERVATIONS&pageSize=100')
            .set('Cookie', superCookie);
        assert.ok(byStatus.body.data.every((user) => user.status === 'INVITED' && user.role === 'RESERVATIONS'));
        assert.ok(byStatus.body.data.some((user) => user.id === invited.body.user.id));

        const byName = await request(app).get('/api/admin/users?q=unique-surname').set('Cookie', superCookie);
        assert.deepEqual(
            byName.body.data.map((user) => user.id),
            [invited.body.user.id]
        );
    });
});
