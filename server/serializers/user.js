import { capabilitiesFor } from '../lib/permissions.js';

/**
 * Shapes a user for an API response.
 *
 * Built by listing what goes out rather than by deleting what must not: a
 * column added to the model tomorrow is invisible until someone adds it here,
 * which is the safe direction for a table that holds a password hash.
 */
export const toUser = (user) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: [user.firstName, user.lastName].filter(Boolean).join(' '),
    position: user.position ?? null,
    phone: user.phone ?? null,
    isPrimaryContact: user.isPrimaryContact,
    isActive: user.isActive,
    partnerId: user.partnerId ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt
});

/**
 * The signed-in user as `/me` and sign-in describe them: the user, plus what
 * their role lets them do. The client builds its navigation and hides its
 * buttons from this list rather than from a copy of the role table, so a
 * capability granted or withdrawn on the server takes effect at next sign-in
 * with no client release.
 */
export const toSessionUser = (user) => ({
    ...toUser(user),
    capabilities: capabilitiesFor(user.role)
});

const actorRef = (user) =>
    user ? { id: user.id, email: user.email, fullName: [user.firstName, user.lastName].filter(Boolean).join(' ') } : null;

/**
 * A user as the staff and team screens list them: `toUser` plus the
 * lifecycle — a derived status, who invited them, who switched them off.
 * Status is derived here rather than stored because it is a reading of two
 * columns, and two columns cannot disagree with themselves.
 */
export const toUserSummary = (user) => ({
    ...toUser(user),
    status: !user.isActive ? 'DEACTIVATED' : !user.passwordHash ? 'INVITED' : 'ACTIVE',
    invitedAt: user.invitedAt ?? null,
    invitedBy: actorRef(user.invitedBy),
    deactivatedAt: user.deactivatedAt ?? null,
    deactivatedBy: actorRef(user.deactivatedBy)
});

/** The contact block the admin panel shows on a partner row. */
export const toContact = (user) =>
    user
        ? {
              id: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              fullName: [user.firstName, user.lastName].filter(Boolean).join(' '),
              position: user.position ?? null,
              phone: user.phone ?? null,
              email: user.email,
              role: user.role,
              isPrimaryContact: user.isPrimaryContact,
              isActive: user.isActive,
              /** True until they have set a password through their link. */
              isPending: !user.passwordHash
          }
        : null;
