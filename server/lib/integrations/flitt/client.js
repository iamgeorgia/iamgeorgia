import { setTimeout as sleep } from 'node:timers/promises';

import { config } from '../../../config.js';
import { BadGatewayError, UnprocessableEntityError } from '../../errors.js';
import { logger } from '../../logger.js';
import { parseJsonPreservingNumbers } from './parse.js';
import { sign, verify } from './signature.js';

/**
 * Flitt's merchant API (docs.flitt.com/api), as the four calls this platform
 * makes: create a hosted-checkout order, read an order's status, reverse
 * (refund) an order, capture a pre-authorised one.
 *
 * Every request is `POST {base}/api/...` with a JSON body `{ request: {...} }`
 * signed with the merchant's payment key; every answer is `{ response: {...} }`
 * whose `response_status` describes the HTTP exchange only — the payment's
 * own state is `order_status`. Answers that carry a `signature` are verified
 * before they are believed; the status endpoint is required to carry one,
 * because that answer is what moves money in the ledger.
 *
 * Retries: only the status read, which is idempotent, and only on a dropped
 * connection, a timeout, a 429 or a 5xx — three attempts with jittered
 * backoff. Creating an order is never retried here: after a timeout the
 * service asks Flitt whether the order exists before trying again.
 *
 * Numbers in answers are kept as the text Flitt wrote (see parse.js) so the
 * signature check sees what was signed; the service converts amounts with
 * status.js `toCents`.
 *
 * Nothing here touches the schema or a route, and the secret is read from
 * `getSettings()` at call time — never held, never logged.
 */

const MAX_IDEMPOTENT_ATTEMPTS = 3;

/**
 * Error codes that describe our request rather than Flitt's health
 * (docs.flitt.com/api/response-codes): retrying the same request cannot help.
 */
export const PERMANENT_ERROR_CODES = new Set([
    1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 1016, 1017, 1018, 1019, 1021, 1023, 1026, 1027, 1028, 1034, 1046, 1084, 1086, 1100, 1109
]);

const RETRYABLE_STATUS = (status) => status === 429 || status === 408 || (status >= 500 && status <= 599);

const retryDelayMs = (attempt) => {
    const base = 500 * 2 ** (attempt - 1);

    return Math.floor(base + Math.random() * base);
};

const baseUrlFor = (apiBaseUrl) => String(apiBaseUrl || 'https://pay.flitt.com').replace(/\/+$/, '');

/** Integer minor units, positive. Anything else is a bug in the caller, not a provider problem. */
const assertAmountCents = (amountCents) => {
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 999_999_999_999) {
        throw new TypeError(`Flitt amounts are positive integer minor units, got ${amountCents}`);
    }

    return amountCents;
};

const assertCurrency = (currency) => {
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
        throw new TypeError(`Flitt currencies are ISO-4217 codes, got "${currency}"`);
    }

    return currency;
};

/** Drops undefined/null so an optional parameter never reaches the wire (or the signature) as "null". */
const compact = (params) => Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null));

/**
 * Builds a client over `getSettings()`, read on every call so a test can
 * point it at a stub and the running server never holds a stale key.
 */
