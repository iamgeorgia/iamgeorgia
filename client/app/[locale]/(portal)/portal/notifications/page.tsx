import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NotificationList } from "@/components/notifications/NotificationList";
import { Container } from "@/components/ui/Container";
import { ApiError } from "@/lib/api/client";
import { listNotifications } from "@/lib/api/notifications";
import { isTermsOutdated } from "@/lib/partners/terms";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { can, homePathFor } from "@/types/auth";

export const metadata: Metadata = { title: "Notifications" };

/**
 * The portal's bell, in full: a driver confirmed, a payment received, a bill
 * overdue. Rows are the signed-in person's own — the server scopes the list
 * on the session — and the gate matches the rest of the portal: an approved
 * company only.
 */
export default async function PortalNotificationsPage() {
  const session = await getSession();
  const locale = await getLocale();

  if (!session) redirect(localePath(locale, "/portal/sign-in"));

  if (!session.partner) {
    redirect(localePath(locale, homePathFor(session)));
  }

  if (session.partner.status !== "APPROVED" || !can(session, "notifications.read")) {
    redirect(localePath(locale, "/portal"));
  }

  let result;
  try {
    result = await listNotifications("partner", { pageSize: 50 });
  } catch (error) {
    // The same gate as the rest of the portal: until the owner accepts the
    // current platform terms, that page is the only way on — not a 500.
    if (error instanceof ApiError && error.status === 403 && isTermsOutdated(error)) {
      redirect(localePath(locale, "/portal/terms"));
    }
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      redirect(localePath(locale, error.status === 401 ? "/portal/sign-in" : "/portal"));
    }
    throw error;
  }

  return (
    <Container className="py-10 sm:py-12">
      <div className="max-w-3xl">
        <h1 className="font-display text-[1.75rem] leading-tight text-ink">Notifications</h1>
        <p className="mt-2 text-[0.9375rem] text-muted">
          {result.unreadCount > 0 ? `${result.unreadCount} unread.` : "Nothing unread."} Bookings, drivers and your account with us.
        </p>
        <div className="mt-6">
          <NotificationList scope="partner" notifications={result.data} unreadCount={result.unreadCount} />
        </div>
      </div>
    </Container>
  );
}
