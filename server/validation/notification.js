import { z } from 'zod';

import { NOTIFICATION_CATEGORIES } from '../lib/notifications/categories.js';

/**
 * The bell, wherever it hangs: the driver panel, the admin panel and the
 * partner portal all page through the same `Notification` rows with these.
 */

const idField = z.string().min(1).max(64);

const kindField = z.string().trim().min(1).max(64).regex(/^[A-Z_]+$/);

export const notificationQuerySchema = z
    .object({
        unread: z
            .enum(['true', 'false'])
            .transform((value) => value === 'true')
            .optional(),
        /** One tab of the bell. */
        category: z.enum(NOTIFICATION_CATEGORIES).optional(),
        /** One or more kinds, as the enum spells them; an unknown kind simply matches nothing. */
        kind: z.union([kindField, z.array(kindField).max(20)]).optional(),
        sort: z.enum(['newest', 'oldest', 'unreadFirst']).default('newest'),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25)
    })
    .strict();

export const notificationParamSchema = z.object({ id: idField });

/** Mark everything read, or one tab of it. */
export const readAllSchema = z.object({ category: z.enum(NOTIFICATION_CATEGORIES).optional() }).strict().optional().default({});
