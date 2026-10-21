import { z } from 'zod';

import { BOOKING_PRODUCTS } from '../lib/booking/machines.js';
import { textField } from './normalize.js';

const KINDS = ['PAYMENT', 'FREE_CANCELLATION', 'CONFIRMATION'];
const STATUSES = ['OPEN', 'MET', 'MISSED', 'CANCELLED'];
const idField = z.string().min(1).max(64);
const oneOrMany = (values) => z.union([z.enum(values), z.array(z.enum(values)).max(values.length)]).optional();
const instantField = z.coerce.date();

export const deadlineQuerySchema = z
    .object({
        kind: oneOrMany(KINDS),
        status: oneOrMany(STATUSES),
        product: oneOrMany(BOOKING_PRODUCTS),
        partnerId: idField.optional(),
        managerId: idField.optional(),
        customerId: idField.optional(),
        /** One booking's deadlines: by reference or by id. */
        reference: z.string().trim().min(1).max(64).optional(),
        bookingId: idField.optional(),
        from: instantField.optional(),
        to: instantField.optional(),
        sort: z.enum(['soonest', 'latest']).default('soonest'),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(100)
    })
    .strict();

export const deadlineParamSchema = z.object({ id: idField }).strict();

/** A move needs a moment and a reason: the history row carries both. */
export const moveDeadlineSchema = z.object({ dueAt: instantField, reason: textField(500) }).strict();

const CHANNELS = ['IN_APP', 'EMAIL'];
const RECIPIENTS = ['STAFF', 'PARTNER', 'GUEST'];

export const reminderPolicySchema = z
    .object({
        kind: z.enum(KINDS),
        partnerId: idField.nullish(),
        offsetsDays: z.array(z.number().int().min(0).max(365)).max(10).default([]),
        channels: z.array(z.enum(CHANNELS)).default(['IN_APP']),
        recipients: z.array(z.enum(RECIPIENTS)).default(['STAFF']),
        enabled: z.boolean().default(true),
        /** Drops a partner's override; the schedule itself is then not needed. */
        remove: z.boolean().default(false)
    })
    .strict()
    .superRefine((value, ctx) => {
        if (value.remove) return;

        for (const field of ['offsetsDays', 'channels', 'recipients']) {
            if (value[field].length === 0) {
                ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: 1, type: 'array', inclusive: true, path: [field], message: 'At least one is needed' });
            }
        }
    });

export const reminderPolicyQuerySchema = z.object({ partnerId: idField.optional() }).strict();
