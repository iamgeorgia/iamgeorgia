import { prisma } from '../../db/index.js';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { dateOnlyToUtc, todayInTimezone } from '../../lib/time.js';
import { createGallery } from '../hotel/gallery.service.js';
import { validateKosherTemplate } from './kosherEligibility.service.js';

/**
 * Packages: the template record.
 *
 * A package is a length, a destination, a price adjustment and an ordered set
 * of typed slots. Nothing on it is a price: the slots resolve to live offers
 * when the package is quoted for a date and a party (`quote.service.js`).
 * What this file guards is that a template makes sense before it is sold —
 * every fixed product exists, is ACTIVE and is in the package currency, the
 * days fit inside the length, and a kosher template's fixed hotels are
 * eligible today.
 */

export const PACKAGE_TRANSLATABLE_FIELDS = ['name', 'summary', 'description'];

const translationInclude = (locale) => (locale && locale !== 'en' ? { where: { locale }, take: 1 } : false);

export const componentInclude = {
    hotel: { select: { id: true, slug: true, name: true, status: true, currency: true, destinationId: true } },
    fromPoint: { select: { id: true, slug: true, name: true, status: true } },
    toPoint: { select: { id: true, slug: true, name: true, status: true } },
    route: { select: { id: true, slug: true, title: true, status: true, fromPointId: true, toPointId: true } },
    tour: { select: { id: true, slug: true, title: true, status: true, currency: true, kosher: true } },
    service: { select: { id: true, slug: true, name: true, status: true, currency: true, basis: true, confirmationMode: true } }
};

export const summaryInclude = (locale) => ({
    destination: { include: { translations: translationInclude(locale) } },
    images: { where: { isCover: true }, take: 1, include: { fileAsset: { include: { variants: true } } } },
    translations: translationInclude(locale),
    kosher: true,
    _count: { select: { components: true } }
});

export const detailInclude = (locale) => ({
    ...summaryInclude(locale),
    images: { orderBy: { sortOrder: 'asc' }, include: { fileAsset: { include: { variants: true } } } },
    components: { orderBy: { slotIndex: 'asc' }, include: componentInclude }
});

const buildWhere = ({ search, status, b2cOnly, destinationId, destinationSlug, destinationPath, kosher, minNights, maxNights, featured, access }) => ({
    ...(b2cOnly ? { b2cEnabled: true } : {}),
    ...(access ?? {}),
    ...(status ? { status: { in: Array.isArray(status) ? status : [status] } } : {}),
    ...(destinationId ? { destinationId } : {}),
    ...(destinationSlug ? { destination: { slug: destinationSlug } } : {}),
    ...(destinationPath ? { destination: { path: { startsWith: destinationPath } } } : {}),
    ...(kosher === undefined ? {} : kosher ? { kosher: { isNot: null } } : { kosher: null }),
    ...(minNights || maxNights
        ? { nights: { ...(minNights ? { gte: minNights } : {}), ...(maxNights ? { lte: maxNights } : {}) } }
        : {}),
    ...(featured === undefined ? {} : { featured }),
    ...(search
        ? {
              OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { slug: { contains: search, mode: 'insensitive' } }
              ]
          }
        : {})
});

