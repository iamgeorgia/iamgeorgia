import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireCapability, requireRole } from '../middleware/auth.js';
import { CAPABILITIES, STAFF_ROLES } from '../lib/permissions.js';
import {
    countUnreadNotifications,
    listNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    toNotification
} from '../services/notifications/notification.service.js';
import { notificationParamSchema, notificationQuerySchema } from '../validation/notification.js';

/**
 * The admin panel's bell.
 *
 * Every row is scoped on the session: a notification is addressed to one
 * person and nobody else's exists here, whatever id is asked for. Staff only
 * — a driver's bell is in the driver panel and a partner's in the portal,
 * each reading the same rows through its own router.
 */
export const adminNotificationRoutes = Router();

adminNotificationRoutes.use(authenticate, requireRole(...STAFF_ROLES), requireCapability(CAPABILITIES.NOTIFICATIONS_READ));

adminNotificationRoutes.get('/', validate({ query: notificationQuerySchema }), async (req, res) => {
    const { notifications, ...page } = await listNotifications(req.user.id, req.valid.query);

    res.json({ data: notifications.map(toNotification), ...page });
});

/** Cheap enough to poll: one indexed count. */
adminNotificationRoutes.get('/unread-count', async (req, res) => {
    res.json({ unreadCount: await countUnreadNotifications(req.user.id) });
});

adminNotificationRoutes.post('/read-all', async (req, res) => {
    const { count } = await markAllNotificationsRead(req.user.id);

    res.json({ count });
});

adminNotificationRoutes.post('/:id/read', validate({ params: notificationParamSchema }), async (req, res) => {
    const { notification } = await markNotificationRead(req.user.id, req.valid.params.id);

    res.json(toNotification(notification));
});
