"use client";

import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlarmClock,
  ArrowUpRight,
  Banknote,
  CalendarCheck,
  Check,
  ClipboardCheck,
  Info,
  Loader2,
  Radio,
  type LucideIcon,
} from "lucide-react";
import { useState, useTransition } from "react";

import { useRefreshLiveCounts } from "@/components/admin/LiveBadgesContext";
import { FilterChip } from "@/components/ui/FilterChip";
import { timeAgo } from "@/lib/admin/bookingApprovals";
import { describeError } from "@/lib/api/client";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SORTS,
  hrefFor,
  markNotificationRead,
  notificationCategoryLabel,
  notificationCategoryLabels,
  notificationSortLabels,
  type AppNotification,
  type NotificationBrowseState,
  type NotificationCategory,
  type NotificationPage,
  type NotificationScope,
} from "@/lib/api/notifications";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Everything the bell has ever shown this person, by tab.
 *
 * The tab, the unread switch, the order and the page live in the URL, as on
 * every register, so a view is shareable and the server does the narrowing;
 * the rows and the per-tab counts arrive with the page. Marking a row read
 * is optimistic — it loses its weight at once — and then the route is
 * re-read so the counts in the tabs and the shell agree with the server.
 */

const CATEGORY_ICONS: Record<NotificationCategory, LucideIcon> = {
  BOOKING: CalendarCheck,
  DISPATCH: Radio,
  FINANCE: Banknote,
  APPROVAL: ClipboardCheck,
  DEADLINE: AlarmClock,
  SYSTEM: Info,
};

const categoryIcon = (category: string): LucideIcon =>
  CATEGORY_ICONS[category as NotificationCategory] ?? CATEGORY_ICONS.SYSTEM;

const pagerButton =
  "inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft disabled:pointer-events-none disabled:opacity-40";

/** What an empty tab says, so the reader knows the filter worked. */
const emptyMessage = (state: NotificationBrowseState): string => {
  const tab = state.category ? `the ${notificationCategoryLabels[state.category]} tab` : "any tab";
  if (state.unread) return `Nothing unread on ${tab}.`;
  return state.category ? `Nothing on ${tab} yet.` : "No notifications yet.";
};

