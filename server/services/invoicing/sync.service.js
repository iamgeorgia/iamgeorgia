import { timingSafeEqual } from 'node:crypto';

import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { BadRequestError, UnauthorizedError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { addDays, todayInTimezone } from '../../lib/time.js';
import { invoiceOcean } from './invoiceocean.adapter.js';

/**
 * What InvoiceOcean tells us about documents after they are issued: marked
 * paid there, sent there, cancelled there.
 *
 * Two roads in, one road through. A webhook delivery is stored and answered
 * at once (2xx fast, work later); a poll on the clock lists what changed
 * since the last thing we saw and stores that too. Both land in
 * `invoice_sync_events`, unique per (document, provider's updated_at), so a
 * delivery repeated or an invoice polled twice is one event. The applier
 * works through the stored events in order and updates the local row —
 * status, paid amount, number — and nothing else: cash is recorded on the
 * platform by a person, and a status seen in InvoiceOcean is a prompt for
 * them, not a payment.
 */

const PROVIDER = 'INVOICEOCEAN';
const provider = () => invoiceOcean;
const settings = () => config.finance.invoiceocean;

/** True only for the registered secret; constant-time, and never for an empty one. */
export const secretMatches = (presented, expected = settings().webhookSecret) => {
    if (!expected || typeof presented !== 'string' || presented.length === 0) return false;

    const a = Buffer.from(presented);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
};

/** The document a webhook body is about. InvoiceOcean posts the invoice, bare or under `invoice`. */
const invoiceFromWebhook = (body) => {
    const raw = body?.invoice && typeof body.invoice === 'object' ? body.invoice : body;
    const id = raw?.id ?? raw?.invoice_id;

    if (id === undefined || id === null || String(id).trim() === '') {
        throw new BadRequestError('The webhook names no invoice');
    }

    const updated = raw?.updated_at ? new Date(raw.updated_at) : new Date();

    return { externalId: String(id), externalUpdatedAt: Number.isNaN(updated.getTime()) ? new Date() : updated, raw };
};

/**
 * Stores one delivery. Answers whether it was new; a duplicate is still a
 * 200 to the sender, because it would otherwise retry forever.
 */
export const ingestWebhook = async (body, presentedSecret) => {
    if (!secretMatches(presentedSecret)) {
        throw new UnauthorizedError('Webhook secret missing or wrong');
    }

    const { externalId, externalUpdatedAt, raw } = invoiceFromWebhook(body);
    const { api_token: _token, ...payload } = typeof raw === 'object' && raw ? raw : {};

    const { count } = await prisma.invoiceSyncEvent.createMany({
        data: [{ provider: PROVIDER, source: 'WEBHOOK', externalId, externalUpdatedAt, payload }],
        skipDuplicates: true
    });

    return { received: true, duplicate: count === 0, externalId };
};

const STATUS_RANK = { ISSUED: 1, SENT: 2, PARTIAL: 3, PAID: 4, CANCELLED: 5 };

/**
 * Brings one local invoice into line with what the provider says about it.
 *
 * A webhook is re-read from the API before it is believed — the payload may
 * be partial or stale — while a polled row came from the API a moment ago
 * and is used as is. Only the provider's own facts move: status, paid, the
 * number, the token. Money on the receivable never does.
 */
export const applySyncEvent = async (event) => {
    const invoice = await prisma.invoice.findUnique({ where: { provider_externalId: { provider: PROVIDER, externalId: event.externalId } }, include: { receivable: { select: { reference: true } } } });

    if (!invoice) {
        await prisma.invoiceSyncEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: 'UNMATCHED' } });
        logger.warn({ externalId: event.externalId, source: event.source }, 'InvoiceOcean reported a document the platform does not have');

        return { applied: false, reason: 'UNMATCHED' };
    }

    const remote = event.source === 'WEBHOOK' ? await provider().getInvoice(event.externalId) : (await import('./invoiceocean.adapter.js')).mapInvoice(event.payload);

    if (!remote) {
        await prisma.invoiceSyncEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: 'GONE' } });

        return { applied: false, reason: 'GONE' };
    }

    const changes = {};

    if (remote.status && remote.status !== invoice.status && invoice.status !== 'DRAFT' && invoice.status !== 'ERROR') {
        // A document we cancelled stays cancelled whatever the provider's
        // row says in between; anything else follows the provider.
        if (!(invoice.status === 'CANCELLED' && remote.status !== 'CANCELLED')) {
            changes.status = remote.status;
        }
    }

    if (remote.paidCents !== invoice.paidCents) changes.paidCents = remote.paidCents;
    if (remote.number && remote.number !== invoice.externalNumber) changes.externalNumber = remote.number;
    if (remote.publicToken && remote.publicToken !== invoice.publicToken) changes.publicToken = remote.publicToken;

    const changed = Object.keys(changes).length > 0;

    await prisma.$transaction(async (tx) => {
        await tx.invoice.update({
            where: { id: invoice.id },
            data: { ...changes, externalUpdatedAt: remote.updatedAt ?? event.externalUpdatedAt, lastSyncedAt: new Date() }
        });
        await tx.invoiceSyncEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: null } });

        if (changed) {
            await recordAudit(tx, {
                action: 'INVOICE_SYNCED',
                actor: null,
                entityType: AUDIT_ENTITY.invoice,
                entityId: invoice.id,
                summary: `${invoice.kind} ${invoice.externalNumber ?? invoice.externalId} for ${invoice.receivable.reference}: ${Object.entries(changes)
                    .map(([key, value]) => `${key} → ${value}`)
                    .join(', ')} (${event.source.toLowerCase()})`,
                metadata: { receivableId: invoice.receivableId, source: event.source, changes, previous: { status: invoice.status, paidCents: invoice.paidCents } }
            });
        }
    });

    return { applied: true, changed, changes, rank: STATUS_RANK[changes.status] ?? null };
};