export const listPackages = async (query) => {
    const { page = 1, pageSize = 24, locale } = query;
    const where = buildWhere(query);

    const [total, packages] = await Promise.all([
        prisma.package.count({ where }),
        prisma.package.findMany({
            where,
            include: summaryInclude(locale),
            orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { packages, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

export const findPackageOr404 = async (idOrSlug, { locale, statuses, b2cOnly, access } = {}) => {
    const pkg = await prisma.package.findFirst({
        where: {
            OR: [{ id: idOrSlug }, { slug: idOrSlug }],
            ...(statuses ? { status: { in: statuses } } : {}),
            ...(b2cOnly ? { b2cEnabled: true } : {}),
            ...(access ?? {})
        },
        include: detailInclude(locale)
    });

    if (!pkg) {
        throw new NotFoundError('Package not found');
    }

    return pkg;
};

// --- template validation -------------------------------------------------------

const TYPE_KEYS = {
    HOTEL_STAY: ['hotelId', 'allowedRoomTypeIds', 'allowedRatePlanIds', 'allowedMealPlanCodes', 'nights', 'kosherMinServiceLevel', 'kosherCertifiedRequired', 'kosherCertificationScopes'],
    TRANSFER: ['fromPointId', 'toPointId', 'routeId', 'allowedVehicleClasses', 'tripType'],
    TOUR: ['tourId', 'allowedTourOptionIds'],
    SERVICE: ['serviceId']
};

/** A slot input reduced to the columns its type owns, everything else cleared. */
const componentRow = (input, index) => {
    const own = new Set(TYPE_KEYS[input.componentType]);
    const pick = (key, fallback) => (own.has(key) ? (input[key] ?? fallback) : fallback);

    return {
        slotIndex: index,
        componentType: input.componentType,
        label: input.label,
        required: input.required ?? true,
        dayOffset: input.dayOffset ?? 0,
        nights: pick('nights', null),
        timeOfDay: input.timeOfDay ?? null,
        quantityRule: input.quantityRule ?? 'ONE',
        hotelId: pick('hotelId', null),
        allowedRoomTypeIds: pick('allowedRoomTypeIds', []),
        allowedRatePlanIds: pick('allowedRatePlanIds', []),
        allowedMealPlanCodes: pick('allowedMealPlanCodes', []),
        fromPointId: pick('fromPointId', null),
        toPointId: pick('toPointId', null),
        routeId: pick('routeId', null),
        allowedVehicleClasses: pick('allowedVehicleClasses', []),
        tripType: pick('tripType', null),
        tourId: pick('tourId', null),
        allowedTourOptionIds: pick('allowedTourOptionIds', []),
        serviceId: pick('serviceId', null),
        kosherMinServiceLevel: pick('kosherMinServiceLevel', null),
        kosherCertifiedRequired: pick('kosherCertifiedRequired', null),
        kosherCertificationScopes: pick('kosherCertificationScopes', []),
        constraints: input.constraints ?? {}
    };
};

/**
 * Every fixed product a slot names must exist, be sellable and share the
 * package currency. Reported as one 422 naming every problem: an admin
 * fixing a five-slot template should not learn about the slots one at a time.
 */
const validateComponents = async (client, pkg, rows) => {
    const problems = [];
    const problem = (slotIndex, code, message) => problems.push({ slotIndex, code, message });

    for (const row of rows) {
        if (row.componentType === 'HOTEL_STAY') {
            if (row.dayOffset + row.nights > Math.max(pkg.nights, 1)) {
                problem(row.slotIndex, 'OUTSIDE_PACKAGE', `The stay runs past the package's ${pkg.nights} nights`);
            }

            if (row.hotelId) {
                const hotel = await client.hotel.findUnique({ where: { id: row.hotelId }, select: { status: true, currency: true, name: true } });

                if (!hotel) problem(row.slotIndex, 'NOT_FOUND', 'Hotel not found');
                else if (hotel.status !== 'ACTIVE') problem(row.slotIndex, 'INACTIVE', `${hotel.name} is not on sale`);
                else if (hotel.currency !== pkg.currency) problem(row.slotIndex, 'CURRENCY', `${hotel.name} is priced in ${hotel.currency}, the package in ${pkg.currency}`);
            }
        } else if (row.dayOffset > pkg.nights) {
            problem(row.slotIndex, 'OUTSIDE_PACKAGE', `Day ${row.dayOffset} is past the end of a ${pkg.nights}-night package`);
        }

        if (row.componentType === 'TRANSFER') {
            if (row.routeId) {
                const route = await client.transferRoute.findUnique({ where: { id: row.routeId }, select: { status: true } });

                if (!route) problem(row.slotIndex, 'NOT_FOUND', 'Route not found');
                else if (route.status !== 'ACTIVE') problem(row.slotIndex, 'INACTIVE', 'That route is not on sale');
            } else if (!row.fromPointId || !row.toPointId) {
                problem(row.slotIndex, 'ENDPOINTS', 'A transfer slot needs a route or both pick-up points');
            } else {
                const points = await client.transferPoint.findMany({
                    where: { id: { in: [row.fromPointId, row.toPointId] } },
                    select: { id: true, status: true }
                });

                if (points.length !== 2) problem(row.slotIndex, 'NOT_FOUND', 'Pick-up point not found');
                else if (points.some((point) => point.status !== 'ACTIVE')) problem(row.slotIndex, 'INACTIVE', 'A pick-up point is retired');
            }
        }

        if (row.componentType === 'TOUR') {
            if (!row.tourId) {
                problem(row.slotIndex, 'TOUR', 'A tour slot needs a tour');
            } else {
                const tour = await client.tour.findUnique({
                    where: { id: row.tourId },
                    select: { status: true, currency: true, title: true, options: { where: { status: 'ACTIVE' }, select: { id: true } } }
                });

                if (!tour) problem(row.slotIndex, 'NOT_FOUND', 'Tour not found');
                else if (tour.status !== 'ACTIVE') problem(row.slotIndex, 'INACTIVE', `${tour.title} is not on sale`);
                else if (tour.currency !== pkg.currency) problem(row.slotIndex, 'CURRENCY', `${tour.title} is priced in ${tour.currency}`);
                else if (row.allowedTourOptionIds.length > 0 && !row.allowedTourOptionIds.some((id) => tour.options.some((option) => option.id === id))) {
                    problem(row.slotIndex, 'OPTIONS', 'None of the allowed options is active');
                }
            }
        }

        if (row.componentType === 'SERVICE') {
            const service = await client.service.findUnique({ where: { id: row.serviceId }, select: { status: true, currency: true, name: true } });

            if (!service) problem(row.slotIndex, 'NOT_FOUND', 'Service not found');
            else if (service.status !== 'ACTIVE') problem(row.slotIndex, 'INACTIVE', `${service.name} is not on sale`);
            else if (service.currency !== pkg.currency) problem(row.slotIndex, 'CURRENCY', `${service.name} is priced in ${service.currency}`);
        }
    }

    if (problems.length > 0) {
        throw new UnprocessableEntityError('Some slots cannot be sold as written', { problems });
    }
};

export const buildPackagePublishChecklist = (pkg) => {
    const missing = [];
    const require = (code, message, ok) => {
        if (!ok) {
            missing.push({ code, message });
        }
    };

    const components = pkg.components ?? [];

    require('summary', 'Write a summary', Boolean(pkg.summary));
    require('components', 'Add at least one required slot', components.some((component) => component.required));
    require(
        'coverImage',
        'Upload an image or choose a cover',
        Boolean(pkg.image) || (pkg.images ?? []).some((image) => image.isCover)
    );
    require(
        'adjustment',
        'A fixed price needs a value',
        pkg.adjustmentKind === 'NONE' || pkg.adjustmentValue > 0
    );

    return missing;
};

// --- CRUD --------------------------------------------------------------------

export const createPackage = async (input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const destination = await tx.destination.findUnique({ where: { id: input.destinationId } });

        if (!destination) {
            throw new NotFoundError('Destination not found');
        }

        const { components, ...fields } = input;
        const rows = (components ?? []).map(componentRow);
        const draft = { ...fields, timezone: input.timezone ?? destination.timezone, currency: input.currency ?? 'GEL' };

        await validateComponents(tx, draft, rows);

        const pkg = await tx.package.create({
            data: { ...draft, components: { create: rows } },
            include: detailInclude()
        });

        await recordAudit(tx, {
            action: 'PACKAGE_CREATED',
            actor,
            entityType: AUDIT_ENTITY.package,
            entityId: pkg.id,
            summary: `Created package ${pkg.name}`,
            metadata: { slug: pkg.slug, destinationId: pkg.destinationId, slots: rows.length },
            req
        });

        return pkg;
    });

export const updatePackage = async (id, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const current = await tx.package.findUnique({ where: { id }, include: { components: true, kosher: true } });

        if (!current) {
            throw new NotFoundError('Package not found');
        }

        if (current.status === 'ARCHIVED') {
            throw new ConflictError('An archived package cannot be edited', { status: current.status });
        }

        if (input.destinationId) {
            const destination = await tx.destination.findUnique({ where: { id: input.destinationId } });

            if (!destination) {
                throw new NotFoundError('Destination not found');
            }
        }

        const { components, ...fields } = input;
        const merged = { ...current, ...fields };
        const rows = components === undefined ? null : components.map(componentRow);

        await validateComponents(tx, merged, rows ?? current.components);

        // Slots are replaced whole: an ordered list only makes sense as one.
        if (rows) {
            await tx.packageComponent.deleteMany({ where: { packageId: id } });
        }

        const pkg = await tx.package.update({
            where: { id },
            data: { ...fields, ...(rows ? { components: { create: rows } } : {}) },
            include: detailInclude()
        });

        if (pkg.kosher) {
            const { blockers } = await validateKosherTemplate(tx, pkg, pkg.kosher, { today: todayInTimezone(pkg.timezone) });

            if (blockers.length > 0) {
                throw new UnprocessableEntityError('A fixed hotel no longer meets the kosher profile', {
                    reason: 'KOSHER_INELIGIBLE',
                    blockers
                });
            }
        }

        await recordAudit(tx, {
            action: 'PACKAGE_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.package,
            entityId: id,
            summary: `Updated package ${pkg.name}`,
            metadata: { fields: Object.keys(input) },
            req
        });

        return pkg;
    });

export const publishPackage = async (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const pkg = await tx.package.findUnique({ where: { id }, include: detailInclude() });

        if (!pkg) {
            throw new NotFoundError('Package not found');
        }

        if (pkg.status === 'ACTIVE') {
            throw new ConflictError('This package is already published', { status: pkg.status });
        }

        if (!['DRAFT', 'INACTIVE'].includes(pkg.status)) {
            throw new ConflictError(`A package with status ${pkg.status} cannot be published`, { status: pkg.status });
        }

        const missing = buildPackagePublishChecklist(pkg);

        if (missing.length > 0) {
            throw new UnprocessableEntityError('This package is not ready to publish', { missing });
        }

        await validateComponents(tx, pkg, pkg.components);

        const published = await tx.package.update({ where: { id }, data: { status: 'ACTIVE' }, include: detailInclude() });

        await recordAudit(tx, {
            action: 'PACKAGE_PUBLISHED',
            actor,
            entityType: AUDIT_ENTITY.package,
            entityId: id,
            summary: `Published package ${pkg.name}`,
            metadata: { from: pkg.status },
            req
        });

        return published;
    });

const transition = (action, from, to, verb) => async (id, actor, req, { reason } = {}) =>
    prisma.$transaction(async (tx) => {
        const pkg = await tx.package.findUnique({ where: { id } });

        if (!pkg) {
            throw new NotFoundError('Package not found');
        }

        if (!from.includes(pkg.status)) {
            throw new ConflictError(`A package with status ${pkg.status} cannot be ${verb}`, { status: pkg.status, allowedFrom: from });
        }

        const updated = await tx.package.update({ where: { id }, data: { status: to }, include: detailInclude() });

        await recordAudit(tx, {
            action,
            actor,
            entityType: AUDIT_ENTITY.package,
            entityId: id,
            summary: `${verb[0].toUpperCase()}${verb.slice(1)} package ${pkg.name}`,
            metadata: { from: pkg.status, ...(reason ? { reason } : {}) },
            req
        });

        return updated;
    });

export const unpublishPackage = transition('PACKAGE_UNPUBLISHED', ['ACTIVE'], 'INACTIVE', 'unpublished');
export const archivePackage = transition('PACKAGE_ARCHIVED', ['DRAFT', 'ACTIVE', 'INACTIVE'], 'ARCHIVED', 'archived');

export const deletePackage = async (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const pkg = await tx.package.findUnique({ where: { id }, include: { _count: { select: { orders: true } } } });

        if (!pkg) {
            throw new NotFoundError('Package not found');
        }

        if (pkg._count.orders > 0) {
            throw new ConflictError('A package with orders cannot be deleted; archive it instead', {
                reason: 'HAS_ORDERS',
                orders: pkg._count.orders
            });
        }

        await recordAudit(tx, {
            action: 'PACKAGE_DELETED',
            actor,
            entityType: AUDIT_ENTITY.package,
            entityId: id,
            summary: `Deleted package ${pkg.name}`,
            metadata: { slug: pkg.slug, status: pkg.status },
            req
        });

        await tx.package.delete({ where: { id } });

        return pkg;
    });

// --- kosher profile ----------------------------------------------------------

/**
 * Writes the profile and validates every fixed hotel slot against it, in
 * one transaction: a profile that would make the package unsellable is
 * refused with the reasons, not saved and discovered at quote time.
 */
export const upsertKosherProfile = async (id, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const pkg = await tx.package.findUnique({ where: { id }, include: detailInclude() });

        if (!pkg) {
            throw new NotFoundError('Package not found');
        }

        const profile = await tx.kosherPackageProfile.upsert({
            where: { packageId: id },
            create: { packageId: id, ...input },
            update: input
        });

        const { blockers, warnings } = await validateKosherTemplate(tx, pkg, profile, { today: todayInTimezone(pkg.timezone) });

        if (blockers.length > 0) {
            throw new UnprocessableEntityError('A fixed hotel does not meet this kosher profile', {
                reason: 'KOSHER_INELIGIBLE',
                blockers,
                warnings
            });
        }

        await recordAudit(tx, {
            action: 'PACKAGE_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.package,
            entityId: id,
            summary: `Set the kosher profile of ${pkg.name}`,
            metadata: { fields: Object.keys(input), warnings: warnings.length },
            req
        });

        return { profile, warnings };
    });

export const removeKosherProfile = async (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const pkg = await tx.package.findUnique({ where: { id }, include: { kosher: true } });

        if (!pkg) {
            throw new NotFoundError('Package not found');
        }

        if (pkg.kosher) {
            await tx.kosherPackageProfile.delete({ where: { packageId: id } });
        }

        await recordAudit(tx, {
            action: 'PACKAGE_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.package,
            entityId: id,
            summary: `Removed the kosher profile of ${pkg.name}`,
            metadata: {},
            req
        });
    });

