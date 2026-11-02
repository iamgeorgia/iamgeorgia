import { defineMachine } from '../stateMachine.js';

/**
 * How a card payment attempt and a provider refund may move.
 *
 * Actors: PROVIDER is a verified status read from the gateway (never a
 * callback's own words); SYSTEM is this server on its own clock (expiry,
 * closing an abandoned attempt); GUEST is the buyer backing out through the
 * cancel link; STAFF is a finance user resolving a mismatch.
 *
 * Money the provider says it took is always accepted, even from a state we
 * had closed: a guest who paid after we expired the attempt locally has still
 * paid, and the ledger must say so. What the table refuses is anything that
 * would *undo* a charge without the provider's word.
 */
export const pspPaymentMachine = defineMachine({
    name: 'PspPayment',
    terminal: ['REVERSED', 'FAILED'],
    transitions: {
        CREATED: {
            REDIRECT_READY: ['SYSTEM'],
            FAILED: ['SYSTEM'],
            // A status read can arrive before the create call's own answer was stored.
            PROCESSING: ['PROVIDER'],
            APPROVED: ['PROVIDER'],
            DECLINED: ['PROVIDER'],
            EXPIRED: ['PROVIDER'],
            MISMATCH: ['PROVIDER']
        },
        REDIRECT_READY: {
            PROCESSING: ['PROVIDER'],
            APPROVED: ['PROVIDER'],
            DECLINED: ['PROVIDER'],
            EXPIRED: ['PROVIDER', 'SYSTEM'],
            MISMATCH: ['PROVIDER'],
            CANCELLED: ['GUEST', 'SYSTEM']
        },
        PROCESSING: {
            APPROVED: ['PROVIDER'],
            DECLINED: ['PROVIDER'],
            EXPIRED: ['PROVIDER'],
            MISMATCH: ['PROVIDER']
        },
        APPROVED: {
            REVERSED: ['PROVIDER']
        },
        MISMATCH: {
            APPROVED: ['STAFF'],
            REVERSED: ['PROVIDER', 'STAFF']
        },
        // Closed on our side; the provider may still report a charge.
        DECLINED: { APPROVED: ['PROVIDER'], MISMATCH: ['PROVIDER'] },
        EXPIRED: { APPROVED: ['PROVIDER'], MISMATCH: ['PROVIDER'] },
        CANCELLED: { APPROVED: ['PROVIDER'], MISMATCH: ['PROVIDER'], EXPIRED: ['PROVIDER'] }
    }
});

export const pspRefundMachine = defineMachine({
    name: 'PspRefund',
    terminal: ['APPROVED', 'DECLINED'],
    transitions: {
        REQUESTED: {
            SUBMITTED: ['SYSTEM'],
            APPROVED: ['PROVIDER'],
            DECLINED: ['PROVIDER'],
            FAILED: ['SYSTEM']
        },
        SUBMITTED: {
            APPROVED: ['PROVIDER'],
            DECLINED: ['PROVIDER'],
            FAILED: ['SYSTEM']
        },
        // A failed submission is retried by the outbox.
        FAILED: {
            SUBMITTED: ['SYSTEM'],
            APPROVED: ['PROVIDER'],
            DECLINED: ['PROVIDER']
        }
    }
});
