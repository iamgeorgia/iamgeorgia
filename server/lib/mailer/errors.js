/**
 * Why a message did not go, in the terms a caller can act on.
 *
 * - `transient`: try again later. The network, a 5xx, a rate limit. Retried
 *   inside the provider a few times, then thrown so the outbox's own
 *   schedule takes over.
 * - `permanent`: this message will never go as written. A malformed address,
 *   a message too large. Not retried anywhere; inside an outbox handler it is
 *   logged and the handler carries on with its other recipients, because
 *   retrying the whole event would fail at the same address every time and
 *   never reach the ones after it.
 * - `auth`: the stored Google grant no longer works (revoked, expired, scope
 *   removed). Nothing sends until an administrator reconnects; thrown so the
 *   outbox keeps the event until then.
 * - `config`: our side is wrong (client secret, a Workspace policy). Thrown,
 *   not retried in the provider.
 *
 * `ambiguous` marks a failure after the request may already have reached
 * Google — a timeout mid-response. Gmail has no idempotency key, so such a
 * send is retried at most once: a rare duplicate is preferred to a lost
 * booking confirmation, but not an unbounded number of them.
 */
export class MailDeliveryError extends Error {
    constructor(message, { kind, status = null, reason = null, retryAfterMs = null, ambiguous = false, retryable = null, cause } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = 'MailDeliveryError';
        this.kind = kind;
        this.status = status;
        this.reason = reason;
        this.retryAfterMs = retryAfterMs;
        this.ambiguous = ambiguous;
        // Whether another attempt *within this send* is worth it. A daily
        // quota is transient but will not clear in the next few seconds.
        this.retryable = retryable ?? kind === 'transient';
    }
}

export const isPermanentMailError = (err) => err instanceof MailDeliveryError && err.kind === 'permanent';
export const isAuthMailError = (err) => err instanceof MailDeliveryError && err.kind === 'auth';

/**
 * Whether Google has said, definitively, that the stored grant is no good: the
 * token endpoint answered `invalid_grant`, or the grant lacks the send scope.
 * A bare 401 on a send is not enough — the client already refreshed and
 * retried once — and marking the account revoked on it would stop all mail
 * on a hiccup, so that one is thrown and retried instead.
 */
export const isGrantRefused = (err) => isAuthMailError(err) && (err.reason === 'invalid_grant' || SCOPE_REASONS.has(err.reason));

// Errors where no connection was ever made: the request certainly did not arrive.
const UNSENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError']);
const QUOTA_REASONS = new Set(['dailyLimitExceeded', 'quotaExceeded', 'limitExceeded']);
const SCOPE_REASONS = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);

const headerOf = (headers, name) => {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
};

const retryAfterOf = (headers) => {
    const raw = headerOf(headers, 'retry-after');

    if (!raw) return null;

    const seconds = Number(raw);

    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

    const at = Date.parse(raw);

    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
};

/**
 * Turns whatever the Google client threw into a MailDeliveryError.
 *
 * Two error bodies reach here: the Gmail API's
 * `{ error: { code, message, errors: [{ reason }] } }` and the OAuth token
 * endpoint's `{ error: 'invalid_grant', error_description }`.
 */
export const classifyGoogleError = (err) => {
    if (err instanceof MailDeliveryError) return err;

    const response = err?.response;
    const status = Number(response?.status ?? err?.status ?? 0) || null;
    const data = response?.data;
    const oauthError = typeof data?.error === 'string' ? data.error : null;
    const reason = oauthError ?? data?.error?.errors?.[0]?.reason ?? data?.error?.status ?? null;
    const detail = data?.error?.message ?? data?.error_description ?? err?.message ?? 'Unknown Gmail API error';
    const message = `Gmail API: ${detail}${reason ? ` (${reason})` : ''}`;

    if (!status) {
        const code = err?.code ?? err?.cause?.code ?? null;
        const unsent = UNSENT_CODES.has(code);

        return new MailDeliveryError(`Gmail API unreachable: ${err?.message ?? code ?? 'network error'}`, {
            kind: 'transient',
            reason: code,
            ambiguous: !unsent,
            cause: err
        });
    }

    if (oauthError === 'invalid_grant') {
        return new MailDeliveryError(message, { kind: 'auth', status, reason, cause: err });
    }

    if (oauthError === 'invalid_client' || oauthError === 'unauthorized_client') {
        return new MailDeliveryError(message, { kind: 'config', status, reason, cause: err });
    }

    if (status === 401) {
        return new MailDeliveryError(message, { kind: 'auth', status, reason: 'unauthenticated', cause: err });
    }

    if (status === 429 || (status === 403 && RATE_REASONS.has(reason))) {
        return new MailDeliveryError(message, { kind: 'transient', status, reason, retryAfterMs: retryAfterOf(response?.headers), cause: err });
    }

    if (status === 403 && QUOTA_REASONS.has(reason)) {
        return new MailDeliveryError(message, { kind: 'transient', status, reason, retryable: false, cause: err });
    }

    if (status === 403 && SCOPE_REASONS.has(reason)) {
        return new MailDeliveryError(message, { kind: 'auth', status, reason, cause: err });
    }

    if (status === 403) {
        return new MailDeliveryError(message, { kind: 'config', status, reason, cause: err });
    }

    if (status === 400 && reason === 'failedPrecondition') {
        return new MailDeliveryError(message, { kind: 'config', status, reason, cause: err });
    }

    if (status === 400 || status === 413) {
        return new MailDeliveryError(message, { kind: 'permanent', status, reason, cause: err });
    }

    // 5xx, and any other 4xx this was not written for: retried, and visible as
    // a dead letter if it never clears, rather than dropped as permanent.
    return new MailDeliveryError(message, { kind: 'transient', status, reason, retryable: status >= 500, cause: err });
};
