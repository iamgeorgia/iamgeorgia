import { config } from '../config.js';
import { prisma } from '../db/index.js';
import { hashPassword, verifyPassword, needsRehash, dummyVerify } from '../lib/password.js';
import { createToken, hashToken, expiresIn } from '../lib/tokens.js';
import { recordAudit, AUDIT_ENTITY } from '../lib/audit.js';
import { containsPersonal, PERSONAL_PASSWORD_MESSAGE } from '../validation/normalize.js';
import { UnauthorizedError, BadRequestError, NotFoundError, ConflictError, GoneError, ForbiddenError } from '../lib/errors.js';
import { accessInclude, withAccess } from './rbac/access.js';

// One message for every way a sign-in can fail. Distinguishing "no such
// account" from "wrong password" from "not activated yet" would turn the login
// form into a tool for discovering who has an account here.
const LOGIN_FAILED = 'Incorrect email address or password';

const cookieOptions = () => ({
    httpOnly: true,
    // `strict` rather than `lax`, and it costs nothing here. The session cookie
    // belongs to the API's own host and is only ever attached to XHR from the
    // client app — there is no flow in which a top-level navigation to the API
    // needs to be authenticated, which is the only thing `lax` permits that
    // `strict` does not. If the client could not already reach the API as the
    // same site, `lax` would be blocking these requests today.
    sameSite: 'strict',
    // `isDeployed`, not `isProduction`: staging is reachable from the internet
    // and its session cookies are just as interceptable, so anything that is
    // not a developer's machine or the test suite gets `Secure`.
    secure: config.isDeployed,
    // Only when configured: `undefined` leaves the attribute out entirely,
    // which keeps the cookie host-only. Shared with clearSessionCookie, since a
    // cookie is only removed by a Set-Cookie naming the same domain and path.
    domain: config.auth.cookieDomain,
    path: '/',
    maxAge: config.auth.sessionTtlMs
});

/**
 * Expires the host-only session cookie a browser may still hold from before
 * AUTH_COOKIE_DOMAIN was set.
 *
 * A cookie is identified by name, domain and path, so the host-only cookie
 * the API used to set and the `Domain=` one it sets now are two different
 * cookies to the browser. Clearing the current one never touched the old
 * one, and the browser kept sending both to the API host — oldest first,
 * which is the dead one — and the cookie parser keeps the first value it
 * sees. Every write from the browser then failed with 401 while server
 * rendered pages, which only carry the site host's cookie, kept working.
 *
 * Sent on every sign-in and sign-out, so an affected browser heals itself the
 * next time it signs in. A no-op when no domain is configured: the current
 * cookie is then host-only itself and the two would be the same cookie.
 */
const clearLegacyHostOnlyCookie = (res) => {
    if (!config.auth.cookieDomain) {
        return;
    }

    res.clearCookie(config.auth.cookieName, { ...cookieOptions(), domain: undefined, maxAge: undefined });
};

export const setSessionCookie = (res, token) => {
    clearLegacyHostOnlyCookie(res);
    res.cookie(config.auth.cookieName, token, cookieOptions());
};

export const clearSessionCookie = (res) => {
    clearLegacyHostOnlyCookie(res);
    res.clearCookie(config.auth.cookieName, { ...cookieOptions(), maxAge: undefined });
};

export const createSession = async (user, req) => {
    const token = createToken();

    await prisma.session.create({
        data: {
            tokenHash: hashToken(token),
            userId: user.id,
            expiresAt: expiresIn(config.auth.sessionTtlMs),
            ip: req?.ip ?? null,
            userAgent: req?.get('user-agent')?.slice(0, 300) ?? null
        }
    });

    return token;
};

/**
 * Ends every live session for a user.
 *
 * Called on suspension, rejection and any password change. This is the payoff
 * for keeping sessions in the database: a suspended partner loses access on
 * their next request rather than whenever a signed token would have lapsed.
 */
export const revokeUserSessions = (client, userId) =>
    client.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
    });

export const revokePartnerSessions = (client, partnerId) =>
    client.session.updateMany({
        where: { revokedAt: null, user: { partnerId } },
        data: { revokedAt: new Date() }
    });

/**
 * Verifies credentials and starts a session.
 *
 * Any partner status may sign in, including PENDING_APPROVAL, REJECTED and
 * SUSPENDED. That is deliberate: the portal has a page explaining each of those
 * states, and a partner who is told "incorrect password" when the real answer
 * is "your application is still being reviewed" will call support. No protected
 * functionality is reachable from those states — `requireApprovedPartner`
 * guards it independently of this.
 */
