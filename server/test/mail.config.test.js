import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { open, seal } from '../lib/secretBox.js';
import { MailDeliveryError, classifyGoogleError, isGrantRefused } from '../lib/mailer/errors.js';
import { buildMimeMessage, sanitiseMessage } from '../lib/mailer/mime.js';
import { templates } from '../lib/mailer/templates.js';

/**
 * The parts of the Gmail transport that need no database: sealing, error
 * classification, MIME, and what config.js refuses to boot on.
 */

const configUrl = pathToFileURL(join(import.meta.dirname, '..', 'config.js')).href;

describe('mail configuration at boot', () => {
    // An empty working directory, so dotenv finds no .env to fill gaps from.
    let cwd;

    before(() => {
        cwd = mkdtempSync(join(tmpdir(), 'iag-mail-config-'));
    });

    after(() => {
        rmSync(cwd, { recursive: true, force: true });
    });

    const boot = (env) => {
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(configUrl)}); console.log('BOOTED')`], {
            cwd,
            encoding: 'utf8',
            env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: 'postgresql://u:p@localhost:5432/x', NODE_ENV: 'development', ...env }
        });

        return { ok: result.stdout.includes('BOOTED'), error: /Error: ([^\n]+)/.exec(result.stderr)?.[1] ?? null };
    };

    const gmail = {
        GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_REDIRECT_URI: 'http://localhost:5000/api/admin/mail/google/callback',
        GMAIL_SENDER_EMAIL: 'Mail@Example.test'
    };

    const deployed = {
        NODE_ENV: 'production',
        AUTH_TOKEN_PEPPER: 'p'.repeat(32),
        APP_URL: 'https://iamgeorgia.test',
        CLIENT_ORIGIN: 'https://iamgeorgia.test',
        TRUST_PROXY: '1',
        HOTEL_OFFER_TOKEN_SECRET: 'h'.repeat(32),
        TRANSFER_QUOTE_TOKEN_SECRET: 't'.repeat(32),
        TOUR_OFFER_TOKEN_SECRET: 'o'.repeat(32),
        PACKAGE_OFFER_TOKEN_SECRET: 'k'.repeat(32),
        TRANSFER_RATING_TOKEN_SECRET: 'r'.repeat(32),
        MEDIA_DRIVER: 's3',
        MEDIA_S3_ENDPOINT: 'https://r2.test',
        MEDIA_S3_BUCKET: 'bucket',
        MEDIA_S3_ACCESS_KEY_ID: 'key',
        MEDIA_S3_SECRET_ACCESS_KEY: 'secret',
        MEDIA_PUBLIC_BASE_URL: 'https://media.test',
        FINANCE_OPS_EMAIL: 'finance@iamgeorgia.test'
    };

    it('boots as before when the Gmail API is not configured', () => {
        assert.deepEqual(boot({}), { ok: true, error: null });
    });

    it('refuses MAIL_TRANSPORT=gmail without its credentials', () => {
        const { ok, error } = boot({ MAIL_TRANSPORT: 'gmail' });

        assert.equal(ok, false);
        assert.match(error, /MAIL_TRANSPORT=gmail needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GMAIL_SENDER_EMAIL/);
    });

    it('refuses half a Gmail configuration even while SMTP is selected', () => {
        const { ok, error } = boot({ GOOGLE_CLIENT_ID: 'id' });

        assert.equal(ok, false);
        assert.match(error, /The Gmail API needs GOOGLE_CLIENT_SECRET/);
    });

    it('refuses a sender Gmail would rewrite, unless it is a verified alias', () => {
        const mismatch = boot({ ...gmail, MAIL_TRANSPORT: 'gmail', MAIL_FROM: 'I am Georgia <no-reply@iamgeorgia.test>' });

        assert.equal(mismatch.ok, false);
        assert.match(mismatch.error, /MAIL_FROM \(no-reply@iamgeorgia\.test\) is not GMAIL_SENDER_EMAIL \(mail@example\.test\)/);

        assert.equal(boot({ ...gmail, MAIL_TRANSPORT: 'gmail', MAIL_FROM: 'I am Georgia <no-reply@iamgeorgia.test>', GMAIL_FROM_ALIAS_VERIFIED: 'true' }).ok, true);
        // The account itself, in any case and with a display name, is fine.
        assert.equal(boot({ ...gmail, MAIL_TRANSPORT: 'gmail', MAIL_FROM: 'I am Georgia <mail@EXAMPLE.test>' }).ok, true);
    });

    it('refuses a malformed sealing key and a redirect that is not a URL', () => {
        assert.match(boot({ ...gmail, MAIL_CREDENTIALS_KEY: 'too-short' }).error, /MAIL_CREDENTIALS_KEY must be 32 random bytes/);
        assert.match(boot({ ...gmail, GOOGLE_REDIRECT_URI: '/api/admin/mail/google/callback' }).error, /GOOGLE_REDIRECT_URI must be an absolute URL/);
    });

    it('holds a deployed instance to https, a real sealing key, and no stub', () => {
        const base = { ...deployed, ...gmail, MAIL_TRANSPORT: 'gmail', MAIL_FROM: 'mail@example.test' };

        assert.match(boot(base).error, /GOOGLE_REDIRECT_URI must use https/);

        const https = { ...base, GOOGLE_REDIRECT_URI: 'https://api.iamgeorgia.test/api/admin/mail/google/callback' };

        assert.match(boot(https).error, /needs MAIL_CREDENTIALS_KEY on a deployed instance/);

        const complete = { ...https, MAIL_CREDENTIALS_KEY: randomBytes(32).toString('base64') };

        assert.deepEqual(boot(complete), { ok: true, error: null }, 'and no SMTP credentials are required for it');
        assert.match(boot({ ...complete, GOOGLE_API_STUB_URL: 'http://127.0.0.1:1' }).error, /GOOGLE_API_STUB_URL is for the test suite/);
    });

    it('still requires SMTP credentials on a deployed instance using SMTP', () => {
        const { ok, error } = boot({ ...deployed, MAIL_TRANSPORT: 'smtp' });

        assert.equal(ok, false);
        assert.match(error, /Missing required environment variables: SMTP_HOST, SMTP_USER, SMTP_PASS/);
    });
});

describe('sealing secrets at rest', () => {
    const key = randomBytes(32);

    it('round-trips, with a fresh IV each time', () => {
        const a = seal('refresh-token-value', { key, aad: 'x' });
        const b = seal('refresh-token-value', { key, aad: 'x' });

        assert.notEqual(a, b);
        assert.ok(!a.includes('refresh-token-value'));
        assert.equal(open(a, { key, aad: 'x' }), 'refresh-token-value');
    });

    it('refuses a wrong key, wrong purpose, or any tampering', () => {
        const sealed = seal('secret', { key, aad: 'x' });
        const [version, iv, tag, body] = sealed.split('.');
        const flipped = Buffer.from(body, 'base64url');

        flipped[0] ^= 1;

        assert.throws(() => open(sealed, { key: randomBytes(32), aad: 'x' }));
        assert.throws(() => open(sealed, { key, aad: 'y' }));
        assert.throws(() => open([version, iv, tag, flipped.toString('base64url')].join('.'), { key, aad: 'x' }));
        assert.throws(() => open('v0.a.b.c', { key, aad: 'x' }), /recognised format/);
    });
});

describe('classifying Google errors', () => {
    const http = (status, data, headers = {}) => Object.assign(new Error('http'), { response: { status, data, headers: new Headers(headers) } });
    const gmailError = (status, reason) => http(status, { error: { code: status, message: 'm', errors: [{ reason }] } });

    it('sorts every failure into what the caller should do', () => {
        const cases = [
            [http(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), 'auth', true],
            [http(401, { error: 'invalid_client' }), 'config', false],
            [gmailError(401, 'authError'), 'auth', false],
            [gmailError(403, 'insufficientPermissions'), 'auth', true],
            [gmailError(429, 'rateLimitExceeded'), 'transient', false],
            [gmailError(403, 'userRateLimitExceeded'), 'transient', false],
            [gmailError(403, 'dailyLimitExceeded'), 'transient', false],
            [gmailError(403, 'domainPolicy'), 'config', false],
            [gmailError(400, 'failedPrecondition'), 'config', false],
            [gmailError(400, 'invalidArgument'), 'permanent', false],
            [gmailError(413, 'uploadTooLarge'), 'permanent', false],
            [gmailError(500, 'backendError'), 'transient', false],
            [gmailError(404, 'notFound'), 'transient', false]
        ];

        for (const [err, kind, refused] of cases) {
            const classified = classifyGoogleError(err);

            assert.equal(classified.kind, kind, `${err.response.status} ${JSON.stringify(err.response.data)}`);
            assert.equal(isGrantRefused(classified), refused, `refused? ${err.response.status}`);
        }
    });

    it('retries what can clear soon, and not what cannot', () => {
        assert.equal(classifyGoogleError(gmailError(503, 'backendError')).retryable, true);
        assert.equal(classifyGoogleError(gmailError(403, 'dailyLimitExceeded')).retryable, false);
        assert.equal(classifyGoogleError(gmailError(404, 'notFound')).retryable, false);
        assert.equal(classifyGoogleError(http(429, {}, { 'retry-after': '7' })).retryAfterMs, 7000);
    });

    it('marks a lost connection ambiguous unless it never connected', () => {
        const reset = classifyGoogleError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
        const refused = classifyGoogleError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

        assert.deepEqual([reset.kind, reset.ambiguous], ['transient', true]);
        assert.deepEqual([refused.kind, refused.ambiguous], ['transient', false]);
    });
});

describe('building MIME', () => {
    it('refuses line breaks in any address, and folds them out of a subject', () => {
        for (const field of ['to', 'cc', 'bcc', 'replyTo', 'from']) {
            assert.throws(
                () => sanitiseMessage({ to: 'a@example.test', [field]: 'b@example.test\nBcc: c@example.test', subject: 's' }),
                (err) => err instanceof MailDeliveryError && err.kind === 'permanent',
                field
            );
        }

        assert.throws(() => sanitiseMessage({ to: [{ name: 'Eve\r\nBcc: x@y.z', address: 'e@example.test' }], subject: 's' }));
        assert.equal(sanitiseMessage({ to: 'a@example.test', subject: 'Hotel\r\nVera' }).subject, 'Hotel Vera');
        assert.throws(() => sanitiseMessage({ subject: 's' }), /no recipient/);
    });

    it('compiles the existing templates unchanged', async () => {
        const expiresAt = new Date('2026-12-01T10:00:00Z');
        const samples = {
            passwordReset: { url: 'https://iamgeorgia.test/reset-password/tok', expiresAt },
            partnerInvitation: { companyName: 'Rooms <Hotel> & Co', url: 'https://iamgeorgia.test/partners/register/tok', expiresAt, invitedByName: 'Tamar' },
            partnerRejected: { companyName: 'Rooms Hotel', reference: 'PTR-000001', contactName: 'ნინო', reason: 'Unverified' },
            mailProviderTest: { contactName: 'Ada', accountEmail: 'mail@example.test', fromAddress: 'mail@example.test' }
        };

        for (const [name, data] of Object.entries(samples)) {
            const { subject, text, html } = templates[name](data);
            const raw = (await buildMimeMessage({ from: 'I am Georgia <mail@example.test>', to: 'a@example.test', subject, text, html })).toString('utf8');

            assert.match(raw, /^Content-Type: multipart\/alternative;\s+boundary=/m, name);
            assert.ok(!/[^\r]\n/.test(raw), `${name}: every line ends in CRLF`);
            assert.match(raw, /^Subject: /m, name);
            assert.match(raw, /^MIME-Version: 1\.0/m, name);
            assert.match(raw, /^From: I am Georgia <mail@example\.test>/m, name);
        }
    });
});
