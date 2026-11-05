import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { startGoogleStub, headerOf } from './support/googleStub.js';

/**
 * The Gmail API transport and the administrator flow that connects it, against
 * a local stand-in for Google (test/support/googleStub.js). The official client
 * libraries run unmodified; only the hosts they talk to are swapped.
 *
 * The environment is set before anything that reads config.js is imported,
 * which is why every application import below is dynamic.
 */
const CLIENT_ID = 'stub-client.apps.googleusercontent.com';
const SENDER = 'sender@example.test';
const stub = await startGoogleStub({ clientId: CLIENT_ID });

Object.assign(process.env, {
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'stub-client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:5000/api/admin/mail/google/callback',
    GMAIL_SENDER_EMAIL: SENDER,
    GOOGLE_API_STUB_URL: stub.url,
    GOOGLE_REFRESH_TOKEN: '',
    GMAIL_RETRY_BASE_MS: '1',
    GMAIL_MAX_ATTEMPTS: '3',
    GMAIL_DAILY_SEND_WARN: '100000',
    MAIL_CREDENTIALS_KEY: randomBytes(32).toString('base64')
});

const { default: request } = await import('supertest');
const { createApp } = await import('../app.js');
const { prisma, disconnect } = await import('../db/index.js');
const { sendMail, MailDeliveryError } = await import('../lib/mailer/index.js');
const { outboxContext } = await import('../lib/outbox.js');
const { openRefreshToken, resetSendingCredential } = await import('../lib/google/oauth.js');
const { alertScope } = await import('../services/mail/alerts.js');
const { createTracker, databaseAvailable, makeAdmin, makePartner, makePartnerUser, signIn, unique } = await import('./support/factories.js');

const app = createApp();
const dbAvailable = await databaseAvailable();
const BASE = '/api/admin/mail/google';

const cookieValue = (setCookie, name) => (setCookie ?? []).find((entry) => entry.startsWith(`${name}=`))?.split(';')[0] ?? null;

