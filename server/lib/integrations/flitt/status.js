import { BadGatewayError } from '../../errors.js';

/**
 * Flitt's order vocabulary → the platform's `PspPaymentStatus`, and the small
 * amount of arithmetic that crosses the boundary.
 *
 * Flitt reports `order_status` as one of created, processing, declined,
 * approved, expired, reversed (docs.flitt.com/api/order-parameters). The map
 * here is total: an unknown word is an error, not a guess, because a payment
 * silently left in the wrong state is worse than a loud failure.
 */

export const PSP_PAYMENT_STATUSES = Object.freeze([
    'CREATED',
    'REDIRECT_READY',
    'PROCESSING',
    'APPROVED',
    'DECLINED',
    'EXPIRED',
    'CANCELLED',
    'REVERSED',
    'MISMATCH',
    'FAILED'
]);

const ORDER_STATUS_TO_PSP = Object.freeze({
    created: 'REDIRECT_READY',
    processing: 'PROCESSING',
    approved: 'APPROVED',
    declined: 'DECLINED',
    expired: 'EXPIRED',
    reversed: 'REVERSED'
});

/** `order_status` from Flitt → PspPaymentStatus. Throws on anything undocumented. */
export const mapOrderStatus = (orderStatus) => {
    const mapped = ORDER_STATUS_TO_PSP[String(orderStatus ?? '').trim().toLowerCase()];

    if (!mapped) {
        throw new BadGatewayError(`Flitt reported an unknown order status "${orderStatus}"`, { vendor: 'flitt', reason: 'PROVIDER_STATUS_UNKNOWN' });
    }

    return mapped;
};

/**
 * How far along a payment is. A status fetch or callback that describes an
 * earlier point than the row already holds is stale and must not move the row
 * back: `APPROVED` never becomes `PROCESSING` because an old callback was
 * redelivered. `REVERSED` is the only step past `APPROVED`.
 */
const RANK = Object.freeze({
    CREATED: 0,
    FAILED: 1,
    REDIRECT_READY: 1,
    PROCESSING: 2,
    CANCELLED: 3,
    DECLINED: 4,
    EXPIRED: 4,
    APPROVED: 5,
    MISMATCH: 5,
    REVERSED: 6
});

export const rank = (status) => {
    if (!(status in RANK)) {
        throw new Error(`Unknown PspPaymentStatus "${status}"`);
    }

    return RANK[status];
};

const FINAL = new Set(['APPROVED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'REVERSED', 'MISMATCH', 'FAILED']);

/** No further callback or fetch can change a payment in this state, except APPROVED → REVERSED. */
export const isFinal = (status) => FINAL.has(status);

/** Money the guest could still pay against, i.e. the attempt is not over. */
export const isOpen = (status) => ['CREATED', 'REDIRECT_READY', 'PROCESSING'].includes(status);

/**
 * Flitt amounts are integer minor units sent as strings ("1000") or numbers.
 * Anything else — a decimal, a sign, an empty value — is refused, because a
 * mis-read amount is a wrong ledger entry. `""` maps to null (Flitt sends
 * `actual_amount: ""` on an order nobody has paid yet).
 */
export const toCents = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const text = String(value).trim();

    if (!/^\d{1,12}$/.test(text)) {
        throw new BadGatewayError(`Flitt sent an amount that is not whole minor units: "${text}"`, { vendor: 'flitt', reason: 'PROVIDER_AMOUNT_UNREADABLE' });
    }

    return Number(text);
};

/** `response_code` → integer or null. */
export const toResponseCode = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const n = Number(String(value).trim());

    return Number.isInteger(n) ? n : null;
};

/**
 * `DD.MM.YYYY hh:mm:ss` as Flitt prints `order_time`. The zone is not
 * documented, so the parsed instant is advisory (display and ordering); the
 * ledger stamps `paidAt` from this server's clock when the approval is
 * applied, and the raw string is stored beside it.
 */
export const parseFlittTime = (value) => {
    const match = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(value ?? '').trim());

    if (!match) {
        return null;
    }

    const [, dd, mm, yyyy, hh, mi, ss] = match.map(Number);
    const date = new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi, ss));

    return Number.isNaN(date.getTime()) ? null : date;
};
