import { prisma } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { CAPABILITIES } from '../../lib/permissions.js';
import { categoryOf } from '../../lib/notifications/categories.js';
import { usersWithCapability } from '../rbac/access.js';

/**
 * Tells the platform's administrators that outgoing mail needs them: the
 * Google grant was revoked, or the day's sends are close to Gmail's cap.
 *
 * In-app only, for the obvious reason. Everyone who administers the platform
 * hears it, not only those who can reconnect, because every one of them is
 * about to field "where is my confirmation?". One notice per person per
 * `dedupeKey`, so a drain retrying every few seconds does not ring the bell
 * every few seconds.
 */
/**
 * A test seam, like the mailer's `failDeliveryTo`: when set, only these users
 * are told. The suites share one database, and an alert that reached every
 * administrator in it would land in other files' counts and on demo accounts.
 */
export const alertScope = { userIds: null };

export const alertMailAdmins = async ({ title, body, dedupeKey }) => {
    try {
        const [admins, settings] = await Promise.all([
            usersWithCapability(CAPABILITIES.PLATFORM_ADMIN, { partnerId: null }),
            usersWithCapability(CAPABILITIES.SETTINGS_WRITE, { partnerId: null })
        ]);
        const recipients = [...new Set([...admins, ...settings])].filter((id) => !alertScope.userIds || alertScope.userIds.includes(id));

        if (recipients.length === 0) return;

        await prisma.notification.createMany({
            data: recipients.map((recipientUserId) => ({
                recipientUserId,
                kind: 'MAIL_PROVIDER_ALERT',
                category: categoryOf('MAIL_PROVIDER_ALERT'),
                title,
                body,
                payload: { link: '/admin/settings/email' },
                entityType: 'MailProviderCredential',
                entityId: 'gmail',
                dedupeKey
            })),
            skipDuplicates: true
        });
    } catch (err) {
        // The alert is about a failure; it must not become a second one.
        logger.error({ err }, 'Could not alert administrators about the mail provider');
    }
};
