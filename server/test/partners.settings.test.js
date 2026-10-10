import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { verifyPassword } from '../lib/password.js';
import {
    TEST_PASSWORD,
    createTracker,
    makePartner,
    makePartnerUser,
    makeFinancial,
    signIn,
    databaseAvailable
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const NEW_PASSWORD = 'nine-copper-lanterns-blink';

describe('partner self-service settings', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const signedIn = async (status = 'APPROVED', options = {}) => {
        const partner = await makePartner(tracker, { status });
        const user = await makePartnerUser(tracker, partner, options);
        const { cookie } = await signIn(app, user.email);

        return { partner, user, cookie };
    };

    // --- The company profile -------------------------------------------------

    it('lets an owner update the details that are theirs to change', async () => {
        const { partner, cookie } = await signedIn();

        const res = await request(app)
            .patch('/api/partner/profile')
            .set('Cookie', cookie)
            .send({
                name: 'Rooms Hotel Batumi',
                legalAddress: '3 Seaside Boulevard',
                city: 'Batumi',
                phone: '+995 577 12 34 56',
                email: 'Hello@Rooms.GE',
                website: 'rooms.ge',
                socialLinks: [{ label: 'Instagram', url: 'https://instagram.com/rooms' }]
            });

        assert.equal(res.status, 200);

        const stored = await prisma.partner.findUnique({ where: { id: partner.id } });

        assert.equal(stored.name, 'Rooms Hotel Batumi');
        assert.equal(stored.city, 'Batumi');
        // Normalized on the way in, exactly as at registration.
        assert.equal(stored.phone, '+995577123456');
        assert.equal(stored.email, 'hello@rooms.ge');
        assert.equal(stored.website, 'https://rooms.ge');
        assert.equal(stored.socialLinks.length, 1);
    });

    /**
     * The four fields the approval was granted against. Letting a company
     * rewrite its own legal identity after being vetted would make the review
     * meaningless, so they are absent from the allow-list entirely.
     */
    it('silently drops the fields the approval was based on', async () => {
        const { partner, cookie } = await signedIn();

        const res = await request(app).patch('/api/partner/profile').set('Cookie', cookie).send({
            city: 'Kutaisi',
            legalName: 'Something Else LLC',
            registrationNumber: 'REG000000',
            kind: 'TRANSPORT',
            country: 'FR'
        });

        assert.equal(res.status, 200);

        const stored = await prisma.partner.findUnique({ where: { id: partner.id } });

        assert.equal(stored.city, 'Kutaisi', 'the permitted field did change');
        assert.equal(stored.legalName, partner.legalName);
        assert.equal(stored.registrationNumber, partner.registrationNumber);
        assert.equal(stored.kind, partner.kind);
        assert.equal(stored.country, partner.country);
    });

    it('validates a company edit as strictly as a registration', async () => {
        const { partner, cookie } = await signedIn();

        const res = await request(app)
            .patch('/api/partner/profile')
            .set('Cookie', cookie)
            .send({ email: 'not-an-email', phone: '12' });

        assert.equal(res.status, 400);
        assert.equal((await prisma.partner.findUnique({ where: { id: partner.id } })).email, partner.email);
    });

    it('does not let an agent edit the company', async () => {
        const { cookie } = await signedIn('APPROVED', { role: 'PARTNER_AGENT', isPrimaryContact: false });

        assert.equal(
            (await request(app).patch('/api/partner/profile').set('Cookie', cookie).send({ city: 'Batumi' })).status,
            403
        );
    });

    it('does not let an unapproved partner edit the company', async () => {
        const { cookie } = await signedIn('PENDING_APPROVAL');

        assert.equal(
            (await request(app).patch('/api/partner/profile').set('Cookie', cookie).send({ city: 'Batumi' })).status,
            403
        );
    });

    // --- The user's own details ----------------------------------------------

    it('lets any partner user correct their own name and phone', async () => {
        const { user, cookie } = await signedIn('APPROVED', {
            role: 'PARTNER_AGENT',
            isPrimaryContact: false
        });

        const res = await request(app)
            .patch('/api/partner/account')
            .set('Cookie', cookie)
            .send({ firstName: 'Nino', lastName: 'Kapanadze', position: 'Reservations', phone: '+995 555 00 11 22' });

        assert.equal(res.status, 200);
        assert.equal(res.body.fullName, 'Nino Kapanadze');

        const stored = await prisma.user.findUnique({ where: { id: user.id } });

        assert.equal(stored.lastName, 'Kapanadze');
        assert.equal(stored.phone, '+995555001122');
    });

    /** Correcting your own name should not depend on a decision about your company. */
    it('works while the application is still under review', async () => {
        const { user, cookie } = await signedIn('PENDING_APPROVAL');

        const res = await request(app)
            .patch('/api/partner/account')
            .set('Cookie', cookie)
            .send({ firstName: 'Mariam' });

        assert.equal(res.status, 200);
        assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).firstName, 'Mariam');
    });

    it('will not let a user change what they are allowed to do', async () => {
        const { partner, user, cookie } = await signedIn();
        const other = await makePartner(tracker);

        const res = await request(app).patch('/api/partner/account').set('Cookie', cookie).send({
            firstName: 'Nino',
            role: 'ADMIN',
            email: 'promoted@example.test',
            partnerId: other.id,
            isPrimaryContact: false,
            isActive: false
        });

        assert.equal(res.status, 200);

        const stored = await prisma.user.findUnique({ where: { id: user.id }, include: { primaryRole: true } });

        assert.equal(stored.firstName, 'Nino', 'the permitted field did change');
        assert.equal(stored.primaryRole.key, 'PARTNER_OWNER');
        assert.equal(stored.email, user.email);
        assert.equal(stored.partnerId, partner.id);
        assert.equal(stored.isPrimaryContact, true);
        assert.equal(stored.isActive, true);
    });

    it('never returns the password hash', async () => {
        const { cookie } = await signedIn();

        const res = await request(app)
            .patch('/api/partner/account')
            .set('Cookie', cookie)
            .send({ firstName: 'Nino' });

        assert.equal(res.body.passwordHash, undefined);
        assert.ok(!JSON.stringify(res.body).includes('$scrypt$'));
    });

    it('records the change against the user', async () => {
        const { user, cookie } = await signedIn();

        await request(app).patch('/api/partner/account').set('Cookie', cookie).send({ position: 'Owner' });

        const entries = await prisma.auditLog.findMany({
            where: { entityId: user.id, action: 'USER_PROFILE_UPDATED' }
        });

        assert.equal(entries.length, 1);
        assert.equal(entries[0].actorEmail, user.email);
        assert.deepEqual(entries[0].metadata.fields, ['position']);
    });

    // --- Password ------------------------------------------------------------

    it('changes a password and keeps this device signed in', async () => {
        const { user, cookie } = await signedIn();

        const res = await request(app)
            .post('/api/auth/password/change')
            .set('Cookie', cookie)
            .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

        assert.equal(res.status, 204);

        // A fresh cookie came back, and it works.
        const refreshed = res.headers['set-cookie'];

        assert.ok(refreshed?.length);
        assert.equal((await request(app).get('/api/partner/me').set('Cookie', refreshed)).status, 200);

        const stored = await prisma.user.findUnique({ where: { id: user.id } });

        assert.ok(await verifyPassword(NEW_PASSWORD, stored.passwordHash));
        assert.equal(await verifyPassword(TEST_PASSWORD, stored.passwordHash), false);
    });

    /** The commonest reason to change a password is that somebody else has it. */
    it('signs every other device out', async () => {
        const { user, cookie } = await signedIn();
        const elsewhere = (await signIn(app, user.email)).cookie;

        assert.equal((await request(app).get('/api/partner/me').set('Cookie', elsewhere)).status, 200);

        await request(app)
            .post('/api/auth/password/change')
            .set('Cookie', cookie)
            .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

        assert.equal((await request(app).get('/api/partner/me').set('Cookie', elsewhere)).status, 401);
    });

    it('refuses a wrong current password', async () => {
        const { user, cookie } = await signedIn();

        const res = await request(app)
            .post('/api/auth/password/change')
            .set('Cookie', cookie)
            .send({ currentPassword: 'not-the-right-one', newPassword: NEW_PASSWORD });

        assert.equal(res.status, 401);

        const stored = await prisma.user.findUnique({ where: { id: user.id } });

        assert.ok(await verifyPassword(TEST_PASSWORD, stored.passwordHash), 'the old password still works');
    });

    it('refuses an unauthenticated caller', async () => {
        const res = await request(app)
            .post('/api/auth/password/change')
            .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

        assert.equal(res.status, 401);
    });

    it('applies the password policy to the new one', async () => {
        const { cookie } = await signedIn();

        const res = await request(app)
            .post('/api/auth/password/change')
            .set('Cookie', cookie)
            .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' });

        assert.equal(res.status, 400);
    });

    it('refuses a new password that repeats the old one', async () => {
        const { cookie } = await signedIn();

        const res = await request(app)
            .post('/api/auth/password/change')
            .set('Cookie', cookie)
            .send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });

        assert.equal(res.status, 400);
    });

    it('records the change without recording the password', async () => {
        const { user, cookie } = await signedIn();

        await request(app)
            .post('/api/auth/password/change')
            .set('Cookie', cookie)
            .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

        const entries = await prisma.auditLog.findMany({
            where: { entityId: user.id, action: 'USER_PASSWORD_CHANGED' }
        });

        assert.equal(entries.length, 1);
        assert.ok(!JSON.stringify(entries[0]).includes(NEW_PASSWORD));
    });

    // --- Bank details --------------------------------------------------------

    it('lets an owner update their own bank details', async () => {
        const { partner, cookie } = await signedIn();

        await makeFinancial(partner);

        const res = await request(app)
            .put('/api/partner/financial')
            .set('Cookie', cookie)
            .send({ iban: 'GB82 WEST 1234 5698 7654 32', swift: 'barcgb22', bankName: 'Barclays' });

        assert.equal(res.status, 200);
        assert.equal(res.body.iban, 'GB82WEST12345698765432');
        assert.equal(res.body.swift, 'BARCGB22');
    });

    it('rejects an IBAN that fails its checksum', async () => {
        const { partner, cookie } = await signedIn();

        await makeFinancial(partner);

        const res = await request(app)
            .put('/api/partner/financial')
            .set('Cookie', cookie)
            .send({ iban: 'GB82WEST12345698765433', swift: 'BARCGB22' });

        assert.equal(res.status, 400);
    });

    it('does not let an agent touch bank details', async () => {
        const { partner, cookie } = await signedIn('APPROVED', {
            role: 'PARTNER_AGENT',
            isPrimaryContact: false
        });

        await makeFinancial(partner);

        assert.equal((await request(app).get('/api/partner/financial').set('Cookie', cookie)).status, 403);
        assert.equal(
            (await request(app)
                .put('/api/partner/financial')
                .set('Cookie', cookie)
                .send({ iban: 'GE29NB0000000101904917', swift: 'TBCBGE22' })).status,
            403
        );
    });
});
