import pg from 'pg';

import { config } from '../config.js';
import { removeObjectPrefix } from '../services/media/storage.service.js';
import {
    DATABASE,
    ON_DELETE,
    UsageError,
    danglingReferenceQueries,
    deletionPredicates,
    folderOf,
    orphanedAssetsQuery,
    parseArgs,
    quoteIdent,
    refusalReason,
    resolveScopes,
    textArray
} from './lib/clear-data-scopes.js';

/**
 * Clears parts of the database — or all of it — safely.
 *
 *   node scripts/clear-data.js <scope[,scope...]>                        # dry run: report only
 *   node scripts/clear-data.js packages,hotels --yes                     # delete
 *   node scripts/clear-data.js catalogue --yes --confirm iamgeorgia      # deployed environments
 *   node scripts/clear-data.js database --yes --confirm iamgeorgia [--wipe-production]
 *
 * Scopes: demo-bookings, demo-fleet, packages, hotels, kosher, tours, services,
 * transfers, catalogue (all of those), database (everything, on its own).
 *
 * Only what the seed scripts created is touched: records are found by the
 * slugs and codes in `db/seed/*` and by the demo markers, so a hotel an admin
 * entered by hand survives `hotels`. Users, sessions, partners, the audit log,
 * reference data and destinations are never touched — except by `database`.
 *
 * How a run goes:
 *   1. The plan is built inside a transaction: the rows each scope deletes,
 *      everything that cascades from them (followed through the foreign keys
 *      Postgres reports, not a hand-kept list), rows that would be unlinked,
 *      and anything that blocks the delete. Without --yes the transaction is
 *      READ ONLY and rolled back — a dry run cannot write.
 *   2. With --yes the checks run again inside the deleting transaction, so a
 *      booking made between the report and the delete still stops it.
 *   3. Files in storage are removed only after the commit. A failure there
 *      leaves the database cleared and exits 2 with the folders it left.
 */

const DEMO_EMAIL_DOMAIN = '@demo.iamgeorgia.test';
const DEMO_SOURCE = 'DEMO';
const HOUSE_PROVIDER = 'iamgeorgia-fleet';
/** `normalisePlate('DM-')` in services/transfer/fleet.service.js. */
const DEMO_PLATE_PREFIX = 'DM';

const LOCK_TIMEOUT = '10s';
const STATEMENT_TIMEOUT = '10min';
const FILE_CONCURRENCY = 8;

const FINISHED_BOOKING_STATUSES = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];
const LIVE_ASSIGNMENT_STATUSES = ['OFFERED', 'ACCEPTED'];
const ASSIGNED_LEG_STATUSES = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'ON_BOARD'];

/** Tables whose rows must never be silently unlinked; the scope that owns them, if any. */
const BLOCKING_UNLINKS = {
    package_components: 'packages',
    orders: null,
    tours: 'tours',
    transfer_bookings: 'demo-bookings',
    transfer_booking_legs: 'demo-bookings',
    transfer_drivers: 'demo-fleet'
};

/** For a Restrict block: the scope that would remove the referencing rows, if they are seed data. */
const RESTRICT_HINTS = {
    transfer_bookings: 'demo-bookings',
    transfer_assignments: 'demo-fleet',
    transfer_drivers: 'demo-fleet',
    transfer_fleet_vehicles: 'demo-fleet'
};

const lit = (value) => pg.escapeLiteral(String(value));
const list = (values) => textArray(values, pg.escapeLiteral);
const inList = (values) => values.map(lit).join(', ');

const EXIT = { ok: 0, refused: 1, filesLeft: 2 };

// --- seed identity ---------------------------------------------------------------

