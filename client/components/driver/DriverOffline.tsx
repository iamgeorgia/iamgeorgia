"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

const subscribe = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

/**
 * A strip under the top bar while the phone has no connection — common on a
 * mountain road. What is on screen stays readable; the buttons need the
 * network, so the driver is told why one will not work before pressing it.
 * Rendered as online on the server, so nothing shows until the phone says
 * otherwise.
 */
export function DriverOffline() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );

  return (
    // Always mounted, empty while online: a live region must exist before
    // its message arrives to be announced.
    <div role="status">
      {!online && (
        <p className="flex items-start gap-2.5 border-b border-warning/40 bg-warning/10 px-4 py-2.5 text-[0.875rem] leading-snug text-ink">
          <WifiOff size={16} className="mt-0.5 shrink-0 text-warning-text" aria-hidden />
          <bdi>You are offline. What you see may be out of date, and the buttons work again once you are back online.</bdi>
        </p>
      )}
    </div>
  );
}
