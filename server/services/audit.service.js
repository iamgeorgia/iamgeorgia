import { prisma } from '../db/index.js';

/**
 * The audit trail as a whole, filtered.
 *
 * The partner-scoped reader in partner.service.js answers "what happened to
 * this partner"; this one answers "what happened", across every entity and
 * actor, for the people whose job is to check. Read-only by construction:
 * nothing here writes, and the rows themselves are only ever appended.
 */
export const listAuditLog = async ({ entityType, entityId, actorUserId, action, q, from, to, page, pageSize }) => {
    const where = {
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(actorUserId ? { actorUserId } : {}),
        ...(action ? { action } : {}),
        ...(from || to
            ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
            : {}),
        ...(q
            ? {
                  OR: [
                      { summary: { contains: q, mode: 'insensitive' } },
                      { actorEmail: { contains: q, mode: 'insensitive' } },
                      { entityId: q }
                  ]
              }
            : {})
    };

    const [total, entries] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
            where,
            include: { actorUser: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { entries, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};
