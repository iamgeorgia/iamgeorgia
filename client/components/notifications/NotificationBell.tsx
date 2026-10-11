"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";

import { describeError } from "@/lib/api/client";
import {
  fetchNotifications,
  markAllNotificationsRead,
  notificationHref,
  notificationsPath,
  type AppNotification,
  type NotificationScope,
} from "@/lib/api/notifications";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

const PREVIEW = 8;

/**
 * The bell in a panel's top bar.
 *
 * The count comes from the server with the page (the badges request in the
 * admin panel, the layout in the portal), so the bell paints with the right
 * number at once; the list behind it is fetched only when it is opened.
 * Marking everything read refreshes the route, which is what brings the
 * count back down.
 */
export function NotificationBell({
  scope,
  unreadCount,
  className,
}: {
  scope: NotificationScope;
  unreadCount: number;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const path = useLocalePath();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The dropdown and its list are stamped with the route they were opened
  // on, so a navigation closes it and forgets the list without an effect
  // reaching in: the next opening asks again, because the route it was read
  // on may have changed things.
  const [state, setState] = useState<{ route: string; open: boolean; items: AppNotification[] | null }>({
    route: pathname,
    open: false,
    items: null,
  });
  const { open, items } = state.route === pathname ? state : { open: false, items: null };
  // Stable across renders so the effect below can depend on it honestly.
  const setOpen = useCallback(
    (next: boolean) =>
      setState((current) => ({ route: pathname, open: next, items: current.route === pathname ? current.items : null })),
    [pathname],
  );
  const setItems = (update: (current: AppNotification[] | null) => AppNotification[] | null) =>
    setState((current) => ({ route: pathname, open: current.route === pathname ? current.open : false, items: update(current.route === pathname ? current.items : null) }));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || items !== null) return;

    setError(null);
    try {
      const page = await fetchNotifications(scope, { pageSize: PREVIEW });
      setItems(() => page.data);
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const readAll = async () => {
    setBusy(true);
    setError(null);
    try {
      await markAllNotificationsRead(scope);
      const readAt = new Date().toISOString();
      setItems((current) => current?.map((item) => ({ ...item, readAt: item.readAt ?? readAt })) ?? null);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const label = unreadCount === 0 ? "Notifications" : `Notifications, ${unreadCount} unread`;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex size-10 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-soft hover:text-ink"
      >
        <Bell size={18} aria-hidden />
        {unreadCount > 0 && (
          <span
            className="absolute top-1 end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[0.625rem] font-semibold text-on-dark ring-2 ring-background"
            aria-hidden
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Latest notifications"
          className="absolute top-full end-0 z-70 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-sm border border-line bg-surface shadow-lift"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <p className="text-[0.8125rem] font-medium text-ink">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void readAll()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-brand-text hover:text-brand-hover disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />}
                Mark all read
              </button>
            )}
          </div>

          {error && <p role="alert" className="px-4 py-3 text-[0.8125rem] text-error-text">{error}</p>}

          {items === null && !error ? (
            <p className="px-4 py-6 text-center text-[0.8125rem] text-muted">Loading…</p>
          ) : items && items.length === 0 ? (
            <p className="px-4 py-6 text-center text-[0.8125rem] text-muted">Nothing yet.</p>
          ) : (
            items && (
              <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
                {items.map((item) => {
                  const target = notificationHref(scope, item);
                  const inner = (
                    <>
                      <span className={cn("block text-[0.8125rem]", item.readAt ? "text-body" : "font-semibold text-ink")}>{item.title}</span>
                      <span className="mt-0.5 block truncate text-[0.75rem] text-muted">{item.body}</span>
                    </>
                  );
                  const rowClass = "block px-4 py-3 transition-colors hover:bg-surface-soft/60";

                  return (
                    <li key={item.id}>
                      {target ? (
                        <Link href={path(target)} prefetch={false} className={rowClass} onClick={() => setOpen(false)}>
                          {inner}
                        </Link>
                      ) : (
                        <div className={rowClass}>{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          )}

          <div className="border-t border-line px-4 py-2.5 text-center">
            <Link
              href={path(notificationsPath[scope])}
              prefetch={false}
              onClick={() => setOpen(false)}
              className="text-[0.8125rem] font-medium text-brand-text hover:text-brand-hover"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
