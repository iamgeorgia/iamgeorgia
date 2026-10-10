import { z } from 'zod';

import { currencyField, nameField } from './normalize.js';
import { dateOnlyField } from './ratePlan.js';

const TAX_FEE_BASES = ['PERCENT', 'PER_NIGHT_PER_PERSON', 'PER_NIGHT_PER_ROOM', 'PER_STAY'];

/**
 * ISO weekdays, 1 = Monday. Omitted means every day in the range.
 *
 * This is what turns "December, Monday to Thursday at 100, Friday to Sunday at
 * 125" into two calls instead of sixty-two.
 */
const weekdaysField = z.array(z.number().int().min(1).max(7)).min(1).max(7).optional();

const rangeFields = {
    from: dateOnlyField,
    to: dateOnlyField,
    weekdays: weekdaysField
};

const rangeOrdered = (schema) =>
    schema.refine((value) => value.to >= value.from, {
        message: 'The range ends before it begins',
        path: ['to']
    });

/**
 * Every field below `from`/`to` is optional, and absence means "leave it alone".
 *
 * That is what lets "close December to arrivals" be one call that does not have
 * to restate the room counts, and it is why the SQL uses COALESCE against the
 * existing row rather than overwriting with defaults.
 */
export const inventoryRangeSchema = rangeOrdered(
    z
        .object({
            ...rangeFields,
            totalUnits: z.number().int().min(0).max(10_000).optional(),
            blockedUnits: z.number().int().min(0).max(10_000).optional(),
            stopSell: z.boolean().optional(),
            minStay: z.number().int().min(1).max(365).nullish(),
            closedToArrival: z.boolean().optional(),
            closedToDeparture: z.boolean().optional()
        })
        .strict()
        .refine(
            (value) =>
                Object.keys(value).some(
                    (key) => !['from', 'to', 'weekdays'].includes(key)
                ),
            { message: 'Provide at least one value to set' }
        )
);

export const rateRangeSchema = rangeOrdered(
    z
        .object({
            ...rangeFields,
            currency: currencyField.optional(),
            netCents: z.number().int().min(0).max(100_000_000).optional(),
            sellCents: z.number().int().min(0).max(100_000_000).nullish(),
            extraAdultCents: z.number().int().min(0).max(100_000_000).nullish(),
            extraChildCents: z.number().int().min(0).max(100_000_000).nullish(),
            singleOccupancyCents: z.number().int().min(0).max(100_000_000).nullish(),
            closed: z.boolean().optional()
        })
        .strict()
        .refine(
            (value) =>
                Object.keys(value).some(
                    (key) => !['from', 'to', 'weekdays', 'currency'].includes(key)
                ),
            { message: 'Provide at least one value to set' }
        )
        // A fixed sell price replaces the markup entirely, so one below net
        // is a loss on every night it covers. The service checks the same
        // thing against nights already on the calendar.
        .refine(
            (value) => value.sellCents == null || value.netCents === undefined || value.sellCents >= value.netCents,
            { message: 'The sell price cannot be below the net price', path: ['sellCents'] }
        )
);

export const calendarQuerySchema = rangeOrdered(
    z.object({ from: dateOnlyField, to: dateOnlyField }).strict()
);

export const taxFeeSchema = z
    .object({
        name: nameField,
        basis: z.enum(TAX_FEE_BASES),
        // Basis points for PERCENT, minor units otherwise.
        value: z.number().int().min(0).max(10_000_000),
        currency: currencyField.optional(),
        includedInRate: z.boolean().default(false),
        appliesToChildren: z.boolean().default(true),
        startDate: dateOnlyField.nullish(),
        endDate: dateOnlyField.nullish()
    })
    .strict()
    .refine((value) => value.basis !== 'PERCENT' || value.value <= 10_000, {
        message: 'A percentage cannot exceed 100% (10000 basis points)',
        path: ['value']
    })
    .refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, {
        message: 'The window ends before it begins',
        path: ['endDate']
    });

export const taxFeeParamSchema = z.object({
    hotelId: z.string().min(1),
    taxFeeId: z.string().min(1)
});
