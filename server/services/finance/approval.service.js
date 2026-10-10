import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { lockRows } from '../../lib/locks.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { CAPABILITIES, assertCan, can } from '../../lib/permissions.js';
import { nextReference } from '../../lib/reference.js';
import { adjustPayableInTx, adjustReceivableInTx, findPayableOr404, findReceivableOr404 } from './settlement.service.js';
import { recordPaymentInTx } from './payment.service.js';
import { findPenaltyOr404, overridePenaltyInTx } from './penalty.service.js';
import { syncBookingReceivableInTx } from './ledger.service.js';

/**
 * A money action one person asks for and another approves.
 *
 * The request carries the exact body the executing service will run with,
 * validated with that service's own schema at the door; approving runs it,
 * in the approver's name and in the same transaction that marks the request
 * approved, so a request is either done or still pending, never half. The
 * executing service writes its usual audit row with the request id on it,
 * and the request's own rows say who asked and who decided. Nobody decides
 * what they asked for themselves.
 */

const money = (cents, currency) => `${(cents / 100).toFixed(2)} ${currency}`;

const KINDS = {
    REFUND: {
        requestCap: CAPABILITIES.FINANCE_REFUNDS_REQUEST,
        approveCap: CAPABILITIES.FINANCE_REFUNDS_APPROVE,
        /** A refund's subject is what it refunds: the first allocation's item, or nothing when it is left to be spread. */
        subject: (payload) => {
            const first = payload.allocations?.[0];

            return first?.receivableId
                ? { subjectType: 'Receivable', subjectId: first.receivableId }
                : first?.payableInstalmentId
                  ? { subjectType: 'PayableInstalment', subjectId: first.payableInstalmentId }
                  : { subjectType: 'PaymentRecord', subjectId: '' };
        },
        describe: async (payload) => ({
            amountCents: payload.amountCents,
            currency: payload.currency,
            summary: `Refund of ${money(payload.amountCents, payload.currency)} ${payload.direction === 'OUT' ? 'to a buyer' : 'from a supplier'}: ${payload.reason}`
        }),
        execute: (tx, request, actor, req, via) =>
            recordPaymentInTx(tx, { ...request.payload, idempotencyKey: `approval:${request.id}` }, actor, req, via).then((payment) => ({
                entityType: AUDIT_ENTITY.paymentRecord,
                entityId: payment.id
            }))
    },
    PAYABLE_OVERRIDE: {
        requestCap: CAPABILITIES.FINANCE_ADJUSTMENTS_REQUEST,
        approveCap: CAPABILITIES.FINANCE_ADJUSTMENTS_APPROVE,
        subject: (payload, subjectId) => ({ subjectType: 'SupplierPayable', subjectId }),
        describe: async (payload, subjectId) => {
            const payable = await findPayableOr404(subjectId);

            return {
                amountCents: payload.amountOverrideCents,
                currency: payable.currency,
                summary:
                    payload.amountOverrideCents === null
                        ? `Hand ${payable.bookingReference} back to the supplier's terms: ${payload.reason}`
                        : `Set the supplier payable for ${payable.bookingReference} to ${money(payload.amountOverrideCents, payable.currency)} (now ${money(payable.amountCents, payable.currency)}): ${payload.reason}`
            };
        },
        execute: (tx, request, actor, req, via) =>
            adjustPayableInTx(tx, request.subjectId, request.payload, actor, req, via).then(() => ({ entityType: AUDIT_ENTITY.supplierPayable, entityId: request.subjectId }))
    },
    PAYABLE_WAIVE: {
        requestCap: CAPABILITIES.FINANCE_ADJUSTMENTS_REQUEST,
        approveCap: CAPABILITIES.FINANCE_ADJUSTMENTS_APPROVE,
        subject: (payload, subjectId) => ({ subjectType: 'SupplierPayable', subjectId }),
        describe: async (payload, subjectId) => {
            const payable = await findPayableOr404(subjectId);
            const outstanding = Math.max(0, payable.amountCents - payable.paidCents);

            return {
                amountCents: outstanding,
                currency: payable.currency,
                summary: `Write off ${money(outstanding, payable.currency)} left on the supplier payable for ${payable.bookingReference}: ${payload.reason}`
            };
        },
        execute: (tx, request, actor, req, via) =>
            adjustPayableInTx(tx, request.subjectId, request.payload, actor, req, via).then(() => ({ entityType: AUDIT_ENTITY.supplierPayable, entityId: request.subjectId }))
    },
    RECEIVABLE_DUE_DATE: {
        requestCap: CAPABILITIES.FINANCE_ADJUSTMENTS_REQUEST,
        approveCap: CAPABILITIES.FINANCE_ADJUSTMENTS_APPROVE,
        subject: (payload, subjectId) => ({ subjectType: 'Receivable', subjectId }),
        describe: async (payload, subjectId) => {
            const receivable = await findReceivableOr404(subjectId);

            return {
                amountCents: Math.max(0, receivable.amountCents - receivable.paidCents),
                currency: receivable.currency,
                summary: `Move the due date of ${receivable.reference} to ${payload.dueAt ? payload.dueAt.toISOString().slice(0, 10) : 'none'}: ${payload.reason}`
            };
        },
        execute: (tx, request, actor, req, via) =>
            adjustReceivableInTx(tx, request.subjectId, { ...request.payload, dueAt: request.payload.dueAt ? new Date(request.payload.dueAt) : request.payload.dueAt }, actor, req, via).then(() => ({
                entityType: AUDIT_ENTITY.receivable,
                entityId: request.subjectId
            }))
    },
    RECEIVABLE_WAIVE: {
        requestCap: CAPABILITIES.FINANCE_ADJUSTMENTS_REQUEST,
        approveCap: CAPABILITIES.FINANCE_ADJUSTMENTS_APPROVE,
        subject: (payload, subjectId) => ({ subjectType: 'Receivable', subjectId }),
        describe: async (payload, subjectId) => {
            const receivable = await findReceivableOr404(subjectId);
            const outstanding = Math.max(0, receivable.amountCents - receivable.paidCents);

            return {
                amountCents: outstanding,
                currency: receivable.currency,
                summary: `Write off ${money(outstanding, receivable.currency)} left on ${receivable.reference}: ${payload.reason}`
            };
        },
        execute: (tx, request, actor, req, via) =>
            adjustReceivableInTx(tx, request.subjectId, request.payload, actor, req, via).then(() => ({ entityType: AUDIT_ENTITY.receivable, entityId: request.subjectId }))
    },
    PENALTY_OVERRIDE: {
        requestCap: CAPABILITIES.FINANCE_ADJUSTMENTS_REQUEST,
        approveCap: CAPABILITIES.FINANCE_ADJUSTMENTS_APPROVE,
        subject: (payload, subjectId) => ({ subjectType: 'PenaltyEntry', subjectId }),
        describe: async (payload, subjectId) => {
            const penalty = await findPenaltyOr404(subjectId);

            return {
                amountCents: payload.overrideCents ?? penalty.chargeCents,
                currency: penalty.currency,
                summary:
                    payload.overrideCents === null
                        ? `Hand the penalty on ${penalty.reference} back to the policy's ${money(penalty.chargeCents, penalty.currency)}: ${payload.reason}`
                        : `Set the penalty on ${penalty.reference} to ${money(payload.overrideCents, penalty.currency)} (charged ${money(penalty.chargeCents, penalty.currency)}): ${payload.reason}`
            };
        },
        execute: (tx, request, actor, req, via) =>
            overridePenaltyInTx(tx, request.subjectId, request.payload, actor, req, via, { syncReceivable: syncBookingReceivableInTx }).then(() => ({
                entityType: AUDIT_ENTITY.penalty,
                entityId: request.subjectId
            }))
    }
};

