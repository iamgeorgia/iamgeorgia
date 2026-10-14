// First on purpose: the walker wraps Express's `Router.prototype.use` to see
// the mount prefixes, and must do so before app.js mounts anything.
import { listEndpoints } from './support/routeWalker.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

import request from 'supertest';

import { createApp } from '../app.js';
import { disconnect } from '../db/index.js';
import {
    createTracker,
    makeAdmin,
    makePartner,
    makePartnerUser,
    makeTransferProvider,
    makeDriver,
    makeDriverUser,
    signIn,
    databaseAvailable
} from './support/factories.js';

/**
 * Who reaches which endpoint.
 *
 * Every mounted route is called once as each kind of account — anonymous,
 * the seven platform roles, the four partner roles — with no body and with
 * ids that exist nowhere, and the answer is sorted into three classes:
 *
 *   UNAUTHENTICATED  401: no session, and one was needed
 *   FORBIDDEN        403: a session, and it was not enough
 *   REACHED          anything else — the guard let the request through to
 *                    validation or the service (400, 404, 2xx, …)
 *
 * The classes are compared with `test/fixtures/rbac-matrix.json`. The fixture
 * is the authorization map of the whole API in one file, so a route that
 * opens or closes to a role shows up as a diff there, where a reviewer can
 * see it, rather than as a quiet change in behaviour. To accept a change,
 * regenerate the fixture and commit it:
 *
 *   RBAC_MATRIX_UPDATE=1 node --test test/rbac.matrix.test.js
 *
 * A new route has to be added the same way; the test fails until it is.
 */
const FIXTURE = new URL('./fixtures/rbac-matrix.json', import.meta.url);

const ROLES = [
    'ANONYMOUS',
    'SUPER_ADMIN',
    'ADMIN',
    'MANAGEMENT',
    'TOUR_OPERATOR',
    'ACCOUNTANT',
    'FINANCE_OPERATOR',
    'DISPATCHER',
    'DRIVER',
    'PARTNER_OWNER',
    'PARTNER_ADMIN',
    'PARTNER_AGENT',
    'PARTNER_FINANCE'
];

/** Routes that would change the caller's own standing mid-run. */
const SKIP = new Set(['POST /api/auth/logout']);

const MISSING_ID = 'rbacmatrixmissing';

const classify = (status) => {
    if (status === 401) return 'UNAUTHENTICATED';
    if (status === 403) return 'FORBIDDEN';
    return 'REACHED';
};

const concrete = (path) => path.replace(/:[A-Za-z]+/g, MISSING_ID);

const app = createApp();
const dbAvailable = await databaseAvailable();

describe('who reaches what, across the whole API', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const cookies = {};
    let endpoints;
    let expected;

    before(async () => {
        endpoints = (await listEndpoints()).filter((e) => !SKIP.has(`${e.method} ${e.path}`));

        for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGEMENT', 'TOUR_OPERATOR', 'ACCOUNTANT', 'FINANCE_OPERATOR', 'DISPATCHER']) {
            const user = await makeAdmin(tracker, { role });
            cookies[role] = (await signIn(app, user.email)).cookie;
        }

        const provider = tracker.transferProvider(await makeTransferProvider());
        const driver = await makeDriver(tracker, { providerId: provider.id });
        const driverUser = await makeDriverUser(tracker, driver);
        cookies.DRIVER = (await signIn(app, driverUser.email)).cookie;

        const partner = await makePartner(tracker);
        for (const role of ['PARTNER_OWNER', 'PARTNER_ADMIN', 'PARTNER_AGENT', 'PARTNER_FINANCE']) {
            const user = await makePartnerUser(tracker, partner, { role, isPrimaryContact: role === 'PARTNER_OWNER' });
            cookies[role] = (await signIn(app, user.email)).cookie;
        }

        for (const role of ROLES.slice(1)) {
            assert.ok(cookies[role]?.length, `${role} could not sign in`);
        }

        expected = process.env.RBAC_MATRIX_UPDATE
            ? {}
            : JSON.parse(await readFile(FIXTURE, 'utf8'));
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const call = async (endpoint, role) => {
        const req = request(app)[endpoint.method.toLowerCase()](concrete(endpoint.path));

        if (role !== 'ANONYMOUS') {
            req.set('Cookie', cookies[role]);
        }

        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(endpoint.method)) {
            req.send({});
        }

        const res = await req;

        return res.status;
    };

    /**
     * A 5xx is not an answer about authorization. Thirteen callers at once on
     * a pool of two connections means a route that opens a transaction can
     * keep the others waiting past their timeout, and with the whole suite
     * sharing one Postgres even a session lookup can be refused. Both read as
     * REACHED if the status is sorted blindly, so the cells that erred are
     * asked again afterwards, one at a time, with the pool to themselves; one
     * that still errs is written down as the error rather than as an answer.
     */
    const observe = async () => {
        const observed = {};
        const erred = [];

        for (const endpoint of endpoints) {
            const key = `${endpoint.method} ${endpoint.path}`;
            const statuses = await Promise.all(ROLES.map((role) => call(endpoint, role)));

            observed[key] = {};
            ROLES.forEach((role, i) => {
                if (statuses[i] >= 500) erred.push({ endpoint, role, key });
                else observed[key][role] = classify(statuses[i]);
            });
        }

        for (const { endpoint, role, key } of erred) {
            let status = 500;

            for (let attempt = 0; attempt < 3 && status >= 500; attempt += 1) {
                status = await call(endpoint, role);
            }

            observed[key][role] = status >= 500 ? `ERROR_${status}` : classify(status);
        }

        return observed;
    };

    it('matches the committed matrix for every route and every role', async () => {
        const observed = await observe();

        if (process.env.RBAC_MATRIX_UPDATE) {
            await writeFile(FIXTURE, `${JSON.stringify(observed, null, 2)}\n`);
            return;
        }

        const problems = [];

        for (const [key, byRole] of Object.entries(observed)) {
            if (!expected[key]) {
                problems.push(`${key}: not in the fixture (new route?)`);
                continue;
            }

            for (const role of ROLES) {
                if (byRole[role] !== expected[key][role]) {
                    problems.push(`${key} as ${role}: expected ${expected[key][role]}, got ${byRole[role]}`);
                }
            }
        }

        for (const key of Object.keys(expected)) {
            if (!observed[key]) {
                problems.push(`${key}: in the fixture but no longer mounted`);
            }
        }

        assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
    });

    it('never answers an anonymous caller with 403', () => {
        for (const [key, byRole] of Object.entries(expected)) {
            assert.notEqual(byRole.ANONYMOUS, 'FORBIDDEN', key);
        }
    });

    it('keeps every /admin route closed to drivers and partners', () => {
        for (const [key, byRole] of Object.entries(expected)) {
            if (!key.includes(' /api/admin/')) continue;

            for (const role of ['DRIVER', 'PARTNER_OWNER', 'PARTNER_ADMIN', 'PARTNER_AGENT', 'PARTNER_FINANCE']) {
                assert.equal(byRole[role], 'FORBIDDEN', `${key} as ${role}`);
            }
            assert.equal(byRole.ANONYMOUS, 'UNAUTHENTICATED', key);
        }
    });

    it('keeps the driver panel to drivers', () => {
        for (const [key, byRole] of Object.entries(expected)) {
            if (!key.includes(' /api/driver/')) continue;

            assert.equal(byRole.DRIVER, 'REACHED', key);
            for (const role of ROLES.filter((r) => !['ANONYMOUS', 'DRIVER'].includes(r))) {
                assert.equal(byRole[role], 'FORBIDDEN', `${key} as ${role}`);
            }
        }
    });
});
