import { createHash } from 'node:crypto';

import { OAuth2Client } from 'google-auth-library';

import { GMAIL_SCOPES, config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { MailDeliveryError } from '../mailer/errors.js';
import { open, seal } from '../secretBox.js';

/**
 * The company Google account behind the Gmail transport: the OAuth client,
 * and where its refresh token lives.
 *
 * The refresh token is stored sealed in `mail_provider_credentials` (written
 * by the administrator callback) or, on a machine without that flow, read from
 * GOOGLE_REFRESH_TOKEN. A connected account always wins over the environment.
 * Access tokens are never stored: the OAuth client keeps the current one in
 * memory and refreshes it itself shortly before it expires, with concurrent
 * refreshes for the same token collapsed into one request.
 */

export const GMAIL_PROVIDER = 'gmail';
export { GMAIL_SCOPES };

const SEAL_AAD = 'mail_provider_credentials:gmail';

// Public, like every development default in config.js. A deploy cannot boot
// without its own MAIL_CREDENTIALS_KEY once the Gmail API is configured.
const DEVELOPMENT_KEY = createHash('sha256').update('development-mail-credentials-key').digest();

const sealingKey = () =>
    config.mail.gmail.credentialsKey ? Buffer.from(config.mail.gmail.credentialsKey, 'base64') : DEVELOPMENT_KEY;

export const sealRefreshToken = (token) => seal(token, { key: sealingKey(), aad: SEAL_AAD });
export const openRefreshToken = (sealed) => open(sealed, { key: sealingKey(), aad: SEAL_AAD });

/** Google's hosts, or the test suite's stand-in for all of them. */
const stubEndpoints = (base) => {
    const root = base.replace(/\/$/, '');

    return {
        oauth2AuthBaseUrl: `${root}/o/oauth2/v2/auth`,
        oauth2TokenUrl: `${root}/token`,
        oauth2RevokeUrl: `${root}/revoke`,
        oauth2FederatedSignonPemCertsUrl: `${root}/oauth2/v1/certs`,
        oauth2FederatedSignonJwkCertsUrl: `${root}/oauth2/v3/certs`,
        tokenInfoUrl: `${root}/tokeninfo`
    };
};

/** Where the Gmail client sends requests: Google, unless a stub is configured. */
export const gmailRootUrl = () => (config.mail.gmail.stubUrl ? `${config.mail.gmail.stubUrl.replace(/\/$/, '')}/` : undefined);

export const createOAuthClient = () => {
    const gmail = config.mail.gmail;

    if (!gmail.configured) {
        throw new MailDeliveryError('The Gmail API is not configured: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and GMAIL_SENDER_EMAIL', {
            kind: 'config',
            reason: 'notConfigured'
        });
    }

    return new OAuth2Client({
        clientId: gmail.clientId,
        clientSecret: gmail.clientSecret,
        redirectUri: gmail.redirectUri,
        // Retries are decided by the transport, which knows which failures
        // are worth another attempt; the client's own would double them.
        transporterOptions: { timeout: gmail.requestTimeoutMs, retry: false },
        ...(gmail.stubUrl ? { endpoints: stubEndpoints(gmail.stubUrl) } : {})
    });
};

/**
 * One authorised client per stored token, reused across sends so its access
 * token is too. Keyed on the sealed value, which changes on every reconnect
 * (a fresh IV each time), so an instance notices another instance's reconnect
 * on its next send without being told.
 */
let cached = null;

export const resetSendingCredential = () => {
    cached = null;
};

/**
 * The credential to send with, or an `auth` error saying why there is none.
 *
 * Read on every send: a primary-key lookup is cheap next to an HTTPS call to
 * Google, and it is what lets a reconnect or a revocation on one instance take
 * effect on all of them at once.
 */
export const loadSendingCredential = async () => {
    const row = await prisma.mailProviderCredential.findUnique({ where: { provider: GMAIL_PROVIDER } });

    if (row) {
        if (row.revokedAt) {
            throw new MailDeliveryError('The Gmail account was disconnected by Google; an administrator must reconnect it', {
                kind: 'auth',
                reason: 'revoked'
            });
        }

        const version = `db:${row.refreshTokenCipher}`;

        if (cached?.version !== version) {
            const client = createOAuthClient();

            client.setCredentials({ refresh_token: openRefreshToken(row.refreshTokenCipher) });
            cached = { version, client, source: 'db', sealed: row.refreshTokenCipher, accountEmail: row.accountEmail };
        }

        return cached;
    }

    const envToken = config.mail.gmail.envRefreshToken;

    if (envToken) {
        const version = `env:${createHash('sha256').update(envToken).digest('hex')}`;

        if (cached?.version !== version) {
            const client = createOAuthClient();

            client.setCredentials({ refresh_token: envToken });
            cached = { version, client, source: 'env', sealed: null, accountEmail: config.mail.gmail.senderEmail };
        }

        return cached;
    }

    throw new MailDeliveryError('No Gmail account is connected; an administrator must connect one', {
        kind: 'auth',
        reason: 'notConnected'
    });
};

/**
 * Marks the stored token as refused by Google, and says whether this call was
 * the one that did it. Matched on the sealed value it was given, so an
 * instance still holding an older token cannot mark a fresh reconnect revoked.
 */
export const markCredentialRevoked = async (credential, reason) => {
    cached = null;

    if (credential?.source !== 'db') return false;

    const { count } = await prisma.mailProviderCredential.updateMany({
        where: { provider: GMAIL_PROVIDER, refreshTokenCipher: credential.sealed, revokedAt: null },
        data: { revokedAt: new Date(), lastAuthError: String(reason ?? '').slice(0, 500) }
    });

    return count === 1;
};
