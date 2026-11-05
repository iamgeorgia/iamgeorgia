"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Folds a block of filter controls behind a **Filters** button.
 *
 * Lists keep their search box (or any control that must always be in reach) in
 * `lead`, beside the button; everything else is `children` and stays hidden
 * until the button is pressed. `count` says how many of the folded controls are
 * narrowing the list, so a filtered list never looks unfiltered just because
 * the controls are out of sight. The panel is kept mounted while closed so the
 * controls keep their state.
 */
export function FilterDisclosure({
  children,
  lead,
  count = 0,
  label = "Filters",
  defaultOpen = false,
  className,
  panelClassName,
}: {
  children: React.ReactNode;
  lead?: React.ReactNode;
  count?: number;
  label?: string;
  defaultOpen?: boolean;
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={className}>
      <div className="flex flex-wrap items-end gap-3">
        {lead}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-sm border px-3 text-[0.8125rem] font-medium transition-colors",
            count > 0
              ? "border-brand bg-brand-soft text-brand-text"
              : "border-line text-body hover:border-ink hover:text-ink",
          )}
        >
          <SlidersHorizontal size={14} aria-hidden />
          {label}
          {count > 0 && (
            <span className="rounded-full bg-brand/15 px-1.5 text-[0.75rem] tabular-nums">{count}</span>
          )}
          <ChevronDown size={14} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
        </button>
      </div>

      <div id={panelId} hidden={!open} className={cn("mt-3", panelClassName)}>
        {children}
      </div>
    </div>
  );
}
