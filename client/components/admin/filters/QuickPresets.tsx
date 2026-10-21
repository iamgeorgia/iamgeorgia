"use client";

import { BOOKING_PRESETS, type BookingPresetId } from "@/lib/admin/bookingFilters";
import { cn } from "@/lib/utils";

/**
 * The views an operator opens most, as one row of chips above the filters.
 *
 * A preset *replaces* the filters rather than adding to them: "Overdue
 * payments" means exactly that, whatever was narrowed before. The active
 * chip is computed from the URL (`activePreset`), so a bookmark of
 * `?paymentStatus=OVERDUE&sort=due:asc` lights the same chip as clicking it.
 */
export function QuickPresets({
  active,
  onSelect,
  exclude = [],
  className,
}: {
  active: BookingPresetId | null;
  onSelect: (preset: BookingPresetId) => void;
  /** Presets a register cannot offer (an order register has no arrivals). */
  exclude?: BookingPresetId[];
  className?: string;
}) {
  const presets = BOOKING_PRESETS.filter((preset) => !exclude.includes(preset.id));
  const hint = presets.find((preset) => preset.id === active)?.hint;

  return (
    <div className={className}>
      <div role="group" aria-label="Quick views" className="flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={active === preset.id}
            onClick={() => onSelect(preset.id)}
            className={cn(
              "h-8 rounded-sm px-2.5 text-[0.8125rem] font-medium transition-colors",
              active === preset.id ? "bg-ink text-white" : "text-muted hover:bg-surface-soft hover:text-ink",
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-[0.75rem] text-subtle">{hint}</p>}
    </div>
  );
}
