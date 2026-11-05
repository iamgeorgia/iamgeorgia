import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import {
    listNotifications,
    unreadSummary,
    markAllNotificationsRead,
    markNotificationRead,
    toNotification
} from '../services/notifications/notification.service.js';
import { notificationParamSchema, notificationQuerySchema, readAllSchema } from '../validation/notification.js';

/**
 * The admin panel's bell.
 *
 * Every row is scoped on the session: a notification is addressed to one
 * person and nobody else's exists here, whatever id is asked for. Staff only
 * — a driver's bell is in the driver panel and a partner's in the portal,
 * each reading the same rows through its own router.
 */
export const adminNotificationRoutes = Router();

// Staff, which is to say whoever reads the catalogue: every panel role and no
// partner or driver, who have their own bells.
adminNotificationRoutes.use(authenticate, requireCapability(CAPABILITIES.CATALOGUE_READ), requireCapability(CAPABILITIES.NOTIFICATIONS_READ));

adminNotificationRoutes.get('/', validate({ query: notificationQuerySchema }), async (req, res) => {
    const { notifications, ...page } = await listNotifications(req.user.id, req.valid.query);

    res.json({ data: notifications.map((row) => toNotification(row, 'admin')), ...page });
});

/** Cheap enough to poll: one indexed count, with the per-tab split beside it. */
adminNotificationRoutes.get('/unread-count', async (req, res) => {
    res.json(await unreadSummary(req.user.id));
});

adminNotificationRoutes.post('/read-all', validate({ body: readAllSchema }), async (req, res) => {
    const { count } = await markAllNotificationsRead(req.user.id, req.valid.body);

    res.json({ count });
});

adminNotificationRoutes.post('/:id/read', validate({ params: notificationParamSchema }), async (req, res) => {
    const { notification } = await markNotificationRead(req.user.id, req.valid.params.id);

    res.json(toNotification(notification, 'admin'));
});
