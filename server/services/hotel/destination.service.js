import { prisma } from '../../db/index.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';

/**
 * Destinations: the geography spine.
 *
 * Country -> Region -> City/Resort as a self-referencing tree, plus a
 * materialised `path` so that "every hotel in Georgia" is a prefix match on one
 * indexed column rather than a recursive CTE run on every search request. The
 * cost of that is paid here: the path is derived, never accepted from a client,
 * and moving a destination rewrites the path of everything beneath it.
 *
 * Transfers, tours and recommendations will join on `destinationId` and on the
 * PostGIS point, which is the whole reason this is a table and not a string
 * column on `hotels`.
 */

// Breadth of a level. A parent must be at least as broad as its child, which
// rejects a country filed under a region while still allowing a district under
// a city or a resort inside one.
const TYPE_RANK = { COUNTRY: 0, REGION: 1, CITY: 2, RESORT: 2 };

const buildPath = (parentPath, slug) => `${parentPath ?? ''}/${slug}`;

const translationInclude = (locale) =>
    locale && locale !== 'en' ? { where: { locale }, take: 1 } : false;

/**
 * Reads the parent and checks it may hold a child of this type.
 *
 * Returns null for a root. A COUNTRY is always a root: filing one under
 * anything else would make its path a lie for every hotel below it.
 */
const resolveParent = async (client, parentId, type) => {
    if (!parentId) {
        if (type !== 'COUNTRY') {
            throw new BadRequestError(`A ${type} must have a parent destination`, { field: 'parentId' });
        }

        return null;
    }

    if (type === 'COUNTRY') {
        throw new BadRequestError('A COUNTRY is always a root and cannot have a parent', {
            field: 'parentId'
        });
    }

    const parent = await client.destination.findUnique({ where: { id: parentId } });

    if (!parent) {
        throw new BadRequestError('Parent destination does not exist', { field: 'parentId' });
    }

    if (TYPE_RANK[parent.type] > TYPE_RANK[type]) {
        throw new BadRequestError(`A ${type} cannot sit inside a ${parent.type}`, {
            field: 'parentId',
            parentType: parent.type,
            type
        });
    }

    return parent;
};

/**
 * Rewrites the paths of every descendant after a move or a rename.
 *
 * One statement rather than a walk: the subtree is exactly the rows whose path
 * starts with the old one, and `substring` re-heads each of them. Slugs are
 * restricted to `[a-z0-9-]` by `slugField`, so neither `%` nor `_` can appear
 * in a path and the LIKE pattern needs no escaping.
 *
 * The `::integer` cast is load-bearing. Postgres overloads `substring(text FROM
 * ...)` on the second argument, and a bind parameter arrives untyped, so
 * without the cast it resolves to the POSIX *regular expression* form. That
 * form does not error on a path — it simply finds no match and returns NULL,
 * which surfaces much later as a not-null violation on `path`.
 */
const rewriteDescendantPaths = (tx, oldPath, newPath) =>
    tx.$executeRaw`
        UPDATE destinations
           SET path = ${newPath} || substring(path from ${oldPath.length + 1}::integer)
         WHERE path LIKE ${`${oldPath}/%`}
    `;

export const findDestinationOr404 = async (idOrSlug, { locale } = {}) => {
    const destination = await prisma.destination.findFirst({
        where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
        include: {
            parent: true,
            children: { orderBy: { name: 'asc' } },
            translations: translationInclude(locale),
            _count: { select: { hotels: true, children: true } }
        }
    });

    if (!destination) {
        throw new NotFoundError('Destination not found');
    }

    return destination;
};

