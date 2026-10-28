"use client";

import { useId } from "react";

import { filterControlClass, filterLabelClass } from "./SearchField";
import { DATE_RANGE_PRESETS, dateRangeFor, type DateRangePresetId } from "@/lib/admin/bookingFilters";
import { cn } from "@/lib/utils";

/**
 * Two native date inputs and three shortcuts.
 *
 * Native, because a calendar widget earns nothing here: an operator types a
 * date or picks one from the browser's own popover, and both ends are
 * inclusive calendar days, never instants. The shortcuts look forward on a
 * service-date column (Arriving in the next 7 days) and back on a created
 * column (Created in the last 30 days); `direction` says which.
 */
export function DateRangeFields({
  label,
  from,
  to,
  onChange,
  today,
  direction = "forward",
  className,
}: {
  /** "Arriving", "Pick-up", "Departing", "Travelling", "Created". */
  label: string;
  from: string;
  to: string;
  onChange: (range: { from: string | null; to: string | null }) => void;
  /** `YYYY-MM-DD`, from the server render so hydration agrees. */
  today: string;
  direction?: "forward" | "back";
  className?: string;
}) {
  const id = useId();
  const active = (preset: DateRangePresetId) => {
    const range = dateRangeFor(preset, today, direction);
    return range.from === from && range.to === to;
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className={filterLabelClass}>{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`${id}-from`}
          type="date"
          value={from}
          max={to || undefined}
          onChange={(event) => onChange({ from: event.target.value || null, to: to || null })}
          aria-label={`${label} on or after`}
          className={filterControlClass}
        />
        <span aria-hidden className="text-muted">
          –
        </span>
        <input
          id={`${id}-to`}
          type="date"
          value={to}
          min={from || undefined}
          onChange={(event) => onChange({ from: from || null, to: event.target.value || null })}
          aria-label={`${label} on or before`}
          className={filterControlClass}
        />
        <div role="group" aria-label={`${label} shortcuts`} className="flex items-center gap-1">
          {DATE_RANGE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active(preset.id)}
              onClick={() => onChange(active(preset.id) ? { from: null, to: null } : dateRangeFor(preset.id, today, direction))}
              className={cn(
                "h-8 rounded-sm border px-2 text-[0.75rem] font-medium transition-colors",
                active(preset.id)
                  ? "border-brand bg-brand-soft text-brand-text"
                  : "border-line text-muted hover:border-ink hover:text-ink",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
