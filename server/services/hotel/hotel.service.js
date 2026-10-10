import { prisma } from '../../db/index.js';
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    UnprocessableEntityError
} from '../../lib/errors.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { completeHotelPoliciesSchema } from '../../validation/domain.js';
import { removeObjectPrefix } from '../media/storage.service.js';
import { setHotelAmenities } from './amenity.service.js';
import {
    atLeastServiceLevel,
    certificationState,
    kosherInclude,
    kosherToday,
    liveCertificationWhere
} from './kosher.service.js';

/**
 * Hotels: catalogue content only.
 *
 * No price and no availability live here. That separation is what lets the
 * whole table be cached and served publicly, and it is why publishing a hotel
 * is a state transition with a completeness check rather than a boolean field
 * anyone can set.
 *
 * A hotel is never deleted. `ARCHIVED` is terminal, and archiving is refused
 * outright once the property has booking history — a booking that cannot name
 * the hotel it was made against is not a record of anything.
 */

const translationInclude = (locale) =>
    locale && locale !== 'en' ? { where: { locale }, take: 1 } : false;

const detailInclude = (locale) => ({
    destination: { include: { parent: true, translations: translationInclude(locale) } },
    supplier: { select: { id: true, reference: true, name: true, status: true, kind: true } },
    amenities: {
        include: { amenity: { include: { translations: translationInclude(locale) } } },
        orderBy: { amenity: { sortOrder: 'asc' } }
    },
    images: {
        include: { fileAsset: { include: { variants: true } } },
        orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }]
    },
    featuredImage: { include: { variants: true } },
    reviews: { orderBy: { date: 'desc' }, take: 6 },
    roomTypes: {
        where: { status: { not: 'ARCHIVED' } },
        include: {
            beds: { include: { bedType: true } },
            images: { include: { fileAsset: { include: { variants: true } } } },
            ratePlans: {
                where: { status: { not: 'ARCHIVED' } },
                include: {
                    mealPlan: true,
                    cancellationPolicy: { include: { rules: { orderBy: { hoursBeforeCheckIn: 'desc' } } } },
                    paymentPolicy: true,
                    restrictions: { orderBy: { startDate: 'asc' } }
                },
                orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
            },
            translations: translationInclude(locale)
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    },
    childPolicy: { include: { bands: { orderBy: { minAge: 'asc' } } } },
    // Optional and usually absent. A hotel with no kosher profile costs one
    // extra probe on a unique foreign key, which is not worth making the detail
    // endpoint conditional over.
    kosher: { include: kosherInclude },
    translations: translationInclude(locale)
});

/**
 * What still has to be true before this hotel may go on sale.
 *
 * Returned as a list of codes rather than a single message so the review step
 * of the wizard can render a checklist and link each line to the step that
 * fixes it. Later phases add to this list — room types in Phase 2, rate plans
 * in Phase 3, inventory and rates in Phase 4 — and nothing else has to change,
 * which is the reason it is built this way now rather than inlined.
 */
export const buildPublishChecklist = (hotel) => {
    const missing = [];

    const require = (code, message, satisfied) => {
        if (!satisfied) {
            missing.push({ code, message });
        }
    };

    require('address', 'Add a street address', Boolean(hotel.address));
    require(
        'coordinates',
        'Place the property on the map',
        hotel.latitude !== null && hotel.longitude !== null
    );
    require('shortDescription', 'Write a short description for cards and search results', Boolean(hotel.shortDescription));
    require('description', 'Write the full description', (hotel.description ?? []).length > 0);
    require(
        'policies',
        'Complete the property policies',
        completeHotelPoliciesSchema.safeParse(hotel.policies ?? {}).success
    );
    require('checkInOut', 'Set check-in and check-out times', Boolean(hotel.checkInFrom && hotel.checkOutUntil));
    require('amenities', 'Select at least one amenity', (hotel.amenities ?? []).length > 0);
    require('images', 'Upload at least one image', (hotel.images ?? []).length > 0);
    require(
        'coverImage',
        'Choose a cover image',
        (hotel.images ?? []).some((image) => image.isCover) || Boolean(hotel.featuredImageId)
    );
    require(
        'roomTypes',
        'Add at least one bookable room type',
        (hotel.roomTypes ?? []).some((roomType) => roomType.status === 'ACTIVE')
    );
    // A room with no rate plan is not for sale: there is no board, no
    // cancellation terms and nothing to attach a price to in Phase 4.
    require(
        'ratePlans',
        'Give at least one room type a rate plan',
        (hotel.roomTypes ?? []).some(
            (roomType) =>
                roomType.status === 'ACTIVE' &&
                (roomType.ratePlans ?? []).some((ratePlan) => ratePlan.status === 'ACTIVE')
        )
    );

    // Asked only of a property that claims to be partly or wholly kosher, and
    // only when it has a profile at all — an ordinary hotel never sees this
    // line. A claim that strong going on sale with nothing behind it is exactly
    // what the certification model exists to prevent, so it belongs in the
    // checklist rather than in a warning somebody can scroll past.
    if (hotel.kosher && ['PARTIAL', 'FULL'].includes(hotel.kosher.serviceLevel)) {
        const today = kosherToday(hotel.timezone);

        require(
            'kosherCertification',
            'Verify a kosher certificate, or lower the kosher service level',
            (hotel.kosher.certifications ?? []).some(
                (certification) => certificationState(certification, today) === 'VERIFIED'
            )
        );
    }

    return missing;
};

