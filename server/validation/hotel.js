import { z } from 'zod';

import {
    amenityCodeField,
    clockTimeField,
    countryField,
    currencyField,
    emailField,
    latitudeField,
    longitudeField,
    nameField,
    phoneField,
    slugField,
    textField,
    timezoneField,
    websiteField
} from './normalize.js';
import { SUPPORTED_LOCALES } from '../lib/locales.js';
import { KOSHER_SERVICE_LEVELS } from './kosher.js';
import { hotelPoliciesSchema, nearbyPlaceSchema, placeRefSchema, reviewCategoryScoreSchema } from './domain.js';
import { withCoordinatePair } from './location.js';

const PROPERTY_TYPES = ['Hotel', 'Boutique', 'Resort', 'Guesthouse', 'Lodge', 'Apartment', 'Chalet', 'Hostel', 'Villa'];
const HOTEL_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED'];
const INVENTORY_SOURCES = ['MANUAL', 'CHANNEL_MANAGER', 'SUPPLIER_API'];

/**
 * The two kosher filters, shared by the admin register and the public
 * catalogue.
 *
 * Facility filters are absent because they are not needed: a kosher restaurant
 * and a Shabbat elevator are amenities, so they already travel on `amenity`.
 */
const kosherFilterFields = {
    kosher: z.enum(KOSHER_SERVICE_LEVELS.filter((level) => level !== 'NONE')).optional(),
    kosherCertified: z.stringbool().optional()
};

export const idParamSchema = z.object({ id: z.string().min(1) });
export const slugParamSchema = z.object({ slug: slugField });

export const hotelLocaleParamSchema = z.object({
    id: z.string().min(1),
    locale: z.enum(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))
});

/**
 * Step 1 of the wizard, and nothing more.
 *
 * A hotel is created as a DRAFT from the handful of things an admin knows
 * before they know anything else — what it is called, what kind of property it
 * is, and where it is. Requiring an address or a policy here would make the
 * wizard unimplementable, so completeness is enforced at publish instead.
 */
export const createHotelSchema = z
    .object({
        slug: slugField,
        name: nameField,
        propertyType: z.enum(PROPERTY_TYPES),
        destinationId: z.string().min(1),
        starRating: z.number().int().min(1).max(5),
        supplierId: z.string().min(1).nullish(),
        // Inherited from the destination when omitted.
        countryCode: countryField.optional(),
        timezone: timezoneField.optional(),
        currency: currencyField.optional()
    })
    .strict();

/**
 * Everything the later wizard steps write.
 *
 * `status` is not here: publishing and archiving are transitions with their own
 * endpoints and their own rules, not a field an admin may set to anything. That
 * is the same treatment partner status already gets.
 */
export const updateHotelSchema = withCoordinatePair(
    z
        .object({
            slug: slugField,
            name: nameField,
            propertyType: z.enum(PROPERTY_TYPES),
            destinationId: z.string().min(1),
            supplierId: z.string().min(1).nullable(),
            starRating: z.number().int().min(1).max(5),

            address: textField(300).nullish(),
            postalCode: textField(20).nullish(),
            countryCode: countryField,
            // Nullable so the pin can be taken off the map again; the pair
            // rule in withCoordinatePair treats null like absent.
            latitude: latitudeField.nullable(),
            longitude: longitudeField.nullable(),
            place: placeRefSchema.nullable(),

            checkInFrom: clockTimeField.nullish(),
            checkInUntil: clockTimeField.nullish(),
            checkOutFrom: clockTimeField.nullish(),
            checkOutUntil: clockTimeField.nullish(),
            timezone: timezoneField,
            currency: currencyField,

            phone: phoneField.nullish(),
            email: emailField.nullish(),
            website: websiteField.nullish(),
            languages: z.array(textField(40)).max(20),

            sourceType: z.enum(INVENTORY_SOURCES),
            externalRef: z.record(z.string(), z.unknown()).nullish(),

            shortDescription: textField(300).nullish(),
            summary: textField(500).nullish(),
            description: z.array(textField(4000)).max(40),

            categoryScores: z.array(reviewCategoryScoreSchema).max(20),
            policies: hotelPoliciesSchema,
            nearby: z.array(nearbyPlaceSchema).max(40),

            featuredImageId: z.string().min(1).nullable(),
            featured: z.boolean(),
            b2cEnabled: z.boolean()
        })
        .strict()
        .partial()
        .refine((value) => Object.keys(value).length > 0, {
            message: 'Provide at least one field to update'
        })
);

/** The amenity checklist, sent whole rather than as a stream of toggles. */
export const hotelAmenitiesSchema = z
    .object({
        amenities: z
            .array(
                z
                    .object({
                        amenityId: z.string().min(1),
                        note: textField(200).nullish()
                    })
                    .strict()
            )
            .max(120)
    })
    .strict();

export const hotelTranslationSchema = z
    .object({
        name: nameField.nullish(),
        shortDescription: textField(300).nullish(),
        summary: textField(500).nullish(),
        description: z.array(textField(4000)).max(40).optional(),
        policies: hotelPoliciesSchema.nullish()
    })
    .strict();

export const archiveHotelSchema = z
    .object({ reason: textField(500).optional() })
    .strict()
    .optional()
    .default({});

export const hotelQuerySchema = z.object({
    search: z.string().trim().max(120).optional(),
    status: z.union([z.enum(HOTEL_STATUSES), z.array(z.enum(HOTEL_STATUSES))]).optional(),
    destinationId: z.string().min(1).optional(),
    // Accepts a destination path prefix, so "everything in Georgia" is one
    // filter rather than a client-side walk of the tree.
    destinationPath: z.string().trim().max(400).optional(),
    supplierId: z.string().min(1).optional(),
    propertyType: z.union([z.enum(PROPERTY_TYPES), z.array(z.enum(PROPERTY_TYPES))]).optional(),
    countryCode: countryField.optional(),
    featured: z.stringbool().optional(),
    ...kosherFilterFields,
    locale: z.enum(SUPPORTED_LOCALES).default('en'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

/**
 * The public catalogue query.
 *
 * Deliberately not `hotelQuerySchema.partial()`: a public caller must never be
 * able to ask for DRAFT or ARCHIVED properties, and the safest way to
 * guarantee that is for the public schema to have no `status` field at all.
 */
export const publicHotelQuerySchema = z.object({
    search: z.string().trim().max(120).optional(),
    destinationSlug: slugField.optional(),
    destinationPath: z.string().trim().max(400).optional(),
    propertyType: z.union([z.enum(PROPERTY_TYPES), z.array(z.enum(PROPERTY_TYPES))]).optional(),
    countryCode: countryField.optional(),
    minStars: z.coerce.number().int().min(1).max(5).optional(),
    amenity: z.union([amenityCodeField, z.array(amenityCodeField)]).optional(),
    featured: z.stringbool().optional(),
    ...kosherFilterFields,
    locale: z.enum(SUPPORTED_LOCALES).default('en'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(24)
});
