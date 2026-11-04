"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { describeError } from "@/lib/api/client";
import {
  hrefFor,
  markAllNotificationsRead,
  markNotificationRead,
  notificationCategoryLabel,
  type AppNotification,
  type NotificationScope,
} from "@/lib/api/notifications";
import { DRIVER_FALLBACK_TIME_ZONE } from "@/lib/driver/assignment";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * When a notice was sent, as a driver reads a clock: "4 Nov, 13:43", with the
 * year only once it is not this one. Pinned to Georgian time, where the jobs
 * are, so the server's render and the phone's agree.
 */
function sentAt(iso: string) {
  const date = new Date(iso);
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DRIVER_FALLBACK_TIME_ZONE,
  }).format(date);
}

/**
 * One person's notices, newest first, with a tick to mark each read and one
 * button for all of them. The driver panel's list; the admin panel and the
 * portal browse theirs by tab in `NotificationsBrowser`. `scope` picks the
 * router and the fallback for where a row links.
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
          className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.875rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-50"
        >
          {busy === "all" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
          Mark all as read
        </button>
      )}

      {error && <p role="alert" className="mb-3 text-[0.875rem] text-error-text">{error}</p>}

      {notifications.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-5 py-8 text-center text-[0.9375rem] text-muted">
          <bdi>Nothing yet. Offers, changes to your jobs and messages from dispatch arrive here.</bdi>
        </p>
      ) : (
        <ul className="space-y-2">
          {notifications.map((notification) => {
            const target = hrefFor(scope, notification);
            const inner = (
              <>
                <p className="text-[0.6875rem] font-semibold tracking-[0.12em] text-subtle uppercase">
                  {notificationCategoryLabel(notification.category)}
                </p>
                <p className={cn("mt-0.5 text-[0.9375rem]", notification.readAt ? "text-body" : "font-semibold text-ink")}>{notification.title}</p>
                <p className="mt-0.5 text-[0.8125rem] text-muted">{notification.body}</p>
                <p className="mt-1 text-[0.75rem] text-subtle">
                  <time dateTime={notification.createdAt} dir="ltr">
                    {sentAt(notification.createdAt)}
                  </time>
                </p>
              </>
            );

            return (
              <li
                key={notification.id}
                className={cn("flex items-start gap-3 rounded-md border bg-surface p-4", notification.readAt ? "border-line" : "border-brand/50")}
              >
                <div className="min-w-0 flex-1 wrap-break-word">{target ? <Link href={path(target)} prefetch={false} className="block rounded-xs">{inner}</Link> : inner}</div>
                {!notification.readAt && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void run(notification.id, () => markNotificationRead(scope, notification.id))}
                    aria-label={`Mark “${notification.title}” as read`}
                    className="-me-1 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-sm border border-line text-subtle transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-50"
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
