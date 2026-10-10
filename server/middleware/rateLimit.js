import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';

import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { TooManyRequestsError } from '../lib/errors.js';

// Sending the rejection through next() rather than letting the library write
// its own body keeps every error in the system in the same `{ error: { … } }`
// shape, and gets it logged like any other failed request.
const handler = (message) => (req, res, next) => {
    next(new TooManyRequestsError(message));
};

/**
 * The shared counter, when there is one.
 *
 * Without it every limiter counts in this process's memory, which is correct
 * for a single instance and quietly wrong for two: a pair behind a load
 * balancer each allow the full limit, so ten login attempts become twenty, and
 * a restart forgets every counter a moment after an attacker triggers one.
 *
 * Opt-in rather than required, because a single-instance deploy does not need
 * Redis and should not have to run one. Connecting lazily and not awaiting is
 * deliberate: the API must still boot and serve if Redis is slow to come up;
 * requests in the meantime are handled by `passOnStoreError` below. The
 * connection is created once at import and shared by every limiter, so they do
 * not open five.
 */
const redisClient = config.redisUrl
    ? createClient({
          url: config.redisUrl,
          // Without this a command issued while the connection is down is parked
          // in an offline queue with an abort timer, and when that timer fires
          // the rejection lands outside the call that made it — an unhandled
          // rejection, which Node treats as fatal. A limiter must not be able
          // to kill the process; failing the command immediately keeps the
          // failure inside the call that can handle it.
          disableOfflineQueue: true
      })
    : null;

/**
 * Issues one command, refusing before it reaches the client if there is no
 * connection to issue it on.
 *
 * The `isReady` guard is belt to `disableOfflineQueue`'s braces: it keeps the
 * failure synchronous and identical whether Redis has never connected or has
 * just dropped, which is what makes the fallback path deterministic rather than
 * dependent on which of the client's internal states we happened to catch.
 */
const sendCommand = (args) => {
    if (!redisClient?.isReady) {
        return Promise.reject(new Error('Rate limit store is not connected'));
    }

    return redisClient.sendCommand(args);
};

if (redisClient) {
    // Each limiter adds a 'ready' listener of its own, which together with this
    // one is past the default ceiling of ten that Node warns about.
    redisClient.setMaxListeners(20);

    // Without a listener an unreachable Redis emits an unhandled 'error' event,
    // which takes the process down — a limiter's backing store being briefly
    // unavailable must never do that.
    redisClient.on('error', (err) => logger.error({ err }, 'Rate limit store error'));

    // Nothing about counting requests should keep a process alive. An
    // established socket holds the event loop open, and so does the reconnect
    // loop of a client that never got one — hence unref both before connecting
    // and after, so a short-lived process that imports a limiter still exits.
    // The server is held open by its own listener, not by this.
    redisClient.unref();
    redisClient
        .connect()
        .then(() => redisClient.unref())
        .catch((err) => logger.error({ err }, 'Rate limit store failed to connect'));
} else if (config.isDeployed) {
    logger.warn(
        'REDIS_URL is not set: rate limits are counted per process. Correct for a single instance, ' +
            'but two instances behind a load balancer each allow the full limit.'
    );
}

/**
 * A Redis-backed store that survives Redis being briefly unreachable.
 *
 * Two separate problems, and only one of them is this wrapper's.
 *
 * The first is recovery. `RedisStore.init` loads its Lua scripts and caches the
 * hashes as promises on the store. If that runs while Redis is down the
 * promises are left rejected *permanently*, so every later increment fails
 * against a Redis that came back minutes ago. Re-running init on the client's
 * `ready` event is what makes recovery real. Everything else delegates to the
 * store untouched — calls are forwarded rather than inherited so `this` stays
 * the RedisStore, which is the object whose script hashes they read.
 *
 * The second is what happens to a request whose store call fails. That is
 * handled by `passOnStoreError` in `base` below, not here: an earlier version
 * of this file tried to count in memory instead, and counting a request in one
 * store while the library believed it was talking to another produced wrong
 * totals the moment Redis returned. The library's own option is the one that
 * knows how the middleware accounts for a failed increment.
 */
