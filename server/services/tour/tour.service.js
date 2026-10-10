import { prisma } from '../../db/index.js';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { dateOnlyToUtc, todayInTimezone } from '../../lib/time.js';
import { createGallery } from '../hotel/gallery.service.js';
import { optionInclude } from './option.service.js';

/**
 * Tours: the catalogue record.
 *
 * Content, lifecycle, translations and the gallery live here; options, price
 * sheets and departures live in their own services beneath it, exactly as
 * room types and rates sit beneath a hotel. A tour is created as a DRAFT
 * from the handful of things an operator knows first and completed at
 * publish, where the checklist says what is still missing.
 */

const translationInclude = (locale) => (locale && locale !== 'en' ? { where: { locale }, take: 1 } : false);

/** The prose a translation may replace. Nothing that is not language. */
export const TOUR_TRANSLATABLE_FIELDS = [
    'title',
    'location',
    'summary',
    'description',
    'highlights',
    'included',
    'excluded',
    'importantInfo',
    'meetingPoint',
    'durationLabel',
    'groupSize'
];

export const summaryInclude = (locale) => ({
    destination: { include: { translations: translationInclude(locale) } },
    supplier: { select: { id: true, reference: true, name: true } },
    images: {
        where: { isCover: true },
        take: 1,
        include: { fileAsset: { include: { variants: true } } }
    },
    translations: translationInclude(locale)
});

