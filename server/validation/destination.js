import { z } from 'zod';

import {
    countryField,
    latitudeField,
    longitudeField,
    nameField,
    slugField,
    textField,
    timezoneField
} from './normalize.js';
import { SUPPORTED_LOCALES } from '../lib/locales.js';
import { galleryImageSchema, attractionSchema, placeRefSchema, travelInfoSchema } from './domain.js';
import { withCoordinatePair } from './location.js';

const DESTINATION_TYPES = ['COUNTRY', 'REGION', 'CITY', 'RESORT'];

export const idParamSchema = z.object({ id: z.string().min(1) });
export const slugParamSchema = z.object({ slug: slugField });

const editorialFields = {
    tagline: textField(200).nullish(),
    summary: textField(500).nullish(),
    description: z.array(textField(4000)).max(40).optional(),
    heroImage: textField(500).nullish(),
    coverImage: textField(500).nullish(),
    gallery: z.array(galleryImageSchema).max(60).optional(),
    idealFor: z.array(textField(80)).max(20).optional(),
    attractions: z.array(attractionSchema).max(40).optional(),
    travelInfo: travelInfoSchema.nullish(),
    featured: z.boolean().optional()
};

const baseFields = {
    slug: slugField,
    name: nameField,
    type: z.enum(DESTINATION_TYPES),
    // Null is meaningful and different from absent: it means "make this a root",
    // which is why the create schema takes nullish rather than optional.
    parentId: z.string().min(1).nullish(),
    // Inherited from the parent when omitted, so only a root really needs it.
    countryCode: countryField.optional(),
    timezone: timezoneField.optional(),
    // Nullable, so an update can take a destination off the map again. The
    // pair rule (see withCoordinatePair) treats null exactly like absent.
    latitude: latitudeField.nullish(),
    longitude: longitudeField.nullish(),
    place: placeRefSchema.nullish(),
    ...editorialFields
};

export const createDestinationSchema = withCoordinatePair(z.object(baseFields).strict());

// `path` is never accepted from a client — it is derived from the parent chain
// and rewritten for every descendant when a destination moves. Accepting one
// would let a caller break prefix search for an entire country.
export const updateDestinationSchema = withCoordinatePair(
    z.object(baseFields).strict().partial().refine((value) => Object.keys(value).length > 0, {
        message: 'Provide at least one field to update'
    })
);

export const destinationTranslationSchema = z
    .object({
        name: nameField.nullish(),
        tagline: textField(200).nullish(),
        summary: textField(500).nullish(),
        description: z.array(textField(4000)).max(40).optional()
    })
    .strict();

export const localeParamSchema = z.object({
    id: z.string().min(1),
    // The default locale is the base row, so there is nothing to translate into
    // it — accepting `en` here would create a translation that shadows the
    // record it is a translation of.
    locale: z.enum(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))
});

export const destinationQuerySchema = z.object({
    search: z.string().trim().max(120).optional(),
    type: z.union([z.enum(DESTINATION_TYPES), z.array(z.enum(DESTINATION_TYPES))]).optional(),
    parentId: z.string().min(1).optional(),
    countryCode: countryField.optional(),
    featured: z.stringbool().optional(),
    locale: z.enum(SUPPORTED_LOCALES).default('en'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export const publicDestinationQuerySchema = z.object({
    locale: z.enum(SUPPORTED_LOCALES).default('en'),
    countryCode: countryField.optional(),
    featured: z.stringbool().optional()
});