export const login = async ({ email, password }, req) => {
    const user = withAccess(
        await prisma.user.findUnique({
            where: { email },
            include: { partner: true, ...accessInclude }
        })
    );

    // The comparison runs even when there is no account, against a hash of a
    // random value, so both paths cost the same wall-clock time.
    const passwordMatches = user?.passwordHash
        ? await verifyPassword(password, user.passwordHash)
        : await dummyVerify(password);

    const loginFailed = async (reason) => {
        if (user) {
            await recordAudit(prisma, {
                action: 'USER_LOGIN_FAILED',
                actor: null,
                entityType: AUDIT_ENTITY.user,
                entityId: user.id,
                summary: `Failed sign-in for ${user.email}`,
                metadata: { reason },
                req
            });
        }
    };

    if (!user || !user.passwordHash || !passwordMatches) {
        await loginFailed(!user?.passwordHash ? 'not_activated' : 'bad_password');

        throw new UnauthorizedError(LOGIN_FAILED);
    }

    // A blocked or terminated company gets a straight answer, after the
    // password has been checked so the answer is only given to someone who
    // holds it. Unlike the review states, there is no page to show them.
    if (user.partner && (user.partner.status === 'BLOCKED' || user.partner.status === 'TERMINATED')) {
        await loginFailed(`partner_${user.partner.status.toLowerCase()}`);

        throw new ForbiddenError(
            user.partner.status === 'BLOCKED'
                ? 'Your company’s access to the platform has been blocked'
                : 'Your company no longer has an account on the platform',
            { reason: `PARTNER_${user.partner.status}`, partnerStatus: user.partner.status }
        );
    }

    if (!user.isActive) {
        await loginFailed('inactive');

        throw new UnauthorizedError(LOGIN_FAILED);
    }

    // The plaintext is in hand exactly once per login, which is the only moment
    // a hash made with older parameters can be upgraded.
    if (needsRehash(user.passwordHash)) {
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: await hashPassword(password) }
        });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = await createSession(user, req);

    // The success is on the trail next to the failures, so "who was signed in
    // when this happened" can be answered. The user agent, never the token.
    await recordAudit(prisma, {
        action: 'USER_LOGIN_SUCCEEDED',
        actor: user,
        entityType: AUDIT_ENTITY.user,
        entityId: user.id,
        summary: `${user.email} signed in`,
        metadata: { userAgent: req?.get?.('user-agent')?.slice(0, 200) ?? null },
        req
    });

    return { user, token };
};

export const logout = async (session, req) => {
    if (!session) {
        return;
    }

    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

    await recordAudit(prisma, {
        action: 'USER_LOGGED_OUT',
        actor: session.user,
        entityType: AUDIT_ENTITY.user,
        entityId: session.userId,
        summary: `${session.user?.email ?? session.userId} signed out`,
        req
    });
};

/**
 * Issues a single-use link that sets a password.
 *
 * Any earlier unused token for the same purpose is spent first, so a reissued
 * link silently kills the previous one instead of leaving two valid ways in.
 */
export const issueAuthToken = async (client, { userId, purpose, ttlMs }) => {
    const token = createToken();

    await client.authToken.updateMany({
        where: { userId, purpose, usedAt: null },
        data: { usedAt: new Date() }
    });

    const row = await client.authToken.create({
        data: {
            tokenHash: hashToken(token),
            purpose,
            userId,
            expiresAt: expiresIn(ttlMs)
        }
    });

    return { token, authToken: row };
};

/**
 * Looks a token up and says precisely why it cannot be used.
 *
 * The four failures get four different statuses because the front end has four
 * different things to say: 404 "that link is not one of ours", 409 "already
 * used", 410 "expired, ask for another". Collapsing them into one status would
 * leave the user guessing which of those happened.
 */
export const resolveAuthToken = async (token, purpose) => {
    const row = await prisma.authToken.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: { include: { partner: true } } }
    });

    if (!row || row.purpose !== purpose) {
        throw new NotFoundError('This link is not valid');
    }

    if (row.usedAt) {
        throw new ConflictError('This link has already been used');
    }

    if (row.expiresAt <= new Date()) {
        throw new GoneError('This link has expired', { canRequestNew: true });
    }

    return row;
};

/**
 * Changes a password from inside a live session.
 *
 * Every other session is ended, because the commonest reason to change a
 * password is suspecting somebody else has it — leaving their session alive
 * would defeat the exercise. The caller's own session goes too and a fresh one
 * is issued, so the device doing the changing is not signed out for its
 * trouble.
 */
export const changePassword = async (user, { currentPassword, newPassword }, req) => {
    if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
        throw new UnauthorizedError('Your current password is not correct');
    }

    if (containsPersonal(newPassword, [user.email, user.firstName, user.lastName])) {
        throw new BadRequestError(PERSONAL_PASSWORD_MESSAGE);
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
        await revokeUserSessions(tx, user.id);

        await recordAudit(tx, {
            action: 'USER_PASSWORD_CHANGED',
            actor: user,
            entityType: AUDIT_ENTITY.user,
            entityId: user.id,
            summary: `${user.email} changed their password`,
            req
        });
    });

    return createSession(user, req);
};

/** Spends the token, sets the password, and clears any session it replaces. */
export const consumeAuthToken = async (token, purpose, password, req) => {
    const row = await resolveAuthToken(token, purpose);

    if (containsPersonal(password, [row.user.email, row.user.firstName, row.user.lastName])) {
        throw new BadRequestError(PERSONAL_PASSWORD_MESSAGE);
    }

    const passwordHash = await hashPassword(password);

    return prisma.$transaction(async (tx) => {
        // Guarded on usedAt so two submissions of the same link race to one
        // winner rather than both succeeding.
        const spent = await tx.authToken.updateMany({
            where: { id: row.id, usedAt: null },
            data: { usedAt: new Date() }
        });

        if (spent.count === 0) {
            throw new ConflictError('This link has already been used');
        }

        const user = withAccess(
            await tx.user.update({
                where: { id: row.userId },
                data: { passwordHash, isActive: true },
                include: { partner: true, ...accessInclude }
            })
        );

        // A new password ends every session that was opened with the old one.
        await revokeUserSessions(tx, user.id);

        await recordAudit(tx, {
            action: 'USER_ACTIVATED',
            actor: { id: user.id, email: user.email },
            entityType: AUDIT_ENTITY.user,
            entityId: user.id,
            summary:
                purpose === 'ACCOUNT_ACTIVATION'
                    ? `${user.email} activated their account`
                    : `${user.email} reset their password`,
            metadata: { purpose },
            req
        });

        return user;
    });
};
