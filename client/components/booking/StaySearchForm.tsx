"use client";

import { CalendarDays, MapPin, Minus, Plus, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import {
  addDaysISO,
  defaultStay,
  isValidStay,
  stayQueryString,
  todayISO,
} from "@/lib/booking/stay";
import type { StayQuery } from "@/types/booking";
import { cn } from "@/lib/utils";

interface StaySearchFormProps {
  /** The stay already in the URL, if there is one. */
  value: StayQuery | null;
  /** Canonical path the search lands on — `/hotels` or a property page. */
  action: string;
  /** Offered on the index only; a property page is already one destination. */
  destinations?: { slug: string; name: string }[];
  destinationSlug?: string;
  className?: string;
}

/**
 * The one control that decides what the booking flow can show.
 *
 * It submits to a URL rather than lifting state, because everything it feeds —
 * search results, a property's live rates — is server-rendered from those exact
 * parameters. That is also what makes a stay shareable and back-button-safe: a
 * traveller comparing two properties opens two tabs and finds the same dates in
 * both.
 *
 * The child *ages* are not a nicety. A hotel cannot price or place a child
 * without one, so the server takes one age per child and this form collects
 * them rather than sending a count and letting somebody guess.
 */
export function StaySearchForm({
  value,
  action,
  destinations,
  destinationSlug,
  className,
}: StaySearchFormProps) {
  const router = useRouter();
  const path = useLocalePath();
  const { t, locale } = useI18n();

  const [stay, setStay] = useState<StayQuery>(() => value ?? defaultStay());
  const [destination, setDestination] = useState(destinationSlug ?? "all");
  const [occupancyOpen, setOccupancyOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const occupancyRef = useRef<HTMLDivElement>(null);

  /**
   * The URL is the source of truth, so arriving back on a page with different
   * parameters — a back-button, a link from a result card — has to move the
   * form. Adjusted during render rather than in an effect: the value is derived
   * from a prop, and an effect would paint the stale dates first.
   *
   * Compared by content, not identity: `stayFromParams` builds a fresh object
   * on every server render, so an identity check would reset the form each time
   * the parent re-rendered for any other reason.
   */
  const valueKey = value ? stayQueryString(value) : "";
  const [syncedKey, setSyncedKey] = useState(valueKey);

  if (valueKey !== syncedKey) {
    setSyncedKey(valueKey);
    if (value) setStay(value);
  }

  useEffect(() => {
    if (!occupancyOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!occupancyRef.current?.contains(event.target as Node)) setOccupancyOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOccupancyOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [occupancyOpen]);

  const children = stay.childAges ?? [];
  const rooms = stay.rooms ?? 1;
  const invalidDates = Boolean(stay.checkIn && stay.checkOut && stay.checkOut <= stay.checkIn);

  /** Check-out follows check-in rather than becoming invalid behind the reader. */
  const setCheckIn = (checkIn: string) =>
    setStay((current) => ({
      ...current,
      checkIn,
      checkOut:
        current.checkOut && current.checkOut > checkIn ? current.checkOut : addDaysISO(checkIn, 1),
    }));

  const setChildCount = (count: number) =>
    setStay((current) => {
      const ages = current.childAges ?? [];

      return {
        ...current,
        // A new child defaults to 8 — old enough not to be an infant, young
        // enough that no property charges an adult rate. It is a starting
        // point the guest is asked to correct, never a value we price on.
        childAges: count > ages.length ? [...ages, 8] : ages.slice(0, count),
      };
    });

  const setChildAge = (index: number, age: number) =>
    setStay((current) => {
      const ages = [...(current.childAges ?? [])];
      ages[index] = age;

      return { ...current, childAges: ages };
    });

  const submit = () => {
    if (!isValidStay(stay)) return;

    setOccupancyOpen(false);
    setSubmitting(true);

    const query = stayQueryString(stay);
    const suffix = destinations && destination !== "all" ? `&destinationSlug=${destination}` : "";

    router.push(path(`${action}${query}${suffix}`));
  };

  const field = "flex flex-col gap-1.5 px-4 py-3.5";
  const label = "type-caption flex items-center gap-1.5 text-muted";
  const control = "h-6 w-full bg-transparent text-sm text-ink focus:outline-none";
  /*
   * Date fields get a minimum rather than a fixed height: iOS Safari draws its
   * own date control, taller than 24px once the text is 16px on a touch
   * screen, and centres the value — so a fixed `h-6` clipped it. The value is
   * aligned to the start like every other field in the form.
   */
  const dateControl =
    "min-h-6 w-full bg-transparent text-start text-sm text-ink focus:outline-none [&::-webkit-date-and-time-value]:text-start";
  const stepper =
    "flex size-8 items-center justify-center rounded-sm border border-line text-body transition-colors hover:border-ink disabled:opacity-35";

  const occupancyLabel = [
    plural(locale, stay.adults, t.units.adult),
    children.length > 0 ? plural(locale, children.length, t.units.child) : null,
    plural(locale, rooms, t.units.room),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={className}
    >
      {/* One column on a phone, two or three at `md`, and a single row only
          from `lg`: four fields plus a labelled button need about 800px to sit
          on one line, and a tablet has 704 — a single row there overflowed the
          page by 30px. Tracks are `minmax(0, …)` so a long option or date
          format can never widen the row past its container. */}
      <div
        className={cn(
          "border border-line bg-surface shadow-lift",
          // `grid-cols-1` and not a bare `grid`: an implicit column is sized to
          // its widest item, and a long submit label would widen the whole form.
          "grid grid-cols-1",
          destinations
            ? "md:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
            : "md:grid-cols-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]",
        )}
      >
        {destinations && (
          <label className={cn(field, "border-b border-line lg:border-b-0")}>
            <span className={label}>
              <MapPin size={13} className="shrink-0" aria-hidden />
              {t.hotels.searchDestination}
            </span>
            <select
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              // `truncate`: the Georgian "anywhere" option is wider than the
              // field on a phone, and a select otherwise cuts it mid-letter.
              className={cn(control, "cursor-pointer truncate")}
            >
              <option value="all">{t.hotels.searchAnywhere}</option>
              {destinations.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label
          className={cn(
            field,
            "border-b border-line lg:border-b-0",
            destinations && "md:border-s",
          )}
        >
          <span className={label}>
            <CalendarDays size={13} aria-hidden />
            {t.booking.search.checkIn}
          </span>
          <input
            type="date"
            required
            value={stay.checkIn}
            min={todayISO()}
            onChange={(event) => setCheckIn(event.target.value)}
            className={dateControl}
          />
        </label>

        <label
          className={cn(
            field,
            "border-b border-line lg:border-b-0",
            destinations ? "lg:border-s" : "md:border-s",
          )}
        >
          <span className={label}>
            <CalendarDays size={13} aria-hidden />
            {t.booking.search.checkOut}
          </span>
          <input
            type="date"
            required
            value={stay.checkOut}
            min={stay.checkIn ? addDaysISO(stay.checkIn, 1) : todayISO()}
            onChange={(event) =>
              setStay((current) => ({ ...current, checkOut: event.target.value }))
            }
            className={dateControl}
          />
        </label>

        <div
          className={cn(field, "relative border-b border-line md:border-s lg:border-b-0")}
          ref={occupancyRef}
        >
          <span className={label}>
            <Users size={13} aria-hidden />
            {t.hotels.guestsAndRooms}
          </span>
          <button
            type="button"
            onClick={() => setOccupancyOpen((open) => !open)}
            aria-expanded={occupancyOpen}
            className={cn(control, "truncate text-start")}
          >
            {occupancyLabel}
          </button>

          {/* `z-45`: above the hotel page's sticky section nav (z-30), which
              follows this form in the DOM and at an equal z-index painted over
              the panel, and above the mobile booking bar (z-40); still under
              the site header (z-50). */}
          {occupancyOpen && (
            <div className="absolute end-0 start-0 top-full z-45 mt-px max-h-[22rem] overflow-y-auto border border-line bg-surface p-4 shadow-card">
              {(
                [
                  { key: "adults" as const, label: t.booking.search.adults, min: 1, max: 30 },
                  { key: "rooms" as const, label: t.booking.search.rooms, min: 1, max: 9 },
                ]
              ).map((row) => {
                const current = row.key === "adults" ? stay.adults : rooms;

                return (
                  <div key={row.key} className="flex items-center justify-between py-2">
                    <span className="type-body-sm">{row.label}</span>
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={fill(t.a11y.fewer, { item: row.label.toLowerCase() })}
                        disabled={current <= row.min}
                        onClick={() => setStay((s) => ({ ...s, [row.key]: current - 1 }))}
                        className={stepper}
                      >
                        <Minus size={14} aria-hidden />
                      </button>
                      <span className="type-body-sm w-8 text-center tabular-nums">{current}</span>
                      <button
                        type="button"
                        aria-label={fill(t.a11y.more, { item: row.label.toLowerCase() })}
                        disabled={current >= row.max}
                        onClick={() => setStay((s) => ({ ...s, [row.key]: current + 1 }))}
                        className={stepper}
                      >
                        <Plus size={14} aria-hidden />
                      </button>
                    </span>
                  </div>
                );
              })}

              <div className="flex items-center justify-between py-2">
                <span className="type-body-sm">{t.booking.search.children}</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={t.booking.search.removeChild.replace("{number}", String(children.length))}
                    disabled={children.length === 0}
                    onClick={() => setChildCount(children.length - 1)}
                    className={stepper}
                  >
                    <Minus size={14} aria-hidden />
                  </button>
                  <span className="type-body-sm w-8 text-center tabular-nums">
                    {children.length}
                  </span>
                  <button
                    type="button"
                    aria-label={t.booking.search.addChild}
                    disabled={children.length >= 10}
                    onClick={() => setChildCount(children.length + 1)}
                    className={stepper}
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                </span>
              </div>

              {children.length > 0 && (
                <div className="mt-2 border-t border-line pt-3">
                  <p className="type-caption text-muted">{t.booking.search.ageHint}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {children.map((age, index) => (
                      // Positional: "child 2" is an ordinal, not an id.
                      <label key={index} className="block">
                        <span className="type-caption block text-muted">
                          {fill(t.booking.search.childAge, { number: index + 1 })}
                        </span>
                        <select
                          value={age}
                          onChange={(event) => setChildAge(index, Number(event.target.value))}
                          className="mt-1 h-9 w-full rounded-sm border border-line bg-background px-2 text-sm text-ink focus:border-ink focus:outline-none"
                        >
                          {Array.from({ length: 18 }, (_, value) => value).map((option) => (
                            <option key={option} value={option}>
                              {option} {t.booking.search.childAgeUnit}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <Button size="sm" fullWidth className="mt-4" onClick={() => setOccupancyOpen(false)}>
                {t.booking.search.done}
              </Button>
            </div>
          )}
        </div>

        <div
          className={cn(
            "border-line p-3 lg:col-span-1 lg:border-s",
            destinations ? "md:col-span-2" : "md:col-span-3",
          )}
        >
          <Button
            type="submit"
            size="lg"
            fullWidth
            className="h-auto min-h-13 px-4 whitespace-normal md:h-full md:px-5 md:whitespace-nowrap lg:w-auto"
            disabled={submitting || invalidDates}
          >
            <Search size={17} aria-hidden />
            {value ? t.booking.search.update : t.booking.search.submit}
          </Button>
        </div>
      </div>

      {invalidDates && (
        <p role="alert" className="type-caption mt-2 text-error-text">
          {t.booking.search.invalidDates}
        </p>
      )}
    </form>
  );
}
