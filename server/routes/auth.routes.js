import { Router } from 'express';

import { config } from '../config.js';
import { prisma } from '../db/index.js';
import { validate } from '../middleware/validate.js';
import { authenticate, optionalAuthenticate, noStoreResponses } from '../middleware/auth.js';
import { CAPABILITIES, can } from '../lib/permissions.js';
import {
    authAccountLimiter,
    authIpLimiter,
    authLimiter,
    forgotPasswordLimiter,
    passwordChangeLimiter,
    tokenLookupLimiter
} from '../middleware/rateLimit.js';
import {
    loginSchema,
    tokenParamSchema,
    setPasswordSchema,
    forgotPasswordSchema,
    changePasswordSchema
} from '../validation/auth.js';
import { toSessionUser } from '../serializers/user.js';
import { toPartnerDetail } from '../serializers/partner.js';
import { findPartnerOr404 } from '../services/partner.service.js';
import { findDriverByUserId } from '../services/transfer/driver.service.js';
import { toDriverSelf } from '../serializers/driver.js';
import { sendMailQuietly, passwordResetUrl } from '../lib/mailer/index.js';
import {
    login,
    logout,
    createSession,
    changePassword,
    setSessionCookie,
    clearSessionCookie,
    resolveAuthToken,
    consumeAuthToken,
    issueAuthToken
} from '../services/auth.service.js';

export const authRoutes = Router();

// Nothing under /auth is cacheable by anyone. Sign-in answers with the identity
// as well as the cookie, and the activation and reset lookups describe a named
// account — none of which belongs in a shared cache between here and the
// browser. Applied to the router so a new endpoint cannot forget it.
authRoutes.use(noStoreResponses);

/** The one place the client learns who it is signed in as. */
const identity = async (user) => ({
    user: toSessionUser(user),
    // Without the bank details: the session is read on every page, and an
    // IBAN belongs on the one screen that asks for it, not in every bootstrap.
    partner: user.partnerId ? toPartnerDetail(await findPartnerOr404(user.partnerId, user, { financial: false }), user) : null,
    // Null for everyone but a driver, and null for a driver whose account has
    // not been linked to a profile yet — the panel shows that as its own state.
    driver: can(user, CAPABILITIES.DRIVER_PANEL) ? toDriverSelf(await findDriverByUserId(user.id)) : null
});

authRoutes.post('/login', authIpLimiter, authAccountLimiter, authLimiter, validate({ body: loginSchema }), async (req, res) => {
    const { user, token } = await login(req.valid.body, req);

    setSessionCookie(res, token);
    res.json(await identity(user));
});

authRoutes.post('/logout', optionalAuthenticate, async (req, res) => {
    await logout(req.session, req);
    clearSessionCookie(res);

    // 204 whether or not there was a session to end: logging out of nothing has
    // succeeded by any definition the caller cares about.
    res.status(204).end();
});

authRoutes.get('/me', authenticate, async (req, res) => {
    res.json(await identity(req.user));
});

// --- Account activation -----------------------------------------------------

authRoutes.get(
    '/activation/:token',
    tokenLookupLimiter,
    validate({ params: tokenParamSchema }),
    async (req, res) => {
        const row = await resolveAuthToken(req.valid.params.token, 'ACCOUNT_ACTIVATION');

        // Enough to greet the holder by name and show which company they are
        // activating for. Nothing that would be worth guessing a token to read.
        res.json({
            email: row.user.email,
            firstName: row.user.firstName,
            lastName: row.user.lastName,
            companyName: row.user.partner?.name ?? null,
            expiresAt: row.expiresAt
        });
    }
);

authRoutes.post(
    '/activation/:token',
    tokenLookupLimiter,
    validate({ params: tokenParamSchema, body: setPasswordSchema }),
    async (req, res) => {
        const user = await consumeAuthToken(
            req.valid.params.token,
            'ACCOUNT_ACTIVATION',
            req.valid.body.password,
            req
        );

        // Signed in immediately: the alternative is to send someone who has
        // just proved control of the mailbox back to a login form to type the
        // password they typed a second ago.
        setSessionCookie(res, await createSession(user, req));

        res.json(await identity(user));
    }
);

// --- Password reset ---------------------------------------------------------

authRoutes.post(
    '/password/forgot',
    // Two limits, because they bound different things: `tokenLookupLimiter`
    // caps how fast one client may ask, `forgotPasswordLimiter` caps how often
    // one mailbox may be sent a link no matter who asks for it.
    tokenLookupLimiter,
    forgotPasswordLimiter,
    validate({ body: forgotPasswordSchema }),
    async (req, res) => {
        const user = await prisma.user.findUnique({ where: { email: req.valid.body.email } });

        if (user?.isActive) {
            const { token, authToken } = await issueAuthToken(prisma, {
                userId: user.id,
                purpose: 'PASSWORD_RESET',
                ttlMs: config.auth.passwordResetTtlMs
            });

            await sendMailQuietly({
                to: user.email,
                template: 'passwordReset',
                data: { url: passwordResetUrl(token), expiresAt: authToken.expiresAt }
            });
        }

        // Always 204, and always after the same work. Answering differently for
        // an address that has no account would turn this endpoint into a way to
        // enumerate who is registered.
        res.status(204).end();
    }
);

/**
 * Changing a password while signed in.
 *
 * Answers with a fresh session cookie: the change ends every session the
 * account had, including this one, so the device doing the changing is handed
 * a new one rather than being signed out for its trouble.
 */
authRoutes.post(
    '/password/change',
    authenticate,
    // After `authenticate`, because it counts against the signed-in user rather
    // than the address they are calling from.
    passwordChangeLimiter,
    validate({ body: changePasswordSchema }),
    async (req, res) => {
        const token = await changePassword(req.user, req.valid.body, req);

        setSessionCookie(res, token);
        res.status(204).end();
    }
);

authRoutes.post(
    '/password/reset/:token',
    tokenLookupLimiter,
    validate({ params: tokenParamSchema, body: setPasswordSchema }),
    async (req, res) => {
        await consumeAuthToken(req.valid.params.token, 'PASSWORD_RESET', req.valid.body.password, req);

        // No session here, unlike activation: a reset is the flow someone uses
        // when they suspect the account was reachable by someone else, so it
        // ends every session and makes them sign in deliberately.
        clearSessionCookie(res);
        res.status(204).end();
    }
);

export default authRoutes;