/**
 * Works through the stored events, oldest first, under a lock so two
 * instances never apply the same one. A failure (the provider unreachable
 * for the re-read) leaves the event for the next run with its error noted.
 */
export const applySyncEvents = async ({ limit = 100 } = {}) => {
    const events = await prisma.$transaction(async (tx) => {
        const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('invoiceocean_sync_apply')) AS locked`;

        if (!locked) return null;

        return tx.invoiceSyncEvent.findMany({ where: { processedAt: null }, orderBy: [{ externalUpdatedAt: 'asc' }, { createdAt: 'asc' }], take: limit });
    });

    if (events === null) return { skipped: true, applied: 0, failed: 0 };

    let applied = 0;
    let failed = 0;

    for (const event of events) {
        try {
            const result = await applySyncEvent(event);
            if (result.applied) applied += 1;
        } catch (err) {
            failed += 1;
            logger.error({ err, eventId: event.id, externalId: event.externalId }, 'Invoice sync event failed');
            await prisma.invoiceSyncEvent.update({ where: { id: event.id }, data: { error: String(err?.message ?? err).slice(0, 1000) } }).catch(() => {});
        }
    }

    return { skipped: false, applied, failed, remaining: events.length === limit };
};

/**
 * The fallback for webhooks that never arrived. Lists the provider's
 * documents from the oldest still open here, newest change first, and
 * stores every one changed since the last change we saw (less an hour, for
 * clock skew) as a POLL event. Pages of a hundred, at most twenty: a poll is
 * a safety net, not an import — that is `scripts/import-invoiceocean.js`.
 */
export const pollInvoices = async ({ now = new Date() } = {}) => {
    if (!settings().enabled) return { skipped: true, reason: 'DISABLED' };

    const claimed = await prisma.$transaction(async (tx) => {
        const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('invoiceocean_poll')) AS locked`;

        if (!locked) return null;

        const [latest, oldestOpen] = await Promise.all([
            tx.invoice.aggregate({ where: { provider: PROVIDER, externalUpdatedAt: { not: null } }, _max: { externalUpdatedAt: true } }),
            tx.invoice.findFirst({ where: { provider: PROVIDER, status: { in: ['ISSUED', 'SENT', 'PARTIAL'] } }, orderBy: { issueDate: 'asc' }, select: { issueDate: true } })
        ]);

        return { latest: latest._max.externalUpdatedAt, oldestOpen: oldestOpen?.issueDate ?? null };
    });

    if (claimed === null) return { skipped: true, reason: 'LOCKED' };

    const timezone = config.finance.defaultTimezone;
    const today = todayInTimezone(timezone, now);
    const watermark = claimed.latest ? new Date(claimed.latest.getTime() - 60 * 60 * 1000) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dateFrom = claimed.oldestOpen ? claimed.oldestOpen.toISOString().slice(0, 10) : addDays(today, -30);

    const known = new Set((await prisma.invoice.findMany({ where: { provider: PROVIDER, externalId: { not: null } }, select: { externalId: true } })).map((row) => row.externalId));

    let stored = 0;
    let seen = 0;

    for (let page = 1; page <= 20; page += 1) {
        const batch = await provider().listInvoices({ dateFrom, dateTo: today, page, perPage: 100 });

        if (batch.length === 0) break;

        const fresh = batch.filter((remote) => remote.updatedAt && remote.updatedAt >= watermark);
        seen += batch.length;

        const rows = fresh
            .filter((remote) => known.has(remote.externalId))
            .map((remote) => ({ provider: PROVIDER, source: 'POLL', externalId: remote.externalId, externalUpdatedAt: remote.updatedAt, payload: remote.raw ?? remoteToPayload(remote) }));

        if (rows.length > 0) {
            const { count } = await prisma.invoiceSyncEvent.createMany({ data: rows, skipDuplicates: true });
            stored += count;
        }

        // Newest first: once a page ends before the watermark, nothing older changed.
        if (fresh.length < batch.length || batch.length < 100) break;
    }

    const applied = await applySyncEvents();

    return { skipped: false, seen, stored, watermark, ...applied };
};

/** A mapped invoice back into the field names `mapInvoice` reads, so a POLL event's payload can be applied like a webhook's. */
const remoteToPayload = (remote) => ({
    id: remote.externalId,
    number: remote.number,
    kind: remote.kind ? remote.kind.toLowerCase() : null,
    status: remote.status ? remote.status.toLowerCase() : null,
    oid: remote.oid,
    currency: remote.currency,
    price_gross: (remote.totalCents / 100).toFixed(2),
    paid: (remote.paidCents / 100).toFixed(2),
    issue_date: remote.issueDate,
    sell_date: remote.sellDate,
    payment_to: remote.dueDate,
    lang: remote.lang,
    token: remote.publicToken,
    from_invoice_id: remote.fromExternalId,
    updated_at: remote.updatedAt ? remote.updatedAt.toISOString() : null,
    positions: remote.lines.map((line) => ({ name: line.description, quantity: line.quantity, tax: line.taxRateBps === null ? 'disabled' : String(line.taxRateBps / 100), total_price_gross: (line.totalGrossCents / 100).toFixed(2) }))
});

/** The events nobody could match or apply, for the admin "unmatched" list. */
export const listUnmatchedSyncEvents = ({ page = 1, pageSize = 25 } = {}) =>
    prisma.$transaction(async (tx) => {
        const where = { error: { not: null } };
        const [total, events] = await Promise.all([
            tx.invoiceSyncEvent.count({ where }),
            tx.invoiceSyncEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })
        ]);

        return { events, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
    });
