"use client";

import { createContext, useContext, useMemo } from "react";

import { fetchAdminBadges } from "@/lib/api/admin";
import { useLivePoll } from "@/lib/live/useLivePoll";
import type { AdminBadges } from "@/lib/admin/navigation";

/**
 * One set of live counts for the whole shell.
 *
 * The page arrives with the counts from the server (the badges promise the
 * layout hands the shell, streamed in under Suspense); from then on this
 * re-reads `/api/admin/badges` every minute while the tab is on screen and
 * straight after any action that changes a number — marking a notice read,
 * deciding an approval. The bell, the sidebar's Notifications row and the
 * Booking approvals pill all read the same object, so they can never show
 * three different numbers.
 *
 * Nothing here suspends: the pieces that stream the first value keep doing
 * so, and `useLiveBadges` only swaps in the polled value once there is one.
 */

interface LiveCountsValue {
  badges: AdminBadges | null;
  refresh: () => Promise<void>;
}

const LiveCountsContext = createContext<LiveCountsValue | null>(null);

export function LiveBadgesProvider({ children }: { children: React.ReactNode }) {
  const { value, refresh } = useLivePoll(fetchAdminBadges, { intervalMs: 60_000 });
  const context = useMemo(() => ({ badges: value, refresh }), [value, refresh]);

  return <LiveCountsContext.Provider value={context}>{children}</LiveCountsContext.Provider>;
}

/**
 * A panel without badges — the portal — still needs its bell and its
 * notifications page to say "re-read the count" after an action, so it
 * provides just the refresh.
 */
export function LiveRefreshProvider({ refresh, children }: { refresh: () => Promise<void>; children: React.ReactNode }) {
  const context = useMemo(() => ({ badges: null, refresh }), [refresh]);

  return <LiveCountsContext.Provider value={context}>{children}</LiveCountsContext.Provider>;
}

/** The latest counts: the polled ones once they exist, else what the page came with. */
export function useLiveBadges(initial: AdminBadges): AdminBadges {
  return useContext(LiveCountsContext)?.badges ?? initial;
}

/**
 * Asks the shell to re-read its counts now. Null outside a shell that keeps
 * any — the driver panel — so a caller falls back to a route refresh.
 */
export function useRefreshLiveCounts(): (() => Promise<void>) | null {
  return useContext(LiveCountsContext)?.refresh ?? null;
}
