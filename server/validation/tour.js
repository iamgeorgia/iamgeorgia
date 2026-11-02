import { z } from 'zod';

import { clockTimeField, currencyField, nameField, slugField, textField, timezoneField } from './normalize.js';
import { dateOnlyField } from './ratePlan.js';
import { gallerySchema } from './domain.js';
import { SUPPORTED_LOCALES } from '../lib/locales.js';

export const TOUR_CATEGORIES = ['adventure', 'culture', 'wine', 'nature', 'city'];
export const DIFFICULTIES = ['Easy', 'Moderate', 'Challenging'];
export const TOUR_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];
export const TOUR_OPTION_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'];
export const TOUR_OPTION_KINDS = ['SHARED', 'PRIVATE'];
export const TOUR_PRICING_BASES = ['PER_PERSON', 'PER_GROUP'];
export const TOUR_UNIT_KINDS = ['SEAT', 'GROUP'];
export const TOUR_SCHEDULE_KINDS = ['SCHEDULED', 'ON_DEMAND'];
export const CONFIRMATION_MODES = ['INSTANT', 'ON_REQUEST'];
export const VISIBILITIES = ['PUBLIC', 'PARTNER_ONLY'];
const MEAL_KEYS = ['breakfast', 'lunch', 'dinner'];

const stringList = (max, items) => z.array(textField(max)).max(items);
const weekdaysField = z.array(z.number().int().min(1).max(7)).max(7);
const centsField = z.number().int().min(0).max(100_000_000);
const oneOrMany = (values) => z.union([z.enum(values), z.array(z.enum(values))]).optional();

/**
 * One age per child, exactly as hotel search takes them: a count would leave
 * the server guessing which band each child falls in.
 */
