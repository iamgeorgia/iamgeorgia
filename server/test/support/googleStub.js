import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

/**
 * A stand-in for every Google host the Gmail transport talks to: the OAuth
 * token endpoint, revocation, the ID-token signing certificates, and Gmail's
 * `users.messages.send` (inline and upload). Real HTTP, so the official client
 * libraries run their real code paths — refresh, 401 retry, error bodies —
 * and nothing leaves the machine.
 *
 * Scripted with `issueCode`, `revoke`, `failSends` and `tokenLifetimeSeconds`;
 * observed through `sends`, `tokenRequests` and `revocations`.
 */

const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

export const startGoogleStub = async ({ clientId }) => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = 'stub-key-1';
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

    const codes = new Map();
    const refreshTokens = new Map();
    const accessTokens = new Map();
    const revoked = new Set();

    const stub = {
        url: null,
        sends: [],
        tokenRequests: [],
        revocations: [],
        sendFailures: [],
        tokenLifetimeSeconds: 3600,

        /** A one-time authorisation code that will come back as `email`'s grant. */
        issueCode({ email, emailVerified = true, scope = 'https://www.googleapis.com/auth/gmail.send email', withRefreshToken = true } = {}) {
            const code = `code-${randomBytes(8).toString('hex')}`;

            codes.set(code, { email, emailVerified, scope, withRefreshToken });

            return code;
        },

        /** Revokes a grant the way a user would from their Google account. */
        revoke(token) {
            revoked.add(token);
        },

        /** The next sends answer with these, in order: `{ status, body?, headers? }` or `{ destroy: true }`. */
        failSends(...failures) {
            stub.sendFailures.push(...failures);
        },

        /** A refresh token as if a developer had put it in GOOGLE_REFRESH_TOKEN. */
        mintRefreshToken(email) {
            const token = `refresh-${randomBytes(12).toString('hex')}`;

            refreshTokens.set(token, { email, scope: 'https://www.googleapis.com/auth/gmail.send email' });

            return token;
        },

        refreshCount() {
            return stub.tokenRequests.filter((request) => request.grant_type === 'refresh_token').length;
        },

        reset() {
            stub.sends.length = 0;
            stub.tokenRequests.length = 0;
            stub.revocations.length = 0;
            stub.sendFailures.length = 0;
            stub.tokenLifetimeSeconds = 3600;
        },

        close: () => new Promise((resolve) => server.close(resolve))
    };

    const idTokenFor = ({ email, emailVerified }) => {
        const now = Math.floor(Date.now() / 1000);
        const header = b64url({ alg: 'RS256', kid, typ: 'JWT' });
        const payload = b64url({
            iss: 'https://accounts.google.com',
            aud: clientId,
            sub: `sub-${email}`,
            email,
            email_verified: emailVerified,
            iat: now,
            exp: now + 3600
        });
        const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');

        return `${header}.${payload}.${signature}`;
    };

    const issueAccessToken = (refreshToken) => {
        const token = `access-${randomBytes(12).toString('hex')}`;

        accessTokens.set(token, { refreshToken });

        return token;
    };

    const json = (res, status, body, headers = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
    };

    const readBody = (req) =>
        new Promise((resolve) => {
            const chunks = [];

            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', () => resolve(Buffer.concat(chunks)));
        });

    const handleToken = (res, form) => {
        stub.tokenRequests.push(form);

        if (form.client_id !== clientId || !form.client_secret) {
            return json(res, 401, { error: 'invalid_client', error_description: 'Unauthorized' });
        }

        if (form.grant_type === 'authorization_code') {
            const grant = codes.get(form.code);

            codes.delete(form.code);

            if (!grant) return json(res, 400, { error: 'invalid_grant', error_description: 'Malformed auth code.' });

            const refreshToken = `refresh-${randomBytes(12).toString('hex')}`;

            refreshTokens.set(refreshToken, grant);

            return json(res, 200, {
                access_token: issueAccessToken(refreshToken),
                expires_in: stub.tokenLifetimeSeconds,
                ...(grant.withRefreshToken ? { refresh_token: refreshToken } : {}),
                scope: grant.scope,
                token_type: 'Bearer',
                id_token: idTokenFor(grant)
            });
        }

        if (form.grant_type === 'refresh_token') {
            if (!refreshTokens.has(form.refresh_token) || revoked.has(form.refresh_token)) {
                return json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
            }

            return json(res, 200, {
                access_token: issueAccessToken(form.refresh_token),
                expires_in: stub.tokenLifetimeSeconds,
                scope: refreshTokens.get(form.refresh_token).scope,
                token_type: 'Bearer'
            });
        }

        return json(res, 400, { error: 'unsupported_grant_type' });
    };

    const handleSend = async (req, res, body, { upload }) => {
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
        const grant = bearer ? accessTokens.get(bearer) : null;

        if (!grant || revoked.has(grant.refreshToken)) {
            return json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
        }

        const failure = stub.sendFailures.shift();

        if (failure?.destroy) {
            stub.sends.push({ failed: 'destroyed' });
            req.socket.destroy();

            return undefined;
        }

        if (failure) {
            stub.sends.push({ failed: failure.status });

            return json(res, failure.status, failure.body ?? { error: { code: failure.status, message: 'Stub failure', errors: [{ reason: failure.reason ?? 'backendError' }] } }, failure.headers);
        }

        let raw;

        if (upload && /^message\/rfc822/i.test(req.headers['content-type'] ?? '')) {
            // uploadType=media: the body is the message itself.
            raw = body.toString('utf8');
        } else if (upload) {
            // uploadType=multipart: the JSON metadata part, then the message.
            const text = body.toString('utf8');
            const marker = text.search(/content-type:\s*message\/rfc822/i);

            raw = marker < 0 ? '' : text.slice(text.indexOf('\r\n\r\n', marker) + 4).replace(/\r\n--[^\r\n]+--\s*$/, '');
        } else {
            raw = Buffer.from(JSON.parse(body.toString('utf8')).raw, 'base64url').toString('utf8');
        }

        const id = `msg-${randomBytes(6).toString('hex')}`;

        stub.sends.push({ id, raw, upload, accessToken: bearer });

        return json(res, 200, { id, threadId: `thr-${id}`, labelIds: ['SENT'] });
    };

    const server = createServer(async (req, res) => {
        const url = new URL(req.url, 'http://stub');
        const body = await readBody(req);

        if (req.method === 'POST' && url.pathname === '/token') {
            return handleToken(res, Object.fromEntries(new URLSearchParams(body.toString('utf8'))));
        }

        if (req.method === 'POST' && url.pathname === '/revoke') {
            const token = url.searchParams.get('token') ?? new URLSearchParams(body.toString('utf8')).get('token');

            stub.revocations.push(token);
            revoked.add(token);

            return json(res, 200, {});
        }

        if (req.method === 'GET' && url.pathname === '/oauth2/v1/certs') {
            return json(res, 200, { [kid]: publicPem }, { 'cache-control': 'public, max-age=3600' });
        }

        if (req.method === 'POST' && url.pathname === '/gmail/v1/users/me/messages/send') {
            return handleSend(req, res, body, { upload: false });
        }

        if (req.method === 'POST' && url.pathname === '/upload/gmail/v1/users/me/messages/send') {
            return handleSend(req, res, body, { upload: true });
        }

        return json(res, 404, { error: 'not found', path: url.pathname });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    stub.url = `http://127.0.0.1:${server.address().port}`;

    return stub;
};

/** Decodes RFC 2047 encoded-words, enough to read back what nodemailer wrote. */
export const decodeHeader = (value) =>
    String(value ?? '')
        .replace(/\?=\s+=\?/g, '?==?')
        .replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_, kind, text) =>
            kind.toLowerCase() === 'b'
                ? Buffer.from(text, 'base64').toString('utf8')
                : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (__, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1').toString('utf8')
        );

/** One header of a raw message, unfolded and decoded. */
export const headerOf = (raw, name) => {
    const head = raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ');
    const line = head.split(/\r?\n/).find((entry) => entry.toLowerCase().startsWith(`${name.toLowerCase()}:`));

    return line ? decodeHeader(line.slice(name.length + 1).trim()) : null;
};
