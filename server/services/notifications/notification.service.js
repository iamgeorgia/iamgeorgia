import { prisma } from '../../db/index.js';
import { NotFoundError } from '../../lib/errors.js';

/**
 * In-app notifications: the bell in the driver panel (and, later, the
 * admin's). Rows are written by the outbox drain, never by a request
 * handler, so every channel sees each event exactly once.
 */

export const listNotifications = async (userId, { unread = false, page = 1, pageSize = 25 } = {}) => {
    const where = { recipientUserId: userId, ...(unread ? { readAt: null } : {}) };

    const [total, unreadCount, notifications] = await Promise.all([
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { recipientUserId: userId, readAt: null } }),
        prisma.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { notifications, total, unreadCount, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

/** Scoped on the recipient: somebody else's notification does not exist. */
export const markNotificationRead = async (userId, id) => {
    const { count } = await prisma.notification.updateMany({
        where: { id, recipientUserId: userId, readAt: null },
        data: { readAt: new Date() }
    });

    const notification = await prisma.notification.findFirst({ where: { id, recipientUserId: userId } });

    if (!notification) {
        throw new NotFoundError('That notification does not exist');
    }

    return { notification, changed: count > 0 };
};

/** The number on the bell. */
export const countUnreadNotifications = (userId) => prisma.notification.count({ where: { recipientUserId: userId, readAt: null } });

export const markAllNotificationsRead = (userId) =>
    prisma.notification.updateMany({ where: { recipientUserId: userId, readAt: null }, data: { readAt: new Date() } });

export const toNotification = (notification) => ({
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    payload: notification.payload ?? {},
    entityType: notification.entityType ?? null,
    entityId: notification.entityId ?? null,
    readAt: notification.readAt,
    createdAt: notification.createdAt
});
