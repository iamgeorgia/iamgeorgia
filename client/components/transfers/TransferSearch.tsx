"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeftRight, CalendarDays, Clock, Search } from "lucide-react";
import { useState } from "react";

import { LocationSelector } from "./LocationSelector";
import { PassengerSelector } from "./PassengerSelector";
import { Button } from "@/components/ui/Button";
import { fill } from "@/lib/i18n/fill";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import {
  emptyQuery,
  hasErrors,
  serializeTransferQuery,
  todayIso,
  validateTransferQuery,
  type TransferQuery,
  type TransferQueryErrors,
  type TransferQueryField,
} from "@/lib/transfers/query";
import { cn } from "@/lib/utils";
import type { TransferPoint } from "@/types/transfer";

interface TransferSearchProps {
  /** Seeds the form — the results page passes the query back in so it persists. */
  initialQuery?: TransferQuery;
  /**
   * The popular pick-up points, so the picker opens with something in it
   * rather than filling in a moment after the traveller looks at it.
   */
  suggestions?: TransferPoint[];
  /** Overrides the default "Search transfers" — the results page says "Update search". */
  submitLabel?: string;
  /** Fired after a valid submit, e.g. to close the disclosure it sits inside. */
  onSubmitted?: () => void;
  className?: string;
}

/**
 * The transfer search widget.
 *
 * A real `<form>` so Enter submits and the browser announces it as one. All
 * validation is front-end; on success it writes the query into the URL and
 * navigates, which is what makes a search shareable and reloadable.
 */
