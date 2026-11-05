import { randomBytes } from 'node:crypto';

import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { ConflictError, GoneError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { dateOnlyToUtc, eachNight, toDateOnly } from '../../lib/time.js';
import { moveCounterUnits, nightDates } from '../../lib/inventory/counter.js';

/**
 * Claiming inventory.
 *
 * This is the file the whole module is built around, and it rests on one idea:
 * **never read availability and then write it.** A single conditional UPDATE
 * whose WHERE clause *is* the availability check is what makes overbooking
 * impossible.
 *
 *   UPDATE room_inventory SET held_units = held_units + :qty
 *    WHERE ... AND total - blocked - booked - held >= :qty
 *
 * Under READ COMMITTED, an UPDATE that meets a row locked by a concurrent
 * transaction blocks, and then **re-evaluates its WHERE clause against the
 * newly committed row**. The loser of a race therefore finds no availability,
 * matches zero rows, and rolls back. No SELECT FOR UPDATE, no SERIALIZABLE, no
 * retry loop — and the same claim-then-count-rows shape the invitation flow in
 * `partner.service.js` already uses.
 *
 * SERIALIZABLE would also be correct, but it turns every booking into a
 * candidate for a 40001 serialization failure, which means a retry loop in
 * every caller and worse throughput. Row locks give the same guarantee for
 * free.
 *
 * Beneath all of it, `room_inventory_no_oversell` is a CHECK constraint: even a
 * future writer that bypasses this file entirely raises 23514 and rolls back,
 * which `middleware/errors.js` renders as a 409.
 */

/**
 * Moves units between the four counters for every night of a stay, atomically.
 *
 * The statement itself lives in `lib/inventory/counter.js`, shared with every
 * other counter-shaped inventory; this is the room-shaped door to it. One
 * statement per room type, with the dates as an array, so two concurrent
 * claims on the same room type cannot deadlock; a booking spanning several
 * room types processes them in ascending id order for the same reason.
 */
const moveUnits = (tx, { roomTypeId, checkIn, checkOut, quantity, from, to, requireAvailable }) =>
    moveCounterUnits(tx, {
        table: 'room_inventory',
        keyId: roomTypeId,
        dates: nightDates(checkIn, checkOut),
        quantity,
        from,
        to,
        requireAvailable
    });

/**
 * Takes a hold on a room for a stay, inside the caller's transaction.
 *
 * Takes `tx` for the same reason `commitHold` does: a booking made straight
 * from an offer claims and books in one transaction, and a hold that committed
 * on its own would survive the booking rolling back — a phantom that blocks
 * the room until the sweeper finds it. It would also cost a second pool
 * connection while the first sits waiting, which is how a busy pool deadlocks
 * against itself.
 */
export const createHoldIn = async (tx, { offer, quote, actor, ttlMs = config.hotel.holdTtlMs }) => {
    const { claimed, expected } = await moveUnits(tx, {
        roomTypeId: offer.roomTypeId,
        checkIn: offer.checkIn,
        checkOut: offer.checkOut,
        quantity: offer.rooms,
        to: 'held',
        requireAvailable: true
    });

    if (claimed.length !== expected) {
        const held = new Set(claimed.map((row) => toDateOnly(row.date)));

        throw new ConflictError('Those dates are no longer available', {
            reason: 'UNAVAILABLE',
            unavailable: eachNight(offer.checkIn, offer.checkOut).filter((night) => !held.has(night))
        });
    }

    return tx.bookingHold.create({
        data: {
            token: randomBytes(24).toString('base64url'),
            roomTypeId: offer.roomTypeId,
            ratePlanId: offer.ratePlanId,
            checkIn: dateOnlyToUtc(offer.checkIn),
            checkOut: dateOnlyToUtc(offer.checkOut),
            quantity: offer.rooms,
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

/**
 * Takes a hold on a room for a stay, as its own transaction.
 *
 * Postgres only, and deliberately. The hold has to be atomic with the counter
 * it protects; a Redis lock plus a Postgres write is two systems that can
 * disagree, and a single transaction cannot.
 */
export const createHold = (args) => prisma.$transaction((tx) => createHoldIn(tx, args));

/**
 * Reads a hold and refuses it if it is not usable.
 *
 * Expiry is checked here as well as by the sweeper, because the sweeper runs on
 * an interval and a hold that expired thirty seconds ago must not be
 * committable just because nobody has tidied it up yet.
 */
export const findUsableHold = async (client, token) => {
    const hold = await client.bookingHold.findUnique({ where: { token } });

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
export const commitHold = async (tx, hold, bookingId) => {
    const { claimed, expected } = await moveUnits(tx, {
        roomTypeId: hold.roomTypeId,
        checkIn: toDateOnly(hold.checkIn),
        checkOut: toDateOnly(hold.checkOut),
        quantity: hold.quantity,
        from: 'held',
        to: 'booked'
    });

    if (claimed.length !== expected) {
        // The counters and the hold row have diverged, which should be
        // impossible. Failing loudly is the only safe response: the alternative
        // is a booking with no inventory behind it.
        throw new ConflictError('This hold could not be confirmed', { reason: 'HOLD_INCONSISTENT' });
    }

    return tx.bookingHold.update({
        where: { id: hold.id },
        data: { status: 'COMMITTED', bookingId }
    });
};

/**
 * Reports a release that did not reach every night.
 *
 * A release is best effort by design: refusing to cancel because a counter
 * has already drifted would trap the guest to protect a number that is
 * already wrong. But it must not be *silent* — the nights it missed stay
 * occupied until `reconcileInventory` recomputes them, and nobody runs that
 * for a problem they cannot see. Logged at error level with everything the
 * reconciler needs.
 */
const reportShortRelease = ({ claimed, expected }, { roomTypeId, checkIn, checkOut, quantity, from }) => {
    if (claimed.length === expected) {
        return;
    }

    const released = new Set(claimed.map((row) => toDateOnly(row.date)));

    logger.error(
        {
            roomTypeId,
            checkIn,
            checkOut,
            quantity,
            from,
            missed: eachNight(checkIn, checkOut).filter((night) => !released.has(night))
        },
        'Inventory release did not reach every night; run reconcileInventory'
    );
};

/** Gives the units back. Used by explicit release and by the sweeper. */
export const releaseHold = async (tx, hold, status = 'RELEASED') => {
    const move = {
        roomTypeId: hold.roomTypeId,
        checkIn: toDateOnly(hold.checkIn),
        checkOut: toDateOnly(hold.checkOut),
        quantity: hold.quantity,
        from: 'held'
    };

    reportShortRelease(await moveUnits(tx, move), move);

    return tx.bookingHold.update({ where: { id: hold.id }, data: { status } });
};

export const releaseHoldByToken = async (token) =>
    prisma.$transaction(async (tx) => {
        const hold = await tx.bookingHold.findUnique({ where: { token } });

        if (!hold || hold.status !== 'ACTIVE') {
            // Releasing an already-released hold is not an error: a browser
            // that abandons checkout twice should not see a failure.
            return null;
        }

        return releaseHold(tx, hold);
    });

/** booked -> released, when a booking is cancelled. */
export const releaseBookedUnits = async (tx, { roomTypeId, checkIn, checkOut, quantity }) => {
    const move = {
        roomTypeId,
        checkIn: toDateOnly(checkIn),
        checkOut: toDateOnly(checkOut),
        quantity,
        from: 'booked'
    };
    const result = await moveUnits(tx, move);

    reportShortRelease(result, move);

    return result;
};

/**
 * Returns expired holds to the pool.
 *
 * `held_units` is a counter, which is what lets the CHECK constraint see it —
 * and the cost of that choice is this: until a sweep runs, an abandoned
 * checkout still blocks its rooms. The interval is therefore the worst-case
 * delay before a room comes back, and it is deliberately short.
 *
 * A Postgres advisory lock means several application instances can all run the
 * sweeper without any of them double-decrementing.
 */
export const sweepExpiredHolds = async ({ limit = 200 } = {}) => {
    const [{ locked }] = await prisma.$queryRaw`
        SELECT pg_try_advisory_lock(hashtext('hotel_hold_sweep')) AS locked
    `;

    if (!locked) {
        return { swept: 0, skipped: true };
    }

    try {
        const expired = await prisma.bookingHold.findMany({
            where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
            take: limit,
            orderBy: { expiresAt: 'asc' }
        });

        let swept = 0;

        for (const hold of expired) {
            // One transaction per hold rather than one for the batch: a single
            // inconsistent row must not stop every other room being freed.
            await prisma
                .$transaction(async (tx) => {
                    const current = await tx.bookingHold.findUnique({ where: { id: hold.id } });

                    // Re-read inside the transaction: the hold may have been
                    // committed between the scan and now, and releasing units
                    // for a confirmed booking would oversell.
                    if (!current || current.status !== 'ACTIVE') {
                        return;
                    }

                    await releaseHold(tx, current, 'EXPIRED');
                    swept += 1;
                })
                // Best-effort by design, but not silent: a hold that cannot be
                // released on every sweep is inventory nobody can sell, and the
                // only way to notice is a log line with its id.
                .catch((err) => logger.warn({ err, holdId: hold.id }, 'Could not release an expired hold'));
        }

        return { swept, skipped: false };
    } finally {
        await prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext('hotel_hold_sweep'))`;
    }
};

/**
 * Proves the counters agree with the rows they summarise.
 *
 * `held_units` and `booked_units` are denormalised, and anything denormalised
 * eventually drifts. This recomputes both from source and reports every
 * disagreement; `apply` then repairs them. Intended as a nightly job, and used
 * by the test suite to assert that the booking path leaves no drift at all.
 * A booking waiting for the platform's approval (OD1) holds its rooms like a
 * confirmed one, so it is counted with them.
 */
export const reconcileInventory = async ({ apply = false, roomTypeIds = null } = {}) => {
    const drift = await prisma.$queryRaw`
        WITH expected AS (
            SELECT inv.room_type_id,
                   inv.date,
                   inv.held_units,
                   inv.booked_units,
                   COALESCE((
                       SELECT sum(h.quantity)::int FROM booking_holds h
                        WHERE h.room_type_id = inv.room_type_id
                          AND h.status = 'ACTIVE'
                          AND h.expires_at > now()
                          AND inv.date >= h.check_in AND inv.date < h.check_out
                   ), 0) AS expected_held,
                   -- One HotelBookingRoom *is* one room, so this is a count
                   -- rather than a sum: two rooms on one booking are two rows.
                   COALESCE((
                       SELECT count(*)::int
                         FROM hotel_booking_rooms br
                         JOIN hotel_bookings b ON b.id = br.booking_id
                        WHERE br.room_type_id = inv.room_type_id
                          AND br.status = 'CONFIRMED'
                          AND b.status IN ('PENDING_APPROVAL', 'PENDING', 'CONFIRMED', 'COMPLETED')
                          AND inv.date >= b.check_in AND inv.date < b.check_out
                   ), 0) AS expected_booked
              FROM room_inventory inv
             WHERE (${roomTypeIds}::text[] IS NULL OR inv.room_type_id = ANY(${roomTypeIds}::text[]))
        )
        SELECT room_type_id AS "roomTypeId", date,
               held_units AS "heldUnits", expected_held AS "expectedHeld",
               booked_units AS "bookedUnits", expected_booked AS "expectedBooked"
          FROM expected
         WHERE held_units <> expected_held OR booked_units <> expected_booked
         ORDER BY room_type_id, date
         LIMIT 500
    `;

    if (apply && drift.length > 0) {
        await prisma.$transaction(
            drift.map((row) =>
                prisma.roomInventory.update({
                    where: { roomTypeId_date: { roomTypeId: row.roomTypeId, date: row.date } },
                    data: { heldUnits: row.expectedHeld, bookedUnits: row.expectedBooked }
                })
            )
        );
    }

    return {
        drift: drift.map((row) => ({
            roomTypeId: row.roomTypeId,
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
export const auditSweep = async (swept, actor = null) => {
    if (swept === 0) {
        return null;
    }

    return recordAudit(prisma, {
        action: 'HOLD_EXPIRED',
        actor,
        entityType: AUDIT_ENTITY.booking,
        entityId: 'sweeper',
        summary: `Released ${swept} expired hold(s)`,
        metadata: { swept }
    });
};
