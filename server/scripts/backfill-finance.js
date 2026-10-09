import { prisma, disconnect } from '../db/index.js';
import { FINANCE_PRODUCTS, syncBookingInTx, syncOrderReceivableInTx } from '../services/finance/ledger.service.js';

/**
 * Gives bookings confirmed before the finance module existed their payables
 * and receivables.
 *
 *   node scripts/backfill-finance.js                      # dry run: counts only
 *   node scripts/backfill-finance.js --apply              # write
 *   node scripts/backfill-finance.js --apply --since 2026-09-01
 *
 * Runs the same sync functions the booking services call, so a backfilled
 * booking ends up exactly where one confirmed today would — same terms, same
 * cancellation rules — with `source: BACKFILL` so Finance can tell them apart.
 * Idempotent: a booking that already has its rows is left alone, so it can be
 * re-run after a failure.
 *
 * Dry run by default, and `--since` exists for a reason: due dates are worked
 * out from the confirmation date, so a year of history backfilled at once is a
 * year of receivables that read as overdue. Backfill the bookings Finance will
 * actually chase, and record what was settled before by hand.
 */
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const sinceIndex = args.indexOf('--since');
const since = sinceIndex >= 0 ? args[sinceIndex + 1] : null;

if (sinceIndex >= 0 && !/^\d{4}-\d{2}-\d{2}$/.test(since ?? '')) {
    console.error('Usage: node scripts/backfill-finance.js [--apply] [--since YYYY-MM-DD]');
    process.exit(1);
}

const MODELS = { HOTEL: 'hotelBooking', TRANSFER: 'transferBooking', TOUR: 'tourBooking', SERVICE: 'serviceBooking' };
const BATCH = 200;
const confirmedSince = since ? { gte: new Date(`${since}T00:00:00Z`) } : { not: null };

const run = async () => {
    const totals = {};

    for (const product of FINANCE_PRODUCTS) {
        const model = MODELS[product];
        // Missing either side: no payable, or (standalone) no receivable —
        // except a free cancellation, where the buyer owes nothing and so
        // correctly has no receivable at all.
        const where = {
            confirmedAt: confirmedSince,
            status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] },
            OR: [
                { payable: null },
                {
                    receivable: null,
                    orderItem: null,
                    NOT: { status: 'CANCELLED', OR: [{ cancellationChargeCents: null }, { cancellationChargeCents: 0 }] }
                }
            ]
        };

        const count = await prisma[model].count({ where });
        totals[product] = { candidates: count, payables: 0, receivables: 0, failed: 0 };

        if (!apply || count === 0) continue;

        let cursor;

        for (;;) {
            const batch = await prisma[model].findMany({
                where,
                select: { id: true, reference: true },
                orderBy: { id: 'asc' },
                take: BATCH,
                ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
            });

            if (batch.length === 0) break;
            cursor = batch.at(-1).id;

            for (const booking of batch) {
                try {
                    const { payable, receivable } = await prisma.$transaction((tx) =>
                        syncBookingInTx(tx, product, booking.id, null, null, { source: 'BACKFILL' })
                    );
                    if (payable?.source === 'BACKFILL') totals[product].payables += 1;
                    if (receivable?.source === 'BACKFILL') totals[product].receivables += 1;
                } catch (err) {
                    totals[product].failed += 1;
                    console.error(`  ${booking.reference}: ${err.message}`);
                }
            }

            if (batch.length < BATCH) break;
        }
    }

    const orderWhere = { confirmedAt: confirmedSince, receivable: null };
    const orderCount = await prisma.order.count({ where: orderWhere });
    totals.ORDER = { candidates: orderCount, payables: 0, receivables: 0, failed: 0 };

    if (apply) {
        for (const order of await prisma.order.findMany({ where: orderWhere, select: { id: true, reference: true } })) {
            try {
                const receivable = await prisma.$transaction((tx) => syncOrderReceivableInTx(tx, order.id, null, null, { source: 'BACKFILL' }));
                if (receivable?.source === 'BACKFILL') totals.ORDER.receivables += 1;
            } catch (err) {
                totals.ORDER.failed += 1;
                console.error(`  ${order.reference}: ${err.message}`);
            }
        }
    }

    console.log(apply ? 'Backfilled finance records' : 'Dry run — nothing written. Re-run with --apply to write.');
    console.log(since ? `Bookings confirmed since ${since}` : 'All confirmed bookings');
    console.table(totals);

    if (Object.values(totals).some((row) => row.failed > 0)) {
        process.exitCode = 1;
    }
};

run()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(disconnect);