/** An admin's dated decision to keep selling despite a lapsed certificate. Audited. */
export const overrideKosher = async (id, { until, reason }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const pkg = await tx.package.findUnique({ where: { id }, include: { kosher: true } });

        if (!pkg) {
            throw new NotFoundError('Package not found');
        }

        if (!pkg.kosher) {
            throw new ConflictError('This package has no kosher profile to override', { reason: 'NOT_KOSHER' });
        }

        const updated = await tx.package.update({
            where: { id },
            data: { kosherOverrideUntil: until ? dateOnlyToUtc(until) : null },
            include: detailInclude()
        });

        await recordAudit(tx, {
            action: 'PACKAGE_KOSHER_OVERRIDDEN',
            actor,
            entityType: AUDIT_ENTITY.package,
            entityId: id,
            summary: until ? `Kosher eligibility of ${pkg.name} overridden until ${until}` : `Kosher override on ${pkg.name} lifted`,
            metadata: { until: until ?? null, reason: reason ?? null },
            req
        });

        return updated;
    });

/** What a kosher package needs to know about a tour. */
export const upsertTourKosherProfile = async (tourId, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const tour = await tx.tour.findUnique({ where: { id: tourId } });

        if (!tour) {
            throw new NotFoundError('Tour not found');
        }

        const profile = await tx.tourKosherProfile.upsert({
            where: { tourId },
            create: { tourId, ...input },
            update: input
        });

        await recordAudit(tx, {
            action: 'TOUR_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.tour,
            entityId: tourId,
            summary: `Set the kosher profile of ${tour.title}`,
            metadata: input,
            req
        });

        return profile;
    });

// --- translations and gallery ------------------------------------------------

export const listPackageTranslations = async (id) => {
    await findPackageOr404(id);

    return prisma.packageTranslation.findMany({ where: { packageId: id }, orderBy: { locale: 'asc' } });
};

export const upsertPackageTranslation = async (id, locale, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const pkg = await tx.package.findUnique({ where: { id } });

        if (!pkg) {
            throw new NotFoundError('Package not found');
        }

        const translation = await tx.packageTranslation.upsert({
            where: { packageId_locale: { packageId: id, locale } },
            create: { packageId: id, locale, ...input },
            update: input
        });

        await recordAudit(tx, {
            action: 'PACKAGE_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.package,
            entityId: id,
            summary: `Updated ${locale} translation of ${pkg.name}`,
            metadata: { locale, fields: Object.keys(input) },
            req
        });

        return translation;
    });

export const packageGallery = createGallery({
    imageDelegate: 'packageImage',
    ownerDelegate: 'package',
    ownerField: 'packageId',
    ownerLabel: 'Package',
    auditEntity: AUDIT_ENTITY.package,
    auditAction: 'PACKAGE_UPDATED',
    ownerName: (pkg) => pkg.name,
    mainImageField: null
});
