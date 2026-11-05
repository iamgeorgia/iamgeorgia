"use client";

import { AlertTriangle } from "lucide-react";

import { deadlineToneClasses } from "@/components/admin/StatusBadge";
import { deadlineKindShortLabels, deadlineTone, formatDeadlineTime } from "@/lib/admin/deadlines";
import { cn } from "@/lib/utils";
import type { Deadline } from "@/types/deadline";

/**
 * One deadline as a chip on a calendar day: the time in the booking's own
 * zone, the kind, the reference. Coloured by kind, red once late — and the
 * late ones carry a triangle as well, so the day reads without colour.
 */
export function DeadlineChip({
  deadline,
  onOpen,
  compact = false,
  className,
}: {
  deadline: Deadline;
  onOpen: (deadline: Deadline) => void;
  /** A month cell: one line, the reference only. */
  compact?: boolean;
  className?: string;
}) {
  const tone = deadlineTone(deadline);
  const late = deadline.overdue || deadline.status === "MISSED";
  const label = `${deadlineKindShortLabels[deadline.kind]} · ${deadline.reference}`;

  return (
    <button
      type="button"
      onClick={() => onOpen(deadline)}
      title={`${label} — ${deadline.title ?? ""}`.trim()}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-start text-[0.75rem] leading-tight font-medium transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
        deadlineToneClasses[tone],
        deadline.status === "MET" || deadline.status === "CANCELLED" ? "line-through decoration-current/40" : undefined,
        className,
      )}
    >
      {late && <AlertTriangle size={11} className="shrink-0" aria-label="Late" />}
      <span className="shrink-0 tabular-nums">{formatDeadlineTime(deadline.dueAt, deadline.timezone)}</span>
      <span className="min-w-0 truncate">
        {compact ? deadline.reference : label}
        {!compact && deadline.leadName ? <span className="font-normal opacity-80"> · {deadline.leadName}</span> : null}
      </span>
    </button>
  );
}
