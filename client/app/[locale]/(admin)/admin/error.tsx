"use client";

import Link from "next/link";
import { Loader2, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { failureCopy } from "@/lib/errors/failureCopy";
import { useAutoRetry } from "@/lib/errors/useAutoRetry";
import { useLocalePath } from "@/lib/i18n/provider";

/**
 * Catches what the panel's own boundary cannot: a failure in the panel shell
 * itself — the session check or the queue counts refusing to render — and
 * anything thrown by the sign-in screen. There is no shell to keep at this
 * level, so the page is deliberately bare.
 *
 * The session check is a request like any other, so the same passing
 * failures reach this level — a refresh cut short, the API pacing a burst —
 * and are retried the same way (`useAutoRetry`).
 */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const path = useLocalePath();
  const auto = useAutoRetry(error, retry);
  const copy = failureCopy(auto, "admin panel");
  const retrying = copy?.status != null;

  useEffect(() => {
    console.error("Admin error:", error);
  }, [error]);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-24 text-center">
      <span
        className={`flex size-14 items-center justify-center rounded-full bg-surface-soft ${retrying ? "text-muted" : "text-error-text"}`}
      >
        {retrying ? <Loader2 size={24} className="animate-spin" aria-hidden /> : <TriangleAlert size={24} aria-hidden />}
      </span>

      <h1 className="mt-6 font-display text-2xl text-ink">{copy?.title ?? "The admin panel could not load"}</h1>
      <p className="mt-3 max-w-md text-[0.9375rem] leading-relaxed text-muted">
        {copy?.body ?? "The server did not answer. Try again in a moment, or sign in afresh if the problem persists."}
      </p>

      {copy?.status && (
        <p role="status" className="mt-3 text-[0.875rem] font-medium text-body">
          {copy.status}
        </p>
      )}

      {error.digest && !copy && (
        <p className="mt-3 text-[0.8125rem] text-subtle">Reference: {error.digest}</p>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex h-11 items-center rounded-sm bg-brand px-5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-hover"
        >
          Try again
        </button>
        <Link
          href={path("/admin/sign-in")}
          className="inline-flex h-11 items-center rounded-sm border border-ink/20 px-5 text-[0.875rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
