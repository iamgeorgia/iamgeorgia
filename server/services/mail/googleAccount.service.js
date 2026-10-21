import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { addressOf, config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { AUDIT_ENTITY, recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import {
    GMAIL_PROVIDER,
    GMAIL_SCOPES,
    createOAuthClient,
    openRefreshToken,
    resetSendingCredential,
    sealRefreshToken
} from '../../lib/google/oauth.js';
import { logger } from '../../lib/logger.js';
import { sendMail } from '../../lib/mailer/index.js';
import { CAPABILITIES } from '../../lib/permissions.js';
import { usersWithCapability } from '../rbac/access.js';

/**
 * Connecting the company Google account the platform sends mail as.
 *
 * Administrator-only, and shaped by one constraint: the browser comes back
 * from Google *without* the admin's session, because that cookie is
 * SameSite=Strict and the return is a cross-site navigation. So the callback
 * is authorised by what the admin's own authenticated request left behind —
 * a single-use state, stored hashed, ten minutes to live, bound to that admin
 * and to their browser by an HttpOnly cookie — and by nothing it is sent.
 *
 * What the callback may then do is narrow on purpose: store a grant for the
 * one account named in GMAIL_SENDER_EMAIL. Any other account is refused and
 * its grant revoked at Google before anything is kept.
 */

const STATE_PURPOSE = 'gmail';
const STATE_TTL_MS = 10 * 60 * 1000;
const SEND_SCOPE = GMAIL_SCOPES[0];

export const OAUTH_COOKIE = 'iag_gmail_oauth';
export const OAUTH_COOKIE_PATH = '/api/admin/mail/google';

/**
 * The binding cookie. Host-only on the API, scoped to these routes, Lax so the
 * top-level return from Google carries it — which is the one navigation the
 * Strict session cookie cannot make.
 */
export const oauthCookieOptions = () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isDeployed,
    path: OAUTH_COOKIE_PATH,
    maxAge: STATE_TTL_MS
});

const hashState = (state) => createHash('sha256').update(String(state)).digest('hex');

const sameString = (a, b) => {
    const left = Buffer.from(String(a ?? ''));
    const right = Buffer.from(String(b ?? ''));

    return left.length === right.length && timingSafeEqual(left, right);
};

/** Where the browser lands after the callback. Only fixed codes, never anything Google sent. */
export const settingsUrl = (outcome) => {
    const url = new URL('/admin/settings/email', `${config.appUrl.replace(/\/$/, '')}/`);

    url.searchParams.set(outcome.ok ? 'connected' : 'error', outcome.ok ? '1' : outcome.code);

    return url.toString();
};

const assertConfigured = () => {
    if (!config.mail.gmail.configured) {
        throw new ConflictError('The Gmail API is not configured on this server', { reason: 'GMAIL_NOT_CONFIGURED' });
    }
};

/**
 * The URL to send the admin's browser to, and the state to bind to it.
 *
 * `prompt=consent` makes Google issue a refresh token every time, which a
 * reconnect needs; `login_hint` preselects the expected account.
 */
export const startAuthorization = async (user, req) => {
    assertConfigured();

    const state = randomBytes(32).toString('base64url');
    const now = new Date();

    await prisma.$transaction([
        prisma.oAuthState.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } }),
        prisma.oAuthState.create({
            data: { stateHash: hashState(state), purpose: STATE_PURPOSE, userId: user.id, expiresAt: new Date(now.getTime() + STATE_TTL_MS) }
        })
    ]);

    const url = createOAuthClient().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: false,
        scope: [...GMAIL_SCOPES],
        login_hint: config.mail.gmail.senderEmail,
        state
    });

    req?.log?.info({ userId: user.id }, 'Gmail authorisation started');

    return { url, state, expiresAt: new Date(now.getTime() + STATE_TTL_MS) };
};

const revokeQuietly = async (client, token) => {
    if (!token) return false;

    try {
        await client.revokeToken(token);

        return true;
    } catch (err) {
        logger.warn({ status: err?.response?.status }, 'Could not revoke a Google token');

        return false;
    }
};

/**
 * The return from Google. Resolves to `{ ok: true }` or `{ ok: false, code }`
 * and never throws for anything a visitor can cause: the route turns either
 * into a redirect to the settings screen.
 */
