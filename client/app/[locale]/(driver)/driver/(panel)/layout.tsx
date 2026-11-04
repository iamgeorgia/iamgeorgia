import { Link2Off } from "lucide-react";

import { DriverShell } from "@/components/driver/DriverShell";
import { listDriverNotifications } from "@/lib/api/driverPanel";
import { requireDriverSession } from "@/lib/auth/session";

/**
 * Everything a signed-in driver sees.
 *
 * A DRIVER account whose profile has not been linked yet gets an explanation
 * rather than a redirect loop: the fix is on the operations side, and the
 * driver can do nothing but wait for it.
 */
export default async function DriverPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireDriverSession();

  // The driver API has no unread-count route; the bell's number is the total
  // of a one-row page of unread notices. A failed read leaves the bell at zero
  // rather than taking the panel down with it.
  let unreadCount = 0;
  if (session.driver) {
    try {
      unreadCount = (await listDriverNotifications({ unread: "true", pageSize: 1 })).unreadCount;
    } catch {
      unreadCount = 0;
    }
  }

  return (
    <DriverShell session={session} unreadCount={unreadCount}>
      {session.driver ? (
        children
      ) : (
        <div className="mx-auto max-w-xl rounded-md border border-warning/40 bg-warning/5 p-5 sm:p-6">
          <span className="flex size-11 items-center justify-center rounded-full bg-warning/15 text-warning-text" aria-hidden>
            <Link2Off size={20} />
          </span>
          <h1 className="mt-4 text-[1.25rem] leading-snug font-semibold text-ink">
            Your account is not linked to a driver profile yet
          </h1>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">
            <bdi>
              Operations will connect your login to your profile. Until then there is nothing to show here — please
              contact dispatch if this takes longer than expected.
            </bdi>
          </p>
        </div>
      )}
    </DriverShell>
  );
}
