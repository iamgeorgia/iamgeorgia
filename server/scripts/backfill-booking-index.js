#!/usr/bin/env node
/**
 * Builds (or rebuilds) the cross-product booking index from the product
 * tables.
 *
 *   node scripts/backfill-booking-index.js            # every booking
 *   node scripts/backfill-booking-index.js --recent   # moved in the last 36 hours
 *
 * Safe to run any time: the index is a projection, and every row is written
 * from the truth it points at. The services keep it in step afterwards; the
 * daily reconcile in server.js catches whatever they missed.
 */
import { prisma, disconnect } from '../db/index.js';
import { reconcileBookingIndex } from '../services/booking/index.service.js';

const recent = process.argv.includes('--recent');

try {
    const counts = await reconcileBookingIndex(recent ? {} : { since: null, force: true });
    const total = await prisma.bookingIndex.count();

    console.log(`Booking index ${recent ? 'reconciled' : 'rebuilt'}:`, counts, `→ ${total} rows`);
} finally {
    await disconnect();
}
