import { AdminShell } from "@/components/admin/AdminShell";
import { NO_BADGES, getAdminBadges } from "@/lib/api/admin";
import { requireAdminSession } from "@/lib/auth/session";

/**
 * The panel shell — sidebar, top bar and working area.
 *
 * This is also where the panel stops being readable to someone who has not
 * signed in as an admin. It is a redirect for the sake of the visitor, not a
 * security boundary: every endpoint behind it re-checks the session and the
 * role, so a viewer who reached this markup some other way would still see an
 * empty page full of 401s.
 *
 * The queue counts are requested here rather than in the sidebar, so the
 * navigation stays presentational and the numbers come from one place — one
 * aggregate request, which the API scopes to the viewer's role itself.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminSession();

  // Not awaited: the shell renders at once and the pills fill in when the
  // counts arrive, so no screen waits on decoration. The counts must never
  // take the panel down either — an operator who cannot see "3 pending" can
  // still open the queue and count — so a failure is logged and read as zeros.
  const badges = getAdminBadges().catch((error: unknown) => {
    console.error("Admin queue counts failed:", error);
    return NO_BADGES;
  });

  return (
    <AdminShell badges={badges} user={session.user}>
      {children}
    </AdminShell>
  );
}
