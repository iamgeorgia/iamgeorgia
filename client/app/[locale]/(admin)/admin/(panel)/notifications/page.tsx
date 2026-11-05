import type { Metadata } from "next";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { MarkAllReadButton } from "@/components/notifications/MarkAllReadButton";
import { NotificationsBrowser } from "@/components/notifications/NotificationsBrowser";
import {
  listNotifications,
  notificationBrowseStateFromParams,
  notificationCategoryLabels,
  notificationQueryFor,
} from "@/lib/api/notifications";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Notifications" };

/**
 * Everything the bell has ever shown this person, by tab. The rows are the
 * viewer's own — the server scopes the list on the session — so the only
 * narrowing is which tab, read or unread, and the order.
 */
export default async function AdminNotificationsPage({
  searchParams,
}: PageProps<"/[locale]/admin/notifications">) {
  await requireScreen();
  const state = notificationBrowseStateFromParams(await searchParams);
  const result = await listNotifications("admin", notificationQueryFor(state));

  const unreadInView = state.category ? (result.unreadByCategory?.[state.category] ?? 0) : result.unreadCount;
  const tab = state.category ? notificationCategoryLabels[state.category] : null;

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Notifications"
        description={
          result.unreadCount > 0
            ? `${result.unreadCount} unread${tab ? `, ${unreadInView} on ${tab}` : ""}. Bookings, dispatch, money, approvals and deadlines, each on its own tab.`
            : "Bookings, dispatch, money, approvals and deadlines, each on its own tab. Nothing unread."
        }
        actions={<MarkAllReadButton scope="admin" category={state.category} unreadCount={unreadInView} />}
      />
      <div className="mt-8 max-w-4xl">
        <NotificationsBrowser scope="admin" page={result} state={state} now={new Date().toISOString()} />
      </div>
    </AdminContainer>
  );
}
