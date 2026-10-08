import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { disconnect } from '../db/index.js';
import {
    templates,
    sendMail,
    sendMailQuietly,
    outbox,
    clearOutbox,
    invitationUrl,
    activationUrl,
    passwordResetUrl
} from '../lib/mailer/index.js';
import { createTracker, makeAdmin, makePartner, signIn, databaseAvailable } from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

const sampleData = {
    partnerInvitation: { companyName: 'Rooms Hotel', url: invitationUrl('tok'), expiresAt, invitedByName: 'Tamar' },
    registrationSubmitted: { companyName: 'Rooms Hotel', reference: 'PTR-000001', contactName: 'Nino' },
    partnerApproved: { companyName: 'Rooms Hotel', reference: 'PTR-000001', contactName: 'Nino' },
    partnerRejected: { companyName: 'Rooms Hotel', reference: 'PTR-000001', contactName: 'Nino', reason: 'Unverified' },
    accountActivation: { contactName: 'Nino', companyName: 'Rooms Hotel', url: activationUrl('tok'), expiresAt },
    invitationReissued: { companyName: 'Rooms Hotel', url: invitationUrl('tok2'), expiresAt },
    passwordReset: { url: passwordResetUrl('tok3'), expiresAt },
    staffAccountActivation: { contactName: 'Tamar', roleLabel: 'Finance', url: activationUrl('tok4'), expiresAt }
};

describe('email templates', () => {
    beforeEach(clearOutbox);

    it('covers every notification the feature promises', () => {
        for (const name of [
            'partnerInvitation',
            'registrationSubmitted',
            'partnerApproved',
            'partnerRejected',
            'accountActivation',
            'invitationReissued'
        ]) {
            assert.equal(typeof templates[name], 'function', name);
        }
    });

    it('renders a subject and both bodies for each', () => {
        for (const [name, data] of Object.entries(sampleData)) {
            const { subject, text, html } = templates[name](data);

            assert.ok(subject?.length > 5, `${name} subject`);
            assert.ok(text?.length > 40, `${name} text`);
            // A full document, not a fragment: the branded layout carries its
            // own head so clients that honour it render the right charset.
            assert.match(html, /^<!DOCTYPE html>/i, `${name} html`);
        }
    });

    /**
     * Every message that asks the reader to do something carries a working
     * link. The rejection notice is the deliberate exception — there is nowhere
     * for a declined applicant to go, and a button would only mislead.
     */
    it('embeds a usable link in every actionable message', () => {
        for (const [name, data] of Object.entries(sampleData)) {
            const { text, html } = templates[name](data);
            const expectsLink = name !== 'partnerRejected';

            assert.equal(/https?:\/\/\S+/.test(text), expectsLink, `${name} text link`);
            assert.equal(/href="https?:\/\//.test(html), expectsLink, `${name} html link`);
        }
    });

    it('escapes values that came from a person', () => {
        const { html, text } = templates.partnerRejected({
            ...sampleData.partnerRejected,
            companyName: '<script>alert(1)</script>',
            reason: 'Missing "papers" & records'
        });

        assert.ok(!html.includes('<script>'));
        assert.ok(html.includes('&lt;script&gt;'));
        assert.ok(html.includes('&quot;papers&quot;') && html.includes('&amp;'));
        // The plain-text part is not markup, so it stays readable.
        assert.ok(text.includes('Missing "papers" & records'));
    });

    it('collects into the outbox under the capture transport', async () => {
        await sendMail({ to: 'nino@example.test', template: 'partnerApproved', data: sampleData.partnerApproved });

        assert.equal(outbox.length, 1);
        assert.equal(outbox[0].to, 'nino@example.test');
        assert.equal(outbox[0].template, 'partnerApproved');
        assert.ok(outbox[0].from.includes('@'));
    });

    it('throws on an unknown template rather than sending an empty message', async () => {
        await assert.rejects(() => sendMail({ to: 'x@example.test', template: 'nope' }), /Unknown email template/);
    });

    it('swallows a failure when the caller asked it to', async () => {
        const result = await sendMailQuietly({ to: 'x@example.test', template: 'nope' });

        assert.equal(result, null);
        assert.equal(outbox.length, 0);
    });
});

describe('notifications around a decision', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    /**
     * An approval that has been committed has happened. Rolling it back because
     * a mail server was unreachable would be worse than a missing notification,
     * so the decision must stand even when there is nobody to notify.
     */
    it('approves a partner that has no contact to email', async () => {
        clearOutbox();
        const admin = await makeAdmin(tracker);
        const partner = await makePartner(tracker, { status: 'PENDING_APPROVAL' });
        const { cookie } = await signIn(app, admin.email);

        const res = await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookie).send({});

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'APPROVED');
        assert.equal(outbox.length, 0);
    });
});
