import { NotFoundError } from '../../lib/errors.js';
import { isStaff } from '../../middleware/auth.js';

/**
 * What one partner may sell, per product type.
 *
 * The rows ride on the session's partner (`partner.productAccess`), so this
 * is a pure function of the viewer: every catalogue query applies it without
 * another round trip, and a partner's own agents, finance users and owner see
 * exactly the same catalogue.
 *
 * The policy: no rows for a type means everything; a DENY row always hides
 * that product; one or more ALLOW rows for a type turn the type into an
 * allow-list. Staff and guests are never restricted here — a guest's channel
 * is `b2cEnabled`, settled elsewhere.
 *
 * Returns `null` when nothing applies, otherwise `{ allow, deny }` where
 * `allow` is a list of ids or `null` for "any", and `deny` a list (possibly
 * empty).
 */
export const accessFor = (viewer, productType) => {
    if (!viewer?.partnerId || isStaff(viewer)) {
        return null;
    }

    const rows = (viewer.partner?.productAccess ?? []).filter((row) => row.productType === productType);

    if (rows.length === 0) {
        return null;
    }

    const allow = rows.filter((row) => row.mode === 'ALLOW').map((row) => row.productId);
    const deny = rows.filter((row) => row.mode === 'DENY').map((row) => row.productId);

    return { allow: allow.length > 0 ? allow : null, deny };
};

/** A Prisma `where` fragment on `id`, for the list and detail queries. */
export const accessWhere = (viewer, productType) => {
    const access = accessFor(viewer, productType);

    if (!access) {
        return {};
    }

    return {
        id: {
            ...(access.allow ? { in: access.allow } : {}),
            ...(access.deny.length > 0 ? { notIn: access.deny } : {})
        }
    };
};

/**
 * Narrows an id list a query is already restricted to. `null` in means "no
 * restriction"; an empty array out means "nothing", which the raw queries
 * read as `= ANY('{}')`, matching no row.
 */
export const restrictIds = (ids, viewer, productType) => {
    const access = accessFor(viewer, productType);

    if (!access?.allow) {
        return ids ?? null;
    }

    return ids ? ids.filter((id) => access.allow.includes(id)) : access.allow;
};

/** The ids to exclude outright, for the raw queries. `null` when none. */
export const deniedIds = (viewer, productType) => {
    const access = accessFor(viewer, productType);

    return access && access.deny.length > 0 ? access.deny : null;
};

export const isAllowed = (viewer, productType, productId) => {
    const access = accessFor(viewer, productType);

    if (!access) {
        return true;
    }

    if (access.deny.includes(productId)) {
        return false;
    }

    return !access.allow || access.allow.includes(productId);
};

/**
 * Refuses a product the partner may not sell, as a 404: on this partner's
 * channel the product does not exist, and a 403 would say it does.
 */
export const assertAllowed = (viewer, productType, productId, message = 'Not found') => {
    if (!isAllowed(viewer, productType, productId)) {
        throw new NotFoundError(message);
    }
};
