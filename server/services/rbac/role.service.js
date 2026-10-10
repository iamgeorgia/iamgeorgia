import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { ALL_CAPABILITIES, CAPABILITIES, isPartnerCapability } from '../../lib/permissions.js';
import { assertDominates } from './grant.service.js';

/**
 * The roles themselves: what each may do.
 *
 * The system roles are seeded by migration and keep their key and side for
 * good; a super admin's and a driver's capabilities are locked too (one is
 * computed, the other is the shape of a panel). Everything else about a
 * role, and every role made in the panel, is data a `roles.manage` holder
 * edits — within the one rule that runs through all of this: nobody hands
 * out a capability they do not hold.
 */

const LOCKED_ROLES = new Set(['SUPER_ADMIN', 'DRIVER']);

/** Roles made in the panel: lower case, so they can never be mistaken for a system role in a seed or a test. */
export const CUSTOM_ROLE_KEY = /^[a-z][a-z0-9_]{2,40}$/;

export const roleInclude = { capabilities: { orderBy: { capability: 'asc' } }, _count: { select: { members: true } } };

/**
 * A capability belongs to one side. A company's role carries `partner.*`
 * capabilities and the bell; a platform role carries everything but
 * `partner.*`, which is always scoped by a partnerId a platform account
 * does not have.
 */
const sideAllows = (side, capability) =>
    side === 'PARTNER' ? isPartnerCapability(capability) || capability === CAPABILITIES.NOTIFICATIONS_READ : !isPartnerCapability(capability);

const assertCapabilitiesFit = (side, capabilities) => {
    const unknown = capabilities.filter((capability) => !ALL_CAPABILITIES.has(capability));

    if (unknown.length > 0) {
        throw new BadRequestError('Unknown capability', { reason: 'UNKNOWN_CAPABILITY', capabilities: unknown });
    }

    const wrongSide = capabilities.filter((capability) => !sideAllows(side, capability));

    if (wrongSide.length > 0) {
        throw new BadRequestError(`A ${side.toLowerCase()} role cannot carry these capabilities`, {
            reason: 'CAPABILITY_WRONG_SIDE',
            capabilities: wrongSide
        });
    }
};

export const listRoles = ({ side } = {}) =>
    prisma.accessRole.findMany({
        where: side ? { side } : {},
        include: roleInclude,
        orderBy: [{ side: 'asc' }, { sortOrder: 'asc' }, { key: 'asc' }]
    });

export const findRoleOr404 = async (key, client = prisma) => {
    const role = await client.accessRole.findUnique({ where: { key }, include: roleInclude });

    if (!role) {
        throw new NotFoundError('Role not found');
    }

    return role;
};

/** The union of what the named roles carry, as rows say today. Unknown keys are reported, not ignored. */
export const capabilitiesOfRoles = async (client, keys) => {
    const roles = await client.accessRole.findMany({ where: { key: { in: keys } }, include: { capabilities: true } });
    const missing = keys.filter((key) => !roles.some((role) => role.key === key));

    if (missing.length > 0) {
        throw new NotFoundError('Role not found', { roles: missing });
    }

    return { roles, capabilities: new Set(roles.flatMap((role) => role.capabilities.map((row) => row.capability))) };
};

export const createRole = async ({ key, name, description, side, capabilities }, actor, req) => {
    if (!CUSTOM_ROLE_KEY.test(key)) {
        throw new BadRequestError('A role key is lower-case letters, digits and underscores', { field: 'key' });
    }

    assertCapabilitiesFit(side, capabilities);

    // Nobody hands out what they do not hold. A platform account holds no
    // partner capability, so for a company role the question is only
    // whether the actor may shape roles at all, which the router asked.
    if (side === 'PLATFORM') {
        assertDominates(actor, capabilities, { what: 'role' });
    }

    const taken = await prisma.accessRole.findUnique({ where: { key } });

    if (taken) {
        throw new ConflictError('A role with that key already exists', { field: 'key' });
    }

    return prisma.$transaction(async (tx) => {
        const last = await tx.accessRole.aggregate({ _max: { sortOrder: true } });
        const role = await tx.accessRole.create({
            data: {
                key,
                name,
                description: description ?? null,
                side,
                isSystem: false,
                sortOrder: (last._max.sortOrder ?? 0) + 10,
                capabilities: { create: capabilities.map((capability) => ({ capability })) }
            },
            include: roleInclude
        });

        await recordAudit(tx, {
            action: 'ROLE_CREATED',
            actor,
            entityType: AUDIT_ENTITY.role,
            entityId: role.id,
            summary: `Created role ${name} (${key})`,
            metadata: { key, side, capabilities: [...capabilities].sort() },
            req
        });

        return role;
    });
};

export const updateRole = async (key, { name, description, capabilities }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const role = await findRoleOr404(key, tx);
        const changes = {};
        const data = {};

        if (name !== undefined && name !== role.name) {
            changes.name = { from: role.name, to: name };
            data.name = name;
        }

        if (description !== undefined && (description ?? null) !== (role.description ?? null)) {
            changes.description = { from: role.description ?? null, to: description ?? null };
            data.description = description ?? null;
        }

        if (capabilities !== undefined) {
            if (LOCKED_ROLES.has(role.key)) {
                throw new ConflictError('What this role may do is fixed', { reason: 'ROLE_LOCKED', role: role.key });
            }

            assertCapabilitiesFit(role.side, capabilities);

            const current = new Set(role.capabilities.map((row) => row.capability));
            const next = new Set(capabilities);
            const added = [...next].filter((capability) => !current.has(capability)).sort();
            const removed = [...current].filter((capability) => !next.has(capability)).sort();

            // Adding is handing out; removing is not.
            if (role.side === 'PLATFORM') {
                assertDominates(actor, added, { what: 'role' });
            }

            if (added.length > 0 || removed.length > 0) {
                changes.capabilities = { added, removed };
                await tx.roleCapability.deleteMany({ where: { roleId: role.id, capability: { in: removed } } });
                await tx.roleCapability.createMany({ data: added.map((capability) => ({ roleId: role.id, capability })) });
            }
        }

        if (Object.keys(changes).length === 0) {
            return role;
        }

        const updated = await tx.accessRole.update({ where: { id: role.id }, data, include: roleInclude });

        await recordAudit(tx, {
            action: 'ROLE_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.role,
            entityId: role.id,
            summary: `Changed role ${role.name} (${role.key})`,
            metadata: { key: role.key, changes },
            req
        });

        return updated;
    });

export const deleteRole = async (key, actor, req) =>
    prisma.$transaction(async (tx) => {
        const role = await findRoleOr404(key, tx);

        if (role.isSystem) {
            throw new ConflictError('A system role cannot be deleted', { reason: 'SYSTEM_ROLE' });
        }

        if (role._count.members > 0) {
            throw new ConflictError('Take the role off its members first', { reason: 'ROLE_IN_USE', members: role._count.members });
        }

        await recordAudit(tx, {
            action: 'ROLE_DELETED',
            actor,
            entityType: AUDIT_ENTITY.role,
            entityId: role.id,
            summary: `Deleted role ${role.name} (${role.key})`,
            metadata: { key: role.key, side: role.side, capabilities: role.capabilities.map((row) => row.capability) },
            req
        });

        await tx.accessRole.delete({ where: { id: role.id } });
    });
