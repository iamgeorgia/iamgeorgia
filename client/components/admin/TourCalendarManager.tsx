"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { setTourInventory } from "@/lib/api/tours";
import { ApiError, describeError } from "@/lib/api/client";
import { addDaysISO, formatDayMonth, formatWeekday, weekdayOfISO } from "@/lib/admin/dates";
import { cn } from "@/lib/utils";
import type { Tour, TourCalendar, TourOption } from "@/types/tour";

/**
 * Departures for one option: the grid, and the bulk editor beside it.
 *
 * The grid is read-only on purpose; changes go through the range editor —
 * "every Saturday in August, eight seats, 08:00" — which is one request and
 * one audit row. Reducing capacity below what is already booked answers a
 * 409 naming the dates, and the editor shows them.
 *
 * Which option and which window are in the URL, so a view can be shared and
 * survives a reload — the same rule as every list in the panel.
 */

const field =
  "h-10 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink";
const button =
  "inline-flex h-10 items-center gap-2 rounded-sm px-4 text-[0.8125rem] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

export function TourCalendarManager({
  tour,
  options,
  option,
  calendar,
  from,
  to,
}: {
  tour: Tour;
  options: TourOption[];
  option: TourOption;
  calendar: TourCalendar;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const can = useCan();
  const canEdit = can("catalogue.write", "tours.write");
  const [pending, startTransition] = useTransition();

  const navigate = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };

  const windowDays = 28;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={option.id}
          onChange={(event) => navigate({ option: event.target.value })}
          aria-label="Option"
          className={field}
        >
          {options.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate({ from: addDaysISO(from, -windowDays), to: addDaysISO(to, -windowDays) })}
            aria-label="Earlier"
            className={cn(button, "border border-ink/20 px-2.5 text-ink hover:border-ink")}
          >
            <ChevronLeft size={15} aria-hidden className="rtl:-scale-x-100" />
          </button>
          <span className="min-w-0 flex-1 text-center text-[0.8125rem] text-muted sm:min-w-[13rem] sm:flex-none">
            {formatDayMonth(from)} – {formatDayMonth(to)}
          </span>
          <button
            type="button"
            onClick={() => navigate({ from: addDaysISO(from, windowDays), to: addDaysISO(to, windowDays) })}
            aria-label="Later"
            className={cn(button, "border border-ink/20 px-2.5 text-ink hover:border-ink")}
          >
            <ChevronRight size={15} aria-hidden className="rtl:-scale-x-100" />
          </button>
        </div>
      </div>

      <div className={cn("overflow-x-auto rounded-sm border border-line bg-surface", pending && "opacity-60")}>
        <DepartureGrid calendar={calendar} from={from} to={to} />
      </div>

      {/* The grid and its navigation are reading; the range editor is the
          one write on this screen and goes with the capability. */}
      {canEdit ? (
        <DepartureEditor tour={tour} option={option} from={from} to={to} />
      ) : (
        <ReadOnlyNote needs={["catalogue.write", "tours.write"]} what="Editing departures" />
      )}
    </div>
  );
}

