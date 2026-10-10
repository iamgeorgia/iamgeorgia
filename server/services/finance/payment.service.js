import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { lockRows } from '../../lib/locks.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { deriveStatus } from './ledger.service.js';

/**
 * Money that actually moved, and what it settled.
 *
 * A payment is one row; how much of it went to which receivable or supplier
 * instalment is a set of allocations. Four kinds of movement, each with one
 * kind of target:
 *
 *   IN  + PAYMENT — a buyer pays us              → receivables, positive
 *   OUT + PAYMENT — we pay a supplier            → instalments, positive
 *   OUT + REFUND  — we give a buyer money back   → receivables, negative
 *   IN  + REFUND  — a supplier gives us money back → instalments, negative
 *
 * Every target is locked (`SELECT … FOR UPDATE`, in id order so two payments
 * never wait on each other in opposite orders) before its outstanding amount
 * is read, so two payments recorded at once against one receivable settle
 * one after the other and can never both take the same last lari.
 */

const SETTLEABLE = ['OPEN', 'PARTIAL'];

const targetKind = ({ direction, kind }) =>
    (direction === 'IN') === (kind === 'PAYMENT') ? 'RECEIVABLE' : 'INSTALMENT';

const sign = ({ kind }) => (kind === 'REFUND' ? -1 : 1);

const money = (cents, currency) => `${(cents / 100).toFixed(2)} ${currency}`;

export const paymentInclude = {
    allocations: {
        include: {
            receivable: { select: { id: true, reference: true, debtorName: true, currency: true } },
            payableInstalment: {
                select: {
                    id: true,
                    sequence: true,
                    kind: true,
                    payable: { select: { id: true, bookingReference: true, product: true, currency: true } }
                }
            }
        },
        orderBy: { createdAt: 'asc' }
    },
    counterpartyPartner: { select: { id: true, name: true, reference: true } },
    recordedByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
    attachmentAsset: { select: { id: true, originalFilename: true, mimeType: true } }
};

/**
 * Recomputes a payable from its instalments after money moved on one of them.
 *
 * The payable row is locked first: two payments on different instalments of
 * one payable lock only their own instalments, and without this each would
 * sum the instalments as it saw them and the later commit would overwrite
 * the earlier one's total with a stale one.
 */
const recomputePayable = async (tx, payableId) => {
    await lockRows(tx, 'supplier_payables', [payableId]);
    const payable = await tx.supplierPayable.findUnique({ where: { id: payableId }, include: { instalments: true } });
    const paidCents = payable.instalments.reduce((sum, i) => sum + i.paidCents, 0);
    const status = deriveStatus({ amountCents: payable.amountCents, paidCents, current: payable.status });
    const open = payable.instalments.filter((i) => SETTLEABLE.includes(i.status) && i.dueAt);

    await tx.supplierPayable.update({
        where: { id: payableId },
        data: {
            paidCents,
            status,
            voidedAt: status === 'VOID' ? payable.voidedAt ?? new Date() : null,
            nextDueAt: open.map((i) => i.dueAt).sort((a, b) => a - b)[0] ?? null
        }
    });
};

/**
 * Candidates for "settle the oldest first": everything still open for one
 * debtor or supplier in the payment's currency, earliest due first, undated
 * last, then oldest.
 */
const oldestDue = async (tx, input, target) => {
    if (target === 'RECEIVABLE') {
        const rows = await tx.receivable.findMany({
            where: { debtorPartnerId: input.allocate.partnerId, currency: input.currency, status: { in: SETTLEABLE } },
            orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
            select: { id: true }
        });
        return rows.map(({ id }) => ({ receivableId: id }));
    }

    const rows = await tx.payableInstalment.findMany({
        where: {
            status: { in: SETTLEABLE },
            payable: { supplierPartnerId: input.allocate.partnerId, currency: input.currency, status: { in: SETTLEABLE } }
        },
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { sequence: 'asc' }],
        select: { id: true }
    });
    return rows.map(({ id }) => ({ payableInstalmentId: id }));
};

const loadTargets = async (tx, target, ids) =>
    target === 'RECEIVABLE'
        ? tx.receivable.findMany({ where: { id: { in: ids } } })
        : tx.payableInstalment.findMany({ where: { id: { in: ids } }, include: { payable: true } });

