import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

// The limits are read from config at import time, and the rest of the suite
// needs them out of the way, so this file lowers them for its own process
// before anything that reads config is loaded. Every import below is therefore
// dynamic — a static one would be hoisted above this assignment.
process.env.AUTH_LOGIN_LIMIT = '3';
process.env.AUTH_TOKEN_LOOKUP_LIMIT = '4';
process.env.AUTH_PASSWORD_CHANGE_LIMIT = '3';
// Every sign-in in this file comes from one address, so the per-address
// bucket must stay out of the way of the tests above it and is tripped on
// purpose by the last one.
process.env.AUTH_LOGIN_IP_LIMIT = '60';

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { disconnect } = await import('../db/index.js');
const { createToken } = await import('../lib/tokens.js');
const { TEST_PASSWORD, createTracker, makeAdmin, signIn, testEmail, databaseAvailable } = await import(
    './support/factories.js'
);

const app = createApp();
const dbAvailable = await databaseAvailable();

describe('rate limiting', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('stops repeated sign-in attempts against one account', async () => {
        const admin = await makeAdmin(tracker);

        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const res = await signIn(app, admin.email, 'wrong-password-here');

            assert.equal(res.status, 401, `attempt ${attempt} should still be answered normally`);
        }

        const blocked = await signIn(app, admin.email, 'wrong-password-here');

        assert.equal(blocked.status, 429);
        assert.match(blocked.body.error.message, /too many sign-in attempts/i);
    });

    it('reports the limit in standard headers, not legacy ones', async () => {
        const admin = await makeAdmin(tracker);

        const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'nope-nope' });

        assert.ok(res.headers['ratelimit-limit'] ?? res.headers['ratelimit']);
        assert.equal(res.headers['x-ratelimit-limit'], undefined);
    });

    /**
     * The counter is keyed on IP *and* account. One address exhausting its
     * attempts against a victim must not lock the victim out from elsewhere,
     * and it must not lock this address out of every other account either.
     */
    it('counts each account separately', async () => {
        const victim = await makeAdmin(tracker);
        const bystander = await makeAdmin(tracker);

        for (let attempt = 0; attempt < 4; attempt += 1) {
            await signIn(app, victim.email, 'wrong-password-here');
        }

        assert.equal((await signIn(app, victim.email, 'wrong-password-here')).status, 429);
        assert.equal((await signIn(app, bystander.email)).status, 200, 'a different account is unaffected');
    });

    it('does not count a successful sign-in against the limit', async () => {
        const admin = await makeAdmin(tracker);

        for (let attempt = 0; attempt < 6; attempt += 1) {
            assert.equal((await signIn(app, admin.email)).status, 200, `attempt ${attempt + 1}`);
        }
    });

    it('limits guessing at invitation tokens', async () => {
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const res = await request(app).get(`/api/invitations/${createToken()}`);

            assert.equal(res.status, 404, `attempt ${attempt + 1}`);
        }

        const blocked = await request(app).get(`/api/invitations/${createToken()}`);

        assert.equal(blocked.status, 429);
    });

    /**
     * There is no email in the body of a password change, so running it through
     * the login limiter reduced the key to the bare IP — which put every user
     * behind one office address into a single bucket, and let any one of them
     * exhaust it for the rest.
     */
    it('counts password-change attempts per user, not per address', async () => {
        const victim = await makeAdmin(tracker);
        const bystander = await makeAdmin(tracker);

        const attempt = async (admin) => {
            const { cookie } = await signIn(app, admin.email);

            return request(app)
                .post('/api/auth/password/change')
                .set('Cookie', cookie)
                .send({ currentPassword: 'not-the-right-one', newPassword: 'nine-copper-lanterns-burn' });
        };

        for (let i = 0; i < 3; i += 1) {
            assert.equal((await attempt(victim)).status, 401, `attempt ${i + 1}`);
        }

        assert.equal((await attempt(victim)).status, 429);
        // Same IP, different account: untouched.
        assert.equal((await attempt(bystander)).status, 401);
    });

    it('does not count a successful password change against the limit', async () => {
        const admin = await makeAdmin(tracker);
        const { cookie } = await signIn(app, admin.email);

        const res = await request(app)
            .post('/api/auth/password/change')
            .set('Cookie', cookie)
            .send({ currentPassword: TEST_PASSWORD, newPassword: 'nine-copper-lanterns-burn' });

        assert.equal(res.status, 204);
    });

    it('answers a limit breach in the same error shape as everything else', async () => {
        const email = testEmail('ghost');

        for (let attempt = 0; attempt < 4; attempt += 1) {
            await signIn(app, email, 'wrong-password-here');
        }

        const blocked = await signIn(app, email, 'wrong-password-here');

        assert.equal(blocked.status, 429);
        assert.equal(typeof blocked.body.error.message, 'string');
        assert.deepEqual(Object.keys(blocked.body), ['error']);
    });

    /**
     * Last, because it spends the address's whole budget: an attacker who
     * names a different account on every attempt gets a fresh pair bucket
     * each time, and the per-address bucket is what stops that.
     */
    it('stops one address spraying guesses across many accounts', async () => {
        let blocked = null;

        for (let attempt = 0; attempt < 60 && !blocked; attempt += 1) {
            const res = await signIn(app, testEmail('spray'), 'wrong-password-here');

            if (res.status === 429) {
                blocked = res;
            } else {
                assert.equal(res.status, 401, `attempt ${attempt + 1}`);
            }
        }

        assert.ok(blocked, 'the address runs out of attempts before it runs out of accounts');
        assert.match(blocked.body.error.message, /too many sign-in attempts/i);
    });
});