/** Which capability decides a kind: `{ REFUND: 'finance.refunds.approve', … }`, for the badge and the inbox. */
export const APPROVE_CAPABILITY_FOR_KIND = Object.freeze(Object.fromEntries(Object.entries(KINDS).map(([kind, spec]) => [kind, spec.approveCap])));

const approvalInclude = {
    requestedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
    decidedBy: { select: { id: true, email: true, firstName: true, lastName: true } }
};

/** The kinds a viewer may decide. */
export const decidableKinds = (viewer) => Object.keys(KINDS).filter((kind) => can(viewer, KINDS[kind].approveCap));

const mayRead = (viewer) => decidableKinds(viewer).length > 0 || can(viewer, CAPABILITIES.FINANCE_REFUNDS_REQUEST, CAPABILITIES.FINANCE_ADJUSTMENTS_REQUEST);

/**
 * Opens a request. The subject is looked at once, cheaply — it exists and
 * can still take the change — so a request for a payable already written
 * off is refused at the door rather than at approval.
 */
export const requestApproval = async ({ kind, subjectId, payload, note }, actor, req) => {
    const spec = KINDS[kind];

    assertCan(actor, spec.requestCap);

    const subject = spec.subject(payload, subjectId);
    const described = await spec.describe(payload, subjectId);

    return prisma.$transaction(async (tx) => {
        const request = await tx.approvalRequest.create({
            data: {
                reference: await nextReference(tx, 'approval'),
                kind,
                ...subject,
                payload,
                amountCents: described.amountCents ?? null,
                currency: described.currency ?? null,
                summary: described.summary,
                requestedByUserId: actor.id,
                requestNote: note ?? null
            },
            include: approvalInclude
        });

        await recordAudit(tx, {
            action: 'APPROVAL_REQUESTED',
            actor,
            entityType: AUDIT_ENTITY.approval,
            entityId: request.id,
            summary: `${actor.email} asked for approval: ${described.summary}`,
            metadata: { kind, reference: request.reference, subjectType: subject.subjectType, subjectId: subject.subjectId, amountCents: described.amountCents ?? null, currency: described.currency ?? null },
            req
        });

        await enqueueEvent(tx, {
            topic: TOPICS.APPROVAL_REQUESTED,
            payload: { approvalId: request.id },
            entityType: AUDIT_ENTITY.approval,
            entityId: request.id
        });

        return request;
    });
};

