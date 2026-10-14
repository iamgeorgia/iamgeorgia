import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { BadGatewayError, ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { lockRows } from '../../lib/locks.js';
import { todayInTimezone } from '../../lib/time.js';
import { invoiceOcean } from './invoiceocean.adapter.js';
import { CHAINED_KINDS } from './provider.js';

/**
 * Invoices, issued from receivables.
 *
 * The platform decides what is owed (the ledger) and when it was paid (the
 * payments); InvoiceOcean numbers the documents, prints them and emails them.
 * The join is this file, and it is built in two halves that never run in the
 * same place:
 *
 *   in the booking's own transaction — `onReceivable…InTx` — a DRAFT row is
 *   written and an outbox event with it, which is cheap and cannot fail
 *   because a vendor is slow;
 *
 *   in the outbox drain — `issueInvoice`, `sendInvoice`, `cancelInvoiceRemote`
 *   — the vendor is called, retried with backoff, and the row brought up to
 *   date with what it answered.
 *
 * A document is only ever created once: the partial unique index allows one
 * live document of each kind per receivable, and before creating, the drain
 * asks the vendor whether a document with our reference (`oid`) already exists
 * and adopts it. So a retried handler, a replayed event or two sweepers
 * racing all end with one invoice.
 *
 * Owner decisions: proforma at confirmation, VAT invoice from it on full
 * payment, a correction when a VAT-invoiced booking's amount changes (2026-10-08);
 * language per partner, `en` by default (D2); one department (D3); the same
 * VAT rate on every line unless Finance says otherwise on a hand-issued
 * document (D4).
 */

const PROVIDER = 'INVOICEOCEAN';

/** Statuses that count as "there is a document": everything but a cancelled or failed one. */
export const LIVE_STATUSES = Object.freeze(['DRAFT', 'ISSUED', 'SENT', 'PAID', 'PARTIAL']);
/** Statuses a partner may see: a document that exists at the provider. */
export const VISIBLE_TO_PARTNER = Object.freeze(['ISSUED', 'SENT', 'PAID', 'PARTIAL', 'CANCELLED']);

const provider = () => invoiceOcean;
const settings = () => config.finance.invoiceocean;
export const isInvoicingEnabled = () => Boolean(settings().enabled);

const tz = () => config.finance.defaultTimezone;
const money = (cents, currency) => `${(cents / 100).toFixed(2)} ${currency}`;

// --- What a receivable is for ---------------------------------------------------------

/** Enough of the subject to describe it on a line, and of the debtor to address the document. */
export const receivableForInvoicing = {
    debtorPartner: {
        select: { id: true, name: true, legalName: true, email: true, taxId: true, invoiceLang: true, legalAddress: true, city: true, country: true, reference: true }
    },
    hotelBooking: { select: { id: true, reference: true, hotelSnapshot: true, checkIn: true, checkOut: true, nights: true } },
    transferBooking: { select: { id: true, reference: true, pickupAt: true, legs: { select: { fromPointName: true, toPointName: true }, orderBy: { legIndex: 'asc' } } } },
    tourBooking: { select: { id: true, reference: true, tourSnapshot: true, date: true, adults: true, childAges: true } },
    serviceBooking: { select: { id: true, reference: true, serviceSnapshot: true, date: true, quantity: true } },
    order: {
        select: {
            id: true,
            reference: true,
            packageSnapshot: true,
            startDate: true,
            items: { select: { label: true, status: true, lineTotalCents: true, cancellationChargeCents: true }, orderBy: { slotIndex: 'asc' } }
        }
    }
};

const day = (date) => (date instanceof Date ? date.toISOString().slice(0, 10) : date ? String(date).slice(0, 10) : null);

/** The lines a document is made of, adding up to exactly what is owed. */
export const buildLines = (receivable, { taxRateBps = settings().defaultTaxBps, amountCents = receivable.amountCents } = {}) => {
    const line = (description, totalGrossCents, bookingReference = receivable.reference, quantity = 1) => ({
        description,
        quantity,
        taxRateBps,
        totalGrossCents,
        bookingReference
    });

    const { hotelBooking: hotel, transferBooking: transfer, tourBooking: tour, serviceBooking: service, order } = receivable;

    if (order) {
        const name = order.packageSnapshot?.name ?? 'Package';
        const owed = (item) => (item.status === 'DECLINED' ? 0 : item.status === 'CANCELLED' ? Math.max(0, item.cancellationChargeCents ?? 0) : item.lineTotalCents);
        const items = order.items.filter((item) => owed(item) > 0).map((item) => line(`${name} · ${item.label}${item.status === 'CANCELLED' ? ' (cancellation charge)' : ''} · ${order.reference}`, owed(item)));

        if (items.length > 0 && items.reduce((sum, item) => sum + item.totalGrossCents, 0) === amountCents) {
            return items;
        }

        return [line(`${name}, from ${day(order.startDate)} · ${order.reference}`, amountCents)];
    }

    if (hotel) {
        const nights = hotel.nights === 1 ? '1 night' : `${hotel.nights} nights`;
        return [line(`${hotel.hotelSnapshot?.name ?? 'Hotel'}: ${nights}, ${day(hotel.checkIn)} – ${day(hotel.checkOut)} · ${hotel.reference}`, amountCents)];
    }

    if (transfer) {
        const first = transfer.legs?.[0];
        const route = first ? `${first.fromPointName} → ${first.toPointName}${transfer.legs.length > 1 ? ' and return' : ''}` : 'Transfer';
        return [line(`Transfer ${route}, ${day(transfer.pickupAt)} · ${transfer.reference}`, amountCents)];
    }

    if (tour) {
        const travellers = tour.adults + (tour.childAges?.length ?? 0);
        const option = tour.tourSnapshot?.option?.name ? ` (${tour.tourSnapshot.option.name})` : '';
        return [line(`${tour.tourSnapshot?.title ?? 'Tour'}${option}, ${day(tour.date)}, ${travellers} traveller${travellers === 1 ? '' : 's'} · ${tour.reference}`, amountCents)];
    }

    if (service) {
        return [line(`${service.serviceSnapshot?.name ?? 'Service'}, ${day(service.date)} · ${service.reference}`, amountCents)];
    }

    return [line(`Booking ${receivable.reference}`, amountCents)];
};

/** Who the document is addressed to: the company as registered, or the guest. */
export const buyerFor = (receivable) => {
    const partner = receivable.debtorPartner;

    if (partner) {
        return {
            name: partner.legalName || partner.name,
            taxId: partner.taxId ?? null,
            email: partner.email || receivable.debtorEmail || null,
            street: partner.legalAddress ?? null,
            city: partner.city ?? null,
            country: partner.country ?? null
        };
    }

    return { name: receivable.debtorName, taxId: null, email: receivable.debtorEmail ?? null, street: null, city: null, country: null };
};

/** A partner's own language for its documents, else the account's. Never Georgian or Hebrew: the provider has neither. */
export const langFor = (receivable) => receivable.debtorPartner?.invoiceLang || settings().lang;

/** `partnerId` for a company, `guest:<email>` for a guest: what the provider's client record is filed under. */
const customerKeyFor = (receivable) => (receivable.debtorPartnerId ? receivable.debtorPartnerId : `guest:${(receivable.debtorEmail ?? '').toLowerCase()}`);

// --- Reading ----------------------------------------------------------------------------------

export const invoiceInclude = {
    lines: { orderBy: { sortOrder: 'asc' } },
    fromInvoice: { select: { id: true, kind: true, status: true, externalNumber: true } },
    derived: { select: { id: true, kind: true, status: true, externalNumber: true, totalCents: true }, orderBy: { createdAt: 'asc' } },
    receivable: {
        select: {
            id: true,
            reference: true,
            status: true,
            currency: true,
            amountCents: true,
            paidCents: true,
            debtorPartnerId: true,
            debtorName: true,
            debtorEmail: true,
            debtorPartner: { select: { id: true, name: true, reference: true } }
        }
    }
};

const page = (total, { page: current, pageSize }) => ({ total, page: current, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });

export const listInvoices = async (query, { partnerId = null } = {}) => {
    const { kind, status, receivableId, debtorPartnerId, from, to, q } = query;
    const where = {
        ...(partnerId ? { receivable: { debtorPartnerId: partnerId }, status: { in: [...VISIBLE_TO_PARTNER] }, externalId: { not: null } } : {}),
        ...(kind ? { kind } : {}),
        ...(status ? { status: { in: partnerId ? status.filter((s) => VISIBLE_TO_PARTNER.includes(s)) : status } } : {}),
        ...(receivableId ? { receivableId } : {}),
        ...(debtorPartnerId && !partnerId ? { receivable: { debtorPartnerId: debtorPartnerId === 'GUEST' ? null : debtorPartnerId } } : {}),
        ...(from || to ? { issueDate: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}) } } : {}),
        ...(q ? { OR: [{ externalNumber: { contains: q, mode: 'insensitive' } }, { receivable: { reference: { contains: q, mode: 'insensitive' } } }] } : {})
    };

    const [total, invoices] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.invoice.findMany({ where, include: invoiceInclude, orderBy: [{ createdAt: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })
    ]);

    return { invoices, ...page(total, query) };
};