export const listDestinations = async ({ search, type, parentId, countryCode, featured, locale, page, pageSize }) => {
    const where = {
        ...(parentId ? { parentId } : {}),
        ...(countryCode ? { countryCode } : {}),
        ...(featured === undefined ? {} : { featured }),
        ...(type ? { type: { in: Array.isArray(type) ? type : [type] } } : {}),
        ...(search
            ? {
                  OR: [
                      { name: { contains: search, mode: 'insensitive' } },
                      { slug: { contains: search, mode: 'insensitive' } }
                  ]
              }
            : {})
    };

    const [total, destinations] = await Promise.all([
        prisma.destination.count({ where }),
        prisma.destination.findMany({
            where,
            include: {
                parent: true,
                translations: translationInclude(locale),
                _count: { select: { hotels: true, children: true } }
            },
            // Path order is tree order: a parent always sorts immediately above
            // its children, so an admin list reads as a hierarchy for free.
            orderBy: [{ path: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return {
        destinations,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
};

/**
 * The whole tree in one query, assembled in memory.
 *
 * A destination tree is tens of rows, not thousands, so one flat read and a
 * single pass beats either a recursive CTE or a query per level. The caller
 * gets roots with `children` nested.
 */
export const getDestinationTree = async ({ locale, countryCode, featured } = {}) => {
    const rows = await prisma.destination.findMany({
        where: {
            ...(countryCode ? { countryCode } : {}),
            ...(featured === undefined ? {} : { featured })
        },
        include: {
            translations: translationInclude(locale),
            _count: { select: { hotels: true } }
        },
        orderBy: [{ path: 'asc' }]
    });

    const byId = new Map(rows.map((row) => [row.id, { ...row, children: [] }]));
    const roots = [];

    for (const node of byId.values()) {
        const parent = node.parentId ? byId.get(node.parentId) : null;

        // A node whose parent was filtered out becomes a root rather than
        // disappearing: a country filter must not hide the cities inside it.
        if (parent) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }

    return roots;
};

export const createDestination = async (input, actor, req) => {
    const { parentId, countryCode, timezone, ...rest } = input;

    return prisma.$transaction(async (tx) => {
        const parent = await resolveParent(tx, parentId, input.type);

        // A child inherits its country and time zone unless it says otherwise,
        // so adding a resort to a known region needs neither.
        const resolvedCountry = countryCode ?? parent?.countryCode;

        if (!resolvedCountry) {
            throw new BadRequestError('countryCode is required for a root destination', {
                field: 'countryCode'
            });
        }

        const destination = await tx.destination.create({
            data: {
                ...rest,
                parentId: parent?.id ?? null,
                countryCode: resolvedCountry,
                timezone: timezone ?? parent?.timezone ?? 'Asia/Tbilisi',
                path: buildPath(parent?.path, input.slug)
            }
        });

        await recordAudit(tx, {
            action: 'DESTINATION_CREATED',
            actor,
            entityType: AUDIT_ENTITY.destination,
            entityId: destination.id,
            summary: `Created destination ${destination.name}`,
            metadata: { slug: destination.slug, type: destination.type, path: destination.path },
            req
        });

        return destination;
    });
};

export const updateDestination = async (id, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const current = await tx.destination.findUnique({ where: { id } });

        if (!current) {
            throw new NotFoundError('Destination not found');
        }

        const { parentId, ...rest } = input;
        const movingParent = 'parentId' in input && (parentId ?? null) !== current.parentId;
        const renaming = rest.slug !== undefined && rest.slug !== current.slug;
        const type = rest.type ?? current.type;

        let parent = null;

        if (movingParent || renaming || rest.type !== undefined) {
            const nextParentId = movingParent ? parentId ?? null : current.parentId;
            parent = await resolveParent(tx, nextParentId, type);

            // A destination cannot be moved inside itself. Without this the
            // subtree would be cut out of the tree and its paths would form a
            // cycle that prefix search could never escape.
            if (parent && (parent.id === id || parent.path.startsWith(`${current.path}/`))) {
                throw new ConflictError('A destination cannot be moved inside itself', {
                    field: 'parentId'
                });
            }
        }

        const newPath =
            movingParent || renaming ? buildPath(parent?.path, rest.slug ?? current.slug) : current.path;

        const destination = await tx.destination.update({
            where: { id },
            data: {
                ...rest,
                // Taking the pin off the map takes the place with it: an
                // address for a position that no longer exists is a lie the
                // panel would print.
                ...(rest.latitude === null ? { place: null } : {}),
                ...(movingParent ? { parentId: parentId ?? null } : {}),
                ...(newPath !== current.path ? { path: newPath } : {})
            }
        });

        if (newPath !== current.path) {
            await rewriteDescendantPaths(tx, current.path, newPath);
        }

        await recordAudit(tx, {
            action: 'DESTINATION_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.destination,
            entityId: destination.id,
            summary: `Updated destination ${destination.name}`,
            metadata: {
                fields: Object.keys(input),
                ...(newPath !== current.path ? { pathFrom: current.path, pathTo: newPath } : {})
            },
            req
        });

        return destination;
    });

export const deleteDestination = async (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const destination = await tx.destination.findUnique({
            where: { id },
            include: { _count: { select: { hotels: true, children: true, tours: true, experiences: true } } }
        });

        if (!destination) {
            throw new NotFoundError('Destination not found');
        }

        // The foreign keys are Restrict and would refuse this anyway, but a
        // 409 naming what is in the way is a far better answer than a raw
        // constraint violation — the admin needs to know where to look.
        const blockers = Object.entries(destination._count).filter(([, count]) => count > 0);

        if (blockers.length > 0) {
            throw new ConflictError('This destination still has records attached to it', {
                blockedBy: Object.fromEntries(blockers)
            });
        }

        await tx.destination.delete({ where: { id } });

        await recordAudit(tx, {
            action: 'DESTINATION_DELETED',
            actor,
            entityType: AUDIT_ENTITY.destination,
            entityId: id,
            summary: `Deleted destination ${destination.name}`,
            metadata: { slug: destination.slug, path: destination.path },
            req
        });

        return destination;
    });

export const upsertDestinationTranslation = async (id, locale, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const destination = await tx.destination.findUnique({ where: { id } });

        if (!destination) {
            throw new NotFoundError('Destination not found');
        }

        const translation = await tx.destinationTranslation.upsert({
            where: { destinationId_locale: { destinationId: id, locale } },
            create: { destinationId: id, locale, ...input },
            update: input
        });

        await recordAudit(tx, {
            action: 'DESTINATION_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.destination,
            entityId: id,
            summary: `Updated ${locale} translation for ${destination.name}`,
            metadata: { locale, fields: Object.keys(input) },
            req
        });

        return translation;
    });
