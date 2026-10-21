import { z } from 'zod';
import { bookingFilterFields } from '../lib/listing/bookingFilters.js';

import { currencyField, emailField, nameField, phoneField, slugField, textField, timezoneField } from './normalize.js';
import { dateOnlyField } from './ratePlan.js';
import { SUPPORTED_LOCALES } from '../lib/locales.js';

export const SERVICE_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];
export const SERVICE_CATEGORIES = [
    'KOSHER_MEAL_DELIVERY',
    'SHABBAT_MEALS',
    'MASHGIACH',
    'SYNAGOGUE_TRANSFER',
    'GUIDE',
    'EQUIPMENT',
    'OTHER'
];
export const SERVICE_BASES = ['PER_PERSON', 'PER_GROUP', 'PER_DAY', 'PER_PERSON_PER_DAY'];
const CONFIRMATION_MODES = ['INSTANT', 'ON_REQUEST'];
const BOOKING_STATUSES = ['PENDING_APPROVAL', 'PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];

const stringList = (max, items) => z.array(textField(max)).max(items);
const centsField = z.number().int().min(0).max(100_000_000);
const oneOrMany = (values) => z.union([z.enum(values), z.array(z.enum(values))]).optional();

export const serviceParamSchema = z.object({ serviceId: z.string().min(1) });
export const serviceSlugParamSchema = z.object({ slug: slugField });
export const serviceLocaleParamSchema = z.object({
    serviceId: z.string().min(1),
    locale: z.enum(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))
});
export const serviceReferenceParamSchema = z.object({ reference: z.string().min(1).max(64) });

const serviceFields = {
    slug: slugField,
    name: nameField,
    category: z.enum(SERVICE_CATEGORIES),
    destinationId: z.string().min(1).nullish(),
    supplierId: z.string().min(1).nullish(),
    basis: z.enum(SERVICE_BASES),
    netCents: centsField,
    sellCents: centsField.nullish(),
    currency: currencyField.optional(),
    timezone: timezoneField.optional(),
    minQuantity: z.number().int().min(1).max(500).default(1),
    maxQuantity: z.number().int().min(1).max(500).nullish(),
    cancellationPolicyId: z.string().min(1),
    noticeHours: z.number().int().min(0).max(24 * 60).default(48),
    confirmationMode: z.enum(CONFIRMATION_MODES).default('INSTANT'),
    isKosher: z.boolean().default(false),
    kosherAuthority: textField(200).nullish(),
    summary: textField(600),
    description: stringList(4000, 30).default([]),
    included: stringList(300, 30).default([]),
    b2cEnabled: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(9999).optional()
};

const quantityCoherent = (value) =>
    value.minQuantity === undefined ||
    value.maxQuantity === undefined ||
    value.maxQuantity === null ||
    value.maxQuantity >= value.minQuantity;

/** A fixed sell price replaces the markup, so one below net is a loss on every sale. */
const sellCoversNet = (value) => value.sellCents == null || value.netCents === undefined || value.sellCents >= value.netCents;

const SELL_BELOW_NET = { message: 'The sell price cannot be below the net price', path: ['sellCents'] };

export const createServiceSchema = z
    .object(serviceFields)
    .strict()
    .refine(quantityCoherent, { message: 'The largest quantity must be at least the smallest', path: ['maxQuantity'] })
    .refine(sellCoversNet, SELL_BELOW_NET);

export const updateServiceSchema = z
    .object({
        ...Object.fromEntries(Object.entries(serviceFields).map(([key, schema]) => [key, schema.optional()])),
        // Defaults stripped so a partial update cannot reset a field by omission.
        minQuantity: z.number().int().min(1).max(500).optional(),
        noticeHours: z.number().int().min(0).max(24 * 60).optional(),
        confirmationMode: z.enum(CONFIRMATION_MODES).optional(),
        isKosher: z.boolean().optional(),
        b2cEnabled: z.boolean().optional(),
        description: stringList(4000, 30).optional(),
        included: stringList(300, 30).optional()
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' })
    .refine(quantityCoherent, { message: 'The largest quantity must be at least the smallest', path: ['maxQuantity'] })
    .refine(sellCoversNet, SELL_BELOW_NET);

export const archiveServiceSchema = z.object({ reason: textField(500).optional() }).strict().optional().default({});

export const serviceTranslationSchema = z
    .object({
        name: nameField.nullish(),
        summary: textField(600).nullish(),
        description: stringList(4000, 30).optional(),
        included: stringList(300, 30).optional()
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
    category: oneOrMany(SERVICE_CATEGORIES),
    isKosher: z.stringbool().optional(),
    locale: z.enum(SUPPORTED_LOCALES).default('en')
};

export const serviceQuerySchema = z.object({
    ...catalogueFilters,
    status: oneOrMany(SERVICE_STATUSES),
    supplierId: z.string().min(1).optional(),
    ...pageFields
});

export const publicServiceQuerySchema = z.object({ ...catalogueFilters, ...pageFields });

// --- bookings ----------------------------------------------------------------

/** A standalone service booking: the service, the date and the party. No amount. */
export const confirmServiceBookingSchema = z
    .object({
        serviceId: z.string().min(1),
        date: dateOnlyField,
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        days: z.number().int().min(1).max(60).default(1),
        quantity: z.number().int().min(1).max(500).default(1),
        pax: z.number().int().min(1).max(500).default(1),
        lead: z
            .object({
                firstName: nameField,
                lastName: nameField,
                email: emailField,
                phone: phoneField.optional()
            })
            .strict(),
        notes: textField(1000).optional(),
        source: z.enum(['web', 'partner', 'admin']).default('partner'),
        idempotencyKey: z.string().min(8).max(200).optional()
    })
    .strict();

export const cancelServiceBookingSchema = z
    .object({ reason: textField(500).optional(), email: emailField.optional() })
    .strict()
    .optional()
    .default({});

export const declineServiceBookingSchema = z.object({ reason: textField(500) }).strict();

export const serviceBookingQuerySchema = z.object({
    ...bookingFilterFields,
    status: oneOrMany(BOOKING_STATUSES),
    serviceId: z.string().min(1).optional(),
    partnerId: z.string().min(1).optional(),
    from: dateOnlyField.optional(),
    to: dateOnlyField.optional(),
    search: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
});
