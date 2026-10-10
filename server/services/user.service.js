import { config } from '../config.js';
import { prisma } from '../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../lib/audit.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { sendMailQuietly, activationUrl } from '../lib/mailer/index.js';
import { lockKey } from '../lib/locks.js';
import { CAPABILITIES, isPartnerCapability } from '../lib/permissions.js';
import { STAFF_ROLES } from '../validation/user.js';
import { issueAuthToken, revokeUserSessions } from './auth.service.js';
import { accessInclude } from './rbac/access.js';
import { assertDominates, assertMayManage, assertMayManageCapabilities, grantableFor, isProtected } from './rbac/grant.service.js';
import { capabilitiesOfRoles } from './rbac/role.service.js';

/**
 * Accounts other than one's own: staff, and the members of a partner's team.
 *
 * Both are the same table and the same lifecycle — invited with no password,
 * activated through a link, deactivated, reactivated, deleted — so both go
 * through here, told apart by a `scope`: `{ partnerId: null }` for staff,
 * `{ partnerId }` for a team. Every lookup carries the scope into the query,
 * so an id from another company is simply not found; the router never has to
 * remember to check.
 *
 * Built on the pattern the driver accounts set: a user row with a null
 * password, an ACCOUNT_ACTIVATION token, and the email sent by the route
 * after the commit.
 */

/**
 * Who may give which roles: the actor must hold every capability the roles
 * carry, as the rows say today (`rbac/grant.service.js` has the rule and
 * the reason). The side is checked here too, so a company's admin cannot
 * be handed a platform role by key.
 */
const assertMayAssign = async (tx, actor, roleKeys, side) => {
    const { roles, capabilities } = await capabilitiesOfRoles(tx, roleKeys);
    const wrongSide = roles.filter((role) => role.side !== side).map((role) => role.key);

    if (wrongSide.length > 0) {
        throw new BadRequestError('That role belongs to the other side of the platform', { reason: 'ROLE_WRONG_SIDE', roles: wrongSide });
    }

    // Drivers are made with their profiles, under the fleet; never here.
    if (roles.some((role) => role.key === 'DRIVER')) {
        throw new BadRequestError('A driver account is created from the driver profile', { reason: 'ROLE_WRONG_SIDE', roles: ['DRIVER'] });
    }

    assertMayManageCapabilities(actor, capabilities, { what: 'role' });

    return roles;
};

const sideOfScope = (scope) => (scope.partnerId ? 'PARTNER' : 'PLATFORM');

const assertNotSelf = (user, actor) => {
    if (user.id === actor.id) {
        throw new BadRequestError('You cannot do that to your own account', { reason: 'SELF' });
    }
};

/** INVITED until a password is set; DEACTIVATED wins over that if both apply. */
export const statusOf = (user) => (!user.isActive ? 'DEACTIVATED' : !user.passwordHash ? 'INVITED' : 'ACTIVE');

const scopeWhere = (scope) =>
    scope.partnerId ? { partnerId: scope.partnerId } : { partnerId: null, role: { in: STAFF_ROLES } };

const actorRef = { select: { id: true, email: true, firstName: true, lastName: true } };

const detailInclude = { invitedBy: actorRef, deactivatedBy: actorRef, ...accessInclude };

const fullName = (user) => [user.firstName, user.lastName].filter(Boolean).join(' ');

const findInTx = async (tx, id, scope) => {
    const user = await tx.user.findFirst({ where: { id, ...scopeWhere(scope) }, include: detailInclude });

    if (!user) {
        throw new NotFoundError('User not found');
    }

    return user;
};

export const findUserOr404 = (id, scope) => findInTx(prisma, id, scope);

/**
 * The guard against locking everyone out: the last SUPER_ADMIN who can sign
 * in, or the last owner of a partner, is not demoted, deactivated or deleted.
 * "Can sign in" is the test, so a deactivated or never-activated owner does
 * not count as cover for the one being removed.
 *
 * Under today's ceilings only a peer at the top rank can touch a top-rank
 * account, and that peer is cover by definition, so this never fires. It is
 * the net under the ceilings, for the day one of them is loosened.
 */
