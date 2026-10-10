import { z } from 'zod';

/** The dead-letter list: events that exhausted their attempts. */

export const outboxQuerySchema = z
    .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25)
    })
    .strict();

export const outboxParamSchema = z.object({ id: z.string().min(1).max(64) });
