import { describe, it, after } from 'node:test';
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
    signIn,
    databaseAvailable
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

describe('approval workflow', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const scenario = async (status = 'PENDING_APPROVAL') => {
        const admin = await makeAdmin(tracker);
        const partner = await makePartner(tracker, { status });
        const owner = await makePartnerUser(tracker, partner);
        const { cookie } = await signIn(app, admin.email);

        return { admin, partner, owner, cookie };
    };

    // --- Authorization ------------------------------------------------------

    it('refuses an unauthenticated approval', async () => {
        const { partner } = await scenario();

        const res = await request(app).post(`/api/admin/partners/${partner.id}/approve`).send({});

        assert.equal(res.status, 401);
        assert.equal((await prisma.partner.findUnique({ where: { id: partner.id } })).status, 'PENDING_APPROVAL');
    });

    /** The decisive test that authorization is not merely a hidden button. */
    it('refuses a partner trying to approve itself', async () => {
        const { partner, owner } = await scenario();
        const { cookie } = await signIn(app, owner.email);

        const res = await request(app)
            .post(`/api/admin/partners/${partner.id}/approve`)
            .set('Cookie', cookie)
            .send({});

        assert.equal(res.status, 403);
        assert.equal((await prisma.partner.findUnique({ where: { id: partner.id } })).status, 'PENDING_APPROVAL');
    });

    it('refuses a partner trying to approve someone else', async () => {
        const { owner } = await scenario();
        const other = await makePartner(tracker, { status: 'PENDING_APPROVAL' });
        const { cookie } = await signIn(app, owner.email);

        const res = await request(app).post(`/api/admin/partners/${other.id}/approve`).set('Cookie', cookie).send({});

        assert.equal(res.status, 403);
    });

    // --- Approve ------------------------------------------------------------

    it('approves, stamps the reviewer, and emails the partner', async () => {
        clearOutbox();
        const { admin, partner, owner, cookie } = await scenario();

        const res = await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({});

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'APPROVED');
        assert.equal(res.body.review.approvedBy.email, admin.email);
        assert.ok(res.body.review.approvedAt);

        const stored = await prisma.partner.findUnique({ where: { id: partner.id } });

        assert.equal(stored.approvedByUserId, admin.id);
        assert.ok(stored.approvedAt instanceof Date);

        assert.equal(outbox.at(-1).to, owner.email);
        assert.equal(outbox.at(-1).template, 'partnerApproved');
    });

    it('lets exactly one of two simultaneous reviews win', async () => {
        const { partner, cookie } = await scenario();

        const results = await Promise.all([
            request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({}),
            request(app).post(`/api/admin/partners/${partner.id}/reject`).set('Cookie', cookie).send({ reason: 'No' })
        ]);

        assert.deepEqual(results.map((res) => res.status).sort(), [200, 409]);

        const stored = await prisma.partner.findUnique({ where: { id: partner.id } });
        const winner = results.find((res) => res.status === 200);
        assert.equal(stored.status, winner.body.status);

        const rows = await prisma.auditLog.count({
            where: { entityId: partner.id, action: { in: ['PARTNER_APPROVED', 'PARTNER_REJECTED'] } }
        });
        assert.equal(rows, 1);
    });

    it('writes exactly one audit row naming the admin', async () => {
        const { admin, partner, cookie } = await scenario();

        await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({});

        const entries = await prisma.auditLog.findMany({
            where: { entityId: partner.id, action: 'PARTNER_APPROVED' }
        });

        assert.equal(entries.length, 1);
        assert.equal(entries[0].actorUserId, admin.id);
        assert.equal(entries[0].actorEmail, admin.email);
        assert.equal(entries[0].metadata.from, 'PENDING_APPROVAL');
        assert.equal(entries[0].metadata.to, 'APPROVED');
    });

    it('will not approve a company whose details are incomplete', async () => {
        const admin = await makeAdmin(tracker);
        const partner = await makePartner(tracker, {
            status: 'PENDING_APPROVAL',
            registrationNumber: null,
            legalAddress: null
        });
        const { cookie } = await signIn(app, admin.email);

        const res = await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({});

        assert.equal(res.status, 400);
        assert.match(res.body.error.message, /incomplete/i);
        assert.equal((await prisma.partner.findUnique({ where: { id: partner.id } })).status, 'PENDING_APPROVAL');
    });

    // --- Reject -------------------------------------------------------------

    it('rejects with a reason, stamps the reviewer, and emails', async () => {
        clearOutbox();
        const { admin, partner, owner, cookie } = await scenario();

        const res = await request(app)
            .post(`/api/admin/partners/${partner.id}/reject`)
            .set('Cookie', cookie)
            .send({ reason: 'Registration number could not be verified', internalNote: 'Companies house has no record' });

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'REJECTED');
        assert.equal(res.body.review.rejectedBy.email, admin.email);
        assert.equal(res.body.review.rejectionReason, 'Registration number could not be verified');

        const mail = outbox.at(-1);

        assert.equal(mail.to, owner.email);
        assert.equal(mail.template, 'partnerRejected');
        assert.ok(mail.text.includes('Registration number could not be verified'));

        // The internal note is a separate column precisely so it never travels.
        assert.ok(!mail.text.includes('Companies house has no record'));
        assert.ok(!mail.html.includes('Companies house has no record'));
    });

    it('demands a reason before it will reject', async () => {
        const { partner, cookie } = await scenario();

        const res = await request(app).post(`/api/admin/partners/${partner.id}/reject`).set('Cookie', cookie).send({});

        assert.equal(res.status, 400);
        assert.equal((await prisma.partner.findUnique({ where: { id: partner.id } })).status, 'PENDING_APPROVAL');
    });

    it('ends the sessions of a rejected partner immediately', async () => {
        const { partner, owner, cookie } = await scenario();
        const ownerSession = (await signIn(app, owner.email)).cookie;

        assert.equal((await request(app).get('/api/partner/me').set('Cookie', ownerSession)).status, 200);

        await request(app)
            .post(`/api/admin/partners/${partner.id}/reject`)
            .set('Cookie', cookie)
            .send({ reason: 'Not a fit' });

        assert.equal((await request(app).get('/api/partner/me').set('Cookie', ownerSession)).status, 401);
    });

    // --- Illegal transitions ------------------------------------------------

    /**
     * The whole reason the transition table exists. Replaying an approval at a
     * partner that has since been rejected must not quietly succeed.
     */
    it('refuses to approve a partner that was already rejected', async () => {
        const { partner, cookie } = await scenario('REJECTED');

        const res = await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({});

        assert.equal(res.status, 409);
        assert.equal(res.body.error.details.status, 'REJECTED');
        assert.equal((await prisma.partner.findUnique({ where: { id: partner.id } })).status, 'REJECTED');
    });

    it('refuses to approve the same partner twice', async () => {
        const { partner, cookie } = await scenario();

        assert.equal((await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({})).status, 200);
        assert.equal((await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({})).status, 409);

        const entries = await prisma.auditLog.findMany({ where: { entityId: partner.id, action: 'PARTNER_APPROVED' } });

        assert.equal(entries.length, 1, 'a refused replay must not write an audit row');
    });

    it('refuses to suspend a partner that was never approved', async () => {
        const { partner, cookie } = await scenario('PENDING_APPROVAL');

        const res = await request(app)
            .post(`/api/admin/partners/${partner.id}/suspend`)
            .set('Cookie', cookie)
            .send({ reason: 'Payment dispute' });

        assert.equal(res.status, 409);
    });

    // --- Suspend and reinstate ---------------------------------------------

    it('suspends an approved partner and kills its live sessions', async () => {
        const { admin, partner, owner, cookie } = await scenario('APPROVED');
        const ownerSession = (await signIn(app, owner.email)).cookie;

        assert.equal((await request(app).get('/api/partner/dashboard').set('Cookie', ownerSession)).status, 200);

        const res = await request(app)
            .post(`/api/admin/partners/${partner.id}/suspend`)
            .set('Cookie', cookie)
            .send({ reason: 'Unresolved payment dispute' });

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'SUSPENDED');
        assert.equal(res.body.review.suspendedBy.email, admin.email);
        assert.equal(res.body.review.suspensionReason, 'Unresolved payment dispute');

        assert.equal((await request(app).get('/api/partner/dashboard').set('Cookie', ownerSession)).status, 401);
    });

    it('reinstates a suspended partner and clears the suspension', async () => {
        const { partner, cookie } = await scenario('SUSPENDED');

        const res = await request(app)
            .post(`/api/admin/partners/${partner.id}/reactivate`)
            .set('Cookie', cookie)
            .send({});

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'APPROVED');
        assert.equal(res.body.review.suspendedAt, null);
        assert.equal(res.body.review.suspensionReason, null);
    });

    it('reinstates a rejected partner and clears the rejection', async () => {
        const { partner, cookie } = await scenario('REJECTED');

        await prisma.partner.update({
            where: { id: partner.id },
            data: { rejectionReason: 'Paperwork missing', rejectionNote: 'internal' }
        });

        const res = await request(app)
            .post(`/api/admin/partners/${partner.id}/reactivate`)
            .set('Cookie', cookie)
            .send({});

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'APPROVED');
        assert.equal(res.body.review.rejectionReason, null);
    });
});

