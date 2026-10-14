import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import { clearOutbox, outbox } from '../lib/mailer/index.js';
import { TOPICS } from '../lib/outbox.js';
import { syncBookingInTx } from '../services/finance/ledger.service.js';
import { MAX_ATTEMPTS, processEvent } from '../services/notifications/outbox.service.js';
import { applySyncEvents, pollInvoices } from '../services/invoicing/sync.service.js';
import {
    createTracker,
    databaseAvailable,
    futureDate,
    makeAdmin,
    makePartner,
    makePartnerUser,
    makeTransferBooking,
    makeTransferPoint,
    makeTransferProvider,
    makeTransferVehicle,
    signIn,
    unique
} from './support/factories.js';
import { startInvoiceOceanStub } from './support/invoiceocean.stub.js';

/**
 * Phase 4: invoices through InvoiceOcean, with a stub standing in for it.
 *
 * A confirmed transfer (sold for 200.00, owed by the agency) gets a proforma;
 * paying it in full gets a VAT invoice from the proforma; cancelling before
 * that cancels and re-issues the proforma, cancelling after it issues a
 * correction. The provider is only ever called by the outbox handlers, which
 * are run here by hand on the events the booking wrote, so nothing depends
 * on a drain's timing — and run twice, to show they do nothing the second
 * time.
 */
const app = createApp();
const dbAvailable = await databaseAvailable();

const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';

