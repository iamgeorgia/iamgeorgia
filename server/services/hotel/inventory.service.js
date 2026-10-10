import { Prisma } from '../../generated/prisma/client.ts';
import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { BadRequestError, ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { dateOnlyToUtc, nightsBetween, toDateOnly } from '../../lib/time.js';

/**
 * Daily inventory and daily rates.
 *
 * The admin panel edits these as ranges — "December, Monday to Thursday, five
 * rooms at 100" — so the API takes ranges and the database does the expansion.
 * A 365-day update is one statement, not 365 round trips, which is the
 * difference between a form that saves instantly and one that times out.
 *
 * Availability is never stored. `total - blocked - booked - held` is computed
 * on read; storing it would create a fifth number that can disagree with the
 * other four, and the one thing this table cannot afford is disagreeing with
 * itself.
 */

const assertRange = (from, to) => {
    const days = nightsBetween(from, to) + 1;

    if (days <= 0) {
        throw new BadRequestError('The range ends before it begins', { from, to });
    }

    if (days > config.hotel.maxBulkDays) {
        throw new BadRequestError(
            `A single update may cover at most ${config.hotel.maxBulkDays} days`,
            { days, limit: config.hotel.maxBulkDays }
        );
    }

    return days;
};

const assertRoomType = async (client, hotelId, roomTypeId) => {
    const roomType = await client.roomType.findFirst({
        where: { id: roomTypeId, hotelId },
        include: { hotel: { select: { id: true, name: true, currency: true, supplierId: true } } }
    });

    if (!roomType) {
        throw new NotFoundError('Room type not found');
    }

    return roomType;
};

const assertRatePlan = async (client, hotelId, roomTypeId, ratePlanId) => {
    const ratePlan = await client.ratePlan.findFirst({
        where: { id: ratePlanId, roomTypeId, roomType: { hotelId } },
        include: { roomType: { select: { name: true } } }
    });

    if (!ratePlan) {
        throw new NotFoundError('Rate plan not found');
    }

    return ratePlan;
};

/**
 * Weekday mask as a Postgres array, or null for every day.
 *
 * ISO numbering, 1 = Monday, so `[1,2,3,4]` is the midweek rate and `[5,6,7]`
 * the weekend one — which is exactly how a revenue manager thinks about it.
 */
const weekdayArray = (weekdays) => (weekdays?.length ? weekdays : null);

/**
 * Refuses a reduction that would put a date below what is already committed.
 *
 * The CHECK constraint would reject it anyway and that is the real guarantee,
 * but a 409 listing the dates that are in the way is a far better answer to an
 * admin than a constraint name — they need to know which nights to look at.
 */
const assertNoOversell = async (tx, roomTypeId, from, to, weekdays, totalUnits) => {
    if (totalUnits === undefined || totalUnits === null) {
        return;
    }

    const conflicts = await tx.$queryRaw`
        SELECT date, booked_units + held_units + blocked_units AS committed
          FROM room_inventory
         WHERE room_type_id = ${roomTypeId}
           AND date BETWEEN ${dateOnlyToUtc(from)}::date AND ${dateOnlyToUtc(to)}::date
           AND (${weekdayArray(weekdays)}::int[] IS NULL
                OR EXTRACT(ISODOW FROM date)::int = ANY(${weekdayArray(weekdays)}::int[]))
           AND booked_units + held_units + blocked_units > ${totalUnits}
         ORDER BY date
         LIMIT 20
    `;

    if (conflicts.length > 0) {
        throw new ConflictError(
            'Some of those nights already have more rooms committed than the new total',
            {
                requestedTotal: totalUnits,
                conflicts: conflicts.map((row) => ({
                    date: toDateOnly(row.date),
                    committed: Number(row.committed)
                }))
            }
        );
    }
};

/**
 * Writes inventory across a date range in one statement.
 *
 * Fields left out of the request keep whatever the row already had — that is
 * what `COALESCE(param, existing)` does in the conflict branch, and what makes
 * "close December to arrivals" a separate call from "set December to five
 * rooms" rather than something that has to restate both.
 */
export const setInventoryRange = async (hotelId, roomTypeId, input, actor, req) => {
    const days = assertRange(input.from, input.to);

    return prisma.$transaction(async (tx) => {
        const roomType = await assertRoomType(tx, hotelId, roomTypeId);

        await assertNoOversell(tx, roomTypeId, input.from, input.to, input.weekdays, input.totalUnits);

        const written = await tx.$executeRaw`
            INSERT INTO room_inventory (
                room_type_id, date, total_units, blocked_units, booked_units, held_units,
                stop_sell, min_stay, closed_to_arrival, closed_to_departure, created_at, updated_at
            )
            SELECT
                ${roomTypeId},
                day::date,
                COALESCE(${input.totalUnits ?? null}::int, 0),
                COALESCE(${input.blockedUnits ?? null}::int, 0),
                0,
                0,
                COALESCE(${input.stopSell ?? null}::boolean, false),
                ${input.minStay ?? null}::int,
                COALESCE(${input.closedToArrival ?? null}::boolean, false),
                COALESCE(${input.closedToDeparture ?? null}::boolean, false),
                now(),
                now()
              FROM generate_series(
                       ${dateOnlyToUtc(input.from)}::date,
                       ${dateOnlyToUtc(input.to)}::date,
                       '1 day'::interval
                   ) AS day
             WHERE ${weekdayArray(input.weekdays)}::int[] IS NULL
                OR EXTRACT(ISODOW FROM day)::int = ANY(${weekdayArray(input.weekdays)}::int[])
            ON CONFLICT (room_type_id, date) DO UPDATE SET
                total_units         = COALESCE(${input.totalUnits ?? null}::int, room_inventory.total_units),
                blocked_units       = COALESCE(${input.blockedUnits ?? null}::int, room_inventory.blocked_units),
                stop_sell           = COALESCE(${input.stopSell ?? null}::boolean, room_inventory.stop_sell),
                min_stay            = CASE WHEN ${input.minStay === undefined}::boolean
                                           THEN room_inventory.min_stay ELSE ${input.minStay ?? null}::int END,
                closed_to_arrival   = COALESCE(${input.closedToArrival ?? null}::boolean, room_inventory.closed_to_arrival),
                closed_to_departure = COALESCE(${input.closedToDeparture ?? null}::boolean, room_inventory.closed_to_departure),
                updated_at          = now()
        `;

        // One audit row summarising the range, not one per night. A December
        // update would otherwise bury the trail under 31 identical entries.
        await recordAudit(tx, {
            action: 'INVENTORY_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.roomType,
            entityId: roomTypeId,
            summary: `Set inventory on ${roomType.name} for ${input.from} to ${input.to}`,
            metadata: {
                hotelId,
                from: input.from,
                to: input.to,
                weekdays: input.weekdays ?? null,
                nights: written,
                ...(input.totalUnits === undefined ? {} : { totalUnits: input.totalUnits }),
                ...(input.stopSell === undefined ? {} : { stopSell: input.stopSell })
            },
            req
        });

        return { nights: written, days };
    });
};

export const setRateRange = async (hotelId, roomTypeId, ratePlanId, input, actor, req) => {
    const days = assertRange(input.from, input.to);

    return prisma.$transaction(async (tx) => {
        const ratePlan = await assertRatePlan(tx, hotelId, roomTypeId, ratePlanId);
        const currency = input.currency ?? ratePlan.currency;

        // A rate in a different currency from its plan cannot be summed with
        // the plan's other nights, and a stay that spans both would produce a
        // total that means nothing.
        if (currency !== ratePlan.currency) {
            throw new BadRequestError('A rate must be in the same currency as its rate plan', {
                field: 'currency',
                ratePlanCurrency: ratePlan.currency
            });
        }

        // A fixed sell price below net is a loss on every night it covers,
        // and a night can get there from either side: a new sell under a net
        // already on the calendar, or a new net over a sell already fixed.
        // The schema catches a request that carries both; these catch the
        // half-updates. The CHECK on the table is the backstop.
        const weekdays = weekdayArray(input.weekdays);
        const nightsIn = Prisma.sql`
            rate_plan_id = ${ratePlanId}
            AND date BETWEEN ${dateOnlyToUtc(input.from)}::date AND ${dateOnlyToUtc(input.to)}::date
            AND (${weekdays}::int[] IS NULL OR EXTRACT(ISODOW FROM date)::int = ANY(${weekdays}::int[]))`;

        if (input.sellCents != null && input.netCents === undefined) {
            const [{ net }] = await tx.$queryRaw`SELECT MAX(net_cents)::int AS net FROM rates WHERE ${nightsIn}`;

            if (net !== null && input.sellCents < net) {
                throw new UnprocessableEntityError('The sell price cannot be below the net price already set on these nights', {
                    reason: 'SELL_BELOW_NET',
                    field: 'sellCents',
                    netCents: net
                });
            }
        }

        if (input.netCents !== undefined && input.sellCents === undefined) {
            const [{ sell }] = await tx.$queryRaw`SELECT MIN(sell_cents)::int AS sell FROM rates WHERE ${nightsIn} AND sell_cents IS NOT NULL`;

            if (sell !== null && input.netCents > sell) {
                throw new UnprocessableEntityError('The net price cannot go above a sell price already fixed on these nights', {
                    reason: 'SELL_BELOW_NET',
                    field: 'netCents',
                    sellCents: sell
                });
            }
        }

        const written = await tx.$executeRaw`
            INSERT INTO rates (
                rate_plan_id, date, currency, net_cents, sell_cents,
                extra_adult_cents, extra_child_cents, single_occupancy_cents, closed,
                created_at, updated_at
            )
            SELECT
                ${ratePlanId},
                day::date,
                ${currency},
                COALESCE(${input.netCents ?? null}::int, 0),
                ${input.sellCents ?? null}::int,
                ${input.extraAdultCents ?? null}::int,
                ${input.extraChildCents ?? null}::int,
                ${input.singleOccupancyCents ?? null}::int,
                COALESCE(${input.closed ?? null}::boolean, false),
                now(),
                now()
              FROM generate_series(
                       ${dateOnlyToUtc(input.from)}::date,
                       ${dateOnlyToUtc(input.to)}::date,
                       '1 day'::interval
                   ) AS day
             WHERE ${weekdayArray(input.weekdays)}::int[] IS NULL
                OR EXTRACT(ISODOW FROM day)::int = ANY(${weekdayArray(input.weekdays)}::int[])
            ON CONFLICT (rate_plan_id, date) DO UPDATE SET
                currency               = ${currency},
                net_cents              = COALESCE(${input.netCents ?? null}::int, rates.net_cents),
                sell_cents             = CASE WHEN ${input.sellCents === undefined}::boolean
                                              THEN rates.sell_cents ELSE ${input.sellCents ?? null}::int END,
                extra_adult_cents      = CASE WHEN ${input.extraAdultCents === undefined}::boolean
                                              THEN rates.extra_adult_cents ELSE ${input.extraAdultCents ?? null}::int END,
                extra_child_cents      = CASE WHEN ${input.extraChildCents === undefined}::boolean
                                              THEN rates.extra_child_cents ELSE ${input.extraChildCents ?? null}::int END,
                single_occupancy_cents = CASE WHEN ${input.singleOccupancyCents === undefined}::boolean
                                              THEN rates.single_occupancy_cents ELSE ${input.singleOccupancyCents ?? null}::int END,
                closed                 = COALESCE(${input.closed ?? null}::boolean, rates.closed),
                updated_at             = now()
        `;

        await recordAudit(tx, {
            action: 'RATE_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.ratePlan,
            entityId: ratePlanId,
            summary: `Set rates on ${ratePlan.name} for ${input.from} to ${input.to}`,
            metadata: {
                hotelId,
                roomTypeId,
                from: input.from,
                to: input.to,
                weekdays: input.weekdays ?? null,
                nights: written,
                currency,
                ...(input.netCents === undefined ? {} : { netCents: input.netCents }),
                ...(input.sellCents === undefined ? {} : { sellCents: input.sellCents })
            },
            req
        });

        return { nights: written, days };
    });
};

/**
 * The admin calendar: inventory and every rate plan's price, night by night.
 *
 * Two queries for the whole grid regardless of how many rate plans a room has.
 * The obvious implementation — a query per plan — is where N+1 gets into a
 * screen that is refreshed constantly.
 */
export const readCalendar = async (hotelId, roomTypeId, { from, to }) => {
    assertRange(from, to);
    const roomType = await assertRoomType(prisma, hotelId, roomTypeId);

    const [inventory, rates] = await Promise.all([
        prisma.roomInventory.findMany({
            where: {
                roomTypeId,
                date: { gte: dateOnlyToUtc(from), lte: dateOnlyToUtc(to) }
            },
            orderBy: { date: 'asc' }
        }),
        prisma.rate.findMany({
            where: {
                ratePlan: { roomTypeId },
                date: { gte: dateOnlyToUtc(from), lte: dateOnlyToUtc(to) }
            },
            include: { ratePlan: { select: { id: true, name: true, code: true, status: true } } },
            orderBy: [{ ratePlanId: 'asc' }, { date: 'asc' }]
        })
    ]);

    return { roomType, inventory, rates };
};

/** Inventory for several room types over a range, as a lookup by id and date. */
export const readInventoryMap = async (roomTypeIds, from, to) => {
    const rows = await prisma.roomInventory.findMany({
        where: {
            roomTypeId: { in: roomTypeIds },
            date: { gte: dateOnlyToUtc(from), lte: dateOnlyToUtc(to) }
        }
    });

    const map = new Map();

    for (const row of rows) {
        map.set(`${row.roomTypeId}:${toDateOnly(row.date)}`, row);
    }

    return map;
};

export const upsertTaxFee = async (hotelId, taxFeeId, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const hotel = await tx.hotel.findUnique({ where: { id: hotelId } });

        if (!hotel) {
            throw new NotFoundError('Hotel not found');
        }

        const data = {
            ...input,
            currency: input.currency ?? hotel.currency,
            startDate: input.startDate ? dateOnlyToUtc(input.startDate) : null,
            endDate: input.endDate ? dateOnlyToUtc(input.endDate) : null
        };

        if (taxFeeId) {
            const current = await tx.hotelTaxFee.findFirst({ where: { id: taxFeeId, hotelId } });

            if (!current) {
                throw new NotFoundError('Tax or fee not found');
            }
        }

        const taxFee = taxFeeId
            ? await tx.hotelTaxFee.update({ where: { id: taxFeeId }, data })
            : await tx.hotelTaxFee.create({ data: { ...data, hotelId } });

        await recordAudit(tx, {
            action: 'TAX_FEE_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.hotel,
            entityId: hotelId,
            summary: `${taxFeeId ? 'Updated' : 'Added'} "${taxFee.name}" on ${hotel.name}`,
            metadata: { basis: taxFee.basis, value: taxFee.value, includedInRate: taxFee.includedInRate },
            req
        });

        return taxFee;
    });

export const listTaxFees = async (hotelId) => {
    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } });

    if (!hotel) {
        throw new NotFoundError('Hotel not found');
    }

    return prisma.hotelTaxFee.findMany({ where: { hotelId }, orderBy: { name: 'asc' } });
};

export const deleteTaxFee = async (hotelId, taxFeeId, actor, req) =>
    prisma.$transaction(async (tx) => {
        const taxFee = await tx.hotelTaxFee.findFirst({ where: { id: taxFeeId, hotelId } });

        if (!taxFee) {
            throw new NotFoundError('Tax or fee not found');
        }

        await tx.hotelTaxFee.delete({ where: { id: taxFeeId } });

        await recordAudit(tx, {
            action: 'TAX_FEE_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.hotel,
            entityId: hotelId,
            summary: `Removed "${taxFee.name}"`,
            metadata: { taxFeeId },
            req
        });

        return taxFee;
    });
