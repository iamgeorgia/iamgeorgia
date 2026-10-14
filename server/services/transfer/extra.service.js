import { prisma } from '../../db/index.js';
import { AUDIT_ENTITY, recordAudit } from '../../lib/audit.js';
import { NotFoundError } from '../../lib/errors.js';
import { dateOnlyToUtc } from '../../lib/time.js';

/**
 * Add-ons and blackout windows.
 *
 * Two small catalogues that had no reason to be separate modules: both are flat
 * lists an admin maintains, and neither has any logic beyond keeping the rows
 * tidy. The pricing that uses them lives in `pricing.service.js`, where it can
 * stay pure.
 */

export const listExtras = ({ includeInactive = false } = {}) =>
    prisma.transferExtra.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: [{ position: 'asc' }, { name: 'asc' }]
    });

export const upsertExtra = async (input, actor, req) => {
    const extra = await prisma.$transaction(async (tx) => {
        const saved = await tx.transferExtra.upsert({
            where: { code: input.code },
            create: input,
            update: input
        });

        await recordAudit(tx, {
            action: 'TRANSFER_EXTRA_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.transferExtra,
            entityId: saved.id,
            summary: `Saved transfer extra ${saved.code}`,
            req
        });

        return saved;
    });

    return extra;
};

/** Changes an existing extra; the fields sent are the fields changed. */
export const updateExtra = async (code, patch, actor, req) => {
    const existing = await prisma.transferExtra.findUnique({ where: { code } });

    if (!existing) {
        throw new NotFoundError('That extra does not exist');
    }

    return prisma.$transaction(async (tx) => {
        const saved = await tx.transferExtra.update({ where: { code }, data: patch });

        await recordAudit(tx, {
            action: 'TRANSFER_EXTRA_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.transferExtra,
            entityId: saved.id,
            summary: `Saved transfer extra ${saved.code}`,
            req
        });

        return saved;
    });
};

/**
 * Retires an extra.
 *
 * Deactivated rather than deleted, because bookings record the code they bought
 * and a support conversation six months later still has to be able to say what
 * "skiEquipment" was.
 */
export const deactivateExtra = async (code, actor, req) => {
    const existing = await prisma.transferExtra.findUnique({ where: { code } });

    if (!existing) {
        throw new NotFoundError('That extra does not exist');
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.transferExtra.update({ where: { code }, data: { isActive: false } });

        await recordAudit(tx, {
            action: 'TRANSFER_EXTRA_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.transferExtra,
            entityId: updated.id,
            summary: `Retired transfer extra ${code}`,
            req
        });

        return updated;
    });
};

export const listBlackouts = ({ routeId, vehicleId, from, to } = {}) =>
    prisma.transferBlackout.findMany({
        where: {
            ...(routeId ? { routeId } : {}),
            ...(vehicleId ? { vehicleId } : {}),
            ...(from ? { to: { gte: dateOnlyToUtc(from) } } : {}),
            ...(to ? { from: { lte: dateOnlyToUtc(to) } } : {})
        },
        orderBy: { from: 'asc' }
    });

export const createBlackout = async (input, actor, req) => {
    const data = {
        routeId: input.routeId ?? null,
        vehicleId: input.vehicleId ?? null,
        from: dateOnlyToUtc(input.from),
        to: dateOnlyToUtc(input.to),
        reason: input.reason ?? null
    };

    return prisma.$transaction(async (tx) => {
        const created = await tx.transferBlackout.create({ data });

        await recordAudit(tx, {
            action: 'TRANSFER_BLACKOUT_CREATED',
            actor,
            entityType: AUDIT_ENTITY.transferBlackout,
            entityId: created.id,
            summary: `Closed ${input.from} to ${input.to}${input.reason ? `: ${input.reason}` : ''}`,
            metadata: { routeId: data.routeId, vehicleId: data.vehicleId },
            req
        });

        return created;
    });
};

export const deleteBlackout = async (id, actor, req) => {
    const existing = await prisma.transferBlackout.findUnique({ where: { id } });

    if (!existing) {
        throw new NotFoundError('That blackout does not exist');
    }

    await prisma.$transaction(async (tx) => {
        await tx.transferBlackout.delete({ where: { id } });

        await recordAudit(tx, {
            action: 'TRANSFER_BLACKOUT_DELETED',
            actor,
            entityType: AUDIT_ENTITY.transferBlackout,
            entityId: id,
            // A blackout genuinely is deleted rather than retired: it closes a
            // road, and a road that has reopened should stop closing anything.
            // The audit row is what remembers it existed.
            summary: 'Reopened a closed window',
            req
        });
    });
};
