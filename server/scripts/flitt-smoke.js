#!/usr/bin/env node
/**
 * Smoke test against the real Flitt gateway with whatever config.js holds.
 *
 * Creates one order, prints the hosted checkout URL to pay by hand (test card
 * 4444555566661111 in test mode), then polls the signed status until the
 * order is final or ten minutes pass. Writes nothing to the database; useful
 * for Phase 0 (does our signature work? what does a callback look like?) and
 * for the production smoke test (§19.7 of the plan), where the amount is the
 * smallest sellable one and the payment is refunded afterwards.
 *
 *   node scripts/flitt-smoke.js [amountCents] [currency]
 *
 * Needs FLITT_MERCHANT_ID / FLITT_SECRET_KEY / API_PUBLIC_URL set; FLITT_ENABLED
 * may stay false — the script talks to the gateway directly.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { config } from '../config.js';
import { createFlittClient } from '../lib/integrations/flitt/client.js';
import { parseAdditionalInfo } from '../lib/integrations/flitt/parse.js';
import { mapOrderStatus, isFinal } from '../lib/integrations/flitt/status.js';

const amountCents = Number(process.argv[2] || 100);
const currency = (process.argv[3] || config.payments.flitt.currencies[0] || 'GEL').toUpperCase();
const flitt = config.payments.flitt;

if (!flitt.merchantId || !flitt.secretKey) {
    console.error('FLITT_MERCHANT_ID and FLITT_SECRET_KEY must be set');
    process.exit(2);
}

const client = createFlittClient(() => flitt);
const orderId = `${flitt.orderPrefix}-SMOKE-${Date.now()}`;
const callbackUrl = flitt.callbackUrl ?? 'https://example.invalid/callback';
const returnUrl = flitt.returnUrl ? `${flitt.returnUrl}/smoke/none` : 'https://example.invalid/return';

console.log(`mode=${flitt.mode} merchant=${flitt.merchantId} base=${flitt.apiBaseUrl}`);
console.log(`order_id=${orderId} amount=${amountCents} ${currency}`);
console.log(`callback=${callbackUrl}`);

const created = await client.createCheckoutUrl({
    orderId,
    orderDesc: `I am Georgia smoke test ${orderId}`,
    amountCents,
    currency,
    responseUrl: returnUrl,
    serverCallbackUrl: callbackUrl,
    lifetimeSeconds: 600,
    merchantData: JSON.stringify({ smoke: true }),
    lang: 'en'
});

console.log(`payment_id=${created.payment_id}`);
console.log(`\nOpen and pay:\n${created.checkout_url}\n`);

const deadline = Date.now() + 10 * 60 * 1000;
let last = null;

while (Date.now() < deadline) {
    const status = await client.getOrderStatus({ orderId });
    const line = `${new Date().toISOString()} order_status=${status.order_status} amount=${status.amount} actual=${status.actual_amount || '-'} card=${status.masked_card || '-'} code=${status.response_code || '-'} ${status.response_description || ''}`;

    if (line.slice(25) !== last) {
        console.log(line);
        last = line.slice(25);
    }

    const ours = mapOrderStatus(status.order_status);

    if (isFinal(ours)) {
        const info = parseAdditionalInfo(status.additional_info);
        console.log(`final: ${ours}; is_test=${info.is_test} transaction_id=${info.transaction_id ?? '-'} payment_id=${status.payment_id}`);
        process.exit(0);
    }

    await sleep(5000);
}

console.log('gave up after ten minutes; the order is still open');
process.exit(1);
