import { prisma } from '../../db/index.js';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';

/**
 * Services: the catalogue record.
 *
 * A service is a priced line — kosher meals delivered to a hotel, a mashgiach
 * for a stay, a synagogue transfer, a guide for a day — sold through packages
 * and, for staff, on its own. No inventory, no calendar; a season is not
 * needed because the price is one figure with an optional fixed sell. The
 * lifecycle mirrors tours: DRAFT, published against a checklist, off sale,
 * archived.
 */

export const SERVICE_TRANSLATABLE_FIELDS = ['name', 'summary', 'description', 'included'];

/** The bases a service can be cancelled on: there is no first night to charge. */
const SERVICE_CHARGE_BASES = ['PERCENT_OF_TOTAL', 'FIXED_AMOUNT'];

const translationInclude = (locale) => (locale && locale !== 'en' ? { where: { locale }, take: 1 } : false);

export const serviceInclude = (locale) => ({
    destination: { include: { translations: translationInclude(locale) } },
    supplier: { select: { id: true, reference: true, name: true } },
    cancellationPolicy: { include: { rules: { orderBy: { hoursBeforeCheckIn: 'desc' } } } },
    translations: translationInclude(locale)
});

const buildWhere = ({ search, status, b2cOnly, destinationId, destinationSlug, destinationPath, supplierId, category, isKosher, access }) => ({
    ...(b2cOnly ? { b2cEnabled: true } : {}),
    ...(access ?? {}),
    ...(status ? { status: { in: Array.isArray(status) ? status : [status] } } : {}),
    ...(destinationId ? { destinationId } : {}),
    ...(destinationSlug ? { destination: { slug: destinationSlug } } : {}),
    ...(destinationPath ? { destination: { path: { startsWith: destinationPath } } } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(category ? { category: { in: Array.isArray(category) ? category : [category] } } : {}),
    ...(isKosher === undefined ? {} : { isKosher }),
    ...(search
        ? {
              OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { slug: { contains: search, mode: 'insensitive' } }
              ]
          }
        : {})
});

