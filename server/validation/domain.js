import { z } from 'zod';

// Shapes for the Json columns in prisma/schema.prisma. Postgres will accept
// any JSON in those columns, so these schemas are the only thing standing
// between a typo and a page that crashes at render time. They mirror the
// interfaces in client/types/*.ts.

export const galleryImageSchema = z.object({
    src: z.string().min(1),
    alt: z.string().min(1)
});

export const gallerySchema = z.array(galleryImageSchema);

export const attractionSchema = z.object({
    name: z.string().min(1),
    description: z.string().min(1)
});

export const travelInfoSchema = z.object({
    bestTime: z.string().min(1),
    gettingThere: z.string().min(1),
    gettingAround: z.string().min(1),
    language: z.string().min(1)
});

export const reviewCategoryScoreSchema = z.object({
    label: z.string().min(1),
    score: z.number().min(0).max(10)
});

// Two schemas, one shape. A hotel is created as a DRAFT and filled in over
// eleven wizard steps, so the column has to accept a half-written policies
// object; refusing one would make the wizard unimplementable. Completeness is
// therefore not a storage rule but a publishing rule — `hotelPoliciesSchema`
// guards the shape on every write, and `completeHotelPoliciesSchema` is what
// the publish check runs before a hotel may go ACTIVE.
const hotelPolicyFields = {
    checkIn: z.string().min(1),
    checkOut: z.string().min(1),
    cancellation: z.string().min(1),
    children: z.string().min(1),
    pets: z.string().min(1),
    payment: z.string().min(1),
    rules: z.array(z.string().min(1))
};

export const completeHotelPoliciesSchema = z.object(hotelPolicyFields);
export const hotelPoliciesSchema = completeHotelPoliciesSchema.partial();

/**
 * A place worth knowing about near a property.
 *
 * `name`, `type` and `distance` are the original three and are still the only
 * required fields, so every row written before this comment existed still
 * validates. The rest were added for religious facilities — an observant
 * traveller needs to know *which* synagogue and how far it is on foot, not that
 * one exists — and are optional because no existing row has them.
 *
 * Deliberately still Json rather than a table. Nearby places are read whole
 * with the hotel and never queried on their own, which is exactly the rule the
 * schema states. The *filterable* half of the same fact lives elsewhere and
 * already works: `synagogueNearby` and `mikvehNearby` are amenity codes, so
 * "properties with a mikveh nearby" is an indexed filter while "which mikveh,
 * and how far" is display data. When "within 800 m" becomes a filter, this
 * becomes a table with a PostGIS point — the extension and `Hotel.geo` are
 * already there — and that is a migration, not a redesign.
 */
export const nearbyPlaceSchema = z.object({
    name: z.string().min(1),
    type: z.string().min(1),
    distance: z.string().min(1),
    /// A machine-readable kind, so the hotel page can group and icon these.
    /// `type` stays as it was: it is the operator's own wording.
    kind: z
        .enum([
            'SYNAGOGUE',
            'MIKVEH',
            'KOSHER_RESTAURANT',
            'KOSHER_SHOP',
            'ERUV',
            'AIRPORT',
            'STATION',
            'LANDMARK',
            'OTHER'
        ])
        .optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    /// Minutes on foot. The number that actually matters on a Shabbat, where a
    /// straight-line distance in kilometres does not.
    walkingMinutes: z.number().int().min(0).max(600).optional()
});

/**
 * What Google Places said about a position when somebody chose it.
 *
 * Stored beside `latitude`/`longitude` on destinations, hotels and pick-up
 * points, never instead of them: the coordinates remain what pricing, sunset
 * times and the PostGIS trigger read. This is display data — an address in
 * place of a pair of numbers — plus the place id, which is the one field
 * anything looks at again (a second point registered for the same airport).
 *
 * Every field but the id is nullable because Google does not promise any of
 * them: a trailhead has no city, and a country border post may have no
 * formatted address. Mirrors `PlaceRef` in client/types/geo.ts.
 */
export const placeRefSchema = z
    .object({
        placeId: z.string().trim().min(1).max(300),
        name: z.string().trim().max(300).nullable(),
        formattedAddress: z.string().trim().max(300).nullable(),
        city: z.string().trim().max(120).nullable(),
        region: z.string().trim().max(120).nullable(),
        countryCode: z.string().trim().toUpperCase().length(2).nullable(),
        /// Google's place types, e.g. `airport`, `lodging`. Kept so the panel
        /// can suggest a point kind; never trusted for anything else.
        types: z.array(z.string().trim().min(1).max(60)).max(20)
    })
    .strict();

/**
 * A searched door on a booking: where it is, plus what it is called. The
 * coordinates are required here, unlike on a catalogue row, because a place
 * without a position is nothing a driver can navigate to.
 */
export const placedLocationSchema = z
    .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        place: placeRefSchema.nullable()
    })
    .strict();

export const expectationStepSchema = z.object({
    title: z.string().min(1),
    description: z.string().min(1)
});

export const socialLinkSchema = z.object({
    label: z.string().min(1),
    url: z.string().min(1)
});

export const partnerDocumentSchema = z.object({
    label: z.string().min(1),
    received: z.boolean()
});

// Prefill and audit metadata are open-ended by design — the first is whatever
// subset of a form an admin filled in, the second is whatever detail an action
// is worth recording. Constrained to an object so a stray array or string
// cannot land in a column the panel will try to read keys from.
const openObjectSchema = z.record(z.string(), z.unknown());