const loadSeedKeys = async () => {
    const [
        { hotels },
        { TOURS },
        { SERVICES },
        { PACKAGES },
        { TRANSFER_POINTS },
        { TRANSFER_PROVIDERS, TRANSFER_VEHICLES },
        { TRANSFER_EXTRAS },
        { expandRoutes },
        { KOSHER_HOTELS },
        { KOSHER_AMENITY_CATEGORIES }
    ] = await Promise.all([
        import('../db/seed/hotels.js'),
        import('../db/seed/tours.js'),
        import('../db/seed/services.js'),
        import('../db/seed/packages.js'),
        import('../db/seed/transfers/points.js'),
        import('../db/seed/transfers/vehicles.js'),
        import('../db/seed/transfers/extras.js'),
        import('../db/seed/transfers/routes.js'),
        import('../db/seed/kosherHotels.js'),
        import('../db/seed/kosherAmenities.js')
    ]);

    const keys = {
        hotels: hotels.map((row) => row.slug),
        tours: TOURS.map((row) => row.slug),
        services: SERVICES.map((row) => row.slug),
        packages: PACKAGES.map((row) => row.slug),
        points: TRANSFER_POINTS.map((row) => row.slug),
        providers: TRANSFER_PROVIDERS.map((row) => row.slug),
        vehicles: TRANSFER_VEHICLES.map((row) => row.slug),
        extras: TRANSFER_EXTRAS.map((row) => row.code),
        routes: expandRoutes().map((row) => row.slug),
        kosherHotels: Object.keys(KOSHER_HOTELS),
        kosherNearby: Object.fromEntries(
            Object.entries(KOSHER_HOTELS).map(([slug, fixture]) => [
                slug,
                (fixture.nearby ?? []).map((place) => ({ name: place.name, kind: place.kind }))
            ])
        ),
        kosherCategories: KOSHER_AMENITY_CATEGORIES
    };

    for (const [name, values] of Object.entries(keys)) {
        if (Array.isArray(values) && values.some((value) => typeof value !== 'string' || value === '')) {
            throw new Error(`Seed data for ${name} has a missing slug or code; refusing to build a deletion from it`);
        }
    }

    return keys;
};

// --- scopes ------------------------------------------------------------------------

const DEMO_DRIVERS = `SELECT dd.id FROM transfer_drivers dd JOIN users du ON du.id = dd.user_id WHERE du.email LIKE ${lit(`%${DEMO_EMAIL_DOMAIN}`)}`;
const DEMO_CARS =
    `SELECT dc.id FROM transfer_fleet_vehicles dc JOIN transfer_providers dp ON dp.id = dc.provider_id ` +
    `WHERE dp.slug = ${lit(HOUSE_PROVIDER)} AND dc.plate_normalized LIKE ${lit(`${DEMO_PLATE_PREFIX}%`)}`;
const isDemoBooking = (alias) =>
    `(${alias}.source = ${lit(DEMO_SOURCE)} AND ${alias}.lead_passenger_email LIKE ${lit(`%${DEMO_EMAIL_DOMAIN}`)})`;

/**
 * What each scope deletes (`roots`, in order, each a predicate over alias `t`),
 * what stops it (`checks`: a count query and a message), and any rows it
 * changes rather than deletes (`updates`).
 */