/** One invoice, or 404 — and for a partner, 404 for any document that is not its own or not yet real. */
export const findInvoiceOr404 = async (id, { partnerId = null, client = prisma } = {}) => {
    const invoice = await client.invoice.findUnique({ where: { id }, include: invoiceInclude });

    if (!invoice || (partnerId && (invoice.receivable.debtorPartnerId !== partnerId || !VISIBLE_TO_PARTNER.includes(invoice.status) || !invoice.externalId))) {
        throw new NotFoundError('Invoice not found');
    }

    return invoice;
};

const liveOfKind = (client, receivableId, kind) => client.invoice.findFirst({ where: { receivableId, kind, status: { in: [...LIVE_STATUSES] } }, orderBy: { createdAt: 'desc' } });

// --- Drafting (inside the caller's transaction) ---------------------------------------------------------

/**
 * Writes the DRAFT and the event that will issue it. The one place a document
 * is born, whether by a confirmation, a payment, a cancellation, a button or
 * the retry of a failed one.
 */
const draftInTx = async (tx, receivable, { kind, lines, fromInvoiceId = null, correctionReason = null, paidCents = 0, lang = null, dueDate, source }, actor, req) => {
    const totalCents = lines.reduce((sum, line) => sum + line.totalGrossCents, 0);
    const today = todayInTimezone(tz());
    const due = dueDate === undefined ? (receivable.dueAt ? todayInTimezone(tz(), receivable.dueAt) : null) : dueDate;

    const invoice = await tx.invoice.create({
        data: {
            provider: PROVIDER,
            receivableId: receivable.id,
            kind,
            status: 'DRAFT',
            fromInvoiceId,
            currency: receivable.currency,
            lang: lang ?? langFor(receivable),
            totalCents,
            paidCents,
            issueDate: new Date(`${today}T00:00:00Z`),
            sellDate: new Date(`${today}T00:00:00Z`),
            dueDate: due ? new Date(`${due}T00:00:00Z`) : null,
            buyerSnapshot: buyerFor(receivable),
            correctionReason,
            source,
            lines: { create: lines.map((line, index) => ({ sortOrder: index, ...line })) }
        },
        include: invoiceInclude
    });

    await recordAudit(tx, {
        action: 'INVOICE_REQUESTED',
        actor,
        entityType: AUDIT_ENTITY.invoice,
        entityId: invoice.id,
        summary: `${kind} requested for ${receivable.reference}: ${money(totalCents, receivable.currency)}`,
        metadata: { receivableId: receivable.id, reference: receivable.reference, kind, totalCents, fromInvoiceId, source },
        req
    });

    await enqueueEvent(tx, { topic: TOPICS.INVOICE_ISSUE_REQUESTED, payload: { invoiceId: invoice.id }, entityType: AUDIT_ENTITY.invoice, entityId: invoice.id });

    return invoice;
};

