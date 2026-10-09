import { Prisma } from '../../generated/prisma/client.ts';
import { prisma } from '../../db/index.js';
import { recordAudit } from '../../lib/audit.js';

/**
 * Finance reports: a summary of what is open, the margin over a period, and
 * how old the open items are.
 *
 * Every figure is per currency and nothing is converted (owner decision D8):
 * a report that added lari to dollars would print a number that is nothing.
 * Aggregated in Postgres, not in JavaScript, so a year of bookings costs one
 * round trip per figure rather than a page of rows each.
 */

const SETTLEABLE = Prisma.sql`('OPEN', 'PARTIAL')`;
const DAY_MS = 86_400_000;

const int = (value) => Number(value ?? 0);

const currencyFilter = (column, currency) => (currency ? Prisma.sql`AND ${Prisma.raw(column)} = ${currency}` : Prisma.empty);

/**
 * The state of the books right now, per currency: what buyers owe (and how
 * much of it is late), what we owe suppliers (and how much falls due within
 * the week), and the cash that moved in the period.
 */
export const summary = async ({ currency, from, to, now = new Date() }) => {
    const inWeek = new Date(now.getTime() + 7 * DAY_MS);

    const [receivables, payables, cash] = await Promise.all([
        prisma.$queryRaw`
            SELECT currency,
                   COUNT(*) FILTER (WHERE status IN ${SETTLEABLE})::int AS "openCount",
                   COALESCE(SUM(amount_cents - paid_cents) FILTER (WHERE status IN ${SETTLEABLE}), 0)::bigint AS "openCents",
                   COALESCE(SUM(amount_cents - paid_cents) FILTER (WHERE status IN ${SETTLEABLE} AND due_at < ${now}), 0)::bigint AS "overdueCents",
                   COALESCE(SUM(GREATEST(paid_cents - amount_cents, 0)), 0)::bigint AS "refundDueCents"
              FROM receivables
             WHERE TRUE ${currencyFilter('currency', currency)}
             GROUP BY currency`,
        prisma.$queryRaw`
            SELECT p.currency,
                   COUNT(DISTINCT p.id) FILTER (WHERE p.status IN ${SETTLEABLE})::int AS "openCount",
                   COALESCE(SUM(i.amount_cents - i.paid_cents) FILTER (WHERE i.status IN ${SETTLEABLE}), 0)::bigint AS "openCents",
                   COALESCE(SUM(i.amount_cents - i.paid_cents) FILTER (WHERE i.status IN ${SETTLEABLE} AND i.due_at < ${now}), 0)::bigint AS "overdueCents",
                   COALESCE(SUM(i.amount_cents - i.paid_cents) FILTER (WHERE i.status IN ${SETTLEABLE} AND i.due_at >= ${now} AND i.due_at < ${inWeek}), 0)::bigint AS "dueThisWeekCents",
                   COUNT(DISTINCT p.id) FILTER (WHERE p.needs_review)::int AS "needsReviewCount"
              FROM supplier_payables p
              JOIN payable_instalments i ON i.payable_id = p.id
             WHERE TRUE ${currencyFilter('p.currency', currency)}
             GROUP BY p.currency`,
        prisma.$queryRaw`
            SELECT currency,
                   COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'IN' AND kind = 'PAYMENT'), 0)::bigint AS "inCents",
                   COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'OUT' AND kind = 'PAYMENT'), 0)::bigint AS "outCents",
                   COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'OUT' AND kind = 'REFUND'), 0)::bigint AS "refundsOutCents",
                   COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'IN' AND kind = 'REFUND'), 0)::bigint AS "refundsInCents"
              FROM payment_records
             WHERE paid_at >= ${from} AND paid_at <= ${to} ${currencyFilter('currency', currency)}
             GROUP BY currency`
    ]);

    const currencies = [...new Set([...receivables, ...payables, ...cash].map((row) => row.currency))].sort();
    const by = (rows, code) => rows.find((row) => row.currency === code) ?? {};

    return {
        from,
        to,
        currencies: currencies.map((code) => {
            const r = by(receivables, code);
            const p = by(payables, code);
            const c = by(cash, code);

            return {
                currency: code,
                receivables: { openCount: int(r.openCount), openCents: int(r.openCents), overdueCents: int(r.overdueCents), refundDueCents: int(r.refundDueCents) },
                payables: {
                    openCount: int(p.openCount),
                    openCents: int(p.openCents),
                    overdueCents: int(p.overdueCents),
                    dueThisWeekCents: int(p.dueThisWeekCents),
                    needsReviewCount: int(p.needsReviewCount)
                },
                cash: { inCents: int(c.inCents), outCents: int(c.outCents), refundsOutCents: int(c.refundsOutCents), refundsInCents: int(c.refundsInCents) }
            };
        })
    };
};