describe('admin partner listing', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('filters and searches on every documented field', async () => {
        const admin = await makeAdmin(tracker);
        const { cookie } = await signIn(app, admin.email);
        const partner = await makePartner(tracker, { status: 'PENDING_APPROVAL', country: 'GE', kind: 'TOUR_OPERATOR' });
        const owner = await makePartnerUser(tracker, partner);

        const search = async (query) => {
            const res = await request(app).get('/api/admin/partners').query(query).set('Cookie', cookie);

            assert.equal(res.status, 200);

            return res.body.data.map((row) => row.id);
        };

        assert.ok((await search({ q: partner.name })).includes(partner.id), 'by company name');
        assert.ok((await search({ q: partner.reference })).includes(partner.id), 'by Partner ID');
        assert.ok((await search({ q: partner.registrationNumber })).includes(partner.id), 'by registration number');
        assert.ok((await search({ q: partner.email })).includes(partner.id), 'by company email');
        assert.ok((await search({ q: owner.email })).includes(partner.id), 'by contact email');
        assert.ok((await search({ q: partner.name.toUpperCase() })).includes(partner.id), 'case-insensitively');
        assert.ok((await search({ status: 'PENDING_APPROVAL', country: 'GE' })).includes(partner.id), 'by status and country');
        assert.ok(!(await search({ status: 'APPROVED' })).includes(partner.id), 'excluded by a status it is not in');
        assert.ok(!(await search({ kind: 'TRANSPORT' })).includes(partner.id), 'excluded by a kind it is not');
    });

    it('paginates', async () => {
        const admin = await makeAdmin(tracker);
        const { cookie } = await signIn(app, admin.email);

        const res = await request(app).get('/api/admin/partners').query({ page: 1, pageSize: 2 }).set('Cookie', cookie);

        assert.equal(res.status, 200);
        assert.ok(res.body.data.length <= 2);
        assert.equal(res.body.page, 1);
        assert.equal(res.body.pageSize, 2);
        assert.equal(typeof res.body.total, 'number');
    });

    it('rejects a nonsense filter rather than ignoring it', async () => {
        const admin = await makeAdmin(tracker);
        const { cookie } = await signIn(app, admin.email);

        const res = await request(app).get('/api/admin/partners').query({ status: 'BANANA' }).set('Cookie', cookie);

        assert.equal(res.status, 400);
    });

    it('shows the primary contact on each row', async () => {
        const admin = await makeAdmin(tracker);
        const { cookie } = await signIn(app, admin.email);
        const partner = await makePartner(tracker);

        await makePartnerUser(tracker, partner, { role: 'PARTNER_AGENT', isPrimaryContact: false });
        const owner = await makePartnerUser(tracker, partner, { isPrimaryContact: true });

        const res = await request(app).get('/api/admin/partners').query({ q: partner.name }).set('Cookie', cookie);
        const row = res.body.data.find((candidate) => candidate.id === partner.id);

        assert.equal(row.contact.email, owner.email);
        assert.equal(row.contact.fullName, 'Nino Beridze');
    });
});