const assertNotLast = async (tx, user) => {
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PARTNER_OWNER') {
        return;
    }

    // Serialised per company, or per platform: two owners removing each other
    // at the same moment would otherwise each count the other as cover and
    // leave none.
    await lockKey(tx, `rbac:last:${user.partnerId ?? 'platform'}`);

    const others = await tx.user.count({
        where: {
            id: { not: user.id },
            role: user.role,
            partnerId: user.partnerId,
            isActive: true,
            passwordHash: { not: null }
        }
    });

    if (others === 0) {
        throw new ConflictError(
            user.role === 'SUPER_ADMIN'
                ? 'This is the last super admin who can sign in'
                : "This is the partner's last owner who can sign in",
            { reason: user.role === 'SUPER_ADMIN' ? 'LAST_SUPER_ADMIN' : 'LAST_PARTNER_OWNER' }
        );
    }
};

const statusWhere = (status) => {
    if (status === 'INVITED') return { isActive: true, passwordHash: null };
    if (status === 'ACTIVE') return { isActive: true, passwordHash: { not: null } };
    if (status === 'DEACTIVATED') return { isActive: false };
    return {};
};

export const listUsers = async (scope, { role, status, q, page, pageSize }) => {
    const where = {
        ...scopeWhere(scope),
        ...(role ? { role: { in: role } } : {}),
        ...statusWhere(status),
        ...(q
            ? {
                  OR: [
                      { email: { contains: q, mode: 'insensitive' } },
                      { firstName: { contains: q, mode: 'insensitive' } },
                      { lastName: { contains: q, mode: 'insensitive' } }
                  ]
              }
            : {})
    };

    const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
            where,
            include: detailInclude,
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { createdAt: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { users, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

/**
 * Creates the account and issues its activation link.
 *
 * Returns the plaintext token; it is never stored. The route sends the mail
 * after this commits and returns the link as well, so whoever invited can
 * pass it on by hand when the mail does not arrive.
 */
export const inviteUser = (scope, { email, firstName, lastName, role, position, phone }, actor, req) =>
    prisma.$transaction(async (tx) => {
        await assertMayAssign(tx, actor, [role], sideOfScope(scope));

        const taken = await tx.user.findUnique({ where: { email }, select: { id: true } });

        if (taken) {
            throw new ConflictError('An account with that email already exists', { field: 'email' });
        }

        if (scope.partnerId) {
            const members = await tx.user.count({ where: { partnerId: scope.partnerId } });

            if (members >= config.partners.teamMax) {
                throw new ConflictError(`A team can have at most ${config.partners.teamMax} members`, {
                    reason: 'TEAM_FULL',
                    max: config.partners.teamMax
                });
            }
        }

        const user = await tx.user.create({
            data: {
                email,
                firstName,
                lastName,
                position: position ?? null,
                phone: phone ?? null,
                role,
                partnerId: scope.partnerId ?? null,
                isActive: true,
                invitedByUserId: actor.id,
                invitedAt: new Date()
            },
            include: detailInclude
        });

        const { token, authToken } = await issueAuthToken(tx, {
            userId: user.id,
            purpose: 'ACCOUNT_ACTIVATION',
            ttlMs: config.auth.activationTtlMs
        });

        await recordAudit(tx, {
            action: 'USER_INVITED',
            actor,
            entityType: AUDIT_ENTITY.user,
            entityId: user.id,
            summary: `Invited ${email} as ${role}`,
            metadata: { role, partnerId: scope.partnerId ?? null },
            req
        });

        return { user, token, expiresAt: authToken.expiresAt };
    });

/** A fresh activation link, for an account that has never set a password. */
export const resendActivation = (scope, id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const user = await findInTx(tx, id, scope);

        if (statusOf(user) !== 'INVITED') {
            throw new ConflictError('This account has already been activated', { reason: 'ALREADY_ACTIVE' });
        }

        await assertMayManage(tx, actor, user.id);

        const { token, authToken } = await issueAuthToken(tx, {
            userId: user.id,
            purpose: 'ACCOUNT_ACTIVATION',
            ttlMs: config.auth.activationTtlMs
        });

        await recordAudit(tx, {
            action: 'INVITATION_RESENT',
            actor,
            entityType: AUDIT_ENTITY.user,
            entityId: user.id,
            summary: `Re-sent the activation link to ${user.email}`,
            req
        });

        return { user, token, expiresAt: authToken.expiresAt };
    });

/**
 * Moves an account to another role. Ends its sessions, because what a
 * session may do is read off the role on every request and the person
 * should see their new panel, not a stale one.
 */
/**
 * Sets the roles an account holds — the whole set, never a delta, so what
 * the screen shows is what they get.
 *
 * The primary role (`users.role`, which a trigger keeps in step with the
 * rows) is the first system role of the set by order; a set of panel-made
 * roles alone has no primary and is refused until the column goes. Taking
 * the last super admin's or owner's role away is refused like deactivating
 * them would be. Sessions end, not for safety — the next request resolves
 * the new set anyway — but so the person sees their new panel.
 */
export const setUserRoles = (scope, id, { roles: roleKeys }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const user = await findInTx(tx, id, scope);

        assertNotSelf(user, actor);
        await assertMayManage(tx, actor, user.id);

        const roles = await assertMayAssign(tx, actor, roleKeys, sideOfScope(scope));
        const primary = roles.filter((role) => role.isSystem).sort((a, b) => a.sortOrder - b.sortOrder)[0];

        if (!primary) {
            throw new ConflictError('An account needs one of the built-in roles', { reason: 'PRIMARY_ROLE_REQUIRED' });
        }

        const current = user.roles.map((held) => held.role.key).sort();
        const next = [...roleKeys].sort();

        if (current.join(',') === next.join(',')) {
            return user;
        }

        if (['SUPER_ADMIN', 'PARTNER_OWNER'].includes(user.role) && !next.includes(user.role)) {
            await assertNotLast(tx, user);
        }

        // The primary first: the trigger swaps its row. Then the rest.
        if (user.role !== primary.key) {
            await tx.user.update({ where: { id }, data: { role: primary.key } });
        }

        await tx.userRole.deleteMany({ where: { userId: id, role: { key: { notIn: next } } } });
        await tx.userRole.createMany({
            data: roles.map((role) => ({ userId: id, roleId: role.id, grantedByUserId: actor.id })),
            skipDuplicates: true
        });

        await revokeUserSessions(tx, id);

        await recordAudit(tx, {
            action: current.length === 1 && next.length === 1 ? 'USER_ROLE_CHANGED' : 'USER_ROLES_CHANGED',
            actor,
            entityType: AUDIT_ENTITY.user,
            entityId: id,
            summary: `Changed ${user.email} from ${current.join(', ')} to ${next.join(', ')}`,
            metadata: { from: current.length === 1 ? current[0] : current, to: next.length === 1 ? next[0] : next },
            req
        });

        return findInTx(tx, id, scope);
    });

/** The single-role form the older screens use: the set becomes that one role. */
export const changeRole = (scope, id, { role }, actor, req) => setUserRoles(scope, id, { roles: [role] }, actor, req);

/** What the actor may hand out in this scope, for the pickers. */
export const grantable = (scope, actor) => grantableFor(prisma, actor, { side: sideOfScope(scope) });

/**
 * One capability granted to, or taken from, an account by name.
 *
 * A grant is handing out, so the actor must hold it; a denial only needs
 * the actor to manage the account. The ones that hand out everything else
 * are never written this way. One row per capability: writing it again
 * replaces the reason and the last day.
 */
export const grantOverride = (scope, id, { capability, effect, reason, expiresAt }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const user = await findInTx(tx, id, scope);

        assertNotSelf(user, actor);
        await assertMayManage(tx, actor, user.id);

        if (isProtected(capability)) {
            throw new ForbiddenError('That capability only ever comes with a role', { reason: 'PROTECTED_CAPABILITY', capability });
        }

        const partnerSide = Boolean(scope.partnerId);
        const fits = partnerSide ? isPartnerCapability(capability) || capability === CAPABILITIES.NOTIFICATIONS_READ : !isPartnerCapability(capability);

        if (!fits) {
            throw new BadRequestError('That capability belongs to the other side of the platform', { reason: 'CAPABILITY_WRONG_SIDE', capability });
        }

        if (effect === 'GRANT') {
            assertDominates(actor, [capability], { what: 'capability' });
        }

        const override = await tx.userCapabilityOverride.upsert({
            where: { userId_capability: { userId: id, capability } },
            update: { effect, reason, expiresAt: expiresAt ?? null, grantedByUserId: actor.id },
            create: { userId: id, capability, effect, reason, expiresAt: expiresAt ?? null, grantedByUserId: actor.id }
        });

        await recordAudit(tx, {
            action: 'USER_OVERRIDE_GRANTED',
            actor,
            entityType: AUDIT_ENTITY.user,
            entityId: id,
            summary: `${effect === 'GRANT' ? 'Granted' : 'Denied'} ${user.email} ${capability}`,
            metadata: { capability, effect, reason, expiresAt: expiresAt ?? null },
            req
        });

        return override;
    });

