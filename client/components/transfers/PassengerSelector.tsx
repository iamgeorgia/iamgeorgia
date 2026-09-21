"use client";

import { Minus, Plus, Users } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n } from "@/lib/i18n/provider";
import type { TransferQuery } from "@/lib/transfers/query";
import { cn } from "@/lib/utils";

type CountKey = "adults" | "children" | "luggage" | "cabinBags";

interface CounterRow {
  key: CountKey;
  label: string;
  hint: string;
  min: number;
  max: number;
}

interface PassengerSelectorProps {
  value: Pick<TransferQuery, CountKey>;
  onChange: (next: Partial<Pick<TransferQuery, CountKey>>) => void;
  error?: string;
  className?: string;
}

/**
 * Passenger and luggage counters in one popover.
 *
 * Kept together because they are one decision — how much vehicle you need —
 * and because capacity filtering treats them as one constraint. The trigger
 * always states the current selection in words, so the value is legible
 * without opening the panel.
 */
export function PassengerSelector({
  value,
  onChange,
  error,
  className,
}: PassengerSelectorProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const rows: CounterRow[] = [
    {
      key: "adults",
      label: t.transfers.passengers.adults,
      hint: t.transfers.passengers.adultsHint,
      min: 1,
      max: 40,
    },
    {
      key: "children",
      label: t.transfers.passengers.children,
      hint: t.transfers.passengers.childrenHint,
      min: 0,
      max: 20,
    },
    {
      key: "luggage",
      label: t.transfers.passengers.luggage,
      hint: t.transfers.passengers.luggageHint,
      min: 0,
      max: 40,
    },
    {
      key: "cabinBags",
      label: t.transfers.passengers.cabinBags,
      hint: t.transfers.passengers.cabinBagsHint,
      min: 0,
      max: 40,
    },
  ];

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const passengers = value.adults + value.children;
  const bags = value.luggage + value.cabinBags;
  const trigger = `${plural(locale, passengers, t.units.passenger)} · ${plural(locale, bags, t.units.bag)}`;

  const step = (row: CounterRow, delta: number) => {
    const next = Math.min(row.max, Math.max(row.min, value[row.key] + delta));
    onChange({ [row.key]: next });
  };

  return (
    <div ref={containerRef} className={cn("relative flex flex-col", className)}>
      <span className="type-caption flex items-center gap-1.5 text-muted">
        <Users size={13} aria-hidden />
        {t.transfers.search.passengersLuggage}
      </span>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={error ? `${panelId}-error` : undefined}
        className="mt-1 min-h-6 w-full truncate text-start text-sm text-ink"
      >
        {trigger}
      </button>

      {error && (
        <p id={`${panelId}-error`} role="alert" className="type-caption mt-1 text-error-text">
          {error}
        </p>
      )}

      {/* From `sm` this field is the last column of its row, so the panel opens
          back towards the form; anchored to its start it ran off the screen. */}
      {open && (
        <div
          id={panelId}
          className="absolute top-full z-30 mt-2 w-[min(20rem,calc(100vw-2.5rem))] rounded-sm border border-line bg-surface p-4 shadow-lift start-0 sm:start-auto sm:end-0"
        >
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="type-body-sm block font-medium text-ink">{row.label}</span>
                  <span className="type-caption block text-muted">{row.hint}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={fill(t.a11y.fewer, { item: row.label.toLowerCase() })}
                    disabled={value[row.key] <= row.min}
                    onClick={() => step(row, -1)}
                    className="flex size-9 items-center justify-center rounded-sm border border-line text-body transition-colors hover:border-ink disabled:opacity-35 disabled:hover:border-line"
                  >
                    <Minus size={15} aria-hidden />
                  </button>
                  <output
                    aria-live="polite"
                    className="type-body-sm w-8 text-center tabular-nums"
                  >
                    {value[row.key]}
                  </output>
                  <button
                    type="button"
                    aria-label={fill(t.a11y.more, { item: row.label.toLowerCase() })}
                    disabled={value[row.key] >= row.max}
                    onClick={() => step(row, 1)}
                    className="flex size-9 items-center justify-center rounded-sm border border-line text-body transition-colors hover:border-ink disabled:opacity-35 disabled:hover:border-line"
                  >
                    <Plus size={15} aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>

          <Button size="sm" fullWidth className="mt-4" onClick={() => setOpen(false)}>
            {t.actions.done}
          </Button>
        </div>
      )}
    </div>
  );
}
