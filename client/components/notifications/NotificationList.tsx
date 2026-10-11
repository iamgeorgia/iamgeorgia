"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { describeError } from "@/lib/api/client";
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
  type AppNotification,
  type NotificationScope,
} from "@/lib/api/notifications";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * One person's notices, newest first, with a tick to mark each read and one
 * button for all of them. Shared by the three panels; `scope` picks the
 * router and decides where a row links.
 */
export function NotificationList({
  scope,
  notifications,
  unreadCount,
}: {
  scope: NotificationScope;
  notifications: AppNotification[];
  unreadCount: number;
}) {
  const router = useRouter();
  const path = useLocalePath();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, call: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);

    try {
      await call();
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {unreadCount > 0 && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("all", () => markAllNotificationsRead(scope))}
          className="mb-4 inline-flex h-10 items-center gap-2 rounded-sm border border-line px-4 text-[0.875rem] font-medium text-body hover:border-ink/40 disabled:opacity-50"
        >
          {busy === "all" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
          Mark all as read
        </button>
      )}

      {error && <p role="alert" className="mb-3 text-[0.875rem] text-error-text">{error}</p>}

      {notifications.length === 0 ? (
        <p className="rounded-sm border border-dashed border-line p-6 text-center text-[0.9375rem] text-muted">Nothing yet.</p>
      ) : (
        <ul className="space-y-2">
          {notifications.map((notification) => {
            const target = notificationHref(scope, notification);
            const inner = (
              <>
                <p className={cn("text-[0.9375rem]", notification.readAt ? "text-body" : "font-semibold text-ink")}>{notification.title}</p>
                <p className="mt-0.5 text-[0.8125rem] text-muted">{notification.body}</p>
                <p className="mt-1 text-[0.75rem] text-subtle">{new Date(notification.createdAt).toLocaleString("en-GB")}</p>
              </>
            );

            return (
              <li
                key={notification.id}
                className={cn("flex items-start gap-3 rounded-sm border bg-surface p-4", notification.readAt ? "border-line" : "border-brand/50")}
              >
                <div className="min-w-0 flex-1">{target ? <Link href={path(target)} prefetch={false}>{inner}</Link> : inner}</div>
                {!notification.readAt && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void run(notification.id, () => markNotificationRead(scope, notification.id))}
                    aria-label="Mark as read"
                    className="shrink-0 rounded-sm border border-line p-2 text-subtle hover:text-ink disabled:opacity-50"
                  >
                    {busy === notification.id ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
