import type { Metadata } from "next";

import { MotionProvider } from "@/components/motion/MotionProvider";
import { PortalShell } from "@/components/partners/PortalShell";
import { getSession } from "@/lib/auth/session";

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
  const session = await getSession();

  return (
    <MotionProvider>
      <PortalShell session={session}>{children}</PortalShell>
    </MotionProvider>
  );
}