const childAgesField = z
    .union([z.coerce.number().int().min(0).max(17), z.array(z.coerce.number().int().min(0).max(17)).max(20)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional();

// --- params ------------------------------------------------------------------

export const tourParamSchema = z.object({ tourId: z.string().min(1) });
export const tourOptionParamSchema = z.object({ tourId: z.string().min(1), optionId: z.string().min(1) });
export const tourSeasonParamSchema = z.object({
    tourId: z.string().min(1),
    optionId: z.string().min(1),
    seasonId: z.string().min(1)
});
export const tourLocaleParamSchema = z.object({
    tourId: z.string().min(1),
    locale: z.enum(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))
});
export const tourImageParamSchema = z.object({ tourId: z.string().min(1), imageId: z.string().min(1) });
export const tourSlugParamSchema = z.object({ slug: slugField });

// --- the tour itself ---------------------------------------------------------

export const itineraryDaySchema = z
    .object({
        day: z.number().int().min(1).max(60),
        title: textField(200),
        description: textField(4000),
        meals: z.array(z.enum(MEAL_KEYS)).max(3).default([]),
        accommodation: textField(300).nullish()
    })
    .strict();

const tourFields = {
    slug: slugField,
    title: nameField,
    location: textField(200),
    destinationId: z.string().min(1),
    category: z.enum(TOUR_CATEGORIES),
    summary: textField(600),
    description: stringList(4000, 30).default([]),
    image: z.string().trim().max(500).default(''),
    gallery: gallerySchema.optional(),
    durationDays: z.number().int().min(1).max(60),
    durationLabel: textField(100),
    groupSize: textField(100),
    difficulty: z.enum(DIFFICULTIES),
    timezone: timezoneField.optional(),
    currency: currencyField.optional(),
    meetingPoint: textField(500),
    meetingPointId: z.string().min(1).nullish(),
    meetingTime: clockTimeField.nullish(),
    minAge: z.number().int().min(0).max(99).nullish(),
    infantMaxAge: z.number().int().min(0).max(17).default(2),
    childMaxAge: z.number().int().min(0).max(17).default(11),
    highlights: stringList(300, 30).default([]),
    included: stringList(300, 30).default([]),
    excluded: stringList(300, 30).default([]),
    importantInfo: stringList(500, 30).default([]),
    featured: z.boolean().default(false),
    b2cEnabled: z.boolean().default(false),
    supplierId: z.string().min(1).nullish(),
    itinerary: z.array(itineraryDaySchema).max(60).optional()
};

const agesCoherent = (value) =>
    value.infantMaxAge === undefined || value.childMaxAge === undefined || value.childMaxAge >= value.infantMaxAge;

const itineraryDaysUnique = (value) =>
    !value.itinerary || new Set(value.itinerary.map((day) => day.day)).size === value.itinerary.length;

export const createTourSchema = z
    .object(tourFields)
    .strict()
    .refine(agesCoherent, { message: 'The child age band must end at or after the infant band', path: ['childMaxAge'] })
    .refine(itineraryDaysUnique, { message: 'Each itinerary day may appear once', path: ['itinerary'] });

/** Everything optional; `status` is deliberately absent — lifecycle has its own endpoints. */
export const updateTourSchema = z
    .object(
        Object.fromEntries(
            Object.entries(tourFields).map(([key, schema]) => [
                key,
                // Strip the defaults so a partial update cannot quietly reset a
                // field to its default by omission.
                key in { description: 1, highlights: 1, included: 1, excluded: 1, importantInfo: 1 }
                    ? stringList(4000, 30).optional()
                    : ['featured', 'b2cEnabled'].includes(key)
                      ? z.boolean().optional()
                      : ['infantMaxAge', 'childMaxAge'].includes(key)
                        ? z.number().int().min(0).max(17).optional()
                        : key === 'image'
                          ? z.string().trim().max(500).optional()
                          : schema.optional()
            ])
        )
    )
    .strict()
    .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' })
    .refine(agesCoherent, { message: 'The child age band must end at or after the infant band', path: ['childMaxAge'] })
    .refine(itineraryDaysUnique, { message: 'Each itinerary day may appear once', path: ['itinerary'] });

export const archiveTourSchema = z.object({ reason: textField(500).optional() }).strict().optional().default({});

export const tourTranslationSchema = z
    .object({
        title: nameField.nullish(),
        location: textField(200).nullish(),
        summary: textField(600).nullish(),
        description: stringList(4000, 30).optional(),
        highlights: stringList(300, 30).optional(),
        included: stringList(300, 30).optional(),
        excluded: stringList(300, 30).optional(),
        importantInfo: stringList(500, 30).optional(),
        meetingPoint: textField(500).nullish(),
        durationLabel: textField(100).nullish(),
        groupSize: textField(100).nullish()
    })
    .strict();

const pageFields = {
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(24)
};

const catalogueFilters = {
    search: z.string().trim().max(120).optional(),
    destinationId: z.string().min(1).optional(),
    destinationSlug: slugField.optional(),
    destinationPath: z.string().trim().min(1).max(300).optional(),
    category: oneOrMany(TOUR_CATEGORIES),
    difficulty: oneOrMany(DIFFICULTIES),
    minDays: z.coerce.number().int().min(1).max(60).optional(),
    maxDays: z.coerce.number().int().min(1).max(60).optional(),
    featured: z.stringbool().optional(),
    locale: z.enum(SUPPORTED_LOCALES).default('en')
};

/** The admin register. */
export const tourQuerySchema = z.object({
    ...catalogueFilters,
    status: oneOrMany(TOUR_STATUSES),
    supplierId: z.string().min(1).optional(),
    ...pageFields
});

/** The public catalogue: no dates, no status. */
export const publicTourQuerySchema = z.object({ ...catalogueFilters, ...pageFields });

/** Dated search: the catalogue filters plus a departure date and a party. */
export const tourSearchQuerySchema = z.object({
    ...catalogueFilters,
    date: dateOnlyField.optional(),
    adults: z.coerce.number().int().min(1).max(60).default(2),
    childAges: childAgesField,
    ...pageFields
});

/** One tour's departures: a single date, or a window of at most two months. */
export const tourAvailabilityQuerySchema = z
    .object({
        date: dateOnlyField.optional(),
        from: dateOnlyField.optional(),
        to: dateOnlyField.optional(),
        adults: z.coerce.number().int().min(1).max(60).default(2),
        childAges: childAgesField,
        locale: z.enum(SUPPORTED_LOCALES).default('en')
    })
    .refine((value) => Boolean(value.date) || (Boolean(value.from) && Boolean(value.to)), {
        message: 'Give a date, or a from and to window',
        path: ['date']
    });

export const tourOfferQuoteSchema = z.object({ token: z.string().min(20).max(4000) }).strict();

// --- options -----------------------------------------------------------------

const optionFields = {
    code: z
        .string()
        .trim()
        .min(1)
        .max(40)
        .regex(/^[a-z0-9-]+$/, 'Use lower-case letters, digits and hyphens'),
    name: nameField,
    kind: z.enum(TOUR_OPTION_KINDS),
    pricingBasis: z.enum(TOUR_PRICING_BASES),
    unitKind: z.enum(TOUR_UNIT_KINDS).optional(),
    scheduleKind: z.enum(TOUR_SCHEDULE_KINDS).default('ON_DEMAND'),
    confirmationMode: z.enum(CONFIRMATION_MODES).default('INSTANT'),
    visibility: z.enum(VISIBILITIES).default('PUBLIC'),
    // How a guest pays: a TOUR template or a tour-owned policy; null = the platform default.
    paymentPolicyId: z.string().min(1).max(64).nullish(),
    minPax: z.number().int().min(1).max(500).default(1),
    maxPax: z.number().int().min(1).max(500),
    startTime: clockTimeField.nullish(),
    durationMinutes: z.number().int().min(15).max(24 * 60 * 60).nullish(),
    languages: z.array(z.string().trim().toLowerCase().min(2).max(5)).max(10).default([]),
    operatesOnWeekdays: weekdaysField.default([]),
    noticeHours: z.number().int().min(0).max(24 * 60).default(24),
    horizonDays: z.number().int().min(1).max(730).default(365),
    cancellationPolicyId: z.string().min(1),
    sortOrder: z.number().int().min(0).max(9999).optional()
};

const paxCoherent = (value) =>
    value.minPax === undefined || value.maxPax === undefined || value.maxPax >= value.minPax;

export const createTourOptionSchema = z
    .object(optionFields)
    .strict()
    .refine(paxCoherent, { message: 'The largest party must be at least the smallest', path: ['maxPax'] });

export const updateTourOptionSchema = z
    .object({
        ...Object.fromEntries(Object.entries(optionFields).map(([key, schema]) => [key, schema.optional()])),
        // Defaults stripped, as on the tour update.
        scheduleKind: z.enum(TOUR_SCHEDULE_KINDS).optional(),
        confirmationMode: z.enum(CONFIRMATION_MODES).optional(),
        visibility: z.enum(VISIBILITIES).optional(),
        minPax: z.number().int().min(1).max(500).optional(),
        languages: z.array(z.string().trim().toLowerCase().min(2).max(5)).max(10).optional(),
        operatesOnWeekdays: weekdaysField.optional(),
        noticeHours: z.number().int().min(0).max(24 * 60).optional(),
        horizonDays: z.number().int().min(1).max(730).optional(),
        status: z.enum(['ACTIVE', 'INACTIVE']).optional()
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' })
    .refine(paxCoherent, { message: 'The largest party must be at least the smallest', path: ['maxPax'] });

export const tourOptionQuerySchema = z.object({
    status: oneOrMany(TOUR_OPTION_STATUSES),
    locale: z.enum(SUPPORTED_LOCALES).default('en')
});

// --- seasons -----------------------------------------------------------------

const tierSchema = z
    .object({
        minPax: z.number().int().min(1).max(500),
        maxPax: z.number().int().min(1).max(500).nullish(),
        adultNetCents: centsField.nullish(),
        childNetCents: centsField.nullish(),
        infantNetCents: centsField.default(0),
        groupNetCents: centsField.nullish(),
        adultSellCents: centsField.nullish(),
        childSellCents: centsField.nullish(),
        groupSellCents: centsField.nullish()
    })
    .strict()
    .refine((tier) => tier.maxPax === null || tier.maxPax === undefined || tier.maxPax >= tier.minPax, {
        message: 'A tier cannot end before it begins',
        path: ['maxPax']
    });

/** A season is written whole, tiers included. */
export const tourSeasonSchema = z
    .object({
        name: nameField,
        validFrom: dateOnlyField,
        validUntil: dateOnlyField,
        weekdays: weekdaysField.default([]),
        priority: z.number().int().min(0).max(1000).default(0),
        currency: currencyField.optional(),
        isActive: z.boolean().default(true),
        tiers: z.array(tierSchema).min(1).max(20)
    })
    .strict()
    .refine((value) => value.validUntil >= value.validFrom, {
        message: 'The season ends before it begins',
        path: ['validUntil']
    })
    .refine((value) => new Set(value.tiers.map((tier) => tier.minPax)).size === value.tiers.length, {
        message: 'Each tier must start at a different party size',
        path: ['tiers']
    });

// --- departures --------------------------------------------------------------

const rangeOrdered = (schema) =>
    schema.refine((value) => value.to >= value.from, { message: 'The range ends before it begins', path: ['to'] });

/** Anything omitted keeps what the departure already had. */
export const tourInventoryRangeSchema = rangeOrdered(
    z
        .object({
            from: dateOnlyField,
            to: dateOnlyField,
            weekdays: weekdaysField.min(1).optional(),
            totalUnits: z.number().int().min(0).max(10_000).optional(),
            blockedUnits: z.number().int().min(0).max(10_000).optional(),
            stopSell: z.boolean().optional(),
            departureTime: clockTimeField.nullish(),
            note: textField(300).nullish()
        })
        .strict()
        .refine((value) => Object.keys(value).some((key) => !['from', 'to', 'weekdays'].includes(key)), {
            message: 'Provide at least one value to set'
        })
);

export const tourCalendarQuerySchema = rangeOrdered(z.object({ from: dateOnlyField, to: dateOnlyField }).strict());

// --- images ------------------------------------------------------------------

export const attachTourImageSchema = z
    .object({
        fileAssetId: z.string().min(1),
        caption: textField(300).nullish(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
        isCover: z.boolean().optional()
    })
    .strict();

export const updateTourImageSchema = z
    .object({
        caption: textField(300).nullable(),
        sortOrder: z.number().int().min(0).max(9999),
        isCover: z.boolean()
    })
    .strict()
    .partial()
    .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

export const reorderTourImagesSchema = z.object({ order: z.array(z.string().min(1)).min(1).max(500) }).strict();