export const listServices = async (query) => {
    const { page = 1, pageSize = 24, locale } = query;
    const where = buildWhere(query);

    const [total, services] = await Promise.all([
        prisma.service.count({ where }),
        prisma.service.findMany({
            where,
            include: serviceInclude(locale),
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { services, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

export const findServiceOr404 = async (idOrSlug, { locale, statuses, b2cOnly, access } = {}) => {
    const service = await prisma.service.findFirst({
        where: {
            OR: [{ id: idOrSlug }, { slug: idOrSlug }],
            ...(statuses ? { status: { in: statuses } } : {}),
            ...(b2cOnly ? { b2cEnabled: true } : {}),
            ...(access ?? {})
        },
        include: serviceInclude(locale)
    });

    if (!service) {
        throw new NotFoundError('Service not found');
    }

    return service;
};

/**
 * A service may only use a platform template whose rules charge against the
 * whole total. A first-night rule has nothing to charge here.
 */
const assertPolicyUsable = async (client, policyId) => {
    const policy = await client.cancellationPolicy.findUnique({
        where: { id: policyId },
        include: { rules: true }
    });

    if (!policy || policy.hotelId !== null || !policy.isActive) {
        throw new NotFoundError('Cancellation policy not found');
    }

    const offending = policy.rules.filter((rule) => !SERVICE_CHARGE_BASES.includes(rule.chargeBasis));

    if (offending.length > 0) {
        throw new UnprocessableEntityError('A service can only use policies charged against the whole total', {
            allowed: SERVICE_CHARGE_BASES,
            offending: offending.map((rule) => rule.chargeBasis)
        });
    }

    return policy;
};

export const buildServicePublishChecklist = (service) => {
    const missing = [];
    const require = (code, message, ok) => {
        if (!ok) {
            missing.push({ code, message });
        }
    };

    require('summary', 'Write a summary', Boolean(service.summary));
    require('price', 'Set a net price above zero', service.netCents > 0);
    require('policy', 'Choose cancellation terms', Boolean(service.cancellationPolicyId));

    return missing;
};

export const createService = async (input, actor, req) =>
    prisma.$transaction(async (tx) => {
        if (input.destinationId) {
            const destination = await tx.destination.findUnique({ where: { id: input.destinationId } });

            if (!destination) {
                throw new NotFoundError('Destination not found');
            }
        }

        await assertPolicyUsable(tx, input.cancellationPolicyId);

        const service = await tx.service.create({ data: input, include: serviceInclude() });

        await recordAudit(tx, {
            action: 'SERVICE_CREATED',
            actor,
            entityType: AUDIT_ENTITY.service,
            entityId: service.id,
            summary: `Created service ${service.name}`,
            metadata: { slug: service.slug, category: service.category },
            req
        });

        return service;
    });

export const updateService = async (id, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const current = await tx.service.findUnique({ where: { id } });

        if (!current) {
            throw new NotFoundError('Service not found');
        }

        if (current.status === 'ARCHIVED') {
            throw new ConflictError('An archived service cannot be edited', { status: current.status });
        }

        if (input.destinationId) {
            const destination = await tx.destination.findUnique({ where: { id: input.destinationId } });

            if (!destination) {
                throw new NotFoundError('Destination not found');
            }
        }

        if (input.cancellationPolicyId) {
            await assertPolicyUsable(tx, input.cancellationPolicyId);
        }

        const service = await tx.service.update({ where: { id }, data: input, include: serviceInclude() });

        await recordAudit(tx, {
            action: 'SERVICE_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.service,
            entityId: id,
            summary: `Updated service ${service.name}`,
            metadata: { fields: Object.keys(input) },
            req
        });

        return service;
    });

const transition = (action, from, to, summary) => async (id, actor, req, { reason } = {}) =>
    prisma.$transaction(async (tx) => {
        const service = await tx.service.findUnique({ where: { id } });

        if (!service) {
            throw new NotFoundError('Service not found');
        }

        if (!from.includes(service.status)) {
            throw new ConflictError(`A service with status ${service.status} cannot be ${summary}`, {
                status: service.status,
                allowedFrom: from
            });
        }

        if (to === 'ACTIVE') {
            const missing = buildServicePublishChecklist(service);

            if (missing.length > 0) {
                throw new UnprocessableEntityError('This service is not ready to publish', { missing });
            }
        }

        const updated = await tx.service.update({ where: { id }, data: { status: to }, include: serviceInclude() });

        await recordAudit(tx, {
            action,
            actor,
            entityType: AUDIT_ENTITY.service,
            entityId: id,
            summary: `${summary[0].toUpperCase()}${summary.slice(1)} service ${service.name}`,
            metadata: { from: service.status, ...(reason ? { reason } : {}) },
            req
        });

        return updated;
    });

export const publishService = transition('SERVICE_PUBLISHED', ['DRAFT', 'INACTIVE'], 'ACTIVE', 'published');
export const unpublishService = transition('SERVICE_UNPUBLISHED', ['ACTIVE'], 'INACTIVE', 'unpublished');
export const archiveService = transition('SERVICE_ARCHIVED', ['DRAFT', 'ACTIVE', 'INACTIVE'], 'ARCHIVED', 'archived');

export const deleteService = async (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const service = await tx.service.findUnique({
            where: { id },
            include: { _count: { select: { bookings: true, components: true } } }
        });

        if (!service) {
            throw new NotFoundError('Service not found');
        }

        if (service._count.bookings > 0) {
            throw new ConflictError('A service with bookings cannot be deleted; archive it instead', {
                reason: 'HAS_BOOKINGS',
                bookings: service._count.bookings
            });
        }

        if (service._count.components > 0) {
            throw new ConflictError('A service used by a package cannot be deleted', {
                reason: 'IN_PACKAGE',
                packages: service._count.components
            });
        }

        await recordAudit(tx, {
            action: 'SERVICE_DELETED',
            actor,
            entityType: AUDIT_ENTITY.service,
            entityId: id,
            summary: `Deleted service ${service.name}`,
            metadata: { slug: service.slug, status: service.status },
            req
        });

        await tx.service.delete({ where: { id } });

        return service;
    });

export const listServiceTranslations = async (id) => {
    await findServiceOr404(id);

    return prisma.serviceTranslation.findMany({ where: { serviceId: id }, orderBy: { locale: 'asc' } });
};

export const upsertServiceTranslation = async (id, locale, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const service = await tx.service.findUnique({ where: { id } });

        if (!service) {
            throw new NotFoundError('Service not found');
        }

        const translation = await tx.serviceTranslation.upsert({
            where: { serviceId_locale: { serviceId: id, locale } },
            create: { serviceId: id, locale, ...input },
            update: input
        });

        await recordAudit(tx, {
            action: 'SERVICE_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.service,
            entityId: id,
            summary: `Updated ${locale} translation of ${service.name}`,
            metadata: { locale, fields: Object.keys(input) },
            req
        });

        return translation;
    });