export const revokeOverride = (scope, id, capability, actor, req) =>
    prisma.$transaction(async (tx) => {
        const user = await findInTx(tx, id, scope);

        assertNotSelf(user, actor);
        await assertMayManage(tx, actor, user.id);

        const override = await tx.userCapabilityOverride.findUnique({ where: { userId_capability: { userId: id, capability } } });

        if (!override) {
            throw new NotFoundError('No such override');
        }

        await tx.userCapabilityOverride.delete({ where: { id: override.id } });

        await recordAudit(tx, {
            action: 'USER_OVERRIDE_REVOKED',
            actor,
            entityType: AUDIT_ENTITY.user,
            entityId: id,
            summary: `Removed the ${override.effect === 'GRANT' ? 'grant' : 'denial'} of ${capability} from ${user.email}`,
            metadata: { capability, effect: override.effect },
            req
        });
    });

/**
 * Switches an account off. Its sessions end now, and every unused link that
 * could set a password is spent too — activation marks the account active
 * again, and a reset link issued before the deactivation must not undo it.
 */
export const deactivateUser = (scope, id, { reason } = {}, actor, req) =>
    prisma.$transaction(async (tx) => {
        const user = await findInTx(tx, id, scope);

        assertNotSelf(user, actor);
        await assertMayManage(tx, actor, user.id);

        const status = statusOf(user);

        if (status === 'DEACTIVATED') {
            return user;
        }

        if (status === 'INVITED') {
            throw new ConflictError('This account was never activated; delete the invitation instead', {
                reason: 'NOT_ACTIVATED'
            });
        }

        await assertNotLast(tx, user);

        const now = new Date();
        const updated = await tx.user.update({
            where: { id },
            data: { isActive: false, deactivatedAt: now, deactivatedByUserId: actor.id },
            include: detailInclude
        });

        await revokeUserSessions(tx, id);
        await tx.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: now } });

        await recordAudit(tx, {
            action: 'USER_DEACTIVATED',
            actor,
            entityType: AUDIT_ENTITY.user,
            entityId: id,
            summary: `Deactivated ${user.email}`,
            metadata: { reason: reason ?? null },
            req
        });

        return updated;
    });