/**
 * Works out each allocation against the locked rows: explicit ones checked,
 * automatic ones filled oldest first until the money runs out.
 */
const planAllocations = async (tx, input, target) => {
    const explicit = input.allocations ?? [];
    const requested = explicit.length > 0 ? explicit : input.allocate ? await oldestDue(tx, input, target) : [];
    const idOf = (row) => (target === 'RECEIVABLE' ? row.receivableId : row.payableInstalmentId);

    for (const row of requested) {
        if (!idOf(row)) {
            throw new UnprocessableEntityError(
                target === 'RECEIVABLE' ? 'This payment settles receivables' : 'This payment settles supplier instalments',
                { reason: 'WRONG_TARGET' }
            );
        }
    }

    const ids = requested.map(idOf);

    // One line per target. The schema refuses a request that names the same
    // item twice; this is the net beneath it, because two lines for one row
    // would each be checked against the same snapshot and the second update
    // would overwrite the first.
    if (new Set(ids).size !== ids.length) {
        throw new UnprocessableEntityError('An item may be named once per payment', { reason: 'DUPLICATE_TARGET' });
    }

    await lockRows(tx, target === 'RECEIVABLE' ? 'receivables' : 'payable_instalments', ids);
    const rows = new Map((await loadTargets(tx, target, ids)).map((row) => [row.id, row]));

    let left = input.amountCents;
    const plan = [];

    for (const entry of requested) {
        const row = rows.get(idOf(entry));

        if (!row) {
            throw new NotFoundError('One of the allocations names something that does not exist', { id: idOf(entry) });
        }

        const currency = target === 'RECEIVABLE' ? row.currency : row.payable.currency;

        if (currency !== input.currency) {
            throw new UnprocessableEntityError('A payment settles items in its own currency only', {
                reason: 'CURRENCY_MISMATCH',
                id: row.id,
                expected: currency
            });
        }

        // Money from one party settles that party's items. When the caller
        // names the payer or payee, every explicit target must belong to it;
        // a guest's receivable has no partner and so matches none.
        const party = target === 'RECEIVABLE' ? row.debtorPartnerId : row.payable.supplierPartnerId;

        if (explicit.length > 0 && input.counterpartyPartnerId && party !== input.counterpartyPartnerId) {
            throw new UnprocessableEntityError('That item belongs to a different party than the payment names', {
                reason: 'COUNTERPARTY_MISMATCH',
                id: row.id,
                partnerId: party ?? null
            });
        }

        // How much this row can take: what is outstanding for a payment, what
        // was paid for a refund.
        const room = input.kind === 'REFUND' ? row.paidCents : Math.max(0, row.amountCents - row.paidCents);
        const statusOk = input.kind === 'REFUND' ? row.paidCents > 0 : SETTLEABLE.includes(row.status);

        if (explicit.length > 0) {
            if (!statusOk) {
                throw new ConflictError(input.kind === 'REFUND' ? 'Nothing has been paid on that item to refund' : 'That item is not open for payment', {
                    reason: 'NOT_SETTLEABLE',
                    id: row.id,
                    status: row.status
                });
            }

            if (entry.amountCents > room) {
                throw new UnprocessableEntityError('An allocation is more than that item can take', {
                    reason: 'ALLOCATION_EXCEEDS_OUTSTANDING',
                    id: row.id,
                    availableCents: room
                });
            }

            plan.push({ row, cents: entry.amountCents });
            left -= entry.amountCents;
            continue;
        }

        if (left <= 0) break;
        const cents = Math.min(room, left);
        if (cents > 0) {
            plan.push({ row, cents });
            left -= cents;
        }
    }

    if (left < 0) {
        throw new UnprocessableEntityError('The allocations add up to more than the payment', { reason: 'ALLOCATIONS_EXCEED_PAYMENT' });
    }

    return plan;
};

const applyPlan = async (tx, input, target, payment, plan) => {
    const touchedPayables = new Set();

    for (const { row, cents } of plan) {
        const signed = sign(input) * cents;

        await tx.paymentAllocation.create({
            data: {
                paymentRecordId: payment.id,
                ...(target === 'RECEIVABLE' ? { receivableId: row.id } : { payableInstalmentId: row.id }),
                amountCents: signed
            }
        });

        const paidCents = row.paidCents + signed;
        const status = deriveStatus({ amountCents: row.amountCents, paidCents, current: row.status });
        const data = { paidCents, status, voidedAt: status === 'VOID' ? row.voidedAt ?? new Date() : null };

        if (target === 'RECEIVABLE') {
            await tx.receivable.update({ where: { id: row.id }, data });
        } else {
            await tx.payableInstalment.update({ where: { id: row.id }, data });
            touchedPayables.add(row.payableId);
        }
    }

    for (const payableId of touchedPayables) {
        await recomputePayable(tx, payableId);
    }
};

