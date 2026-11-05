"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { classifyFailure, retryDelayMs, type TransientFailure } from "./transient";

/**
 * How often each screen has been retried automatically.
 *
 * Kept outside React because nothing inside it lasts long enough: a retry
 * that succeeds unmounts the boundary's component, and one that fails hands
 * it a new error with no count attached. Without this a screen that keeps
 * failing would be retried for ever. One entry is enough — a person is on one
 * screen — and it lapses, so a failure an hour later starts afresh.
 */
const retried = { key: "", count: 0, at: 0 };
const LAPSE_MS = 2 * 60_000;

const attemptsFor = (key: string, now: number) => (retried.key === key && now - retried.at < LAPSE_MS ? retried.count : 0);

export interface AutoRetry {
  /** What kind of passing failure this was; null for one that will not pass by itself. */
  failure: TransientFailure | null;
  /** Whole seconds until the automatic retry; null when none is coming. */
  secondsLeft: number | null;
}

/**
 * Retries an error boundary's screen by itself when the failure was one that
 * passes — an interrupted load, a paced request, an API that did not answer —
 * and reports what is happening so the boundary can say so. A real failure,
 * or one that has outlasted its retries, is left to the "Try again" button.
 *
 * Planned per error object, not per mount: a retry that fails inside the
 * router's transition gives the same mounted component a new `error`, and
 * that one needs its own wait.
 */
export function useAutoRetry(error: unknown, retry: () => void): AutoRetry {
  const pathname = usePathname();
  const failure = useMemo(() => classifyFailure(error), [error]);
  const [countdown, setCountdown] = useState<{ failure: TransientFailure; secondsLeft: number } | null>(null);

  // The latest `retry`, so a parent re-render cannot restart the wait.
  const retryRef = useRef(retry);
  useEffect(() => {
    retryRef.current = retry;
  });

  useEffect(() => {
    if (!failure) return;

    const startedAt = Date.now();
    const delayMs = retryDelayMs(failure, attemptsFor(pathname, startedAt));
    if (delayMs === null) return;

    const due = startedAt + delayMs;
    const show = () => setCountdown({ failure, secondsLeft: Math.max(0, Math.ceil((due - Date.now()) / 1000)) });
    const first = setTimeout(show, 0);
    const tick = setInterval(show, 500);
    const timer = setTimeout(() => {
      const firedAt = Date.now();
      retried.count = attemptsFor(pathname, firedAt) + 1;
      retried.key = pathname;
      retried.at = firedAt;
      retryRef.current();
    }, delayMs);

    return () => {
      clearTimeout(first);
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [failure, pathname]);

  // A countdown belongs to the failure it was started for; the one left over
  // from the previous error says nothing about this one.
  return { failure, secondsLeft: countdown?.failure === failure ? countdown.secondsLeft : null };
}
