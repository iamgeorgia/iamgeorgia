import { z } from 'zod';
import { bookingFilterFields } from '../lib/listing/bookingFilters.js';

import {
    currencyField,
    emailField,
    latitudeField,
    longitudeField,
    nameField,
    phoneField,
    slugField,
    textField,
    timezoneField
} from './normalize.js';
import { dateOnlyField } from './ratePlan.js';
import { placedLocationSchema, placeRefSchema } from './domain.js';
import { SUPPORTED_LOCALES } from '../lib/locales.js';

/**
 * Request schemas for the transfer module.
 *
 * Every one of them is `.strict()`, and the quote and booking bodies carry no
 * amount at all. That is the same rule the hotel module follows and it is worth
 * restating: a request that *could* name a price is a request that could set
 * one, and no amount of checking downstream is as good as the field not
 * existing.
 */

const POINT_KINDS = ['AIRPORT', 'CITY', 'RESORT', 'HOTEL', 'LANDMARK', 'STATION'];
const VEHICLE_CLASSES = ['ECONOMY', 'COMFORT', 'MINIVAN', 'VAN', 'GROUP', 'JEEP_4X4', 'VIP'];
const VEHICLE_BODIES = ['sedan', 'suv', 'minivan', 'van', 'bus'];
const TRANSFER_KINDS = ['PRIVATE', 'SHARED'];
const ROUTE_TIERS = ['TIER_1', 'TIER_2', 'TIER_3'];
const ROUTE_CATEGORIES = ['AIRPORT', 'CITY', 'RESORT', 'TOURIST_ROUTE', 'COMBINED'];
const TRANSFER_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];
const EXTRA_BASES = ['FIXED', 'PER_PASSENGER', 'PER_HOUR', 'PERCENT'];
const BOOKING_STATUSES = ['PENDING_APPROVAL', 'PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];

const FEATURES = [
    'airConditioning',
    'wifi',
    'childSeat',
    'englishDriver',
    'meetGreet',
    'flightTracking',
    'bottledWater',
    'freeWaiting'
];

/** 24-hour wall clock at the pick-up point. */
const clockField = z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use a 24-hour time, for example 09:30' });

const localeField = z.enum(SUPPORTED_LOCALES).optional();

const centsField = z.number().int().min(0).max(100_000_000);

/**
 * Add-ons, as codes and quantities.
 *
 * Never a price. The catalogue decides what a child seat costs; the request
 * decides how many.
 */
const extrasField = z
    .array(
        z
            .object({
                code: z.string().trim().min(1).max(64),
                quantity: z.coerce.number().int().min(1).max(20).default(1)
            })
            .strict()
    )
    .max(15)
    .optional();

/**
 * Extras arrive in a query string as repeated `extra=childSeat` params, and in
 * a JSON body as objects. Both normalise to the same shape so the service sees
 * one thing.
 */
const extrasQueryField = z
    .union([z.string().trim().min(1).max(64), z.array(z.string().trim().min(1).max(64)).max(15)])
    .transform((value) => (Array.isArray(value) ? value : [value]).map((code) => ({ code, quantity: 1 })))
    .optional();

const partyFields = {
    adults: z.coerce.number().int().min(1).max(60).default(2),
    children: z.coerce.number().int().min(0).max(30).default(0),
    childAges: z
        .union([z.coerce.number().int().min(0).max(17), z.array(z.coerce.number().int().min(0).max(17)).max(30)])
        .transform((value) => (Array.isArray(value) ? value : [value]))
        .optional(),
    luggage: z.coerce.number().int().min(0).max(60).default(2),
    cabinBags: z.coerce.number().int().min(0).max(60).default(0)
};

/**
 * A return has to carry both halves of itself.
 *
 * Enforced as a refinement rather than by two schemas, because "return" is one
 * choice a traveller makes and splitting it in two would put the error on the
 * wrong field.
 */
const returnComplete = (schema) =>
    schema.refine(
        (value) => value.tripType !== 'RETURN' || Boolean(value.returnDate && value.returnTime),
        { message: 'A return journey needs a return date and time', path: ['returnDate'] }
    );

export const quoteQuerySchema = returnComplete(
    z
        .object({
            from: z.string().trim().min(1).max(120),
            to: z.string().trim().min(1).max(120),
            date: dateOnlyField,
            time: clockField,
            tripType: z.enum(['ONE_WAY', 'RETURN']).default('ONE_WAY'),
            returnDate: dateOnlyField.optional(),
            returnTime: clockField.optional(),
            ...partyFields,
            extra: extrasQueryField,
            locale: localeField
        })
        .strict()
).transform(({ extra, ...rest }) => ({ ...rest, extras: extra ?? [] }));

export const quoteTokenSchema = z.object({ token: z.string().min(20).max(4000) }).strict();

export const pointQuerySchema = z
    .object({
        search: z.string().trim().min(1).max(120).optional(),
        kind: z.enum(POINT_KINDS).optional(),
        popular: z.coerce.boolean().optional(),
        locale: localeField
    })
    .strict();

export const routeQuerySchema = z
    .object({
        tier: z.union([z.enum(ROUTE_TIERS), z.array(z.enum(ROUTE_TIERS))]).optional(),
        category: z.union([z.enum(ROUTE_CATEGORIES), z.array(z.enum(ROUTE_CATEGORIES))]).optional(),
        featured: z.coerce.boolean().optional(),
        fromSlug: slugField.optional(),
        toSlug: slugField.optional(),
        search: z.string().trim().min(1).max(120).optional(),
        locale: localeField,
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(24)
    })
    .strict();

export const vehicleQuerySchema = z
    .object({
        vehicleClass: z.enum(VEHICLE_CLASSES).optional(),
        kind: z.enum(TRANSFER_KINDS).optional(),
        locale: localeField
    })
    .strict();

export const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(160) });