const detailInclude = (locale, { includePartnerOnly = true } = {}) => ({
    ...summaryInclude(locale),
    meetingPointRef: { select: { id: true, slug: true, name: true, kind: true, timezone: true } },
    itinerary: { orderBy: { day: 'asc' } },
    images: {
        orderBy: { sortOrder: 'asc' },
        include: { fileAsset: { include: { variants: true } } }
    },
    options: {
        where: {
            status: { not: 'ARCHIVED' },
            ...(includePartnerOnly ? {} : { visibility: 'PUBLIC' })
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: optionInclude
    }
});

/**
 * What a tour still needs before it can be sold.
 *
 * Every line is returned rather than the first failure, because the review
 * step needs to show everything that is outstanding at once.
 */
export const buildTourPublishChecklist = (tour, { today, hasFutureDeparture } = {}) => {
    const missing = [];
    const require = (code, message, ok) => {
        if (!ok) {
            missing.push({ code, message });
        }
    };

    const activeOptions = (tour.options ?? []).filter((option) => option.status === 'ACTIVE');

    require('summary', 'Write a summary for cards and search results', Boolean(tour.summary));
    require('description', 'Write the full description', (tour.description ?? []).length > 0);
    require('meetingPoint', 'Say where the day starts', Boolean(tour.meetingPoint));
    require('itinerary', 'Add at least one itinerary day', (tour.itinerary ?? []).length > 0);
    require(
        'coverImage',
        'Upload an image or choose a cover',
        Boolean(tour.image) || (tour.images ?? []).some((image) => image.isCover)
    );
    require('options', 'Add at least one active option', activeOptions.length > 0);
    // An option with no price sheet is not for sale: there is nothing to quote.
    require(
        'seasons',
        'Give at least one active option a price sheet',
        activeOptions.some((option) =>
            (option.seasons ?? []).some((season) => season.isActive !== false && (season.tiers ?? []).length > 0)
        )
    );
    // And nothing to claim: a departure has to exist before it can be sold.
    require(
        'departures',
        'Add capacity for at least one future departure',
        hasFutureDeparture ??
            activeOptions.some((option) =>
                (option.inventory ?? []).some(
                    (row) => row.totalUnits > 0 && !row.stopSell && (!today || row.date >= dateOnlyToUtc(today))
                )
            )
    );

    return missing;
};

export const findTourOr404 = async (idOrSlug, { locale, statuses, b2cOnly, includePartnerOnly = true, access } = {}) => {
    const tour = await prisma.tour.findFirst({
        where: {
            OR: [{ id: idOrSlug }, { slug: idOrSlug }],
            ...(statuses ? { status: { in: statuses } } : {}),
            // 404, not 403: a B2B-only tour simply does not exist on the
            // public channel, nor does one a partner may not sell.
            ...(b2cOnly ? { b2cEnabled: true } : {}),
            ...(access ?? {})
        },
        include: detailInclude(locale, { includePartnerOnly })
    });

    if (!tour) {
        throw new NotFoundError('Tour not found');
    }

    return tour;
};

const buildWhere = ({
    search,
    status,
    b2cOnly,
    destinationId,
    destinationSlug,
    destinationPath,
    supplierId,
    category,
    difficulty,
    minDays,
    maxDays,
    featured,
    access
}) => ({
    ...(b2cOnly ? { b2cEnabled: true } : {}),
    ...(access ?? {}),
    ...(status ? { status: { in: Array.isArray(status) ? status : [status] } } : {}),
    ...(destinationId ? { destinationId } : {}),
    ...(destinationSlug ? { destination: { slug: destinationSlug } } : {}),
    ...(destinationPath ? { destination: { path: { startsWith: destinationPath } } } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(category ? { category: { in: Array.isArray(category) ? category : [category] } } : {}),
    ...(difficulty ? { difficulty: { in: Array.isArray(difficulty) ? difficulty : [difficulty] } } : {}),
    ...(minDays || maxDays
        ? { durationDays: { ...(minDays ? { gte: minDays } : {}), ...(maxDays ? { lte: maxDays } : {}) } }
        : {}),
    ...(featured === undefined ? {} : { featured }),
    ...(search
        ? {
              OR: [
                  { title: { contains: search, mode: 'insensitive' } },
                  { location: { contains: search, mode: 'insensitive' } },
                  { slug: { contains: search, mode: 'insensitive' } }
              ]
          }
        : {})
});

export const listTours = async (query) => {
    const { page = 1, pageSize = 24, locale } = query;
    const where = buildWhere(query);

    const [total, tours] = await Promise.all([
        prisma.tour.count({ where }),
        prisma.tour.findMany({
            where,
            include: summaryInclude(locale),
            orderBy: [{ featured: 'desc' }, { title: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { tours, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

const itineraryRows = (days = []) =>
    days.map((day) => ({
        day: day.day,
        title: day.title,
        description: day.description,
        meals: day.meals ?? [],
        accommodation: day.accommodation ?? ''
    }));

export const createTour = async (input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const destination = await tx.destination.findUnique({ where: { id: input.destinationId } });

        if (!destination) {
            throw new NotFoundError('Destination not found');
        }

        const { itinerary, ...fields } = input;

        const tour = await tx.tour.create({
            data: {
                ...fields,
                // The destination's clock unless told otherwise: "08:00 in
                // Kazbegi" is what the meeting time means.
                timezone: input.timezone ?? destination.timezone,
                itinerary: { create: itineraryRows(itinerary) }
            },
            include: detailInclude()
        });

        await recordAudit(tx, {
            action: 'TOUR_CREATED',
            actor,
            entityType: AUDIT_ENTITY.tour,
            entityId: tour.id,
            summary: `Created tour ${tour.title}`,
            metadata: { slug: tour.slug, destinationId: tour.destinationId },
            req
        });

        return tour;
    });

export const updateTour = async (id, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const current = await tx.tour.findUnique({ where: { id } });

        if (!current) {
            throw new NotFoundError('Tour not found');
        }

        if (current.status === 'ARCHIVED') {
            throw new ConflictError('An archived tour cannot be edited', { status: current.status });
        }

        if (input.destinationId) {
            const destination = await tx.destination.findUnique({ where: { id: input.destinationId } });

            if (!destination) {
                throw new NotFoundError('Destination not found');
            }
        }

        const { itinerary, ...fields } = input;

        // The itinerary is replaced whole: days only make sense as a sequence.
        if (itinerary !== undefined) {
            await tx.itineraryDay.deleteMany({ where: { tourId: id } });
        }

        const tour = await tx.tour.update({
            where: { id },
            data: {
                ...fields,
                ...(itinerary !== undefined ? { itinerary: { create: itineraryRows(itinerary) } } : {})
            },
            include: detailInclude()
        });

        await recordAudit(tx, {
            action: 'TOUR_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.tour,
            entityId: id,
            summary: `Updated tour ${tour.title}`,
            metadata: { fields: Object.keys(input) },
            req
        });

        return tour;
    });

/** DRAFT or INACTIVE -> ACTIVE, if the checklist is clear. */
export const publishTour = async (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const tour = await tx.tour.findUnique({
            where: { id },
            include: {
                itinerary: true,
                images: true,
                options: { include: { seasons: { include: { tiers: true } } } }
            }
        });

        if (!tour) {
            throw new NotFoundError('Tour not found');
        }

        // One indexed probe rather than loading a year of departures.
        const today = todayInTimezone(tour.timezone);
        const futureDeparture = await tx.tourInventory.findFirst({
            where: {
                tourOption: { tourId: id, status: 'ACTIVE' },
                totalUnits: { gt: 0 },
                stopSell: false,
                date: { gte: dateOnlyToUtc(today) }
            },
            select: { date: true }
        });

        if (tour.status === 'ACTIVE') {
            throw new ConflictError('This tour is already published', { status: tour.status });
        }

        if (!['DRAFT', 'INACTIVE'].includes(tour.status)) {
            throw new ConflictError(`A tour with status ${tour.status} cannot be published`, {
                status: tour.status,
                allowedFrom: ['DRAFT', 'INACTIVE']
            });
        }

        const missing = buildTourPublishChecklist(tour, { today, hasFutureDeparture: Boolean(futureDeparture) });

        if (missing.length > 0) {
            throw new UnprocessableEntityError('This tour is not ready to publish', { missing });
        }

        const published = await tx.tour.update({ where: { id }, data: { status: 'ACTIVE' } });

        await recordAudit(tx, {
            action: 'TOUR_PUBLISHED',
            actor,
            entityType: AUDIT_ENTITY.tour,
            entityId: id,
            summary: `Published tour ${tour.title}`,
            metadata: { from: tour.status },
            req
        });

        return published;
    });

/** ACTIVE -> INACTIVE. Off sale, still editable. */
export const unpublishTour = async (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const tour = await tx.tour.findUnique({ where: { id } });

        if (!tour) {
            throw new NotFoundError('Tour not found');
        }

        if (tour.status !== 'ACTIVE') {
            throw new ConflictError(`A tour with status ${tour.status} cannot be unpublished`, {
                status: tour.status
            });
        }

        const updated = await tx.tour.update({ where: { id }, data: { status: 'INACTIVE' } });

        await recordAudit(tx, {
            action: 'TOUR_UNPUBLISHED',
            actor,
            entityType: AUDIT_ENTITY.tour,
            entityId: id,
            summary: `Unpublished tour ${tour.title}`,
            metadata: {},
            req
        });

        return updated;
    });

/** Retired for good; bookings against it survive. */
export const archiveTour = async (id, { reason } = {}, actor, req) =>
    prisma.$transaction(async (tx) => {
        const tour = await tx.tour.findUnique({ where: { id } });

        if (!tour) {
            throw new NotFoundError('Tour not found');
        }

        if (tour.status === 'ARCHIVED') {
            throw new ConflictError('This tour is already archived', { status: tour.status });
        }

        const updated = await tx.tour.update({ where: { id }, data: { status: 'ARCHIVED' } });

        await recordAudit(tx, {
            action: 'TOUR_ARCHIVED',
            actor,
            entityType: AUDIT_ENTITY.tour,
            entityId: id,
            summary: `Archived tour ${tour.title}`,
            metadata: { from: tour.status, ...(reason ? { reason } : {}) },
            req
        });

        return updated;
    });

/** Hard delete, only ever for a tour nothing was booked against. */
export const deleteTour = async (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const tour = await tx.tour.findUnique({ where: { id }, include: { _count: { select: { bookings: true } } } });

        if (!tour) {
            throw new NotFoundError('Tour not found');
        }

        if (tour._count.bookings > 0) {
            throw new ConflictError('A tour with bookings cannot be deleted; archive it instead', {
                reason: 'HAS_BOOKINGS',
                bookings: tour._count.bookings
            });
        }

        // The audit row first, before the row it describes is gone.
        await recordAudit(tx, {
            action: 'TOUR_DELETED',
            actor,
            entityType: AUDIT_ENTITY.tour,
            entityId: id,
            summary: `Deleted tour ${tour.title}`,
            metadata: { slug: tour.slug, status: tour.status },
            req
        });

        await tx.tour.delete({ where: { id } });

        return tour;
    });

/** Every translation a tour has, for the editor; English lives on the tour itself. */
export const listTourTranslations = async (id) => {
    await findTourOr404(id, { statuses: null, includePartnerOnly: true });

    return prisma.tourTranslation.findMany({ where: { tourId: id }, orderBy: { locale: 'asc' } });
};

export const upsertTourTranslation = async (id, locale, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const tour = await tx.tour.findUnique({ where: { id } });

        if (!tour) {
            throw new NotFoundError('Tour not found');
        }

        const translation = await tx.tourTranslation.upsert({
            where: { tourId_locale: { tourId: id, locale } },
            create: { tourId: id, locale, ...input },
            update: input
        });

        await recordAudit(tx, {
            action: 'TOUR_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.tour,
            entityId: id,
            summary: `Updated ${locale} translation of ${tour.title}`,
            metadata: { locale, fields: Object.keys(input) },
            req
        });

        return translation;
    });

/** The tour's uploaded gallery, driven by the same service as a hotel's. */
export const tourGallery = createGallery({
    imageDelegate: 'tourImage',
    ownerDelegate: 'tour',
    ownerField: 'tourId',
    ownerLabel: 'Tour',
    auditEntity: AUDIT_ENTITY.tour,
    auditAction: 'TOUR_UPDATED',
    ownerName: (tour) => tour.title,
    // A tour's headline image is its cover; there is no separate column.
    mainImageField: null
});
