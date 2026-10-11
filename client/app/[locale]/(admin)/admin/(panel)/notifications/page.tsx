import type { Metadata } from "next";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { NotificationList } from "@/components/notifications/NotificationList";
import { listNotifications } from "@/lib/api/notifications";

export const metadata: Metadata = { title: "Notifications" };

/**
 * Everything the bell has ever shown this person, newest first. The rows are
 * the viewer's own — the server scopes the list on the session — so there is
 * nothing to filter by here beyond read or unread.
 */
export default async function AdminNotificationsPage() {
  const result = await listNotifications("admin", { pageSize: 50 });

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Notifications"
        description={
          result.unreadCount > 0
            ? `${result.unreadCount} unread. Payment reminders, overdue alerts and the queues that need a decision.`
            : "Payment reminders, overdue alerts and the queues that need a decision. Nothing unread."
        }
      />
      <div className="mt-8 max-w-3xl">
        <NotificationList scope="admin" notifications={result.data} unreadCount={result.unreadCount} />
      </div>
    </AdminContainer>
  );
}
