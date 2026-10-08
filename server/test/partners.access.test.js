import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
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

describe('platform access by status', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const partnerIn = async (status) => {
        const partner = await makePartner(tracker, { status });
        const owner = await makePartnerUser(tracker, partner);
        const { status: loginStatus, cookie } = await signIn(app, owner.email);

        return { partner, owner, loginStatus, cookie };
    };

    /**
     * The brief's exact requirement: a partner awaiting review may sign in far
     * enough to be told so, and no further.
     */
    it('lets a pending partner sign in and read its own application only', async () => {
        const { partner, loginStatus, cookie } = await partnerIn('PENDING_APPROVAL');

        assert.equal(loginStatus, 200);

        const me = await request(app).get('/api/partner/me').set('Cookie', cookie);

        assert.equal(me.status, 200);
        assert.equal(me.body.status, 'PENDING_APPROVAL');
        assert.equal(me.body.reference, partner.reference);

        const dashboard = await request(app).get('/api/partner/dashboard').set('Cookie', cookie);

        assert.equal(dashboard.status, 403);
        assert.equal(dashboard.body.error.details.partnerStatus, 'PENDING_APPROVAL');
    });

    it('gives a rejected partner no platform access', async () => {
        const { cookie } = await partnerIn('REJECTED');

        const dashboard = await request(app).get('/api/partner/dashboard').set('Cookie', cookie);

        assert.equal(dashboard.status, 403);
        assert.equal(dashboard.body.error.details.partnerStatus, 'REJECTED');
    });

    it('gives a suspended partner no platform access', async () => {
        const { cookie } = await partnerIn('SUSPENDED');

        assert.equal((await request(app).get('/api/partner/dashboard').set('Cookie', cookie)).status, 403);
    });

    /**
     * Every route behind the gate, not just the ones that write. A guard applied
     * to a PUT but not to the GET beside it reads as a decision when it is
     * really an oversight, and bank details are the last place to have one.
     */
    it('gates the reads behind the platform gate as well as the writes', async () => {
        for (const status of ['PENDING_APPROVAL', 'REJECTED', 'SUSPENDED']) {
            const { cookie } = await partnerIn(status);

            for (const path of ['/api/partner/financial', '/api/partner/bookings']) {
                const res = await request(app).get(path).set('Cookie', cookie);

                assert.equal(res.status, 403, `${status} ${path}`);
                assert.equal(res.body.error.details.partnerStatus, status, `${status} ${path}`);
            }
        }
    });

    /** The same two routes still answer normally once the partner is approved. */
    it('opens those reads to an approved partner', async () => {
        const { cookie } = await partnerIn('APPROVED');

        // 404 rather than 200: this fixture has no bank details on file. What
        // matters is that it is no longer the gate answering.
        assert.equal((await request(app).get('/api/partner/financial').set('Cookie', cookie)).status, 404);
        assert.equal((await request(app).get('/api/partner/bookings').set('Cookie', cookie)).status, 200);
    });

    it('gives a partner still registering no platform access', async () => {
        const { cookie } = await partnerIn('REGISTRATION_IN_PROGRESS');

        assert.equal((await request(app).get('/api/partner/dashboard').set('Cookie', cookie)).status, 403);
    });

    it('lets an approved partner through', async () => {
        const { cookie } = await partnerIn('APPROVED');

        const dashboard = await request(app).get('/api/partner/dashboard').set('Cookie', cookie);

        assert.equal(dashboard.status, 200);
        assert.equal(dashboard.body.partner.status, 'APPROVED');

        // The portal renders four tiles straight off these, so a missing key
        // would put "undefined" on the partner's first screen.
        assert.deepEqual(dashboard.body.stats, {
            listings: 0,
            bookings: 0,
            upcoming: 0,
            cancelled: 0
        });
    });

    it('opens the door the moment an admin approves, with no new sign-in', async () => {
        const admin = await makeAdmin(tracker);
        const adminCookie = (await signIn(app, admin.email)).cookie;
        const { partner, cookie } = await partnerIn('PENDING_APPROVAL');

        assert.equal((await request(app).get('/api/partner/dashboard').set('Cookie', cookie)).status, 403);

        await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', adminCookie).send({});

        assert.equal((await request(app).get('/api/partner/dashboard').set('Cookie', cookie)).status, 200);
    });
});

