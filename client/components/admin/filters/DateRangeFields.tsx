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
    // Full width on a phone: the filter bar is a wrapping flex row, where this
    // would otherwise shrink to its content and stop short of the search box
    // above it on any phone wider than the dates themselves.
    <div className={cn("flex flex-col gap-1.5 max-sm:w-full", className)}>
      <span className={filterLabelClass}>{label}</span>
      {/* On a phone the two dates share one row as a grid, so each takes half
          and neither wraps away from its dash; the shortcuts take the next
          row. From `sm` the row flows as before. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:flex-wrap">
        <input
          id={`${id}-from`}
          type="date"
          value={from}
          max={to || undefined}
          onChange={(event) => onChange({ from: event.target.value || null, to: to || null })}
          aria-label={`${label} on or after`}
          className={cn(filterControlClass, "w-full min-w-0 max-sm:px-2 sm:w-auto")}
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
          className={cn(filterControlClass, "w-full min-w-0 max-sm:px-2 sm:w-auto")}
        />
        <div role="group" aria-label={`${label} shortcuts`} className="col-span-3 flex items-center gap-1">
          {DATE_RANGE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active(preset.id)}
              onClick={() => onChange(active(preset.id) ? { from: null, to: null } : dateRangeFor(preset.id, today, direction))}
              className={cn(
                "h-9 rounded-sm border px-2.5 text-[0.75rem] font-medium transition-colors",
                active(preset.id)
                  ? "border-brand bg-brand-soft text-brand-text"
                  : "border-line text-muted hover:border-ink hover:text-ink",
              )}
            >
              <bdi>{preset.label}</bdi>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