/**
 * The slip attached to a payment is a payment slip.
 *
 * Any file id would otherwise do, and the payment's response names the file
 * it points at — so a contract or a driver's licence attached here would
 * leak its name and type to whoever reads payments.
 */
const assertAttachment = async (tx, attachmentAssetId) => {
    if (!attachmentAssetId) return;

    const asset = await tx.fileAsset.findFirst({
        where: { id: attachmentAssetId, deletedAt: null },
        select: { category: true, status: true }
    });

    if (!asset || asset.category !== 'PAYMENT_ATTACHMENT' || asset.status !== 'READY') {
        throw new UnprocessableEntityError('The attachment must be an uploaded payment slip', {
            reason: 'ATTACHMENT_INVALID',
            field: 'attachmentAssetId'
        });
    }
};

/** Who the money came from or went to, when the caller did not say: the first target's party. */
const counterpartyFrom = (input, target, plan) => {
    if (input.counterpartyPartnerId || input.counterpartyName || input.counterpartyEmail) {
        return {
            counterpartyPartnerId: input.counterpartyPartnerId ?? null,
            counterpartyName: input.counterpartyName ?? null,
            counterpartyEmail: input.counterpartyEmail ?? null
        };
    }

    if (input.allocate?.partnerId) {
        return { counterpartyPartnerId: input.allocate.partnerId, counterpartyName: null, counterpartyEmail: null };
    }

    const first = plan[0]?.row;

    if (!first) {
        throw new UnprocessableEntityError('Say who the money came from or went to', { reason: 'COUNTERPARTY_REQUIRED' });
    }

    return target === 'RECEIVABLE'
        ? { counterpartyPartnerId: first.debtorPartnerId, counterpartyName: first.debtorName, counterpartyEmail: first.debtorEmail }
        : { counterpartyPartnerId: first.payable.supplierPartnerId, counterpartyName: first.payable.supplierPartnerId ? null : 'Platform supplier', counterpartyEmail: null };
};

const sameRequest = (existing, input) =>
    existing.direction === input.direction &&
    existing.kind === input.kind &&
    existing.amountCents === input.amountCents &&
    existing.currency === input.currency;

/**
 * The transaction's half of recording a payment, for an approval to run in
 * its own. `via` names the request it was asked through, and travels on the
 * audit row so the trail reads "approved by X, asked by Y".
 */
export const recordPaymentInTx = async (tx, input, actor, req, via = null) => {
    const target = targetKind(input);

    await assertAttachment(tx, input.attachmentAssetId);

    const plan = await planAllocations(tx, input, target);
    const party = counterpartyFrom(input, target, plan);

    const created = await tx.paymentRecord.create({
        data: {
            direction: input.direction,
            kind: input.kind,
            method: input.method,
            ...party,
            currency: input.currency,
            amountCents: input.amountCents,
            reference: input.reference ?? null,
            paidAt: input.paidAt,
            note: input.note ?? null,
            reason: input.reason ?? null,
            recordedByUserId: actor?.id ?? null,
            attachmentAssetId: input.attachmentAssetId ?? null,
            idempotencyKey: input.idempotencyKey ?? null
        }
    });

    await applyPlan(tx, input, target, created, plan);

    const allocated = plan.reduce((sum, entry) => sum + entry.cents, 0);
    const verb = input.kind === 'REFUND' ? 'Refund' : 'Payment';
    const way = input.direction === 'IN' ? 'received' : 'sent';

    await recordAudit(tx, {
        action: input.kind === 'REFUND' ? 'REFUND_RECORDED' : 'PAYMENT_RECORDED',
        actor,
        entityType: AUDIT_ENTITY.paymentRecord,
        entityId: created.id,
        summary: `${verb} ${way}: ${money(input.amountCents, input.currency)}${input.reference ? ` (${input.reference})` : ''}`,
        metadata: {
            direction: input.direction,
            kind: input.kind,
            method: input.method,
            amountCents: input.amountCents,
            allocatedCents: allocated,
            targets: plan.map(({ row, cents }) => ({ id: row.id, cents })),
            ...(via ? { approvalId: via.approvalId, requestedByUserId: via.requestedByUserId } : {})
        },
        req
    });

    // The receipt to the payer, written with the payment so that a dead mail
    // server cannot turn a recorded payment into a 500.
    await enqueueEvent(tx, {
        topic: TOPICS.PAYMENT_RECORDED,
        payload: { paymentId: created.id },
        entityType: AUDIT_ENTITY.paymentRecord,
        entityId: created.id
    });

    return tx.paymentRecord.findUnique({ where: { id: created.id }, include: paymentInclude });
};

