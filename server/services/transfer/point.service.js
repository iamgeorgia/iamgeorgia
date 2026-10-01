import { prisma } from '../../db/index.js';
import { AUDIT_ENTITY, recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { localise } from '../../serializers/localise.js';

/**
 * Pick-up and drop-off points.
 *
 * The vocabulary the whole vertical is addressed in: a quote names two of
 * these, a route joins two of these, and a booking snapshots the names of two
 * of these. Everything else is priced against the pair.
 */

const TRANSLATED_FIELDS = ['name', 'regionLabel'];

const withTranslations = { translations: true };

/** The one place the public/admin visibility rule is written down. */
const publicScope = { status: 'ACTIVE' };

const localisePoint = (point, locale) => {
    const { translations, ...base } = point;

    return localise(base, translations, locale, TRANSLATED_FIELDS);
};

/**
 * Search for a point by name.
 *
 * Matches the base name and every translation of it, so a Russian reader typing
 * "Тбилиси" finds the same row an English one finds typing "Tbilisi". Without
 * the translation arm the picker would be unusable in three of the four
 * languages the site ships.
 */
export const listPoints = async ({ search, kind, popular, locale, includeInactive = false } = {}) => {
    const where = {
        ...(includeInactive ? {} : publicScope),
        ...(kind ? { kind } : {}),
        ...(popular === true ? { popular: true } : {}),
        ...(search
            ? {
                  OR: [
                      { name: { contains: search, mode: 'insensitive' } },
                      { regionLabel: { contains: search, mode: 'insensitive' } },
                      { iataCode: { equals: search.toUpperCase() } },
                      { translations: { some: { name: { contains: search, mode: 'insensitive' } } } }
                  ]
              }
            : {})
    };

    const points = await prisma.transferPoint.findMany({
        where,
        include: withTranslations,
        // Popular first, then alphabetically: the picker shows a short useful
        // list before anyone types, and a predictable one after.
        orderBy: [{ popular: 'desc' }, { name: 'asc' }]
    });

    return points.map((point) => localisePoint(point, locale));
};

export const findPointOr404 = async (idOrSlug, { locale, includeInactive = false } = {}) => {
    const point = await prisma.transferPoint.findFirst({
        where: {
            ...(includeInactive ? {} : publicScope),
            OR: [{ id: idOrSlug }, { slug: idOrSlug }]
        },
        include: withTranslations
    });

    if (!point) {
        throw new NotFoundError('That pick-up point does not exist');
    }

    return localisePoint(point, locale);
};

/**
 * Resolves the two ends of a journey in one query.
 *
 * One round trip rather than two, and a single 404 rather than a pair of them:
 * from the traveller's side "we do not serve that journey" is one fact, not two
 * independent ones.
 */
export const resolveEndpoints = async (fromIdOrSlug, toIdOrSlug, { locale } = {}) => {
    const points = await prisma.transferPoint.findMany({
        where: {
            ...publicScope,
            OR: [
                { id: fromIdOrSlug },
                { slug: fromIdOrSlug },
                { id: toIdOrSlug },
                { slug: toIdOrSlug }
            ]
        },
        include: withTranslations
    });

    const match = (needle) => points.find((point) => point.id === needle || point.slug === needle);
    const from = match(fromIdOrSlug);
    const to = match(toIdOrSlug);

    if (!from || !to) {
        throw new NotFoundError('We do not serve that journey yet');
    }

    if (from.id === to.id) {
        throw new ConflictError('The pick-up and drop-off points are the same place', {
            reason: 'SAME_POINT'
        });
    }

    return { from: localisePoint(from, locale), to: localisePoint(to, locale) };
};

/**
 * The same Google place may not be two live points.
 *
 * Slugs are unique, but "tbilisi-airport" and "tbs" are different slugs for
 * one terminal, and a quote between the two would price a journey of zero
 * kilometres. The place id is the one fact both registrations share. A 409
 * rather than a silent merge, and it names the other slug, because the
 * operator is usually looking for a point that already exists.
 */
const assertPlaceUnclaimed = async (tx, place, { exceptId } = {}) => {
    if (!place?.placeId) {
        return;
    }

    const claimed = await tx.transferPoint.findFirst({
        where: {
            status: { not: 'ARCHIVED' },
            place: { path: ['placeId'], equals: place.placeId },
            ...(exceptId ? { id: { not: exceptId } } : {})
        },
        select: { slug: true }
    });

    if (claimed) {
        throw new ConflictError(`That place is already registered as ${claimed.slug}`, {
            field: 'place',
            reason: 'PLACE_TAKEN',
            slug: claimed.slug
        });
    }
};

export const createPoint = async (input, actor, req) => {
    const point = await prisma.$transaction(async (tx) => {
        await assertPlaceUnclaimed(tx, input.place);

        const created = await tx.transferPoint.create({ data: input, include: withTranslations });

        await recordAudit(tx, {
            action: 'TRANSFER_POINT_CREATED',
            actor,
            entityType: AUDIT_ENTITY.transferPoint,
            entityId: created.id,
            summary: `Created pick-up point ${created.name}`,
            req
        });

        return created;
    });

    return localisePoint(point, null);
};

export const updatePoint = async (id, input, actor, req) => {
    const point = await prisma.$transaction(async (tx) => {
        const existing = await tx.transferPoint.findUnique({ where: { id } });

        if (!existing) {
            throw new NotFoundError('That pick-up point does not exist');
        }

        await assertPlaceUnclaimed(tx, input.place, { exceptId: id });

        const updated = await tx.transferPoint.update({
            where: { id },
            data: input,
            include: withTranslations
        });

        await recordAudit(tx, {
            action: 'TRANSFER_POINT_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.transferPoint,
            entityId: id,
            summary: `Updated pick-up point ${updated.name}`,
            metadata: { fields: Object.keys(input) },
            req
        });

        return updated;
    });

    return localisePoint(point, null);
};

/**
 * Retires a point.
 *
 * INACTIVE rather than a delete, because routes reference it with `Restrict`
 * and bookings reference it for reporting. A point that has ever been part of a
 * journey has to stay readable, and the lifecycle is how that is expressed —
 * the same reasoning as HotelStatus.
 */
export const deactivatePoint = async (id, actor, req) => {
    const point = await prisma.$transaction(async (tx) => {
        const existing = await tx.transferPoint.findUnique({ where: { id } });

        if (!existing) {
            throw new NotFoundError('That pick-up point does not exist');
        }

        const updated = await tx.transferPoint.update({
            where: { id },
            data: { status: 'INACTIVE' },
            include: withTranslations
        });

        await recordAudit(tx, {
            action: 'TRANSFER_POINT_DELETED',
            actor,
            entityType: AUDIT_ENTITY.transferPoint,
            entityId: id,
            summary: `Retired pick-up point ${updated.name}`,
            req
        });

        return updated;
    });

    return localisePoint(point, null);
};

export const upsertPointTranslation = async (id, locale, input) => {
    const point = await prisma.transferPoint.findUnique({ where: { id } });

    if (!point) {
        throw new NotFoundError('That pick-up point does not exist');
    }

    await prisma.transferPointTranslation.upsert({
        where: { pointId_locale: { pointId: id, locale } },
        create: { pointId: id, locale, ...input },
        update: input
    });

    return findPointOr404(id, { includeInactive: true });
};

export { localisePoint, TRANSLATED_FIELDS as POINT_TRANSLATED_FIELDS };
