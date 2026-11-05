#!/usr/bin/env node
/**
 * Prints the seeded role → capability table as JSON.
 *
 * The client's tests need to know what each built-in role holds to check its
 * sidebar, its overview and its manual, but the client never imports the
 * server's role table at runtime. So the table is copied once, by this
 * script, into `client/test/fixtures/role-capabilities.json`, and
 * `test/rbac.fixture-sync.unit.test.js` fails when the copy drifts from
 * `lib/permissions.js`. Regenerate with:
 *
 *   node scripts/print-role-capabilities.js > ../client/test/fixtures/role-capabilities.json
 *
 * Pure: reads no database, so it describes the seed and not any role edited
 * in the panel since.
 */
import { ROLES, capabilitiesFor } from '../lib/permissions.js';

const table = Object.fromEntries(ROLES.map((role) => [role, capabilitiesFor(role)]));

process.stdout.write(`${JSON.stringify(table, null, 2)}\n`);
