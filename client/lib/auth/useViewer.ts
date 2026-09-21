"use client";

import { useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import type { Session } from "@/types/auth";

/**
 * Who the viewer is, from the browser.
 *
 * The site layout is deliberately *not* session-aware on the server: reading
 * `cookies()` there would put the session in front of every marketing page's
 * shell, chrome included. So the one place the chrome needs to know who is
 * signed in — the link into the staff surfaces — asks after hydration
 * instead, and renders a sensible signed-out default until the answer arrives.
 *
 * The promise is cached at module scope, so a page with several consumers, and
 * a client-side navigation between pages, all share one request. It is
 * deliberately not persisted: a stale "you are signed in" surviving a sign-out
 * in another tab would be worse than a request.
 */

let pending: Promise<Session | null> | null = null;

const probe = (): Promise<Session | null> => {
  pending ??= apiFetch<Session>("/api/auth/me").catch((error: unknown) => {
    // Signed out is a definite answer. Anything else — offline, a timeout, a
    // 500 — is no answer at all, and must not be rendered as "not signed in":
    // a partner would watch their account link flicker away on a bad hotspot.
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return null;
    }
    // Forget the failed attempt so the next mount asks again.
    pending = null;
    throw error;
  });
  return pending;
};

/** Clears the cache — call after signing in or out within the same document. */
export const forgetViewer = () => {
  pending = null;
};

export interface Viewer {
  session: Session | null;
  /**
   * True until a definite answer arrives. Render the signed-out state
   * meanwhile — but it is "not known yet", not "signed out": a probe that
   * failed to reach the server leaves this true rather than lying.
   */
  loading: boolean;
}

export function useViewer(): Viewer {
  const [viewer, setViewer] = useState<Viewer>({ session: null, loading: true });

  useEffect(() => {
    let active = true;

    probe().then(
      (session) => {
        if (active) setViewer({ session, loading: false });
      },
      () => {
        // No answer: keep the previous state, which is the honest one.
      },
    );

    return () => {
      active = false;
    };
  }, []);

  return viewer;
}