/** Approvers see every request; a requester sees only their own. */
export const listApprovals = async ({ status, kind, mine, page, pageSize }, viewer) => {
    if (!mayRead(viewer)) {
        throw new ForbiddenError('Insufficient permissions', { reason: 'INSUFFICIENT_CAPABILITY', required: [CAPABILITIES.FINANCE_REFUNDS_APPROVE, CAPABILITIES.FINANCE_ADJUSTMENTS_APPROVE] });
    }

    const decidable = decidableKinds(viewer);
    const where = {
        ...(status ? { status } : {}),
        ...(kind ? { kind } : {}),
        ...(mine || decidable.length === 0
            ? { requestedByUserId: viewer.id }
            : { OR: [{ kind: { in: decidable } }, { requestedByUserId: viewer.id }] })
    };

    const [total, requests] = await Promise.all([
        prisma.approvalRequest.count({ where }),
        prisma.approvalRequest.findMany({
            where,
            include: approvalInclude,
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { requests, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

export const findApprovalOr404 = async (id, viewer, client = prisma) => {
    const request = await client.approvalRequest.findUnique({ where: { id }, include: approvalInclude });

    if (!request) {
        throw new NotFoundError('Approval request not found');
    }

    // A 404 for a request that is not the viewer's to see: the references
    // are sequential, and "exists but not yours" would let anyone count them.
    if (request.requestedByUserId !== viewer.id && !can(viewer, KINDS[request.kind].approveCap)) {
        throw new NotFoundError('Approval request not found');
    }

    return request;
};

const assertPending = (request) => {
    if (request.status !== 'PENDING') {
        throw new ConflictError('This request has already been decided', { reason: 'ALREADY_DECIDED', status: request.status });
    }
};

/**
 * Approves and executes, in one transaction. If the execution throws, the
 * transaction rolls back and the request stays pending, with the reason
 * written beside it afterwards so the approver can see what stood in the
 * way (a payable paid in the meantime, say) and ask again or reject.
 */
export const approveRequest = async (id, { note }, actor, req) => {
    try {
        return await prisma.$transaction(async (tx) => {
            await lockRows(tx, 'approval_requests', [id]);
            const request = await findApprovalOr404(id, actor, tx);
            const spec = KINDS[request.kind];

            assertPending(request);
            assertCan(actor, spec.approveCap);

            if (request.requestedByUserId === actor.id) {
                throw new ForbiddenError('Nobody approves what they asked for themselves', { reason: 'SELF_APPROVAL' });
            }

            const via = { approvalId: request.id, requestedByUserId: request.requestedByUserId };
            const executed = await spec.execute(tx, request, actor, req, via);

            const decided = await tx.approvalRequest.update({
                where: { id },
                data: {
                    status: 'APPROVED',
                    decidedByUserId: actor.id,
                    decidedAt: new Date(),
                    decisionNote: note ?? null,
                    executedEntityType: executed.entityType,
                    executedEntityId: executed.entityId,
                    lastError: null
                },
                include: approvalInclude
            });

            await recordAudit(tx, {
                action: 'APPROVAL_APPROVED',
                actor,
                entityType: AUDIT_ENTITY.approval,
                entityId: id,
                summary: `${actor.email} approved ${request.reference}: ${request.summary}`,
                metadata: { kind: request.kind, reference: request.reference, requestedByUserId: request.requestedByUserId, executed, note: note ?? null },
                req
            });

            await enqueueEvent(tx, { topic: TOPICS.APPROVAL_DECIDED, payload: { approvalId: id }, entityType: AUDIT_ENTITY.approval, entityId: id });

            return decided;
        });
    } catch (err) {
        // Only an execution failure is worth leaving on the request: a
        // refusal at the door (not pending, not the approver's, their own)
        // said what it had to say already.
        if (err?.status === undefined || err.status >= 500 || [409, 422].includes(err.status)) {
            await prisma.approvalRequest
                .updateMany({ where: { id, status: 'PENDING' }, data: { lastError: String(err?.message ?? err).slice(0, 500) } })
                .catch(() => undefined);
        }

        throw err;
    }
};

export const rejectRequest = (id, { note }, actor, req) =>
    prisma.$transaction(async (tx) => {
        await lockRows(tx, 'approval_requests', [id]);
        const request = await findApprovalOr404(id, actor, tx);

        assertPending(request);
        assertCan(actor, KINDS[request.kind].approveCap);

        if (request.requestedByUserId === actor.id) {
            throw new ForbiddenError('Withdraw what you asked for yourself rather than rejecting it', { reason: 'SELF_APPROVAL' });
        }

        const decided = await tx.approvalRequest.update({
            where: { id },
            data: { status: 'REJECTED', decidedByUserId: actor.id, decidedAt: new Date(), decisionNote: note ?? null },
            include: approvalInclude
        });

        await recordAudit(tx, {
            action: 'APPROVAL_REJECTED',
            actor,
            entityType: AUDIT_ENTITY.approval,
            entityId: id,
            summary: `${actor.email} rejected ${request.reference}: ${request.summary}`,
            metadata: { kind: request.kind, reference: request.reference, requestedByUserId: request.requestedByUserId, note: note ?? null },
            req
        });

        await enqueueEvent(tx, { topic: TOPICS.APPROVAL_DECIDED, payload: { approvalId: id }, entityType: AUDIT_ENTITY.approval, entityId: id });

        return decided;
    });

/** The requester takes it back while it is still pending. */
export const cancelRequest = (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        await lockRows(tx, 'approval_requests', [id]);
        const request = await findApprovalOr404(id, actor, tx);

        assertPending(request);

        if (request.requestedByUserId !== actor.id) {
            throw new ForbiddenError('Only whoever asked can withdraw a request', { reason: 'NOT_REQUESTER' });
        }

        const decided = await tx.approvalRequest.update({
            where: { id },
            data: { status: 'CANCELLED', decidedByUserId: actor.id, decidedAt: new Date() },
            include: approvalInclude
        });

        await recordAudit(tx, {
            action: 'APPROVAL_CANCELLED',
            actor,
            entityType: AUDIT_ENTITY.approval,
            entityId: id,
            summary: `${actor.email} withdrew ${request.reference}`,
            metadata: { kind: request.kind, reference: request.reference },
            req
        });

        return decided;
    });

/** Pending requests the viewer may decide, for the badge. */
export const countPendingApprovals = (viewer) => {
    const decidable = decidableKinds(viewer);

    return decidable.length === 0 ? Promise.resolve(null) : prisma.approvalRequest.count({ where: { status: 'PENDING', kind: { in: decidable } } });
};