const defineScopes = (keys, running) => ({
    'demo-fleet': {
        roots: [
            { table: 'transfer_assignments', where: `t.driver_id IN (${DEMO_DRIVERS}) OR t.fleet_vehicle_id IN (${DEMO_CARS})` },
            { table: 'transfer_drivers', where: `t.id IN (${DEMO_DRIVERS})` },
            { table: 'transfer_fleet_vehicles', where: `t.id IN (${DEMO_CARS})` },
            { table: 'users', where: `t.primary_role_id = (SELECT id FROM roles WHERE key = 'DRIVER') AND t.email LIKE ${lit(`%${DEMO_EMAIL_DOMAIN}`)}` },
            {
                // The house provider goes only once nothing real is left under it.
                table: 'transfer_providers',
                where:
                    `t.slug = ${lit(HOUSE_PROVIDER)} AND t.partner_id IS NULL ` +
                    `AND NOT EXISTS (SELECT 1 FROM transfer_vehicles pv WHERE pv.provider_id = t.id) ` +
                    `AND NOT EXISTS (SELECT 1 FROM transfer_fleet_vehicles pf WHERE pf.provider_id = t.id AND pf.id NOT IN (${DEMO_CARS})) ` +
                    `AND NOT EXISTS (SELECT 1 FROM transfer_drivers pd WHERE pd.provider_id = t.id AND pd.id NOT IN (${DEMO_DRIVERS}))`
            }
        ],
        checks: [
            {
                sql:
                    `SELECT count(*)::int AS n FROM transfer_assignments a JOIN transfer_bookings b ON b.id = a.booking_id ` +
                    `WHERE (a.driver_id IN (${DEMO_DRIVERS}) OR a.fleet_vehicle_id IN (${DEMO_CARS})) ` +
                    `AND NOT ${isDemoBooking('b')} AND b.status::text NOT IN (${inList(FINISHED_BOOKING_STATUSES)})`,
                message: (n) => `${n} demo driver/car assignment(s) are on real, unfinished bookings — reassign them first`
            }
        ],
        // When the demo bookings stay, legs a demo driver was about to drive go
        // back to the dispatch board instead of pointing at nobody.
        updates: running.has('demo-bookings')
            ? []
            : [
                  {
                      label: 'transfer_booking_legs returned to UNASSIGNED',
                      where:
                          `t.id IN (SELECT a.leg_id FROM transfer_assignments a WHERE (a.driver_id IN (${DEMO_DRIVERS}) OR a.fleet_vehicle_id IN (${DEMO_CARS})) ` +
                          `AND a.status::text IN (${inList(LIVE_ASSIGNMENT_STATUSES)})) AND t.status::text IN (${inList(ASSIGNED_LEG_STATUSES)})`,
                      table: 'transfer_booking_legs',
                      set: `status = 'UNASSIGNED', status_changed_at = now()`
                  }
              ]
    },

    'demo-bookings': {
        roots: [{ table: 'transfer_bookings', where: isDemoBooking('t') }],
        checks: [],
        updates: []
    },

    packages: {
        roots: [{ table: 'packages', where: `t.slug = ANY(${list(keys.packages)})` }],
        checks: [],
        updates: []
    },

    kosher: {
        roots: [
            {
                table: 'hotel_amenities',
                where:
                    `t.hotel_id IN (SELECT kh.id FROM hotels kh WHERE kh.slug = ANY(${list(keys.kosherHotels)})) ` +
                    `AND t.amenity_id IN (SELECT ka.id FROM amenities ka WHERE ka.category::text = ANY(${list(keys.kosherCategories)}))`
            },
            {
                table: 'hotel_kosher_profiles',
                where: `t.hotel_id IN (SELECT kh.id FROM hotels kh WHERE kh.slug = ANY(${list(keys.kosherHotels)}))`
            }
        ],
        checks: [],
        updates: [],
        nearby: keys.kosherNearby,
        notes: [
            {
                sql:
                    `SELECT count(*)::int AS n FROM hotel_booking_requests q JOIN hotel_bookings b ON b.id = q.booking_id ` +
                    `JOIN hotels h ON h.id = b.hotel_id WHERE h.slug = ANY(${list(keys.kosherHotels)})`,
                message: (n) => `${n} hotel booking request(s) at these properties belong to guests' bookings and are left untouched`
            }
        ]
    },

    hotels: {
        roots: [{ table: 'hotels', where: `t.slug = ANY(${list(keys.hotels)})` }],
        checks: [
            {
                sql: `SELECT count(*)::int AS n FROM hotels h WHERE h.slug = ANY(${list(keys.hotels)}) AND h.supplier_id IS NOT NULL`,
                message: (n) => `${n} of these hotels belong to a partner (supplier_id is set)`
            },
            {
                sql:
                    `SELECT count(*)::int AS n FROM booking_holds bh JOIN room_types r ON r.id = bh.room_type_id JOIN hotels h ON h.id = r.hotel_id ` +
                    `WHERE h.slug = ANY(${list(keys.hotels)}) AND bh.status::text = 'ACTIVE' AND bh.expires_at > now()`,
                message: (n) => `${n} active room hold(s): someone is checking out right now — try again when they expire`
            }
        ],
        updates: []
    },

    tours: {
        roots: [{ table: 'tours', where: `t.slug = ANY(${list(keys.tours)})` }],
        checks: [
            {
                sql: `SELECT count(*)::int AS n FROM tours x WHERE x.slug = ANY(${list(keys.tours)}) AND x.supplier_id IS NOT NULL`,
                message: (n) => `${n} of these tours belong to a partner (supplier_id is set)`
            },
            {
                sql:
                    `SELECT count(*)::int AS n FROM tour_holds th JOIN tour_options o ON o.id = th.tour_option_id JOIN tours x ON x.id = o.tour_id ` +
                    `WHERE x.slug = ANY(${list(keys.tours)}) AND th.status::text = 'ACTIVE' AND th.expires_at > now()`,
                message: (n) => `${n} active tour hold(s): someone is checking out right now — try again when they expire`
            }
        ],
        updates: []
    },

    services: {
        roots: [{ table: 'services', where: `t.slug = ANY(${list(keys.services)})` }],
        checks: [
            {
                sql: `SELECT count(*)::int AS n FROM services s WHERE s.slug = ANY(${list(keys.services)}) AND s.supplier_id IS NOT NULL`,
                message: (n) => `${n} of these services belong to a partner (supplier_id is set)`
            }
        ],
        updates: []
    },

    transfers: {
        roots: [
            { table: 'transfer_routes', where: `t.slug = ANY(${list(keys.routes)})` },
            { table: 'transfer_vehicles', where: `t.slug = ANY(${list(keys.vehicles)})` },
            { table: 'transfer_providers', where: `t.slug = ANY(${list(keys.providers)})` },
            { table: 'transfer_points', where: `t.slug = ANY(${list(keys.points)})` },
            { table: 'transfer_extras', where: `t.code = ANY(${list(keys.extras)})` }
        ],
        checks: [
            {
                sql:
                    `SELECT (SELECT count(*) FROM transfer_providers p WHERE p.slug = ANY(${list(keys.providers)}) AND p.partner_id IS NOT NULL) + ` +
                    `(SELECT count(*) FROM transfer_vehicles v WHERE v.slug = ANY(${list(keys.vehicles)}) AND v.partner_id IS NOT NULL) AS n`,
                message: (n) => `${n} of these providers/vehicle classes are linked to a partner (partner_id is set)`
            }
        ],
        updates: []
    }
});

