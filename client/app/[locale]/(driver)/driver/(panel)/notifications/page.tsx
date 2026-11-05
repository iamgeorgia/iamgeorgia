import type { Metadata } from "next";

import { DriverPageHeader } from "@/components/driver/DriverPage";
import { NotificationList } from "@/components/notifications/NotificationList";
import { listNotifications } from "@/lib/api/notifications";

export const metadata: Metadata = { title: "Notifications" };

export default async function DriverNotificationsPage() {
  const result = await listNotifications("driver", { pageSize: 50 });

  return (
    <>
      <DriverPageHeader
        title="Notifications"
        meta={result.unreadCount > 0 ? `${result.unreadCount} unread` : "Nothing unread"}
      />
      <NotificationList scope="driver" notifications={result.data} unreadCount={result.unreadCount} />
    </>
  );
}