/** The receivable with what the hooks need, read on the caller's transaction. */
const loadForHooks = (tx, receivableId) =>
    tx.receivable.findUnique({
        where: { id: receivableId },
        include: { ...receivableForInvoicing, invoices: { where: { status: { in: [...LIVE_STATUSES] } }, include: { lines: { orderBy: { sortOrder: 'asc' } } } } }
    });

/** Marks a proforma cancelled here and asks the drain to cancel it there. */
const cancelLocallyInTx = async (tx, invoice, why, actor, req) => {
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED', syncError: null } });

    await recordAudit(tx, {
        action: 'INVOICE_CANCELLED',
        actor,
        entityType: AUDIT_ENTITY.invoice,
        entityId: invoice.id,
        summary: `${invoice.kind} ${invoice.externalNumber ?? invoice.id} cancelled: ${why}`,
        metadata: { receivableId: invoice.receivableId, externalId: invoice.externalId, why },
        req
    });

    if (invoice.externalId) {
        await enqueueEvent(tx, { topic: TOPICS.INVOICE_CANCEL_REQUESTED, payload: { invoiceId: invoice.id }, entityType: AUDIT_ENTITY.invoice, entityId: invoice.id });
    }
};

/**
 * A receivable was just written: ask for its proforma. Nothing for a
 * receivable that owes nothing, and nothing at all while invoicing is off.
 */
