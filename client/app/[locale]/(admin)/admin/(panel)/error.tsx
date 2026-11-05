"use client";

import Link from "next/link";
import { Loader2, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { AdminContainer } from "@/components/admin/AdminPage";
import { failureCopy } from "@/lib/errors/failureCopy";
import { useAutoRetry } from "@/lib/errors/useAutoRetry";
import { useLocalePath } from "@/lib/i18n/provider";

/**
 * The panel's error boundary. A screen that throws — most often because the
 * API did not answer in time — is replaced by this, inside the shell, so the
 * operator keeps the sidebar and can carry on with something else while the
 * failing screen is retried. Failures in the shell itself (the session check,
 * the layout) fall through to `../error.tsx`, which has no shell to keep.
 *
 * `retry` rather than `reset`: the screen's data comes from a server render,
 * and re-rendering the same failed payload would only fail the same way.
 *
 * Most of what lands here is not a broken screen but a bad moment: the page
 * was stopped or refreshed again before its records had streamed in, the API
 * paced a burst of refreshes, or it did not answer. Those pass by themselves,
 * so the boundary says which it was and asks again without being told to
 * (`useAutoRetry`); only a failure that would repeat waits for the button.
 */
export default function PanelError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const path = useLocalePath();
  const auto = useAutoRetry(error, retry);
  const copy = failureCopy(auto, "screen");
  const retrying = copy?.status != null;

  useEffect(() => {
    // A live product would report this. Here it is the only place the console
    // should ever hear from a panel screen.
    console.error("Admin panel error:", error);
  }, [error]);

  return (
    <AdminContainer>
      <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-line bg-surface-soft/40 px-6 py-24 text-center">
        <span
          className={`flex size-14 items-center justify-center rounded-full bg-background ${retrying ? "text-muted" : "text-error-text"}`}
        >
          {retrying ? <Loader2 size={24} className="animate-spin" aria-hidden /> : <TriangleAlert size={24} aria-hidden />}
        </span>

        <h1 className="mt-6 font-display text-2xl text-ink">{copy?.title ?? "This screen could not load"}</h1>
        <p className="mt-3 max-w-md text-[0.9375rem] leading-relaxed text-muted">
          {copy?.body ??
            "The records behind it did not come back. Nothing has been changed — try again, or carry on from the overview."}
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
            href={path("/admin")}
            className="inline-flex h-11 items-center rounded-sm border border-ink/20 px-5 text-[0.875rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft"
          >
            Back to overview
          </Link>
        </div>
      </div>
    </AdminContainer>
  );
}
