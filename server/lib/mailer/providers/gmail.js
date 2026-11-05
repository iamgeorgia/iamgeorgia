import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { gmail as gmailClient } from '@googleapis/gmail';

import { config } from '../../../config.js';
import { prisma } from '../../../db/index.js';
import { AUDIT_ENTITY, recordAudit } from '../../audit.js';
import { gmailRootUrl, loadSendingCredential, markCredentialRevoked, GMAIL_PROVIDER } from '../../google/oauth.js';
import { logger } from '../../logger.js';
import { alertMailAdmins } from '../../../services/mail/alerts.js';
import { MailDeliveryError, classifyGoogleError, isGrantRefused } from '../errors.js';
import { buildMimeMessage } from '../mime.js';

/**
 * The Gmail API transport: `users.messages.send` as the connected account.
 *
 * The message is the same object the SMTP transport takes, compiled to MIME by
 * nodemailer's composer and sent base64url-encoded; above a few megabytes it
 * goes as a media upload instead, which Gmail accepts up to its own limit.
 */

// Inline `raw` up to this size; a media upload above it.
const INLINE_LIMIT_BYTES = 5 * 1024 * 1024;
// Gmail refuses messages over 25 MB of attachments; the encoded message is larger
// still, so this is a ceiling on what is worth even trying.
const MESSAGE_LIMIT_BYTES = 35 * 1024 * 1024;
// A Retry-After longer than this is the outbox's job to wait out, not a request's.
const MAX_INLINE_WAIT_MS = 30 * 1000;

const delayFor = (attempt, err) => {
    if (err.retryAfterMs !== null) return err.retryAfterMs;

    const exponential = config.mail.gmail.retryBaseMs * 2 ** (attempt - 1);

    // Full jitter on the upper half, so several instances that failed together
    // do not all come back together.
    return Math.round(exponential * (0.5 + Math.random() / 2));
};

/**
 * Google no longer honours the grant. Marked once — whichever instance gets
 * there first audits it and rings the administrators' bell — and every send
 * after it fails fast at `loadSendingCredential` until someone reconnects.
 */
const onGrantRefused = async (credential, err) => {
    logger.error({ reason: err.reason, status: err.status, source: credential.source }, 'Gmail refused the stored grant; mail is stopped until an administrator reconnects');

    const marked = await markCredentialRevoked(credential, err.message);

    if (marked) {
        await recordAudit(prisma, {
            action: 'MAIL_PROVIDER_REVOKED',
            actor: null,
            entityType: AUDIT_ENTITY.mailProvider,
            entityId: GMAIL_PROVIDER,
            summary: `Google refused the Gmail grant for ${credential.accountEmail}; outgoing mail stopped`,
            metadata: { reason: err.reason, status: err.status }
        }).catch((auditErr) => logger.error({ err: auditErr }, 'Could not audit the Gmail revocation'));
    }

    if (marked || credential.source === 'env') {
        const day = new Date().toISOString().slice(0, 10);
        const fingerprint = createHash('sha256').update(credential.version).digest('hex').slice(0, 16);

        await alertMailAdmins({
            title: 'Outgoing email has stopped',
            body: `Google refused the connection to ${credential.accountEmail}. Reconnect the account under Settings → Email; messages are queued and will go once it is back.`,
            dedupeKey: `mail-provider:revoked:${fingerprint}:${day}`
        });
    }
};

/**
 * Sends one message. Retries transient failures a bounded number of times,
 * an ambiguous one (the request may have arrived) at most once, and throws a
 * classified MailDeliveryError when it gives up.
 */
export const sendViaGmail = async (message) => {
    const mime = await buildMimeMessage(message);

    if (mime.length > MESSAGE_LIMIT_BYTES) {
        throw new MailDeliveryError(`Message is ${Math.ceil(mime.length / 1024 / 1024)} MB, over Gmail's limit`, {
            kind: 'permanent',
            reason: 'messageTooLarge'
        });
    }

    const params =
        mime.length <= INLINE_LIMIT_BYTES
            ? { userId: 'me', requestBody: { raw: mime.toString('base64url') } }
            : { userId: 'me', media: { mimeType: 'message/rfc822', body: mime } };
    const { maxAttempts, requestTimeoutMs } = config.mail.gmail;
    let ambiguousRetries = 0;

    for (let attempt = 1; ; attempt += 1) {
        // Outside the try: a database error here is not a Gmail error, and an
        // `auth` error from it (revoked, never connected) is already final.
        const credential = await loadSendingCredential();

        try {
            const rootUrl = gmailRootUrl();
            const api = gmailClient({ version: 'v1', auth: credential.client, rootUrl });
            // rootUrl per call as well: the client builds the media-upload URL
            // from the call's options, not the API's.
            const response = await api.users.messages.send(params, { timeout: requestTimeoutMs, retry: false, ...(rootUrl ? { rootUrl } : {}) });

            return { transport: 'gmail', messageId: response.data?.id ?? null, threadId: response.data?.threadId ?? null };
        } catch (raw) {
            const err = classifyGoogleError(raw);

            if (isGrantRefused(err)) {
                await onGrantRefused(credential, err);
            }

            const retry =
                err.retryable &&
                attempt < maxAttempts &&
                (!err.ambiguous || ambiguousRetries < 1) &&
                (err.retryAfterMs ?? 0) <= MAX_INLINE_WAIT_MS;

            if (!retry) {
                throw err;
            }

            if (err.ambiguous) ambiguousRetries += 1;

            const wait = delayFor(attempt, err);

            logger.warn({ attempt, wait, reason: err.reason, status: err.status, ambiguous: err.ambiguous }, 'Gmail send failed; retrying');
            await sleep(wait);
        }
    }
};

/**
 * Past the warning line, tells the administrators once a day. Counts the last
 * 24 hours, which is how Gmail's own limit rolls.
 */
export const noteGmailVolume = async () => {
    const warnAt = config.mail.gmail.dailyWarnAt;

    if (!warnAt || warnAt <= 0) return;

    try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const sent = await prisma.mailLog.count({ where: { provider: GMAIL_PROVIDER, status: 'SENT', createdAt: { gte: since } } });

        if (sent < warnAt) return;

        if (sent === warnAt) {
            logger.warn({ sent, warnAt }, 'Gmail sends in the last 24 hours have reached the warning line');
        }

        await alertMailAdmins({
            title: 'Email volume is close to Gmail’s daily limit',
            body: `${sent} emails went out through Gmail in the last 24 hours. Gmail stops sending at its daily cap; past it, messages wait in the queue until the window rolls.`,
            dedupeKey: `mail-provider:volume:${new Date().toISOString().slice(0, 10)}`
        });
    } catch (err) {
        logger.error({ err }, 'Could not count Gmail sends');
    }
};