export const onReceivableCreatedInTx = async (tx, receivable, actor = null, req = null) => {
    if (!isInvoicingEnabled() || receivable.amountCents <= 0 || receivable.status === 'WAIVED') return null;

    const full = await loadForHooks(tx, receivable.id);
    if (!full || full.invoices.some((invoice) => invoice.kind === 'PROFORMA')) return null;

    return draftInTx(tx, full, { kind: 'PROFORMA', lines: buildLines(full), source: 'CONFIRM' }, actor, req);
};

/**
 * What is owed changed — a cancellation, almost always. Before the VAT
 * invoice: the proforma is cancelled and, when something is still owed, a new
 * one asked for. After it: a correction for the difference, with the reason.
 */
export const onReceivableAmountChangedInTx = async (tx, receivable, previous, actor = null, req = null) => {
    if (!isInvoicingEnabled() || receivable.amountCents === previous.amountCents) return null;

    const full = await loadForHooks(tx, receivable.id);
    if (!full) return null;

    const live = (kind) => full.invoices.find((invoice) => invoice.kind === kind);
    const vat = live('VAT') ?? live('FINAL');
    const why = full.status === 'VOID' || receivable.amountCents < previous.amountCents ? 'booking cancelled or reduced' : 'booking amended';

    if (vat) {
        const invoicedCents = vat.totalCents + full.invoices.filter((invoice) => invoice.kind === 'CORRECTION').reduce((sum, invoice) => sum + invoice.totalCents, 0);
        const deltaCents = receivable.amountCents - invoicedCents;

        if (deltaCents === 0) return null;

        if (live('CORRECTION')) {
            logger.warn({ receivableId: receivable.id }, 'A correction is already live for this receivable; a further one must be issued by hand');
            return null;
        }

        const lines = [
            ...vat.lines.map((line) => ({ description: `${line.description} (${why})`, quantity: line.quantity, taxRateBps: line.taxRateBps, totalGrossCents: -line.totalGrossCents, bookingReference: line.bookingReference })),
            ...(receivable.amountCents > 0 ? buildLines(full, { taxRateBps: vat.lines[0]?.taxRateBps ?? settings().defaultTaxBps }).map((line) => ({ ...line, description: `${line.description} (as now owed)` })) : [])
        ];

        return draftInTx(tx, full, { kind: 'CORRECTION', lines, fromInvoiceId: vat.id, correctionReason: `Amount changed from ${money(invoicedCents, full.currency)} to ${money(receivable.amountCents, full.currency)}: ${why}`, source: 'CANCELLATION' }, actor, req);
    }

    const proforma = live('PROFORMA');

    if (!proforma) return null;

    await cancelLocallyInTx(tx, proforma, why, actor, req);

    if (receivable.amountCents <= 0 || receivable.status === 'PAID' || receivable.status === 'WAIVED') return null;

    return draftInTx(tx, { ...full, amountCents: receivable.amountCents, dueAt: receivable.dueAt }, { kind: 'PROFORMA', lines: buildLines(full, { amountCents: receivable.amountCents }), source: 'CANCELLATION' }, actor, req);
};

/** Paid in full: the VAT invoice, from the proforma when there is one, marked paid. */
export const onReceivablePaidInTx = async (tx, receivable, actor = null, req = null) => {
    if (!isInvoicingEnabled() || receivable.amountCents <= 0) return null;

    const full = await loadForHooks(tx, receivable.id);
    if (!full || full.invoices.some((invoice) => ['VAT', 'FINAL'].includes(invoice.kind))) return null;

    const proforma = full.invoices.find((invoice) => invoice.kind === 'PROFORMA');
    const lines = proforma && proforma.totalCents === receivable.amountCents ? proforma.lines.map(({ description, quantity, taxRateBps, totalGrossCents, bookingReference }) => ({ description, quantity, taxRateBps, totalGrossCents, bookingReference })) : buildLines(full, { amountCents: receivable.amountCents });

    return draftInTx(tx, { ...full, amountCents: receivable.amountCents }, { kind: 'VAT', lines, fromInvoiceId: proforma?.id ?? null, paidCents: receivable.amountCents, dueDate: null, source: 'PAYMENT' }, actor, req);
};

// --- The drain's half ---------------------------------------------------------------------------------------

const customerSnapshot = (buyer, key) => ({ ...buyer, ourId: key });

/** Keys sorted, so a snapshot read back from JSONB (which reorders them) compares equal to the one just built. */
const stable = (value) => JSON.stringify(value, (key, inner) => (inner && typeof inner === 'object' && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1))) : inner));

