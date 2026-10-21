"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A value the browser keeps fresh on its own.
 *
 * The page arrives with a number from the server; this re-asks for it every
 * `intervalMs` while the tab is on screen, again when the tab comes back
 * (`visibilitychange` to visible, `focus`), and whenever a caller says so
 * after an action it knows changed the answer. A hidden tab asks nothing:
 * ten panels left open overnight must not add up to a load.
 *
 * A failed poll is swallowed and the last good value kept — a count that is
 * a minute stale is better than an error boundary over the whole shell.
 */
export function useLivePoll<T>(
  fetcher: () => Promise<T>,
  { intervalMs = 60_000, enabled = true }: { intervalMs?: number; enabled?: boolean } = {},
): { value: T | null; refresh: () => Promise<void> } {
  const [value, setValue] = useState<T | null>(null);
  // The latest fetcher, read only from effects and handlers, so a caller may
  // pass an inline closure without the interval being torn down each render.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const inFlight = useRef<Promise<void> | null>(null);
  const lastAt = useRef(0);

  // One request at a time: a focus and a visibility change fire together,
  // and a second poll while the first is still out would answer twice.
  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;

    inFlight.current = fetcherRef
      .current()
      .then((next) => {
        lastAt.current = Date.now();
        setValue(next);
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = null;
      });

    return inFlight.current;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const visible = () => document.visibilityState === "visible";
    // Coming back to a tab polled a few seconds ago is not worth a request.
    const wake = () => {
      if (visible() && Date.now() - lastAt.current > intervalMs / 6) void refresh();
    };
    const tick = () => {
      if (visible()) void refresh();
    };

    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [enabled, intervalMs, refresh]);

  return { value, refresh };
}