describe('privilege boundaries', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const approvedOwner = async () => {
        const partner = await makePartner(tracker, { status: 'APPROVED' });
        const owner = await makePartnerUser(tracker, partner);

        return { partner, owner, cookie: (await signIn(app, owner.email)).cookie };
    };

    /**
     * The escalation that matters. The update schema is an allow-list, so these
     * fields are not rejected with a message — they never reach the update at
     * all, which is why the assertion is against the stored row.
     */
    it('ignores a partner trying to change its own status, id or commission', async () => {
        const { partner, cookie } = await approvedOwner();

        const res = await request(app)
            .patch('/api/partner/profile')
            .set('Cookie', cookie)
            .send({
                city: 'Batumi',
                status: 'APPROVED',
                reference: 'PTR-000000',
                commissionRateBps: 0,
                approvedByUserId: null,
                notes: 'I am wonderful'
            });

        assert.equal(res.status, 200);

        const stored = await prisma.partner.findUnique({ where: { id: partner.id } });

        assert.equal(stored.city, 'Batumi', 'the legitimate field did change');
        assert.equal(stored.reference, partner.reference);
        assert.equal(stored.commissionRateBps, partner.commissionRateBps);
        assert.equal(stored.notes, partner.notes);
    });

    it('does not let a pending partner edit its way into the platform', async () => {
        const partner = await makePartner(tracker, { status: 'PENDING_APPROVAL' });
        const owner = await makePartnerUser(tracker, partner);
        const { cookie } = await signIn(app, owner.email);

        const res = await request(app).patch('/api/partner/profile').set('Cookie', cookie).send({ city: 'Batumi' });

        assert.equal(res.status, 403);
        assert.equal((await prisma.partner.findUnique({ where: { id: partner.id } })).status, 'PENDING_APPROVAL');
    });

    it('does not let an agent edit the company profile', async () => {
        const partner = await makePartner(tracker, { status: 'APPROVED' });
        const agent = await makePartnerUser(tracker, partner, { role: 'PARTNER_AGENT', isPrimaryContact: false });
        const { cookie } = await signIn(app, agent.email);

        const res = await request(app).patch('/api/partner/profile').set('Cookie', cookie).send({ city: 'Batumi' });

        assert.equal(res.status, 403);
    });

    it('keeps one partner out of another partner via the admin API', async () => {
        const { cookie } = await approvedOwner();
        const other = await makePartner(tracker, { status: 'APPROVED' });

        for (const [method, path] of [
            ['get', `/api/admin/partners/${other.id}`],
            ['get', `/api/admin/partners/${other.id}/financial`],
            ['get', `/api/admin/partners/${other.id}/audit`],
            ['get', '/api/admin/partners']
        ]) {
            const res = await request(app)[method](path).set('Cookie', cookie);

            assert.equal(res.status, 403, `${method.toUpperCase()} ${path}`);
        }
    });

    it('refuses an admin action from a partner even with a valid session', async () => {
        const { cookie } = await approvedOwner();
        const target = await makePartner(tracker, { status: 'PENDING_APPROVAL' });

        for (const path of ['approve', 'reject', 'suspend', 'reactivate']) {
            const res = await request(app)
                .post(`/api/admin/partners/${target.id}/${path}`)
                .set('Cookie', cookie)
                .send({ reason: 'because' });

            assert.equal(res.status, 403, path);
        }

        assert.equal((await prisma.partner.findUnique({ where: { id: target.id } })).status, 'PENDING_APPROVAL');
    });

    it('does not let a partner escalate its own role', async () => {
        const { owner, cookie } = await approvedOwner();

        // There is no endpoint for this at all, which is the point: the only
        // route that touches a partner's own record is the profile PATCH, and
        // role is not in its allow-list.
        const res = await request(app).patch('/api/partner/profile').set('Cookie', cookie).send({ role: 'ADMIN' });

        assert.equal(res.status, 200);
        assert.equal((await prisma.user.findUnique({ where: { id: owner.id } })).role, 'PARTNER_OWNER');
    });
});

/**
 * The public booking routers serve guests, so they cannot demand a session —
 * but a partner session that arrives there books in the partner's name and at
 * its terms. Signing in works in every status, so these routers must refuse a
 * partner the portal has already shut out.
 */
describe('booking as a partner that is not approved', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const sessionFor = async (status) => {
        const partner = await makePartner(tracker, { status });
        const owner = await makePartnerUser(tracker, partner);
        const { cookie } = await signIn(app, owner.email);

        return cookie;
    };

    const bookingWrites = [
        ['post', '/api/bookings/holds'],
        ['post', '/api/bookings'],
        ['post', '/api/transfers/bookings'],
        ['post', '/api/tours/bookings'],
        ['post', '/api/orders'],
        ['post', '/api/bookings/BKG-000001/cancel'],
        ['patch', '/api/transfers/bookings/TRF-000001']
    ];

    for (const status of ['PENDING_APPROVAL', 'SUSPENDED', 'REJECTED']) {
        it(`refuses a ${status.toLowerCase()} partner on every public booking route`, async () => {
            const cookie = await sessionFor(status);

            for (const [method, path] of bookingWrites) {
                const response = await request(app)[method](path).set('Cookie', cookie).send({});

                assert.equal(response.status, 403, `${method.toUpperCase()} ${path}`);
                assert.equal(response.body.error.details.partnerStatus, status);
            }
        });
    }

    it('lets an approved partner through to validation', async () => {
        const cookie = await sessionFor('APPROVED');
        const response = await request(app).post('/api/bookings').set('Cookie', cookie).send({});

        assert.equal(response.status, 400);
    });

    it('leaves a guest with no session untouched', async () => {
        const response = await request(app).post('/api/bookings').send({});

        assert.equal(response.status, 400);
    });

    it('prices a partner that is not approved as the public, not at its commission', async () => {
        const { resolveMarkup } = await import('../services/hotel/pricingRule.service.js');
        const partner = await makePartner(tracker, { status: 'SUSPENDED' });

        await prisma.partner.update({ where: { id: partner.id }, data: { commissionRateBps: 123 } });

        const suspended = await resolveMarkup({ partner: { ...partner, commissionRateBps: 123 } });
        const approved = await resolveMarkup({ partner: { ...partner, status: 'APPROVED', commissionRateBps: 123 } });

        assert.equal(suspended.source, 'PLATFORM_DEFAULT');
        assert.equal(approved.source, 'PARTNER_COMMISSION');
        assert.equal(approved.markupBps, 123);
    });
});