export const reactivateUser = (scope, id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const user = await findInTx(tx, id, scope);

        await assertMayManage(tx, actor, user.id);

        if (user.isActive) {
            return user;
        }

        const updated = await tx.user.update({
            where: { id },
            data: { isActive: true, deactivatedAt: null, deactivatedByUserId: null },
            include: detailInclude
        });

        await recordAudit(tx, {
            action: 'USER_REACTIVATED',
            actor,
            entityType: AUDIT_ENTITY.user,
            entityId: id,
            summary: `Reactivated ${user.email}`,
            req
        });

        return updated;
    });

/** Signs the account out everywhere; the password stays. */
export const revokeSessions = (scope, id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const user = await findInTx(tx, id, scope);

        await assertMayManage(tx, actor, user.id);

        const { count } = await revokeUserSessions(tx, id);

        await recordAudit(tx, {
            action: 'USER_SESSIONS_REVOKED',
            actor,
            entityType: AUDIT_ENTITY.user,
            entityId: id,
            summary: `Signed ${user.email} out of ${count} session${count === 1 ? '' : 's'}`,
            metadata: { count },
            req
        });

        return { user, count };
    });

/**
 * A real delete, for an account that is not in use: never activated, or
 * already switched off. An active account is deactivated first, on purpose,
 * so that "gone" is always a two-step thing. The address typed back is the
 * confirmation. Sessions and tokens cascade; every booking the person made
 * keeps its row and loses only the link (`bookedByUserId` is SET NULL
 * everywhere), and the audit trail keeps the email it snapshotted.
 */
