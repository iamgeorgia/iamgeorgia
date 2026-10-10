import { prisma } from '../../db/index.js';
import { AUDIT_ENTITY, recordAudit } from '../../lib/audit.js';
import { NotFoundError } from '../../lib/errors.js';
import { localise } from '../../serializers/localise.js';
import { isStaff, isTrade } from '../../middleware/auth.js';
import { accessWhere } from '../partner/access.service.js';

/**
 * Vehicle classes — the sellable products.
 *
 * A class, never an individual car. The supplier promises a category and a
 * capacity; promising a registration is a promise that breaks the first time
 * the car goes in for a service.
 */

const TRANSLATED_FIELDS = [
    'name',
    'vehicleExample',
    'summary',
    'description',
    'included',
    'excluded',
    'pickupProcedure'
];

const vehicleInclude = {
    translations: true,
    provider: true,
    cancellationPolicy: { include: { rules: true } }
};

const localiseVehicle = (vehicle, locale) => {
    const { translations, ...base } = vehicle;

    return localise(base, translations, locale, TRANSLATED_FIELDS);
};

/**
 * Which vehicles a viewer may be shown.
 *
 * Everything is B2B by default, exactly as hotels are: an anonymous visitor
 * sees only what has been deliberately opened to the public, while a signed-in
 * partner or an admin sees the whole active catalogue. Enforced in the query
 * rather than filtered after, so there is no path by which an unpublished class
 * reaches a response.
 */
export const visibilityScope = (viewer) => {
    if (isStaff(viewer)) {
        return {};
    }

    // Trade, not merely signed in: a partner still waiting for approval, or
    // suspended, sees what the public sees, as it does for hotels. A trade
    // buyer sees the classes its company may sell.
    return isTrade(viewer) ? { status: 'ACTIVE', ...accessWhere(viewer, 'TRANSFER') } : { status: 'ACTIVE', b2cEnabled: true };
};

/**
 * The suppliers a class can be attached to.
 *
 * Read-only and admin-only. A vehicle class carries a required `providerId`,
 * so the panel's create form needs the list to offer a choice — deriving it
 * from the classes that already exist would hide any supplier that has not been
 * given one yet, which is exactly the supplier somebody is adding a class for.
 */
export const listProviders = () =>
    prisma.transferProvider.findMany({
        where: { status: { not: 'ARCHIVED' } },
        orderBy: { name: 'asc' }
    });

export const listVehicles = async ({ locale, viewer, vehicleClass, kind } = {}) => {
    const vehicles = await prisma.transferVehicle.findMany({
        where: {
            ...visibilityScope(viewer),
            ...(vehicleClass ? { vehicleClass } : {}),
            ...(kind ? { kind } : {})
        },
        include: vehicleInclude,
        orderBy: [{ recommendedRank: 'asc' }, { maxPassengers: 'asc' }]
    });

    return vehicles.map((vehicle) => localiseVehicle(vehicle, locale));
};

export const findVehicleOr404 = async (idOrSlug, { locale, viewer } = {}) => {
    const vehicle = await prisma.transferVehicle.findFirst({
        where: {
            ...visibilityScope(viewer),
            OR: [{ id: idOrSlug }, { slug: idOrSlug }]
        },
        include: vehicleInclude
    });

    if (!vehicle) {
        throw new NotFoundError('That vehicle class does not exist');
    }

    return localiseVehicle(vehicle, locale);
};

/**
 * Every vehicle that can physically carry this party, priced later.
 *
 * Capacity is a hard constraint rather than a filter the traveller can clear:
 * showing a three-seat saloon to a party of six is not a choice, it is a
 * mistake they only discover at the kerb.
 *
 * Luggage is checked the same way, and cabin bags deliberately are not — a
 * cabin bag rides on a lap when it has to, and refusing the whole booking over
 * one is worse than the squeeze.
 */
export const listSellableVehicles = async ({ passengers, luggage, viewer, locale }) => {
    const vehicles = await prisma.transferVehicle.findMany({
        where: {
            ...visibilityScope(viewer),
            status: 'ACTIVE',
            maxPassengers: { gte: Math.max(1, passengers) },
            maxLuggage: { gte: luggage }
        },
        include: vehicleInclude,
        orderBy: [{ recommendedRank: 'asc' }, { maxPassengers: 'asc' }]
    });

    return vehicles.map((vehicle) => localiseVehicle(vehicle, locale));
};

export const createVehicle = async (input, actor, req) => {
    const vehicle = await prisma.$transaction(async (tx) => {
        const created = await tx.transferVehicle.create({ data: input, include: vehicleInclude });

        await recordAudit(tx, {
            action: 'TRANSFER_VEHICLE_CREATED',
            actor,
            entityType: AUDIT_ENTITY.transferVehicle,
            entityId: created.id,
            summary: `Created vehicle class ${created.name}`,
            req
        });

        return created;
    });

    return localiseVehicle(vehicle, null);
};

export const updateVehicle = async (id, input, actor, req) => {
    const vehicle = await prisma.$transaction(async (tx) => {
        const existing = await tx.transferVehicle.findUnique({ where: { id } });

        if (!existing) {
            throw new NotFoundError('That vehicle class does not exist');
        }

        const updated = await tx.transferVehicle.update({
            where: { id },
            data: input,
            include: vehicleInclude
        });

        await recordAudit(tx, {
            action: 'TRANSFER_VEHICLE_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.transferVehicle,
            entityId: id,
            summary: `Updated vehicle class ${updated.name}`,
            metadata: { fields: Object.keys(input) },
            req
        });

        return updated;
    });

    return localiseVehicle(vehicle, null);
};

/**
 * Takes a class off the market for good.
 *
 * ARCHIVED, never deleted: bookings point at it with `Restrict` because a
 * voucher has to keep describing the car that was sold, and a class with
 * history is retired rather than removed.
 */
export const archiveVehicle = async (id, actor, req) => {
    const vehicle = await prisma.$transaction(async (tx) => {
        const existing = await tx.transferVehicle.findUnique({ where: { id } });

        if (!existing) {
            throw new NotFoundError('That vehicle class does not exist');
        }

        const updated = await tx.transferVehicle.update({
            where: { id },
            data: { status: 'ARCHIVED', b2cEnabled: false },
            include: vehicleInclude
        });

        await recordAudit(tx, {
            action: 'TRANSFER_VEHICLE_ARCHIVED',
            actor,
            entityType: AUDIT_ENTITY.transferVehicle,
            entityId: id,
            summary: `Archived vehicle class ${updated.name}`,
            req
        });

        return updated;
    });

    return localiseVehicle(vehicle, null);
};

export const upsertVehicleTranslation = async (id, locale, input) => {
    const vehicle = await prisma.transferVehicle.findUnique({ where: { id } });

    if (!vehicle) {
        throw new NotFoundError('That vehicle class does not exist');
    }

    await prisma.transferVehicleTranslation.upsert({
        where: { vehicleId_locale: { vehicleId: id, locale } },
        create: { vehicleId: id, locale, ...input },
        update: input
    });

    const refreshed = await prisma.transferVehicle.findUnique({
        where: { id },
        include: vehicleInclude
    });

    return localiseVehicle(refreshed, null);
};

export { localiseVehicle, vehicleInclude, TRANSLATED_FIELDS as VEHICLE_TRANSLATED_FIELDS };
