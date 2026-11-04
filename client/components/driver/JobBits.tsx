import { Baby, Check, MessageSquareText, PackagePlus } from "lucide-react";

import { formatTime } from "@/lib/admin/dispatch";
import { PROGRESS_STEPS, jobNeeds, progressIndex } from "@/lib/driver/assignment";
import { cn } from "@/lib/utils";
import type { DriverAssignment, PassengerBlock } from "@/types/driver";

/**
 * Small, server-rendered pieces of a job, shared by the cards, the Up next
 * panel and the job page.
 */

/**
 * What the car must carry or the driver must know, as chips. Equipment is
 * tinted (the info hue: it is a fact to act on, not a warning) — a missing
 * child seat is the one thing that cancels a pick-up at the kerb — and a
 * written request is flagged, with the text on the job page.
 */
export function JobNeeds({
  booking,
  size = "md",
  tone = "light",
  className,
}: {
  booking: PassengerBlock;
  size?: "sm" | "md";
  /** `dark` on the ink Up next panel. */
  tone?: "light" | "dark";
  className?: string;
}) {
  const needs = jobNeeds(booking);
  if (needs.length === 0) return null;

  return (
    <ul aria-label="Needs for this job" className={cn("flex flex-wrap gap-1.5", className)}>
      {needs.map((need) => {
        const Icon = need.key === "child-seats" ? Baby : need.kind === "note" ? MessageSquareText : PackagePlus;
        return (
          <li
            key={need.key}
            className={cn(
              // Wraps rather than truncating: "Meet and greet inside the te…" hides
              // the one word that matters. The radius suits one line or two.
              "inline-flex max-w-full items-start gap-1.5 rounded-[0.75rem] font-medium",
              size === "sm" ? "px-2 py-0.5 text-[0.75rem]" : "px-2.5 py-1 text-[0.8125rem]",
              tone === "dark"
                ? "bg-on-dark/10 text-on-dark"
                : need.kind === "equipment"
                  ? "bg-info/10 text-ink"
                  : "bg-surface-soft text-body",
            )}
          >
            <Icon
              size={size === "sm" ? 12 : 14}
              className={cn("mt-[0.1875rem] shrink-0", tone === "light" && need.kind === "equipment" && "text-info")}
              aria-hidden
            />
            <bdi className="min-w-0 wrap-break-word">{need.label}</bdi>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Five segments, filled to the step reached — the job's progress in one
 * glance under its status. The text beside it says the same for a screen
 * reader and for anyone who does not read bars.
 */
export function JobProgressMeter({ assignment, className }: { assignment: DriverAssignment; className?: string }) {
  const reached = progressIndex(assignment.leg.status);
  if (reached < 0) return null;
  const noShow = assignment.leg.status === "NO_SHOW_REPORTED" || assignment.leg.status === "NO_SHOW";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <ol className="flex flex-1 gap-1" aria-hidden>
        {PROGRESS_STEPS.map((step, index) => (
          <li
            key={step.status}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              index <= reached ? (noShow ? "bg-warning" : "bg-brand") : "bg-line",
            )}
          />
        ))}
      </ol>
      <p className="shrink-0 text-[0.8125rem] text-muted tabular-nums">
        <bdi>
          Step {reached + 1} of {PROGRESS_STEPS.length}
        </bdi>
      </p>
    </div>
  );
}

/**
 * The job's timeline: each step with the time it happened, in the pick-up's
 * clock. The current step is marked; steps still to come are listed plain, so
 * the driver sees what is next. A no-show replaces the last two steps.
 */
export function JobTimeline({ assignment, timeZone }: { assignment: DriverAssignment; timeZone: string }) {
  const reached = progressIndex(assignment.leg.status);
  const noShowAt = assignment.milestones.noShowReportedAt;
  const steps = noShowAt
    ? [...PROGRESS_STEPS.slice(0, 3), { status: "NO_SHOW_REPORTED" as const, label: "No-show reported", at: "noShowReportedAt" as const }]
    : PROGRESS_STEPS;

  return (
    <ol className="relative space-y-0">
      {steps.map((step, index) => {
        const at = assignment.milestones[step.at];
        const done = Boolean(at) || index <= reached;
        const current = index === (noShowAt ? steps.length - 1 : reached);
        const warning = step.status === "NO_SHOW_REPORTED";

        return (
          <li key={step.status} className="relative flex gap-3 pb-4 last:pb-0">
            {index < steps.length - 1 && (
              <span
                className={cn("absolute start-[0.6875rem] top-6 -bottom-0 w-px", done && index < reached ? "bg-brand/50" : "bg-line")}
                aria-hidden
              />
            )}
            <span
              className={cn(
                "relative z-1 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-semibold",
                done
                  ? warning
                    ? "border-warning bg-warning text-ink"
                    : "border-brand bg-brand text-white"
                  : "border-line bg-surface text-subtle",
                current && !warning && "ring-4 ring-brand/15",
              )}
              aria-hidden
            >
              {done ? <Check size={13} strokeWidth={3} /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-[0.9375rem]", done ? "font-medium text-ink" : "text-muted")}>
                {step.label}
                {current && <span className="sr-only"> (current step)</span>}
                {!done && <span className="sr-only"> (not yet)</span>}
              </p>
              {at && <p className="text-[0.8125rem] text-muted tabular-nums">{formatTime(at, timeZone)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