function DepartureGrid({ calendar, from, to }: { calendar: TourCalendar; from: string; to: string }) {
  // Every date in the window, so a day with no departure row reads as a gap
  // rather than vanishing — the operator needs to see what is *not* on sale.
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDaysISO(date, 1)) dates.push(date);
  const byDate = new Map(calendar.departures.map((row) => [row.date, row]));
  const unit = calendar.option.unitKind === "SEAT" ? "seats" : "groups";

  return (
    <table className="w-full border-collapse text-[0.75rem]">
      <caption className="sr-only">Departures for {calendar.option.name}</caption>
      <thead>
        <tr>
          <th scope="col" className="sticky start-0 bg-surface px-3 py-2 text-start font-semibold text-muted">
            Departure
          </th>
          {dates.map((date) => (
            <th
              key={date}
              scope="col"
              className={cn(
                "min-w-[4.5rem] px-2 py-2 text-center font-medium whitespace-nowrap",
                weekdayOfISO(date) >= 6 ? "bg-surface-earth/40 text-ink" : "text-muted",
              )}
            >
              <span className="block">{formatWeekday(date)}</span>
              <span className="block">{formatDayMonth(date)}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-line">
          <th scope="row" className="sticky start-0 bg-surface px-3 py-2 text-start font-medium text-ink">
            Available {unit}
          </th>
          {dates.map((date) => {
            const row = byDate.get(date);

            return (
              <td
                key={date}
                className={cn(
                  "px-2 py-2 text-center tabular-nums",
                  !row && "text-subtle",
                  row && (row.stopSell || row.availableUnits === 0) && "bg-error/8 text-error-text",
                  row && !row.stopSell && row.availableUnits > 0 && weekdayOfISO(date) >= 6 && "bg-surface-earth/40",
                )}
              >
                {!row ? "—" : row.stopSell ? "closed" : `${row.availableUnits}/${row.totalUnits}`}
                {row && (row.bookedUnits > 0 || row.heldUnits > 0 || row.blockedUnits > 0) && (
                  <span className="block text-[0.6875rem] text-muted">
                    {row.bookedUnits > 0 && `${row.bookedUnits} booked`}
                    {row.heldUnits > 0 && ` ${row.heldUnits} held`}
                    {row.blockedUnits > 0 && ` ${row.blockedUnits} blocked`}
                  </span>
                )}
              </td>
            );
          })}
        </tr>
        <tr className="border-t border-line">
          <th scope="row" className="sticky start-0 bg-surface px-3 py-2 text-start font-medium text-ink">
            Time
          </th>
          {dates.map((date) => (
            <td key={date} className="px-2 py-2 text-center text-muted tabular-nums">
              {byDate.get(date)?.departureTime ?? "—"}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function DepartureEditor({
  tour,
  option,
  from,
  to,
}: {
  tour: Tour;
  option: TourOption;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [rangeFrom, setRangeFrom] = useState(from);
  const [rangeTo, setRangeTo] = useState(to);
  const [weekdays, setWeekdays] = useState<number[]>(option.operatesOnWeekdays);
  const [totalUnits, setTotalUnits] = useState("");
  const [blockedUnits, setBlockedUnits] = useState("");
  const [stopSell, setStopSell] = useState<"" | "open" | "closed">("");
  const [departureTime, setDepartureTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const { departures } = await setTourInventory(tour.id, option.id, {
        from: rangeFrom,
        to: rangeTo,
        weekdays: weekdays.length > 0 ? weekdays : undefined,
        ...(totalUnits !== "" ? { totalUnits: Number(totalUnits) } : {}),
        ...(blockedUnits !== "" ? { blockedUnits: Number(blockedUnits) } : {}),
        ...(stopSell !== "" ? { stopSell: stopSell === "closed" } : {}),
        ...(departureTime !== "" ? { departureTime } : {}),
        ...(note.trim() !== "" ? { note: note.trim() } : {}),
      });
      setMessage(`Saved. ${departures} departure${departures === 1 ? "" : "s"} written.`);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        const conflicts = (caught.details as { conflicts?: { date: string; committed: number }[] })?.conflicts;
        setError(
          conflicts?.length
            ? `${caught.message}: ${conflicts.map((row) => `${row.date} (${row.committed} committed)`).join(", ")}`
            : caught.message,
        );
      } else {
        setError(describeError(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPanel
      title="Departures"
      description={`Writes a departure row for every matching date. Anything left blank keeps what each date already has, so closing a week does not wipe its capacity. One ${option.unitKind === "SEAT" ? "seat" : "group"} per unit.`}
    >
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          From
          <input type="date" required value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          To
          <input type="date" required value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className={field} />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[0.8125rem] font-medium text-ink">Days</legend>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((day) => (
              <button
                key={day.value}
                type="button"
                aria-pressed={weekdays.includes(day.value)}
                onClick={() =>
                  setWeekdays((current) =>
                    current.includes(day.value) ? current.filter((v) => v !== day.value) : [...current, day.value].sort(),
                  )
                }
                className={cn(
                  "h-10 rounded-sm border px-2 text-[0.75rem] font-medium transition-colors",
                  weekdays.includes(day.value)
                    ? "border-brand bg-brand text-white"
                    : "border-line text-muted hover:border-ink hover:text-ink",
                )}
              >
                {day.label}
              </button>
            ))}
          </div>
          <p className="text-[0.6875rem] text-muted">None selected means every day.</p>
        </fieldset>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Capacity
          <input type="number" min={0} max={10000} value={totalUnits} onChange={(e) => setTotalUnits(e.target.value)} placeholder="keep" className={cn(field, "w-24")} />
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Blocked
          <input type="number" min={0} max={10000} value={blockedUnits} onChange={(e) => setBlockedUnits(e.target.value)} placeholder="keep" className={cn(field, "w-24")} />
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Sales
          <select value={stopSell} onChange={(e) => setStopSell(e.target.value as typeof stopSell)} className={field}>
            <option value="">keep</option>
            <option value="open">open</option>
            <option value="closed">closed</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Time
          <input type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} className={cn(field, "w-28")} />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="keep" className={field} />
        </label>
        <button type="submit" disabled={busy} className={cn(button, "bg-brand text-white hover:bg-brand-hover")}>
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          Apply to range
        </button>
      </form>
      <p aria-live="polite" className="mt-3 min-h-5 text-[0.75rem]">
        {error ? <span className="text-error-text">{error}</span> : message && <span className="text-muted">{message}</span>}
      </p>
    </AdminPanel>
  );
}