/** A detail page asks for nothing but the language to read it in. */
export const localeQuerySchema = z.object({ locale: localeField }).strict();
export const idParamSchema = z.object({ id: z.string().min(1).max(64) });
export const localeParamSchema = z.object({ id: z.string().min(1).max(64), locale: z.enum(SUPPORTED_LOCALES) });
export const referenceParamSchema = z.object({ reference: z.string().min(1).max(64) });

/** Proof that an anonymous caller is the traveller who booked. */
export const guestLookupSchema = z.object({ email: emailField.optional() });

/**
 * A confirmation request.
 *
 * The token names the journey, the vehicle and the party. Everything else here
 * is the paperwork a driver needs: who to look for, what flight they are on,
 * and which door to knock at.
 */
export const confirmTransferSchema = z
    .object({
        quoteToken: z.string().min(20).max(4000),

        leadPassenger: z
            .object({
                firstName: nameField,
                lastName: nameField,
                email: emailField,
                phone: phoneField.optional()
            })
            .strict(),

        flightNumber: z.string().trim().min(2).max(16).optional(),
        /** The flight per leg; `flightNumber` alone is the outbound's. */
        flights: z.object({ outbound: z.string().trim().min(2).max(16).nullish(), return: z.string().trim().min(2).max(16).nullish() }).strict().optional(),
        pickupAddress: textField(300).optional(),
        dropoffAddress: textField(300).optional(),
        // The same doors as a searched place, when the traveller picked one
        // rather than typing. Optional: "Terminal 1, arrivals" is still a
        // perfectly good pick-up address.
        pickupPlace: placedLocationSchema.optional(),
        dropoffPlace: placedLocationSchema.optional(),
        specialRequests: textField(1000).optional(),

        source: z.enum(['web', 'partner', 'admin']).default('web'),
        idempotencyKey: z.string().min(8).max(200).optional(),

        /**
         * A partner's choice of driver, and optionally which of their cars,
         * for every leg. Ids only: the server decides whether the driver is
         * eligible and free, and offers the job in the same transaction that
         * writes the booking. A guest sending one is a 400 — the field is a
         * partner feature, not a hint.
         */
        preferredDriverId: z.string().min(1).max(64).optional(),
        preferredFleetVehicleId: z.string().min(1).max(64).optional()
    })
    .strict()
    .refine((value) => !value.preferredFleetVehicleId || Boolean(value.preferredDriverId), {
        message: 'A car can only be chosen together with its driver',
        path: ['preferredFleetVehicleId']
    });