describe('invoicing flows', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const cookies = {};
    const saved = { ...config.finance.invoiceocean, opsEmail: config.finance.opsEmail };
    const externalIds = new Set();
    let stub;
    let supplier;
    let agency;
    let otherAgency;
    let provider;
    let vehicle;
    let from;
    let to;

    before(async () => {
        stub = await startInvoiceOceanStub();
        Object.assign(config.finance.invoiceocean, { enabled: true, domain: stub.url, apiToken: stub.apiToken, webhookSecret: WEBHOOK_SECRET, autoSend: false, requestTimeoutMs: 2000 });
        config.finance.opsEmail = 'finance-desk@example.test';

        for (const role of ['ACCOUNTANT', 'MANAGEMENT', 'TOUR_OPERATOR', 'ADMIN']) {
            cookies[role] = (await signIn(app, (await makeAdmin(tracker, { role })).email)).cookie;
        }

        supplier = await makePartner(tracker, { kind: 'TRANSPORT' });
        agency = await makePartner(tracker, { kind: 'TOUR_OPERATOR', paymentDueDays: 10, legalName: 'Caucasus Travel LLC', taxId: '405123456', invoiceLang: 'ru', city: 'Tbilisi', country: 'GE' });
        otherAgency = await makePartner(tracker, { kind: 'TOUR_OPERATOR' });
        cookies.AGENCY = (await signIn(app, (await makePartnerUser(tracker, agency)).email)).cookie;
        cookies.OTHER = (await signIn(app, (await makePartnerUser(tracker, otherAgency)).email)).cookie;

        provider = tracker.transferProvider(await makeTransferProvider({ partnerId: supplier.id }));
        vehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        from = tracker.transferPoint(await makeTransferPoint());
        to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));
    });

    after(async () => {
        Object.assign(config.finance.invoiceocean, saved);
        config.finance.opsEmail = saved.opsEmail;
        if (externalIds.size > 0) {
            await prisma.invoiceSyncEvent.deleteMany({ where: { externalId: { in: [...externalIds] } } });
        }
        await tracker.cleanup();
        await stub.close();
        await disconnect();
    });

    beforeEach(() => {
        stub.reset();
        clearOutbox();
    });

    // --- helpers ----------------------------------------------------------------------

    /** A confirmed transfer, synced into the ledger: receivable of 200.00 owed by the agency. */
    const booked = async (overrides = {}) => {
        const booking = await makeTransferBooking(tracker, { vehicleId: vehicle.id, from, to, partnerId: agency.id, pickupAt: new Date(`${futureDate(30)}T08:00:00Z`), ...overrides });
        await prisma.$transaction((tx) => syncBookingInTx(tx, 'TRANSFER', booking.id));

        return prisma.transferBooking.findUnique({ where: { id: booking.id }, include: { receivable: true } });
    };

    const invoicesOf = (receivableId) => prisma.invoice.findMany({ where: { receivableId }, include: { lines: { orderBy: { sortOrder: 'asc' } } }, orderBy: { createdAt: 'asc' } });

    const pendingEvents = (topic, invoiceId) =>
        prisma.outboxEvent.findMany({ where: { topic, processedAt: null, payload: { path: ['invoiceId'], equals: invoiceId } }, orderBy: { createdAt: 'asc' } });

    /** Runs the handler for every pending event of one topic about one invoice, as the drain would. */
    const run = async (topic, invoiceId) => {
        const events = await pendingEvents(topic, invoiceId);
        const results = [];

        for (const event of events) results.push(await processEvent(event));

        return results;
    };

    /** Issues a draft and remembers the provider's id for cleanup. */
    const issue = async (invoiceId) => {
        const results = await run(TOPICS.INVOICE_ISSUE_REQUESTED, invoiceId);
        const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
        if (invoice?.externalId) externalIds.add(invoice.externalId);

        return { results, invoice };
    };

    const pay = (body, cookie = cookies.ACCOUNTANT) =>
        request(app).post('/api/admin/finance/payments').set('Cookie', cookie).set('Idempotency-Key', unique('pay')).send({ direction: 'IN', method: 'BANK_TRANSFER', currency: 'GEL', paidAt: new Date().toISOString(), ...body });

    const cancel = async (booking, chargeCents) => {
        await prisma.transferBooking.update({ where: { id: booking.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationChargeCents: chargeCents } });
        await prisma.$transaction((tx) => syncBookingInTx(tx, 'TRANSFER', booking.id));

        return prisma.receivable.findUnique({ where: { id: booking.receivable.id } });
    };

    // --- the switch -------------------------------------------------------------------------

    it('writes nothing while invoicing is switched off', async () => {
        config.finance.invoiceocean.enabled = false;

        try {
            const booking = await booked();
            assert.ok(booking.receivable, 'the receivable is still created');
            assert.deepEqual(await invoicesOf(booking.receivable.id), []);
            assert.equal((await prisma.outboxEvent.count({ where: { topic: TOPICS.INVOICE_ISSUE_REQUESTED, entityId: { in: [] } } })), 0);

            const res = await request(app).post(`/api/admin/finance/receivables/${booking.receivable.id}/invoices`).set('Cookie', cookies.ACCOUNTANT).send({ kind: 'PROFORMA' });
            assert.equal(res.status, 422);
            assert.equal(res.body.error.details.reason, 'INVOICING_DISABLED');
        } finally {
            config.finance.invoiceocean.enabled = true;
        }
    });

    // --- the proforma -------------------------------------------------------------------------

    it('asks for a proforma when a booking is confirmed, and issues it once however many times the handler runs', async () => {
        const booking = await booked();
        const [draft] = await invoicesOf(booking.receivable.id);

        assert.equal(draft.kind, 'PROFORMA');
        assert.equal(draft.status, 'DRAFT');
        assert.equal(draft.totalCents, 20_000);
        assert.equal(draft.lang, 'ru', 'the partner language wins (D2)');
        assert.equal(draft.lines[0].taxRateBps, 1800, 'VAT on every line (D4)');
        assert.match(draft.lines[0].description, new RegExp(booking.reference));
        assert.equal(draft.buyerSnapshot.name, 'Caucasus Travel LLC');
        assert.equal(draft.buyerSnapshot.taxId, '405123456');
        assert.equal(draft.dueDate.toISOString().slice(0, 10), booking.receivable.dueAt.toISOString().slice(0, 10));

        const { results, invoice } = await issue(draft.id);

        assert.deepEqual(results, [true]);
        assert.equal(invoice.status, 'ISSUED');
        assert.ok(invoice.externalId);
        assert.equal(invoice.externalNumber, `PRO/${invoice.externalId}/${new Date().getFullYear()}`);
        assert.equal(invoice.publicToken, `tok-${invoice.externalId}`);

        const remote = stub.invoices.get(invoice.externalId);
        assert.equal(remote.oid, booking.reference, 'our reference travels as oid');
        assert.equal(remote.kind, 'proforma');
        assert.equal(remote.lang, 'ru');
        assert.equal(remote.price_gross, '200.00');
        assert.equal(remote.buyer_name, 'Caucasus Travel LLC');

        const client = [...stub.clients.values()].find((row) => row.external_id === agency.id);
        assert.ok(client, 'the agency became a client at the provider, filed under its partner id');
        assert.equal(client.tax_no, '405123456');
        const customer = await prisma.invoicingCustomer.findUnique({ where: { provider_partnerId: { provider: 'INVOICEOCEAN', partnerId: agency.id } } });
        assert.equal(customer.externalClientId, String(client.id));

        // The drain runs the handler again (a retried event): nothing new at the provider, nothing new here.
        const copy = await prisma.outboxEvent.create({ data: { topic: TOPICS.INVOICE_ISSUE_REQUESTED, payload: { invoiceId: draft.id }, attempts: 1, nextAttemptAt: new Date('2099-01-01') } });
        assert.equal(await processEvent(copy), true);
        assert.equal(stub.invoices.size, 1);
        assert.equal((await invoicesOf(booking.receivable.id)).length, 1);

        // The finance desk and the agency hear about it; nobody is emailed by us.
        const [issued] = await pendingEvents(TOPICS.INVOICE_ISSUED, draft.id);
        assert.ok(issued);
        assert.equal(await processEvent(issued), true);
        const notices = await prisma.notification.findMany({ where: { kind: 'FINANCE_INVOICE_ISSUED', payload: { path: ['outboxEventId'], equals: issued.id } }, include: { recipientUser: { select: { partnerId: true } } } });
        assert.ok(notices.some((n) => n.recipientUser?.partnerId === null), 'finance in-app');
        assert.ok(notices.some((n) => n.recipientUser?.partnerId === agency.id), 'the agency in-app');
        assert.equal(outbox.length, 0);

        const audit = await prisma.auditLog.findMany({ where: { entityId: draft.id }, orderBy: { createdAt: 'asc' } });
        assert.deepEqual(audit.map((row) => row.action), ['INVOICE_REQUESTED', 'INVOICE_ISSUED']);
    });

    it('invoices a guest with no company under a guest client record', async () => {
        const booking = await booked({ partnerId: null, leadPassengerName: 'Nino Guest', leadPassengerEmail: unique('guest') + '@example.test' });
        const [draft] = await invoicesOf(booking.receivable.id);

        assert.equal(draft.lang, 'en');
        assert.deepEqual(draft.buyerSnapshot, { name: 'Nino Guest', taxId: null, email: booking.leadPassengerEmail, street: null, city: null, country: null });

        const { invoice } = await issue(draft.id);
        assert.equal(invoice.status, 'ISSUED');

        const client = [...stub.clients.values()].find((row) => row.external_id === `guest:${booking.leadPassengerEmail}`);
        assert.ok(client, 'filed under guest:<email>');
        const customer = await prisma.invoicingCustomer.findUnique({ where: { provider_guestEmail: { provider: 'INVOICEOCEAN', guestEmail: booking.leadPassengerEmail } } });
        assert.equal(customer.externalClientId, String(client.id));
        assert.equal(customer.partnerId, null);
        await prisma.invoicingCustomer.delete({ where: { id: customer.id } });

        // Nobody on a partner side to tell; the finance desk still is.
        const [issued] = await pendingEvents(TOPICS.INVOICE_ISSUED, draft.id);
        assert.equal(await processEvent(issued), true);
        const notices = await prisma.notification.findMany({ where: { kind: 'FINANCE_INVOICE_ISSUED', payload: { path: ['outboxEventId'], equals: issued.id } }, include: { recipientUser: { select: { partnerId: true } } } });
        assert.ok(notices.length > 0);
        // A recipient deleted meanwhile by another test file's cleanup reads as null; only a partner-side recipient would be wrong.
        assert.ok(notices.every((n) => (n.recipientUser?.partnerId ?? null) === null));
    });

    it('adopts a document the provider already has under our reference instead of creating a second', async () => {
        const booking = await booked();
        const [draft] = await invoicesOf(booking.receivable.id);

        // Someone issued it by hand in InvoiceOcean, with the booking reference as oid.
        const res = await fetch(`${stub.url}/invoices.json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_token: stub.apiToken, invoice: { kind: 'proforma', oid: booking.reference, currency: 'GEL', positions: [{ name: 'x', quantity: 1, tax: '18', total_price_gross: '200.00' }] } }) });
        const manual = await res.json();
        stub.reset();

        const { invoice } = await issue(draft.id);

        assert.equal(invoice.status, 'ISSUED');
        assert.equal(invoice.externalId, String(manual.id));
        assert.equal(stub.requests.filter((r) => r.method === 'POST' && r.path === '/invoices.json').length, 0, 'nothing created');
        const audit = await prisma.auditLog.findFirst({ where: { entityId: draft.id, action: 'INVOICE_ISSUED' } });
        assert.equal(audit.metadata.adopted, true);
    });

    // --- payment ----------------------------------------------------------------------------------

    it('issues the VAT invoice from the proforma when the receivable is paid in full, and posts nothing to the proforma', async () => {
        const booking = await booked();
        const [proforma] = await invoicesOf(booking.receivable.id);
        await issue(proforma.id);

        const res = await pay({ amountCents: 20_000, reference: 'TBC-1', allocations: [{ receivableId: booking.receivable.id, amountCents: 20_000 }] });
        assert.equal(res.status, 201, JSON.stringify(res.body));

        const [, vatDraft] = await invoicesOf(booking.receivable.id);
        assert.equal(vatDraft.kind, 'VAT');
        assert.equal(vatDraft.status, 'DRAFT');
        assert.equal(vatDraft.fromInvoiceId, proforma.id);
        assert.equal(vatDraft.totalCents, 20_000);
        assert.equal(vatDraft.paidCents, 20_000);
        assert.equal(vatDraft.source, 'PAYMENT');

        const { invoice: vat } = await issue(vatDraft.id);
        assert.equal(vat.status, 'PAID');
        const remote = stub.invoices.get(vat.externalId);
        assert.equal(remote.kind, 'vat');
        assert.equal(remote.from_invoice_id, (await prisma.invoice.findUnique({ where: { id: proforma.id } })).externalId);
        assert.equal(remote.paid, '200.00');
        assert.equal(remote.status, 'paid');

        // The receipt handler: the receivable is PAID, so the VAT invoice carries the payment and no banking payment is posted.
        const [recorded] = await prisma.outboxEvent.findMany({ where: { topic: TOPICS.PAYMENT_RECORDED, processedAt: null, payload: { path: ['paymentId'], equals: res.body.payment.id } } });
        assert.equal(await processEvent(recorded), true);
        assert.equal(stub.payments.size, 0);
        assert.equal(outbox.filter((m) => m.template === 'paymentReceipt').length, 1, 'the agency still gets its receipt');
    });

    it('records a partial payment against the proforma at the provider, once', async () => {
        const booking = await booked();
        const [proforma] = await invoicesOf(booking.receivable.id);
        await issue(proforma.id);

        const res = await pay({ amountCents: 5_000, reference: 'TBC-2', allocations: [{ receivableId: booking.receivable.id, amountCents: 5_000 }] });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal((await invoicesOf(booking.receivable.id)).length, 1, 'no VAT invoice yet');

        const [recorded] = await prisma.outboxEvent.findMany({ where: { topic: TOPICS.PAYMENT_RECORDED, processedAt: null, payload: { path: ['paymentId'], equals: res.body.payment.id } } });
        assert.equal(await processEvent(recorded), true);
        assert.equal(stub.payments.size, 1);
        const [posted] = [...stub.payments.values()];
        assert.equal(posted.price, '50.00');
        assert.equal(posted.invoice_id, (await prisma.invoice.findUnique({ where: { id: proforma.id } })).externalId);

        const allocation = await prisma.paymentAllocation.findFirst({ where: { paymentRecordId: res.body.payment.id } });
        assert.equal(allocation.externalPaymentId, String(posted.id));
        assert.equal((await prisma.invoice.findUnique({ where: { id: proforma.id } })).status, 'PARTIAL');

        // Run again: already posted.
        const copy = await prisma.outboxEvent.create({ data: { topic: TOPICS.PAYMENT_RECORDED, payload: { paymentId: res.body.payment.id }, attempts: 1, nextAttemptAt: new Date('2099-01-01') } });
        assert.equal(await processEvent(copy), true);
        assert.equal(stub.payments.size, 1);
    });

    // --- cancellation ------------------------------------------------------------------------------

    it('cancels an unpaid proforma and issues a new one for the charge when the booking is cancelled before the VAT invoice', async () => {
        const booking = await booked();
        const [proforma] = await invoicesOf(booking.receivable.id);
        await issue(proforma.id);

        const receivable = await cancel(booking, 10_000);
        assert.equal(receivable.amountCents, 10_000);

        const invoices = await invoicesOf(booking.receivable.id);
        assert.deepEqual(invoices.map((row) => [row.kind, row.status, row.totalCents]), [['PROFORMA', 'CANCELLED', 20_000], ['PROFORMA', 'DRAFT', 10_000]]);
        assert.equal(invoices[1].source, 'CANCELLATION');

        const [cancelResult] = await run(TOPICS.INVOICE_CANCEL_REQUESTED, proforma.id);
        assert.equal(cancelResult, true);
        assert.equal(stub.invoices.get(invoices[0].externalId).cancelled, true);

        const { invoice: reissued } = await issue(invoices[1].id);
        assert.equal(reissued.status, 'ISSUED');
        assert.equal(stub.invoices.get(reissued.externalId).price_gross, '100.00');
    });

    it('cancels the proforma and asks for nothing when a free cancellation leaves nothing owed', async () => {
        const booking = await booked();
        const [proforma] = await invoicesOf(booking.receivable.id);
        await issue(proforma.id);

        const receivable = await cancel(booking, 0);
        assert.equal(receivable.status, 'VOID');

        const invoices = await invoicesOf(booking.receivable.id);
        assert.deepEqual(invoices.map((row) => [row.kind, row.status]), [['PROFORMA', 'CANCELLED']]);
        assert.equal((await pendingEvents(TOPICS.INVOICE_CANCEL_REQUESTED, proforma.id)).length, 1);
    });

    it('cancels a proforma the drain has not issued yet without touching the provider, and keeps it from the partner', async () => {
        const booking = await booked();
        const [proforma] = await invoicesOf(booking.receivable.id);
        assert.equal(proforma.status, 'DRAFT');

        // Cancelled before the drain ran: the booking must still cancel (this used to trip the
        // "issued documents have an external id" rule and answer 409 to the guest).
        const receivable = await cancel(booking, 10_000);
        assert.equal(receivable.amountCents, 10_000);

        const invoices = await invoicesOf(booking.receivable.id);
        assert.deepEqual(
            invoices.map((row) => [row.kind, row.status, row.totalCents, row.externalId]),
            [['PROFORMA', 'CANCELLED', 20_000, null], ['PROFORMA', 'DRAFT', 10_000, null]]
        );

        // Nothing to cancel at the provider; the stale issue request is a no-op.
        assert.equal((await pendingEvents(TOPICS.INVOICE_CANCEL_REQUESTED, proforma.id)).length, 0);
        await run(TOPICS.INVOICE_ISSUE_REQUESTED, proforma.id);
        assert.equal((await prisma.invoice.findUnique({ where: { id: proforma.id } })).status, 'CANCELLED');
        assert.equal(stub.requests.filter((r) => r.method === 'POST' && r.path === '/invoices.json').length, 0, 'nothing created at the provider');

        // A document that never existed has no number and no PDF: the partner is not shown it.
        const list = await request(app).get('/api/partner/finance/invoices').set('Cookie', cookies.AGENCY);
        assert.equal(list.status, 200);
        assert.ok(!list.body.data.some((row) => row.id === proforma.id), 'never-issued proforma listed to the partner');
        assert.equal((await request(app).get('/api/partner/finance/invoices/' + proforma.id).set('Cookie', cookies.AGENCY)).status, 404);
    });

    it('issues a correction from the VAT invoice when a paid booking is cancelled with a charge', async () => {
        const booking = await booked();
        const [proforma] = await invoicesOf(booking.receivable.id);
        await issue(proforma.id);
        await pay({ amountCents: 20_000, allocations: [{ receivableId: booking.receivable.id, amountCents: 20_000 }] });
        const [, vatDraft] = await invoicesOf(booking.receivable.id);
        const { invoice: vat } = await issue(vatDraft.id);

        await cancel(booking, 5_000);

        const invoices = await invoicesOf(booking.receivable.id);
        assert.equal(invoices.length, 3);
        const correction = invoices[2];
        assert.equal(correction.kind, 'CORRECTION');
        assert.equal(correction.fromInvoiceId, vat.id);
        assert.equal(correction.totalCents, -15_000, 'the difference between what was invoiced and what is owed now');
        assert.deepEqual(correction.lines.map((line) => line.totalGrossCents), [-20_000, 5_000]);
        assert.match(correction.correctionReason, /200\.00 GEL to 50\.00 GEL/);
        assert.equal(invoices[0].status, 'ISSUED', 'the proforma is left alone once the VAT invoice exists');

        const { invoice: issued } = await issue(correction.id);
        assert.equal(issued.status, 'ISSUED');
        const remote = stub.invoices.get(issued.externalId);
        assert.equal(remote.kind, 'correction');
        assert.equal(remote.from_invoice_id, vat.externalId);
        assert.equal(remote.correction_reason, correction.correctionReason);
        assert.deepEqual(remote.positions.map((p) => p.total_price_gross), ['-200.00', '50.00']);
    });

    // --- failure ----------------------------------------------------------------------------------

    it('marks a document the provider refuses as ERROR at once, tells Finance, and lets it be retried', async () => {
        const booking = await booked();
        const [draft] = await invoicesOf(booking.receivable.id);

        // The client lookup and the oid lookup pass; the refusal lands on the create.
        stub.failNext(422, { path: '/invoices.json', method: 'POST', body: { code: 'error', message: { currency: ['is not supported'] } } });

        const [result] = await run(TOPICS.INVOICE_ISSUE_REQUESTED, draft.id);
        assert.equal(result, true, 'a permanent refusal is not retried');

        const failed = await prisma.invoice.findUnique({ where: { id: draft.id } });
        assert.equal(failed.status, 'ERROR');
        assert.match(failed.syncError, /currency: is not supported/);

        const [event] = await pendingEvents(TOPICS.INVOICE_SYNC_FAILED, draft.id);
        assert.ok(event);
        assert.equal(await processEvent(event), true);
        const notices = await prisma.notification.findMany({ where: { kind: 'FINANCE_INVOICE_SYNC_FAILED', payload: { path: ['outboxEventId'], equals: event.id } } });
        assert.ok(notices.length > 0);
        const mail = outbox.find((m) => m.template === 'financeInvoiceSyncFailed');
        assert.equal(mail.to, 'finance-desk@example.test');
        assert.match(mail.text, /currency: is not supported/);

        // A partner never sees a failed document; Finance retries it from the invoice page.
        assert.equal((await request(app).get(`/api/partner/finance/invoices/${draft.id}`).set('Cookie', cookies.AGENCY)).status, 404);
        const retry = await request(app).post(`/api/admin/invoices/${draft.id}/retry`).set('Cookie', cookies.ACCOUNTANT).send({});
        assert.equal(retry.status, 202, JSON.stringify(retry.body));
        assert.equal(retry.body.invoice.status, 'DRAFT');

        stub.reset();
        const { invoice } = await issue(draft.id);
        assert.equal(invoice.status, 'ISSUED');
        assert.equal(invoice.syncError, null);
    });

    it('leaves a draft alone when the provider is down, and gives up only on the last attempt', async () => {
        const booking = await booked();
        const [draft] = await invoicesOf(booking.receivable.id);

        stub.failNext(503, { times: 2 });
        const [result] = await run(TOPICS.INVOICE_ISSUE_REQUESTED, draft.id);
        assert.equal(result, false);
        assert.equal((await prisma.invoice.findUnique({ where: { id: draft.id } })).status, 'DRAFT');
        const [event] = await prisma.outboxEvent.findMany({ where: { topic: TOPICS.INVOICE_ISSUE_REQUESTED, payload: { path: ['invoiceId'], equals: draft.id } } });
        assert.equal(event.attempts, 1);
        assert.match(event.lastError, /could not be reached|status 503/);

        // The drain's last try: still down → ERROR, and Finance is told.
        const last = await prisma.outboxEvent.create({ data: { topic: TOPICS.INVOICE_ISSUE_REQUESTED, payload: { invoiceId: draft.id }, attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date('2099-01-01') } });
        stub.failNext(503, { times: 2 });
        assert.equal(await processEvent(last), false);
        const failed = await prisma.invoice.findUnique({ where: { id: draft.id } });
        assert.equal(failed.status, 'ERROR');
        assert.equal((await pendingEvents(TOPICS.INVOICE_SYNC_FAILED, draft.id)).length, 1);
        await prisma.outboxEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    });

    // --- status sync ---------------------------------------------------------------------------------

    it('takes a webhook with the right secret, ignores a duplicate, refuses the wrong one, and applies the status', async () => {
        const booking = await booked();
        const [draft] = await invoicesOf(booking.receivable.id);
        const { invoice } = await issue(draft.id);

        const wrong = await request(app).post('/api/integrations/invoiceocean/webhook').send({ api_token: 'nope', invoice: { id: invoice.externalId } });
        assert.equal(wrong.status, 401);
        const none = await request(app).post('/api/integrations/invoiceocean/webhook').send({ invoice: { id: invoice.externalId } });
        assert.equal(none.status, 401);

        // Marked paid in InvoiceOcean by a person.
        const changed = stub.setInvoice(invoice.externalId, { status: 'paid', paid: '200.00' });
        const first = await request(app).post('/api/integrations/invoiceocean/webhook').send({ api_token: WEBHOOK_SECRET, invoice: { id: Number(invoice.externalId), status: 'paid', updated_at: changed.updated_at } });
        assert.equal(first.status, 200);
        assert.deepEqual(first.body, { received: true, duplicate: false });
        const again = await request(app).post('/api/integrations/invoiceocean/webhook').set('X-Webhook-Secret', WEBHOOK_SECRET).send({ invoice: { id: Number(invoice.externalId), status: 'paid', updated_at: changed.updated_at } });
        assert.deepEqual(again.body, { received: true, duplicate: true });

        assert.equal((await prisma.invoice.findUnique({ where: { id: draft.id } })).status, 'ISSUED', 'nothing applied inline');

        const applied = await applySyncEvents();
        assert.ok(applied.applied >= 1);
        const synced = await prisma.invoice.findUnique({ where: { id: draft.id } });
        assert.equal(synced.status, 'PAID');
        assert.equal(synced.paidCents, 20_000);
        assert.ok(synced.lastSyncedAt);

        const receivable = await prisma.receivable.findUnique({ where: { id: booking.receivable.id } });
        assert.equal(receivable.paidCents, 0, 'a status seen at the provider never moves the money here');
        assert.equal(receivable.status, 'OPEN');

        const audit = await prisma.auditLog.findFirst({ where: { entityId: draft.id, action: 'INVOICE_SYNCED' } });
        assert.match(audit.summary, /status → PAID/);
        const events = await prisma.invoiceSyncEvent.findMany({ where: { externalId: invoice.externalId } });
        assert.equal(events.length, 1);
        assert.ok(events[0].processedAt);
        assert.equal('api_token' in events[0].payload, false, 'the secret is not stored');
    });

    it('stores a webhook about a document it does not have as unmatched', async () => {
        externalIds.add('424242');
        const res = await request(app).post('/api/integrations/invoiceocean/webhook').send({ api_token: WEBHOOK_SECRET, id: 424242, status: 'paid', updated_at: new Date().toISOString() });
        assert.equal(res.status, 200);
        await applySyncEvents();

        const list = await request(app).get('/api/admin/invoices/sync-events').set('Cookie', cookies.ACCOUNTANT);
        assert.equal(list.status, 200);
        const row = list.body.data.find((entry) => entry.externalId === '424242');
        assert.equal(row.error, 'UNMATCHED');
    });

    it('finds by polling what the webhook never delivered', async () => {
        const booking = await booked();
        const [draft] = await invoicesOf(booking.receivable.id);
        const { invoice } = await issue(draft.id);

        stub.setInvoice(invoice.externalId, { status: 'sent' });
        const result = await pollInvoices();

        assert.equal(result.skipped, false);
        assert.ok(result.stored >= 1, JSON.stringify(result));
        assert.equal((await prisma.invoice.findUnique({ where: { id: draft.id } })).status, 'SENT');

        // Nothing changed since: the same poll stores nothing new.
        const second = await pollInvoices();
        assert.equal(second.stored, 0);
    });

    // --- the routes ----------------------------------------------------------------------------------

    it('tells the screens whether invoicing is on, and lets the tax id and language be set on the partner and in the portal', async () => {
        const settings = await request(app).get('/api/admin/invoices/settings').set('Cookie', cookies.MANAGEMENT);
        assert.equal(settings.status, 200);
        assert.equal(settings.body.enabled, true);
        assert.equal(settings.body.defaultTaxBps, 1800);
        assert.ok(settings.body.languages.includes('en') && settings.body.languages.includes('ru'));
        assert.equal('apiToken' in settings.body, false, 'no secret leaves the server');
        assert.equal((await request(app).get('/api/admin/invoices/settings').set('Cookie', cookies.TOUR_OPERATOR)).status, 403);

        // An admin sets what is printed as the buyer; InvoiceOcean's own language list is the only one accepted.
        const edited = await request(app).patch(`/api/admin/partners/${otherAgency.id}`).set('Cookie', cookies.ADMIN).send({ taxId: '  405999999 ', invoiceLang: 'de' });
        assert.equal(edited.status, 200, JSON.stringify(edited.body));
        assert.equal(edited.body.taxId, '405999999');
        assert.equal(edited.body.invoiceLang, 'de');
        assert.equal((await request(app).patch(`/api/admin/partners/${otherAgency.id}`).set('Cookie', cookies.ADMIN).send({ invoiceLang: 'ka' })).status, 400);

        // The partner may enter its own tax id, and clear it; the language stays the admin's call.
        const own = await request(app).patch('/api/partner/profile').set('Cookie', cookies.OTHER).send({ taxId: '12345678', invoiceLang: 'fr' });
        assert.equal(own.status, 200, JSON.stringify(own.body));
        assert.equal(own.body.taxId, '12345678');
        assert.equal(own.body.invoiceLang, 'de', 'the self-update schema drops what a partner may not change');
        const cleared = await request(app).patch('/api/partner/profile').set('Cookie', cookies.OTHER).send({ taxId: null });
        assert.equal(cleared.body.taxId, null);
    });

    it('lists, shows and streams for finance; refuses the reservations desk; keeps a partner to its own', async () => {
        const booking = await booked();
        const [draft] = await invoicesOf(booking.receivable.id);
        assert.equal((await request(app).get(`/api/partner/finance/invoices/${draft.id}`).set('Cookie', cookies.AGENCY)).status, 404, 'a draft is not yet a document');
        const { invoice } = await issue(draft.id);

        const list = await request(app).get('/api/admin/invoices').query({ receivableId: booking.receivable.id }).set('Cookie', cookies.MANAGEMENT);
        assert.equal(list.status, 200);
        assert.equal(list.body.data.length, 1);
        assert.equal(list.body.data[0].number, invoice.externalNumber);
        assert.equal(list.body.data[0].receivable.reference, booking.reference);
        assert.equal(list.body.data[0].hasPdf, true);

        const byNumber = await request(app).get('/api/admin/invoices').query({ q: invoice.externalNumber }).set('Cookie', cookies.ACCOUNTANT);
        assert.equal(byNumber.body.data.length, 1);

        const detail = await request(app).get(`/api/admin/invoices/${draft.id}`).set('Cookie', cookies.ACCOUNTANT);
        assert.equal(detail.status, 200);
        assert.equal(detail.body.lines.length, 1);
        assert.equal(detail.body.buyer.name, 'Caucasus Travel LLC');

        const pdf = await request(app).get(`/api/admin/invoices/${draft.id}/pdf`).set('Cookie', cookies.ACCOUNTANT).buffer(true).parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
        assert.equal(pdf.status, 200);
        assert.equal(pdf.headers['content-type'], 'application/pdf');
        assert.match(pdf.headers['content-disposition'], /inline; filename=".*\.pdf"/);
        assert.match(pdf.body.toString(), /^%PDF/);

        assert.equal((await request(app).get('/api/admin/invoices').set('Cookie', cookies.TOUR_OPERATOR)).status, 403);
        assert.equal((await request(app).post(`/api/admin/invoices/${draft.id}/send`).set('Cookie', cookies.MANAGEMENT).send({})).status, 403, 'management reads, never sends');

        const receivable = await request(app).get(`/api/admin/finance/receivables/${booking.receivable.id}`).set('Cookie', cookies.ACCOUNTANT);
        assert.equal(receivable.body.invoices.length, 1);
        assert.equal(receivable.body.invoices[0].kind, 'PROFORMA');

        const mine = await request(app).get('/api/partner/finance/invoices').set('Cookie', cookies.AGENCY);
        assert.equal(mine.status, 200);
        assert.ok(mine.body.data.some((row) => row.id === draft.id));
        assert.equal('externalId' in mine.body.data[0], false, 'no provider ids for a partner');
        assert.equal('syncError' in mine.body.data[0], false);

        const theirs = await request(app).get('/api/partner/finance/invoices').set('Cookie', cookies.OTHER);
        assert.equal(theirs.body.data.some((row) => row.id === draft.id), false);
        assert.equal((await request(app).get(`/api/partner/finance/invoices/${draft.id}`).set('Cookie', cookies.OTHER)).status, 404);
        assert.equal((await request(app).get(`/api/partner/finance/invoices/${draft.id}/pdf`).set('Cookie', cookies.OTHER)).status, 404);

        const ownPdf = await request(app).get(`/api/partner/finance/invoices/${draft.id}/pdf`).set('Cookie', cookies.AGENCY).buffer(true).parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
        assert.equal(ownPdf.status, 200);
        assert.match(ownPdf.body.toString(), /^%PDF/);
    });

    it('sends by email on request, cancels a proforma by hand, and refuses what makes no sense', async () => {
        const booking = await booked();
        const [draft] = await invoicesOf(booking.receivable.id);

        const early = await request(app).post(`/api/admin/invoices/${draft.id}/send`).set('Cookie', cookies.ACCOUNTANT).send({});
        assert.equal(early.status, 409);
        assert.equal(early.body.error.details.reason, 'NOT_ISSUED');

        const { invoice } = await issue(draft.id);

        const send = await request(app).post(`/api/admin/invoices/${draft.id}/send`).set('Cookie', cookies.ACCOUNTANT).send({ to: 'accounts@caucasus.test' });
        assert.equal(send.status, 202, JSON.stringify(send.body));
        const [sent] = await run(TOPICS.INVOICE_SEND_REQUESTED, draft.id);
        assert.equal(sent, true);
        assert.equal(stub.invoices.get(invoice.externalId).sent_to, 'accounts@caucasus.test');
        assert.equal((await prisma.invoice.findUnique({ where: { id: draft.id } })).status, 'SENT');

        const duplicate = await request(app).post(`/api/admin/finance/receivables/${booking.receivable.id}/invoices`).set('Cookie', cookies.ACCOUNTANT).send({ kind: 'PROFORMA' });
        assert.equal(duplicate.status, 409);
        assert.equal(duplicate.body.error.details.reason, 'LIVE_INVOICE_EXISTS');

        const cancelled = await request(app).post(`/api/admin/invoices/${draft.id}/cancel`).set('Cookie', cookies.ACCOUNTANT).send({ reason: 'issued twice' });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        assert.equal(cancelled.body.status, 'CANCELLED');
        await run(TOPICS.INVOICE_CANCEL_REQUESTED, draft.id);
        assert.equal(stub.invoices.get(invoice.externalId).cancelled, true);

        const twice = await request(app).post(`/api/admin/invoices/${draft.id}/cancel`).set('Cookie', cookies.ACCOUNTANT).send({});
        assert.equal(twice.status, 409);

        // With the proforma gone, Finance issues a new one by hand, with its own line and rate.
        const manual = await request(app)
            .post(`/api/admin/finance/receivables/${booking.receivable.id}/invoices`)
            .set('Cookie', cookies.ACCOUNTANT)
            .send({ kind: 'PROFORMA', lang: 'en', lines: [{ description: 'Transfer, as agreed', quantity: 1, taxRateBps: 0, totalGrossCents: 20_000 }] });
        assert.equal(manual.status, 202, JSON.stringify(manual.body));
        assert.equal(manual.body.invoice.status, 'DRAFT');
        assert.equal(manual.body.invoice.lang, 'en');
        assert.equal(manual.body.invoice.lines[0].taxRateBps, 0);
        assert.equal(manual.body.invoice.source, 'MANUAL');
        const { invoice: reissued } = await issue(manual.body.invoice.id);
        assert.equal(reissued.status, 'ISSUED');
        assert.equal(stub.invoices.get(reissued.externalId).positions[0].tax, '0');

        const vatByHand = await request(app).post(`/api/admin/finance/receivables/${booking.receivable.id}/invoices`).set('Cookie', cookies.ACCOUNTANT).send({ kind: 'VAT' });
        assert.equal(vatByHand.status, 202);
        assert.equal(vatByHand.body.invoice.fromInvoice.id, manual.body.invoice.id, 'chained to the live proforma');
        assert.equal(vatByHand.body.invoice.paidCents, 0);
    });
});