export function NotificationsBrowser({
  scope,
  page,
  state,
  now,
  categories = NOTIFICATION_CATEGORIES,
}: {
  scope: NotificationScope;
  page: NotificationPage;
  state: NotificationBrowseState;
  /** The server's clock at render, so "2 hours ago" agrees across hydration. */
  now: string;
  /** The tabs to offer beside "All". The admin panel shows every one; the portal only those with something on them. */
  categories?: readonly NotificationCategory[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const localePath = useLocalePath();
  const refreshCounts = useRefreshLiveCounts();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Rows marked read here before the server has re-listed them.
  const [readHere, setReadHere] = useState<Record<string, string>>({});

  const at = new Date(now);

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }

    // A different tab or filter makes the old page number meaningless.
    if (!("page" in changes)) next.delete("page");

    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  };

  const rows = page.data.map((row) => (row.readAt || !readHere[row.id] ? row : { ...row, readAt: readHere[row.id] }));

  // The server's counts, less what was read on this screen since they were
  // taken. Once the route has re-read, the rows carry their readAt and the
  // adjustment is zero again.
  const readHereByCategory = page.data.reduce<Partial<Record<string, number>>>((acc, row) => {
    if (!row.readAt && readHere[row.id]) acc[row.category] = (acc[row.category] ?? 0) + 1;
    return acc;
  }, {});
  const unreadIn = (category: NotificationCategory) =>
    Math.max(0, (page.unreadByCategory?.[category] ?? 0) - (readHereByCategory[category] ?? 0));
  const unreadTotal = categories.reduce((sum, category) => sum + unreadIn(category), 0);

  const readOne = async (row: AppNotification) => {
    setBusy(row.id);
    setError(null);
    setReadHere((current) => ({ ...current, [row.id]: new Date().toISOString() }));

    try {
      await markNotificationRead(scope, row.id);
      if (refreshCounts) void refreshCounts();
      router.refresh();
    } catch (caught) {
      setReadHere((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== row.id)));
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const tabClass = (selected: boolean) =>
    cn(
      "inline-flex h-10 items-center gap-2 border-b-2 px-3 text-[0.875rem] whitespace-nowrap transition-colors",
      selected ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink",
    );

  const countPill = (count: number) =>
    count > 0 && (
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-soft px-1.5 text-[0.6875rem] font-semibold text-brand-text tabular-nums">
        {count}
        <span className="sr-only"> unread</span>
      </span>
    );

  return (
    <div>
      {categories.length > 0 && (
        <div role="tablist" aria-label="Notification tabs" className="flex gap-1 overflow-x-auto border-b border-line">
          <button
            type="button"
            role="tab"
            aria-selected={!state.category}
            onClick={() => apply({ category: null })}
            className={tabClass(!state.category)}
          >
            All
            {countPill(unreadTotal)}
          </button>
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              role="tab"
              aria-selected={state.category === category}
              onClick={() => apply({ category })}
              className={tabClass(state.category === category)}
            >
              {notificationCategoryLabels[category]}
              {countPill(unreadIn(category))}
            </button>
          ))}
        </div>
      )}

      <FilterDisclosure className="mt-4" count={(state.unread ? 1 : 0) + (state.sort !== "newest" ? 1 : 0)}>
        <div className="flex flex-wrap items-center gap-3">
          <FilterChip selected={state.unread} onClick={() => apply({ unread: state.unread ? null : "true" })}>
            Unread only
          </FilterChip>

          <label className="ms-auto flex items-center gap-2 text-[0.8125rem] text-muted">
            Sort
            <select
              value={state.sort}
              onChange={(event) => apply({ sort: event.target.value === "newest" ? null : event.target.value })}
              aria-label="Sort notifications"
              className="h-9 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink"
            >
              {NOTIFICATION_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {notificationSortLabels[sort]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </FilterDisclosure>

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {page.total === 0
          ? emptyMessage(state)
          : `${page.total} ${page.total === 1 ? "notification" : "notifications"}`}
      </p>

      {error && (
        <p role="alert" className="mt-3 text-[0.875rem] text-error-text">
          {error}
        </p>
      )}

      <div className={cn("mt-4 transition-opacity", pending && "opacity-60")}>
        {rows.length === 0 ? (
          <p className="rounded-sm border border-dashed border-line p-8 text-center text-[0.9375rem] text-muted">
            {emptyMessage(state)}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const Icon = categoryIcon(row.category);
              const target = hrefFor(scope, row);
              const unread = !row.readAt;

              return (
                <li
                  key={row.id}
                  className={cn(
                    "flex items-start gap-3 rounded-sm border bg-surface p-4",
                    unread ? "border-brand/50" : "border-line",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                      unread ? "bg-brand-soft text-brand-text" : "bg-surface-soft text-subtle",
                    )}
                    aria-hidden
                  >
                    <Icon size={15} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-[0.6875rem] font-semibold tracking-[0.12em] text-subtle uppercase">
                      {notificationCategoryLabel(row.category)}
                    </p>
                    <p className={cn("mt-0.5 text-[0.9375rem]", unread ? "font-semibold text-ink" : "text-body")}>
                      {row.title}
                      {unread && <span className="sr-only"> (unread)</span>}
                    </p>
                    <p className="mt-0.5 text-[0.8125rem] text-muted">{row.body}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-subtle">
                      <time dateTime={row.createdAt} title={new Date(row.createdAt).toLocaleString("en-GB")}>
                        {timeAgo(row.createdAt, at)}
                      </time>
                      {target && (
                        <Link
                          href={localePath(target)}
                          prefetch={false}
                          onClick={() => {
                            if (unread) void readOne(row);
                          }}
                          className="inline-flex items-center gap-1 font-medium text-brand-text hover:text-brand-hover"
                        >
                          Open
                          <ArrowUpRight size={12} className="rtl:-scale-x-100" aria-hidden />
                        </Link>
                      )}
                    </p>
                  </div>

                  {unread && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void readOne(row)}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-sm border border-line px-3 text-[0.75rem] font-medium text-body hover:border-ink/40 hover:text-ink disabled:opacity-50"
                    >
                      {busy === row.id ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />}
                      Mark read
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {page.totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
          <button
            type="button"
            disabled={page.page <= 1}
            onClick={() => apply({ page: String(page.page - 1) })}
            className={pagerButton}
          >
            Previous
          </button>
          <span className="text-[0.8125rem] text-muted">
            Page {page.page} of {page.totalPages}
          </span>
          <button
            type="button"
            disabled={page.page >= page.totalPages}
            onClick={() => apply({ page: String(page.page + 1) })}
            className={pagerButton}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