/** The provider's client record for this buyer, created or brought up to date when what we would send has changed. */
const ensureCustomer = async (receivable, actor = null) => {
    const key = customerKeyFor(receivable);
    const buyer = buyerFor(receivable);
    const snapshot = customerSnapshot(buyer, key);
    const where = receivable.debtorPartnerId ? { provider_partnerId: { provider: PROVIDER, partnerId: receivable.debtorPartnerId } } : { provider_guestEmail: { provider: PROVIDER, guestEmail: key.slice('guest:'.length) } };
    const existing = await prisma.invoicingCustomer.findUnique({ where });

    if (existing && stable(existing.snapshot) === stable(snapshot)) {
        return existing;
    }

    const client = await provider().upsertClient({ ...buyer, ourId: key, externalId: existing?.externalClientId });

    const customer = await prisma.invoicingCustomer.upsert({
        where,
        create: {
            provider: PROVIDER,
            partnerId: receivable.debtorPartnerId ?? null,
            guestEmail: receivable.debtorPartnerId ? null : key.slice('guest:'.length),
            externalClientId: client.externalId,
            snapshot,
            lastSyncedAt: new Date()
        },
        update: { externalClientId: client.externalId, snapshot, lastSyncedAt: new Date() }
    });

    await recordAudit(prisma, {
        action: 'INVOICING_CUSTOMER_SYNCED',
        actor,
        entityType: AUDIT_ENTITY.invoicingCustomer,
        entityId: customer.id,
        summary: `${buyer.name} ${existing ? 'updated' : 'created'} at the invoicing provider`,
        metadata: { partnerId: receivable.debtorPartnerId ?? null, externalClientId: client.externalId }
    });

    return customer;
};

/** A document already at the provider under our reference, of this kind, not cancelled and not already ours. */
const adoptable = async (invoice) => {
    const candidates = (await provider().findByOid(invoice.receivable.reference)).filter((candidate) => candidate.kind === invoice.kind && candidate.status !== 'CANCELLED');

    if (candidates.length === 0) return null;

    const taken = new Set((await prisma.invoice.findMany({ where: { provider: PROVIDER, externalId: { in: candidates.map((c) => c.externalId) } }, select: { externalId: true } })).map((row) => row.externalId));

    return candidates.find((candidate) => !taken.has(candidate.externalId)) ?? null;
};

const permanent = (err) => err instanceof UnprocessableEntityError || err instanceof NotFoundError || err?.details?.reason === 'PROVIDER_AUTH';

/**
 * Creates the document at the provider. The outbox handler; idempotent.
 *
 * `finalAttempt` is the drain's word that it will not try again: a transient
 * failure then is recorded as ERROR with its message, so Finance sees it and
 * can retry by hand. A permanent one (the provider refused the document) is
 * recorded the same way at once — more attempts would only repeat the answer.
 */
