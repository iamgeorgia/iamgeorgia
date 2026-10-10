import { Prisma } from '../../generated/prisma/client.ts';
import { prisma } from '../../db/index.js';
import { WITHHELD_FROM_SUPER_ADMIN, isPartnerCapability, resolveCapabilities } from '../../lib/permissions.js';

/**
 * What an account may do, loaded with the account.
 *
 * Every request that authenticates loads the user with its roles and
 * overrides and resolves them once, here; `can()` then reads the result.
 * One cheap join per request, and no cache: a role edited in the panel or a
 * capability taken from someone applies on their very next request, on
 * every instance, with nothing to invalidate.
 */

/** The include that fetches what `withAccess` needs. Spread beside `partner: true`. */
export const accessInclude = Object.freeze({
    roles: { include: { role: { include: { capabilities: true } } }, orderBy: { role: { sortOrder: 'asc' } } },
    capabilityOverrides: true
});

/**
 * The loaded user with `capabilities` (a Set), `roleKeys`, and `access`
 * (what the panel shows) in place of the raw relation rows, which never
 * belong on `req.user` where a serializer might spread them.
 */
export const withAccess = (user, now = new Date()) => {
    if (!user) return user;

    const { roles = [], capabilityOverrides = [], ...rest } = user;

    return {
        ...rest,
        capabilities: resolveCapabilities({ roles, overrides: capabilityOverrides }, now),
        roleKeys: roles.map((held) => held.role.key),
        access: {
            roles: roles.map((held) => ({ key: held.role.key, name: held.role.name, isSystem: held.role.isSystem })),
            overrides: capabilityOverrides
                .filter((override) => !override.expiresAt || override.expiresAt > now)
                .map((override) => ({ capability: override.capability, effect: override.effect, expiresAt: override.expiresAt ?? null }))
        }
    };
};

/**
 * The ids of every active account that holds a capability right now, by any
 * role or by a live grant, and is not denied it by name. `partnerId: null`
 * means the platform side; a partner's id means that company; leaving it
 * out means anyone.
 *
 * The same answer `resolveCapabilities` would give for each of them, asked
 * of the database at once: this is how the outbox finds who to tell.
 */
export const usersWithCapability = async (capability, { partnerId } = {}) => {
    const superAdminHolds = !WITHHELD_FROM_SUPER_ADMIN.includes(capability) && !isPartnerCapability(capability);
    const scope =
        partnerId === undefined
            ? Prisma.sql``
            : partnerId === null
              ? Prisma.sql`AND u."partner_id" IS NULL`
              : Prisma.sql`AND u."partner_id" = ${partnerId}`;

    const rows = await prisma.$queryRaw`
        SELECT u."id"
          FROM "users" u
         WHERE u."is_active"
           ${scope}
           AND NOT EXISTS (
               SELECT 1 FROM "user_capability_overrides" o
                WHERE o."user_id" = u."id" AND o."capability" = ${capability} AND o."effect" = 'DENY'
                  AND (o."expires_at" IS NULL OR o."expires_at" > now()))
           AND (
               EXISTS (
                   SELECT 1 FROM "user_roles" ur JOIN "role_capabilities" rc ON rc."role_id" = ur."role_id"
                    WHERE ur."user_id" = u."id" AND rc."capability" = ${capability})
               OR (${superAdminHolds}::boolean AND EXISTS (
                   SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id"
                    WHERE ur."user_id" = u."id" AND r."key" = 'SUPER_ADMIN'))
               OR EXISTS (
                   SELECT 1 FROM "user_capability_overrides" o
                    WHERE o."user_id" = u."id" AND o."capability" = ${capability} AND o."effect" = 'GRANT'
                      AND (o."expires_at" IS NULL OR o."expires_at" > now()))
           )`;

    return rows.map((row) => row.id);
};