/**
 * An amendment.
 *
 * Deliberately narrow, and narrower than it first looks. The lead passenger,
 * how to reach them, the flight and the doors are all reachable; the journey,
 * the vehicle, the date and the party are not, because changing any of those
 * changes the fare — and a fare that changes without being re-quoted is a
 * dispute waiting to happen. Moving a transfer means cancelling and booking it
 * again, which is the same rule hotels follow.
 */
export const amendTransferSchema = z
    .object({
        leadPassenger: z
            .object({
                firstName: nameField.optional(),
                lastName: nameField.optional(),
                email: emailField.optional(),
                phone: phoneField.nullish()
            })
            .strict()
            .optional(),
        flightNumber: z.string().trim().min(2).max(16).nullish(),
        flights: z.object({ outbound: z.string().trim().min(2).max(16).nullish(), return: z.string().trim().min(2).max(16).nullish() }).strict().optional(),
        pickupAddress: textField(300).nullish(),
        dropoffAddress: textField(300).nullish(),
        pickupPlace: placedLocationSchema.nullish(),
        dropoffPlace: placedLocationSchema.nullish(),
        specialRequests: textField(1000).nullish(),
        email: emailField.optional()
    })
    .strict();

export const cancelTransferSchema = z
    .object({ reason: textField(500).optional(), email: emailField.optional() })
    .strict();

export const transferBookingQuerySchema = z
    .object({
        ...bookingFilterFields,
        partnerId: z.string().min(1).optional(),
        status: z.union([z.enum(BOOKING_STATUSES), z.array(z.enum(BOOKING_STATUSES))]).optional(),
        from: dateOnlyField.optional(),
        to: dateOnlyField.optional(),
        search: z.string().trim().min(1).max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20)
    })
    .strict();

/* ==========================================================================
   Admin
   ========================================================================== */

export const createPointSchema = z
    .object({
        slug: slugField,
        name: nameField,
        kind: z.enum(POINT_KINDS),
        iataCode: z.string().trim().toUpperCase().length(3).optional(),
        regionLabel: nameField,
        destinationId: z.string().min(1).max(64).nullish(),
        latitude: latitudeField,
        longitude: longitudeField,
        // What the place search said. Nullish rather than required because a
        // point placed by clicking the map has none, and that is still a
        // point. Never optional *instead of* the coordinates: a point without
        // a position cannot be priced against.
        place: placeRefSchema.nullish(),
        timezone: timezoneField.optional(),
        popular: z.boolean().optional(),
        image: z.string().trim().max(500).nullish()
    })
    .strict();

export const updatePointSchema = createPointSchema.partial().extend({
    // Nullable here where it is merely optional on create: a point that stops
    // being an airport has to be able to lose its code, and `.optional()` alone
    // gives no way to say "clear this" — an omitted key means "leave it".
    iataCode: z.string().trim().toUpperCase().length(3).nullish(),
    status: z.enum(TRANSFER_STATUSES).optional()
});

export const pointTranslationSchema = z
    .object({ name: nameField.nullish(), regionLabel: nameField.nullish() })
    .strict();