export function TransferSearch({
  initialQuery,
  suggestions,
  submitLabel,
  onSubmitted,
  className,
}: TransferSearchProps) {
  const router = useRouter();
  const path = useLocalePath();
  const { t } = useI18n();
  const [query, setQuery] = useState<TransferQuery>(initialQuery ?? emptyQuery);
  const [errors, setErrors] = useState<TransferQueryErrors>({});

  /**
   * Re-validates on every change but only ever *removes* messages: an error
   * already on screen disappears the moment it is fixed, and no new one appears
   * until the traveller submits. Clearing by field name is not enough here —
   * "pick-up and drop-off cannot be the same place" hangs off the drop-off but
   * is fixed by editing either end.
   */
  const update = (patch: Partial<TransferQuery>) => {
    const next = { ...query, ...patch };
    setQuery(next);
    setErrors((current) => {
      const stillInvalid = validateTransferQuery(next);
      const remaining: TransferQueryErrors = {};
      for (const key of Object.keys(current) as TransferQueryField[]) {
        if (stillInvalid[key]) remaining[key] = stillInvalid[key];
      }
      return remaining;
    });
  };

  const swap = () => update({ from: query.to, to: query.from });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateTransferQuery(query);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) return;

    router.push(`${path("/transfers/search")}?${serializeTransferQuery(query)}`);
    onSubmitted?.();
  };

  const fieldClass = "flex flex-col justify-center px-4 py-3.5";
  const labelClass = "type-caption flex items-center gap-1.5 text-muted";
  const controlClass =
    "mt-1 min-h-6 w-full bg-transparent text-sm text-ink focus:outline-none";
  const errorClass = "type-caption mt-1 text-error-text";

  /** Error *keys* come out of validation; the wording is looked up here. */
  const messageFor = (key?: string) =>
    key ? t.transfers.errors[key as keyof typeof t.transfers.errors] : undefined;
  const errorList = Object.values(errors).map((key) => messageFor(key)!);

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={t.transfers.search.formLabel}
      className={cn("border border-line bg-surface shadow-lift", className)}
    >
      {/* One-way / return. Radios rather than buttons so arrow keys work and a
          screen reader announces it as one choice with two options. */}
      <fieldset className="flex items-center gap-1 border-b border-line px-3 py-3">
        <legend className="sr-only">{t.transfers.search.typeLegend}</legend>
        {(
          [
            { value: "one-way", label: t.transfers.search.oneWay },
            { value: "return", label: t.transfers.search.return },
          ] as const
        ).map((option) => (
          <label
            key={option.value}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center rounded-full px-4 text-[0.8125rem] font-medium transition-colors",
              "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600",
              query.type === option.value
                ? "bg-brand-soft text-brand-text"
                : "text-muted hover:text-ink",
            )}
          >
            <input
              type="radio"
              name="transfer-type"
              value={option.value}
              checked={query.type === option.value}
              onChange={() => update({ type: option.value })}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      {/* Stacked on a phone; from `sm` the route takes a row and date, time and
          party share the next one — three full-width rows left a tablet with a
          very tall form; one row from `lg`. Borders are per cell rather than
          `divide-*`, because the seams move with the column count. */}
      <div className="grid sm:grid-cols-3 lg:grid-cols-[minmax(0,2.6fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.25fr)]">
        {/* Pick-up and drop-off share a sub-grid so the swap control can sit
            exactly on the seam between them at every breakpoint. */}
        <div className="relative grid divide-y divide-line border-b border-line sm:col-span-3 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:col-span-1 lg:border-b-0">
          <LocationSelector
            id="transfer-from"
            label={t.transfers.search.pickUp}
            value={query.from}
            onChange={(from) => update({ from })}
            placeholder={t.transfers.search.pickUpPlaceholder}
            excludeId={query.to || undefined}
            suggestions={suggestions}
            error={messageFor(errors.from)}
            className={cn(fieldClass, "min-w-0 pe-16 sm:pe-4")}
          />
          <LocationSelector
            id="transfer-to"
            label={t.transfers.search.dropOff}
            value={query.to}
            onChange={(to) => update({ to })}
            placeholder={t.transfers.search.dropOffPlaceholder}
            excludeId={query.from || undefined}
            suggestions={suggestions}
            error={messageFor(errors.to)}
            className={cn(fieldClass, "min-w-0 pe-16 sm:pe-4")}
          />

          <button
            type="button"
            onClick={swap}
            aria-label={t.transfers.search.swap}
            className="absolute end-3 top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card transition-colors hover:border-ink hover:text-ink sm:end-auto sm:start-1/2 sm:-translate-x-1/2 rtl:sm:translate-x-1/2"
          >
            <ArrowLeftRight size={15} className="sm:rotate-0 rotate-90" aria-hidden />
          </button>
        </div>

        <div className={cn(fieldClass, "min-w-0 border-b border-line sm:border-b-0 lg:border-s")}>
          <label htmlFor="transfer-date" className={labelClass}>
            <CalendarDays size={13} aria-hidden />
            {t.transfers.search.date}
          </label>
          <input
            id="transfer-date"
            type="date"
            value={query.date}
            min={todayIso()}
            onChange={(event) => update({ date: event.target.value })}
            aria-invalid={Boolean(errors.date)}
            aria-describedby={errors.date ? "transfer-date-error" : undefined}
            className={controlClass}
          />
          {errors.date && (
            <p id="transfer-date-error" role="alert" className={errorClass}>
              {messageFor(errors.date)}
            </p>
          )}
        </div>

        <div className={cn(fieldClass, "min-w-0 border-b border-line sm:border-s sm:border-b-0")}>
          <label htmlFor="transfer-time" className={labelClass}>
            <Clock size={13} aria-hidden />
            {t.transfers.search.time}
          </label>
          <input
            id="transfer-time"
            type="time"
            value={query.time}
            onChange={(event) => update({ time: event.target.value })}
            aria-invalid={Boolean(errors.time)}
            aria-describedby={errors.time ? "transfer-time-error" : undefined}
            className={controlClass}
          />
          {errors.time && (
            <p id="transfer-time-error" role="alert" className={errorClass}>
              {messageFor(errors.time)}
            </p>
          )}
        </div>

        <PassengerSelector
          value={query}
          onChange={update}
          error={messageFor(errors.passengers)}
          className={cn(fieldClass, "min-w-0 border-line sm:border-s")}
        />
      </div>

      {query.type === "return" && (
        <div className="grid divide-y divide-line border-t border-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className={fieldClass}>
            <label htmlFor="transfer-return-date" className={labelClass}>
              <CalendarDays size={13} aria-hidden />
              {t.transfers.search.returnDate}
            </label>
            <input
              id="transfer-return-date"
              type="date"
              value={query.returnDate}
              min={query.date || todayIso()}
              onChange={(event) => update({ returnDate: event.target.value })}
              aria-invalid={Boolean(errors.returnDate)}
              aria-describedby={errors.returnDate ? "transfer-return-date-error" : undefined}
              className={controlClass}
            />
            {errors.returnDate && (
              <p id="transfer-return-date-error" role="alert" className={errorClass}>
                {messageFor(errors.returnDate)}
              </p>
            )}
          </div>

          <div className={fieldClass}>
            <label htmlFor="transfer-return-time" className={labelClass}>
              <Clock size={13} aria-hidden />
              {t.transfers.search.returnTime}
            </label>
            <input
              id="transfer-return-time"
              type="time"
              value={query.returnTime}
              onChange={(event) => update({ returnTime: event.target.value })}
              aria-invalid={Boolean(errors.returnTime)}
              aria-describedby={errors.returnTime ? "transfer-return-time-error" : undefined}
              className={controlClass}
            />
            {errors.returnTime && (
              <p id="transfer-return-time-error" role="alert" className={errorClass}>
                {messageFor(errors.returnTime)}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-line p-3">
        {/* A single live summary above the button: each field already shows its
            own message, but a keyboard user who submits from the button needs
            to be told something failed without hunting for it. */}
        {errorList.length > 0 && (
          <p
            role="alert"
            className="type-caption mb-3 flex items-start gap-2 rounded-sm bg-surface-soft px-3 py-2.5 text-error-text"
          >
            <AlertCircle size={14} className="mt-px shrink-0" aria-hidden />
            {errorList.length === 1
              ? errorList[0]
              : fill(t.transfers.search.errorSummary, { count: errorList.length })}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth>
          <Search size={17} aria-hidden />
          {submitLabel ?? t.transfers.search.submit}
        </Button>
      </div>
    </form>
  );
}