// --- catalog -----------------------------------------------------------------------

const readForeignKeys = async (client) => {
    const { rows } = await client.query(`
        SELECT con.conname AS name,
               child.relname AS child,
               parent.relname AS parent,
               con.confdeltype AS on_delete,
               ARRAY(SELECT att.attname FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                     JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum ORDER BY k.ord)::text[] AS child_columns,
               ARRAY(SELECT att.attname FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                     JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.attnum ORDER BY k.ord)::text[] AS parent_columns
        FROM pg_constraint con
        JOIN pg_class child ON child.oid = con.conrelid
        JOIN pg_class parent ON parent.oid = con.confrelid
        JOIN pg_namespace ns ON ns.oid = child.relnamespace
        WHERE con.contype = 'f' AND ns.nspname = current_schema()
        ORDER BY child.relname, con.conname`);

    return rows.map((row) => ({
        name: row.name,
        child: row.child,
        parent: row.parent,
        onDelete: ON_DELETE[row.on_delete],
        childColumns: row.child_columns,
        parentColumns: row.parent_columns
    }));
};

const readTables = async (client) => {
    const { rows } = await client.query(`
        SELECT c.relname AS name,
               EXISTS (SELECT 1 FROM information_schema.columns col
                       WHERE col.table_schema = current_schema() AND col.table_name = c.relname
                         AND col.column_name = 'id' AND col.data_type = 'text') AS has_text_id
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')
          AND c.relname <> '_prisma_migrations'
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
        ORDER BY c.relname`);

    return rows;
};

const countOf = async (client, sql) => (await client.query(sql)).rows[0].n;

// --- plan --------------------------------------------------------------------------

/**
 * Everything a scoped run would do, computed on the connection it is given.
 * Called twice when deleting: once for the report, once inside the deleting
 * transaction, so the delete acts on the state it actually checked.
 */
