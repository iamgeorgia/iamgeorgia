import { z } from 'zod';

import { clockTimeField, currencyField, nameField, slugField, textField, timezoneField } from './normalize.js';
import { dateOnlyField } from './ratePlan.js';
import { gallerySchema } from './domain.js';
import { SUPPORTED_LOCALES } from '../lib/locales.js';

export const PACKAGE_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];
export const COMPONENT_TYPES = ['HOTEL_STAY', 'TRANSFER', 'TOUR', 'SERVICE'];
const ADJUSTMENT_KINDS = ['NONE', 'DISCOUNT_BPS', 'FIXED_SELL', 'PER_PERSON_FIXED'];
const ADJUSTMENT_SCOPES = ['REQUIRED_ONLY', 'ALL_ITEMS'];
const QUANTITY_RULES = ['ONE', 'PER_PERSON', 'PER_ROOM'];
const MEAL_CODES = ['RO', 'BB', 'HB', 'HB_PLUS', 'FB', 'FB_PLUS', 'AI', 'UAI'];
const VEHICLE_CLASSES = ['ECONOMY', 'COMFORT', 'MINIVAN', 'VAN', 'GROUP', 'JEEP_4X4', 'VIP'];
const KOSHER_LEVELS = ['NONE', 'ON_REQUEST', 'KOSHER_FRIENDLY', 'PARTIAL', 'FULL'];
const KOSHER_SCOPES = ['PROPERTY', 'KITCHEN', 'RESTAURANT', 'PASSOVER'];
const SHABBAT_MODES = ['SOLAR', 'FIXED_HOURS', 'NONE'];

