import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildInstalments, cancellationTarget, deriveStatus, distribute } from '../services/finance/ledger.service.js';

const anchors = { CONFIRMATION: '2026-10-09', ARRIVAL: '2026-12-20', DEPARTURE: '2026-12-23' };
const tz = 'Asia/Tbilisi';

describe('finance ledger — instalments', () => {
    it("splits the client's example: 30% three days after confirmation, the rest seven days before arrival", () => {
        const rows = buildInstalments({
            milestones: [
                { kind: 'DEPOSIT', basis: 'PERCENT', value: 3000, anchor: 'CONFIRMATION', offsetDays: 3 },
                { kind: 'BALANCE', anchor: 'ARRIVAL', offsetDays: -7 }
            ],
            amountCents: 48_000,
            anchors,
            timezone: tz,
            cutoffTime: '10:00'
        });

        assert.deepEqual(
            rows.map(({ sequence, kind, amountCents }) => ({ sequence, kind, amountCents })),
            [
                { sequence: 1, kind: 'DEPOSIT', amountCents: 14_400 },
                { sequence: 2, kind: 'BALANCE', amountCents: 33_600 }
            ]
        );
        // 10:00 in Tbilisi (UTC+4, no daylight saving) is 06:00 UTC.
        assert.equal(rows[0].dueAt.toISOString(), '2026-10-12T06:00:00.000Z');
        assert.equal(rows[1].dueAt.toISOString(), '2026-12-13T06:00:00.000Z');
    });

    it('rounds the deposit and gives the balance the remainder, so the parts add up exactly', () => {
        const rows = buildInstalments({
            milestones: [
                { kind: 'DEPOSIT', basis: 'PERCENT', value: 3333, anchor: 'CONFIRMATION', offsetDays: 0 },
                { kind: 'BALANCE', anchor: 'ARRIVAL', offsetDays: 0 }
            ],
            amountCents: 10_001,
            anchors,
            timezone: tz,
            cutoffTime: '10:00'
        });

        assert.equal(rows[0].amountCents, 3333);
        assert.equal(rows[0].amountCents + rows[1].amountCents, 10_001);
    });

    it('caps a fixed deposit at the whole, and drops a deposit that comes to nothing', () => {
        const capped = buildInstalments({
            milestones: [
                { kind: 'DEPOSIT', basis: 'FIXED', value: 99_999, anchor: 'CONFIRMATION', offsetDays: 0 },
                { kind: 'BALANCE', anchor: 'ARRIVAL', offsetDays: 0 }
            ],
            amountCents: 5_000,
            anchors,
            timezone: tz,
            cutoffTime: '10:00'
        });

        assert.equal(capped.length, 1, 'the deposit took everything, and an empty balance is not an instalment');
        assert.equal(capped[0].kind, 'DEPOSIT');

        const tiny = buildInstalments({
            milestones: [
                { kind: 'DEPOSIT', basis: 'PERCENT', value: 1, anchor: 'CONFIRMATION', offsetDays: 0 },
                { kind: 'BALANCE', anchor: 'ARRIVAL', offsetDays: 0 }
            ],
            amountCents: 10,
            anchors,
            timezone: tz,
            cutoffTime: '10:00'
        });

        assert.deepEqual(tiny.map((row) => row.kind), ['BALANCE']);
        assert.equal(tiny[0].sequence, 1);
    });

    it('makes one undated balance for a supplier with no terms', () => {
        const rows = buildInstalments({ milestones: [], amountCents: 7_000, anchors, timezone: tz, cutoffTime: '10:00' });

        assert.deepEqual(rows, [{ sequence: 1, kind: 'BALANCE', amountCents: 7_000, dueAt: null }]);
    });
});

describe('finance ledger — statuses and spreading', () => {
    it('reads a status off the two numbers, and keeps a waiver', () => {
        assert.equal(deriveStatus({ amountCents: 100, paidCents: 0 }), 'OPEN');
        assert.equal(deriveStatus({ amountCents: 100, paidCents: 40 }), 'PARTIAL');
        assert.equal(deriveStatus({ amountCents: 100, paidCents: 100 }), 'PAID');
        assert.equal(deriveStatus({ amountCents: 0, paidCents: 0 }), 'VOID');
        assert.equal(deriveStatus({ amountCents: 0, paidCents: 50 }), 'PAID', 'overpaid after a cancellation: a refund is due');
        assert.equal(deriveStatus({ amountCents: 100, paidCents: 0, current: 'WAIVED' }), 'WAIVED');
    });

    it('takes a reduction from the balance before the deposit', () => {
        const instalments = [
            { id: 'b', sequence: 2, originalAmountCents: 700, amountCents: 700, paidCents: 0 },
            { id: 'a', sequence: 1, originalAmountCents: 300, amountCents: 300, paidCents: 300 }
        ];

        assert.deepEqual(
            distribute(instalments, 500).map(({ id, amountCents }) => ({ id, amountCents })),
            [
                { id: 'a', amountCents: 300 },
                { id: 'b', amountCents: 200 }
            ]
        );
        assert.deepEqual(distribute(instalments, 1000).map((i) => i.amountCents), [300, 700], 'restores the schedule');
        assert.deepEqual(distribute(instalments, 0).map((i) => i.amountCents), [0, 0]);
    });
});

describe('finance ledger — what a supplier is owed after a cancellation (D6)', () => {
    // Net 1,000 GEL, sold for 1,150; cancelled with a 50% charge of 575.
    const example = { chargeCents: 57_500, buyerTotalCents: 115_000, netCents: 100_000 };

    it('owes the same share of the net when the supplier is PROPORTIONAL', () => {
        assert.equal(cancellationTarget({ ...example, liability: 'PROPORTIONAL' }), 50_000);
        assert.equal(cancellationTarget({ ...example, chargeCents: 0, liability: 'PROPORTIONAL' }), 0);
        assert.equal(cancellationTarget({ ...example, chargeCents: 115_000, liability: 'PROPORTIONAL' }), 100_000);
    });

    it('owes nothing unless the booking was charged in full, for NONE_UNLESS_NON_REFUNDABLE', () => {
        assert.equal(cancellationTarget({ ...example, liability: 'NONE_UNLESS_NON_REFUNDABLE' }), 0);
        assert.equal(cancellationTarget({ ...example, chargeCents: 115_000, liability: 'NONE_UNLESS_NON_REFUNDABLE' }), 100_000);
    });

    it('stops at what was already paid for MANUAL, leaving the rest to Finance', () => {
        assert.equal(cancellationTarget({ ...example, liability: 'MANUAL', paidCents: 30_000 }), 30_000);
        assert.equal(cancellationTarget({ ...example, liability: 'MANUAL', paidCents: 0 }), 0);
    });

    it('defaults to PROPORTIONAL and never owes more than the net', () => {
        assert.equal(cancellationTarget(example), 50_000);
        assert.equal(cancellationTarget({ ...example, chargeCents: 999_999 }), 100_000);
        assert.equal(cancellationTarget({ ...example, buyerTotalCents: 0 }), 0);
    });
});