export const completeAuthorization = async ({ code, state, error, cookieState }, req) => {
    if (!config.mail.gmail.configured) return { ok: false, code: 'not_configured' };
    if (!state || typeof state !== 'string' || state.length > 200) return { ok: false, code: 'state' };

    // Used first, checked second: two returns racing with the same state get
    // one success between them.
    const now = new Date();
    const stateHash = hashState(state);
    const { count } = await prisma.oAuthState.updateMany({
        where: { stateHash, purpose: STATE_PURPOSE, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
    });

    if (count !== 1) return { ok: false, code: 'state' };

    // The state proves an admin started this; the cookie proves it is the
    // same browser coming back.
    if (!sameString(cookieState, state)) return { ok: false, code: 'session' };

    const pending = await prisma.oAuthState.findUnique({ where: { stateHash } });
    const actor = await prisma.user.findUnique({ where: { id: pending.userId }, select: { id: true, email: true, isActive: true } });
    const stillAllowed = actor?.isActive && (await usersWithCapability(CAPABILITIES.SETTINGS_WRITE, { partnerId: null })).includes(actor.id);

    if (!stillAllowed) return { ok: false, code: 'forbidden' };

    if (error) return { ok: false, code: error === 'access_denied' ? 'denied' : 'google' };
    if (!code || typeof code !== 'string' || code.length > 2048) return { ok: false, code: 'google' };

    const client = createOAuthClient();
    let tokens;

    try {
        ({ tokens } = await client.getToken({ code, redirect_uri: config.mail.gmail.redirectUri }));
    } catch (err) {
        logger.warn({ status: err?.response?.status, reason: err?.response?.data?.error }, 'Gmail authorisation code exchange failed');

        return { ok: false, code: 'exchange' };
    }

    let account = null;

    try {
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.mail.gmail.clientId });
        const payload = ticket.getPayload();

        account = payload?.email_verified ? String(payload.email).toLowerCase() : null;
    } catch (err) {
        logger.warn({ message: err?.message }, 'Gmail authorisation returned an ID token that did not verify');
    }

    const granted = String(tokens.scope ?? '').split(/\s+/);
    const reject = async (codeName, summary) => {
        await revokeQuietly(client, tokens.refresh_token ?? tokens.access_token);
        await recordAudit(prisma, {
            action: 'MAIL_PROVIDER_CONNECT_REJECTED',
            actor,
            entityType: AUDIT_ENTITY.mailProvider,
            entityId: GMAIL_PROVIDER,
            summary,
            metadata: { code: codeName, accountEmail: account, expected: config.mail.gmail.senderEmail },
            req
        });

        return { ok: false, code: codeName };
    };

    if (!account || account !== config.mail.gmail.senderEmail) {
        return reject('account', `Refused to connect ${account ?? 'an unverified Google account'}: only ${config.mail.gmail.senderEmail} may send for the platform`);
    }

    // Google's consent screen lets a person untick a permission.
    if (!granted.includes(SEND_SCOPE)) {
        return reject('scope', `Refused to connect ${account}: permission to send email was not granted`);
    }

    if (!tokens.refresh_token) {
        return reject('no_refresh_token', `Refused to connect ${account}: Google returned no refresh token`);
    }

    const sealed = sealRefreshToken(tokens.refresh_token);
    const data = {
        accountEmail: account,
        refreshTokenCipher: sealed,
        scopes: granted.filter(Boolean),
        connectedByUserId: actor.id,
        connectedByEmail: actor.email,
        connectedAt: now,
        revokedAt: null,
        lastAuthError: null
    };

    await prisma.$transaction(async (tx) => {
        await tx.mailProviderCredential.upsert({ where: { provider: GMAIL_PROVIDER }, create: { provider: GMAIL_PROVIDER, ...data }, update: data });
        await recordAudit(tx, {
            action: 'MAIL_PROVIDER_CONNECTED',
            actor,
            entityType: AUDIT_ENTITY.mailProvider,
            entityId: GMAIL_PROVIDER,
            summary: `Connected ${account} as the platform's Gmail sender`,
            metadata: { scopes: data.scopes },
            req
        });
    });

    resetSendingCredential();

    return { ok: true };
};

/**
 * Revokes the grant at Google and forgets it here. Forgotten even when Google
 * cannot be reached: an administrator who pressed "disconnect" means it, and
 * the token is useless to us once the row is gone.
 */
