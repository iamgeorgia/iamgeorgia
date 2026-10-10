import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { verifyPassword } from '../lib/password.js';
import { outbox, clearOutbox } from '../lib/mailer/index.js';
import {
    TEST_PASSWORD,
    createTracker,
    makePartner,
    makePartnerUser,
    makeInvitation,
    registrationPayload,
    signIn,
    testEmail,
    databaseAvailable
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

describe('partner registration', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    /** Tracks whatever the endpoint created, so cleanup can find it. */
    const track = async (reference) => {
        const partner = await prisma.partner.findUnique({ where: { reference } });

        return tracker.partner(partner);
    };

    it('creates the company, the owner and the bank details in one go', async () => {
        clearOutbox();
        const email = testEmail('invitee');
        const { token } = await makeInvitation({ email });
        const payload = registrationPayload(email);

        const res = await request(app).post(`/api/invitations/${token}/accept`).send(payload);

        assert.equal(res.status, 201);
        assert.equal(res.body.status, 'PENDING_APPROVAL');
        assert.match(res.body.reference, /^PTR-\d{6,}$/);

        const partner = await track(res.body.reference);

        assert.equal(partner.status, 'PENDING_APPROVAL');
        assert.ok(partner.submittedAt instanceof Date);
        assert.equal(partner.legalName, payload.company.legalName);

        const user = await prisma.user.findUnique({ where: { email }, include: { primaryRole: true } });

        assert.equal(user.primaryRole.key, 'PARTNER_OWNER');
        assert.equal(user.isPrimaryContact, true);
        assert.equal(user.partnerId, partner.id);
        assert.ok(await verifyPassword(TEST_PASSWORD, user.passwordHash));

        const financial = await prisma.partnerFinancialDetail.findUnique({ where: { partnerId: partner.id } });

        assert.equal(financial.swift, 'TBCBGE22');
    });

    it('emails a receipt carrying the new Partner ID', async () => {
        clearOutbox();
        const email = testEmail('invitee');
        const { token } = await makeInvitation({ email });

        const res = await request(app).post(`/api/invitations/${token}/accept`).send(registrationPayload(email));

        await track(res.body.reference);

        const receipt = outbox.at(-1);

        assert.equal(receipt.to, email);
        assert.equal(receipt.template, 'registrationSubmitted');
        assert.ok(receipt.text.includes(res.body.reference));
    });

    it('completes a company the admin had already drafted', async () => {
        const draft = await makePartner(tracker, { status: 'INVITED', legalName: null, registrationNumber: null });
        const email = testEmail('invitee');
        const { token } = await makeInvitation({ email, partnerId: draft.id });

        const res = await request(app).post(`/api/invitations/${token}/accept`).send(registrationPayload(email));

        assert.equal(res.status, 201);
        // The draft was completed rather than duplicated, so the Partner ID it
        // was already given survives.
        assert.equal(res.body.reference, draft.reference);
        assert.equal(await prisma.partner.count({ where: { reference: draft.reference } }), 1);
    });

    it('never stores the password in plain text', async () => {
        const email = testEmail('invitee');
        const { token } = await makeInvitation({ email });

        const res = await request(app).post(`/api/invitations/${token}/accept`).send(registrationPayload(email));

        assert.equal(res.status, 201, JSON.stringify(res.body));
        await track(res.body.reference);

        const user = await prisma.user.findUnique({ where: { email } });

        assert.notEqual(user.passwordHash, TEST_PASSWORD);
        assert.ok(!user.passwordHash.includes(TEST_PASSWORD));
        assert.match(user.passwordHash, /^\$scrypt\$/);
        assert.ok(!JSON.stringify(res.body).includes(TEST_PASSWORD));
    });

    it('normalizes what it stores', async () => {
        const email = testEmail('invitee');
        const { token } = await makeInvitation({ email });

        const res = await request(app)
            .post(`/api/invitations/${token}/accept`)
            .send(
                registrationPayload(email.toUpperCase(), {
                    company: { country: 'ge', phone: '+995 (32) 2-987-654', website: 'kazbegilodge.ge' },
                    financial: { iban: 'ge29 nb00 0000 0101 9049 17', swift: 'tbcbge22' }
                })
            );

        assert.equal(res.status, 201);

        const partner = await track(res.body.reference);
        const financial = await prisma.partnerFinancialDetail.findUnique({ where: { partnerId: partner.id } });

        assert.equal(partner.country, 'GE');
        assert.equal(partner.phone, '+995322987654');
        assert.equal(partner.website, 'https://kazbegilodge.ge');
        assert.equal(financial.iban, 'GE29NB0000000101904917');
        assert.equal(financial.swift, 'TBCBGE22');

        // Stored lowercase, so the unique index and every later lookup agree.
        assert.ok(await prisma.user.findUnique({ where: { email } }));
    });

    it('rejects a duplicate company registration number', async () => {
        const existing = await makePartner(tracker);
        const email = testEmail('invitee');
        const { token } = await makeInvitation({ email });

        const res = await request(app)
            .post(`/api/invitations/${token}/accept`)
            .send(registrationPayload(email, { company: { registrationNumber: existing.registrationNumber } }));

        assert.equal(res.status, 409);
        assert.match(res.body.error.message, /registration number/i);
        assert.equal(await prisma.user.count({ where: { email } }), 0);
    });

    it('rejects an email that already has an account', async () => {
        const partner = await makePartner(tracker);
        const existing = await makePartnerUser(tracker, partner);
        const { token } = await makeInvitation({ email: existing.email });

        const res = await request(app)
            .post(`/api/invitations/${token}/accept`)
            .send(registrationPayload(existing.email));

        assert.equal(res.status, 409);
        assert.match(res.body.error.message, /account already exists/i);
    });

    it('rejects an IBAN that fails its checksum', async () => {
        const email = testEmail('invitee');
        const { token } = await makeInvitation({ email });

        const res = await request(app)
            .post(`/api/invitations/${token}/accept`)
            .send(registrationPayload(email, { financial: { iban: 'GE29NB0000000101904918' } }));

        assert.equal(res.status, 400);
        assert.ok(res.body.error.details.some((issue) => issue.path.join('.') === 'financial.iban'));
        assert.equal(await prisma.user.count({ where: { email } }), 0);
    });

    it('rejects a malformed SWIFT code', async () => {
        const email = testEmail('invitee');
        const { token } = await makeInvitation({ email });

        const res = await request(app)
            .post(`/api/invitations/${token}/accept`)
            .send(registrationPayload(email, { financial: { swift: 'NOPE1' } }));

        assert.equal(res.status, 400);
        assert.ok(res.body.error.details.some((issue) => issue.path.join('.') === 'financial.swift'));
    });

    it('rejects a weak password', async () => {
        const email = testEmail('invitee');
        const { token } = await makeInvitation({ email });

        const res = await request(app)
            .post(`/api/invitations/${token}/accept`)
            .send(registrationPayload(email, { password: 'short' }));

        assert.equal(res.status, 400);
        assert.ok(res.body.error.details.some((issue) => issue.path.includes('password')));
    });

    it('rejects an incomplete company', async () => {
        const email = testEmail('invitee');
        const { token } = await makeInvitation({ email });
        const payload = registrationPayload(email);

        delete payload.company.registrationNumber;
        delete payload.company.legalAddress;

        const res = await request(app).post(`/api/invitations/${token}/accept`).send(payload);

        assert.equal(res.status, 400);
        assert.equal(res.body.error.message, 'Invalid request body');
        assert.equal(await prisma.user.count({ where: { email } }), 0);
    });

    it('leaves nothing behind when it fails', async () => {
        const email = testEmail('invitee');
        const { token, invitation } = await makeInvitation({ email });
        const payload = registrationPayload(email, { financial: { iban: 'NOTANIBAN' } });

        await request(app).post(`/api/invitations/${token}/accept`).send(payload);

        // Scoped to this registration rather than a global row count, which
        // other test files are creating partners against at the same time.
        assert.equal(
            await prisma.partner.count({ where: { registrationNumber: payload.company.registrationNumber } }),
            0
        );
        assert.equal(await prisma.user.count({ where: { email } }), 0);

        const stored = await prisma.invitation.findUnique({ where: { id: invitation.id } });

        assert.equal(stored.acceptedAt, null, 'a failed attempt must leave the invitation usable');
    });

    it('lets the new owner sign in straight away', async () => {
        const email = testEmail('invitee');
        const { token } = await makeInvitation({ email });

        const res = await request(app).post(`/api/invitations/${token}/accept`).send(registrationPayload(email));

        await track(res.body.reference);

        const { status, body } = await signIn(app, email);

        assert.equal(status, 200);
        assert.equal(body.user.role, 'PARTNER_OWNER');
        assert.equal(body.partner.status, 'PENDING_APPROVAL');
    });
});
