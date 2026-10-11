import type { Metadata } from "next";

import { MotionProvider } from "@/components/motion/MotionProvider";
import { PortalShell } from "@/components/partners/PortalShell";
import { getUnreadCount } from "@/lib/api/notifications";
import { getSession } from "@/lib/auth/session";
import { can } from "@/types/auth";
import { PANEL_NAMESPACES, pickClientDictionary } from "@/lib/i18n/client";
import { DictionaryProvider } from "@/lib/i18n/provider";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: {
    default: "Partner platform",
    template: "%s — I am Georgia Partners",
  },
  // A B2B surface has no business in an index.
  robots: { index: false, follow: false },
};

/**
 * The partner platform shell.
 *
 * Deliberately does not redirect an unapproved partner away: PENDING_APPROVAL,
 * REJECTED and SUSPENDED each have something to be told, and the pages below
 * decide what. What it does not do is grant anything — every protected endpoint
 * re-checks the status server-side, so a partner who reached this markup some
 * other way would still see nothing but 403s.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const [session, { t }] = await Promise.all([getSession(), getI18n()]);

  // The bell's number. Never lets a failed count take the portal down: a
  // partner who cannot see "2 unread" can still open the list.
  const unreadCount =
    session?.partner?.status === "APPROVED" && can(session, "notifications.read")
      ? await getUnreadCount("partner").catch(() => 0)
      : 0;

  return (
    <DictionaryProvider dictionary={pickClientDictionary(t, PANEL_NAMESPACES)}>
      <MotionProvider>
        <PortalShell session={session} unreadCount={unreadCount}>
          {children}
        </PortalShell>
      </MotionProvider>
    </DictionaryProvider>
  );
}
