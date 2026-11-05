"use client";

import { DeadlineChip } from "./DeadlineChip";
import { DeadlineKindBadge, DeadlineStatusBadge } from "@/components/admin/StatusBadge";
import { approvalProductLabels } from "@/lib/admin/bookingApprovals";
import { formatDayMonth, formatWeekday } from "@/lib/admin/dates";
import { deadlineDueWords, formatDeadlineTime } from "@/lib/admin/deadlines";
import { cn } from "@/lib/utils";
import type { Deadline } from "@/types/deadline";

/**
 * The week and the day as a list grouped by day — the agenda form the
 * schedule screen uses for a driver's week. A day with nothing says so in
 * the week view (an empty Tuesday is information) and the day view shows
 * one day's rows in full, with the lead name and the status beside each.
 */
export function DeadlineAgenda({
  days,
  groups,
  today,
  detailed,
  onOpen,
  className,
}: {
  /** The day keys to show, in order. */
  days: string[];
  groups: Map<string, Deadline[]>;
  today: string;
  /** Full rows (day view) rather than chips (week view). */
  detailed: boolean;
  onOpen: (deadline: Deadline) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col divide-y divide-line", className)}>
      {days.map((day) => {
        const rows = groups.get(day) ?? [];
        const isToday = day === today;
        return (
          <section key={day} aria-label={`${formatWeekday(day)} ${formatDayMonth(day)}`} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:gap-6">
            <header className="flex items-baseline gap-2 md:w-32 md:shrink-0 md:flex-col md:gap-0">
              <span className={cn("text-[0.6875rem] font-semibold tracking-[0.1em] uppercase", isToday ? "text-brand-text" : "text-muted")}>
                {isToday ? "Today" : formatWeekday(day)}
              </span>
              <span className="text-[0.9375rem] font-medium text-ink">{formatDayMonth(day)}</span>
              {rows.length > 0 && (
                <span className="text-[0.75rem] text-muted tabular-nums">
                  {rows.length} {rows.length === 1 ? "deadline" : "deadlines"}
                </span>
              )}
            </header>

            <div className="min-w-0 flex-1">
              {rows.length === 0 ? (
                <p className="text-[0.8125rem] text-subtle">Nothing due.</p>
              ) : detailed ? (
                <ul className="divide-y divide-line rounded-sm border border-line">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(row)}
                        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-start transition-colors hover:bg-surface-soft/60"
                      >
                        <span className="w-12 shrink-0 text-[0.875rem] font-medium text-ink tabular-nums">
                          {formatDeadlineTime(row.dueAt, row.timezone)}
                        </span>
                        <DeadlineKindBadge kind={row.kind} overdue={row.overdue} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.875rem] text-ink">
                            {row.reference}
                            {row.title ? <span className="text-muted"> · {row.title}</span> : null}
                          </span>
                          <span className="block truncate text-[0.75rem] text-muted">
                            {approvalProductLabels[row.product]}
                            {row.leadName ? ` · ${row.leadName}` : ""}
                            {row.partner ? ` · ${row.partner.name}` : row.customer ? ` · ${row.customer.name}` : ""} · {row.timezone}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={cn("text-[0.75rem]", row.overdue ? "font-medium text-error-text" : "text-muted")}>{deadlineDueWords(row, today)}</span>
                          <DeadlineStatusBadge status={row.status} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <DeadlineChip deadline={row} onOpen={onOpen} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
