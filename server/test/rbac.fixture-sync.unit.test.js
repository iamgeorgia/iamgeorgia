import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ROLES, capabilitiesFor } from '../lib/permissions.js';

/**
 * The client keeps a copy of the seeded role table for its own tests (which
 * sidebar, overview and manual each built-in role gets). This is the test
 * that keeps the copy honest: when a role gains or loses a capability here,
 * it fails until the fixture is regenerated with
 * `node scripts/print-role-capabilities.js > ../client/test/fixtures/role-capabilities.json`.
 */
const FIXTURE = fileURLToPath(new URL('../../client/test/fixtures/role-capabilities.json', import.meta.url));

describe('client role-capability fixture', () => {
    it('matches the seeded role table', () => {
        const copy = JSON.parse(readFileSync(FIXTURE, 'utf8'));

        assert.deepEqual(Object.keys(copy).sort(), [...ROLES].sort(), 'the fixture lists different roles');

        for (const role of ROLES) {
            assert.deepEqual(copy[role], capabilitiesFor(role), `${role} differs — regenerate the client fixture`);
        }
    });
});