export const disconnectAccount = async (user, req) => {
    const row = await prisma.mailProviderCredential.findUnique({ where: { provider: GMAIL_PROVIDER } });

    if (!row) {
        throw new NotFoundError('No Gmail account is connected');
    }

    let revoked = false;

    if (config.mail.gmail.configured) {
        let token = null;

        try {
            token = openRefreshToken(row.refreshTokenCipher);
        } catch {
            // Sealed under a key this server no longer has: nothing to revoke with.
        }

        revoked = await revokeQuietly(createOAuthClient(), token);
    }

    await prisma.$transaction(async (tx) => {
        await tx.mailProviderCredential.delete({ where: { provider: GMAIL_PROVIDER } });
        await recordAudit(tx, {
            action: 'MAIL_PROVIDER_DISCONNECTED',
            actor: user,
            entityType: AUDIT_ENTITY.mailProvider,
            entityId: GMAIL_PROVIDER,
            summary: `Disconnected ${row.accountEmail} as the platform's Gmail sender${revoked ? '' : ' (Google did not confirm the revocation)'}`,
            metadata: { revokedAtGoogle: revoked },
            req
        });
    });

    resetSendingCredential();

    return { revokedAtGoogle: revoked };
};

/** Everything the settings screen shows. Never a token, sealed or not. */
export const accountStatus = async () => {
    const gmail = config.mail.gmail;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row, sentLast24h, lastSent, lastFailed] = await Promise.all([
        prisma.mailProviderCredential.findUnique({
            where: { provider: GMAIL_PROVIDER },
            select: { accountEmail: true, scopes: true, connectedAt: true, connectedByEmail: true, revokedAt: true, lastAuthError: true }
        }),
        prisma.mailLog.count({ where: { provider: GMAIL_PROVIDER, status: 'SENT', createdAt: { gte: since } } }),
        prisma.mailLog.findFirst({ where: { provider: GMAIL_PROVIDER, status: 'SENT' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, template: true } }),
        prisma.mailLog.findFirst({ where: { provider: GMAIL_PROVIDER, status: 'FAILED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, template: true, error: true } })
    ]);
    const source = row ? 'database' : gmail.envRefreshToken ? 'environment' : null;
    const fromAddress = addressOf(config.mail.from);

    return {
        provider: GMAIL_PROVIDER,
        transport: config.mail.transport,
        active: config.mail.transport === 'gmail',
        configured: gmail.configured,
        senderEmail: gmail.senderEmail,
        fromAddress,
        fromAliasVerified: gmail.fromAliasVerified,
        fromMatchesSender: Boolean(gmail.senderEmail) && fromAddress === gmail.senderEmail,
        redirectUri: gmail.redirectUri,
        connected: row ? !row.revokedAt : source === 'environment',
        source,
        account: row,
        volume: { sentLast24h, warnAt: gmail.dailyWarnAt },
        lastSent: lastSent ? { at: lastSent.createdAt, template: lastSent.template } : null,
        lastFailure: lastFailed ? { at: lastFailed.createdAt, template: lastFailed.template, error: lastFailed.error } : null
    };
};

/**
 * A real email through Gmail, to the admin who asked and no one else, whatever
 * MAIL_TRANSPORT currently is — the point is to prove the connection before
 * switching to it. Reports the outcome rather than throwing it.
 */
export const sendTestEmail = async (user, req) => {
    assertConfigured();

    try {
        await sendMail(
            {
                to: user.email,
                template: 'mailProviderTest',
                data: {
                    contactName: [user.firstName, user.lastName].filter(Boolean).join(' '),
                    accountEmail: config.mail.gmail.senderEmail,
                    fromAddress: addressOf(config.mail.from)
                }
            },
            { transport: 'gmail' }
        );
    } catch (err) {
        req?.log?.warn({ kind: err?.kind, reason: err?.reason, status: err?.status }, 'Gmail test send failed');

        return { sent: false, to: user.email, error: { kind: err?.kind ?? 'unknown', reason: err?.reason ?? null, message: String(err?.message ?? err).slice(0, 300) } };
    }

    await recordAudit(prisma, {
        action: 'MAIL_PROVIDER_TEST_SENT',
        actor: user,
        entityType: AUDIT_ENTITY.mailProvider,
        entityId: GMAIL_PROVIDER,
        summary: `Sent a Gmail test email to ${user.email}`,
        req
    });

    return { sent: true, to: user.email, error: null };
};