export const createFlittClient = (getSettings = () => config.payments.flitt) => {
    const settingsOrThrow = () => {
        const settings = getSettings();

        if (!settings?.merchantId || !settings?.secretKey) {
            throw new BadGatewayError('Flitt is not configured', { vendor: 'flitt', reason: 'PROVIDER_NOT_CONFIGURED' });
        }

        return settings;
    };

    const post = async (path, params, { idempotent = false, requireSignature = false, op = path }) => {
        const settings = settingsOrThrow();
        const url = `${baseUrlFor(settings.apiBaseUrl)}${path}`;
        const request = compact({ ...params, merchant_id: settings.merchantId });
        const body = JSON.stringify({ request: { ...request, signature: sign(settings.secretKey, request) } });
        const maxAttempts = idempotent ? MAX_IDEMPOTENT_ATTEMPTS : 1;
        const timeoutMs = settings.requestTimeoutMs ?? 15_000;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            let response;

            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json; charset=utf-8', accept: 'application/json', 'user-agent': 'iamgeorgia-api/1.0' },
                    body,
                    signal: AbortSignal.timeout(timeoutMs)
                });
            } catch (err) {
                const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';

                if (attempt < maxAttempts) {
                    logger.warn({ vendor: 'flitt', op, orderId: params.order_id, attempt, err: err?.message }, 'Flitt request failed; retrying');
                    await sleep(retryDelayMs(attempt));
                    continue;
                }

                throw new BadGatewayError(timedOut ? 'Flitt did not answer in time' : 'Flitt could not be reached', {
                    vendor: 'flitt',
                    reason: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
                    cause: String(err?.message ?? err)
                });
            }

            if (RETRYABLE_STATUS(response.status) && attempt < maxAttempts) {
                logger.warn({ vendor: 'flitt', op, orderId: params.order_id, attempt, status: response.status }, 'Flitt answered a retryable status; retrying');
                await response.body?.cancel?.().catch(() => {});
                await sleep(retryDelayMs(attempt));
                continue;
            }

            return interpret(response, { op, orderId: params.order_id, requireSignature, secretKey: settings.secretKey });
        }

        // Unreachable: the loop returns or throws.
        throw new BadGatewayError('Flitt request did not complete', { vendor: 'flitt', reason: 'PROVIDER_UNAVAILABLE' });
    };

    const interpret = async (response, { op, orderId, requireSignature, secretKey }) => {
        const text = await response.text();

        if (!response.ok) {
            logger.error({ vendor: 'flitt', op, orderId, status: response.status }, 'Flitt failed');
            throw new BadGatewayError(`Flitt failed with status ${response.status}`, { vendor: 'flitt', reason: 'PROVIDER_UNAVAILABLE', status: response.status });
        }

        let envelope;

        try {
            envelope = parseJsonPreservingNumbers(text);
        } catch {
            throw new BadGatewayError('Flitt answered with something other than JSON', { vendor: 'flitt', reason: 'PROVIDER_MALFORMED' });
        }

        const payload = envelope?.response;

        if (!payload || typeof payload !== 'object') {
            throw new BadGatewayError('Flitt answered without a response object', { vendor: 'flitt', reason: 'PROVIDER_MALFORMED' });
        }

        if (payload.response_status === 'failure') {
            throw errorFrom(payload, { op, orderId });
        }

        if (requireSignature || payload.signature !== undefined) {
            if (!verify(secretKey, payload)) {
                logger.error({ vendor: 'flitt', op, orderId, requestId: payload.request_id }, 'Flitt answered with a signature that does not verify');
                throw new BadGatewayError('Flitt answered with an invalid signature', { vendor: 'flitt', reason: 'PROVIDER_SIGNATURE' });
            }
        }

        return payload;
    };

    const errorFrom = (payload, { op, orderId }) => {
        const errorCode = Number(payload.error_code);
        const details = {
            vendor: 'flitt',
            errorCode: Number.isInteger(errorCode) ? errorCode : null,
            errorMessage: payload.error_message ?? null,
            requestId: payload.request_id ?? null
        };

        if (errorCode === 1014) {
            // Our key or our canonical string is wrong: a configuration problem, loud.
            logger.error({ vendor: 'flitt', op, orderId, ...details }, 'Flitt rejected our signature');
            return new BadGatewayError('Flitt rejected the request signature', { ...details, reason: 'PROVIDER_AUTH' });
        }

        if (PERMANENT_ERROR_CODES.has(errorCode)) {
            logger.warn({ vendor: 'flitt', op, orderId, ...details }, 'Flitt refused the request');
            return new UnprocessableEntityError(`Flitt refused the request: ${payload.error_message ?? errorCode}`, { ...details, reason: 'PROVIDER_REJECTED' });
        }

        logger.error({ vendor: 'flitt', op, orderId, ...details }, 'Flitt could not process the request');
        return new BadGatewayError(`Flitt could not process the request: ${payload.error_message ?? errorCode}`, { ...details, reason: 'PROVIDER_ERROR' });
    };

    /**
     * Hosted checkout: `{ checkout_url, payment_id }`. The guest is sent to
     * `checkout_url`. `amountCents` is what Flitt will charge; `currency`
     * must be enabled on the merchant.
     */
    // All four are `async` so that an argument error surfaces as a rejection
    // like every other failure, never as a throw from inside a `.then` chain.
    const createCheckoutUrl = async ({ orderId, orderDesc, amountCents, currency, responseUrl, serverCallbackUrl, cancelUrl, lifetimeSeconds, senderEmail, merchantData, productId, lang, delayed = 'N', designId, preauth }) =>
        post(
            '/api/checkout/url',
            {
                version: '1.0.1',
                order_id: orderId,
                order_desc: orderDesc,
                amount: assertAmountCents(amountCents),
                currency: assertCurrency(currency),
                response_url: responseUrl,
                server_callback_url: serverCallbackUrl,
                cancel_url: cancelUrl,
                lifetime: lifetimeSeconds,
                sender_email: senderEmail,
                merchant_data: merchantData,
                product_id: productId,
                lang,
                delayed,
                design_id: designId,
                preauth
            },
            { op: 'checkout.url' }
        );

    /** Same order, answered with a `token` for the embedded widget and mobile SDKs. */
    const createCheckoutToken = async (params) =>
        post(
            '/api/checkout/token',
            {
                version: '1.0.1',
                order_id: params.orderId,
                order_desc: params.orderDesc,
                amount: assertAmountCents(params.amountCents),
                currency: assertCurrency(params.currency),
                response_url: params.responseUrl,
                server_callback_url: params.serverCallbackUrl,
                lifetime: params.lifetimeSeconds,
                sender_email: params.senderEmail,
                merchant_data: params.merchantData,
                product_id: params.productId,
                lang: params.lang,
                delayed: params.delayed ?? 'N'
            },
            { op: 'checkout.token' }
        );

    /** The order as Flitt sees it now. Signed by Flitt; the signature is required. */
    const getOrderStatus = ({ orderId }) => post('/api/status/order_id', { version: '1.0.1', order_id: orderId }, { idempotent: true, requireSignature: true, op: 'status' });

    /**
     * Full or partial reversal. `reverseId` is Flitt's idempotent key: the same
     * value on every retry of one refund means one refund.
     */
    const reverse = async ({ orderId, amountCents, currency, reverseId, comment, email }) =>
        post(
            '/api/reverse/order_id',
            { version: '1.0.1', order_id: orderId, amount: assertAmountCents(amountCents), currency: assertCurrency(currency), reverse_id: reverseId, comment, email },
            { requireSignature: true, op: 'reverse' }
        );

    /** Capture of a `preauth=Y` hold. Safely retriable per Flitt; not used by the MVP. */
    const capture = async ({ orderId, amountCents, currency }) =>
        post('/api/capture/order_id', { version: '1.0.1', order_id: orderId, amount: assertAmountCents(amountCents), currency: assertCurrency(currency) }, { op: 'capture' });

    return { createCheckoutUrl, createCheckoutToken, getOrderStatus, reverse, capture };
};
