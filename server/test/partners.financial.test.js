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
    makeFinancial,
    signIn,
    databaseAvailable
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const IBAN = 'GE29NB0000000101904917';
const SWIFT = 'TBCBGE22';

/** Nothing in a response body may contain either, in any casing or spacing. */
const leaksBankDetails = (body) => {
    const serialized = JSON.stringify(body).toUpperCase().replace(/[\s-]/g, '');

    return serialized.includes(IBAN) || serialized.includes(SWIFT);
};

describe('financial data exposure', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const scenario = async () => {
        const partner = await makePartner(tracker, { status: 'APPROVED' });

        await makeFinancial(partner, { iban: IBAN, swift: SWIFT });

        return partner;
    };

    const cookieFor = async (user) => (await signIn(app, user.email)).cookie;

    it('keeps bank details out of the list endpoint entirely', async () => {
        const partner = await scenario();
        const admin = await makeAdmin(tracker);
        const cookie = await cookieFor(admin);

        const res = await request(app).get('/api/admin/partners').query({ q: partner.name }).set('Cookie', cookie);

        assert.equal(res.status, 200);
        assert.ok(res.body.data.some((row) => row.id === partner.id));
        // Even for an admin. A list of a hundred partners has no business
        // carrying a hundred IBANs to a browser.
        assert.equal(leaksBankDetails(res.body), false);
    });

    it('shows them to an admin on the detail view', async () => {
        const partner = await scenario();
        const admin = await makeAdmin(tracker);

        const res = await request(app).get(`/api/admin/partners/${partner.id}`).set('Cookie', await cookieFor(admin));

        assert.equal(res.status, 200);
        assert.equal(res.body.financial.iban, IBAN);
        assert.equal(res.body.financial.swift, SWIFT);
    });

    it('shows them to the partner owner and its finance role', async () => {
        for (const role of ['PARTNER_OWNER', 'PARTNER_FINANCE']) {
            const partner = await scenario();
            const user = await makePartnerUser(tracker, partner, { role });

            const res = await request(app).get('/api/partner/financial').set('Cookie', await cookieFor(user));

            assert.equal(res.status, 200, role);
            assert.equal(res.body.iban, IBAN, role);
        }
    });

    /** The reason roles exist rather than one undifferentiated partner user. */
    it('hides them from an agent at the same company', async () => {
        const partner = await scenario();
        const agent = await makePartnerUser(tracker, partner, { role: 'PARTNER_AGENT', isPrimaryContact: false });
        const cookie = await cookieFor(agent);

        assert.equal((await request(app).get('/api/partner/financial').set('Cookie', cookie)).status, 403);

        const me = await request(app).get('/api/partner/me').set('Cookie', cookie);

        assert.equal(me.status, 200);
        assert.equal(me.body.financial, undefined, 'absent, not null');
        assert.equal(leaksBankDetails(me.body), false);
    });

    it('hides them from a partner admin, who has no financial duty', async () => {
        const partner = await scenario();
        const manager = await makePartnerUser(tracker, partner, { role: 'PARTNER_ADMIN', isPrimaryContact: false });

        assert.equal(
            (await request(app).get('/api/partner/financial').set('Cookie', await cookieFor(manager))).status,
            403
        );
    });

    it('keeps one partner out of another partner\'s bank details', async () => {
        const mine = await scenario();
        const theirs = await scenario();
        const owner = await makePartnerUser(tracker, mine);
        const cookie = await cookieFor(owner);

        // Through the admin route.
        assert.equal((await request(app).get(`/api/admin/partners/${theirs.id}/financial`).set('Cookie', cookie)).status, 403);

        // And through their own route, which reads from the session, not a URL.
        const own = await request(app).get('/api/partner/financial').set('Cookie', cookie);

        assert.equal(own.status, 200);
        assert.equal(own.body.iban, IBAN);
    });

    it('refuses an unauthenticated read', async () => {
        const partner = await scenario();

        assert.equal((await request(app).get(`/api/admin/partners/${partner.id}/financial`)).status, 401);
        assert.equal((await request(app).get('/api/partner/financial')).status, 401);
    });

    /** Reading a partner is not reading its bank account: the desks see the company, finance sees the IBAN. */
    it('keeps the bank route from staff who read partners but hold no financial capability', async () => {
        const partner = await scenario();

        for (const role of ['MANAGEMENT', 'RESERVATIONS']) {
            const cookie = await cookieFor(await makeAdmin(tracker, { role }));

            const detail = await request(app).get(`/api/admin/partners/${partner.id}`).set('Cookie', cookie);
            assert.equal(detail.status, 200, role);
            assert.equal(leaksBankDetails(detail.body), false, role);

            const bank = await request(app).get(`/api/admin/partners/${partner.id}/financial`).set('Cookie', cookie);
            assert.equal(bank.status, 403, role);
            assert.equal(bank.body.error.details.reason, 'INSUFFICIENT_CAPABILITY', role);
            assert.equal(leaksBankDetails(bank.body), false, role);
        }

        const finance = await request(app)
            .get(`/api/admin/partners/${partner.id}/financial`)
            .set('Cookie', await cookieFor(await makeAdmin(tracker, { role: 'FINANCE' })));
        assert.equal(finance.status, 200);
        assert.equal(finance.body.iban, IBAN);
    });

    it('keeps the IBAN out of the session an owner bootstraps from', async () => {
        const partner = await scenario();
        const cookie = await cookieFor(await makePartnerUser(tracker, partner));

        for (const path of ['/api/auth/me', '/api/partner/me']) {
            const res = await request(app).get(path).set('Cookie', cookie);

            assert.equal(res.status, 200, path);
            assert.equal(leaksBankDetails(res.body), false, path);
        }

        // The screen that needs it still gets it, through its own request.
        assert.equal((await request(app).get('/api/partner/financial').set('Cookie', cookie)).body.iban, IBAN);
    });

    it('records who looked', async () => {
        const partner = await scenario();
        const admin = await makeAdmin(tracker);

        await request(app).get(`/api/admin/partners/${partner.id}/financial`).set('Cookie', await cookieFor(admin));

        const entries = await prisma.auditLog.findMany({
            where: { entityId: partner.id, action: 'PARTNER_FINANCIAL_VIEWED' }
        });

        assert.equal(entries.length, 1);
        assert.equal(entries[0].actorEmail, admin.email);
    });

    it('records an update without copying the IBAN into the audit trail', async () => {
        const partner = await scenario();
        const admin = await makeAdmin(tracker);

        const res = await request(app)
            .put(`/api/admin/partners/${partner.id}/financial`)
            .set('Cookie', await cookieFor(admin))
            .send({ iban: 'GB82WEST12345698765432', swift: 'BARCGB22', bankName: 'Barclays' });

        assert.equal(res.status, 200);
        assert.equal(res.body.iban, 'GB82WEST12345698765432');

        const entries = await prisma.auditLog.findMany({
            where: { entityId: partner.id, action: 'PARTNER_FINANCIAL_UPDATED' }
        });

        assert.equal(entries.length, 1);
        // The audit table is readable by more people than the financial table.
        // Copying the IBAN into it would make it the easier way to read one.
        assert.ok(!JSON.stringify(entries[0].metadata).includes('GB82WEST12345698765432'));
        assert.deepEqual(entries[0].metadata.fields.sort(), ['bankName', 'iban', 'swift']);
    });

    it('validates an IBAN on update as strictly as on registration', async () => {
        const partner = await scenario();
        const admin = await makeAdmin(tracker);

        const res = await request(app)
            .put(`/api/admin/partners/${partner.id}/financial`)
            .set('Cookie', await cookieFor(admin))
            .send({ iban: 'GB82WEST12345698765433', swift: 'BARCGB22' });

        assert.equal(res.status, 400);
        assert.equal((await prisma.partnerFinancialDetail.findUnique({ where: { partnerId: partner.id } })).iban, IBAN);
    });

    it('reports no bank details rather than an empty object', async () => {
        const partner = await makePartner(tracker, { status: 'APPROVED' });
        const admin = await makeAdmin(tracker);

        const res = await request(app).get(`/api/admin/partners/${partner.id}/financial`).set('Cookie', await cookieFor(admin));

        assert.equal(res.status, 404);
    });
});
