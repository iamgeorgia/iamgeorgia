"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { RefreshCw } from "lucide-react";

import { formatTime } from "@/lib/admin/dispatch";
import { cn } from "@/lib/utils";

/** Coming back to the app after this long reads the page again. */
const STALE_AFTER_MS = 30_000;
/** While the screen stays open and in front, read it again this often. */
const POLL_MS = 120_000;

const editing = () => {
  const element = document.activeElement;
  return element instanceof HTMLElement && (element.matches("input, textarea, select") || element.isContentEditable);
};

/**
 * "Updated 21:02 · Refresh", and the reading behind it.
 *
 * A driver leaves the app for the maps app and comes back: the page is read
 * again on return, so a new offer or a change from dispatch is there without
 * a pull. While the screen stays in front it is read every two minutes. It
 * never refreshes under a driver who is typing — the decline reason or the
 * profile form keeps what was typed — nor while hidden, and the button
 * reads it now. `renderedAt` is the server's time for the data on screen.
 */
export function DriverFreshness({
  renderedAt,
  timeZone,
  className,
}: {
  renderedAt: string;
  timeZone: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const lastRead = useRef(Date.parse(renderedAt));

  useEffect(() => {
    lastRead.current = Date.parse(renderedAt);
  }, [renderedAt]);

  useEffect(() => {
    const read = () => {
      if (document.visibilityState !== "visible" || editing()) return;
      lastRead.current = Date.now();
      startTransition(() => router.refresh());
    };
    const wake = () => {
      if (Date.now() - lastRead.current > STALE_AFTER_MS) read();
    };
    const timer = window.setInterval(() => {
      if (Date.now() - lastRead.current >= POLL_MS) read();
    }, 15_000);

    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", read);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", read);
    };
  }, [router]);

  return (
    <div className={cn("flex items-center gap-1 text-[0.8125rem] text-muted", className)}>
      {/* Not a live region: an announcement every two minutes would be noise. */}
      <span className="whitespace-nowrap">
        {/* Below 360px the word gives way so the greeting and date beside it
            keep one line each; the time stays, and so does the full phrase
            for a screen reader. */}
        {pending ? (
          "Updating…"
        ) : (
          <>
            <span className="max-[359px]:sr-only">Updated </span>
            {formatTime(renderedAt, timeZone)}
          </>
        )}
      </span>
      <button
        type="button"
        onClick={() => {
          lastRead.current = Date.now();
          startTransition(() => router.refresh());
        }}
        disabled={pending}
        aria-label="Refresh"
        className="inline-flex size-11 items-center justify-center rounded-sm text-body transition-colors hover:bg-surface-soft hover:text-ink disabled:opacity-60"
      >
        <RefreshCw size={17} className={cn(pending && "animate-spin")} aria-hidden />
      </button>
    </div>
  );
}