const redisBackedStore = (prefix) => {
    // `sendCommand` is called with the command spread across arguments —
    // sendCommand('SCRIPT', 'LOAD', script) — so it has to be collected back
    // into one array. Passing the module-level helper by shorthand instead
    // silently handed it only the first word, and the client then spread
    // "SCRIPT" into six single-character arguments.
    const store = new RedisStore({ prefix: `rl:${prefix}:`, sendCommand: (...args) => sendCommand(args) });
    let options;

    const loadScripts = async () => {
        try {
            await store.init?.(options);
        } catch (err) {
            // At startup the client is still connecting and this always fails;
            // the `ready` handler below then does it for real a moment later.
            // Only a failure against a client that *is* connected is news.
            const level = redisClient?.isReady ? 'error' : 'debug';

            logger[level]({ err, prefix }, 'Rate limit store could not load its scripts');
        }
    };

    return {
        // Forwarded verbatim: the library reads these to decide whether keys are
        // process-local, and a wrapper that dropped them would change how it
        // accounts for every request.
        localKeys: store.localKeys,
        prefix: store.prefix,
        init: (received) => {
            options = received;

            // Called unconditionally, even though at startup there is not yet a
            // connection for it to succeed over. `RedisStore.init` is what
            // assigns the script-hash promises, and `increment` dereferences
            // them without checking — so skipping this leaves them undefined
            // and the first request dies on a TypeError rather than failing
            // cleanly into `passOnStoreError`.
            void loadScripts();

            // Every reconnection reloads them. Without this a store built while
            // Redis was down keeps its rejected promises for the life of the
            // process and never recovers.
            redisClient?.on('ready', () => void loadScripts());
        },
        increment: (key) => store.increment(key),
        decrement: (key) => store.decrement(key),
        resetKey: (key) => store.resetKey(key),
        resetAll: store.resetAll ? () => store.resetAll() : undefined,
        get: store.get ? (key) => store.get(key) : undefined
    };
};

/**
 * A distinct keyspace per limiter, so the login counter and the global one do
 * not share a bucket when they happen to derive the same key.
 */
const store = (prefix) => (redisClient ? redisBackedStore(prefix) : undefined);

const base = {
    windowMs: 15 * 60 * 1000,
    standardHeaders: true,
    legacyHeaders: false,

    /**
     * A store that cannot be reached must not fail the request.
     *
     * `globalLimiter` is mounted on everything, so without this a Redis outage
     * answers 500 to every request the API serves — the limiter stops being a
     * guard rail and becomes the outage. Letting the request through instead
     * means no rate limiting for the duration, which is a real cost: an
     * unmetered login endpoint is a CPU exhaustion vector, because every
     * attempt there pays for a scrypt derivation. Between losing the limits for
     * the length of an outage and losing the site for it, this is the better
     * trade — but it is a trade, and it is the reason a deploy that sets
     * REDIS_URL should alert on Redis being down.
     *
     * Only reachable when a store is configured at all: the in-memory default
     * has nothing to fail against.
     */
    passOnStoreError: true,

    // Otherwise the library logs store errors straight to the console, outside
    // the structured log everything else in the process writes to.
    logger: {
        error: (...args) => logger.error({ args }, 'Rate limiter store error'),
        warn: (...args) => logger.warn({ args }, 'Rate limiter warning')
    }
};

/**
 * Login attempts, counted per IP *and* per account.
 *
 * Per-IP alone lets a botnet spread an attack on one account across many
 * addresses; per-account alone lets one address lock every account it can name.
 * `ipKeyGenerator` normalizes IPv6 to a /64 — an address holder gets a whole
 * range for free otherwise.
 */