/**
 * What each booking earned, for bookings confirmed in the period.
 *
 * Revenue is what the buyer owes for the booking now — the full price, or the
 * cancellation charge once cancelled; cost is what the supplier is owed now.
 * A package line is counted at its own product's price: an order's package
 * discount sits on the order, not on its parts.
 */
const MARGIN_ROWS = Prisma.sql`
    SELECT 'HOTEL' AS product, b.id, b.currency, b.partner_id, b.confirmed_at,
           CASE WHEN b.status = 'CANCELLED' THEN COALESCE(b.cancellation_charge_cents, 0) ELSE b.sell_total_cents + b.tax_total_cents END AS revenue
      FROM hotel_bookings b WHERE b.confirmed_at IS NOT NULL
    UNION ALL
    SELECT 'TRANSFER', b.id, b.currency, b.partner_id, b.confirmed_at,
           CASE WHEN b.status = 'CANCELLED' THEN COALESCE(b.cancellation_charge_cents, 0) ELSE b.sell_total_cents END
      FROM transfer_bookings b WHERE b.confirmed_at IS NOT NULL
    UNION ALL
    SELECT 'TOUR', b.id, b.currency, b.partner_id, b.confirmed_at,
           CASE WHEN b.status = 'CANCELLED' THEN COALESCE(b.cancellation_charge_cents, 0) ELSE b.sell_total_cents END
      FROM tour_bookings b WHERE b.confirmed_at IS NOT NULL
    UNION ALL
    SELECT 'SERVICE', b.id, b.currency, b.partner_id, b.confirmed_at,
           CASE WHEN b.status = 'CANCELLED' THEN COALESCE(b.cancellation_charge_cents, 0) ELSE b.sell_total_cents END
      FROM service_bookings b WHERE b.confirmed_at IS NOT NULL`;

const PAYABLE_JOIN = Prisma.sql`
    LEFT JOIN supplier_payables p ON
         (m.product = 'HOTEL' AND p.hotel_booking_id = m.id)
      OR (m.product = 'TRANSFER' AND p.transfer_booking_id = m.id)
      OR (m.product = 'TOUR' AND p.tour_booking_id = m.id)
      OR (m.product = 'SERVICE' AND p.service_booking_id = m.id)`;

export const margin = async ({ from, to, currency, groupBy = 'product' }) => {
    const key =
        groupBy === 'supplier'
            ? Prisma.sql`COALESCE(p.supplier_partner_id, 'PLATFORM')`
            : groupBy === 'partner'
              ? Prisma.sql`COALESCE(m.partner_id, 'GUEST')`
              : Prisma.sql`m.product`;

    const rows = await prisma.$queryRaw`
        SELECT ${key} AS "groupKey", m.currency,
               COUNT(*)::int AS "bookings",
               COALESCE(SUM(m.revenue), 0)::bigint AS "revenueCents",
               COALESCE(SUM(p.amount_cents), 0)::bigint AS "costCents"
          FROM (${MARGIN_ROWS}) m
          ${PAYABLE_JOIN}
         WHERE m.confirmed_at >= ${from} AND m.confirmed_at <= ${to} ${currencyFilter('m.currency', currency)}
         GROUP BY 1, 2
         ORDER BY 2, 4 DESC`;

    const partnerIds = rows.map((row) => row.groupKey).filter((id) => groupBy !== 'product' && id !== 'PLATFORM' && id !== 'GUEST');
    const partners = partnerIds.length
        ? await prisma.partner.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true } })
        : [];
    const names = new Map(partners.map((partner) => [partner.id, partner.name]));

    return {
        from,
        to,
        groupBy,
        rows: rows.map((row) => {
            const revenueCents = int(row.revenueCents);
            const costCents = int(row.costCents);
            const marginCents = revenueCents - costCents;

            return {
                key: row.groupKey,
                label: names.get(row.groupKey) ?? (row.groupKey === 'PLATFORM' ? 'Platform inventory' : row.groupKey === 'GUEST' ? 'Direct guests' : row.groupKey),
                currency: row.currency,
                bookings: row.bookings,
                revenueCents,
                costCents,
                marginCents,
                marginBps: revenueCents > 0 ? Math.round((marginCents * 10_000) / revenueCents) : null
            };
        })
    };
};

