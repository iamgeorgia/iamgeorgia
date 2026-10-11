import type { Metadata } from "next";

import { NotificationList } from "@/components/notifications/NotificationList";
import { listNotifications } from "@/lib/api/notifications";

export const metadata: Metadata = { title: "Notifications" };

export default async function DriverNotificationsPage() {
  const result = await listNotifications("driver", { pageSize: 50 });

  return (
    <section aria-labelledby="driver-notifications">
      <h1 id="driver-notifications" className="text-[1.125rem] font-semibold text-ink">
        Notifications
      </h1>
      <div className="mt-3">
        <NotificationList scope="driver" notifications={result.data} unreadCount={result.unreadCount} />
      </div>
    </section>
  );
}
