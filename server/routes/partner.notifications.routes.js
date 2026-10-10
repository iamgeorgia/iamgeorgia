import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireApprovedPartner, requireCapability, requirePartner } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import {
    countUnreadNotifications,
    listNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    toNotification
} from '../services/notifications/notification.service.js';
import { notificationParamSchema, notificationQuerySchema } from '../validation/notification.js';

/**
 * The portal's bell: a driver confirmed, a payment received, an invoice
 * overdue. Same rows and the same service as the admin bell, scoped on the
 * session's user — a partner's notices are the person's, not the company's.
 */
export const partnerNotificationRoutes = Router();

partnerNotificationRoutes.use(authenticate, requirePartner, requireApprovedPartner, requireCapability(CAPABILITIES.NOTIFICATIONS_READ));

partnerNotificationRoutes.get('/', validate({ query: notificationQuerySchema }), async (req, res) => {
    const { notifications, ...page } = await listNotifications(req.user.id, req.valid.query);

    res.json({ data: notifications.map(toNotification), ...page });
});

partnerNotificationRoutes.get('/unread-count', async (req, res) => {
    res.json({ unreadCount: await countUnreadNotifications(req.user.id) });
});

partnerNotificationRoutes.post('/read-all', async (req, res) => {
    const { count } = await markAllNotificationsRead(req.user.id);

    res.json({ count });
});

partnerNotificationRoutes.post('/:id/read', validate({ params: notificationParamSchema }), async (req, res) => {
    const { notification } = await markNotificationRead(req.user.id, req.valid.params.id);

    res.json(toNotification(notification));
});
