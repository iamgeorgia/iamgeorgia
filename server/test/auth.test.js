import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { config } from '../config.js';
import { createToken, hashToken } from '../lib/tokens.js';
import { verifyPassword } from '../lib/password.js';
import { outbox, clearOutbox } from '../lib/mailer/index.js';
import {
    TEST_PASSWORD,
    createTracker,
    makeAdmin,
    makePartner,
    makePartnerUser,
    makeAuthToken,
    signIn,
    testEmail,
    databaseAvailable
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const sessionFor = async (userId, overrides = {}) => {
    const token = createToken();

    await prisma.session.create({
        data: {
            tokenHash: hashToken(token),
            userId,
            expiresAt: new Date(Date.now() + 60_000),
            ...overrides
        }
    });

    return [`${config.auth.cookieName}=${token}`];
};

describe('authentication', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('signs in and returns the identity', async () => {
        const admin = await makeAdmin(tracker);
        const { status, body, cookie } = await signIn(app, admin.email);

        assert.equal(status, 200);
        assert.equal(body.user.email, admin.email);
        assert.equal(body.user.role, 'ADMIN');
        assert.equal(body.partner, null);
        assert.ok(cookie.length > 0);
    });

    it('puts the session in an httpOnly cookie and never in the body', async () => {
        const admin = await makeAdmin(tracker);
        const { body, cookie } = await signIn(app, admin.email);

        const header = cookie.join(';');

        assert.match(header, /HttpOnly/i);
        // Strict, not Lax: nothing authenticated here is reached by a top-level
        // navigation, which is the only thing Lax permits that Strict does not.
        assert.match(header, /SameSite=Strict/i);
        assert.match(header, /Path=\//i);
        // Not Secure in test, because the suite is not running over TLS. Keyed
        // on `isDeployed` rather than `isProduction`, so a staging host — which
        // is just as interceptable as production — still gets the flag.
        assert.equal(/Secure/i.test(header), config.isDeployed);
        // Host-only unless AUTH_COOKIE_DOMAIN names the domain the site and the
        // API share.
        assert.equal(/Domain=/i.test(header), Boolean(config.auth.cookieDomain));

        assert.ok(!JSON.stringify(body).includes('token'));
        assert.equal(body.user.passwordHash, undefined);
    });

    /**
     * The two failures must be indistinguishable. If a wrong password said
     * something different from an unknown address, the form would be a way to
     * find out who has an account here.
     */
    it('answers a wrong password and an unknown address identically', async () => {
        const admin = await makeAdmin(tracker);

        const wrongPassword = await signIn(app, admin.email, 'definitely-not-it-at-all');
        const unknownEmail = await signIn(app, testEmail('ghost'));

        assert.equal(wrongPassword.status, 401);
        assert.equal(unknownEmail.status, 401);
        assert.deepEqual(wrongPassword.body, unknownEmail.body);
        assert.equal(wrongPassword.cookie.length, 0);
    });

    it('refuses an account that has not set a password yet', async () => {
        const partner = await makePartner(tracker, { status: 'PENDING_APPROVAL' });
        const user = await makePartnerUser(tracker, partner, { withPassword: false });

        const res = await signIn(app, user.email);

        assert.equal(res.status, 401);
        assert.equal(res.body.error.message, 'Incorrect email address or password');
    });

    it('refuses a deactivated account', async () => {
        const admin = await makeAdmin(tracker, { isActive: false });

        assert.equal((await signIn(app, admin.email)).status, 401);
    });

    it('records a failed sign-in against a real account', async () => {
        const admin = await makeAdmin(tracker);

        await signIn(app, admin.email, 'wrong-password-entirely');

        const entries = await prisma.auditLog.findMany({
            where: { action: 'USER_LOGIN_FAILED', entityId: admin.id }
        });

        assert.equal(entries.length, 1);
        assert.equal(entries[0].metadata.reason, 'bad_password');
    });

    it('stamps the last sign-in time', async () => {
        const admin = await makeAdmin(tracker);

        assert.equal(admin.lastLoginAt, null);
        await signIn(app, admin.email);

        const stored = await prisma.user.findUnique({ where: { id: admin.id } });

        assert.ok(stored.lastLoginAt instanceof Date);
    });
});

/**
 * Two Set-Cookie headers for the session name: one for the configured domain,
 * and one with no Domain attribute that is already expired — the only thing
 * that removes a host-only cookie, since a browser matches on name, domain
 * and path together.
 */
const assertClearsHostOnlyCookie = (headers) => {
    const session = headers.filter((header) => header.startsWith(`${config.auth.cookieName}=`));

    assert.equal(session.length, 2);

    const hostOnly = session.find((header) => !/Domain=/i.test(header));
    const scoped = session.find((header) => /Domain=example\.test/i.test(header));

    assert.ok(hostOnly, 'a Set-Cookie without a Domain attribute');
    assert.match(hostOnly, /Expires=Thu, 01 Jan 1970/);
    assert.ok(scoped, 'a Set-Cookie for the configured domain');
};

describe('session lifetime', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('rejects a request with no cookie', async () => {
        const res = await request(app).get('/api/auth/me');

        assert.equal(res.status, 401);
        assert.equal(res.body.error.message, 'Authentication required');
    });

    it('rejects a made-up cookie', async () => {
        const res = await request(app)
            .get('/api/auth/me')
            .set('Cookie', [`${config.auth.cookieName}=${createToken()}`]);

        assert.equal(res.status, 401);
    });

    /**
     * A browser that signed in before AUTH_COOKIE_DOMAIN was set still holds
     * the host-only cookie next to the `Domain=` one, and sends both — the
     * dead one first. Only the first value reaches `req.cookies`, so every
     * browser-side write used to fail with 401 while server-rendered pages,
     * which carry only the site host's cookie, kept working.
     */
    it('does not let a dead leftover session cookie mask the live one', async () => {
        const admin = await makeAdmin(tracker);
        const { cookie } = await signIn(app, admin.email);
        const live = cookie[0].split(';')[0];
        const dead = `${config.auth.cookieName}=${createToken()}`;

        const res = await request(app).get('/api/auth/me').set('Cookie', `${dead}; ${live}`);

        assert.equal(res.status, 200);
        assert.equal(res.body.user.email, admin.email);
    });

    it('rejects a request whose every session cookie is dead', async () => {
        const res = await request(app)
            .get('/api/auth/me')
            .set('Cookie', `${config.auth.cookieName}=${createToken()}; ${config.auth.cookieName}=${createToken()}`);

        assert.equal(res.status, 401);
    });

    /**
     * The other half of the same clean-up: when a domain is configured, sign-in
     * and sign-out also expire the host-only cookie, so an affected browser
     * heals itself the next time it signs in. Without a domain the current
     * cookie *is* host-only and a second Set-Cookie would be a duplicate.
     */
    it('expires the leftover host-only cookie on sign-in and sign-out when a domain is configured', async () => {
        const admin = await makeAdmin(tracker);
        const previous = config.auth.cookieDomain;
        config.auth.cookieDomain = 'example.test';

        try {
            const { status, cookie } = await signIn(app, admin.email);

            assert.equal(status, 200);
            assertClearsHostOnlyCookie(cookie);

            const out = await request(app).post('/api/auth/logout').set('Cookie', cookie[1].split(';')[0]);

            assert.equal(out.status, 204);
            assertClearsHostOnlyCookie(out.headers['set-cookie'] ?? []);
        } finally {
            config.auth.cookieDomain = previous;
        }
    });

    it('sends one session cookie when no domain is configured', async () => {
        const admin = await makeAdmin(tracker);
        const previous = config.auth.cookieDomain;
        config.auth.cookieDomain = undefined;

        try {
            const { cookie } = await signIn(app, admin.email);

            assert.equal(cookie.filter((header) => header.startsWith(`${config.auth.cookieName}=`)).length, 1);
        } finally {
            config.auth.cookieDomain = previous;
        }
    });

    it('ends the session on logout and refuses the cookie afterwards', async () => {
        const admin = await makeAdmin(tracker);
        const { cookie } = await signIn(app, admin.email);

        assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 200);

        const out = await request(app).post('/api/auth/logout').set('Cookie', cookie);

        assert.equal(out.status, 204);
        assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
    });

    it('logs out cleanly with no session at all', async () => {
        assert.equal((await request(app).post('/api/auth/logout')).status, 204);
    });

    it('rejects an expired session', async () => {
        const admin = await makeAdmin(tracker);
        const cookie = await sessionFor(admin.id, { expiresAt: new Date(Date.now() - 1000) });

        assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
    });

    it('rejects a revoked session', async () => {
        const admin = await makeAdmin(tracker);
        const cookie = await sessionFor(admin.id, { revokedAt: new Date() });

        assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
    });

    /** Deactivation has to bite on the next request, not at cookie expiry. */
    it('rejects a live session whose account was deactivated', async () => {
        const admin = await makeAdmin(tracker);
        const { cookie } = await signIn(app, admin.email);

        assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 200);

        await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });

        assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
    });

    /**
     * The sliding window renews `expiresAt` forever. This is the wall it stops
     * at — note that the row is deliberately still unexpired by its own column,
     * so nothing but the absolute deadline can be doing the rejecting.
     */
    it('rejects a session past its absolute deadline, however recently it was used', async () => {
        const admin = await makeAdmin(tracker);
        const cookie = await sessionFor(admin.id, {
            createdAt: new Date(Date.now() - config.auth.sessionAbsoluteTtlMs - 1000),
            expiresAt: new Date(Date.now() + config.auth.sessionTtlMs)
        });

        assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
    });

    /** The last renewal before the deadline shortens, rather than overshooting. */
    it('never slides an expiry past the absolute deadline', async () => {
        const admin = await makeAdmin(tracker);
        const createdAt = new Date(Date.now() - config.auth.sessionAbsoluteTtlMs + 60 * 60 * 1000);
        const cookie = await sessionFor(admin.id, {
            createdAt,
            // Inside the half-life, so `touch` will try to extend it.
            expiresAt: new Date(Date.now() + 60_000)
        });

        assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 200);

        const [session] = await prisma.session.findMany({
            where: { userId: admin.id },
            orderBy: { createdAt: 'desc' },
            take: 1
        });
        const deadline = createdAt.getTime() + config.auth.sessionAbsoluteTtlMs;

        assert.ok(
            session.expiresAt.getTime() <= deadline,
            `expiry ${session.expiresAt.toISOString()} overshot the deadline`
        );
    });

    /**
     * Express sets no cache headers on res.json, which leaves a shared proxy
     * free to apply its own heuristics to a response describing who is signed in.
     */
    it('keeps an authenticated response out of caches', async () => {
        const admin = await makeAdmin(tracker);
        const { cookie } = await signIn(app, admin.email);

        const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

        assert.equal(res.status, 200);
        assert.match(res.headers['cache-control'], /no-store/);
    });

    /** Sign-in answers with the identity too, and never reaches `authenticate`. */
    it('keeps the sign-in response out of caches', async () => {
        const admin = await makeAdmin(tracker);
        const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: TEST_PASSWORD });

        assert.equal(res.status, 200);
        assert.match(res.headers['cache-control'], /no-store/);
    });
});

