import http from 'node:http';

import { sign, verify } from '../../lib/integrations/flitt/signature.js';

/**
 * A stand-in for Flitt's merchant API, in memory, for the client and flow tests.
 *
 * Speaks the endpoints the client uses — checkout/url, checkout/token,
 * status/order_id, reverse/order_id, capture/order_id — with the field names
 * and envelope the real API uses, checks the signature on every request the
 * way the gateway does (1014), refuses duplicate order ids (1013) and unknown
 * orders (1018), and signs its answers with the same key. Orders start
 * `created`; a test moves them with `stub.approve()`, `stub.decline()` or
 * `stub.setOrderStatus()`, and can ask for the signed callback body Flitt
 * would send with `stub.callbackFor()`.
 *
 * Failure is injected with `stub.failNext(...)` and slowness with
 * `stub.delayMs`, so the retry and timeout paths can be driven on purpose.
 *
 *   const stub = await startFlittStub();
 *   Object.assign(config.payments.flitt, { enabled: true, apiBaseUrl: stub.url, merchantId: stub.merchantId, secretKey: stub.secretKey });
 *   …
 *   await stub.close();
 */
export const startFlittStub = async ({ merchantId = 1549901, secretKey = 'test' } = {}) => {
    const state = {
        merchantId,
        secretKey,
        requests: [],
        orders: new Map(),
        failures: [],
        delayMs: 0,
        nextPaymentId: 900_000_000 + Math.floor(Math.random() * 90_000_000),
        nextTransactionId: 2_000_000_000 + Math.floor(Math.random() * 90_000_000)
    };

    const stamp = () => {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');

        return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
    };

    const readBody = (req) =>
        new Promise((resolve) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => resolve(data));
        });

    const send = (res, status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(payload === undefined ? '' : JSON.stringify(payload));
    };

    const failure = (res, errorCode, errorMessage) =>
        send(res, 200, { response: { error_code: errorCode, error_message: errorMessage, request_id: `stub-${state.requests.length}`, response_status: 'failure' } });

    /** The order as a status/callback document, signed. Mirrors a real answer field for field. */
    const orderDocument = (order) => {
        const info = {
            capture_status: order.capture_status ?? null,
            capture_amount: order.capture_amount ?? null,
            reservation_data: '{}',
            transaction_id: order.transaction_id ?? null,
            bank_response_code: null,
            bank_response_description: null,
            client_fee: 0.0,
            settlement_fee: 0.0,
            bank_name: null,
            bank_country: null,
            card_type: order.card_type || null,
            card_product: order.card_type ? 'empty_visa' : null,
            card_category: null,
            timeend: order.timeend ?? null,
            ipaddress_v4: '127.0.0.1',
            payment_method: order.payment_system || null,
            version_3ds: order.order_status === 'approved' ? 1 : null,
            is_test: true
        };

        const doc = {
            rrn: order.rrn ?? '',
            masked_card: order.masked_card ?? '',
            sender_cell_phone: '',
            sender_account: '',
            currency: order.currency,
            fee: '',
            reversal_amount: String(order.reversal_amount ?? 0),
            settlement_amount: '0',
            actual_amount: order.actual_amount ?? '',
            response_description: order.response_description ?? '',
            sender_email: order.sender_email ?? '',
            order_status: order.order_status,
            response_status: 'success',
            order_time: order.order_time,
            actual_currency: order.actual_currency ?? '',
            order_id: order.order_id,
            tran_type: 'purchase',
            eci: order.eci ?? '',
            settlement_date: '',
            payment_system: order.payment_system ?? '',
            approval_code: order.approval_code ?? '',
            merchant_id: state.merchantId,
            settlement_currency: '',
            payment_id: order.payment_id,
            card_bin: order.card_bin ?? '',
            response_code: order.response_code ?? '',
            card_type: order.card_type ?? '',
            amount: String(order.amount),
            product_id: order.product_id ?? '',
            merchant_data: order.merchant_data ?? '',
            rectoken: '',
            rectoken_lifetime: '',
            verification_status: '',
            parent_order_id: '',
            fee_oplata: '0',
            additional_info: JSON.stringify(info)
        };

        return { ...doc, signature: sign(state.secretKey, doc) };
    };

    const handle = async (req, res) => {
        const url = new URL(req.url, 'http://stub');
        const raw = await readBody(req);
        let request = null;

        try {
            request = JSON.parse(raw)?.request ?? null;
        } catch {
            request = null;
        }

        const entry = { method: req.method, path: url.pathname, request };
        state.requests.push(entry);

        try {
            if (state.delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, state.delayMs));
            }

            const at = state.failures.findIndex((f) => !f.path || f.path === url.pathname);
            const injected = at >= 0 ? state.failures.splice(at, 1)[0] : null;

            if (injected) {
                if (injected.body !== undefined) return send(res, injected.status, injected.body);
                return send(res, injected.status, { error: 'injected failure' });
            }

            if (req.method !== 'POST' || !request || typeof request !== 'object') {
                return failure(res, 1010, 'Request Is empty');
            }

            if (String(request.merchant_id) !== String(state.merchantId)) {
                return failure(res, 1016, `Merchant \`${request.merchant_id}\` not found`);
            }

            if (!verify(state.secretKey, request)) {
                return failure(res, 1014, 'Invalid signature');
            }

            const orderId = request.order_id;

            switch (url.pathname) {
                case '/api/checkout/url':
                case '/api/checkout/token': {
                    if (request.amount === undefined || request.amount === '') return failure(res, 1011, 'Parameter `amount` is missing');
                    if (!request.currency) return failure(res, 1011, 'Parameter `currency` is missing');
                    if (!orderId) return failure(res, 1011, 'Parameter `order_id` is missing');
                    if (state.orders.has(orderId)) return failure(res, 1013, `Duplicate order \`${orderId}\` for merchant \`${state.merchantId}\``);
                    if (!['GEL', 'USD', 'EUR'].includes(request.currency)) return failure(res, 1012, `Currency \`${request.currency}\` is not available for this merchant \`${state.merchantId}\``);

                    const paymentId = String(state.nextPaymentId++);
                    const token = `stub${paymentId}${Math.random().toString(16).slice(2, 10)}`;

                    state.orders.set(orderId, {
                        order_id: orderId,
                        payment_id: Number(paymentId),
                        amount: String(request.amount),
                        currency: request.currency,
                        order_status: 'created',
                        order_time: stamp(),
                        merchant_data: request.merchant_data ?? '',
                        product_id: request.product_id ?? '',
                        sender_email: request.sender_email ?? '',
                        reversal_amount: 0,
                        lifetime: Number(request.lifetime ?? 36000),
                        response_url: request.response_url ?? null,
                        server_callback_url: request.server_callback_url ?? null,
                        token
                    });

                    return url.pathname === '/api/checkout/token'
                        ? send(res, 200, { response: { token, response_status: 'success' } })
                        : send(res, 200, { response: { checkout_url: `${state.url}/merchants/stub/default/index.html?token=${token}`, payment_id: paymentId, response_status: 'success' } });
                }

                case '/api/status/order_id': {
                    const order = state.orders.get(orderId);
                    if (!order) return failure(res, 1018, 'Order not found');

                    return send(res, 200, { response: orderDocument(order) });
                }

                case '/api/reverse/order_id': {
                    const order = state.orders.get(orderId);
                    if (!order) return failure(res, 1018, 'Order not found');

                    const amount = Number(request.amount);
                    const charged = Number(order.actual_amount || 0);
                    const reversed = Number(order.reversal_amount || 0);

                    if (order.order_status !== 'approved' && order.order_status !== 'reversed') return failure(res, 1100, 'Operation not allowed');
                    if (!Number.isInteger(amount) || amount <= 0 || amount + reversed > charged) return failure(res, 1023, 'Invalid amount');

                    if (request.reverse_id && order.reversals?.has(request.reverse_id)) {
                        const prior = order.reversals.get(request.reverse_id);
                        return send(res, 200, { response: { ...prior, signature: sign(state.secretKey, prior) } });
                    }

                    const outcome = state.reverseOutcome === 'declined' ? 'declined' : 'approved';
                    const body = {
                        reverse_status: outcome,
                        order_id: orderId,
                        response_description: outcome === 'declined' ? 'Reverse not allowed. Turnover is not enough.' : '',
                        response_code: outcome === 'declined' ? 1069 : '',
                        merchant_id: state.merchantId,
                        response_status: 'success',
                        reverse_id: request.reverse_id ?? '',
                        reversal_amount: String(outcome === 'approved' ? reversed + amount : reversed),
                        transaction_id: String(state.nextTransactionId++)
                    };

                    if (outcome === 'approved') {
                        order.reversal_amount = reversed + amount;
                        if (order.reversal_amount >= charged) order.order_status = 'reversed';
                    }

                    order.reversals ??= new Map();
                    if (request.reverse_id) order.reversals.set(request.reverse_id, body);

                    return send(res, 200, { response: { ...body, signature: sign(state.secretKey, body) } });
                }

                case '/api/capture/order_id': {
                    const order = state.orders.get(orderId);
                    if (!order) return failure(res, 1018, 'Order not found');

                    order.capture_status = 'captured';
                    order.capture_amount = Number(request.amount);

                    return send(res, 200, { response: { capture_status: 'captured', order_id: orderId, response_description: '', response_code: '', merchant_id: state.merchantId, response_status: 'success' } });
                }

                default:
                    return send(res, 404, { error: 'no such endpoint' });
            }
        } catch (err) {
            return send(res, 500, { error: String(err?.message ?? err) });
        }
    };

    const server = http.createServer((req, res) => {
        handle(req, res).catch((err) => send(res, 500, { error: String(err?.message ?? err) }));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    state.url = `http://127.0.0.1:${server.address().port}`;

    const orderOrThrow = (orderId) => {
        const order = state.orders.get(orderId);
        if (!order) throw new Error(`flitt stub: no order ${orderId}`);
        return order;
    };

    return {
        url: state.url,
        merchantId,
        secretKey,
        get requests() {
            return state.requests;
        },
        get orders() {
            return state.orders;
        },
        set delayMs(value) {
            state.delayMs = value;
        },
        set reverseOutcome(value) {
            state.reverseOutcome = value;
        },
        /** Queue an HTTP-level failure for the next matching request. */
        failNext(status, { times = 1, body, path } = {}) {
            for (let i = 0; i < times; i += 1) state.failures.push({ status, body, path });
        },
        /** Overwrite any fields of an order's document (`order_status`, `amount`, `currency`, …). */
        setOrderStatus(orderId, patch) {
            Object.assign(orderOrThrow(orderId), patch);
        },
        /** The guest paid: approved, with card details as the gateway reports them. */
        approve(orderId, { cardType = 'VISA', maskedCard = '444455XXXXXX1111', cardBin = 444455, amount, currency } = {}) {
            const order = orderOrThrow(orderId);
            Object.assign(order, {
                order_status: 'approved',
                actual_amount: amount !== undefined ? String(amount) : order.amount,
                actual_currency: currency ?? order.currency,
                masked_card: maskedCard,
                card_bin: cardBin,
                card_type: cardType,
                rrn: '111111111111',
                approval_code: '123456',
                eci: '5',
                payment_system: 'card',
                transaction_id: state.nextTransactionId++,
                timeend: stamp()
            });
            return order;
        },
        /** The bank said no: declined with a response code. */
        decline(orderId, { code = 1000, description = 'General decline', cardType = 'VISA', maskedCard = '444411XXXXXX6666' } = {}) {
            const order = orderOrThrow(orderId);
            Object.assign(order, { order_status: 'declined', response_code: code, response_description: description, masked_card: maskedCard, card_type: cardType, card_bin: 444411, payment_system: 'card' });
            return order;
        },
        expire(orderId) {
            Object.assign(orderOrThrow(orderId), { order_status: 'expired' });
        },
        /** The JSON Flitt would POST to `server_callback_url` for this order right now. */
        callbackFor(orderId) {
            return JSON.stringify(orderDocument(orderOrThrow(orderId)));
        },
        /** The order document, parsed, for assertions. */
        documentFor(orderId) {
            return orderDocument(orderOrThrow(orderId));
        },
        reset() {
            state.requests.length = 0;
            state.orders.clear();
            state.failures.length = 0;
            state.delayMs = 0;
            state.reverseOutcome = 'approved';
        },
        close() {
            return new Promise((resolve) => server.close(() => resolve()));
        }
    };
};
