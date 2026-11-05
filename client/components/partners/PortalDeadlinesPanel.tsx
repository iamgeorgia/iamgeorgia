import Link from "next/link";
import { AlertTriangle, CalendarClock } from "lucide-react";

import { PortalPanel } from "@/components/partners/PortalPage";
import { addDaysISO, todayISO } from "@/lib/admin/dates";
import { dayKeyIn } from "@/lib/admin/deadlines";
import { listPartnerDeadlines } from "@/lib/api/deadlines";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import type { Deadline, DeadlineKind } from "@/types/deadline";

/** How far ahead the portal looks. */
const AHEAD_DAYS = 14;
const ROWS = 8;

const DAY_MS = 86_400_000;

/**
 * A partner's next two weeks of deadlines, read-only, above its booking
 * registers: what must be paid, what can still be cancelled free of charge
 * and until when, and which requests are waiting on an answer. Late rows
 * come first and in red. Renders nothing when there is nothing to show, and
 * nothing when the read fails — the registers below are the page.
 */
export async function PortalDeadlinesPanel() {
  const { t, path, intlLocale, fill } = await getI18n();
  const strings = t.portalDeadlines;
  const today = todayISO();
  const now = new Date().toISOString();

  let overdue: Deadline[] = [];
  let upcoming: Deadline[] = [];
  try {
    const [late, soon] = await Promise.all([
      listPartnerDeadlines({ status: "OPEN", to: now, sort: "latest", pageSize: ROWS }),
      listPartnerDeadlines({ status: "OPEN", from: now, to: `${addDaysISO(today, AHEAD_DAYS)}T23:59:59.999Z`, sort: "soonest", pageSize: ROWS }),
    ]);
    overdue = late.data;
    upcoming = soon.data;
  } catch {
    return null;
  }

  const rows = [...overdue, ...upcoming].slice(0, ROWS);
  if (rows.length === 0) return null;

  const kindLabel: Record<DeadlineKind, string> = {
    PAYMENT: strings.kinds.PAYMENT,
    FREE_CANCELLATION: strings.kinds.FREE_CANCELLATION,
    CONFIRMATION: strings.kinds.CONFIRMATION,
  };

  const when = (row: Deadline): string => {
    const due = dayKeyIn(row.dueAt, row.timezone);
    const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
    if (days === 0) return strings.today;
    if (days === 1) return strings.tomorrow;
    if (days > 1) return fill(strings.inDays, { count: days });
    return fill(strings.daysLate, { count: -days });
  };

  const format = (row: Deadline): string => {
    try {
      return new Intl.DateTimeFormat(intlLocale, { timeZone: row.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(row.dueAt));
    } catch {
      return new Intl.DateTimeFormat(intlLocale, { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(row.dueAt));
    }
  };

  return (
    <PortalPanel
      id="portal-deadlines"
      icon={CalendarClock}
      title={strings.title}
      description={strings.intro}
      action={
        overdue.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-error/12 px-2.5 py-1 text-[0.75rem] font-medium text-error-text">
            <AlertTriangle size={13} aria-hidden />
            {fill(strings.overdueCount, { count: overdue.length })}
          </span>
        )
      }
      bodyClassName=""
    >
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li key={row.id}>
            {/* Two lines on a phone — what and which booking, against when —
                and one row from `sm`. The reference never truncates: it is
                the one thing on the row a partner acts on; the title gives
                way instead. */}
            <Link
              href={path(row.href)}
              prefetch={false}
              className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-surface-soft/60 sm:items-center sm:px-5"
            >
              <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
                <span
                  className={cn(
                    "block text-[0.8125rem] leading-snug font-medium sm:w-44 sm:shrink-0",
                    row.overdue ? "text-error-text" : "text-ink",
                  )}
                >
                  {kindLabel[row.kind]}
                </span>
                <span className="mt-0.5 block min-w-0 sm:mt-0 sm:flex-1">
                  <span className="flex min-w-0 items-baseline gap-1.5 text-[0.8125rem]">
                    <span className="shrink-0 font-mono text-[0.75rem] text-ink">{row.reference}</span>
                    {row.title ? <span className="min-w-0 truncate text-muted">· {row.title}</span> : null}
                  </span>
                  {row.kind === "CONFIRMATION" && row.meta.awaiting ? (
                    <span className="block text-[0.75rem] text-muted">
                      {row.meta.awaiting === "PLATFORM" ? strings.awaitingPlatform : strings.awaitingSupplier}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="shrink-0 text-end">
                <span className="block text-[0.8125rem] whitespace-nowrap text-ink tabular-nums">{format(row)}</span>
                <span className={cn("block text-[0.75rem]", row.overdue ? "font-medium text-error-text" : "text-muted")}>
                  {when(row)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </PortalPanel>
  );
}