describe('account activation', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const pendingUser = async () => {
        const partner = await makePartner(tracker, { status: 'PENDING_APPROVAL' });
        const user = await makePartnerUser(tracker, partner, { withPassword: false });

        return { partner, user, ...(await makeAuthToken({ userId: user.id })) };
    };

    it('describes the account behind a valid link', async () => {
        const { user, partner, token } = await pendingUser();

        const res = await request(app).get(`/api/auth/activation/${token}`);

        assert.equal(res.status, 200);
        assert.equal(res.body.email, user.email);
        assert.equal(res.body.companyName, partner.name);
    });

    it('sets the password, signs the user in, and spends the link', async () => {
        const { user, token } = await pendingUser();

        const res = await request(app).post(`/api/auth/activation/${token}`).send({ password: TEST_PASSWORD });

        assert.equal(res.status, 200);
        assert.equal(res.body.user.email, user.email);
        assert.ok((res.headers['set-cookie'] ?? []).length > 0);

        const stored = await prisma.user.findUnique({ where: { id: user.id } });

        assert.ok(stored.passwordHash);
        assert.ok(await verifyPassword(TEST_PASSWORD, stored.passwordHash));
        assert.equal((await signIn(app, user.email)).status, 200);
    });

    it('refuses a second use of the same link', async () => {
        const { token } = await pendingUser();

        assert.equal((await request(app).post(`/api/auth/activation/${token}`).send({ password: TEST_PASSWORD })).status, 200);

        const replay = await request(app).post(`/api/auth/activation/${token}`).send({ password: TEST_PASSWORD });

        assert.equal(replay.status, 409);
        assert.match(replay.body.error.message, /already been used/i);
    });

    it('refuses an expired link with 410', async () => {
        const partner = await makePartner(tracker, { status: 'PENDING_APPROVAL' });
        const user = await makePartnerUser(tracker, partner, { withPassword: false });
        const { token } = await makeAuthToken({ userId: user.id, expiresAt: new Date(Date.now() - 1000) });

        const res = await request(app).get(`/api/auth/activation/${token}`);

        assert.equal(res.status, 410);
        assert.equal(res.body.error.details.canRequestNew, true);
    });

    it('will not accept a reset token at the activation endpoint', async () => {
        const partner = await makePartner(tracker, { status: 'PENDING_APPROVAL' });
        const user = await makePartnerUser(tracker, partner);
        const { token } = await makeAuthToken({ userId: user.id, purpose: 'PASSWORD_RESET' });

        assert.equal((await request(app).get(`/api/auth/activation/${token}`)).status, 404);
    });

    it('rejects an unknown token', async () => {
        assert.equal((await request(app).get(`/api/auth/activation/${createToken()}`)).status, 404);
    });

    it('enforces the password policy', async () => {
        const { token } = await pendingUser();

        const res = await request(app).post(`/api/auth/activation/${token}`).send({ password: 'short' });

        assert.equal(res.status, 400);
        assert.ok(res.body.error.details.length > 0);
    });

    it('rejects a password made out of the account email', async () => {
        const { token, user } = await pendingUser();
        const local = user.email.split('@')[0];

        const res = await request(app)
            .post(`/api/auth/activation/${token}`)
            .send({ password: `${local}-${local}` });

        assert.equal(res.status, 400);
        assert.match(res.body.error.message, /must not contain your name or email/i);
    });
});

