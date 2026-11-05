"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * How long after the document has ended a skeleton may still be on screen
 * before it is taken for abandoned. The records and the end of the document
 * arrive together when a load completes, so this only has to cover the frames
 * React takes to swap the skeleton out.
 */
const GRACE_MS = 1500;

/**
 * Rescues a screen whose load was stopped after the shell had rendered.
 *
 * A panel screen streams: the shell and the loading skeleton arrive first,
 * the records follow in the same response. Stop the page in between — the
 * stop button, a refresh abandoned halfway — and the browser ends the
 * document without the rest. Nothing fails, so no error boundary hears of it:
 * the skeleton is simply never replaced, and the screen sits there pulsing
 * until the operator thinks to reload.
 *
 * The one moment that can be told apart from an ordinary slow load is this:
 * the document is `complete` — the response is over, nothing more can come —
 * and the skeleton it arrived with is still in the page. Then the screen is
 * asked for again, the way "Try again" would. A skeleton shown by a later
 * click on the sidebar is a different element, fed by a request of its own,
 * and is never mistaken for it.
 *
 * (The other half of the same accident — stopped *before* the shell rendered —
 * does throw, and the panel's error boundary retries it; see
 * `lib/errors/useAutoRetry.ts`.)
 */
export function StalledLoadRecovery() {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      if (document.readyState !== "complete" || timer !== undefined) return;

      const skeleton = document.querySelector("[data-skeleton]");
      if (!skeleton) return;

      timer = setTimeout(() => {
        if (skeleton.isConnected) router.refresh();
      }, GRACE_MS);
    };

    check();
    document.addEventListener("readystatechange", check);

    return () => {
      document.removeEventListener("readystatechange", check);
      clearTimeout(timer);
    };
  }, [router]);

  return null;
}