const buildPlan = async (client, scopeNames, scopes) => {
    const foreignKeys = await readForeignKeys(client);
    const tables = await readTables(client);
    const tableNames = new Set(tables.map((table) => table.name));

    const roots = new Map();
    const addRoot = (table, where) => {
        if (!tableNames.has(table)) {
            throw new Error(`Table ${table} does not exist — the schema has changed; update scripts/clear-data.js`);
        }

        if (!roots.has(table)) roots.set(table, []);
        roots.get(table).push(where);
    };

    for (const name of scopeNames) {
        for (const root of scopes[name].roots) addRoot(root.table, root.where);
    }

    // Phase 1: the scopes' own rows and their cascades.
    const entityPredicates = deletionPredicates(foreignKeys, roots);

    // Files only those rows refer to.
    const assetSql = orphanedAssetsQuery(foreignKeys, entityPredicates);
    const assets = assetSql ? (await client.query(assetSql)).rows : [];
    const assetIds = assets.map((asset) => asset.id);

    if (assetIds.length > 0) {
        const { rows: variants } = await client.query(
            `SELECT v.object_key, a.visibility::text AS visibility FROM image_variants v JOIN file_assets a ON a.id = v.file_asset_id WHERE a.id = ANY(${list(assetIds)})`
        );
        assets.push(...variants);
        addRoot('file_assets', `t.id = ANY(${list(assetIds)})`);
    }

    // Pending outbox events and notifications about rows that are going away.
    const entityTables = tables.filter((table) => table.has_text_id && entityPredicates.has(table.name));
    const serviceRoots = [];

    if (entityTables.length > 0) {
        const aboutDeletedRows = entityTables
            .map((table) => `t.entity_id IN (SELECT t.id FROM ${quoteIdent(table.name)} t WHERE ${entityPredicates.get(table.name)})`)
            .join(' OR ');

        for (const [table, where] of [
            ['outbox_events', `t.processed_at IS NULL AND t.entity_id IS NOT NULL AND (${aboutDeletedRows})`],
            ['notifications', `t.entity_id IS NOT NULL AND (${aboutDeletedRows})`]
        ]) {
            if (tableNames.has(table)) {
                addRoot(table, where);
                serviceRoots.push({ table, where });
            }
        }
    }

    // Phase 2: everything, including the files and the service rows.
    const predicates = deletionPredicates(foreignKeys, roots);

    const deletes = [];
    for (const [table, predicate] of [...predicates].sort(([a], [b]) => a.localeCompare(b))) {
        const n = await countOf(client, `SELECT count(*)::int AS n FROM ${quoteIdent(table)} t WHERE ${predicate}`);
        if (n > 0) deletes.push({ table, n });
    }

    const blocks = [];
    const unlinks = [];

    for (const { kind, key, sql } of danglingReferenceQueries(foreignKeys, predicates)) {
        const n = await countOf(client, sql);
        if (n === 0) continue;

        const where = `${key.child}.${key.childColumns.join(',')} -> ${key.parent}`;

        if (kind === 'restrict') {
            const hint = RESTRICT_HINTS[key.child];
            blocks.push(
                `${n} row(s) in ${where} would be left pointing at deleted rows (ON DELETE ${key.onDelete})` +
                    (hint && !scopeNames.includes(hint) ? ` — if they are demo/seed data, add \`${hint}\`` : ' — these are not seed data')
            );
        } else if (key.child in BLOCKING_UNLINKS) {
            const hint = BLOCKING_UNLINKS[key.child];
            blocks.push(
                `${n} row(s) in ${where} would silently lose their link (ON DELETE SET NULL)` +
                    (hint && !scopeNames.includes(hint) ? ` — if they are seed data, add \`${hint}\`` : ' — these are not seed data')
            );
        } else {
            unlinks.push({ where, n });
        }
    }

    const running = new Set(scopeNames);

    for (const name of scopeNames) {
        for (const check of scopes[name].checks) {
            const n = await countOf(client, check.sql);
            if (n > 0) blocks.push(`[${name}] ${check.message(n)}`);
        }
    }

    const updates = [];
    const notes = [];
    const nearbyEdits = [];

    for (const name of scopeNames) {
        for (const update of scopes[name].updates) {
            const n = await countOf(client, `SELECT count(*)::int AS n FROM ${quoteIdent(update.table)} t WHERE ${update.where}`);
            if (n > 0) updates.push({ ...update, n, scope: name });
        }

        for (const note of scopes[name].notes ?? []) {
            const n = await countOf(client, note.sql);
            if (n > 0) notes.push(`[${name}] ${note.message(n)}`);
        }

        if (scopes[name].nearby && !running.has('hotels')) {
            const { rows } = await client.query(
                `SELECT id, slug, nearby FROM hotels WHERE slug = ANY(${list(Object.keys(scopes[name].nearby))})`
            );

            for (const hotel of rows) {
                const seeded = scopes[name].nearby[hotel.slug] ?? [];
                const current = Array.isArray(hotel.nearby) ? hotel.nearby : [];
                const kept = current.filter((place) => !seeded.some((seed) => seed.name === place?.name && seed.kind === place?.kind));

                if (kept.length !== current.length) {
                    nearbyEdits.push({ id: hotel.id, slug: hotel.slug, nearby: kept, removed: current.length - kept.length });
                }
            }
        }
    }

    const folders = new Map();
    for (const asset of assets) folders.set(folderOf(asset.object_key), asset.visibility);

    return { deletes, blocks, unlinks, updates, notes, nearbyEdits, serviceRoots, folders, roots };
};