describe('password reset', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('answers 204 for an address that has no account', async () => {
        clearOutbox();

        const res = await request(app).post('/api/auth/password/forgot').send({ email: testEmail('ghost') });

        assert.equal(res.status, 204);
        assert.equal(outbox.length, 0, 'nothing to send, and nothing said about it');
    });

    it('emails a link for a real account, and answers identically', async () => {
        clearOutbox();
        const admin = await makeAdmin(tracker);

        const res = await request(app).post('/api/auth/password/forgot').send({ email: admin.email });

        assert.equal(res.status, 204);
        assert.equal(outbox.length, 1);
        assert.equal(outbox[0].to, admin.email);
        assert.equal(outbox[0].template, 'passwordReset');
    });

    it('changes the password and ends every existing session', async () => {
        const admin = await makeAdmin(tracker);
        const { cookie } = await signIn(app, admin.email);
        const { token } = await makeAuthToken({ userId: admin.id, purpose: 'PASSWORD_RESET' });

        const res = await request(app)
            .post(`/api/auth/password/reset/${token}`)
            .send({ password: 'a-completely-different-passphrase' });

        assert.equal(res.status, 204);

        // The old session and the old password are both dead.
        assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
        assert.equal((await signIn(app, admin.email, TEST_PASSWORD)).status, 401);
        assert.equal((await signIn(app, admin.email, 'a-completely-different-passphrase')).status, 200);
    });

    it('spends the reset link', async () => {
        const admin = await makeAdmin(tracker);
        const { token } = await makeAuthToken({ userId: admin.id, purpose: 'PASSWORD_RESET' });
        const password = 'another-entirely-new-passphrase';

        assert.equal((await request(app).post(`/api/auth/password/reset/${token}`).send({ password })).status, 204);
        assert.equal((await request(app).post(`/api/auth/password/reset/${token}`).send({ password })).status, 409);
    });
});