export const deleteUser = (scope, id, { confirm }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const user = await findInTx(tx, id, scope);

        assertNotSelf(user, actor);
        await assertMayManage(tx, actor, user.id);

        if (confirm !== user.email) {
            throw new BadRequestError('Type the account email address to confirm', { reason: 'CONFIRM_MISMATCH' });
        }

        if (statusOf(user) === 'ACTIVE') {
            throw new ConflictError('Deactivate the account before deleting it', { reason: 'STILL_ACTIVE' });
        }

        await assertNotLast(tx, user);

        await recordAudit(tx, {
            action: 'USER_DELETED',
            actor,
            entityType: AUDIT_ENTITY.user,
            entityId: id,
            summary: `Deleted ${user.email} (${user.role})`,
            metadata: { email: user.email, role: user.role, partnerId: user.partnerId, status: statusOf(user) },
            req
        });

        await tx.user.delete({ where: { id } });
    });

/**
 * Exactly one primary contact per partner; this moves it.
 *
 * Held to the same ceiling as every other change here, on both ends: the
 * member who gains it and the member who loses it. Otherwise a partner admin
 * could take the role of the company's voice from its owner by naming
 * themselves.
 */
export const setPrimaryContact = (scope, id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const user = await findInTx(tx, id, scope);

        if (statusOf(user) !== 'ACTIVE') {
            throw new ConflictError('The primary contact must be an active account', { reason: 'NOT_ACTIVE' });
        }

        if (user.isPrimaryContact) {
            return user;
        }

        await assertMayManage(tx, actor, user.id);

        const previous = await tx.user.findFirst({
            where: { partnerId: scope.partnerId, isPrimaryContact: true },
            select: { id: true, email: true, role: true }
        });

        if (previous) {
            await assertMayManage(tx, actor, previous.id);
        }

        await tx.user.updateMany({
            where: { partnerId: scope.partnerId, isPrimaryContact: true },
            data: { isPrimaryContact: false }
        });

        const updated = await tx.user.update({ where: { id }, data: { isPrimaryContact: true }, include: detailInclude });

        await recordAudit(tx, {
            action: 'USER_PRIMARY_CONTACT_CHANGED',
            actor,
            entityType: AUDIT_ENTITY.user,
            entityId: id,
            summary: `Made ${user.email} the primary contact${previous ? ` in place of ${previous.email}` : ''}`,
            metadata: { previousUserId: previous?.id ?? null },
            req
        });

        return updated;
    });

/**
 * Emails the activation link, after the commit, and says whether that worked.
 *
 * The link goes back in the response as well: the person who pressed the
 * button can copy it and pass it on when the mail does not arrive, and
 * `emailSent` tells the panel whether to suggest that.
 */
export const deliverActivation = async ({ user, token, expiresAt }, { template, data = {} }) => {
    const url = activationUrl(token);
    const sent = await sendMailQuietly({
        to: user.email,
        template,
        data: { contactName: fullName(user), url, expiresAt, ...data }
    });

    return { link: { kind: 'activation', url, expiresAt }, email: user.email, emailSent: sent !== null };
};
