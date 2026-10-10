/** A role as the editor and the pickers see it. */
export const toRole = (role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description ?? null,
    side: role.side,
    isSystem: role.isSystem,
    sortOrder: role.sortOrder,
    capabilities: (role.capabilities ?? []).map((row) => row.capability).sort(),
    members: role._count?.members ?? null,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt
});

/** A capability granted or denied by name. */
export const toOverride = (override) => ({
    capability: override.capability,
    effect: override.effect,
    reason: override.reason,
    expiresAt: override.expiresAt ?? null,
    grantedByUserId: override.grantedByUserId ?? null,
    createdAt: override.createdAt
});
