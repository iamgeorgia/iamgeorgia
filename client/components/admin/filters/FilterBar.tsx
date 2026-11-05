"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The layout of a register's filter row.
 *
 * `primary` is always in view: the search box and the one or two controls an
 * operator reaches for every time. `secondary` is the rest — payment, source,
 * partner, manager, created range, sort — folded behind a **Filters** button
 * at every width, so a register never opens with a wall of controls above
 * its first row.
 *
 * `count` on the disclosure says how many of the folded controls are active,
 * so a narrowed list never looks unfiltered just because the controls are
 * out of sight.
 */
export function FilterBar({
  primary,
  secondary,
  count = 0,
  className,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  /** How many of the secondary controls are narrowing the list. */
  count?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className={className}>
      <div className="flex flex-wrap items-end gap-3">
        {primary}
        {secondary && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((current) => !current)}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-sm border px-3 text-[0.8125rem] font-medium transition-colors",
              count > 0 ? "border-brand bg-brand-soft text-brand-text" : "border-line text-body hover:border-ink hover:text-ink",
            )}
          >
            <SlidersHorizontal size={14} aria-hidden />
            Filters
            {count > 0 && <span className="rounded-full bg-brand/15 px-1.5 text-[0.75rem] tabular-nums">{count}</span>}
            <ChevronDown size={14} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>

      {secondary && (
        <div id={panelId} className={cn("mt-3 flex-wrap items-end gap-3", open ? "flex" : "hidden")}>
          {secondary}
        </div>
      )}
    </div>
  );
}
