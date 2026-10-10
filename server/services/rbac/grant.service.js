import { ForbiddenError } from '../../lib/errors.js';
import { CAPABILITIES, ROLE_CAPABILITIES, isPartnerCapability, resolveCapabilities } from '../../lib/permissions.js';
import { accessInclude } from './access.js';

/**
 * The one rule under every grant: nobody hands out, or touches, more than
 * they hold.
 *
 * An actor may give a role, write an override, or act on an account only if
 * it holds every capability the role carries or the account resolves to.
 * Anything looser is a way up — a partner admin cannot change bank details,
 * so it must not be able to invite a finance user, open the returned
 * activation link, and change them as that user. Holding every capability
 * of a *peer* is not the same as outranking it, so only the top of each
 * side manages its equals: an owner another owner, a super admin another
 * super admin.
 */

/** The roles that manage their own equals. */
const TOP_ROLES = new Set(['SUPER_ADMIN', 'PARTNER_OWNER']);

/**
 * Capabilities that only ever come with a role, and only from an actor who
 * may shape roles: the ones that hand out everything else.
 */
export const PROTECTED_CAPABILITIES = Object.freeze([
    CAPABILITIES.PLATFORM_ADMIN,
    CAPABILITIES.USERS_STAFF_MANAGE,
    CAPABILITIES.ROLES_MANAGE,
    CAPABILITIES.SETTINGS_WRITE,
    CAPABILITIES.PARTNER_TEAM_MANAGE,
    // Deciding on money, and moving it with no second person.
    CAPABILITIES.FINANCE_REFUNDS_APPROVE,
    CAPABILITIES.FINANCE_REFUNDS_EXECUTE,
    CAPABILITIES.FINANCE_ADJUSTMENTS_APPROVE,
    CAPABILITIES.FINANCE_ADJUSTMENTS_EXECUTE
]);

export const isProtected = (capability) => PROTECTED_CAPABILITIES.includes(capability);

/** What an actor holds now: resolved on the session, or the seed table for a bare `{ role }`. */
export const heldBy = (actor) =>
    actor?.capabilities instanceof Set
        ? actor.capabilities
        : Array.isArray(actor?.capabilities)
          ? new Set(actor.capabilities)
          : (ROLE_CAPABILITIES[actor?.role] ?? new Set());

export const isTop = (actor) => (actor?.roleKeys ?? [actor?.role]).some((key) => TOP_ROLES.has(key));

/** Every capability in `capabilities` is held by the actor, else a 403 naming what is not. */
export const assertDominates = (actor, capabilities, { what = 'account' } = {}) => {
    const own = heldBy(actor);
    const missing = [...capabilities].filter((capability) => !own.has(capability));

    if (missing.length > 0) {
        throw new ForbiddenError(`That ${what} can do things your own cannot`, {
            reason: 'ROLE_ABOVE_CEILING',
            missing: missing.sort()
        });
    }
};

/**
 * Whether the actor may act on an account that resolves to `capabilities`:
 * holds all of them, and either holds strictly more or sits at the top of
 * its side.
 */
export const assertMayManageCapabilities = (actor, capabilities, { what = 'account' } = {}) => {
    assertDominates(actor, capabilities, { what });

    const own = heldBy(actor);
    const theirs = new Set(capabilities);

    if (theirs.size >= own.size && !isTop(actor)) {
        throw new ForbiddenError(`That ${what} is your equal; only an owner or a super admin manages those`, {
            reason: 'ROLE_ABOVE_CEILING',
            missing: []
        });
    }
};

/** What an account resolves to, from its rows. */
export const effectiveCapabilities = async (client, userId) => {
    const user = await client.user.findUnique({ where: { id: userId }, include: accessInclude });

    return user ? resolveCapabilities({ roles: user.roles, overrides: user.capabilityOverrides }) : new Set();
};

/** The actor may act on the account: deactivate it, change its roles, sign it out. */
export const assertMayManage = async (client, actor, userId) => {
    assertMayManageCapabilities(actor, await effectiveCapabilities(client, userId));
};

/**
 * What an actor may hand out, for the pickers: the roles on `side` it
 * dominates, and the capabilities it holds that may be written by name.
 */
export const grantableFor = async (client, actor, { side }) => {
    const own = heldBy(actor);
    const roles = await client.accessRole.findMany({
        where: { side },
        include: { capabilities: true },
        orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }]
    });

    const assignable = roles.filter((role) => {
        // Drivers are made from their profiles, under the fleet; never here.
        if (role.key === 'DRIVER') return false;

        const theirs = role.capabilities.map((row) => row.capability);
        const held = theirs.every((capability) => own.has(capability));

        return held && (theirs.length < own.size || isTop(actor));
    });

    const capabilities = [...own]
        .filter((capability) => !isProtected(capability))
        .filter((capability) => (side === 'PARTNER' ? isPartnerCapability(capability) : !isPartnerCapability(capability)))
        .sort();

    return { roles: assignable, capabilities };
};