// --- output ------------------------------------------------------------------------

const printTable = (rows) => {
    const width = Math.max(10, ...rows.map((row) => row.label.length));
    for (const row of rows) console.log(`  ${row.label.padEnd(width)}  ${String(row.n).padStart(8)}`);
};

const printPlan = (plan) => {
    const total = plan.deletes.reduce((sum, row) => sum + row.n, 0);

    console.log(`\nRows to delete (${total} in ${plan.deletes.length} tables, cascades included):`);
    if (plan.deletes.length === 0) console.log('  nothing — these scopes are already empty');
    printTable(plan.deletes.map((row) => ({ label: row.table, n: row.n })));

    if (plan.updates.length > 0 || plan.nearbyEdits.length > 0) {
        console.log('\nRows to change:');
        printTable([
            ...plan.updates.map((update) => ({ label: update.label, n: update.n })),
            ...(plan.nearbyEdits.length > 0
                ? [{ label: `hotels.nearby: seeded places removed (${plan.nearbyEdits.length} hotels)`, n: plan.nearbyEdits.reduce((sum, edit) => sum + edit.removed, 0) }]
                : [])
        ]);
    }

    if (plan.unlinks.length > 0) {
        console.log('\nRows that stay but lose a link (ON DELETE SET NULL):');
        printTable(plan.unlinks.map((row) => ({ label: row.where, n: row.n })));
    }

    console.log(`\nFiles to remove from storage (${config.media.driver}): ${plan.folders.size} asset folder(s)`);

    for (const note of plan.notes) console.log(`\nNote: ${note}`);

    if (plan.blocks.length > 0) {
        console.log('\nBLOCKED — nothing will be deleted:');
        for (const block of plan.blocks) console.log(`  ✗ ${block}`);
    }
};

// --- files -------------------------------------------------------------------------

const removeFolders = async (folders) => {
    const entries = [...folders];
    const failures = [];
    let next = 0;

    const worker = async () => {
        while (next < entries.length) {
            const [prefix, visibility] = entries[(next += 1) - 1];

            try {
                await removeObjectPrefix({ prefix, visibility });
            } catch (err) {
                failures.push({ prefix, visibility, error: err?.message ?? String(err) });
            }
        }
    };

    await Promise.all(Array.from({ length: Math.min(FILE_CONCURRENCY, entries.length) }, worker));

    console.log(`\nStorage: ${entries.length - failures.length} of ${entries.length} asset folder(s) removed.`);

    if (failures.length > 0) {
        console.error(`\n${failures.length} folder(s) could not be removed — the database is already cleared; delete these by hand:`);
        for (const failure of failures) console.error(`  ${failure.visibility} ${failure.prefix}: ${failure.error}`);
        return EXIT.filesLeft;
    }

    return EXIT.ok;
};

