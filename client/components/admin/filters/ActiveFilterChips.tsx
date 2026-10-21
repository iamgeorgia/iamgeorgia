"use client";

import { X } from "lucide-react";

import type { ActiveFilterChip } from "@/lib/admin/bookingFilters";
import { cn } from "@/lib/utils";

/**
 * What is narrowing the list, each chip removable, with one link that
 * clears the lot. Rendered only when something is active, so an unfiltered
 * register carries no empty row.
 */
export function ActiveFilterChips({
  chips,
  onRemove,
  onClear,
  className,
}: {
  chips: ActiveFilterChip[];
  onRemove: (chip: ActiveFilterChip) => void;
  onClear: () => void;
  className?: string;
}) {
  if (chips.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} aria-label="Active filters">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onRemove(chip)}
          aria-label={`Remove filter ${chip.label}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft ps-3 pe-2 text-[0.75rem] font-medium text-brand-text transition-colors hover:border-brand"
        >
          {chip.label}
          <X size={12} aria-hidden />
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="h-8 px-2 text-[0.75rem] font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        Clear filters
      </button>
    </div>
  );
}
