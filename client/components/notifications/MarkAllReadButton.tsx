"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { useRefreshLiveCounts } from "@/components/admin/LiveBadgesContext";
import { describeError } from "@/lib/api/client";
import {
  markAllNotificationsRead,
  notificationCategoryLabels,
  type NotificationCategory,
  type NotificationScope,
} from "@/lib/api/notifications";
import { cn } from "@/lib/utils";

/**
 * The page's one header action. Clears the tab in view when one is
 * selected, else everything; then the route is re-read so the rows lose
 * their weight and the counts in the tabs and the shell follow.
 */
export function MarkAllReadButton({
  scope,
  category,
  unreadCount,
  className,
}: {
  scope: NotificationScope;
  /** The tab in view; absent on "All". */
  category?: NotificationCategory;
  /** What the button would clear. Hidden at zero. */
  unreadCount: number;
  className?: string;
}) {
  const router = useRouter();
  const refreshCounts = useRefreshLiveCounts();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (unreadCount === 0 && !error) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await markAllNotificationsRead(scope, category);
      if (refreshCounts) void refreshCounts();
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const label = category ? `Mark ${notificationCategoryLabels[category]} read` : "Mark all read";

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        disabled={busy || unreadCount === 0}
        onClick={() => void run()}
        className="inline-flex h-10 items-center gap-2 rounded-sm border border-line px-4 text-[0.8125rem] font-semibold text-body transition-colors hover:border-ink/40 hover:text-ink disabled:pointer-events-none disabled:opacity-50"
      >
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
        {label}
        <span className="text-muted tabular-nums">({unreadCount})</span>
      </button>
      {error && (
        <p role="alert" className="text-[0.75rem] text-error-text">
          {error}
        </p>
      )}
    </div>
  );
}
