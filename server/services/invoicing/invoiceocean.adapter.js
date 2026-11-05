import { setTimeout as sleep } from 'node:timers/promises';

import { config } from '../../config.js';
import { BadGatewayError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

/**
 * InvoiceOcean (invoiceocean.com, Fakturownia's international edition), as an
 * `InvoicingProvider` (see provider.js).
 *
 * The API is JSON over HTTPS on the account's own host, authenticated with an
 * `api_token` — in the query string of a GET, in the body of anything else —
 * and it says 422 with field errors when it refuses a document. The documented
 * limits are 1,000 requests per minute per IP and two at a time, so this keeps
 * a two-slot semaphore and a token bucket rather than finding out at the
 * busiest moment. One retry, with jitter, on a 429, a 5xx or a dropped
 * connection; `Retry-After` wins when it is sent.
 *
 * Money crosses the boundary once, here: the API speaks decimal strings
 * ("480.00"), the platform speaks integer cents.
 *
 * Nothing in this file reaches a route or the schema; the service calls it
 * and stores what it returns.
 */

const CONCURRENCY = 2;
const PER_MINUTE = 1000;

/** `acme` → https://acme.invoiceocean.com; a host or a full URL is used as given. */
export const baseUrlFor = (domain) => {
    if (!domain) {
        throw new BadGatewayError('InvoiceOcean is not configured: INVOICEOCEAN_DOMAIN is unset');
    }

    if (/^https?:\/\//i.test(domain)) return domain.replace(/\/+$/, '');
    if (domain.includes('.')) return `https://${domain}`;

    return `https://${domain}.invoiceocean.com`;
};

// --- Money and dates ------------------------------------------------------------

/** 48000 → "480.00"; -1250 → "-12.50". Integer arithmetic: never a float on the way out. */
export const toMajor = (cents) => {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);

    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

/**
 * "480.00" → 48000; 480 → 48000; "-12.5" → -1250. Refuses anything that is
 * not a plain decimal, because a silently mis-parsed total is a wrong
 * invoice in our books.
 */
export const toCents = (value) => {
    if (value === null || value === undefined || value === '') return 0;

    const text = String(value).trim();
    const match = /^(-)?(\d+)(?:\.(\d{1,2})\d*)?$/.exec(text);

    if (!match) {
        throw new BadGatewayError(`InvoiceOcean sent an amount that is not a decimal: "${text}"`);
    }

    const [, sign, whole, fraction = ''] = match;
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

    return sign ? -cents : cents;
};

/** 1800 → "18"; 1850 → "18.5"; null → "disabled" (no tax line on the document). */
const taxFor = (taxRateBps) => {
    if (taxRateBps === null || taxRateBps === undefined) return 'disabled';
    const percent = taxRateBps / 100;

    return Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0+$/, '');
};

/** "18" | "18.00" | 18 → 1800; "disabled" | "np" | "zw" | "" → null. */
const taxBpsFrom = (tax) => {
    if (tax === null || tax === undefined || tax === '') return null;
    const n = Number(tax);

    return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const dateOnly = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

const instant = (value) => {
    if (!value) return null;
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
};

// --- Mapping ----------------------------------------------------------------------------------

const KIND_OUT = { PROFORMA: 'proforma', VAT: 'vat', ADVANCE: 'advance', FINAL: 'final', CORRECTION: 'correction' };
const KIND_IN = Object.fromEntries(Object.entries(KIND_OUT).map(([ours, theirs]) => [theirs, ours]));

const STATUS_IN = {
    issued: 'ISSUED',
    sent: 'SENT',
    paid: 'PAID',
    partial: 'PARTIAL',
    cancelled: 'CANCELLED',
    canceled: 'CANCELLED',
    rejected: 'CANCELLED'
};

/** One InvoiceOcean invoice → `ProviderInvoice`. Tolerant of missing fields; strict about money. */
export const mapInvoice = (raw) => ({
    externalId: String(raw.id),
    number: raw.number ?? null,
    kind: KIND_IN[raw.kind] ?? null,
    // Cancellation is a flag beside the status, not a status: a cancelled
    // document keeps 'issued' (or 'sent', 'paid') in `status` and carries
    // `cancelled: true`. Read the flag first.
    status: raw.cancelled === true ? 'CANCELLED' : (STATUS_IN[String(raw.status ?? '').toLowerCase()] ?? null),
    oid: raw.oid ? String(raw.oid) : null,
    currency: raw.currency ?? null,
    totalCents: toCents(raw.price_gross),
    paidCents: toCents(raw.paid),
    issueDate: dateOnly(raw.issue_date),
    sellDate: dateOnly(raw.sell_date),
    dueDate: dateOnly(raw.payment_to),
    lang: raw.lang ?? null,
    publicToken: raw.token ?? null,
    fromExternalId: raw.from_invoice_id ? String(raw.from_invoice_id) : null,
    updatedAt: instant(raw.updated_at),
    lines: Array.isArray(raw.positions)
        ? raw.positions.map((position) => ({
              description: position.name ?? '',
              quantity: Number(position.quantity ?? 1),
              taxRateBps: taxBpsFrom(position.tax),
              totalGrossCents: toCents(position.total_price_gross)
          }))
        : []
});

const mapClient = (raw) => {
    if (!raw || typeof raw !== 'object' || raw.id === undefined || raw.id === null) {
        throw new BadGatewayError('InvoiceOcean answered without a client record', { vendor: 'invoiceocean' });
    }

    return mapClientFields(raw);
};

const mapClientFields = (raw) => ({
    externalId: String(raw.id),
    name: raw.name ?? '',
    taxId: raw.tax_no ?? null,
    email: raw.email ?? null,
    street: raw.street ?? null,
    city: raw.city ?? null,
    country: raw.country ?? null,
    ourId: raw.external_id ? String(raw.external_id) : null
});

const clientBody = (client) => ({
    name: client.name,
    tax_no: client.taxId ?? '',
    email: client.email ?? '',
    street: client.street ?? '',
    city: client.city ?? '',
    country: client.country ?? '',
    external_id: client.ourId
});

/** The request body for one document, in InvoiceOcean's words. Exported so the unit test can pin it. */
export const invoiceBody = (input) => {
    const body = {
        kind: KIND_OUT[input.kind],
        number: null,
        lang: input.lang,
        currency: input.currency,
        oid: input.oid,
        issue_date: input.issueDate,
        sell_date: input.sellDate,
        payment_type: 'transfer',
        // `description` is printed under the line (owner decision OD4):
        // the room, the dates, the names; the route, the flight, the car.
        positions: input.lines.map((line) => ({
            name: line.description,
            description: line.detail?.text ?? '',
            quantity: line.quantity,
            tax: taxFor(line.taxRateBps),
            total_price_gross: toMajor(line.totalGrossCents)
        }))
    };

    if (input.dueDate) body.payment_to = input.dueDate;
    if (input.departmentId) body.department_id = input.departmentId;
    if (input.clientExternalId) body.client_id = input.clientExternalId;

    if (input.buyer) {
        body.buyer_name = input.buyer.name;
        body.buyer_tax_no = input.buyer.taxId ?? '';
        body.buyer_email = input.buyer.email ?? '';
        body.buyer_street = input.buyer.street ?? '';
        body.buyer_city = input.buyer.city ?? '';
        body.buyer_country = input.buyer.country ?? '';
    }

    if (input.fromExternalId) body.from_invoice_id = input.fromExternalId;
    if (input.correctionReason) body.correction_reason = input.correctionReason;

    if (input.paidCents !== null && input.paidCents !== undefined) {
        body.paid = toMajor(input.paidCents);
        body.status = input.paidCents >= input.lines.reduce((sum, line) => sum + line.totalGrossCents, 0) ? 'paid' : 'partial';
    }

    return body;
};

// --- Limits ------------------------------------------------------------------------------------

/** Two in flight, the rest queued in order. */
const semaphore = (slots) => {
    let active = 0;
    const waiting = [];

    return async (work) => {
        if (active >= slots) {
            await new Promise((resolve) => waiting.push(resolve));
        }

        active += 1;

        try {
            return await work();
        } finally {
            active -= 1;
            waiting.shift()?.();
        }
    };
};

/** A sliding one-minute window; a call past the budget waits for the oldest to age out. */
const minuteBucket = (budget) => {
    const stamps = [];

    return async () => {
        for (;;) {
            const now = Date.now();
            while (stamps.length > 0 && stamps[0] <= now - 60_000) stamps.shift();

            if (stamps.length < budget) {
                stamps.push(now);
                return;
            }

            await sleep(stamps[0] + 60_000 - now + 1);
        }
    };
};

// --- HTTP ---------------------------------------------------------------------------------------

const RETRYABLE = (status) => status === 429 || status === 408 || (status >= 500 && status <= 599);

const retryDelayMs = (response) => {
    const header = response?.headers?.get?.('retry-after');
    const seconds = header ? Number(header) : NaN;

    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);

    return 250 + Math.floor(Math.random() * 750);
};

/** The provider's field errors, flattened to one line for a `syncError` column. */
export const describeFieldErrors = (body) => {
    const message = body?.message ?? body?.error ?? body;

    if (typeof message === 'string') return message;

    if (message && typeof message === 'object') {
        return Object.entries(message)
            .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : String(errors)}`)
            .join('; ');
    }

    return 'InvoiceOcean refused the request';
};

/**
 * Builds an adapter over `getSettings()`, read on every call so a test can
 * point it at a stub and the running server picks up nothing stale.
 */
export const createInvoiceOceanAdapter = (getSettings = () => config.finance.invoiceocean) => {
    const slot = semaphore(CONCURRENCY);
    const budget = minuteBucket(PER_MINUTE);

    const call = async (method, path, { query = {}, body = null, accept = 'application/json', attempt = 1 } = {}) => {
        const settings = getSettings();
        const url = new URL(`${baseUrlFor(settings.domain)}${path}`);

        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
        }

        const isRead = method === 'GET';

        if (isRead) url.searchParams.set('api_token', settings.apiToken ?? '');

        const init = {
            method,
            headers: { accept, ...(isRead ? {} : { 'content-type': 'application/json' }) },
            signal: AbortSignal.timeout(settings.requestTimeoutMs ?? 15_000)
        };

        if (!isRead) {
            init.body = JSON.stringify({ api_token: settings.apiToken ?? '', ...(body ?? {}) });
        }

        let response;

        try {
            await budget();
            response = await slot(() => fetch(url, init));
        } catch (err) {
            if (attempt === 1) {
                logger.warn({ vendor: 'invoiceocean', method, path, err: err?.message }, 'InvoiceOcean request failed; retrying once');
                await sleep(retryDelayMs(null));
                return call(method, path, { query, body, accept, attempt: 2 });
            }

            throw new BadGatewayError('InvoiceOcean could not be reached', { vendor: 'invoiceocean', cause: String(err?.message ?? err) });
        }

        if (RETRYABLE(response.status) && attempt === 1) {
            logger.warn({ vendor: 'invoiceocean', method, path, status: response.status, requestId: response.headers.get('x-request-id') }, 'InvoiceOcean answered a retryable status; retrying once');
            await response.body?.cancel?.().catch(() => {});
            await sleep(retryDelayMs(response));
            return call(method, path, { query, body, accept, attempt: 2 });
        }

        return response;
    };

    const json = async (response, { allow404 = false } = {}) => {
        if (response.status === 404 && allow404) {
            await response.body?.cancel?.().catch(() => {});
            return null;
        }

        const text = await response.text();
        let parsed = null;

        try {
            parsed = text ? JSON.parse(text) : null;
        } catch {
            parsed = null;
        }

        if (response.ok) {
            return parsed;
        }

        const requestId = response.headers.get('x-request-id');

        if (response.status === 422 || response.status === 400) {
            throw new UnprocessableEntityError(`InvoiceOcean refused the request: ${describeFieldErrors(parsed)}`, {
                vendor: 'invoiceocean',
                reason: 'PROVIDER_REJECTED',
                fields: parsed?.message && typeof parsed.message === 'object' ? parsed.message : undefined,
                requestId
            });
        }

        if (response.status === 404) {
            throw new NotFoundError('InvoiceOcean has no such record', { vendor: 'invoiceocean', requestId });
        }

        if (response.status === 401 || response.status === 403) {
            logger.error({ vendor: 'invoiceocean', status: response.status, requestId }, 'InvoiceOcean refused the API token');
            throw new BadGatewayError('InvoiceOcean refused the API token', { vendor: 'invoiceocean', reason: 'PROVIDER_AUTH', requestId });
        }

        logger.error({ vendor: 'invoiceocean', status: response.status, requestId }, 'InvoiceOcean failed');
        throw new BadGatewayError(`InvoiceOcean failed with status ${response.status}`, { vendor: 'invoiceocean', status: response.status, requestId });
    };

        const invoiceOf = (payload) => {
        const raw = payload?.invoice ?? payload;

        if (!raw) return null;

        if (typeof raw !== 'object' || raw.id === undefined || raw.id === null) {
            throw new BadGatewayError('InvoiceOcean answered without an invoice record', { vendor: 'invoiceocean' });
        }

        return mapInvoice(raw);
    };

    return {
        name: 'INVOICEOCEAN',

        async createInvoice(input) {
            const payload = await json(await call('POST', '/invoices.json', { body: { invoice: invoiceBody(input) } }));

            return invoiceOf(payload);
        },

        async getInvoice(externalId) {
            const payload = await json(await call('GET', `/invoices/${encodeURIComponent(externalId)}.json`), { allow404: true });

            return invoiceOf(payload);
        },

        async findByOid(oid) {
            const payload = await json(await call('GET', '/invoices.json', { query: { oid, include_positions: true } }));
            const list = Array.isArray(payload) ? payload : Array.isArray(payload?.invoices) ? payload.invoices : [];

            return list.map(mapInvoice).filter((invoice) => invoice.oid === String(oid));
        },

        async changeStatus(externalId, status) {
            // `change_status` knows issued, sent, paid and partial only; 'cancelled'
            // is refused ("status: is invalid", found in the sandbox on 2026-10-14).
            // A document is cancelled by setting its `cancelled` flag through an update.
            if (status === 'cancelled') {
                const updated = await json(await call('PUT', `/invoices/${encodeURIComponent(externalId)}.json`, { body: { invoice: { cancelled: true } } }));
                return invoiceOf(updated);
            }

            const payload = await json(await call('POST', `/invoices/${encodeURIComponent(externalId)}/change_status.json`, { query: { status }, body: {} }));

            return invoiceOf(payload);
        },

        // `email_pdf` attaches the document; without it the message carries
        // only a link. The reply is `{ status: 'ok' }`; anything else on a 2xx
        // is a refusal worded in the body, which the caller must not take as
        // "sent".
        async sendByEmail(externalId, { to } = {}) {
            const reply = await json(await call('POST', `/invoices/${encodeURIComponent(externalId)}/send_by_email.json`, { body: { email_pdf: true, ...(to ? { email_to: to } : {}) } }));

            logger.info({ vendor: 'invoiceocean', externalId, to: to ?? null, reply }, 'invoicing.send reply');

            // Permanent: the account itself is refusing (an unverified
            // sender, a plan limit), and no retry changes that.
            if (reply && (reply.code === 'error' || (reply.status && reply.status !== 'ok'))) {
                throw new UnprocessableEntityError(`InvoiceOcean did not send the document: ${reply.message ?? reply.status ?? 'unknown reason'}`, { vendor: 'invoiceocean', reason: 'PROVIDER_REJECTED', reply });
            }
        },

        async getPdf(externalId) {
            const response = await call('GET', `/invoices/${encodeURIComponent(externalId)}.pdf`, { accept: 'application/pdf' });

            if (!response.ok) {
                await json(response); // throws with the right class
            }

            const length = Number(response.headers.get('content-length'));

            return {
                stream: response.body,
                contentType: response.headers.get('content-type') || 'application/pdf',
                contentLength: Number.isFinite(length) && length > 0 ? length : null
            };
        },

        async findClientByExternalId(ourId) {
            const payload = await json(await call('GET', '/clients.json', { query: { external_id: ourId } }));
            const list = Array.isArray(payload) ? payload : Array.isArray(payload?.clients) ? payload.clients : [];
            const match = list.map(mapClient).find((client) => client.ourId === String(ourId));

            return match ?? null;
        },

        async upsertClient(client) {
            const existing = client.externalId ? { externalId: client.externalId } : await this.findClientByExternalId(client.ourId);
            const body = { client: clientBody(client) };
            const payload = existing
                ? await json(await call('PUT', `/clients/${encodeURIComponent(existing.externalId)}.json`, { body }))
                : await json(await call('POST', '/clients.json', { body }));

            return mapClient(payload?.client ?? payload);
        },

        async createPayment({ name, amountCents, currency, invoiceExternalId, paidDate }) {
            const payload = await json(
                await call('POST', '/banking/payments.json', {
                    body: {
                        banking_payment: {
                            name,
                            price: toMajor(amountCents),
                            invoice_id: invoiceExternalId,
                            paid: true,
                            kind: 'api',
                            currency,
                            paid_date: paidDate
                        }
                    }
                })
            );
            const raw = payload?.banking_payment ?? payload ?? {};

            return { externalId: String(raw.id ?? ''), amountCents: toCents(raw.price ?? toMajor(amountCents)), currency: raw.currency ?? currency };
        },

        async listInvoices({ dateFrom, dateTo, page = 1, perPage = 100, includeLines = false }) {
            const payload = await json(
                await call('GET', '/invoices.json', {
                    query: {
                        period: 'more',
                        date_from: dateFrom,
                        date_to: dateTo,
                        page,
                        per_page: Math.min(perPage, 100),
                        order: 'updated_at.desc',
                        include_positions: includeLines ? true : undefined
                    }
                })
            );
            const list = Array.isArray(payload) ? payload : Array.isArray(payload?.invoices) ? payload.invoices : [];

            return list.map(mapInvoice);
        },

        async registerWebhook({ url, secret, events = ['invoice:create', 'invoice:update'] }) {
            const payload = await json(await call('POST', '/webhooks.json', { body: { webhook: { url, api_token: secret, events } } }));
            const raw = payload?.webhook ?? payload ?? {};

            return { externalId: String(raw.id ?? '') };
        }
    };
};

/** The adapter the service uses, over the live configuration. */
export const invoiceOcean = createInvoiceOceanAdapter();
