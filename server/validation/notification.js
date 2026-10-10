import { z } from 'zod';

/**
 * The bell, wherever it hangs: the driver panel, the admin panel and the
 * partner portal all page through the same `Notification` rows with these.
 */

const idField = z.string().min(1).max(64);

export const notificationQuerySchema = z
    .object({
        unread: z
            .enum(['true', 'false'])
            .transform((value) => value === 'true')
            .optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25)
    })
    .strict();

export const notificationParamSchema = z.object({ id: idField });
