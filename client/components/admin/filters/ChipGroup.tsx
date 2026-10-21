"use client";

import { FilterChip } from "@/components/ui/FilterChip";
import { cn } from "@/lib/utils";

export interface ChipOption<T extends string = string> {
  value: T;
  label: string;
  /** A count beside the label — a queue's size. */
  count?: number;
  /** Painted in the warning tone: a queue that needs attention. */
  urgent?: boolean;
}

/**
 * A row of toggle chips over a closed set — statuses, payment states,
 * products. Built on the same `FilterChip` the public listings use, so a
 * selected filter looks the same on both sides of the sign-in.
 *
 * Multi-select by default: a queue an operator actually works is usually
 * more than one state. An **All** chip stands for "no filter" and is
 * selected exactly when nothing else is.
 */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  multiple = true,
  allLabel = "All",
  className,
}: {
  /** For assistive technology: the group's name. */
  label: string;
  options: ChipOption<T>[];
  value: T[];
  onChange: (next: T[]) => void;
  multiple?: boolean;
  /** Omit the All chip by passing null. */
  allLabel?: string | null;
  className?: string;
}) {
  const toggle = (option: T) => {
    if (!multiple) return onChange(value.includes(option) ? [] : [option]);
    onChange(value.includes(option) ? value.filter((entry) => entry !== option) : [...value, option]);
  };

  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-2", className)}>
      {allLabel && (
        <FilterChip selected={value.length === 0} onClick={() => onChange([])}>
          {allLabel}
        </FilterChip>
      )}
      {options.map((option) => (
        <FilterChip
          key={option.value}
          selected={value.includes(option.value)}
          onClick={() => toggle(option.value)}
          className={cn(
            option.urgent &&
              (value.includes(option.value)
                ? "border-warning bg-warning/15 text-warning-text"
                : "border-warning/40 text-warning-text hover:bg-warning/10"),
          )}
        >
          {option.label}
          {option.count !== undefined && (
            <span className={cn("ms-2 rounded-full px-1.5 text-[0.75rem] tabular-nums", option.urgent ? "bg-warning/25" : "bg-ink/8")}>
              {option.count}
            </span>
          )}
        </FilterChip>
      ))}
    </div>
  );
}