export const authLimiter = rateLimit({
    ...base,
    store: store('login'),
    limit: config.auth.loginLimit,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email ?? '').trim().toLowerCase()}`,
    // A correct password should not be punished for earlier typos.
    skipSuccessfulRequests: true,
    handler: handler('Too many sign-in attempts. Try again later.')
});

/**
 * The two halves the pair-keyed limiter above leaves open.
 *
 * Keyed on the pair, one address gets a fresh budget for every account it
 * names, and one account gets a fresh budget from every address that tries
 * it. A per-address bucket bounds the spray; a per-account bucket bounds the
 * distributed guess. Both are wider than the pair's so an office behind one
 * address, or a user with a forgotten password, is not shut out by them
 * first — the account bucket in particular is the one an attacker could use
 * to lock someone out, which is why it is the widest.
 */
export const authIpLimiter = rateLimit({
    ...base,
    store: store('login-ip'),
    limit: config.auth.loginIpLimit,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    skipSuccessfulRequests: true,
    handler: handler('Too many sign-in attempts. Try again later.')
});

export const authAccountLimiter = rateLimit({
    ...base,
    store: store('login-account'),
    limit: config.auth.loginAccountLimit,
    keyGenerator: (req) => String(req.body?.email ?? '').trim().toLowerCase() || ipKeyGenerator(req.ip),
    skipSuccessfulRequests: true,
    handler: handler('Too many sign-in attempts. Try again later.')
});

/**
 * Wrong current-password attempts on `/auth/password/change`.
 *
 * Its own limiter because its own key: there is no email in the body of a
 * password change, so running it through `authLimiter` reduced the key to the
 * bare IP and put every user behind one office address in a single bucket.
 * Keyed on the session's user, which is the thing actually being guessed at,
 * and which the caller cannot vary.
 */
export const passwordChangeLimiter = rateLimit({
    ...base,
    store: store('password-change'),
    limit: config.auth.passwordChangeLimit,
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
    skipSuccessfulRequests: true,
    handler: handler('Too many attempts. Try again later.')
});

/**
 * Invitations sent, per inviter.
 *
 * Keyed on the session's user like the password-change limiter, and counting
 * successes — the point is the number of accounts one session can create,
 * not the number of mistakes it makes.
 */
export const inviteLimiter = rateLimit({
    ...base,
    store: store('invite'),
    limit: config.auth.inviteLimit,
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
    handler: handler('Too many invitations. Try again later.')
});

/**
 * Reset links per address, wherever they are asked for from.
 *
 * The per-IP limiter below caps how fast one client can ask; this caps how
 * often one *mailbox* can be sent a link, which is the limit that matters when
 * the client rotates addresses. Nothing here reveals whether the account
 * exists: the counter is keyed on what was typed, not on what was found.
 */
export const forgotPasswordLimiter = rateLimit({
    ...base,
    store: store('forgot-password'),
    limit: config.auth.forgotPasswordLimit,
    keyGenerator: (req) => String(req.body?.email ?? '').trim().toLowerCase() || ipKeyGenerator(req.ip),
    handler: handler('Too many attempts. Try again later.')
});

/** Claiming an invitation. Low, because a legitimate invitee does it once. */
export const registrationLimiter = rateLimit({
    ...base,
    store: store('registration'),
    windowMs: 60 * 60 * 1000,
    limit: config.auth.registrationLimit,
    handler: handler('Too many registration attempts. Try again later.')
});

/** Reading an invitation token, and requesting password links. */
export const tokenLookupLimiter = rateLimit({
    ...base,
    store: store('token-lookup'),
    limit: config.auth.tokenLookupLimit,
    handler: handler('Too many attempts. Try again later.')
});

/**
 * The blanket per-IP limit applied to every request.
 *
 * Shares the `handler` above deliberately: the library's own rejection is
 * plain text, and a client that expects the `{ error: { … } }` envelope
 * chokes on it while parsing.
 */
export const globalLimiter = rateLimit({
    ...base,
    store: store('global'),
    windowMs: 60 * 1000,
    limit: config.globalRateLimit,
    // Uptime monitors poll far more often than a browser would.
    skip: (req) => req.path.startsWith('/health'),
    handler: handler('Too many requests. Try again shortly.')
});

/**
 * Dated hotel search, the most expensive read in the system: a windowed
 * aggregate over the two largest tables. The global limiter allows 100 a
 * minute across everything; this one keeps a scraper from spending all of it
 * here.
 *
 * Built here on `base` and the shared store like every other limiter, rather
 * than inline in the route file where it used to live: declared there it
 * counted in process memory whatever REDIS_URL said, so two instances behind
 * a load balancer each allowed the full thirty, and it rejected with the
 * library's plain-text body instead of the error envelope.
 */
export const searchLimiter = rateLimit({
    ...base,
    store: store('search'),
    windowMs: 60 * 1000,
    limit: config.isTest ? 10_000 : 30,
    handler: handler('Too many searches. Try again shortly.')
});

/**
 * Closes the shared store, so a shutdown is not held open by it.
 *
 * The test is `isReady`, not `isOpen`. `isOpen` is still true for a client
 * midway through a reconnect, and `quit` on one of those waits to send a
 * command down a socket that is not there — it never settles, and the shutdown
 * it was supposed to tidy up hangs instead. `destroy` is what stops a reconnect
 * loop; `quit` is only for a connection that can actually carry the goodbye.
 */
export const disconnectRateLimitStore = async () => {
    if (!redisClient) {
        return;
    }

    try {
        if (redisClient.isReady) {
            await redisClient.quit();
        } else {
            redisClient.destroy();
        }
    } catch (err) {
        logger.warn({ err }, 'Rate limit store did not close cleanly');
    }
};
