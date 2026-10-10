import { Prisma } from '../../generated/prisma/client.ts';
import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { TOPICS } from '../../lib/outbox.js';

/**
 * Supplier payment reminders and overdue alerts, by the clock.
 *
 * Three things are looked for on every sweep:
 *
 *   1. An instalment whose due day is `offset` calendar days away or nearer,
 *      for each configured offset (7, 3, 1, 0 by default). Each (instalment,
 *      offset) is claimed by inserting one `payable_reminders` row, and the
 *      unique pair is what makes a reminder fire once however many sweepers
 *      run and whether or not they hold the advisory lock. Several offsets
 *      claimed for one instalment in one sweep — a payable backfilled four
 *      days before its due day claims 7 and 3 together — collapse to one
 *      event carrying the smallest.
 *   2. An instalment whose due time has passed: `overdue_alert_at` is stamped
 *      in the statement that selects it, and stamped again once it is older
 *      than `overdueRepeatDays`, which is what makes the alert repeat while
 *      the money is still owed.
 *   3. A receivable whose due time has passed, the same way.
 *
 * "Days before" is counted on the calendar in the payable's own timezone,
 * not in multiples of 24 hours from the instant: an instalment due at 10:00
 * on the 17th is "due today" from midnight on the 17th in Tbilisi, which is
 * when a person would expect the nudge, and "7 days away" from midnight on
 * the 10th. The instants stored on the rows are compared as instants.
 *
 * Paid, voided and waived rows match no predicate, so settling an instalment
 * is what stops its reminders; the handlers re-read before writing as well,
 * for the event that was claimed a moment before the payment landed.
 */

const DAY_MS = 86_400_000;

const enqueueAll = (tx, topic, rows, { entityType, entityId, payload }) =>
    rows.length === 0
        ? Promise.resolve()
        : tx.outboxEvent.createMany({
              data: rows.map((row) => ({ topic, payload: payload(row), entityType, entityId: entityId(row) }))
          });

/** The smallest offset claimed per instalment: one event per instalment per sweep. */
const collapseByInstalment = (claimed) => {
    const smallest = new Map();

    for (const { instalment_id: instalmentId, offset_days: offsetDays } of claimed) {
        const seen = smallest.get(instalmentId);
        if (seen === undefined || offsetDays < seen) smallest.set(instalmentId, offsetDays);
    }

    return [...smallest].map(([instalmentId, offsetDays]) => ({ instalmentId, offsetDays }));
};

