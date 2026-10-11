import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { AUDIT_ENTITY } from '../lib/audit.js';
import {
    createTracker,
    makeAdmin,
    makePartner,
    makePartnerUser,
    signIn,
    databaseAvailable
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

describe('audit trail', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const scenario = async (status = 'PENDING_APPROVAL') => {
        const admin = await makeAdmin(tracker);
        const partner = await makePartner(tracker, { status });

        await makePartnerUser(tracker, partner);

        return { admin, partner, cookie: (await signIn(app, admin.email)).cookie };
    };

    it('records every review action with its actor and reason', async () => {
        const { admin, partner, cookie } = await scenario();

        await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({});
        await request(app)
            .post(`/api/admin/partners/${partner.id}/suspend`)
            .set('Cookie', cookie)
            .send({ reason: 'Payment dispute' });
        await request(app).post(`/api/admin/partners/${partner.id}/reactivate`).set('Cookie', cookie).send({});

        const entries = await prisma.auditLog.findMany({
            where: { entityId: partner.id },
            orderBy: { createdAt: 'asc' }
        });

        assert.deepEqual(
            entries.map((entry) => entry.action),
            ['PARTNER_APPROVED', 'PARTNER_SUSPENDED', 'PARTNER_REACTIVATED']
        );

        assert.ok(entries.every((entry) => entry.actorUserId === admin.id));
        assert.ok(entries.every((entry) => entry.actorEmail === admin.email));
        assert.ok(entries.every((entry) => entry.entityType === AUDIT_ENTITY.partner));
        assert.equal(entries[1].metadata.reason, 'Payment dispute');
    });

    it('records an edit as the fields that actually moved', async () => {
        const { partner, cookie } = await scenario();

        await request(app)
            .patch(`/api/admin/partners/${partner.id}`)
            .set('Cookie', cookie)
            .send({ city: 'Batumi', name: partner.name });

        const entry = await prisma.auditLog.findFirst({
            where: { entityId: partner.id, action: 'PARTNER_UPDATED' }
        });

        assert.deepEqual(Object.keys(entry.metadata.changes), ['city']);
        assert.equal(entry.metadata.changes.city.from, 'Tbilisi');
        assert.equal(entry.metadata.changes.city.to, 'Batumi');
    });

    it('writes nothing for an edit that changes nothing', async () => {
        const { partner, cookie } = await scenario();

        await request(app).patch(`/api/admin/partners/${partner.id}`).set('Cookie', cookie).send({ city: 'Tbilisi' });

        assert.equal(
            await prisma.auditLog.count({ where: { entityId: partner.id, action: 'PARTNER_UPDATED' } }),
            0
        );
    });

    it('rolls the audit row back with the action it describes', async () => {
        const { partner, cookie } = await scenario('REJECTED');

        // Refused by the transition table, so neither the status nor the record
        // of it changing may survive.
        const res = await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({});

        assert.equal(res.status, 409);
        assert.equal(await prisma.auditLog.count({ where: { entityId: partner.id } }), 0);
    });

    /**
     * The reason AuditLog has no foreign key to its subject. A trail that
     * vanished along with the partner it describes would be useless for the one
     * question it exists to answer.
     */
    it('outlives the partner it describes', async () => {
        const { partner, cookie } = await scenario();

        await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({});
        await prisma.partner.delete({ where: { id: partner.id } });

        const entries = await prisma.auditLog.findMany({ where: { entityId: partner.id } });

        assert.equal(entries.length, 1);
        assert.equal(entries[0].action, 'PARTNER_APPROVED');

        await prisma.auditLog.deleteMany({ where: { entityId: partner.id } });
    });

    /** SetNull on the actor, with the email kept as a snapshot beside it. */
    it('still names the admin after their account is deleted', async () => {
        const { admin, partner, cookie } = await scenario();

        await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({});
        await prisma.user.delete({ where: { id: admin.id } });

        const entry = await prisma.auditLog.findFirst({ where: { entityId: partner.id } });

        assert.equal(entry.actorUserId, null);
        assert.equal(entry.actorEmail, admin.email);
    });

    it('serves the trail to an admin, newest first', async () => {
        const { partner, cookie } = await scenario();

        await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({});
        await request(app)
            .post(`/api/admin/partners/${partner.id}/suspend`)
            .set('Cookie', cookie)
            .send({ reason: 'Payment dispute' });

        const res = await request(app).get(`/api/admin/partners/${partner.id}/audit`).set('Cookie', cookie);

        assert.equal(res.status, 200);
        assert.equal(res.body.data[0].action, 'PARTNER_SUSPENDED');
        assert.equal(res.body.data[1].action, 'PARTNER_APPROVED');
        assert.ok(res.body.data[0].actor.email.endsWith('@example.test'));
    });

    it('refuses an unknown filter on the global log instead of answering with everything', async () => {
        const { cookie } = await scenario();

        // `search=` is a plausible typo for `q=`; silently ignored it returned the whole log.
        const typo = await request(app).get('/api/admin/audit?search=BKG-000001').set('Cookie', cookie);
        assert.equal(typo.status, 400, JSON.stringify(typo.body));

        const real = await request(app).get('/api/admin/audit?q=BKG-000001&pageSize=5').set('Cookie', cookie);
        assert.equal(real.status, 200, JSON.stringify(real.body));
    });

    it('does not serve the trail to a partner', async () => {
        const { partner } = await scenario();
        const owner = await makePartnerUser(tracker, partner, { isPrimaryContact: false });
        const { cookie } = await signIn(app, owner.email);

        assert.equal((await request(app).get(`/api/admin/partners/${partner.id}/audit`).set('Cookie', cookie)).status, 403);
    });

    it('records a sign-in and a sign-out against the account', async () => {
        const { admin, cookie } = await scenario();

        const [signedIn] = await prisma.auditLog.findMany({
            where: { entityType: AUDIT_ENTITY.user, entityId: admin.id, action: 'USER_LOGIN_SUCCEEDED' }
        });
        assert.equal(signedIn.actorUserId, admin.id);
        assert.ok('userAgent' in signedIn.metadata);

        await request(app).post('/api/auth/logout').set('Cookie', cookie);

        const out = await prisma.auditLog.count({
            where: { entityType: AUDIT_ENTITY.user, entityId: admin.id, action: 'USER_LOGGED_OUT' }
        });
        assert.equal(out, 1);
    });

    it('serves the whole trail, filtered, to the roles that audit', async () => {
        const { admin, partner, cookie } = await scenario();

        await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({});

        const byEntity = await request(app)
            .get(`/api/admin/audit?entityType=${AUDIT_ENTITY.partner}&entityId=${partner.id}`)
            .set('Cookie', cookie);

        assert.equal(byEntity.status, 200);
        assert.ok(byEntity.body.data.length >= 1);
        assert.ok(byEntity.body.data.every((entry) => entry.entityId === partner.id && entry.entityType === 'Partner'));
        assert.equal(byEntity.body.data[0].actor.id, admin.id);

        const byAction = await request(app)
            .get(`/api/admin/audit?action=PARTNER_APPROVED&actorUserId=${admin.id}`)
            .set('Cookie', cookie);
        assert.deepEqual(
            byAction.body.data.map((entry) => entry.entityId),
            [partner.id]
        );

        assert.equal((await request(app).get('/api/admin/audit?action=NOT_A_THING').set('Cookie', cookie)).status, 400);

        const manager = await makeAdmin(tracker, { role: 'MANAGEMENT' });
        const managerRes = await request(app).get('/api/admin/audit?pageSize=5').set('Cookie', (await signIn(app, manager.email)).cookie);
        assert.equal(managerRes.status, 200);
        assert.equal(managerRes.body.pageSize, 5);

        const dispatcher = await makeAdmin(tracker, { role: 'DISPATCHER' });
        assert.equal((await request(app).get('/api/admin/audit').set('Cookie', (await signIn(app, dispatcher.email)).cookie)).status, 403);
    });

    it('attributes a self-service registration to the applicant, not to nobody', async () => {
        const { partner, cookie } = await scenario();
        const owner = await makePartnerUser(tracker, partner, { isPrimaryContact: false });
        const ownerCookie = (await signIn(app, owner.email)).cookie;

        await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({});
        await request(app).patch('/api/partner/profile').set('Cookie', ownerCookie).send({ city: 'Kutaisi' });

        const entry = await prisma.auditLog.findFirst({
            where: { entityId: partner.id, action: 'PARTNER_UPDATED' }
        });

        assert.equal(entry.actorEmail, owner.email);
        assert.equal(entry.metadata.self, true);
    });
});