export const issueInvoice = async (invoiceId, { finalAttempt = false } = {}) => {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { ...invoiceInclude, receivable: { include: receivableForInvoicing } } });

    if (!invoice || invoice.status !== 'DRAFT') return invoice ?? null;

    try {
        if (!isInvoicingEnabled()) {
            throw new BadGatewayError('Invoicing is switched off (INVOICEOCEAN_ENABLED)');
        }

        let fromExternalId = null;

        if (CHAINED_KINDS.includes(invoice.kind) && invoice.fromInvoiceId) {
            const from = await prisma.invoice.findUnique({ where: { id: invoice.fromInvoiceId }, select: { externalId: true, status: true } });

            if (from?.status === 'DRAFT') {
                // The proforma is still on its way; this one waits its turn.
                throw new BadGatewayError('The document this one is issued from has not been issued yet');
            }

            fromExternalId = from?.externalId && from.status !== 'ERROR' ? from.externalId : null;
        }

        const customer = await ensureCustomer(invoice.receivable);
        const adopted = await adoptable(invoice);

        const remote =
            adopted ??
            (await provider().createInvoice({
                kind: invoice.kind,
                lang: invoice.lang,
                currency: invoice.currency,
                oid: invoice.receivable.reference,
                issueDate: day(invoice.issueDate),
                sellDate: day(invoice.sellDate),
                dueDate: day(invoice.dueDate),
                departmentId: settings().departmentId,
                clientExternalId: customer.externalClientId,
                buyer: invoice.buyerSnapshot,
                lines: invoice.lines.map(({ description, quantity, taxRateBps, totalGrossCents }) => ({ description, quantity, taxRateBps, totalGrossCents })),
                fromExternalId,
                correctionReason: invoice.correctionReason,
                paidCents: invoice.paidCents > 0 ? invoice.paidCents : null
            }));

        const updated = await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
                externalId: remote.externalId,
                externalNumber: remote.number,
                publicToken: remote.publicToken,
                status: remote.status && remote.status !== 'CANCELLED' ? remote.status : 'ISSUED',
                paidCents: Math.max(invoice.paidCents, remote.paidCents ?? 0),
                externalUpdatedAt: remote.updatedAt,
                lastSyncedAt: new Date(),
                syncError: null,
                ...(remote.issueDate ? { issueDate: new Date(`${remote.issueDate}T00:00:00Z`) } : {}),
                ...(remote.sellDate ? { sellDate: new Date(`${remote.sellDate}T00:00:00Z`) } : {})
            },
            include: invoiceInclude
        });

        await recordAudit(prisma, {
            action: 'INVOICE_ISSUED',
            actor: null,
            entityType: AUDIT_ENTITY.invoice,
            entityId: invoice.id,
            summary: `${invoice.kind} ${remote.number ?? remote.externalId} ${adopted ? 'adopted' : 'issued'} for ${invoice.receivable.reference}: ${money(invoice.totalCents, invoice.currency)}`,
            metadata: { receivableId: invoice.receivableId, externalId: remote.externalId, number: remote.number, adopted: Boolean(adopted), kind: invoice.kind }
        });

        logger.info({ invoiceId: invoice.id, kind: invoice.kind, externalId: remote.externalId, adopted: Boolean(adopted) }, 'invoicing.issue ok');

        await enqueueEvent(prisma, { topic: TOPICS.INVOICE_ISSUED, payload: { invoiceId: invoice.id }, entityType: AUDIT_ENTITY.invoice, entityId: invoice.id });

        if (settings().autoSend && invoice.buyerSnapshot?.email) {
            await enqueueEvent(prisma, { topic: TOPICS.INVOICE_SEND_REQUESTED, payload: { invoiceId: invoice.id }, entityType: AUDIT_ENTITY.invoice, entityId: invoice.id });
        }

        return updated;
    } catch (err) {
        const giveUp = permanent(err) || finalAttempt;

        logger.error({ err, invoiceId: invoice.id, kind: invoice.kind, giveUp }, 'invoicing.issue error');

        if (!giveUp) {
            throw err;
        }

        await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'ERROR', syncError: String(err?.message ?? err).slice(0, 1000) } });

        await recordAudit(prisma, {
            action: 'INVOICE_SYNC_FAILED',
            actor: null,
            entityType: AUDIT_ENTITY.invoice,
            entityId: invoice.id,
            summary: `${invoice.kind} for ${invoice.receivable.reference} could not be issued: ${String(err?.message ?? err).slice(0, 200)}`,
            metadata: { receivableId: invoice.receivableId, kind: invoice.kind, permanent: permanent(err), details: err?.details ?? null }
        });

        await enqueueEvent(prisma, { topic: TOPICS.INVOICE_SYNC_FAILED, payload: { invoiceId: invoice.id }, entityType: AUDIT_ENTITY.invoice, entityId: invoice.id });

        if (!permanent(err)) {
            throw err;
        }

        return null;
    }
};

/** Asks the provider to email the document. The outbox handler behind "Send by email" and auto-send. */
export const sendInvoice = async (invoiceId, { to = null } = {}) => {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { receivable: { select: { reference: true } } } });

    if (!invoice?.externalId || !['ISSUED', 'SENT', 'PAID', 'PARTIAL'].includes(invoice.status)) return null;

    const address = to ?? invoice.buyerSnapshot?.email ?? null;

    await provider().sendByEmail(invoice.externalId, address ? { to: address } : {});

    const updated = await prisma.invoice.update({ where: { id: invoice.id }, data: { status: invoice.status === 'ISSUED' ? 'SENT' : invoice.status, lastSyncedAt: new Date() } });

    await recordAudit(prisma, {
        action: 'INVOICE_SENT',
        actor: null,
        entityType: AUDIT_ENTITY.invoice,
        entityId: invoice.id,
        summary: `${invoice.kind} ${invoice.externalNumber ?? invoice.externalId} emailed${address ? ` to ${address}` : ''}`,
        metadata: { receivableId: invoice.receivableId, to: address }
    });

    return updated;
};