/** A festival window on a kosher package: date-only bounds and a label. */
const restDaySchema = z
    .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        label: z.string().trim().min(1).max(120)
    })
    .strict();

/**
 * When a supplier is paid for a booking: an optional deposit and the balance.
 *
 * The balance never states an amount — it is whatever the deposit leaves,
 * so a rounding cent can never be owed twice or not at all. Each instalment
 * falls due a number of days from an anchor (negative: before it), at the
 * terms' cutoff time in the supplier's timezone. An empty list is "no
 * schedule": one undated balance, which Finance sees as "needs terms".
 */
const milestoneTiming = {
    anchor: z.enum(['CONFIRMATION', 'ARRIVAL', 'DEPARTURE']),
    offsetDays: z.number().int().min(-365).max(365)
};

const depositMilestoneSchema = z
    .object({
        kind: z.literal('DEPOSIT'),
        basis: z.enum(['PERCENT', 'FIXED']),
        // Basis points for PERCENT (3000 = 30%), minor units for FIXED.
        value: z.number().int().positive().max(100_000_000),
        ...milestoneTiming
    })
    .strict()
    .refine((milestone) => milestone.basis !== 'PERCENT' || milestone.value < 10_000, {
        message: 'A percentage deposit must be less than 100%; a full prepayment is the balance itself',
        path: ['value']
    });

const balanceMilestoneSchema = z.object({ kind: z.literal('BALANCE'), ...milestoneTiming }).strict();

export const paymentMilestonesSchema = z
    .array(z.union([depositMilestoneSchema, balanceMilestoneSchema]))
    .max(2)
    .refine(
        (list) =>
            list.length === 0 ||
            (list.filter((m) => m.kind === 'BALANCE').length === 1 && list.filter((m) => m.kind === 'DEPOSIT').length <= 1),
        { message: 'Terms are an optional deposit and exactly one balance' }
    );

// Which Json field on which model is validated by which schema. The Prisma
// extension in db/index.js walks this map on every write.
export const jsonFieldSchemas = {
    // Deep-link data and event payloads: an object, shaped by whichever
    // handler wrote it. Constrained so a stray string cannot land in a column
    // the drain reads keys from.
    Notification: {
        payload: openObjectSchema
    },
    OutboxEvent: {
        payload: openObjectSchema
    },
    SupplierPaymentTerms: {
        milestones: paymentMilestonesSchema
    },
    Destination: {
        gallery: gallerySchema,
        attractions: z.array(attractionSchema),
        // Nullable, not optional: the extension skips `undefined` but does
        // validate an explicit null, and a destination can exist before anyone
        // has written its editorial travel notes.
        travelInfo: travelInfoSchema.nullable(),
        place: placeRefSchema.nullable()
    },
    Hotel: {
        categoryScores: z.array(reviewCategoryScoreSchema),
        policies: hotelPoliciesSchema,
        nearby: z.array(nearbyPlaceSchema),
        place: placeRefSchema.nullable(),
        // Whatever the availability provider needs to identify this property
        // upstream. Shapeless by nature — one channel manager's identifiers are
        // not another's — so it is constrained to an object and no further.
        externalRef: openObjectSchema.nullable()
    },
    HotelTranslation: {
        policies: hotelPoliciesSchema.nullable()
    },
    HotelKosherProfile: {
        // A supplier payload that could not be applied because the record is
        // locked. Shapeless by nature — one channel manager's kosher fields are
        // not another's — so it is constrained to an object and no further,
        // exactly like Hotel.externalRef.
        pendingSupplierData: openObjectSchema.nullable()
    },
    Tour: {
        gallery: gallerySchema
    },
    TourBooking: {
        // Snapshots and the frozen schedule are read whole and never queried;
        // constrained to an object so a stray string cannot land in a column
        // the voucher reads keys from.
        tourSnapshot: openObjectSchema,
        priceLines: z.array(openObjectSchema),
        cancellationSchedule: openObjectSchema
    },
    ServiceBooking: {
        serviceSnapshot: openObjectSchema,
        cancellationSchedule: openObjectSchema
    },
    Package: {
        gallery: gallerySchema
    },
    PackageComponent: {
        // Soft preferences the resolver may read; never indexed, never trusted
        // for anything a real column decides.
        constraints: openObjectSchema
    },
    KosherPackageProfile: {
        extraRestDays: z.array(restDaySchema)
    },
    TransferPoint: {
        place: placeRefSchema.nullable()
    },
    TransferBooking: {
        pickupPlace: placedLocationSchema.nullable(),
        dropoffPlace: placedLocationSchema.nullable()
    },
    Order: {
        packageSnapshot: openObjectSchema
    },
    Experience: {
        gallery: gallerySchema,
        whatToExpect: z.array(expectationStepSchema)
    },
    Partner: {
        socialLinks: z.array(socialLinkSchema),
        documents: z.array(partnerDocumentSchema)
    },
    Invitation: {
        prefill: openObjectSchema
    },
    AuditLog: {
        metadata: openObjectSchema
    },
    // What was sent to the invoicing provider about a buyer, and what it sent
    // back about a document: shaped by the adapter, read whole, never queried.
    InvoicingCustomer: {
        snapshot: openObjectSchema
    },
    Invoice: {
        buyerSnapshot: openObjectSchema
    },
    InvoiceSyncEvent: {
        payload: openObjectSchema
    }
};
