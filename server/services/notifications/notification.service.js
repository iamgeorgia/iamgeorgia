import { prisma } from '../../db/index.js';
import { NotFoundError } from '../../lib/errors.js';
import { NOTIFICATION_CATEGORIES } from '../../lib/notifications/categories.js';

export { toNotification, notificationHref } from '../../serializers/notification.js';

/**
 * In-app notifications: the bell in every panel. Rows are written by the
 * outbox drain, never by a request handler, so every channel sees each
 * event exactly once; what is here is reading them back.
 */

const ORDER_BY = {
    newest: [{ createdAt: 'desc' }],
    oldest: [{ createdAt: 'asc' }],
    // Nulls first in Postgres for a descending sort: the unread rows, newest first, then the rest.
    unreadFirst: [{ readAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }]
};

const whereFor = (userId, { unread = false, category = null, kind = null } = {}) => ({
    recipientUserId: userId,
    ...(unread ? { readAt: null } : {}),
    ...(category ? { category } : {}),
    ...(kind ? { kind: { in: Array.isArray(kind) ? kind : [kind] } } : {})
});

/** What is unread, in total and per tab, for the badge and the tab counts. */
export const unreadSummary = async (userId) => {
    const grouped = await prisma.notification.groupBy({
        by: ['category'],
        where: { recipientUserId: userId, readAt: null },
        _count: { _all: true }
    });

    const byCategory = Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, 0]));

    for (const row of grouped) {
        byCategory[row.category] = row._count._all;
    }

    return { unreadCount: Object.values(byCategory).reduce((sum, count) => sum + count, 0), byCategory };
};

export const listNotifications = async (userId, { unread = false, category = null, kind = null, sort = 'newest', page = 1, pageSize = 25 } = {}) => {
    const where = whereFor(userId, { unread, category, kind });

    const [total, summary, notifications] = await Promise.all([
        prisma.notification.count({ where }),
        unreadSummary(userId),
        prisma.notification.findMany({
            where,
            orderBy: ORDER_BY[sort] ?? ORDER_BY.newest,
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return {
        notifications,
        total,
        unreadCount: summary.unreadCount,
        unreadByCategory: summary.byCategory,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
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

export const markAllNotificationsRead = (userId, { category = null } = {}) =>
    prisma.notification.updateMany({ where: { recipientUserId: userId, readAt: null, ...(category ? { category } : {}) }, data: { readAt: new Date() } });