/** Cancels at the provider a document already cancelled here. The outbox handler. */
export const cancelInvoiceRemote = async (invoiceId) => {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });

    if (!invoice?.externalId || invoice.status !== 'CANCELLED') return null;

    try {
        await provider().changeStatus(invoice.externalId, 'cancelled');
    } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
    }

    return prisma.invoice.update({ where: { id: invoice.id }, data: { lastSyncedAt: new Date() } });
};

/**
 * Tells the provider about a payment recorded here, against the live document
 * of each receivable it settled — so the account's own ledger matches ours.
 * A receivable paid in full gets its VAT invoice instead, already marked
 * paid, and nothing is posted to the proforma it came from. Idempotent per
 * allocation through `externalPaymentId`.
 */
export const recordProviderPayment = async (paymentId) => {
    if (!isInvoicingEnabled()) return { posted: 0 };

    const payment = await prisma.paymentRecord.findUnique({
        where: { id: paymentId },
        include: { allocations: { where: { receivableId: { not: null }, externalPaymentId: null }, include: { receivable: { select: { id: true, reference: true, status: true, currency: true } } } } }
    });

    if (!payment || payment.direction !== 'IN' || payment.kind !== 'PAYMENT') return { posted: 0 };

    let posted = 0;

    for (const allocation of payment.allocations) {
        if (allocation.receivable.status === 'PAID') continue;

        const live = await prisma.invoice.findFirst({
            where: { receivableId: allocation.receivableId, kind: 'PROFORMA', status: { in: ['ISSUED', 'SENT', 'PARTIAL'] }, externalId: { not: null } },
            orderBy: { createdAt: 'desc' }
        });

        if (!live) continue;

        const remote = await provider().createPayment({
            name: payment.reference ? `${payment.reference} · ${allocation.receivable.reference}` : `Payment ${payment.id} · ${allocation.receivable.reference}`,
            amountCents: allocation.amountCents,
            currency: payment.currency,
            invoiceExternalId: live.externalId,
            paidDate: day(payment.paidAt)
        });

        await prisma.paymentAllocation.update({ where: { id: allocation.id }, data: { externalPaymentId: remote.externalId || 'posted' } });
        await prisma.invoice.update({ where: { id: live.id }, data: { paidCents: live.paidCents + allocation.amountCents, status: live.paidCents + allocation.amountCents >= live.totalCents ? 'PAID' : 'PARTIAL', lastSyncedAt: new Date() } });
        posted += 1;
    }

    return { posted };
};

// --- What Finance does by hand ------------------------------------------------------------------------

const assertEnabled = () => {
    if (!isInvoicingEnabled()) {
        throw new UnprocessableEntityError('Invoicing is switched off on this server', { reason: 'INVOICING_DISABLED' });
    }
};

/** "Issue a proforma / VAT invoice" on a receivable: for backfilled bookings, or after a failure. */
export const requestInvoice = async (receivableId, { kind, lang, dueDate, lines: customLines, taxRateBps }, actor, req) => {
    assertEnabled();

    return prisma.$transaction(async (tx) => {
        await lockRows(tx, 'receivables', [receivableId]);
        const receivable = await loadForHooks(tx, receivableId);

        if (!receivable) {
            throw new NotFoundError('Receivable not found');
        }

        if (receivable.amountCents <= 0 || ['VOID', 'WAIVED'].includes(receivable.status)) {
            throw new UnprocessableEntityError('Nothing is owed on this receivable', { reason: 'NOTHING_OWED' });
        }

        const existing = receivable.invoices.find((invoice) => invoice.kind === kind);

        if (existing) {
            throw new ConflictError(`A ${kind.toLowerCase()} already exists for this receivable`, { reason: 'LIVE_INVOICE_EXISTS', invoiceId: existing.id, status: existing.status });
        }

        const lines = customLines?.length
            ? customLines.map((line) => ({ description: line.description, quantity: line.quantity, taxRateBps: line.taxRateBps === undefined ? settings().defaultTaxBps : line.taxRateBps, totalGrossCents: line.totalGrossCents, bookingReference: receivable.reference }))
            : buildLines(receivable, { taxRateBps: taxRateBps ?? settings().defaultTaxBps });

        const chained = CHAINED_KINDS.includes(kind);
        const from = chained ? receivable.invoices.find((invoice) => invoice.kind === 'PROFORMA') ?? null : null;
        const paid = chained && receivable.status === 'PAID' ? receivable.amountCents : chained ? Math.min(receivable.paidCents, receivable.amountCents) : 0;

        return draftInTx(tx, receivable, { kind, lines, fromInvoiceId: from?.id ?? null, paidCents: paid, lang: lang ?? null, dueDate: dueDate ?? (chained ? null : undefined), source: 'MANUAL' }, actor, req);
    });
};