export const findHotelOr404 = async (idOrSlug, { locale, statuses, b2cOnly, access } = {}) => {
    const hotel = await prisma.hotel.findFirst({
        where: {
            OR: [{ id: idOrSlug }, { slug: idOrSlug }],
            ...(statuses ? { status: { in: statuses } } : {}),
            // 404, not 403: a B2B-only property simply does not exist on the
            // public channel, and saying more would confirm it does somewhere.
            // The same for a property a partner may not sell (`access`).
            ...(b2cOnly ? { b2cEnabled: true } : {}),
            ...(access ?? {})
        },
        include: detailInclude(locale)
    });

    if (!hotel) {
        throw new NotFoundError('Hotel not found');
    }

    return hotel;
};

const buildWhere = ({
    search,
    status,
    b2cOnly,
    destinationId,
    destinationPath,
    supplierId,
    propertyType,
    countryCode,
    featured,
    minStars,
    amenity,
    destinationSlug,
    kosher,
    kosherCertified,
    // What this partner may sell: an `id` filter from the access service.
    access,
    // The catalogue has no dates, so "today" is the platform's rather than any
    // one property's. A certificate lapsing at a Tbilisi midnight is at most a
    // few hours out of step on a browse page, and the dated search — where it
    // would actually matter — resolves it per property.
    today = kosherToday()
}) => ({
    // The sales channel. Everything is B2B by default; only records switched
    // on for B2C exist as far as an anonymous visitor is concerned.
    ...(b2cOnly ? { b2cEnabled: true } : {}),
    ...(access ?? {}),
    ...(status ? { status: { in: Array.isArray(status) ? status : [status] } } : {}),
    ...(destinationId ? { destinationId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(countryCode ? { countryCode } : {}),
    ...(featured === undefined ? {} : { featured }),
    ...(minStars ? { starRating: { gte: minStars } } : {}),
    ...(propertyType
        ? { propertyType: { in: Array.isArray(propertyType) ? propertyType : [propertyType] } }
        : {}),
    // A path prefix is how "everything in Georgia" is expressed: one indexed
    // comparison against the materialised destination path, rather than
    // resolving the subtree client-side and sending back a list of ids.
    ...(destinationPath ? { destination: { path: { startsWith: destinationPath } } } : {}),
    ...(destinationSlug ? { destination: { slug: destinationSlug } } : {}),
    // Every requested amenity must be present, so this is an AND of EXISTS
    // rather than one `in` — asking for pool and parking must not return a
    // hotel that only has parking.
    ...(amenity
        ? {
              AND: (Array.isArray(amenity) ? amenity : [amenity]).map((code) => ({
                  amenities: { some: { amenity: { code } } }
              }))
          }
        : {}),
    // The two kosher predicates. Both go through `kosher: { is: ... }` so that
    // asking for either also requires the profile to exist — a hotel with no
    // kosher record must never match a kosher filter.
    ...(kosher || kosherCertified
        ? {
              kosher: {
                  is: {
                      ...(kosher ? { serviceLevel: { in: atLeastServiceLevel(kosher) } } : {}),
                      ...(kosherCertified
                          ? { certifications: { some: liveCertificationWhere(today) } }
                          : {})
                  }
              }
          }
        : {}),
    ...(search
        ? {
              OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { slug: { contains: search, mode: 'insensitive' } },
                  { address: { contains: search, mode: 'insensitive' } }
              ]
          }
        : {})
});

export const listHotels = async (query) => {
    const { locale, page, pageSize } = query;
    const where = buildWhere(query);

    const [total, hotels] = await Promise.all([
        prisma.hotel.count({ where }),
        prisma.hotel.findMany({
            where,
            // One include for the whole page rather than a query per card. The
            // cover image is filtered in the include, so a hotel with forty
            // photos still costs one row here.
            include: {
                destination: { include: { translations: translationInclude(locale) } },
                supplier: { select: { id: true, reference: true, name: true } },
                images: {
                    where: { isCover: true },
                    take: 1,
                    include: { fileAsset: { include: { variants: true } } }
                },
                featuredImage: { include: { variants: true } },
                // Codes only, for the card icons. The narrow select keeps a
                // fifty-hotel page from dragging fifty amenity vocabularies.
                amenities: { select: { amenity: { select: { code: true, category: true } } } },
                // Enough for one honest line on a card. Archived certificates
                // are excluded here rather than in the serializer, so a hotel
                // with ten years of history still costs a handful of rows.
                kosher: { include: { certifications: { where: { archivedAt: null } } } },
                translations: translationInclude(locale),
                _count: { select: { amenities: true, images: true } }
            },
            orderBy: [{ featured: 'desc' }, { name: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { hotels, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

export const createHotel = async (input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const destination = await tx.destination.findUnique({ where: { id: input.destinationId } });

        if (!destination) {
            throw new BadRequestError('Destination does not exist', { field: 'destinationId' });
        }

        if (input.supplierId) {
            const supplier = await tx.partner.findUnique({ where: { id: input.supplierId } });

            if (!supplier) {
                throw new BadRequestError('Supplier does not exist', { field: 'supplierId' });
            }
        }

        const hotel = await tx.hotel.create({
            data: {
                slug: input.slug,
                name: input.name,
                propertyType: input.propertyType,
                destinationId: destination.id,
                supplierId: input.supplierId ?? null,
                starRating: input.starRating,
                // Inherited from where it is, unless the caller knows better.
                countryCode: input.countryCode ?? destination.countryCode,
                timezone: input.timezone ?? destination.timezone,
                currency: input.currency ?? 'GEL'
            }
        });

        await recordAudit(tx, {
            action: 'HOTEL_CREATED',
            actor,
            entityType: AUDIT_ENTITY.hotel,
            entityId: hotel.id,
            summary: `Created hotel ${hotel.name}`,
            metadata: { slug: hotel.slug, destinationId: destination.id, status: hotel.status },
            req
        });

        return hotel;
    });

export const updateHotel = async (id, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const current = await tx.hotel.findUnique({ where: { id } });

        if (!current) {
            throw new NotFoundError('Hotel not found');
        }

        if (current.status === 'ARCHIVED') {
            throw new ConflictError('An archived hotel cannot be edited', { status: current.status });
        }

        if (input.destinationId && input.destinationId !== current.destinationId) {
            const destination = await tx.destination.findUnique({ where: { id: input.destinationId } });

            if (!destination) {
                throw new BadRequestError('Destination does not exist', { field: 'destinationId' });
            }
        }

        // The image has to belong to this hotel. Without this check a cover
        // could be set to any asset id in the system, including a private one.
        if (input.featuredImageId) {
            const owned = await tx.hotelImage.findFirst({
                where: { hotelId: id, fileAssetId: input.featuredImageId }
            });

            if (!owned) {
                throw new BadRequestError('That image does not belong to this hotel', {
                    field: 'featuredImageId'
                });
            }
        }

        const hotel = await tx.hotel.update({
            where: { id },
            // Taking the pin off the map takes the place with it: an address
            // for a position that no longer exists is a lie the panel would
            // print.
            data: input.latitude === null ? { ...input, place: null } : input
        });

        await recordAudit(tx, {
            action: 'HOTEL_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.hotel,
            entityId: hotel.id,
            summary: `Updated hotel ${hotel.name}`,
            metadata: { fields: Object.keys(input) },
            req
        });

        return hotel;
    });

export const replaceHotelAmenities = async (id, entries, actor, req) =>
    prisma.$transaction(async (tx) => {
        const hotel = await tx.hotel.findUnique({ where: { id } });

        if (!hotel) {
            throw new NotFoundError('Hotel not found');
        }

        await setHotelAmenities(tx, id, entries);

        await recordAudit(tx, {
            action: 'HOTEL_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.hotel,
            entityId: id,
            summary: `Set ${entries.length} amenities on ${hotel.name}`,
            metadata: { count: entries.length },
            req
        });

        return hotel;
    });

/**
 * DRAFT or INACTIVE -> ACTIVE, if the checklist is clear.
 *
 * The 422 carries the whole checklist rather than the first failure, because
 * the review step needs to show everything that is outstanding at once — being
 * told about one missing field per attempt is a miserable way to publish a
 * property.
 */
export const publishHotel = async (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const hotel = await tx.hotel.findUnique({
            where: { id },
            include: {
                amenities: true,
                images: true,
                roomTypes: { include: { ratePlans: true } },
                // The checklist asks about certification for a property that
                // claims PARTIAL or FULL, so the check has to be able to see the
                // certificates rather than assume there are none.
                kosher: { include: { certifications: true } }
            }
        });

        if (!hotel) {
            throw new NotFoundError('Hotel not found');
        }

        if (hotel.status === 'ACTIVE') {
            throw new ConflictError('This hotel is already published', { status: hotel.status });
        }

        if (!['DRAFT', 'INACTIVE'].includes(hotel.status)) {
            throw new ConflictError(`A hotel with status ${hotel.status} cannot be published`, {
                status: hotel.status,
                allowedFrom: ['DRAFT', 'INACTIVE']
            });
        }

        const missing = buildPublishChecklist(hotel);

        if (missing.length > 0) {
            throw new UnprocessableEntityError('This hotel is not ready to publish', { missing });
        }

        const published = await tx.hotel.update({ where: { id }, data: { status: 'ACTIVE' } });

        await recordAudit(tx, {
            action: 'HOTEL_PUBLISHED',
            actor,
            entityType: AUDIT_ENTITY.hotel,
            entityId: id,
            summary: `Published hotel ${hotel.name}`,
            metadata: { from: hotel.status },
            req
        });

        return published;
    });

/** ACTIVE -> INACTIVE. Off sale, still editable, still visible to admins. */
export const unpublishHotel = async (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const hotel = await tx.hotel.findUnique({ where: { id } });

        if (!hotel) {
            throw new NotFoundError('Hotel not found');
        }

        if (hotel.status !== 'ACTIVE') {
            throw new ConflictError(`A hotel with status ${hotel.status} cannot be unpublished`, {
                status: hotel.status,
                allowedFrom: ['ACTIVE']
            });
        }

        const updated = await tx.hotel.update({ where: { id }, data: { status: 'INACTIVE' } });

        await recordAudit(tx, {
            action: 'HOTEL_UNPUBLISHED',
            actor,
            entityType: AUDIT_ENTITY.hotel,
            entityId: id,
            summary: `Took hotel ${hotel.name} off sale`,
            req
        });

        return updated;
    });

/**
 * The closest thing to a delete, and deliberately not one.
 *
 * Archiving is terminal and reversible only by an admin editing the row
 * directly. It is refused while the property has bookings that are not yet
 * finished, because the booking has to keep resolving to something.
 */
export const archiveHotel = async (id, { reason } = {}, actor, req) =>
    prisma.$transaction(async (tx) => {
        const hotel = await tx.hotel.findUnique({ where: { id } });

        if (!hotel) {
            throw new NotFoundError('Hotel not found');
        }

        if (hotel.status === 'ARCHIVED') {
            throw new ConflictError('This hotel is already archived', { status: hotel.status });
        }

        const archived = await tx.hotel.update({ where: { id }, data: { status: 'ARCHIVED' } });

        await recordAudit(tx, {
            action: 'HOTEL_ARCHIVED',
            actor,
            entityType: AUDIT_ENTITY.hotel,
            entityId: id,
            summary: `Archived hotel ${hotel.name}`,
            metadata: { from: hotel.status, ...(reason ? { reason } : {}) },
            req
        });

        return archived;
    });

/**
 * Hard delete — the one exception to "a hotel is never deleted", and open only
 * while the property has no booking history at all. Any booking, cancelled
 * ones included, blocks it: a booking must keep resolving to the hotel it was
 * made against, so a property that has ever been sold gets archived instead.
 *
 * Gallery and room images go with the hotel — rows in the transaction, stored
 * bytes after commit — but only assets nothing else references. An asset that
 * is also attached elsewhere stays in the media library untouched.
 */
export const deleteHotel = async (id, actor, req) => {
    const orphanedAssets = await prisma.$transaction(async (tx) => {
        const hotel = await tx.hotel.findUnique({
            where: { id },
            include: {
                images: { select: { fileAssetId: true } },
                roomTypes: { select: { images: { select: { fileAssetId: true } } } }
            }
        });

        if (!hotel) {
            throw new NotFoundError('Hotel not found');
        }

        const bookings = await tx.hotelBooking.count({ where: { hotelId: id } });

        if (bookings > 0) {
            throw new ConflictError(
                'A hotel with booking history cannot be deleted — archive it instead',
                { bookings }
            );
        }

        const assetIds = [
            ...new Set([
                ...hotel.images.map((image) => image.fileAssetId),
                ...hotel.roomTypes.flatMap((roomType) =>
                    roomType.images.map((image) => image.fileAssetId)
                )
            ])
        ];

        // Cascades take room types, rate plans, rates, inventory, holds, the
        // gallery join rows, reviews, pricing rules and translations with it.
        await tx.hotel.delete({ where: { id } });

        // With the join rows gone, keep only the assets that are now
        // referenced by nothing anywhere before deleting them for good.
        const orphaned =
            assetIds.length === 0
                ? []
                : await tx.fileAsset.findMany({
                      where: {
                          id: { in: assetIds },
                          hotelImages: { none: {} },
                          roomTypeImages: { none: {} },
                          hotelDocuments: { none: {} },
                          featuredForHotels: { none: {} }
                      },
                      select: { id: true, objectKey: true, visibility: true }
                  });

        if (orphaned.length > 0) {
            await tx.fileAsset.deleteMany({ where: { id: { in: orphaned.map((asset) => asset.id) } } });
        }

        await recordAudit(tx, {
            action: 'HOTEL_DELETED',
            actor,
            entityType: AUDIT_ENTITY.hotel,
            entityId: id,
            summary: `Deleted hotel ${hotel.name}`,
            metadata: { slug: hotel.slug, status: hotel.status, assetsRemoved: orphaned.length },
            req
        });

        return orphaned;
    });

    // Bytes last and best-effort: a failed storage call must not resurrect the
    // rows. An asset's original and every rendition share one folder, so one
    // prefix delete per asset clears them all. A failure is logged with the
    // prefix, because an object nothing references any more is otherwise
    // invisible — and paid for — until someone audits the bucket.
    await Promise.all(
        orphanedAssets.map((asset) => {
            const slash = asset.objectKey.lastIndexOf('/');
            const prefix = slash === -1 ? asset.objectKey : asset.objectKey.slice(0, slash);

            return removeObjectPrefix({ prefix, visibility: asset.visibility }).catch((err) =>
                logger.warn(
                    { err, prefix, visibility: asset.visibility, hotelId: id },
                    'Could not remove the objects of a deleted hotel'
                )
            );
        })
    );
};

export const upsertHotelTranslation = async (id, locale, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const hotel = await tx.hotel.findUnique({ where: { id } });

        if (!hotel) {
            throw new NotFoundError('Hotel not found');
        }

        const translation = await tx.hotelTranslation.upsert({
            where: { hotelId_locale: { hotelId: id, locale } },
            create: { hotelId: id, locale, ...input },
            update: input
        });

        await recordAudit(tx, {
            action: 'HOTEL_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.hotel,
            entityId: id,
            summary: `Updated ${locale} translation for ${hotel.name}`,
            metadata: { locale, fields: Object.keys(input) },
            req
        });

        return translation;
    });