export const sweepFinanceReminders = ({ now = new Date() } = {}) =>
    prisma.$transaction(async (tx) => {
        // Transaction-scoped, released with the commit on the connection that
        // took it. The reminder claims below are safe without it; the lock
        // keeps two instances from doing the same work and one of them
        // finding nothing.
        const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('finance_reminders')) AS locked`;

        if (!locked) {
            return { skipped: true, reminders: 0, events: 0, overdue: 0, receivablesOverdue: 0 };
        }

        // An ISO string with its zone rather than the Date itself, so the
        // calendar arithmetic cannot depend on the session's TimeZone setting.
        const nowIso = now.toISOString();
        const claimed = [];

        for (const offsetDays of config.finance.reminderOffsetDays) {
            const rows = await tx.$queryRaw`
                INSERT INTO payable_reminders (id, instalment_id, offset_days, sent_at)
                SELECT gen_random_uuid()::text, i.id, ${offsetDays}::int, ${now}::timestamp
                  FROM payable_instalments i
                  JOIN supplier_payables p ON p.id = i.payable_id
                 WHERE i.status IN ('OPEN', 'PARTIAL')
                   AND p.status IN ('OPEN', 'PARTIAL')
                   AND i.due_at IS NOT NULL
                   AND i.due_at > ${now}
                   AND ((i.due_at AT TIME ZONE 'UTC') AT TIME ZONE p.timezone)::date
                       - ((${nowIso}::timestamptz) AT TIME ZONE p.timezone)::date <= ${offsetDays}::int
                ON CONFLICT (instalment_id, offset_days) DO NOTHING
                RETURNING instalment_id, offset_days
            `;

            claimed.push(...rows);
        }

        const due = collapseByInstalment(claimed);

        if (due.length > 0) {
            const instalments = await tx.payableInstalment.findMany({
                where: { id: { in: due.map((row) => row.instalmentId) } },
                select: { id: true, payableId: true }
            });
            const payableOf = new Map(instalments.map((row) => [row.id, row.payableId]));

            await enqueueAll(tx, TOPICS.PAYABLE_INSTALMENT_DUE, due, {
                entityType: 'SupplierPayable',
                entityId: (row) => payableOf.get(row.instalmentId) ?? null,
                payload: (row) => ({ payableId: payableOf.get(row.instalmentId) ?? null, instalmentId: row.instalmentId, offsetDays: row.offsetDays })
            });
        }

        // The alert fires when the due time passes, and again once the last
        // alert is older than the repeat interval. With repeats off, only
        // a never-alerted row qualifies.
        const repeatBefore = config.finance.overdueRepeatDays > 0 ? new Date(now.getTime() - config.finance.overdueRepeatDays * DAY_MS) : null;
        const repeat = (column) => (repeatBefore ? Prisma.sql`OR ${column} <= ${repeatBefore}` : Prisma.empty);

        const overdue = await tx.$queryRaw`
            UPDATE payable_instalments i
               SET overdue_alert_at = ${now}
              FROM supplier_payables p
             WHERE p.id = i.payable_id
               AND i.status IN ('OPEN', 'PARTIAL')
               AND p.status IN ('OPEN', 'PARTIAL')
               AND i.due_at IS NOT NULL
               AND i.due_at < ${now}
               AND (i.overdue_alert_at IS NULL ${repeat(Prisma.sql`i.overdue_alert_at`)})
         RETURNING i.id, i.payable_id
        `;

        await enqueueAll(tx, TOPICS.PAYABLE_INSTALMENT_OVERDUE, overdue, {
            entityType: 'SupplierPayable',
            entityId: (row) => row.payable_id,
            payload: (row) => ({ payableId: row.payable_id, instalmentId: row.id })
        });

        const receivables = await tx.$queryRaw`
            UPDATE receivables r
               SET overdue_alert_at = ${now}
             WHERE r.status IN ('OPEN', 'PARTIAL')
               AND r.due_at IS NOT NULL
               AND r.due_at < ${now}
               AND (r.overdue_alert_at IS NULL ${repeat(Prisma.sql`r.overdue_alert_at`)})
         RETURNING r.id
        `;

        await enqueueAll(tx, TOPICS.RECEIVABLE_OVERDUE, receivables, {
            entityType: 'Receivable',
            entityId: (row) => row.id,
            payload: (row) => ({ receivableId: row.id })
        });

        return { reminders: claimed.length, events: due.length, overdue: overdue.length, receivablesOverdue: receivables.length };
    });

// --- What is due -------------------------------------------------------------------
//
// The queue the reminders are about, for the overview widget and the badge:
// everything overdue, plus what falls due within `days`. Read directly, not
// from the reminder rows, so the screen and the badge agree with the ledger
// even for an instalment the sweeper has not reached yet.

const SETTLEABLE = ['OPEN', 'PARTIAL'];

const dueInstalmentsWhere = (horizon) => ({
    status: { in: SETTLEABLE },
    dueAt: { lte: horizon },
    payable: { status: { in: SETTLEABLE } }
});

const dueReceivablesWhere = (horizon) => ({ status: { in: SETTLEABLE }, dueAt: { lte: horizon } });

const horizonFor = (days, now) => new Date(now.getTime() + days * DAY_MS);

/** The sidebar badge: instalments due within `days`, overdue ones included. */
export const countDueInstalments = ({ days = 7, now = new Date() } = {}) =>
    prisma.payableInstalment.count({ where: dueInstalmentsWhere(horizonFor(days, now)) });

/** Both sides of the queue; either may be left out for a viewer who may not read it. */
export const listDue = async ({ days = 7, now = new Date(), instalments = true, receivables = true, limit = 200 } = {}) => {
    const horizon = horizonFor(days, now);

    const [dueInstalments, dueReceivables] = await Promise.all([
        instalments
            ? prisma.payableInstalment.findMany({
                  where: dueInstalmentsWhere(horizon),
                  include: { payable: { include: { supplierPartner: { select: { id: true, name: true, reference: true } } } } },
                  orderBy: [{ dueAt: 'asc' }, { sequence: 'asc' }],
                  take: limit
              })
            : null,
        receivables
            ? prisma.receivable.findMany({
                  where: dueReceivablesWhere(horizon),
                  include: { debtorPartner: { select: { id: true, name: true, reference: true } } },
                  orderBy: { dueAt: 'asc' },
                  take: limit
              })
            : null
    ]);

    return { days, asOf: now, horizon, instalments: dueInstalments, receivables: dueReceivables };
};
