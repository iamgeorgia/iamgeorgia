/**
 * Payment rules: what a `PaymentPolicy` means for a guest at checkout.
 *
 * The owner's decision of 2026-11-03 (docs/plans/FLITT_INTEGRATION_PLAN.md
 * §4.4): whether a card is required, offered or absent — and how long an
 * unpaid booking survives — is a property of the item sold, carried by its
 * payment policy. This file is the one reading of that policy, shared by the
 * offer payloads (what the checkout shows), `createPayment` (what the API
 * accepts) and the sweeper (what gets cancelled). Pure: no database.
 *
 * `DEPOSIT` is read as `PAY_NOW` for the full amount until the deposit flow
 * exists (OD6b); the admin form says so.
 */

/** Stricter rules win when an order mixes items. */
const STRICTNESS = Object.freeze({ PAY_NOW: 3, DEPOSIT: 3, PAY_LATER: 2, PAY_AT_HOTEL: 1, CREDIT_ACCOUNT: 0 });

/** What applies when an item has no policy of its own and no template is seeded. */
export const DEFAULT_TIMING = Object.freeze({
    HOTEL: 'PAY_LATER',
    TOUR: 'PAY_LATER',
    SERVICE: 'PAY_LATER',
    TRANSFER: 'PAY_AT_HOTEL',
    PACKAGE: 'PAY_LATER'
});

const requiresCard = (timing) => timing === 'PAY_NOW' || timing === 'DEPOSIT';

/** `{ timing, unpaidCancelHours, cardOptional }` from a policy row, or the product default. */
export const ruleFrom = (policy, product = 'HOTEL') => ({
    timing: policy?.timing ?? DEFAULT_TIMING[product] ?? 'PAY_LATER',
    unpaidCancelHours: policy?.unpaidCancelHours ?? null,
    cardOptional: Boolean(policy?.cardOptional),
    policyName: policy?.name ?? null
});

/**
 * One rule for several items: the strictest timing; the shortest unpaid
 * timeout among the items that require a card; card optional if any item
 * allows it. An empty list falls back to the product default.
 */
export const resolvePaymentRule = (rules, { product = 'PACKAGE' } = {}) => {
    const list = rules.filter(Boolean);

    if (list.length === 0) {
        return ruleFrom(null, product);
    }

    const timing = list.reduce((best, rule) => (STRICTNESS[rule.timing] > STRICTNESS[best] ? rule.timing : best), list[0].timing);
    const hours = list.filter((rule) => requiresCard(rule.timing)).map((rule) => rule.unpaidCancelHours).filter((h) => Number.isInteger(h) && h > 0);

    return {
        timing,
        unpaidCancelHours: hours.length > 0 ? Math.min(...hours) : null,
        cardOptional: list.some((rule) => rule.cardOptional),
        policyName: list.find((rule) => rule.timing === timing)?.policyName ?? null
    };
};

/**
 * What the checkout may offer this buyer under this rule.
 *
 *   card      — "pay securely by card" is shown
 *   later     — "pay later / at the property" is shown
 *   required  — card is the only way (PAY_NOW, DEPOSIT)
 *
 * A partner never pays by card here (its terms apply), and with the gateway
 * off every rule degrades to pay-later so nothing is blocked.
 */
export const paymentOptionsFor = (rule, { paymentsEnabled = false, partner = false } = {}) => {
    if (partner || !paymentsEnabled || rule.timing === 'CREDIT_ACCOUNT') {
        return { card: false, later: true, required: false, timing: rule.timing };
    }

    if (requiresCard(rule.timing)) {
        return { card: true, later: false, required: true, timing: rule.timing };
    }

    if (rule.timing === 'PAY_AT_HOTEL') {
        return { card: rule.cardOptional, later: true, required: false, timing: rule.timing };
    }

    return { card: true, later: true, required: false, timing: rule.timing };
};

/**
 * When an unpaid booking under this rule is cancelled: PAY_NOW guests only,
 * only while the gateway is on (a rule nobody can satisfy must not cancel
 * anyone), and only when the policy names a timeout. Counted from the
 * moment the receivable opened — confirmation, not request — so an
 * on-request tour confirmed days later gets its full window.
 */
export const autoCancelAtFor = (rule, { from, paymentsEnabled = false, partner = false } = {}) => {
    if (partner || !paymentsEnabled || !requiresCard(rule.timing)) {
        return null;
    }

    if (!Number.isInteger(rule.unpaidCancelHours) || rule.unpaidCancelHours <= 0) {
        return null;
    }

    return new Date((from ?? new Date()).getTime() + rule.unpaidCancelHours * 3_600_000);
};

/**
 * The rule as a checkout or a booking page reads it: the timing, the words,
 * and what may be offered to this buyer right now.
 */
export const ruleSummary = (rule, { paymentsEnabled = false, partner = false } = {}) => ({
    timing: rule.timing,
    unpaidCancelHours: rule.unpaidCancelHours ?? null,
    cardOptional: Boolean(rule.cardOptional),
    policyName: rule.policyName ?? null,
    options: paymentOptionsFor(rule, { paymentsEnabled, partner })
});

/** True when a card payment may be created against a receivable frozen under this timing. */
export const cardAllowedFor = (timing, { cardOptional = false } = {}) => {
    if (!timing) return true;
    if (timing === 'CREDIT_ACCOUNT') return false;
    if (timing === 'PAY_AT_HOTEL') return cardOptional;

    return true;
};