const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];

/**
 * How late the open money is, per counterparty: not yet due (or undated),
 * then 1–30, 31–60, 61–90 and over 90 days past due. `side` is what buyers
 * owe us (receivables) or what we owe suppliers (payables).
 */
export const ageing = async ({ side = 'receivables', currency, asOf = new Date() }) => {
    const bucket = (dueColumn) => Prisma.sql`
        CASE
            WHEN ${Prisma.raw(dueColumn)} IS NULL OR ${Prisma.raw(dueColumn)} >= ${asOf} THEN 'current'
            WHEN ${asOf}::timestamp - ${Prisma.raw(dueColumn)} <= interval '30 days' THEN 'd1_30'
            WHEN ${asOf}::timestamp - ${Prisma.raw(dueColumn)} <= interval '60 days' THEN 'd31_60'
            WHEN ${asOf}::timestamp - ${Prisma.raw(dueColumn)} <= interval '90 days' THEN 'd61_90'
            ELSE 'd90_plus'
        END`;

    const rows =
        side === 'payables'
            ? await prisma.$queryRaw`
                SELECT COALESCE(p.supplier_partner_id, 'PLATFORM') AS "key", p.currency, ${bucket('i.due_at')} AS bucket,
                       SUM(i.amount_cents - i.paid_cents)::bigint AS cents
                  FROM payable_instalments i JOIN supplier_payables p ON p.id = i.payable_id
                 WHERE i.status IN ${SETTLEABLE} ${currencyFilter('p.currency', currency)}
                 GROUP BY 1, 2, 3`
            : await prisma.$queryRaw`
                SELECT COALESCE(debtor_partner_id, 'GUEST:' || debtor_email) AS "key", currency, ${bucket('due_at')} AS bucket,
                       SUM(amount_cents - paid_cents)::bigint AS cents
                  FROM receivables
                 WHERE status IN ${SETTLEABLE} ${currencyFilter('currency', currency)}
                 GROUP BY 1, 2, 3`;

    const partnerIds = [...new Set(rows.map((row) => row.key).filter((key) => key !== 'PLATFORM' && !key.startsWith('GUEST:')))];
    const partners = partnerIds.length
        ? await prisma.partner.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true } })
        : [];
    const names = new Map(partners.map((partner) => [partner.id, partner.name]));

    const grouped = new Map();

    for (const row of rows) {
        const id = `${row.key}|${row.currency}`;
        const entry =
            grouped.get(id) ??
            {
                key: row.key,
                label: names.get(row.key) ?? (row.key === 'PLATFORM' ? 'Platform inventory' : row.key.replace(/^GUEST:/, '')),
                currency: row.currency,
                ...Object.fromEntries(BUCKETS.map((name) => [name, 0])),
                totalCents: 0
            };
        entry[row.bucket] += int(row.cents);
        entry.totalCents += int(row.cents);
        grouped.set(id, entry);
    }

    return {
        side,
        asOf,
        buckets: BUCKETS,
        rows: [...grouped.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.totalCents - a.totalCents)
    };
};

// --- CSV -------------------------------------------------------------------------------

const cell = (value) => {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    // Quote anything a spreadsheet would misread, and defuse formula injection.
    const safe = /^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Rows as CSV with a header line, amounts already in major units by the caller. */
export const toCsv = (columns, rows) =>
    [columns.map((column) => cell(column.label)).join(','), ...rows.map((row) => columns.map((column) => cell(column.value(row))).join(','))].join('\r\n') + '\r\n';

export const recordExport = (report, query, actor, req) =>
    recordAudit(prisma, {
        action: 'FINANCE_REPORT_EXPORTED',
        actor,
        entityType: 'FinanceReport',
        entityId: report,
        summary: `Exported the ${report} report as CSV`,
        metadata: { query },
        req
    });

