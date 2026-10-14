import http from 'node:http';

/**
 * A stand-in for InvoiceOcean's API, in memory, for the adapter and flow tests.
 *
 * Speaks the handful of routes the adapter uses — invoices, clients, banking
 * payments, webhooks, the PDF — with the field names the real API uses, and
 * records every request so a test can assert what was sent. State is plain
 * objects; a test reads `stub.invoices` directly rather than asking the API
 * twice. Failure is injected with `stub.failNext(...)` and slowness with
 * `stub.delayMs`, so the retry and timeout paths can be driven on purpose.
 *
 *   const stub = await startInvoiceOceanStub();
 *   config.finance.invoiceocean.domain = stub.url;
 *   …
 *   await stub.close();
 */
export const startInvoiceOceanStub = async ({ apiToken = 'stub-token' } = {}) => {
    const state = {
        apiToken,
        requests: [],
        invoices: new Map(),
        clients: new Map(),
        payments: new Map(),
        webhooks: new Map(),
        // A fresh base every run: a row left in the shared dev database by an earlier run
        // (or by a live walk against the stub) can then never collide with today's ids.
        nextId: 100_000 + Math.floor(Math.random() * 900_000_000),
        failures: [],
        delayMs: 0,
        inFlight: 0,
        maxInFlight: 0
    };

    const nextId = () => state.nextId++;
    const today = () => new Date().toISOString().slice(0, 10);
    const now = () => new Date().toISOString();

    const numberFor = (kind, id) => `${{ proforma: 'PRO', vat: 'FV', correction: 'KOR', advance: 'ADV', final: 'FIN' }[kind] ?? 'DOC'}/${id}/${new Date().getFullYear()}`;

    const gross = (positions) => positions.reduce((sum, p) => sum + Number(p.total_price_gross ?? 0) * Number(p.quantity ?? 1), 0);
    const major = (n) => (Math.round(n * 100) / 100).toFixed(2);

    const readBody = (req) =>
        new Promise((resolve) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => {
                try {
                    resolve(data ? JSON.parse(data) : {});
                } catch {
                    resolve({ _raw: data });
                }
            });
        });

    const send = (res, status, payload, headers = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': `stub-${state.requests.length}`, ...headers });
        res.end(payload === undefined ? '' : JSON.stringify(payload));
    };

    const handle = async (req, res) => {
        const url = new URL(req.url, 'http://stub');
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        const token = req.method === 'GET' ? url.searchParams.get('api_token') : body.api_token;
        const entry = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body };

        state.requests.push(entry);
        state.inFlight += 1;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);

        try {
            if (state.delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, state.delayMs));
            }

            // The first queued failure that applies to this request: one
            // without a path applies to anything, one with a path waits for it.
            const at = state.failures.findIndex((entry) => !entry.path || (entry.path === url.pathname && (!entry.method || entry.method === req.method)));
            const failure = at >= 0 ? state.failures.splice(at, 1)[0] : null;

            if (failure) {
                return send(res, failure.status, failure.body ?? { code: 'error', message: 'injected' }, failure.headers ?? {});
            }

            if (token !== state.apiToken) {
                return send(res, 401, { code: 'error', message: 'Unauthorized' });
            }

            const { pathname } = url;
            let match;

            // --- invoices -----------------------------------------------------------
            if (req.method === 'POST' && pathname === '/invoices.json') {
                const input = body.invoice ?? {};

                if (!Array.isArray(input.positions) || input.positions.length === 0) {
                    return send(res, 422, { code: 'error', message: { positions: ['must have at least one position'] } });
                }

                if (input.currency && input.currency.length !== 3) {
                    return send(res, 422, { code: 'error', message: { currency: ['is not supported'] } });
                }

                const id = nextId();
                const invoice = {
                    id,
                    number: numberFor(input.kind, id),
                    kind: input.kind,
                    status: input.status ?? 'issued',
                    oid: input.oid ?? null,
                    currency: input.currency ?? 'GEL',
                    lang: input.lang ?? 'en',
                    issue_date: input.issue_date ?? today(),
                    sell_date: input.sell_date ?? today(),
                    payment_to: input.payment_to ?? null,
                    price_gross: major(gross(input.positions)),
                    paid: input.paid ?? '0.00',
                    token: `tok-${id}`,
                    client_id: input.client_id ?? null,
                    from_invoice_id: input.from_invoice_id ?? null,
                    correction_reason: input.correction_reason ?? null,
                    buyer_name: input.buyer_name ?? null,
                    buyer_email: input.buyer_email ?? null,
                    department_id: input.department_id ?? null,
                    positions: input.positions.map((p, index) => ({ id: id * 10 + index, ...p })),
                    updated_at: now()
                };
                state.invoices.set(String(id), invoice);

                return send(res, 201, invoice);
            }

            if (req.method === 'GET' && pathname === '/invoices.json') {
                let list = [...state.invoices.values()];
                const oid = url.searchParams.get('oid');
                if (oid) list = list.filter((invoice) => String(invoice.oid) === oid);
                const from = url.searchParams.get('date_from');
                const to = url.searchParams.get('date_to');
                if (from) list = list.filter((invoice) => invoice.issue_date >= from);
                if (to) list = list.filter((invoice) => invoice.issue_date <= to);
                list.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
                const perPage = Number(url.searchParams.get('per_page') ?? 100);
                const page = Number(url.searchParams.get('page') ?? 1);

                return send(res, 200, list.slice((page - 1) * perPage, page * perPage));
            }

            if ((match = /^\/invoices\/(\d+)\.json$/.exec(pathname)) && req.method === 'GET') {
                const invoice = state.invoices.get(match[1]);
                return invoice ? send(res, 200, invoice) : send(res, 404, { code: 'error', message: 'Not found' });
            }

            if ((match = /^\/invoices\/(\d+)\.pdf$/.exec(pathname)) && req.method === 'GET') {
                const invoice = state.invoices.get(match[1]);
                if (!invoice) return send(res, 404, { code: 'error', message: 'Not found' });
                const pdf = Buffer.from(`%PDF-1.4 stub ${invoice.number}\n%%EOF`);
                res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length });
                return res.end(pdf);
            }

            // Like the real API, an update may set the `cancelled` flag; the status itself is untouched.
            if ((match = /^\/invoices\/(\d+)\.json$/.exec(pathname)) && req.method === 'PUT') {
                const invoice = state.invoices.get(match[1]);
                if (!invoice) return send(res, 404, { code: 'error', message: 'Not found' });
                Object.assign(invoice, body.invoice ?? {}, { updated_at: now() });
                return send(res, 200, invoice);
            }

            if ((match = /^\/invoices\/(\d+)\/change_status\.json$/.exec(pathname)) && req.method === 'POST') {
                const invoice = state.invoices.get(match[1]);
                if (!invoice) return send(res, 404, { code: 'error', message: 'Not found' });
                const status = url.searchParams.get('status') ?? body.status ?? invoice.status;
                // The real API refuses anything but these four ("status: is invalid", seen 2026-10-14).
                if (!['issued', 'sent', 'paid', 'partial'].includes(status)) return send(res, 422, { code: 'error', message: { status: ['is invalid'] } });
                invoice.status = status;
                invoice.updated_at = now();
                return send(res, 200, invoice);
            }

            if ((match = /^\/invoices\/(\d+)\/send_by_email\.json$/.exec(pathname)) && req.method === 'POST') {
                const invoice = state.invoices.get(match[1]);
                if (!invoice) return send(res, 404, { code: 'error', message: 'Not found' });
                invoice.status = invoice.status === 'issued' ? 'sent' : invoice.status;
                invoice.sent_to = body.email_to ?? invoice.buyer_email ?? null;
                invoice.updated_at = now();
                return send(res, 200, { status: 'ok' });
            }

            // --- clients ----------------------------------------------------------------
            if (req.method === 'GET' && pathname === '/clients.json') {
                const externalId = url.searchParams.get('external_id');
                const list = [...state.clients.values()].filter((client) => !externalId || String(client.external_id) === externalId);
                return send(res, 200, list);
            }

            if (req.method === 'POST' && pathname === '/clients.json') {
                const id = nextId();
                const client = { id, ...(body.client ?? {}), updated_at: now() };
                state.clients.set(String(id), client);
                return send(res, 201, client);
            }

            if ((match = /^\/clients\/(\d+)\.json$/.exec(pathname)) && req.method === 'PUT') {
                const client = state.clients.get(match[1]);
                if (!client) return send(res, 404, { code: 'error', message: 'Not found' });
                Object.assign(client, body.client ?? {}, { updated_at: now() });
                return send(res, 200, client);
            }

            // --- payments and webhooks --------------------------------------------------------
            if (req.method === 'POST' && pathname === '/banking/payments.json') {
                const id = nextId();
                const payment = { id, ...(body.banking_payment ?? {}) };
                state.payments.set(String(id), payment);
                const invoice = state.invoices.get(String(payment.invoice_id));
                if (invoice) {
                    const paid = Number(invoice.paid ?? 0) + Number(payment.price ?? 0);
                    invoice.paid = major(paid);
                    invoice.status = paid >= Number(invoice.price_gross) ? 'paid' : 'partial';
                    invoice.updated_at = now();
                }
                return send(res, 201, payment);
            }

            if (req.method === 'POST' && pathname === '/webhooks.json') {
                const id = nextId();
                const webhook = { id, ...(body.webhook ?? {}) };
                state.webhooks.set(String(id), webhook);
                return send(res, 201, webhook);
            }

            return send(res, 404, { code: 'error', message: 'No such route in the stub' });
        } finally {
            state.inFlight -= 1;
        }
    };

    const server = http.createServer((req, res) => {
        handle(req, res).catch((err) => send(res, 500, { code: 'error', message: String(err?.message ?? err) }));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    return {
        url: `http://127.0.0.1:${port}`,
        apiToken,
        get requests() {
            return state.requests;
        },
        get invoices() {
            return state.invoices;
        },
        get clients() {
            return state.clients;
        },
        get payments() {
            return state.payments;
        },
        get webhooks() {
            return state.webhooks;
        },
        get maxInFlight() {
            return state.maxInFlight;
        },
        set delayMs(value) {
            state.delayMs = value;
        },
        /** The next `times` requests (to `path`, when given) answer `status` with `body`, whatever they are. */
        failNext(status, { times = 1, body, headers, path, method } = {}) {
            for (let i = 0; i < times; i += 1) state.failures.push({ status, body, headers, path, method });
        },
        /** Changes an invoice as a person in InvoiceOcean would, bumping `updated_at`. */
        setInvoice(externalId, patch) {
            const invoice = state.invoices.get(String(externalId));
            Object.assign(invoice, patch, { updated_at: new Date(Date.now() + 1000).toISOString() });
            return invoice;
        },
        get inFlight() {
            return state.inFlight;
        },
        /** Resolves once no request is being handled: after a timed-out call the stub may still be busy. */
        async drained() {
            while (state.inFlight > 0) {
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
        },
        reset() {
            state.requests.length = 0;
            state.failures.length = 0;
            state.delayMs = 0;
            state.maxInFlight = 0;
        },
        close: () => new Promise((resolve) => server.close(resolve))
    };
};
