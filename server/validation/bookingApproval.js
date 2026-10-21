import { z } from 'zod';

import { BOOKING_PRODUCTS } from '../lib/booking/machines.js';

/**
 * The approvals queue and its two decisions.
 *
 * `product` is which table the reference points into: a BKG-, TRF-, TUR-,
 * SVC- or ORD- reference each live in their own, and the route is told
 * rather than left to guess from the prefix.
 */

const textField = (max) => z.string().trim().min(1).max(max);

export const approvalParamSchema = z
    .object({
        product: z.enum(BOOKING_PRODUCTS),
        reference: z.string().trim().min(1).max(64)
    })
    .strict();

export const approveBookingSchema = z.object({ note: textField(500).optional() }).strict().optional().default({});

/** A no has to say why: the buyer is told, and the reason is the audit row's. */
export const rejectBookingSchema = z.object({ reason: textField(500) }).strict();

export const approvalQueueQuerySchema = z
    .object({
        product: z.enum(BOOKING_PRODUCTS).optional(),
        partnerId: z.string().min(1).max(64).optional(),
        overdue: z
            .enum(['true', 'false'])
            .transform((value) => value === 'true')
            .optional(),
        search: z.string().trim().max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25)
    })
    .strict();
