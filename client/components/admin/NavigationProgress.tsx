"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * "Something is loading" for the whole panel, from the click to the commit.
 *
 * The panel's loading boundary paints a skeleton the moment the router
 * commits a navigation. What it cannot cover is the stretch before that:
 * when the destination has not been prefetched yet — a cold dev server, a
 * slow connection, a click a second after landing — the click has registered
 * but nothing on screen can change until the shell arrives. The clicked
 * sidebar row lights up, and this bar runs along the top of the working area,
 * so the operator is told the panel is working rather than left to wonder
 * whether the click took.
 *
 * Pending state is reported by the links themselves through `useLinkStatus`,
 * which is the only honest source: it is true exactly while the router is
 * still fetching that link's destination. Counted rather than toggled, so two
 * quick clicks cannot leave the bar stuck on or switch it off early.
 */

interface NavigationProgressValue {
  pending: boolean;
  /** Adds or removes one pending navigation. Returns nothing; callers pair the calls. */
  report: (delta: 1 | -1) => void;
}

const NavigationProgressContext = createContext<NavigationProgressValue | null>(null);

export function NavigationProgressProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);
  const report = useCallback((delta: 1 | -1) => setCount((value) => Math.max(0, value + delta)), []);
  const value = useMemo(() => ({ pending: count > 0, report }), [count, report]);

  return (
    <NavigationProgressContext.Provider value={value}>{children}</NavigationProgressContext.Provider>
  );
}

/**
 * Reports a link's pending state to the provider for as long as it lasts.
 * Safe outside a provider, so the sidebar can be rendered on its own.
 */
export function useReportPendingNavigation(pending: boolean) {
  const context = useContext(NavigationProgressContext);
  const report = context?.report;
  const reported = useRef(false);

  useEffect(() => {
    if (!report || !pending || reported.current) return;
    reported.current = true;
    report(1);
    return () => {
      reported.current = false;
      report(-1);
    };
  }, [pending, report]);
}

/** The bar itself. Sits at the top of the working area; invisible when idle. */
export function NavigationProgressBar() {
  const context = useContext(NavigationProgressContext);
  const pending = context?.pending ?? false;

  return (
    <div
      role="progressbar"
      aria-label="Loading section"
      aria-valuetext={pending ? "Loading" : "Idle"}
      aria-hidden={!pending}
      data-nav-progress={pending || undefined}
      className="pointer-events-none absolute inset-x-0 top-full h-0.5 overflow-hidden"
    >
      {pending && <span className="admin-progress-bar block h-full w-1/3 bg-brand" />}
    </div>
  );
}
