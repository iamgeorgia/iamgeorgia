import { randomBytes } from 'node:crypto';

import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { ConflictError, GoneError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { dateOnlyToUtc, toDateOnly } from '../../lib/time.js';
import { moveCounterUnits } from '../../lib/inventory/counter.js';

/**
 * Claiming tour inventory.
 *
 * The twin of `services/hotel/availability.service.js`, over `tour_inventory`
 * and `tour_holds`, and built on the same idea: never read availability and
 * then write it. The one statement both share lives in
 * `lib/inventory/counter.js`; what differs here is only that a tour claims
 * **one date** — the departure — however many days it lasts, because an
 * operator's capacity is "how many groups start on Monday", not per night.
 *
 * `held_units` and `booked_units` are counters, so the same CHECK constraint,
 * the same sweeper and the same reconciler keep them honest.
 */

const moveUnits = (tx, { tourOptionId, date, quantity, from, to, requireAvailable }) =>
    moveCounterUnits(tx, {
        table: 'tour_inventory',
        keyId: tourOptionId,
        dates: [dateOnlyToUtc(date)],
        quantity,
        from,
        to,
        requireAvailable
    });

/**
 * Takes a hold on a departure, inside the caller's transaction.
 *
 * `offer.units` is inventory units — seats for a SEAT option, one for a
 * GROUP option — worked out by the pricing engine so callers never think
 * about it.
 */
export const createTourHoldIn = async (tx, { offer, quote, actor, ttlMs = config.tour.holdTtlMs }) => {
    const { claimed } = await moveUnits(tx, {
        tourOptionId: offer.tourOptionId,
        date: offer.date,
        quantity: offer.units,
        to: 'held',
        requireAvailable: true
    });

    if (claimed.length !== 1) {
        throw new ConflictError('That departure is no longer available', {
            reason: 'UNAVAILABLE',
            unavailable: [offer.date]
        });
    }

    return tx.tourHold.create({
        data: {
            token: randomBytes(24).toString('base64url'),
            tourOptionId: offer.tourOptionId,
            date: dateOnlyToUtc(offer.date),
            quantity: offer.units,
            adults: offer.adults,
            childAges: offer.childAges ?? [],
            quotedNetCents: quote.totals.netCents,
            quotedSellCents: quote.totals.totalCents,
            currency: quote.currency,
            expiresAt: new Date(Date.now() + ttlMs),
            createdByUserId: actor?.id ?? null,
            partnerId: actor?.partnerId ?? null
        }
    });
};

export const createTourHold = (args) => prisma.$transaction((tx) => createTourHoldIn(tx, args));

/** Reads a hold and refuses it if it is not usable. */
export const findUsableTourHold = async (client, token) => {
    const hold = await client.tourHold.findUnique({ where: { token } });

    if (!hold) {
        throw new NotFoundError('That hold no longer exists');
    }

    if (hold.status === 'COMMITTED') {
        throw new ConflictError('That hold has already been used', { reason: 'ALREADY_COMMITTED' });
    }

    if (hold.status !== 'ACTIVE' || hold.expiresAt <= new Date()) {
        throw new GoneError('That hold has expired. Search again for current prices.', {
            reason: 'HOLD_EXPIRED'
        });
    }

    return hold;
};

/** held -> booked, inside the caller's transaction. */
export const commitTourHold = async (tx, hold, bookingId) => {
    const { claimed } = await moveUnits(tx, {
        tourOptionId: hold.tourOptionId,
        date: toDateOnly(hold.date),
        quantity: hold.quantity,
        from: 'held',
        to: 'booked'
    });

    if (claimed.length !== 1) {
        throw new ConflictError('This hold could not be confirmed', { reason: 'HOLD_INCONSISTENT' });
    }

    return tx.tourHold.update({
        where: { id: hold.id },
        data: { status: 'COMMITTED', bookingId }
    });
};

/** Gives the units back. Used by explicit release and by the sweeper. */
export const releaseTourHold = async (tx, hold, status = 'RELEASED') => {
    await moveUnits(tx, {
        tourOptionId: hold.tourOptionId,
        date: toDateOnly(hold.date),
        quantity: hold.quantity,
        from: 'held'
    });

    return tx.tourHold.update({ where: { id: hold.id }, data: { status } });
};

export const releaseTourHoldByToken = async (token) =>
    prisma.$transaction(async (tx) => {
        const hold = await tx.tourHold.findUnique({ where: { token } });

        if (!hold || hold.status !== 'ACTIVE') {
            return null;
        }

        return releaseTourHold(tx, hold);
    });

/** booked -> released, when a booking is cancelled or declined. */
export const releaseBookedTourUnits = (tx, { tourOptionId, date, quantity }) =>
    moveUnits(tx, { tourOptionId, date: toDateOnly(date), quantity, from: 'booked' });

/**
 * Returns expired holds to the pool. Same advisory-lock discipline as the
 * hotel sweeper, under its own key so the two never contend.
 */
export const sweepExpiredTourHolds = async ({ limit = 200 } = {}) => {
    const [{ locked }] = await prisma.$queryRaw`
        SELECT pg_try_advisory_lock(hashtext('tour_hold_sweep')) AS locked
    `;

    if (!locked) {
        return { swept: 0, skipped: true };
    }

    try {
        const expired = await prisma.tourHold.findMany({
            where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
            take: limit,
            orderBy: { expiresAt: 'asc' }
        });

        let swept = 0;

        for (const hold of expired) {
            await prisma
                .$transaction(async (tx) => {
                    const current = await tx.tourHold.findUnique({ where: { id: hold.id } });

                    if (!current || current.status !== 'ACTIVE') {
                        return;
                    }

                    await releaseTourHold(tx, current, 'EXPIRED');
                    swept += 1;
                })
                .catch((err) => logger.warn({ err, holdId: hold.id }, 'Could not release an expired tour hold'));
        }

        return { swept, skipped: false };
    } finally {
        await prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext('tour_hold_sweep'))`;
    }
};

/**
 * Proves the counters agree with the rows they summarise, and repairs them
 * when asked. A PENDING booking holds its units: an on-request departure that
 * is still being answered must not be sold twice meanwhile. So does one
 * PENDING_APPROVAL (OD1): its seats are claimed when it is made, so that a
 * yes never finds them gone — leaving it out showed it as drift, and `apply`
 * then handed its seats back to sale.
 */
export const reconcileTourInventory = async ({ apply = false, tourOptionIds = null } = {}) => {
    const drift = await prisma.$queryRaw`
        WITH expected AS (
            SELECT inv.tour_option_id,
                   inv.date,
                   inv.held_units,
                   inv.booked_units,
                   COALESCE((
                       SELECT sum(h.quantity)::int FROM tour_holds h
                        WHERE h.tour_option_id = inv.tour_option_id
                          AND h.status = 'ACTIVE'
                          AND h.expires_at > now()
                          AND h.date = inv.date
                   ), 0) AS expected_held,
                   COALESCE((
                       SELECT sum(b.units)::int FROM tour_bookings b
                        WHERE b.tour_option_id = inv.tour_option_id
                          AND b.status IN ('PENDING_APPROVAL', 'PENDING', 'CONFIRMED', 'COMPLETED')
                          AND b.date = inv.date
                   ), 0) AS expected_booked
              FROM tour_inventory inv
             WHERE (${tourOptionIds}::text[] IS NULL OR inv.tour_option_id = ANY(${tourOptionIds}::text[]))
        )
        SELECT tour_option_id AS "tourOptionId", date,
               held_units AS "heldUnits", expected_held AS "expectedHeld",
               booked_units AS "bookedUnits", expected_booked AS "expectedBooked"
          FROM expected
         WHERE held_units <> expected_held OR booked_units <> expected_booked
         ORDER BY tour_option_id, date
         LIMIT 500
    `;

    if (apply && drift.length > 0) {
        await prisma.$transaction(
            drift.map((row) =>
                prisma.tourInventory.update({
                    where: { tourOptionId_date: { tourOptionId: row.tourOptionId, date: row.date } },
                    data: { heldUnits: row.expectedHeld, bookedUnits: row.expectedBooked }
                })
            )
        );
    }

    return {
        drift: drift.map((row) => ({
            tourOptionId: row.tourOptionId,
            date: toDateOnly(row.date),
            heldUnits: row.heldUnits,
            expectedHeld: row.expectedHeld,
            bookedUnits: row.bookedUnits,
            expectedBooked: row.expectedBooked
        })),
        repaired: apply ? drift.length : 0
    };
};

/** Records a sweep in the trail when it actually did something. */
export const auditTourSweep = async (swept, actor = null) => {
    if (swept === 0) {
        return null;
    }

    return recordAudit(prisma, {
        action: 'TOUR_HOLD_EXPIRED',
        actor,
        entityType: AUDIT_ENTITY.tourBooking,
        entityId: 'sweeper',
        summary: `Released ${swept} expired tour hold(s)`,
        metadata: { swept }
    });
};