// --- runs --------------------------------------------------------------------------

const withTransaction = async (client, { readOnly }, work) => {
    await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');

    try {
        await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
        await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
        const result = await work();
        await client.query(readOnly || !result?.commit ? 'ROLLBACK' : 'COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    }
};

const runScopes = async (client, options, resolved, guard) => {
    const keys = await loadSeedKeys();
    const scopes = defineScopes(keys, new Set(resolved.scopes));

    for (const skip of resolved.skipped) console.log(`Skipping ${skip.scope}: ${skip.reason}`);
    console.log(`Scopes, in order: ${resolved.scopes.join(' → ')}`);

    if (!options.yes) {
        const plan = await withTransaction(client, { readOnly: true }, () => buildPlan(client, resolved.scopes, scopes));
        printPlan(plan);
        console.log(`\nDry run — nothing was changed.${plan.blocks.length === 0 ? ' Re-run with --yes to delete.' : ''}`);
        return plan.blocks.length > 0 ? EXIT.refused : EXIT.ok;
    }

    if (guard) {
        console.error(`\nRefused: ${guard}`);
        return EXIT.refused;
    }

    const outcome = await withTransaction(client, { readOnly: false }, async () => {
        const plan = await buildPlan(client, resolved.scopes, scopes);
        printPlan(plan);

        if (plan.blocks.length > 0) {
            return { commit: false, plan };
        }

        // Service rows first: they are found through the rows about to go.
        for (const { table, where } of plan.serviceRoots) {
            await client.query(`DELETE FROM ${quoteIdent(table)} AS t WHERE ${where}`);
        }

        for (const name of resolved.scopes) {
            for (const update of plan.updates.filter((row) => row.scope === name)) {
                await client.query(`UPDATE ${quoteIdent(update.table)} AS t SET ${update.set} WHERE ${update.where}`);
            }

            if (scopes[name].nearby) {
                for (const edit of plan.nearbyEdits) {
                    await client.query('UPDATE hotels SET nearby = $1::jsonb, updated_at = now() WHERE id = $2', [JSON.stringify(edit.nearby), edit.id]);
                }
            }

            for (const root of scopes[name].roots) {
                await client.query(`DELETE FROM ${quoteIdent(root.table)} AS t WHERE ${root.where}`);
            }
        }

        const assetRoot = plan.roots.get('file_assets');
        if (assetRoot) {
            await client.query(`DELETE FROM file_assets AS t WHERE ${assetRoot.map((where) => `(${where})`).join(' OR ')}`);
        }

        // Nothing the plan named may still be there.
        for (const [table, wheres] of plan.roots) {
            const left = await countOf(client, `SELECT count(*)::int AS n FROM ${quoteIdent(table)} t WHERE ${wheres.map((w) => `(${w})`).join(' OR ')}`);
            if (left > 0) throw new Error(`${left} row(s) in ${table} survived the delete; rolled back`);
        }

        return { commit: true, plan };
    });

    if (!outcome.commit) {
        console.error('\nNothing was deleted.');
        return EXIT.refused;
    }

    console.log('\nDatabase: committed.');
    return removeFolders(outcome.plan.folders);
};

const runDatabase = async (client, options, guard) => {
    const tables = await readTables(client);

    const survey = async () => {
        const counts = [];
        for (const { name } of tables) counts.push({ label: name, n: await countOf(client, `SELECT count(*)::int AS n FROM ${quoteIdent(name)}`) });

        const names = new Set(tables.map((table) => table.name));
        const folders = new Map();

        if (names.has('file_assets')) {
            const { rows } = await client.query(
                `SELECT object_key, visibility::text AS visibility FROM file_assets` +
                    (names.has('image_variants')
                        ? ` UNION ALL SELECT v.object_key, a.visibility::text FROM image_variants v JOIN file_assets a ON a.id = v.file_asset_id`
                        : '')
            );
            for (const row of rows) folders.set(folderOf(row.object_key), row.visibility);
        }

        return { counts, folders };
    };

    const print = ({ counts, folders }) => {
        const nonEmpty = counts.filter((row) => row.n > 0);
        console.log(`\nEvery row in ${tables.length} tables will be deleted (${counts.reduce((sum, row) => sum + row.n, 0)} rows; ${tables.length - nonEmpty.length} tables already empty):`);
        printTable(nonEmpty);
        console.log(`\nFiles to remove from storage (${config.media.driver}): ${folders.size} asset folder(s)`);
        console.log('\nKept: the schema, _prisma_migrations, extension tables (e.g. spatial_ref_sys).');
        console.log('WARNING: this deletes every user, administrators included, and ends every session.');
    };

    if (!options.yes) {
        print(await withTransaction(client, { readOnly: true }, survey));
        console.log('\nDry run — nothing was changed.');
        return EXIT.ok;
    }

    if (guard) {
        console.error(`\nRefused: ${guard}`);
        return EXIT.refused;
    }

    const outcome = await withTransaction(client, { readOnly: false }, async () => {
        const surveyed = await survey();
        print(surveyed);

        await client.query(`TRUNCATE TABLE ${tables.map((table) => quoteIdent(table.name)).join(', ')} RESTART IDENTITY CASCADE`);

        for (const { name } of tables) {
            if ((await countOf(client, `SELECT count(*)::int AS n FROM ${quoteIdent(name)}`)) > 0) {
                throw new Error(`${name} is not empty after TRUNCATE; rolled back`);
            }
        }

        return { commit: true, folders: surveyed.folders };
    });

    console.log('\nDatabase: every table emptied and committed.');
    const code = await removeFolders(outcome.folders);
    console.log('\nNext: npm run seed:all -- --admin you@example.com   (or node scripts/create-admin.js ...)');

    return code;
};

const USAGE = `Usage: node scripts/clear-data.js <scope[,scope...]> [--yes] [--confirm <database>] [--wipe-production]

Scopes: demo-bookings, demo-fleet, packages, hotels, kosher, tours, services, transfers,
        catalogue (all of the above), database (every table; on its own)

Without --yes nothing is changed: the run only reports what it would do.
Deployed environments need --confirm <database name>; \`database\` always does,
and on a deployed environment also --wipe-production.`;

const main = async () => {
    let options;

    try {
        options = parseArgs(process.argv.slice(2));
    } catch (err) {
        if (err instanceof UsageError) {
            console.error(`${err.message}\n\n${USAGE}`);
            return EXIT.refused;
        }
        throw err;
    }

    if (options.help) {
        console.log(USAGE);
        return EXIT.ok;
    }

    const resolved = resolveScopes(options.scopes);
    const client = new pg.Client({ connectionString: config.databaseUrl });
    await client.connect();

    try {
        const { rows: [database] } = await client.query('SELECT current_database() AS name');
        const url = new URL(config.databaseUrl);

        console.log(`Database:  ${database.name} on ${url.hostname}${url.port ? `:${url.port}` : ''}`);
        console.log(`NODE_ENV:  ${config.nodeEnv}${config.isDeployed ? ' (deployed)' : ''}`);
        console.log(`Storage:   ${config.media.driver} (public ${config.media.publicBucket}, private ${config.media.privateBucket})`);
        console.log(`Mode:      ${options.yes ? 'DELETE' : 'dry run'}\n`);

        const guard = refusalReason({
            mode: resolved.mode,
            yes: options.yes,
            confirm: options.confirm,
            wipeProduction: options.wipeProduction,
            isDeployed: config.isDeployed,
            databaseName: database.name
        });

        return resolved.mode === DATABASE
            ? await runDatabase(client, options, guard)
            : await runScopes(client, options, resolved, guard);
    } finally {
        await client.end().catch(() => {});
    }
};

try {
    process.exitCode = await main();
} catch (err) {
    if (err instanceof UsageError) {
        console.error(err.message);
    } else if (err?.code === '55P03') {
        console.error(`\nA table stayed locked for more than ${LOCK_TIMEOUT} (lock_timeout) — something else is using it. Nothing was changed; try again when the site is quiet.`);
    } else {
        console.error(`\nFailed, nothing was changed: ${err?.message ?? err}`);
    }
    process.exitCode = EXIT.refused;
}
