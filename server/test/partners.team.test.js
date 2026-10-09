import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import { outbox, clearOutbox } from '../lib/mailer/index.js';
import {
    createTracker,
    makeAdmin,
    makePartner,
    makePartnerUser,
    signIn,
    testEmail,
    databaseAvailable
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

describe('a partner managing its team', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let partner;
    let owner;
    let teamAdmin;
    let agent;
    let ownerCookie;
    let adminCookie;
    let agentCookie;
    let strangerOwner;

    before(async () => {
        partner = await makePartner(tracker);
        owner = await makePartnerUser(tracker, partner);
        teamAdmin = await makePartnerUser(tracker, partner, { role: 'PARTNER_ADMIN', isPrimaryContact: false });
        agent = await makePartnerUser(tracker, partner, { role: 'PARTNER_AGENT', isPrimaryContact: false });
        ownerCookie = (await signIn(app, owner.email)).cookie;
        adminCookie = (await signIn(app, teamAdmin.email)).cookie;
        agentCookie = (await signIn(app, agent.email)).cookie;
        strangerOwner = await makePartnerUser(tracker, await makePartner(tracker));
    });

    beforeEach(clearOutbox);

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const invite = async (cookie, overrides = {}) => {
        const res = await request(app)
            .post('/api/partner/team')
            .set('Cookie', cookie)
            .send({ email: testEmail('member'), firstName: 'Giorgi', lastName: 'Lomidze', role: 'PARTNER_AGENT', ...overrides });

        if (res.body.user?.id) {
            tracker.user(res.body.user);
        }

        return res;
    };

    it('is for owners and admins; agents, finance users and platform staff are refused', async () => {
        assert.equal((await request(app).get('/api/partner/team').set('Cookie', agentCookie)).status, 403);

        const finance = await makePartnerUser(tracker, partner, { role: 'PARTNER_FINANCE', isPrimaryContact: false });
        const financeCookie = (await signIn(app, finance.email)).cookie;
        assert.equal((await request(app).get('/api/partner/team').set('Cookie', financeCookie)).status, 403);

        const platformCookie = (await signIn(app, (await makeAdmin(tracker)).email)).cookie;
        assert.equal((await request(app).get('/api/partner/team').set('Cookie', platformCookie)).status, 403);

        assert.equal((await request(app).get('/api/partner/team').set('Cookie', adminCookie)).status, 200);
    });

    it('lists this company only', async () => {
        const res = await request(app).get('/api/partner/team?pageSize=100').set('Cookie', ownerCookie);
        const ids = res.body.data.map((user) => user.id);

        assert.ok(ids.includes(owner.id));
        assert.ok(ids.includes(teamAdmin.id));
        assert.ok(ids.includes(agent.id));
        assert.ok(!ids.includes(strangerOwner.id));
        assert.equal(res.body.data.find((user) => user.id === owner.id).isPrimaryContact, true);
    });

    it('never finds another company\'s member, whatever the verb', async () => {
        const id = strangerOwner.id;

        assert.equal((await request(app).get(`/api/partner/team/${id}`).set('Cookie', ownerCookie)).status, 404);
        assert.equal(
            (await request(app).patch(`/api/partner/team/${id}/role`).set('Cookie', ownerCookie).send({ role: 'PARTNER_AGENT' })).status,
            404
        );
        assert.equal((await request(app).post(`/api/partner/team/${id}/deactivate`).set('Cookie', ownerCookie).send({})).status, 404);
        assert.equal(
            (await request(app).delete(`/api/partner/team/${id}`).set('Cookie', ownerCookie).send({ confirm: strangerOwner.email })).status,
            404
        );

        assert.equal((await prisma.user.findUnique({ where: { id } })).isActive, true);
    });

    it('invites a member with the company named in the email, and an owner may make admins where an admin may not', async () => {
        const byOwner = await invite(ownerCookie, { role: 'PARTNER_ADMIN' });

        assert.equal(byOwner.status, 201);
        assert.equal(byOwner.body.user.partnerId, partner.id);
        assert.equal(byOwner.body.user.status, 'INVITED');
        assert.equal(byOwner.body.user.invitedBy.id, owner.id);
        assert.equal(outbox[0].template, 'accountActivation');
        assert.equal(outbox[0].to, byOwner.body.user.email);
        assert.match(byOwner.body.link.url, /\/activate\//);

        const aboveCeiling = await invite(adminCookie, { role: 'PARTNER_ADMIN' });
        assert.equal(aboveCeiling.status, 403);
        assert.equal(aboveCeiling.body.error.details.reason, 'ROLE_ABOVE_CEILING');

        assert.equal((await invite(adminCookie, { role: 'PARTNER_FINANCE' })).status, 201);
        assert.equal((await invite(ownerCookie, { role: 'PARTNER_OWNER' })).status, 400);
        assert.equal((await invite(ownerCookie, { role: 'ADMIN' })).status, 400);
    });

    it('keeps an admin off the owner, and lets the owner hand ownership on', async () => {
        const demote = await request(app)
            .patch(`/api/partner/team/${owner.id}/role`)
            .set('Cookie', adminCookie)
            .send({ role: 'PARTNER_AGENT' });
        assert.equal(demote.status, 403);

        const off = await request(app).post(`/api/partner/team/${owner.id}/deactivate`).set('Cookie', adminCookie).send({});
        assert.equal(off.status, 403);

        const second = await makePartnerUser(tracker, partner, { role: 'PARTNER_ADMIN', isPrimaryContact: false });
        const promote = await request(app)
            .patch(`/api/partner/team/${second.id}/role`)
            .set('Cookie', ownerCookie)
            .send({ role: 'PARTNER_OWNER' });

        assert.equal(promote.status, 200);
        assert.equal(promote.body.role, 'PARTNER_OWNER');
    });

    it('moves the primary contact, to an active member only', async () => {
        const moved = await request(app).patch(`/api/partner/team/${teamAdmin.id}/primary-contact`).set('Cookie', ownerCookie);

        assert.equal(moved.status, 200);
        assert.equal(moved.body.isPrimaryContact, true);

        const previous = await request(app).get(`/api/partner/team/${owner.id}`).set('Cookie', ownerCookie);
        assert.equal(previous.body.isPrimaryContact, false);

        const primaries = await prisma.user.count({ where: { partnerId: partner.id, isPrimaryContact: true } });
        assert.equal(primaries, 1);

        const invited = await invite(ownerCookie);
        const refused = await request(app)
            .patch(`/api/partner/team/${invited.body.user.id}/primary-contact`)
            .set('Cookie', ownerCookie);
        assert.equal(refused.status, 409);
        assert.equal(refused.body.error.details.reason, 'NOT_ACTIVE');

        // Put it back so the other tests see the partner as the factory made it.
        await request(app).patch(`/api/partner/team/${owner.id}/primary-contact`).set('Cookie', ownerCookie);
    });

    it('does not let a partner admin take the primary contact from the owner', async () => {
        const self = await request(app).patch(`/api/partner/team/${teamAdmin.id}/primary-contact`).set('Cookie', adminCookie);

        assert.equal(self.status, 403);
        assert.equal(self.body.error.details.reason, 'ROLE_ABOVE_CEILING');

        // Even to an agent: the owner holds it, and an admin cannot take it from an owner.
        const toAgent = await request(app).patch(`/api/partner/team/${agent.id}/primary-contact`).set('Cookie', adminCookie);
        assert.equal(toAgent.status, 403);

        const current = await prisma.user.findUnique({ where: { id: owner.id } });
        assert.equal(current.isPrimaryContact, true);
    });

    it('deactivates an agent, who is signed out at once; the admin may do that much', async () => {
        const target = await makePartnerUser(tracker, partner, { role: 'PARTNER_AGENT', isPrimaryContact: false });
        const { cookie } = await signIn(app, target.email);

        const off = await request(app)
            .post(`/api/partner/team/${target.id}/deactivate`)
            .set('Cookie', adminCookie)
            .send({ reason: 'Seasonal contract ended' });

        assert.equal(off.status, 200);
        assert.equal(off.body.status, 'DEACTIVATED');
        assert.equal(off.body.deactivatedBy.id, teamAdmin.id);
        assert.equal((await request(app).get('/api/partner/me').set('Cookie', cookie)).status, 401);

        const gone = await request(app)
            .delete(`/api/partner/team/${target.id}`)
            .set('Cookie', adminCookie)
            .send({ confirm: target.email });
        assert.equal(gone.status, 204);
        assert.equal(await prisma.user.findUnique({ where: { id: target.id } }), null);
    });

    it('caps the team', async () => {
        const fresh = await makePartner(tracker);
        const freshOwner = await makePartnerUser(tracker, fresh);
        const cookie = (await signIn(app, freshOwner.email)).cookie;

        for (let i = 1; i < config.partners.teamMax; i += 1) {
            await makePartnerUser(tracker, fresh, { role: 'PARTNER_AGENT', isPrimaryContact: false, withPassword: false });
        }

        const full = await invite(cookie);

        assert.equal(full.status, 409);
        assert.equal(full.body.error.details.reason, 'TEAM_FULL');
    });

    it('is closed to a partner that is not approved', async () => {
        const pending = await makePartner(tracker, { status: 'SUSPENDED' });
        const pendingOwner = await makePartnerUser(tracker, pending);
        const cookie = (await signIn(app, pendingOwner.email)).cookie;

        const res = await request(app).get('/api/partner/team').set('Cookie', cookie);

        assert.equal(res.status, 403);
        assert.equal(res.body.error.details.partnerStatus, 'SUSPENDED');
    });
});
