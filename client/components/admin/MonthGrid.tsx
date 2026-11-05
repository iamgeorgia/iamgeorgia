"use client";

import { useEffect, useRef, useState } from "react";

import { DeadlineChip } from "@/components/admin/deadlines/DeadlineChip";
import { WEEKDAY_HEADINGS, type MonthGridDay } from "@/lib/admin/deadlines";
import { formatDayMonth } from "@/lib/admin/dates";
import { cn } from "@/lib/utils";
import type { Deadline } from "@/types/deadline";

/** How many chips a cell shows before folding the rest behind "+N more". */
const CHIPS_PER_CELL = 3;

/**
 * A month, seven across, Monday first.
 *
 * Built as a grid of buttons rather than a `<table>`: the cells are the
 * things an operator acts on (open the day), and a table's row semantics
 * would say nothing useful about them. Keyboard: the cells are one roving
 * tab stop — arrows move by day and by week, Home/End to the week's ends,
 * Enter or Space opens the day. The chips inside a cell are ordinary buttons
 * reached with Tab from the cell.
 *
 * Logical properties throughout (`ps`, `text-start`), and the arrow keys
 * follow the writing direction, so the grid reads right-to-left in Hebrew
 * without a mirrored copy. Below `md` the grid keeps a minimum width and
 * scrolls sideways inside its own wrapper: seven columns on a phone would
 * be seven columns of nothing.
 */
export function MonthGrid({
  days,
  groups,
  today,
  onSelectDay,
  onOpen,
  className,
}: {
  days: MonthGridDay[];
  groups: Map<string, Deadline[]>;
  /** `YYYY-MM-DD`. */
  today: string;
  /** The cell was chosen: open that day's list. */
  onSelectDay: (day: string) => void;
  onOpen: (deadline: Deadline) => void;
  className?: string;
}) {
  // The roving tab stop: today when it is on the grid, else the first day of the month.
  const initial = days.find((day) => day.key === today) ?? days.find((day) => day.inMonth) ?? days[0];
  const [focused, setFocused] = useState<string>(initial?.key ?? "");
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);

  // A new month arrives with a new set of days: land the tab stop again.
  // Adjusted during render rather than in an effect, so the stale stop is
  // never painted.
  const [landed, setLanded] = useState(initial?.key ?? "");
  if (landed !== (initial?.key ?? "")) {
    setLanded(initial?.key ?? "");
    setFocused(initial?.key ?? "");
  }

  useEffect(() => {
    if (pendingFocus.current && pendingFocus.current === focused) {
      cellRefs.current.get(focused)?.focus();
      pendingFocus.current = null;
    }
  }, [focused]);

  const move = (from: number, delta: number) => {
    const next = days[from + delta];
    if (!next) return;
    pendingFocus.current = next.key;
    setFocused(next.key);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    switch (event.key) {
      case "ArrowRight":
        move(index, rtl ? -1 : 1);
        break;
      case "ArrowLeft":
        move(index, rtl ? 1 : -1);
        break;
      case "ArrowDown":
        move(index, 7);
        break;
      case "ArrowUp":
        move(index, -7);
        break;
      case "Home":
        move(index, -(index % 7));
        break;
      case "End":
        move(index, 6 - (index % 7));
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <div role="grid" aria-label="Month" className="min-w-[52rem] md:min-w-0">
        <div role="row" className="grid grid-cols-7 border-b border-line">
          {WEEKDAY_HEADINGS.map((heading, index) => (
            <div
              key={heading}
              role="columnheader"
              className={cn(
                "px-2 py-2 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted uppercase",
                index >= 5 && "bg-surface-soft/60",
              )}
            >
              {heading}
            </div>
          ))}
        </div>

        <div role="rowgroup" className="grid grid-cols-7">
          {days.map((day, index) => {
            const rows = groups.get(day.key) ?? [];
            const shown = rows.slice(0, CHIPS_PER_CELL);
            const hidden = rows.length - shown.length;
            const isToday = day.key === today;
            const late = rows.some((row) => row.overdue || row.status === "MISSED");

            return (
              <div
                key={day.key}
                role="gridcell"
                aria-selected={focused === day.key ? true : undefined}
                className={cn(
                  "flex min-h-[6.5rem] flex-col border-b border-e border-line p-1.5",
                  index % 7 === 0 && "border-s",
                  day.weekend && "bg-surface-soft/60",
                  !day.inMonth && "bg-surface-soft/30 text-subtle",
                  late && day.inMonth && "shadow-[inset_3px_0_0_0_var(--color-error)] rtl:shadow-[inset_-3px_0_0_0_var(--color-error)]",
                )}
              >
                <button
                  ref={(node) => {
                    if (node) cellRefs.current.set(day.key, node);
                    else cellRefs.current.delete(day.key);
                  }}
                  type="button"
                  tabIndex={focused === day.key ? 0 : -1}
                  onFocus={() => setFocused(day.key)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  onClick={() => onSelectDay(day.key)}
                  aria-label={`${formatDayMonth(day.key)}, ${rows.length} ${rows.length === 1 ? "deadline" : "deadlines"}`}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-sm px-1 py-0.5 text-start text-[0.8125rem] transition-colors hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
                    day.inMonth ? "text-ink" : "text-subtle",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full tabular-nums",
                      isToday && "bg-brand font-semibold text-white",
                    )}
                  >
                    {day.dayOfMonth}
                  </span>
                  {rows.length > 0 && (
                    <span className="text-[0.6875rem] text-muted tabular-nums" aria-hidden>
                      {rows.length}
                    </span>
                  )}
                </button>

                {shown.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-1">
                    {shown.map((row) => (
                      <li key={row.id}>
                        <DeadlineChip deadline={row} onOpen={onOpen} compact />
                      </li>
                    ))}
                  </ul>
                )}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectDay(day.key)}
                    className="mt-1 self-start px-1.5 text-[0.6875rem] font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
                  >
                    +{hidden} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