export const createVehicleSchema = z
    .object({
        slug: slugField,
        name: nameField,
        vehicleClass: z.enum(VEHICLE_CLASSES),
        body: z.enum(VEHICLE_BODIES),
        kind: z.enum(TRANSFER_KINDS).default('PRIVATE'),
        providerId: z.string().min(1).max(64),
        maxPassengers: z.number().int().min(1).max(80),
        maxLuggage: z.number().int().min(0).max(80),
        maxCabinBags: z.number().int().min(0).max(80).default(0),
        features: z.array(z.enum(FEATURES)).max(FEATURES.length).default([]),
        vehicleExample: nameField,
        summary: textField(400),
        description: z.array(textField(2000)).max(10).default([]),
        included: z.array(textField(300)).max(20).default([]),
        excluded: z.array(textField(300)).max(20).default([]),
        pickupProcedure: textField(1000),
        cancellationPolicyId: z.string().min(1).max(64).nullish(),
        perKmCents: centsField,
        // Strictly positive: a minimum fare of zero lets the distance engine
        // quote a free ride on a rounding error, and the database refuses it.
        minimumFareCents: z.number().int().min(1).max(100_000_000),
        airportFeeCents: centsField.default(0),
        currency: currencyField.default('GEL'),
        paceFactor: z.number().min(0.5).max(3).default(1),
        recommendedRank: z.number().int().min(0).max(999).default(0),
        b2cEnabled: z.boolean().default(false),
        partnerId: z.string().min(1).max(64).nullish()
    })
    .strict();

export const updateVehicleSchema = createVehicleSchema.partial().extend({
    status: z.enum(TRANSFER_STATUSES).optional()
});

export const vehicleTranslationSchema = z
    .object({
        name: nameField.nullish(),
        vehicleExample: nameField.nullish(),
        summary: textField(400).nullish(),
        description: z.array(textField(2000)).max(10).optional(),
        included: z.array(textField(300)).max(20).optional(),
        excluded: z.array(textField(300)).max(20).optional(),
        pickupProcedure: textField(1000).nullish()
    })
    .strict();

export const createRouteSchema = z
    .object({
        slug: slugField,
        fromPointId: z.string().min(1).max(64),
        toPointId: z.string().min(1).max(64),
        tier: z.enum(ROUTE_TIERS).default('TIER_3'),
        category: z.enum(ROUTE_CATEGORIES).default('CITY'),
        distanceKm: z.number().int().min(1).max(5000).optional(),
        durationMinutes: z.number().int().min(1).max(10_000).optional(),
        title: textField(200).nullish(),
        summary: textField(500).nullish(),
        description: z.array(textField(2000)).max(10).default([]),
        heroImage: z.string().trim().max(500).nullish(),
        featured: z.boolean().default(false)
    })
    .strict()
    .refine((value) => value.fromPointId !== value.toPointId, {
        message: 'A route must start and end in different places',
        path: ['toPointId']
    });

export const updateRouteSchema = z
    .object({
        slug: slugField.optional(),
        tier: z.enum(ROUTE_TIERS).optional(),
        category: z.enum(ROUTE_CATEGORIES).optional(),
        distanceKm: z.number().int().min(1).max(5000).optional(),
        durationMinutes: z.number().int().min(1).max(10_000).optional(),
        title: textField(200).nullish(),
        summary: textField(500).nullish(),
        description: z.array(textField(2000)).max(10).optional(),
        heroImage: z.string().trim().max(500).nullish(),
        featured: z.boolean().optional(),
        status: z.enum(TRANSFER_STATUSES).optional()
    })
    .strict();

export const routeTranslationSchema = z
    .object({
        title: textField(200).nullish(),
        summary: textField(500).nullish(),
        description: z.array(textField(2000)).max(10).optional()
    })
    .strict();

/**
 * The price grid for one route, sent whole.
 *
 * A whole-grid PUT rather than a row at a time: the panel edits a table of
 * every class against one route, and one body means a half-applied grid cannot
 * happen.
 */
export const routePricesSchema = z
    .object({
        prices: z
            .array(
                z
                    .object({
                        vehicleId: z.string().min(1).max(64),
                        oneWayCents: z.number().int().min(1).max(100_000_000),
                        returnCents: z.number().int().min(1).max(100_000_000).nullish(),
                        netCents: centsField.nullish(),
                        currency: currencyField.default('GEL'),
                        isActive: z.boolean().default(true)
                    })
                    .strict()
            )
            .max(50)
    })
    .strict();

