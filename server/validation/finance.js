import { z } from 'zod';

import { paymentMilestonesSchema } from './domain.js';
import { clockTimeField, currencyField, emailField, textField } from './normalize.js';

const idField = z.string().min(1).max(64);
const centsField = z.number().int().positive().max(1_000_000_000);
const instantField = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const dateOnlyField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

const STATUSES = ['OPEN', 'PARTIAL', 'PAID', 'VOID', 'WAIVED'];
const statusFilter = z
    .union([z.enum(STATUSES), z.array(z.enum(STATUSES))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional();

const paging = {
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
};

const search = z.string().trim().min(1).max(120).optional();

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'CARD', 'OTHER'];

export const payableQuerySchema = z.object({
    status: statusFilter,
    // A partner id, or PLATFORM for inventory the platform owns itself.
    supplierPartnerId: idField.optional(),
    product: z.enum(['HOTEL', 'TRANSFER', 'TOUR', 'SERVICE']).optional(),
    currency: currencyField.optional(),
    dueBefore: instantField.optional(),
    needsReview: booleanQuery.optional(),
    q: search,
    ...paging
});

export const receivableQuerySchema = z.object({
    status: statusFilter,
    // A partner id, or GUEST for bookings made without an account.
    debtorPartnerId: idField.optional(),
    currency: currencyField.optional(),
    dueBefore: instantField.optional(),
    overdue: booleanQuery.optional(),
    q: search,
    ...paging
});

export const paymentQuerySchema = z.object({
    direction: z.enum(['IN', 'OUT']).optional(),
    kind: z.enum(['PAYMENT', 'REFUND']).optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    currency: currencyField.optional(),
    counterpartyPartnerId: idField.optional(),
    from: instantField.optional(),
    to: instantField.optional(),
    q: search,
    ...paging
});

const allocationSchema = z
    .object({
        receivableId: idField.optional(),
        payableInstalmentId: idField.optional(),
        amountCents: centsField
    })
    .strict()
    .refine((row) => Boolean(row.receivableId) !== Boolean(row.payableInstalmentId), {
        message: 'Each allocation names a receivable or an instalment, not both'
    });

/**
 * A payment. `allocations` names what it settles; `allocate` asks for one
 * partner's oldest open items first; with neither the money is recorded
 * unallocated, to be spread later.
 */
export const recordPaymentSchema = z
    .object({
        direction: z.enum(['IN', 'OUT']),
        kind: z.enum(['PAYMENT', 'REFUND']).default('PAYMENT'),
        method: z.enum(PAYMENT_METHODS),
        currency: currencyField,
        amountCents: centsField,
        paidAt: instantField,
        reference: textField(120).optional(),
        note: textField(1000).optional(),
        reason: textField(500).optional(),
        counterpartyPartnerId: idField.optional(),
        counterpartyName: textField(200).optional(),
        counterpartyEmail: emailField.optional(),
        attachmentAssetId: idField.optional(),
        idempotencyKey: z.string().trim().min(8).max(200).optional(),
        allocations: z.array(allocationSchema).min(1).max(100).optional(),
        allocate: z.object({ mode: z.literal('OLDEST_DUE'), partnerId: idField }).strict().optional()
    })
    .strict()
    .refine((body) => !(body.allocations && body.allocate), {
        message: 'Name the allocations or ask for the oldest first, not both',
        path: ['allocate']
    })
    .refine((body) => body.kind !== 'REFUND' || Boolean(body.reason), {
        message: 'A refund needs a reason',
        path: ['reason']
    })
    .refine((body) => !body.allocations || body.allocations.reduce((sum, row) => sum + row.amountCents, 0) <= body.amountCents, {
        message: 'The allocations add up to more than the payment',
        path: ['allocations']
    });

export const allocatePaymentSchema = z.object({ allocations: z.array(allocationSchema).min(1).max(100) }).strict();

export const payInstalmentSchema = z
    .object({
        method: z.enum(PAYMENT_METHODS),
        paidAt: instantField,
        amountCents: centsField.optional(),
        reference: textField(120).optional(),
        note: textField(1000).optional(),
        attachmentAssetId: idField.optional(),
        idempotencyKey: z.string().trim().min(8).max(200).optional()
    })
    .strict();

/** Finance's hand on a payable: its own figure, or a write-off. Always with a reason. */
export const adjustPayableSchema = z
    .object({
        amountOverrideCents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
        waive: z.literal(true).optional(),
        reason: textField(500),
        notes: textField(2000).nullable().optional()
    })
    .strict()
    .refine((body) => body.amountOverrideCents !== undefined || body.waive || body.notes !== undefined, {
        message: 'Nothing to change'
    });

/** A new due date (D5), or a write-off. Always with a reason. */
export const adjustReceivableSchema = z
    .object({
        dueAt: instantField.nullable().optional(),
        waive: z.literal(true).optional(),
        reason: textField(500),
        notes: textField(2000).nullable().optional()
    })
    .strict()
    .refine((body) => body.dueAt !== undefined || body.waive || body.notes !== undefined, { message: 'Nothing to change' });

const reportBase = {
    currency: currencyField.optional(),
    from: dateOnlyField.optional(),
    to: dateOnlyField.optional(),
    format: z.enum(['json', 'csv']).default('json')
};

export const summaryQuerySchema = z.object(reportBase);
export const marginQuerySchema = z.object({ ...reportBase, groupBy: z.enum(['product', 'supplier', 'partner']).default('product') });
export const ageingQuerySchema = z.object({
    currency: currencyField.optional(),
    side: z.enum(['receivables', 'payables']).default('receivables'),
    format: z.enum(['json', 'csv']).default('json')
});

export const supplierTermsSchema = z
    .object({
        milestones: paymentMilestonesSchema,
        cancellationLiability: z.enum(['PROPORTIONAL', 'NONE_UNLESS_NON_REFUNDABLE', 'MANUAL']).default('PROPORTIONAL'),
        cutoffTime: clockTimeField.nullable().optional(),
        notes: textField(2000).nullable().optional()
    })
    .strict();

export const partnerTermsSchema = z
    .object({
        paymentDueDays: z.number().int().min(0).max(365).optional(),
        paymentDueAnchor: z.enum(['CONFIRMATION', 'ARRIVAL']).optional(),
        paymentTermsNote: textField(1000).nullable().optional()
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });

export const financeIdParamSchema = z.object({ id: idField });
export const instalmentParamSchema = z.object({ id: idField, sequence: z.coerce.number().int().min(1).max(10) });
export const termsParamSchema = z.object({ id: idField });
