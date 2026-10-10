import { Prisma } from '../generated/prisma/client.ts';

/**
 * Row and advisory locks, for the places where two requests must take turns.
 *
 * Both are transaction-scoped: they are released when the transaction that
 * took them commits or rolls back, so there is nothing to unlock and nothing
 * that can be forgotten on an error path.
 */

/**
 * Locks the named rows with `SELECT … FOR UPDATE`, in id order, so two
 * transactions that touch the same rows wait on each other in the same
 * order and never deadlock. The table name comes from code, never input.
 */
export const lockRows = async (tx, table, ids) => {
    if (ids.length === 0) return;
    const sorted = [...new Set(ids)].sort();
    await tx.$queryRaw`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE`;
};

/**
 * Serialises on a name rather than a row: "this partner's review", "this
 * company's last owner". `$executeRaw`, not `$queryRaw`, because the lock
 * function returns void and the query path cannot deserialise that.
 */
export const lockKey = async (tx, key) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}::text))`;
};
