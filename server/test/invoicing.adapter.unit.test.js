import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { BadGatewayError, UnprocessableEntityError } from '../lib/errors.js';
import { baseUrlFor, createInvoiceOceanAdapter, invoiceBody, mapInvoice, toCents, toMajor } from '../services/invoicing/invoiceocean.adapter.js';
import { startInvoiceOceanStub } from './support/invoiceocean.stub.js';

/**
 * The InvoiceOcean adapter against a stub of the API: the bodies it sends for
 * each kind of document, the money it converts, the errors it maps and the
 * limits it keeps. No database.
 */

const proforma = {
    kind: 'PROFORMA',
    lang: 'en',
    currency: 'GEL',
    oid: 'TRF-000123',
    issueDate: '2026-10-11',
    sellDate: '2026-10-11',
    dueDate: '2026-10-25',
    departmentId: null,
    clientExternalId: '77',
    buyer: { name: 'Caucasus Travel LLC', taxId: '405123456', email: 'finance@caucasus.test', street: '12 Rustaveli Ave', city: 'Tbilisi', country: 'GE' },
    lines: [{ description: 'Transfer Tbilisi Airport → Tbilisi, TRF-000123', quantity: 1, taxRateBps: 1800, totalGrossCents: 48_000 }],
    fromExternalId: null,
    correctionReason: null,
    paidCents: null
};

describe('invoiceocean adapter: pure parts', () => {
    it('formats and parses money in integer cents', () => {
        assert.equal(toMajor(48_000), '480.00');
        assert.equal(toMajor(5), '0.05');
        assert.equal(toMajor(-1250), '-12.50');
        assert.equal(toCents('480.00'), 48_000);
        assert.equal(toCents('480'), 48_000);
        assert.equal(toCents('-12.5'), -1250);
        assert.equal(toCents(null), 0);
        assert.throws(() => toCents('12,50'), BadGatewayError);
        assert.throws(() => toCents('abc'), BadGatewayError);
    });

    it('builds the account URL from a short name, a host or a URL', () => {
        assert.equal(baseUrlFor('acme'), 'https://acme.invoiceocean.com');
        assert.equal(baseUrlFor('acme.invoiceocean.com'), 'https://acme.invoiceocean.com');
        assert.equal(baseUrlFor('http://127.0.0.1:4567/'), 'http://127.0.0.1:4567');
        assert.throws(() => baseUrlFor(null), BadGatewayError);
    });

    it('writes a proforma the way the API documents it', () => {
        const body = invoiceBody(proforma);

        assert.deepEqual(body, {
            kind: 'proforma',
            number: null,
            lang: 'en',
            currency: 'GEL',
            oid: 'TRF-000123',
            issue_date: '2026-10-11',
            sell_date: '2026-10-11',
            payment_type: 'transfer',
            payment_to: '2026-10-25',
            client_id: '77',
            buyer_name: 'Caucasus Travel LLC',
            buyer_tax_no: '405123456',
            buyer_email: 'finance@caucasus.test',
            buyer_street: '12 Rustaveli Ave',
            buyer_city: 'Tbilisi',
            buyer_country: 'GE',
            positions: [{ name: 'Transfer Tbilisi Airport → Tbilisi, TRF-000123', description: '', quantity: 1, tax: '18', total_price_gross: '480.00' }]
        });
    });

    it('writes a VAT invoice from its proforma, marked paid', () => {
        const body = invoiceBody({ ...proforma, kind: 'vat' === 'vat' ? 'VAT' : 'VAT', fromExternalId: '1000', paidCents: 48_000, dueDate: null });

        assert.equal(body.kind, 'vat');
        assert.equal(body.from_invoice_id, '1000');
        assert.equal(body.paid, '480.00');
        assert.equal(body.status, 'paid');
        assert.equal('payment_to' in body, false);
    });

    it('writes a correction with a negative line, a reason and the invoice it corrects', () => {
        const body = invoiceBody({
            ...proforma,
            kind: 'CORRECTION',
            fromExternalId: '1001',
            correctionReason: 'Booking cancelled',
            lines: [
                { description: 'Transfer … (cancelled)', quantity: 1, taxRateBps: 1800, totalGrossCents: -48_000 },
                { description: 'Cancellation charge', quantity: 1, taxRateBps: 1800, totalGrossCents: 12_000 }
            ]
        });

        assert.equal(body.kind, 'correction');
        assert.equal(body.from_invoice_id, '1001');
        assert.equal(body.correction_reason, 'Booking cancelled');
        assert.deepEqual(body.positions.map((p) => p.total_price_gross), ['-480.00', '120.00']);
    });

    it('writes "disabled" for an untaxed line and a decimal rate when needed', () => {
        const body = invoiceBody({ ...proforma, lines: [{ description: 'x', quantity: 2, taxRateBps: null, totalGrossCents: 100 }, { description: 'y', quantity: 1, taxRateBps: 1850, totalGrossCents: 100 }] });

        assert.equal(body.positions[0].tax, 'disabled');
        assert.equal(body.positions[1].tax, '18.5');
    });

    it('maps an invoice from the API into cents, our statuses and our kinds', () => {
        const mapped = mapInvoice({
            id: 42,
            number: 'PRO/42/2026',
            kind: 'proforma',
            status: 'partial',
            oid: 'ORD-000045',
            currency: 'GEL',
            price_gross: '1200.00',
            paid: '300.00',
            issue_date: '2026-10-11',
            sell_date: '2026-10-11',
            payment_to: '2026-10-25',
            token: 'abc',
            updated_at: '2026-10-11T10:00:00.000Z',
            positions: [{ name: 'Room', quantity: 2, tax: '18', total_price_gross: '1200.00' }]
        });

        assert.equal(mapped.externalId, '42');
        assert.equal(mapped.kind, 'PROFORMA');
        assert.equal(mapped.status, 'PARTIAL');
        assert.equal(mapped.totalCents, 120_000);
        assert.equal(mapped.paidCents, 30_000);
        assert.equal(mapped.dueDate, '2026-10-25');
        assert.deepEqual(mapped.lines, [{ description: 'Room', quantity: 2, taxRateBps: 1800, totalGrossCents: 120_000 }]);
        assert.equal(mapInvoice({ id: 1, status: 'something-new', price_gross: '1' }).status, null);
    });
});

