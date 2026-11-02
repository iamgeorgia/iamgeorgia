import { z } from 'zod';

import { currencyField, nameField, slugField, textField } from './normalize.js';
import { isValidDateOnly } from '../lib/time.js';

const MEAL_PLAN_CODES = ['RO', 'BB', 'HB', 'HB_PLUS', 'FB', 'FB_PLUS', 'AI', 'UAI'];
const CANCELLATION_KINDS = ['FLEXIBLE', 'NON_REFUNDABLE', 'TIERED'];
const CHARGE_BASES = ['PERCENT_OF_TOTAL', 'PERCENT_OF_FIRST_NIGHT', 'FIXED_AMOUNT', 'NIGHTS'];
const PAYMENT_TIMINGS = ['PAY_NOW', 'PAY_LATER', 'DEPOSIT', 'PAY_AT_HOTEL', 'CREDIT_ACCOUNT'];
const RATE_PLAN_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'];
const RATE_PLAN_VISIBILITY = ['PUBLIC', 'PARTNER_ONLY'];

/**
 * A calendar date, as a string.
 *
 * Deliberately not `z.coerce.date()`: a stay date is a calendar date at the
 * property, not an instant, and coercing "2026-12-20" into a Date silently
 * attaches the server's midnight to it. Keeping it a string all the way to the
 * `@db.Date` column is what stops a booking drifting a night.
 */
export const dateOnlyField = z
    .string()
    .trim()
    .refine(isValidDateOnly, { message: 'Use a calendar date, for example 2026-12-20' });

export const hotelScopedParamSchema = z.object({ hotelId: z.string().min(1) });

export const policyParamSchema = z.object({
    hotelId: z.string().min(1),
    policyId: z.string().min(1)
});

export const ratePlanParamSchema = z.object({
    hotelId: z.string().min(1),
    roomTypeId: z.string().min(1),
    ratePlanId: z.string().min(1)
});

export const roomTypeScopedParamSchema = z.object({
    hotelId: z.string().min(1),
    roomTypeId: z.string().min(1)
});

// --- meal plans ------------------------------------------------------------

export const hotelMealPlanSchema = z
    .object({
        mealPlanCode: z.enum(MEAL_PLAN_CODES),
        description: textField(1000).nullish(),
        inclusions: z.array(textField(200)).max(30).default([]),
        // { breakfast: "07:00-10:00", dinner: "18:00-21:30" }
        serviceTimes: z.record(z.string().min(1).max(40), z.string().min(1).max(60)).default({})
    })
    .strict();

// --- cancellation ----------------------------------------------------------

/**
 * A policy is written whole, rules included.
 *
 * The tiers only make sense as a set — editing one at a time lets a hotel sit
 * in a state where two tiers overlap and the charge depends on row order.
 */
export const cancellationPolicySchema = z
    .object({
        name: nameField,
        kind: z.enum(CANCELLATION_KINDS),
        description: textField(1000).nullish(),
        isActive: z.boolean().default(true),
        rules: z
            .array(
                z
                    .object({
                        // Hours, not days: a deadline is a wall-clock instant at
                        // the property, and days would leave the time of day to
                        // be guessed at cancellation.
                        hoursBeforeCheckIn: z.number().int().min(0).max(175_200),
                        chargeBasis: z.enum(CHARGE_BASES),
                        chargeValue: z.number().int().min(0).max(10_000_000)
                    })
                    .strict()
                    .refine(
                        (rule) =>
                            !['PERCENT_OF_TOTAL', 'PERCENT_OF_FIRST_NIGHT'].includes(rule.chargeBasis) ||
                            rule.chargeValue <= 10_000,
                        { message: 'A percentage cannot exceed 100% (10000 basis points)', path: ['chargeValue'] }
                    )
            )
            .max(10)
            .default([])
    })
    .strict()
    .refine(
        (policy) =>
            new Set(policy.rules.map((rule) => rule.hoursBeforeCheckIn)).size === policy.rules.length,
        { message: 'Two tiers cannot start at the same deadline', path: ['rules'] }
    );

// --- payment ---------------------------------------------------------------

