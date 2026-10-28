"use client";

import { useId } from "react";

import { filterControlClass, filterLabelClass } from "./SearchField";
import { BOOKING_SORTS, sortLabels } from "@/lib/admin/bookingFilters";
import type { BookingSort } from "@/types/booking";
import { cn } from "@/lib/utils";

/**
 * The register's order. The empty choice is the register's own default —
 * newest first on most, soonest pick-up on transfers — so the select never
 * claims a sort the server did not apply.
 */
export function SortSelect({
  value,
  onChange,
  defaultLabel = "Default order",
  options = BOOKING_SORTS,
  className,
}: {
  value: BookingSort | "";
  onChange: (next: BookingSort | null) => void;
  defaultLabel?: string;
  options?: readonly BookingSort[];
  className?: string;
}) {
  const id = useId();

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={filterLabelClass}>
        Sort
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange((event.target.value as BookingSort) || null)}
        className={filterControlClass}
      >
        <option value="">{defaultLabel}</option>
        {options.map((sort) => (
          <option key={sort} value={sort}>
            {sortLabels[sort]}
          </option>
        ))}
      </select>
    </div>
  );
}