describe('invoiceocean adapter: over HTTP', () => {
    let stub;
    let settings;
    let adapter;

    before(async () => {
        stub = await startInvoiceOceanStub();
        settings = { domain: stub.url, apiToken: stub.apiToken, requestTimeoutMs: 2000 };
        adapter = createInvoiceOceanAdapter(() => settings);
    });

    after(() => stub.close());

    beforeEach(() => stub.reset());

    it('sends the token in the query of a GET and the body of a POST, never in a header', async () => {
        const created = await adapter.createInvoice(proforma);
        await adapter.getInvoice(created.externalId);

        const [post, get] = stub.requests;

        assert.equal(post.body.api_token, stub.apiToken);
        assert.equal('api_token' in post.query, false);
        assert.equal(get.query.api_token, stub.apiToken);
        assert.equal(created.number, `PRO/${created.externalId}/${new Date().getFullYear()}`);
        assert.equal(created.status, 'ISSUED');
        assert.equal(created.totalCents, 48_000);
        assert.equal(created.publicToken, `tok-${created.externalId}`);
    });

    it('finds a document by our reference and returns nothing for a stranger', async () => {
        const created = await adapter.createInvoice({ ...proforma, oid: 'BKG-000777' });
        const found = await adapter.findByOid('BKG-000777');

        assert.equal(found.length, 1);
        assert.equal(found[0].externalId, created.externalId);
        assert.deepEqual(await adapter.findByOid('BKG-NOPE'), []);
        assert.equal(await adapter.getInvoice('999999'), null);
    });

    it('creates a client once and updates it the next time', async () => {
        const first = await adapter.upsertClient({ ourId: 'partner-1', name: 'Caucasus Travel', taxId: '1', email: 'a@b.c', street: null, city: 'Tbilisi', country: 'GE' });
        const second = await adapter.upsertClient({ ourId: 'partner-1', name: 'Caucasus Travel LLC', taxId: '1', email: 'a@b.c', street: null, city: 'Tbilisi', country: 'GE' });

        assert.equal(first.externalId, second.externalId);
        assert.equal(second.name, 'Caucasus Travel LLC');
        assert.equal(stub.requests.filter((r) => r.method === 'POST' && r.path === '/clients.json').length, 1);
        assert.equal(stub.requests.filter((r) => r.method === 'PUT').length, 1);
        assert.equal(stub.requests.find((r) => r.method === 'PUT').body.client.external_id, 'partner-1');
    });

    it('records a payment against a document and marks it paid there', async () => {
        const created = await adapter.createInvoice(proforma);
        const payment = await adapter.createPayment({ name: 'TBC-1', amountCents: 48_000, currency: 'GEL', invoiceExternalId: created.externalId, paidDate: '2026-10-12' });
        const request = stub.requests.at(-1);

        assert.deepEqual(request.body.banking_payment, { name: 'TBC-1', price: '480.00', invoice_id: created.externalId, paid: true, kind: 'api', currency: 'GEL', paid_date: '2026-10-12' });
        assert.equal(payment.amountCents, 48_000);
        assert.equal((await adapter.getInvoice(created.externalId)).status, 'PAID');
    });

    it('changes a status, sends by email and streams the PDF', async () => {
        const created = await adapter.createInvoice(proforma);

        await adapter.sendByEmail(created.externalId, { to: 'x@y.z' });
        assert.equal(stub.requests.at(-1).body.email_to, 'x@y.z');
        assert.equal(stub.requests.at(-1).body.email_pdf, true, 'the PDF rides along, not only a link');

        // Cancelling is an update of the `cancelled` flag, not a change_status call (which refuses it).
        const cancelled = await adapter.changeStatus(created.externalId, 'cancelled');
        assert.equal(cancelled.status, 'CANCELLED');
        assert.equal(stub.requests.at(-1).method, 'PUT');
        assert.equal(stub.requests.at(-1).body.invoice.cancelled, true);
        assert.equal(stub.invoices.get(created.externalId).status, 'sent', 'the provider status itself is untouched');

        const paid = await adapter.changeStatus(created.externalId, 'paid');
        assert.equal(stub.requests.at(-1).query.status, 'paid');
        assert.equal(paid.status, 'CANCELLED', 'a cancelled document stays cancelled whatever its status says');

        const pdf = await adapter.getPdf(created.externalId);
        const bytes = Buffer.from(await new Response(pdf.stream).arrayBuffer());

        assert.equal(pdf.contentType, 'application/pdf');
        assert.equal(pdf.contentLength, bytes.length);
        assert.match(bytes.toString(), /^%PDF/);
    });

    it('turns a 422 into an UnprocessableEntityError that names the field', async () => {
        await assert.rejects(
            () => adapter.createInvoice({ ...proforma, currency: 'GELL' }),
            (err) => err instanceof UnprocessableEntityError && /currency: is not supported/.test(err.message) && err.details.reason === 'PROVIDER_REJECTED'
        );
    });

    it('retries once on a 429 and honours Retry-After', async () => {
        stub.failNext(429, { headers: { 'retry-after': '0' } });
        const started = Date.now();
        const created = await adapter.createInvoice(proforma);

        assert.ok(created.externalId);
        assert.equal(stub.requests.length, 2);
        assert.ok(Date.now() - started < 1500);
    });

    it('gives up after the second 5xx with a BadGatewayError', async () => {
        stub.failNext(503, { times: 2 });

        await assert.rejects(() => adapter.getInvoice('1'), (err) => err instanceof BadGatewayError && err.details.status === 503);
        assert.equal(stub.requests.length, 2);
    });

    it('reports a refused token as a gateway failure, not a retry', async () => {
        const wrong = createInvoiceOceanAdapter(() => ({ ...settings, apiToken: 'nope' }));

        await assert.rejects(() => wrong.getInvoice('1'), (err) => err instanceof BadGatewayError && err.details.reason === 'PROVIDER_AUTH');
        assert.equal(stub.requests.length, 1);
    });

    it('times out and answers BadGateway rather than hanging', async () => {
        const impatient = createInvoiceOceanAdapter(() => ({ ...settings, requestTimeoutMs: 150 }));
        stub.delayMs = 600;

        await assert.rejects(() => impatient.getInvoice('1'), BadGatewayError);
        stub.delayMs = 0;
        // The abandoned request is still sleeping inside the stub; let it
        // finish so the next test's in-flight count starts from zero.
        await stub.drained();
    });

    it('never has more than two requests in flight', async () => {
        stub.delayMs = 60;
        await Promise.all(Array.from({ length: 6 }, (_, i) => adapter.getInvoice(String(i))));
        stub.delayMs = 0;

        assert.equal(stub.requests.length, 6);
        assert.ok(stub.maxInFlight <= 2, `max in flight was ${stub.maxInFlight}`);
    });
});