export const paymentPolicySchema = z
    .object({
        name: nameField,
        timing: z.enum(PAYMENT_TIMINGS),
        depositBps: z.number().int().min(0).max(10_000).nullish(),
        balanceDueDaysBeforeCheckIn: z.number().int().min(0).max(365).nullish(),
        // Card payments (docs/plans/FLITT_INTEGRATION_PLAN.md §4.4): how long
        // an unpaid PAY_NOW booking survives (null = never cancelled), and
        // whether a PAY_AT_HOTEL rate also offers a card.
        unpaidCancelHours: z.number().int().min(1).max(720).nullish(),
        cardOptional: z.boolean().optional(),
        description: textField(1000).nullish(),
        isActive: z.boolean().default(true)
    })
    .strict()
    .refine((policy) => policy.timing !== 'DEPOSIT' || (policy.depositBps ?? 0) > 0, {
        message: 'A deposit policy needs a deposit percentage',
        path: ['depositBps']
    });

// --- rate plans ------------------------------------------------------------

const ratePlanFields = {
    code: slugField,
    name: nameField,
    status: z.enum(RATE_PLAN_STATUSES),
    visibility: z.enum(RATE_PLAN_VISIBILITY),
    sortOrder: z.number().int().min(0).max(9999),
    mealPlanCode: z.enum(MEAL_PLAN_CODES),
    cancellationPolicyId: z.string().min(1),
    paymentPolicyId: z.string().min(1),
    currency: currencyField,
    baseOccupancy: z.number().int().min(1).max(30),
    minAdults: z.number().int().min(0).max(30).nullish(),
    maxAdults: z.number().int().min(1).max(30).nullish(),
    maxChildren: z.number().int().min(0).max(30).nullish(),
    sellableFrom: dateOnlyField.nullish(),
    sellableUntil: dateOnlyField.nullish()
};

const sellableRangeValid = (schema) =>
    schema.refine(
        (value) => !value.sellableFrom || !value.sellableUntil || value.sellableUntil >= value.sellableFrom,
        { message: 'The sellable range ends before it begins', path: ['sellableUntil'] }
    );

export const createRatePlanSchema = sellableRangeValid(
    z
        .object({
            ...ratePlanFields,
            status: z.enum(RATE_PLAN_STATUSES).default('ACTIVE'),
            visibility: z.enum(RATE_PLAN_VISIBILITY).default('PUBLIC'),
            baseOccupancy: z.number().int().min(1).max(30).default(2),
            sortOrder: z.number().int().min(0).max(9999).optional(),
            // Inherited from the hotel's contracted currency when omitted, so a
            // rate plan cannot quietly be quoted in a currency the property
            // does not contract in.
            currency: currencyField.optional()
        })
        .strict()
);

export const updateRatePlanSchema = sellableRangeValid(
    z
        .object(ratePlanFields)
        .strict()
        .partial()
        .refine((value) => Object.keys(value).length > 0, {
            message: 'Provide at least one field to update'
        })
);

/**
 * Date-ranged booking restrictions, written as a set for a window.
 *
 * Closed-to-arrival and closed-to-departure are the two that surprise people:
 * a stay may span such a date, it just may not begin or end on it. Changeover
 * days at ski resorts work exactly this way.
 */
export const ratePlanRestrictionSchema = z
    .object({
        startDate: dateOnlyField,
        endDate: dateOnlyField,
        minStay: z.number().int().min(1).max(365).nullish(),
        maxStay: z.number().int().min(1).max(365).nullish(),
        minAdvanceDays: z.number().int().min(0).max(730).nullish(),
        maxAdvanceDays: z.number().int().min(0).max(730).nullish(),
        closedToArrival: z.boolean().default(false),
        closedToDeparture: z.boolean().default(false),
        stopSell: z.boolean().default(false)
    })
    .strict()
    .refine((value) => value.endDate >= value.startDate, {
        message: 'The window ends before it begins',
        path: ['endDate']
    })
    .refine((value) => !value.minStay || !value.maxStay || value.maxStay >= value.minStay, {
        message: 'maxStay cannot be shorter than minStay',
        path: ['maxStay']
    });

export const restrictionParamSchema = z.object({
    hotelId: z.string().min(1),
    roomTypeId: z.string().min(1),
    ratePlanId: z.string().min(1),
    restrictionId: z.string().min(1)
});

export const ratePlanQuerySchema = z.object({
    status: z.union([z.enum(RATE_PLAN_STATUSES), z.array(z.enum(RATE_PLAN_STATUSES))]).optional(),
    includePartnerOnly: z.stringbool().default(true)
});

export const policyQuerySchema = z.object({
    includeInactive: z.stringbool().default(false),
    // Platform templates carry no hotelId and are offered to every property, so
    // a hotel's policy list is its own plus the shared ones unless it says not.
    includeTemplates: z.stringbool().default(true)
});