export const requestSend = async (invoiceId, { to = null }, actor, req) => {
    assertEnabled();
    const invoice = await findInvoiceOr404(invoiceId);

    if (!invoice.externalId || !['ISSUED', 'SENT', 'PAID', 'PARTIAL'].includes(invoice.status)) {
        throw new ConflictError('Only an issued document can be sent', { reason: 'NOT_ISSUED', status: invoice.status });
    }

    await prisma.$transaction(async (tx) => {
        await recordAudit(tx, {
            action: 'INVOICE_SENT',
            actor,
            entityType: AUDIT_ENTITY.invoice,
            entityId: invoice.id,
            summary: `Sending of ${invoice.kind} ${invoice.externalNumber ?? invoice.externalId} requested${to ? ` to ${to}` : ''}`,
            metadata: { receivableId: invoice.receivableId, to, requested: true },
            req
        });
        await enqueueEvent(tx, { topic: TOPICS.INVOICE_SEND_REQUESTED, payload: { invoiceId: invoice.id, to }, entityType: AUDIT_ENTITY.invoice, entityId: invoice.id });
    });

    return invoice;
};

/** Cancels a proforma nobody has paid: a booking changed by hand, a duplicate, a mistake. A VAT invoice is corrected, never cancelled here. */
export const cancelProforma = async (invoiceId, { reason }, actor, req) => {
    assertEnabled();

    return prisma.$transaction(async (tx) => {
        const invoice = await findInvoiceOr404(invoiceId, { client: tx });

        if (invoice.kind !== 'PROFORMA') {
            throw new ConflictError('Only a proforma can be cancelled; a VAT invoice is corrected', { reason: 'NOT_A_PROFORMA', kind: invoice.kind });
        }

        if (!['DRAFT', 'ISSUED', 'SENT', 'PARTIAL', 'ERROR'].includes(invoice.status)) {
            throw new ConflictError('That proforma cannot be cancelled now', { reason: 'NOT_CANCELLABLE', status: invoice.status });
        }

        await cancelLocallyInTx(tx, invoice, reason ?? 'cancelled by finance', actor, req);

        return findInvoiceOr404(invoiceId, { client: tx });
    });
};

/** Puts a failed document back in the queue. */
export const retryInvoice = async (invoiceId, actor, req) => {
    assertEnabled();

    return prisma.$transaction(async (tx) => {
        const invoice = await findInvoiceOr404(invoiceId, { client: tx });

        if (invoice.status !== 'ERROR') {
            throw new ConflictError('Only a failed document can be retried', { reason: 'NOT_FAILED', status: invoice.status });
        }

        const clash = await liveOfKind(tx, invoice.receivableId, invoice.kind);

        if (clash) {
            throw new ConflictError(`A ${invoice.kind.toLowerCase()} already exists for this receivable`, { reason: 'LIVE_INVOICE_EXISTS', invoiceId: clash.id, status: clash.status });
        }

        const updated = await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'DRAFT', syncError: null }, include: invoiceInclude });

        await recordAudit(tx, {
            action: 'INVOICE_REQUESTED',
            actor,
            entityType: AUDIT_ENTITY.invoice,
            entityId: invoice.id,
            summary: `${invoice.kind} for ${invoice.receivable.reference} re-queued after a failure`,
            metadata: { receivableId: invoice.receivableId, kind: invoice.kind, retry: true, previousError: invoice.syncError },
            req
        });
        await enqueueEvent(tx, { topic: TOPICS.INVOICE_ISSUE_REQUESTED, payload: { invoiceId: invoice.id }, entityType: AUDIT_ENTITY.invoice, entityId: invoice.id });

        return updated;
    });
};

/** The PDF, straight from the provider, for a document that exists there. */
export const streamPdf = async (invoiceId, { partnerId = null } = {}) => {
    const invoice = await findInvoiceOr404(invoiceId, { partnerId });

    if (!invoice.externalId) {
        throw new ConflictError('This document has not been issued yet', { reason: 'NOT_ISSUED', status: invoice.status });
    }

    const pdf = await provider().getPdf(invoice.externalId);
    const filename = `${(invoice.externalNumber ?? invoice.kind).replace(/[^\w.-]+/g, '-')}.pdf`;

    return { ...pdf, filename, invoice };
};