describe('Gmail API transport and its OAuth connection', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const startedAt = new Date();
    let existingRow = null;
    let superAdmin;
    let superCookie;
    let adminCookie;
    let partnerCookie;

    const authorize = async () => {
        const res = await request(app).post(`${BASE}/authorize`).set('Cookie', superCookie);

        assert.equal(res.status, 200, JSON.stringify(res.body));

        const state = new URL(res.body.url).searchParams.get('state');

        return { res, state, binding: cookieValue(res.headers['set-cookie'], 'iag_gmail_oauth') };
    };

    const callback = (query, binding) => {
        const req = request(app).get(`${BASE}/callback`).query(query);

        return binding ? req.set('Cookie', binding) : req;
    };

    /**
     * The callback answers with a page that moves the browser on, not a
     * redirect: a redirect would stay in Google's cross-site navigation and the
     * Strict session cookie would not reach the panel. Reads where it sends the
     * browser, and checks the page and its link agree.
     */
    const outcomeOf = (res) => {
        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /^text\/html/);
        assert.equal(res.headers['referrer-policy'], 'no-referrer');
        assert.equal(res.headers.location, undefined, 'not a redirect');

        const refresh = /<meta http-equiv="refresh" content="0;url=([^"]+)">/.exec(res.text)?.[1];
        const link = /<a href="([^"]+)">Continue<\/a>/.exec(res.text)?.[1];

        assert.ok(refresh, 'the page moves the browser on');
        assert.equal(link, refresh);

        const target = new URL(refresh.replaceAll('&amp;', '&'));

        assert.equal(target.pathname, '/admin/settings/email');

        return Object.fromEntries(target.searchParams);
    };

    /** Connects SENDER through the whole flow and returns the stored row. */
    const connect = async () => {
        const { state, binding } = await authorize();
        const res = await callback({ code: stub.issueCode({ email: SENDER }), state }, binding);

        assert.deepEqual(outcomeOf(res), { connected: '1' });

        return prisma.mailProviderCredential.findUnique({ where: { provider: 'gmail' } });
    };

    const send = (overrides = {}) =>
        sendMail(
            {
                to: 'guest@example.test',
                template: 'passwordReset',
                data: { url: 'https://iamgeorgia.test/reset-password/tok', expiresAt: new Date('2026-12-01T10:00:00Z') },
                ...overrides
            },
            { transport: 'gmail' }
        );

    before(async () => {
        // A developer may have connected a real account on this database; keep it.
        existingRow = await prisma.mailProviderCredential.findUnique({ where: { provider: 'gmail' } });
        await prisma.mailProviderCredential.deleteMany({ where: { provider: 'gmail' } });

        superAdmin = await makeAdmin(tracker, { role: 'SUPER_ADMIN' });
        const admin = await makeAdmin(tracker, { role: 'ADMIN' });
        const partner = tracker.partner(await makePartner(tracker));
        const partnerUser = await makePartnerUser(tracker, partner);

        // Alerts go to this suite's administrators only, not every one in the shared database.
        alertScope.userIds = [superAdmin.id, admin.id];

        superCookie = (await signIn(app, superAdmin.email)).cookie;
        adminCookie = (await signIn(app, admin.email)).cookie;
        partnerCookie = (await signIn(app, partnerUser.email)).cookie;
    });

    beforeEach(() => {
        stub.reset();
    });

    after(async () => {
        await prisma.mailProviderCredential.deleteMany({ where: { provider: 'gmail' } });

        if (existingRow) {
            await prisma.mailProviderCredential.create({ data: existingRow });
        }

        await prisma.mailLog.deleteMany({ where: { provider: 'gmail', createdAt: { gte: startedAt } } });
        await prisma.mailLog.deleteMany({ where: { outboxEventId: { startsWith: 'test-gmail-' } } });
        await prisma.oAuthState.deleteMany({ where: { userId: superAdmin.id } });
        await tracker.cleanup();
        await stub.close();
        await disconnect();
    });

    describe('who may use the settings', () => {
        it('refuses the anonymous, partners, and admins without settings.write', async () => {
            assert.equal((await request(app).get(BASE)).status, 401);
            assert.equal((await request(app).post(`${BASE}/authorize`)).status, 401);
            assert.equal((await request(app).get(BASE).set('Cookie', partnerCookie)).status, 403);
            assert.equal((await request(app).post(`${BASE}/test`).set('Cookie', partnerCookie)).status, 403);

            // An admin can see the state of outgoing mail, but not change who it is sent as.
            assert.equal((await request(app).get(BASE).set('Cookie', adminCookie)).status, 200);

            for (const path of ['authorize', 'disconnect', 'test']) {
                assert.equal((await request(app).post(`${BASE}/${path}`).set('Cookie', adminCookie)).status, 403, path);
            }
        });
    });

    describe('connecting the account', () => {
        it('builds a consent URL for the one scope, offline, bound to a cookie', async () => {
            const { res, state, binding } = await authorize();
            const url = new URL(res.body.url);

            assert.equal(url.origin + url.pathname, `${stub.url}/o/oauth2/v2/auth`);
            assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.send email');
            assert.equal(url.searchParams.get('access_type'), 'offline');
            assert.equal(url.searchParams.get('prompt'), 'consent');
            assert.equal(url.searchParams.get('login_hint'), SENDER);
            assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
            assert.ok(state.length >= 43, 'a 256-bit state');
            assert.equal(binding, `iag_gmail_oauth=${state}`);

            const flags = res.headers['set-cookie'].find((entry) => entry.startsWith('iag_gmail_oauth=')).toLowerCase();

            assert.match(flags, /httponly/);
            assert.match(flags, /samesite=lax/);
            assert.match(flags, /path=\/api\/admin\/mail\/google/);

            // Stored hashed: the raw state is nowhere in the database.
            assert.equal(await prisma.oAuthState.count({ where: { stateHash: state } }), 0);
            assert.equal(await prisma.oAuthState.count({ where: { userId: superAdmin.id, usedAt: null } }), 1);
            assert.ok(!JSON.stringify(res.body).includes('stub-client-secret'));
        });

        it('rejects an unknown, reused, expired or unbound state', async () => {
            assert.deepEqual(outcomeOf(await callback({ code: 'x', state: 'not-a-state' })), { error: 'state' });

            const missing = await callback({ code: 'x' });
            assert.deepEqual(outcomeOf(missing), { error: 'state' });

            // The right state from a browser that did not start the flow.
            const unbound = await authorize();
            assert.deepEqual(outcomeOf(await callback({ code: stub.issueCode({ email: SENDER }), state: unbound.state })), { error: 'session' });
            // …and it is spent now, even for the browser that did.
            assert.deepEqual(outcomeOf(await callback({ code: stub.issueCode({ email: SENDER }), state: unbound.state }, unbound.binding)), { error: 'state' });

            const stale = await authorize();
            await prisma.oAuthState.updateMany({ where: { userId: superAdmin.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
            assert.deepEqual(outcomeOf(await callback({ code: stub.issueCode({ email: SENDER }), state: stale.state }, stale.binding)), { error: 'state' });

            assert.equal(await prisma.mailProviderCredential.count(), 0, 'nothing was connected');
            assert.equal(stub.tokenRequests.length, 0, 'no code was exchanged for a bad state');
        });

        it('reports a refusal on the consent screen', async () => {
            const { state, binding } = await authorize();

            assert.deepEqual(outcomeOf(await callback({ error: 'access_denied', state }, binding)), { error: 'denied' });
        });

        it('refuses any account but the configured sender, and revokes its grant', async () => {
            const { state, binding } = await authorize();
            const res = await callback({ code: stub.issueCode({ email: 'someone-else@example.test' }), state }, binding);

            assert.deepEqual(outcomeOf(res), { error: 'account' });
            assert.equal(await prisma.mailProviderCredential.count(), 0);
            assert.equal(stub.revocations.length, 1, 'the stray grant was revoked at Google');

            const audit = await prisma.auditLog.findFirst({ where: { action: 'MAIL_PROVIDER_CONNECT_REJECTED', actorUserId: superAdmin.id }, orderBy: { createdAt: 'desc' } });
            assert.match(audit.summary, /someone-else@example\.test/);
        });

        it('refuses an unverified address, and a grant without the send permission', async () => {
            let flow = await authorize();
            assert.deepEqual(outcomeOf(await callback({ code: stub.issueCode({ email: SENDER, emailVerified: false }), state: flow.state }, flow.binding)), { error: 'account' });

            flow = await authorize();
            assert.deepEqual(outcomeOf(await callback({ code: stub.issueCode({ email: SENDER, scope: 'email' }), state: flow.state }, flow.binding)), { error: 'scope' });

            assert.equal(await prisma.mailProviderCredential.count(), 0);
        });

        it('stores the grant sealed, and the status never shows it', async () => {
            const row = await connect();
            const refreshToken = openRefreshToken(row.refreshTokenCipher);

            assert.equal(row.accountEmail, SENDER);
            assert.equal(row.connectedByUserId, superAdmin.id);
            assert.match(refreshToken, /^refresh-/);
            assert.ok(!row.refreshTokenCipher.includes(refreshToken), 'sealed, not stored in the clear');

            const status = await request(app).get(BASE).set('Cookie', superCookie);
            const body = JSON.stringify(status.body);

            assert.equal(status.status, 200);
            assert.equal(status.body.connected, true);
            assert.equal(status.body.account.accountEmail, SENDER);
            assert.ok(!body.includes(refreshToken) && !body.includes(row.refreshTokenCipher) && !body.includes('stub-client-secret'));

            const audit = await prisma.auditLog.findFirst({ where: { action: 'MAIL_PROVIDER_CONNECTED', actorUserId: superAdmin.id } });
            assert.ok(audit);
            assert.ok(!JSON.stringify(audit).includes(refreshToken));
        });
    });

    describe('sending', () => {
        before(async () => {
            if (!(await prisma.mailProviderCredential.findUnique({ where: { provider: 'gmail' } }))) await connect();
        });

        it('sends text and HTML, with international characters intact', async () => {
            await send({ template: 'mailProviderTest', data: { contactName: 'ნინო בן-דוד', accountEmail: SENDER, fromAddress: SENDER } });

            assert.equal(stub.sends.length, 1);

            const { raw } = stub.sends[0];

            assert.equal(headerOf(raw, 'To'), 'guest@example.test');
            assert.match(headerOf(raw, 'Subject'), /test email from the Gmail connection/);
            assert.match(raw, /multipart\/alternative/);
            assert.match(raw, /Content-Type: text\/plain/);
            assert.match(raw, /Content-Type: text\/html/);
            // The body is encoded; decoding the text part gives the name back.
            const textPart = raw.split(/Content-Type: text\/plain[^\r\n]*\r\n/)[1];
            const encoding = /Content-Transfer-Encoding: (\S+)/.exec(textPart)[1].toLowerCase();
            const content = textPart.split(/\r\n\r\n/)[1].split(/\r\n--/)[0];
            const decoded =
                encoding === 'base64'
                    ? Buffer.from(content, 'base64').toString('utf8')
                    : Buffer.from(content.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1').toString('utf8');

            assert.ok(decoded.includes('ნინო בן-דוד'), decoded);
        });

        it('encodes a non-Latin subject so it survives the trip', async () => {
            const subject = 'ჯავშანი დადასტურდა — ההזמנה אושרה';
            const { templates } = await import('../lib/mailer/templates.js');
            const original = templates.passwordReset;

            templates.passwordReset = (data) => ({ ...original(data), subject });

            try {
                await send();
            } finally {
                templates.passwordReset = original;
            }

            assert.equal(headerOf(stub.sends[0].raw, 'Subject'), subject);
        });

        it('sends to several recipients with CC, BCC, Reply-To and a PDF attachment', async () => {
            const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

            await send({
                to: ['one@example.test', 'two@example.test'],
                cc: 'finance@example.test',
                bcc: ['audit@example.test'],
                attachments: [{ filename: 'voucher-BKG-000123.pdf', content: pdf, contentType: 'application/pdf' }]
            });

            const { raw } = stub.sends[0];

            assert.equal(headerOf(raw, 'To'), 'one@example.test, two@example.test');
            assert.equal(headerOf(raw, 'Cc'), 'finance@example.test');
            assert.equal(headerOf(raw, 'Bcc'), 'audit@example.test', 'kept for Gmail, which strips it on delivery');
            assert.match(raw, /multipart\/mixed/);
            assert.match(raw, /Content-Type: application\/pdf; name=voucher-BKG-000123\.pdf/);
            assert.ok(raw.replace(/\r\n/g, '').includes(pdf.toString('base64')), 'the PDF bytes are in the message');
        });

        it('goes as a media upload when the message is large', async () => {
            await send({ attachments: [{ filename: 'big.pdf', content: randomBytes(4 * 1024 * 1024), contentType: 'application/pdf' }] });

            assert.equal(stub.sends.length, 1);
            assert.equal(stub.sends[0].upload, true);
            assert.equal(headerOf(stub.sends[0].raw, 'To'), 'guest@example.test');
        });

        it('refuses an address carrying a header, without calling Google', async () => {
            await assert.rejects(send({ to: 'guest@example.test\r\nBcc: victim@example.test' }), (err) => err instanceof MailDeliveryError && err.kind === 'permanent');
            assert.equal(stub.sends.length, 0);
        });

        it('reuses an access token, refreshes one about to expire, and shares one refresh across concurrent sends', async () => {
            resetSendingCredential();
            await send();
            await send();
            assert.equal(stub.refreshCount(), 1, 'one refresh for two sends');

            stub.tokenLifetimeSeconds = 60;
            resetSendingCredential();
            await send();
            await send();
            assert.equal(stub.refreshCount(), 3, 'a token inside its last five minutes is refreshed before use');

            stub.tokenLifetimeSeconds = 3600;
            resetSendingCredential();
            await Promise.all(Array.from({ length: 12 }, (_, index) => send({ to: `crowd-${index}@example.test` })));
            assert.equal(stub.refreshCount(), 4, 'twelve concurrent sends, one refresh');
            assert.equal(stub.sends.filter((entry) => entry.id).length, 16);
        });

        it('retries a rate limit and a server error, then succeeds', async () => {
            stub.failSends({ status: 429, reason: 'rateLimitExceeded', headers: { 'retry-after': '0' } }, { status: 503 });

            await send();

            assert.deepEqual(stub.sends.map((entry) => entry.failed ?? 'sent'), [429, 503, 'sent']);
        });

        it('gives up on transient failures after the configured attempts', async () => {
            stub.failSends({ status: 500 }, { status: 502 }, { status: 503 }, { status: 503 });

            await assert.rejects(send(), (err) => err.kind === 'transient' && err.status === 503);
            assert.equal(stub.sends.length, 3);
        });

        it('does not retry a permanent refusal or an exhausted daily quota', async () => {
            stub.failSends({ status: 400, reason: 'invalidArgument', body: { error: { code: 400, message: 'Invalid To header', errors: [{ reason: 'invalidArgument' }] } } });
            await assert.rejects(send(), (err) => err.kind === 'permanent');
            assert.equal(stub.sends.length, 1);

            stub.reset();
            stub.failSends({ status: 403, body: { error: { code: 403, message: 'Daily limit exceeded', errors: [{ reason: 'dailyLimitExceeded' }] } } });
            await assert.rejects(send(), (err) => err.kind === 'transient' && err.retryable === false);
            assert.equal(stub.sends.length, 1);
        });

        it('retries a dropped connection only once, since it may have been delivered', async () => {
            stub.failSends({ destroy: true }, { destroy: true }, { destroy: true });

            await assert.rejects(send(), (err) => err.kind === 'transient' && err.ambiguous);
            assert.equal(stub.sends.length, 2);
        });

        it('inside an outbox event, sends each email once however often the event is retried', async () => {
            const event = { id: unique('test-gmail-evt') };

            await outboxContext.run({ event }, () => send());
            await outboxContext.run({ event }, () => send());
            // A different email in the same event still goes.
            await outboxContext.run({ event }, () => send({ to: 'supplier@example.test' }));

            assert.equal(stub.sends.length, 2);
            assert.equal(await prisma.mailLog.count({ where: { outboxEventId: event.id, status: 'SENT' } }), 2);
        });

        it('inside an outbox event, logs a permanent refusal and lets the handler carry on', async () => {
            const event = { id: unique('test-gmail-evt') };

            stub.failSends({ status: 400, reason: 'invalidArgument' });

            assert.equal(await outboxContext.run({ event }, () => send()), null);

            const failed = await prisma.mailLog.findFirst({ where: { outboxEventId: event.id } });
            assert.equal(failed.status, 'FAILED');
            assert.match(failed.error, /Gmail API/);
        });

        it('sends a test email only to the administrator who asked', async () => {
            const res = await request(app).post(`${BASE}/test`).set('Cookie', superCookie).send({ to: 'attacker@example.test' });

            assert.equal(res.status, 200);
            assert.deepEqual({ sent: res.body.sent, to: res.body.to }, { sent: true, to: superAdmin.email });
            assert.equal(stub.sends.length, 1);
            assert.equal(headerOf(stub.sends[0].raw, 'To'), superAdmin.email);
            assert.ok(!stub.sends[0].raw.includes('attacker@example.test'));
        });
    });

    describe('when Google revokes the grant', () => {
        it('stops sending, says so once, and needs a reconnect', async () => {
            let row = await prisma.mailProviderCredential.findUnique({ where: { provider: 'gmail' } });

            if (!row) row = await connect();

            stub.revoke(openRefreshToken(row.refreshTokenCipher));
            resetSendingCredential();

            await assert.rejects(send(), (err) => err.kind === 'auth');

            const marked = await prisma.mailProviderCredential.findUnique({ where: { provider: 'gmail' } });
            assert.ok(marked.revokedAt, 'marked revoked');
            assert.match(marked.lastAuthError, /invalid_grant/);

            const alerts = await prisma.notification.count({ where: { recipientUserId: superAdmin.id, kind: 'MAIL_PROVIDER_ALERT' } });
            assert.equal(alerts, 1);
            assert.ok(await prisma.auditLog.findFirst({ where: { action: 'MAIL_PROVIDER_REVOKED', createdAt: { gte: startedAt } } }));

            // Fails fast now: Google is not asked again until someone reconnects.
            const asked = stub.tokenRequests.length;
            await assert.rejects(send(), (err) => err.kind === 'auth' && err.reason === 'revoked');
            assert.equal(stub.tokenRequests.length, asked);

            const status = await request(app).get(BASE).set('Cookie', superCookie);
            assert.equal(status.body.connected, false);
            assert.ok(status.body.account.revokedAt);

            // Reconnecting is the same flow, and mail flows again.
            await connect();
            await send();
            assert.equal(stub.sends.filter((entry) => entry.id).length, 1);
        });
    });

    describe('disconnecting', () => {
        it('revokes at Google and forgets the account', async () => {
            const row = (await prisma.mailProviderCredential.findUnique({ where: { provider: 'gmail' } })) ?? (await connect());
            const token = openRefreshToken(row.refreshTokenCipher);

            const res = await request(app).post(`${BASE}/disconnect`).set('Cookie', superCookie);

            assert.equal(res.status, 200);
            assert.deepEqual(res.body, { revokedAtGoogle: true });
            assert.ok(stub.revocations.includes(token));
            assert.equal(await prisma.mailProviderCredential.count(), 0);
            assert.equal((await request(app).post(`${BASE}/disconnect`).set('Cookie', superCookie)).status, 404);

            await assert.rejects(send(), (err) => err.kind === 'auth' && err.reason === 'notConnected');
        });
    });
});
