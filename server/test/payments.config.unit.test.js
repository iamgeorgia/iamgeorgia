import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertPaymentsConfig, FLITT_PUBLIC_TEST_MERCHANT_ID } from '../config.js';

/**
 * The boot-time guard on card payment configuration: the combinations that
 * must never start, and the ones that must. Pure; no database.
 */

const base = () => ({
    enabled: true,
    mode: 'test',
    merchantId: FLITT_PUBLIC_TEST_MERCHANT_ID,
    secretKey: 'test',
    apiBaseUrl: 'https://pay.flitt.com',
    callbackUrl: 'https://api.preview.iamgeorgia.com.ge/api/payments/flitt/callback',
    returnUrl: 'https://api.preview.iamgeorgia.com.ge/api/payments/flitt/return',
    returnTokenSecret: 'x'.repeat(40),
    orderPrefix: 'IAGT',
    orderLifetimeSeconds: 1800,
    requestTimeoutMs: 15_000,
    currencies: ['GEL'],
    callbackIps: ['54.154.216.60'],
    callbackIpEnforce: false,
    reuseWindowSeconds: 120,
    statusPollMinSeconds: 5,
    createLimitPer10Min: 10,
    sweepIntervalMs: 60_000,
    designId: null,
    testMerchantIds: [FLITT_PUBLIC_TEST_MERCHANT_ID],
    allowTestModeWhenDeployed: false
});

const rejects = (patch, pattern, options) => assert.throws(() => assertPaymentsConfig({ ...base(), ...patch }, options), pattern);

describe('payments config guard', () => {
    it('accepts test mode on a developer machine and, with the flag, on the preview host', () => {
        assert.doesNotThrow(() => assertPaymentsConfig(base(), { deployed: false }));
        assert.doesNotThrow(() => assertPaymentsConfig({ ...base(), allowTestModeWhenDeployed: true }, { deployed: true }));
    });

    it('accepts live mode only on a deployed host with a real merchant and key', () => {
        const live = { mode: 'live', merchantId: 7_000_001, secretKey: 'a-real-payment-key' };

        assert.doesNotThrow(() => assertPaymentsConfig({ ...base(), ...live }, { deployed: true }));
        rejects(live, /not accepted in development/, { deployed: false });
    });

    it('does nothing beyond shape checks while disabled', () => {
        assert.doesNotThrow(() => assertPaymentsConfig({ ...base(), enabled: false, merchantId: null, secretKey: null, callbackUrl: null, returnUrl: null, returnTokenSecret: null }));
        rejects({ enabled: false, mode: 'sandbox' }, /FLITT_MODE must be one of/);
        rejects({ enabled: false, currencies: ['gel'] }, /FLITT_CURRENCIES/);
        rejects({ enabled: false, orderPrefix: 'bad prefix!' }, /FLITT_ORDER_PREFIX/);
        rejects({ enabled: false, orderLifetimeSeconds: 10 }, /FLITT_ORDER_LIFETIME_SECONDS/);
    });

    it('refuses a live-looking merchant in test mode', () => {
        rejects({ merchantId: 7_000_001 }, /FLITT_MODE=test only accepts/);
    });

    it('accepts the owner\'s own merchant in test mode when listed', () => {
        assert.doesNotThrow(() => assertPaymentsConfig({ ...base(), merchantId: 7_000_001, secretKey: 'own-test-key', testMerchantIds: [FLITT_PUBLIC_TEST_MERCHANT_ID, 7_000_001] }));
    });

    it('refuses test mode on a deployed host without the explicit flag', () => {
        rejects({}, /FLITT_ALLOW_TEST_MODE_WHEN_DEPLOYED/, { deployed: true });
    });

    it('refuses the test merchant or the test key in live mode', () => {
        rejects({ mode: 'live', merchantId: FLITT_PUBLIC_TEST_MERCHANT_ID, secretKey: 'real' }, /refuses the test merchant/, { deployed: true });
        rejects({ mode: 'live', merchantId: 7_000_001, secretKey: 'test' }, /refuses the test merchant/, { deployed: true });
    });

    it('names every missing value when enabled', () => {
        rejects({ merchantId: null, secretKey: null, callbackUrl: null }, /FLITT_ENABLED=true needs FLITT_MERCHANT_ID, FLITT_SECRET_KEY, API_PUBLIC_URL or FLITT_CALLBACK_URL/);
    });

    it('requires https callback and return URLs and a long token secret when deployed', () => {
        rejects({ callbackUrl: 'http://api.example/cb', allowTestModeWhenDeployed: true }, /must be https/, { deployed: true });
        rejects({ returnTokenSecret: 'short', allowTestModeWhenDeployed: true }, /at least 32 characters/, { deployed: true });
        rejects({ returnUrl: 'not a url' }, /is not a URL/);
        assert.doesNotThrow(() => assertPaymentsConfig({ ...base(), callbackUrl: 'http://localhost:5000/cb', returnUrl: 'http://localhost:5000/r' }, { deployed: false }));
    });
});
