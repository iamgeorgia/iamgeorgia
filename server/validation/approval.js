import { z } from 'zod';

import { textField } from './normalize.js';
import { adjustPayableSchema, adjustReceivableSchema, recordPaymentSchema } from './finance.js';

const idField = z.string().min(1).max(64);
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };

export const APPROVAL_KINDS = ['REFUND', 'PAYABLE_OVERRIDE', 'PAYABLE_WAIVE', 'RECEIVABLE_DUE_DATE', 'RECEIVABLE_WAIVE'];
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

/**
 * A request carries the exact body the executing service will run with on
 * approval, validated here with that service's own schema, so what the
 * approver reads is what will happen. The refund body must be a refund; the
 * adjustment bodies must carry the one change the kind names and nothing
 * else — notes travel on their own route.
 */
const refundPayload = recordPaymentSchema.refine((body) => body.kind === 'REFUND', { message: 'A refund request records a refund', path: ['kind'] });

const payableOverride = adjustPayableSchema.refine((body) => body.amountOverrideCents !== undefined && body.waive === undefined && body.notes === undefined, {
    message: 'An override request carries the new amount, and only that'
});
const payableWaive = adjustPayableSchema.refine((body) => body.waive === true && body.amountOverrideCents === undefined && body.notes === undefined, {
    message: 'A write-off request waives, and only that'
});
const receivableDueDate = adjustReceivableSchema.refine((body) => body.dueAt !== undefined && body.waive === undefined && body.notes === undefined, {
    message: 'A due-date request carries the new date, and only that'
});
const receivableWaive = adjustReceivableSchema.refine((body) => body.waive === true && body.dueAt === undefined && body.notes === undefined, {
    message: 'A write-off request waives, and only that'
});

export const PAYLOAD_SCHEMAS = {
    REFUND: refundPayload,
    PAYABLE_OVERRIDE: payableOverride,
    PAYABLE_WAIVE: payableWaive,
    RECEIVABLE_DUE_DATE: receivableDueDate,
    RECEIVABLE_WAIVE: receivableWaive
};

export const requestApprovalSchema = z
    .object({
        kind: z.enum(APPROVAL_KINDS),
        /** The payable or receivable the adjustment is about. A refund names none: its allocations say. */
        subjectId: idField.optional(),
        payload: z.record(z.string(), z.unknown()),
        note: textField(1000).optional()
    })
    .strict()
    .superRefine((value, ctx) => {
        const parsed = PAYLOAD_SCHEMAS[value.kind].safeParse(value.payload);

        if (!parsed.success) {
            for (const issue of parsed.error.issues) {
                ctx.addIssue({ ...issue, path: ['payload', ...issue.path] });
            }
        }

        if (value.kind !== 'REFUND' && !value.subjectId) {
            ctx.addIssue({ code: 'custom', message: 'Say which payable or receivable this is about', path: ['subjectId'] });
        }
    })
    .transform((value) => ({ ...value, payload: PAYLOAD_SCHEMAS[value.kind].parse(value.payload) }));

export const decisionSchema = z.object({ note: textField(1000).optional() }).strict().optional().default({});

export const approvalQuerySchema = z
    .object({
        status: z.enum(APPROVAL_STATUSES).optional(),
        kind: z.enum(APPROVAL_KINDS).optional(),
        mine: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
        ...paging
    })
    .strict();

export const approvalIdParamSchema = z.object({ id: idField });