/**
 * Records a payment and settles what it pays.
 *
 * `allocations` names the items and amounts; `allocate` asks for the oldest
 * open items of one partner to be settled first; neither leaves the whole
 * amount unallocated, to be spread later with `allocatePayment`. Whatever is
 * not allocated is reported as `unallocatedCents`.
 */
export const recordPayment = async (input, actor, req) => {
    if (input.idempotencyKey) {
        const existing = await prisma.paymentRecord.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: paymentInclude });

        if (existing) {
            if (!sameRequest(existing, input)) {
                throw new ConflictError('That Idempotency-Key was used for a different payment', { reason: 'IDEMPOTENCY_KEY_REUSED' });
            }

            return { payment: existing, replayed: true };
        }
    }

    try {
        const payment = await prisma.$transaction((tx) => recordPaymentInTx(tx, input, actor, req));

        return { payment, replayed: false };
    } catch (err) {
        // Two identical requests at once: the loser answers with the winner.
        if (err?.code === 'P2002' && input.idempotencyKey) {
            const winner = await prisma.paymentRecord.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: paymentInclude });
            if (winner && sameRequest(winner, input)) return { payment: winner, replayed: true };
        }
        throw err;
    }
};

/** Spreads the unallocated rest of an existing payment. */
export const allocatePayment = (paymentId, { allocations }, actor, req) =>
    prisma.$transaction(async (tx) => {
        await lockRows(tx, 'payment_records', [paymentId]);
        const payment = await tx.paymentRecord.findUnique({ where: { id: paymentId }, include: { allocations: true } });

        if (!payment) {
            throw new NotFoundError('Payment not found');
        }

        const allocated = payment.allocations.reduce((sum, a) => sum + Math.abs(a.amountCents), 0);
        const input = { ...payment, amountCents: payment.amountCents - allocated, allocations };
        const target = targetKind(payment);
        const plan = await planAllocations(tx, input, target);

        await applyPlan(tx, input, target, payment, plan);

        await recordAudit(tx, {
            action: 'PAYMENT_ALLOCATED',
            actor,
            entityType: AUDIT_ENTITY.paymentRecord,
            entityId: payment.id,
            summary: `Allocated ${money(plan.reduce((sum, e) => sum + e.cents, 0), payment.currency)} of an earlier payment`,
            metadata: { targets: plan.map(({ row, cents }) => ({ id: row.id, cents })) },
            req
        });

        return tx.paymentRecord.findUnique({ where: { id: payment.id }, include: paymentInclude });
    });

/** Pays one supplier instalment: the shortcut behind "Mark paid". */
export const payInstalment = async (payableId, sequence, input, actor, req) => {
    const instalment = await prisma.payableInstalment.findUnique({
        where: { payableId_sequence: { payableId, sequence } },
        include: { payable: true }
    });

    if (!instalment) {
        throw new NotFoundError('Instalment not found');
    }

    const outstanding = Math.max(0, instalment.amountCents - instalment.paidCents);
    const amountCents = input.amountCents ?? outstanding;

    if (amountCents <= 0) {
        throw new ConflictError('Nothing is outstanding on that instalment', { reason: 'NOT_SETTLEABLE' });
    }

    return recordPayment(
        {
            direction: 'OUT',
            kind: 'PAYMENT',
            method: input.method,
            currency: instalment.payable.currency,
            amountCents,
            paidAt: input.paidAt,
            reference: input.reference,
            note: input.note,
            attachmentAssetId: input.attachmentAssetId,
            idempotencyKey: input.idempotencyKey,
            allocations: [{ payableInstalmentId: instalment.id, amountCents }]
        },
        actor,
        req
    );
};
