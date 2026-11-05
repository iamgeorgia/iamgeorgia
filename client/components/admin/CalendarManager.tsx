"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { setInventory, setRates } from "@/lib/api/inventory";
import { ApiError, describeError } from "@/lib/api/client";
import { addDaysISO, formatDayMonth, formatWeekday, weekdayOfISO } from "@/lib/admin/dates";
import { formatMoney, toMajorUnits, toMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type {
  CalendarNight,
  HotelWithChecklist,
  InventoryCalendar,
  RoomType,
} from "@/types/catalogue";

/**
 * The calendar grid and the two bulk editors.
 *
 * The grid is read-only on purpose: per-cell editing is how an operator makes
 * sixty-two mistakes one at a time. Changes go through the range editors —
 * "December, weekdays, five rooms at 100" — which is one request, one audit
 * row, and matches how a revenue manager already thinks.
 *
 * Weekend columns are tinted, because Friday-to-Sunday pricing is the single
 * most common thing being checked when someone opens this screen.
 *
 * The two editors answer to two capabilities, as their endpoints do: how many
 * rooms are open is `catalogue.write`, what a night costs is `pricing.write`.
 * The grid itself is readable by anyone who can open the screen.
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

export function CalendarManager({
  hotel,
  roomTypes,
  roomType,
  calendar,
  from,
  to,
}: {
  hotel: HotelWithChecklist;
  roomTypes: RoomType[];
  roomType: RoomType;
  calendar: InventoryCalendar;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const can = useCan();
  const canInventory = can("catalogue.write");
  const canPricing = can("pricing.write");

  const navigate = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };

  const windowDays = 28;
  const ratePlans = roomType.ratePlans.filter((plan) => plan.status === "ACTIVE");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={roomType.id}
          onChange={(event) => navigate({ roomType: event.target.value })}
          aria-label="Room type"
          className={field}
        >
          {roomTypes.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
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
        <CalendarGrid calendar={calendar} currency={hotel.currency} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {canInventory ? (
          <InventoryEditor hotel={hotel} roomType={roomType} from={from} to={to} />
        ) : (
          <AdminPanel title="Rooms open">
            <ReadOnlyNote needs="catalogue.write" what="Opening or closing rooms for a range" />
          </AdminPanel>
        )}
        {!canPricing ? (
          <AdminPanel title="Prices">
            <ReadOnlyNote needs="pricing.write" what="Setting nightly rates" />
          </AdminPanel>
        ) : ratePlans.length > 0 ? (
          <RatesEditor hotel={hotel} roomType={roomType} ratePlans={ratePlans} from={from} to={to} />
        ) : (
          <AdminPanel title="Prices">
            <p className="text-[0.8125rem] text-muted">
              This room has no rate plan yet, so there is nothing to price. Add one on the Rooms
              &amp; rates screen first.
            </p>
          </AdminPanel>
        )}
      </div>
    </div>
  );
}

function CalendarGrid({ calendar, currency }: { calendar: InventoryCalendar; currency: string }) {
  const nights = calendar.nights;
  const planNames = new Map<string, string>();

  for (const night of nights) {
    for (const rate of night.rates) planNames.set(rate.ratePlanId, rate.ratePlanName);
  }

  const cellFor = (night: CalendarNight, planId: string) =>
    night.rates.find((rate) => rate.ratePlanId === planId);

  return (
    <table className="w-full border-collapse text-[0.75rem]">
      <caption className="sr-only">
        Nightly inventory and rates for {calendar.roomType.name}
      </caption>
      <thead>
        <tr>
          <th scope="col" className="sticky start-0 bg-surface px-3 py-2 text-start font-semibold text-muted">
            Night
          </th>
          {nights.map((night) => (
            <th
              key={night.date}
              scope="col"
              className={cn(
                "min-w-[4.5rem] px-2 py-2 text-center font-medium whitespace-nowrap",
                weekdayOfISO(night.date) >= 5 ? "bg-surface-earth/40 text-ink" : "text-muted",
              )}
            >
              <span className="block">{formatWeekday(night.date)}</span>
              <span className="block">{formatDayMonth(night.date)}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-line">
          <th scope="row" className="sticky start-0 bg-surface px-3 py-2 text-start font-medium text-ink">
            Available
          </th>
          {nights.map((night) => (
            <td
              key={night.date}
              className={cn(
                "px-2 py-2 text-center tabular-nums",
                night.stopSell || night.availableUnits === 0
                  ? "bg-error/8 text-error-text"
                  : weekdayOfISO(night.date) >= 5
                    ? "bg-surface-earth/40"
                    : undefined,
              )}
            >
              {night.stopSell ? "closed" : `${night.availableUnits}/${night.totalUnits}`}
              {(night.bookedUnits > 0 || night.heldUnits > 0) && (
                <span className="block text-[0.6875rem] text-muted">
                  {night.bookedUnits > 0 && `${night.bookedUnits} booked`}
                  {night.heldUnits > 0 && ` ${night.heldUnits} held`}
                </span>
              )}
            </td>
          ))}
        </tr>
        {[...planNames].map(([planId, planName]) => (
          <tr key={planId} className="border-t border-line">
            <th scope="row" className="sticky start-0 bg-surface px-3 py-2 text-start font-medium text-ink">
              {planName}
            </th>
            {nights.map((night) => {
              const rate = cellFor(night, planId);

              return (
                <td
                  key={night.date}
                  className={cn(
                    "px-2 py-2 text-center tabular-nums",
                    rate?.closed && "bg-error/8 text-error-text",
                    !rate && "text-subtle",
                    weekdayOfISO(night.date) >= 5 && !rate?.closed && "bg-surface-earth/40",
                  )}
                >
                  {rate
                    ? rate.closed
                      ? "closed"
                      : rate.netCents !== undefined
                        ? formatMoney(rate.netCents, currency, "en-GB", {
                            maximumFractionDigits: 0,
                          })
                        : "set"
                    : "—"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Shared by both editors: range, weekday mask, submit cycle. */
function useRangeForm(from: string, to: string) {
  const router = useRouter();
  const [rangeFrom, setRangeFrom] = useState(from);
  const [rangeTo, setRangeTo] = useState(to);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (call: () => Promise<{ nights: number }>) => {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const { nights } = await call();
      setMessage(`Saved. ${nights} night${nights === 1 ? "" : "s"} updated.`);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        // A reduction below what is already committed: the API names the
        // nights in the way, which beats a bare failure.
        const conflicts = (caught.details as { conflicts?: { date: string; committed: number }[] })
          ?.conflicts;
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

  const rangeFields = (
    <>
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
                  current.includes(day.value)
                    ? current.filter((value) => value !== day.value)
                    : [...current, day.value],
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
    </>
  );

  return {
    rangeFrom,
    rangeTo,
    weekdays: weekdays.length > 0 ? weekdays : undefined,
    busy,
    error,
    message,
    submit,
    rangeFields,
  };
}

function StatusLine({ error, message }: { error: string | null; message: string | null }) {
  return (
    <p aria-live="polite" className="min-h-5 text-[0.75rem]">
      {error ? (
        <span className="text-error-text">{error}</span>
      ) : (
        message && <span className="text-muted">{message}</span>
      )}
    </p>
  );
}

function InventoryEditor({
  hotel,
  roomType,
  from,
  to,
}: {
  hotel: HotelWithChecklist;
  roomType: RoomType;
  from: string;
  to: string;
}) {
  const form = useRangeForm(from, to);
  const [totalUnits, setTotalUnits] = useState("");
  const [minStay, setMinStay] = useState("");
  const [stopSell, setStopSell] = useState<"" | "open" | "closed">("");

  return (
    <AdminPanel
      title="Rooms open"
      description="Anything left blank keeps whatever each night already has, so closing a range does not wipe its counts."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit(() =>
            setInventory(hotel.id, roomType.id, {
              from: form.rangeFrom,
              to: form.rangeTo,
              weekdays: form.weekdays,
              ...(totalUnits !== "" ? { totalUnits: Number(totalUnits) } : {}),
              ...(minStay !== "" ? { minStay: Number(minStay) } : {}),
              ...(stopSell !== "" ? { stopSell: stopSell === "closed" } : {}),
            }),
          );
        }}
        className="flex flex-wrap items-end gap-3"
      >
        {form.rangeFields}
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Rooms
          <input
            type="number"
            min={0}
            max={10000}
            value={totalUnits}
            onChange={(e) => setTotalUnits(e.target.value)}
            placeholder="keep"
            className={cn(field, "w-24")}
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Min stay
          <input
            type="number"
            min={1}
            max={365}
            value={minStay}
            onChange={(e) => setMinStay(e.target.value)}
            placeholder="keep"
            className={cn(field, "w-24")}
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Sales
          <select value={stopSell} onChange={(e) => setStopSell(e.target.value as typeof stopSell)} className={field}>
            <option value="">keep</option>
            <option value="open">open</option>
            <option value="closed">closed</option>
          </select>
        </label>
        <button type="submit" disabled={form.busy} className={cn(button, "bg-brand text-white hover:bg-brand-hover")}>
          {form.busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          Apply to range
        </button>
      </form>
      <StatusLine error={form.error} message={form.message} />
    </AdminPanel>
  );
}

function RatesEditor({
  hotel,
  roomType,
  ratePlans,
  from,
  to,
}: {
  hotel: HotelWithChecklist;
  roomType: RoomType;
  ratePlans: RoomType["ratePlans"];
  from: string;
  to: string;
}) {
  const form = useRangeForm(from, to);
  const [ratePlanId, setRatePlanId] = useState(ratePlans[0].id);
  const [net, setNet] = useState("");
  const [extraAdult, setExtraAdult] = useState("");
  const [closed, setClosed] = useState<"" | "open" | "closed">("");

  const currency = ratePlans.find((plan) => plan.id === ratePlanId)?.currency ?? hotel.currency;

  return (
    <AdminPanel
      title="Prices"
      description={`Nightly cost from the supplier, in ${currency}. The selling price is derived by the buyer's markup.`}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const netCents = net !== "" ? toMinorUnits(net, currency) : undefined;
          const extraAdultCents = extraAdult !== "" ? toMinorUnits(extraAdult, currency) : undefined;

          void form.submit(() =>
            setRates(hotel.id, roomType.id, ratePlanId, {
              from: form.rangeFrom,
              to: form.rangeTo,
              weekdays: form.weekdays,
              ...(netCents !== null && netCents !== undefined ? { netCents } : {}),
              ...(extraAdultCents !== null && extraAdultCents !== undefined
                ? { extraAdultCents }
                : {}),
              ...(closed !== "" ? { closed: closed === "closed" } : {}),
            }),
          );
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex min-w-[10rem] flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Rate plan
          <select value={ratePlanId} onChange={(e) => setRatePlanId(e.target.value)} className={field}>
            {ratePlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        {form.rangeFields}
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Night ({currency})
          <input
            inputMode="decimal"
            value={net}
            onChange={(e) => setNet(e.target.value)}
            placeholder={toMajorUnits(18000, currency)}
            className={cn(field, "w-28")}
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Extra adult
          <input
            inputMode="decimal"
            value={extraAdult}
            onChange={(e) => setExtraAdult(e.target.value)}
            placeholder="keep"
            className={cn(field, "w-28")}
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Sales
          <select value={closed} onChange={(e) => setClosed(e.target.value as typeof closed)} className={field}>
            <option value="">keep</option>
            <option value="open">open</option>
            <option value="closed">closed</option>
          </select>
        </label>
        <button type="submit" disabled={form.busy} className={cn(button, "bg-brand text-white hover:bg-brand-hover")}>
          {form.busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          Apply to range
        </button>
      </form>
      <StatusLine error={form.error} message={form.message} />
    </AdminPanel>
  );
}