export const routeStopsSchema = z
    .object({
        stops: z
            .array(
                z
                    .object({
                        pointId: z.string().min(1).max(64),
                        dwellMinutes: z.number().int().min(0).max(1440).default(0)
                    })
                    .strict()
            )
            .max(20)
    })
    .strict();

/**
 * The bulk price editor.
 *
 * With three hundred routes, pricing one row at a time is not a workflow. This
 * applies a per-kilometre rate, or a flat fare, across everything matching a
 * filter — and it names the filter explicitly rather than accepting "all",
 * because a mis-clicked repricing of the whole catalogue is not recoverable
 * from the panel.
 */
export const bulkPriceSchema = z
    .object({
        tier: z.union([z.enum(ROUTE_TIERS), z.array(z.enum(ROUTE_TIERS))]).optional(),
        category: z.union([z.enum(ROUTE_CATEGORIES), z.array(z.enum(ROUTE_CATEGORIES))]).optional(),
        routeIds: z.array(z.string().min(1).max(64)).max(500).optional(),
        vehicleIds: z.array(z.string().min(1).max(64)).min(1).max(50),
        perKmCents: centsField.optional(),
        flatCents: z.number().int().min(1).max(100_000_000).optional(),
        minimumCents: centsField.optional(),
        // Without this an existing price is left alone, so the editor fills
        // gaps by default and only overwrites when told to.
        overwrite: z.boolean().default(false)
    })
    .strict()
    .refine((value) => Boolean(value.perKmCents) !== Boolean(value.flatCents), {
        message: 'Give either a per-kilometre rate or a flat fare, not both',
        path: ['perKmCents']
    })
    .refine((value) => Boolean(value.tier || value.category || value.routeIds?.length), {
        message: 'Name the routes to reprice: a tier, a category, or a list of ids',
        path: ['tier']
    });

const extraFields = {
    code: z.string().trim().min(1).max(64),
    name: nameField,
    description: textField(500).nullish(),
    basis: z.enum(EXTRA_BASES),
    priceCents: centsField,
    currency: currencyField,
    appliesToClasses: z.array(z.enum(VEHICLE_CLASSES)).max(VEHICLE_CLASSES.length),
    position: z.number().int().min(0).max(999),
    isActive: z.boolean()
};

export const createExtraSchema = z
    .object({
        ...extraFields,
        basis: extraFields.basis.default('FIXED'),
        currency: extraFields.currency.default('GEL'),
        appliesToClasses: extraFields.appliesToClasses.default([]),
        position: extraFields.position.default(0),
        isActive: extraFields.isActive.default(true)
    })
    .strict();

// Built from the bare fields, not from `createExtraSchema.partial()`: zod
// fills a defaulted field in even inside a partial, and a PUT that sent only
// `{ isActive: false }` was resetting the price basis, currency, classes and
// position of the extra to their defaults.
export const updateExtraSchema = z.object(extraFields).partial().strict();

export const createBlackoutSchema = z
    .object({
        routeId: z.string().min(1).max(64).nullish(),
        vehicleId: z.string().min(1).max(64).nullish(),
        from: dateOnlyField,
        to: dateOnlyField,
        reason: textField(300).nullish()
    })
    .strict()
    .refine((value) => Boolean(value.routeId || value.vehicleId), {
        message: 'A blackout has to close something: name a route, a vehicle, or both',
        path: ['routeId']
    })
    .refine((value) => value.to >= value.from, {
        message: 'The window ends before it starts',
        path: ['to']
    });

export const blackoutQuerySchema = z
    .object({
        routeId: z.string().min(1).max(64).optional(),
        vehicleId: z.string().min(1).max(64).optional(),
        from: dateOnlyField.optional(),
        to: dateOnlyField.optional()
    })
    .strict();

export { FEATURES as TRANSFER_FEATURES, VEHICLE_CLASSES, ROUTE_TIERS, ROUTE_CATEGORIES };
