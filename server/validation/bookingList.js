import { z } from 'zod';

import { bookingFilterFields } from '../lib/listing/bookingFilters.js';
import { BOOKING_PRODUCTS, BOOKING_STATUSES } from '../lib/booking/machines.js';

/** The cross-product register: every booking of every product in one list. */

const ORDER_STATUSES = ['PENDING_APPROVAL', 'PENDING_CONFIRMATION', 'CONFIRMED', 'PARTIALLY_CANCELLED', 'CANCELLED', 'COMPLETED'];
const ALL_STATUSES = [...new Set([...BOOKING_STATUSES, ...ORDER_STATUSES])];

const oneOrMany = (values) => z.union([z.enum(values), z.array(z.enum(values)).max(values.length)]).optional();
const dateOnlyField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const bookingIndexQuerySchema = z
    .object({
        ...bookingFilterFields,
        product: oneOrMany(BOOKING_PRODUCTS),
        status: oneOrMany(ALL_STATUSES),
        partnerId: z.string().min(1).max(64).optional(),
        from: dateOnlyField.optional(),
        to: dateOnlyField.optional(),
        search: z.string().trim().max(120).optional(),
        /** Also list the children of orders, beside their order. */
        children: z
            .enum(['true', 'false'])
            .transform((value) => value === 'true')
            .optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25)
    })
    .strict();