const stringList = (max, items) => z.array(textField(max)).max(items);
const idList = z.array(z.string().min(1)).max(50).default([]);
const oneOrMany = (values) => z.union([z.enum(values), z.array(z.enum(values))]).optional();
const childAgesField = z
    .union([z.coerce.number().int().min(0).max(17), z.array(z.coerce.number().int().min(0).max(17)).max(20)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional();

export const packageParamSchema = z.object({ packageId: z.string().min(1) });
export const packageSlugParamSchema = z.object({ slug: slugField });
export const packageLocaleParamSchema = z.object({
    packageId: z.string().min(1),
    locale: z.enum(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))
});
export const packageImageParamSchema = z.object({ packageId: z.string().min(1), imageId: z.string().min(1) });

/** One slot. Type-specific columns are validated loosely here and by type in the service. */
export const componentSchema = z
    .object({
        componentType: z.enum(COMPONENT_TYPES),
        label: nameField,
        required: z.boolean().default(true),
        dayOffset: z.number().int().min(0).max(60).default(0),
        nights: z.number().int().min(1).max(60).nullish(),
        timeOfDay: clockTimeField.nullish(),
        quantityRule: z.enum(QUANTITY_RULES).default('ONE'),
        hotelId: z.string().min(1).nullish(),
        allowedRoomTypeIds: idList,
        allowedRatePlanIds: idList,
        allowedMealPlanCodes: z.array(z.enum(MEAL_CODES)).max(8).default([]),
        fromPointId: z.string().min(1).nullish(),
        toPointId: z.string().min(1).nullish(),
        routeId: z.string().min(1).nullish(),
        allowedVehicleClasses: z.array(z.enum(VEHICLE_CLASSES)).max(7).default([]),
        tripType: z.enum(['ONE_WAY', 'RETURN']).nullish(),
        tourId: z.string().min(1).nullish(),
        allowedTourOptionIds: idList,
        serviceId: z.string().min(1).nullish(),
        kosherMinServiceLevel: z.enum(KOSHER_LEVELS).nullish(),
        kosherCertifiedRequired: z.boolean().nullish(),
        kosherCertificationScopes: z.array(z.enum(KOSHER_SCOPES)).max(4).default([]),
        constraints: z.record(z.string(), z.unknown()).default({})
    })
    .strict()
    .refine((value) => value.componentType !== 'HOTEL_STAY' || (value.nights ?? 0) >= 1, {
        message: 'A hotel stay needs a number of nights',
        path: ['nights']
    })
    .refine((value) => value.componentType !== 'TOUR' || Boolean(value.tourId), { message: 'A tour slot needs a tour', path: ['tourId'] })
    .refine((value) => value.componentType !== 'SERVICE' || Boolean(value.serviceId), {
        message: 'A service slot needs a service',
        path: ['serviceId']
    })
    .refine((value) => value.componentType !== 'TRANSFER' || Boolean(value.routeId) || (Boolean(value.fromPointId) && Boolean(value.toPointId)), {
        message: 'A transfer slot needs a route or both pick-up points',
        path: ['routeId']
    });

const packageFields = {
    slug: slugField,
    name: nameField,
    destinationId: z.string().min(1),
    summary: textField(600),
    description: stringList(4000, 30).default([]),
    image: z.string().trim().max(500).default(''),
    gallery: gallerySchema.optional(),
    nights: z.number().int().min(0).max(60),
    currency: currencyField.optional(),
    timezone: timezoneField.optional(),
    // How a guest pays for the package: a PACKAGE template; null = the platform default.
    paymentPolicyId: z.string().min(1).max(64).nullish(),
    b2cEnabled: z.boolean().default(false),
    featured: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    minAdults: z.number().int().min(1).max(60).default(1),
    maxAdults: z.number().int().min(1).max(60).nullish(),
    maxChildren: z.number().int().min(0).max(40).nullish(),
    maxPax: z.number().int().min(1).max(100).nullish(),
    adjustmentKind: z.enum(ADJUSTMENT_KINDS).default('NONE'),
    adjustmentValue: z.number().int().min(0).max(100_000_000).default(0),
    adjustmentAppliesTo: z.enum(ADJUSTMENT_SCOPES).default('REQUIRED_ONLY'),
    sellableFrom: dateOnlyField.nullish(),
    sellableUntil: dateOnlyField.nullish(),
    validFrom: dateOnlyField.nullish(),
    validUntil: dateOnlyField.nullish(),
    components: z.array(componentSchema).max(20).optional()
};

const dateRows = (value) => {
    const out = {};

    for (const key of ['sellableFrom', 'sellableUntil', 'validFrom', 'validUntil']) {
        if (value[key] !== undefined) {
            out[key] = value[key] === null ? null : new Date(`${value[key]}T00:00:00.000Z`);
        }
    }

    return out;
};

const windowsCoherent = (value) =>
    (!value.sellableFrom || !value.sellableUntil || value.sellableUntil >= value.sellableFrom) &&
    (!value.validFrom || !value.validUntil || value.validUntil >= value.validFrom);

const adjustmentCoherent = (value) =>
    value.adjustmentKind === undefined || value.adjustmentKind === 'NONE' || (value.adjustmentValue ?? 0) > 0 || value.adjustmentValue === undefined;

export const createPackageSchema = z
    .object(packageFields)
    .strict()
    .refine(windowsCoherent, { message: 'A window ends before it begins', path: ['validUntil'] })
    .refine(adjustmentCoherent, { message: 'An adjustment needs a value', path: ['adjustmentValue'] })
    .transform((value) => ({ ...value, ...dateRows(value) }));

export const updatePackageSchema = z
    .object({
        ...Object.fromEntries(Object.entries(packageFields).map(([key, schema]) => [key, schema.optional()])),
        description: stringList(4000, 30).optional(),
        image: z.string().trim().max(500).optional(),
        b2cEnabled: z.boolean().optional(),
        featured: z.boolean().optional(),
        minAdults: z.number().int().min(1).max(60).optional(),
        adjustmentKind: z.enum(ADJUSTMENT_KINDS).optional(),
        adjustmentValue: z.number().int().min(0).max(100_000_000).optional(),
        adjustmentAppliesTo: z.enum(ADJUSTMENT_SCOPES).optional()
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' })
    .refine(windowsCoherent, { message: 'A window ends before it begins', path: ['validUntil'] })
    .transform((value) => ({ ...value, ...dateRows(value) }));

export const archivePackageSchema = z.object({ reason: textField(500).optional() }).strict().optional().default({});

export const packageTranslationSchema = z
    .object({
        name: nameField.nullish(),
        summary: textField(600).nullish(),
        description: stringList(4000, 30).optional()
    })
    .strict();

export const kosherProfileSchema = z
    .object({
        minServiceLevel: z.enum(KOSHER_LEVELS).default('FULL'),
        certifiedRequired: z.boolean().default(true),
        certificationScopes: z.array(z.enum(KOSHER_SCOPES)).min(1).max(4).default(['PROPERTY', 'KITCHEN']),
        requireCertValidThroughStay: z.boolean().default(true),
        requiredMealPlanCodes: z.array(z.enum(MEAL_CODES)).max(8).default([]),
        hotelRequestCodes: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
        shabbatMode: z.enum(SHABBAT_MODES).default('SOLAR'),
        shabbatFixedStart: clockTimeField.nullish(),
        shabbatFixedEnd: clockTimeField.nullish(),
        candleLightingOffsetMin: z.number().int().min(0).max(120).default(18),
        havdalahOffsetMin: z.number().int().min(0).max(120).default(42),
        noTransfersInShabbat: z.boolean().default(true),
        noToursOnShabbat: z.boolean().default(true),
        extraRestDays: z
            .array(z.object({ from: dateOnlyField, to: dateOnlyField, label: textField(120) }).strict())
            .max(40)
            .default([]),
        supervisionAuthority: textField(200).nullish(),
        notes: textField(2000).nullish()
    })
    .strict()
    .refine((value) => value.shabbatMode !== 'FIXED_HOURS' || (value.shabbatFixedStart && value.shabbatFixedEnd), {
        message: 'Fixed hours need a start and an end',
        path: ['shabbatFixedStart']
    });

export const kosherOverrideSchema = z.object({ until: dateOnlyField.nullable(), reason: textField(500).optional() }).strict();

export const tourKosherProfileSchema = z
    .object({
        kosherMealsAvailable: z.boolean().default(false),
        operatesOnShabbat: z.boolean().default(false),
        notes: textField(1000).nullish()
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
    kosher: z.stringbool().optional(),
    minNights: z.coerce.number().int().min(0).max(60).optional(),
    maxNights: z.coerce.number().int().min(0).max(60).optional(),
    featured: z.stringbool().optional(),
    locale: z.enum(SUPPORTED_LOCALES).default('en')
};

export const packageQuerySchema = z.object({ ...catalogueFilters, status: oneOrMany(PACKAGE_STATUSES), ...pageFields });
export const publicPackageQuerySchema = z.object({ ...catalogueFilters, ...pageFields });

/**
 * `choices` arrives as JSON in the query string — `{ "0": { "ratePlanId": "…" } }` —
 * because a nested per-slot object has no honest flat encoding.
 */
const choicesField = z
    .string()
    .max(4000)
    .optional()
    .transform((value, ctx) => {
        if (!value) return {};

        try {
            const parsed = JSON.parse(value);

            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');

            return parsed;
        } catch {
            ctx.addIssue({ code: 'custom', message: 'choices must be a JSON object keyed by slot' });

            return z.NEVER;
        }
    });

export const packageQuoteQuerySchema = z.object({
    startDate: dateOnlyField,
    adults: z.coerce.number().int().min(1).max(60).default(2),
    childAges: childAgesField,
    rooms: z.coerce.number().int().min(1).max(9).default(1),
    choices: choicesField,
    exclude: z
        .union([z.coerce.number().int().min(0), z.array(z.coerce.number().int().min(0))])
        .transform((value) => (Array.isArray(value) ? value : [value]))
        .optional(),
    locale: z.enum(SUPPORTED_LOCALES).default('en')
});

/** "Complete your trip" for one hotel or one tour, over a stay. */
export const recommendationQuerySchema = z
    .object({
        hotel: z.string().trim().min(1).max(120).optional(),
        tour: z.string().trim().min(1).max(120).optional(),
        checkIn: dateOnlyField,
        checkOut: dateOnlyField.optional(),
        adults: z.coerce.number().int().min(1).max(60).default(2),
        childAges: childAgesField,
        locale: z.enum(SUPPORTED_LOCALES).default('en')
    })
    .refine((value) => Boolean(value.hotel) !== Boolean(value.tour), { message: 'Give a hotel or a tour, not both', path: ['hotel'] })
    .refine((value) => !value.checkOut || value.checkOut > value.checkIn, { message: 'checkOut must be after checkIn', path: ['checkOut'] });

export const packageOfferTokenSchema = z.object({ token: z.string().min(20).max(20_000) }).strict();

export const attachPackageImageSchema = z
    .object({
        fileAssetId: z.string().min(1),
        caption: textField(300).nullish(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
        isCover: z.boolean().optional()
    })
    .strict();

export const updatePackageImageSchema = z
    .object({ caption: textField(300).nullable(), sortOrder: z.number().int().min(0).max(9999), isCover: z.boolean() })
    .strict()
    .partial()
    .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

export const reorderPackageImagesSchema = z.object({ order: z.array(z.string().min(1)).min(1).max(500) }).strict();
