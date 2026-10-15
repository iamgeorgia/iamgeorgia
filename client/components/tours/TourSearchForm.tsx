"use client";

import { CalendarDays, Minus, Plus, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { todayISO } from "@/lib/booking/stay";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import {
  defaultTourStay,
  isValidTourStay,
  tourStayQueryString,
  type TourStay,
} from "@/lib/tours/query";
import { cn } from "@/lib/utils";

interface TourSearchFormProps {
  /** The departure already in the URL, if there is one. */
  value: TourStay | null;
  /** Canonical path the search lands on — `/tours` or a tour page. */
  action: string;
  /** A tour's own floor, so the form cannot ask for a party it will refuse. */
  minAge?: number | null;
  className?: string;
}

/**
 * A date and a party — the two things a tour price depends on.
 *
 * Submits to a URL rather than lifting state, exactly like the stay form: the
 * departures on a tour page are a server render from these parameters, which
 * is what makes a search shareable and back-button-safe.
 *
 * Child ages, not a count: an infant rides free and a child is priced on the
 * tour's own band, and the server cannot place either without the age.
 */
export function TourSearchForm({ value, action, minAge, className }: TourSearchFormProps) {
  const router = useRouter();
  const path = useLocalePath();
  const { t, locale } = useI18n();

  const [stay, setStay] = useState<TourStay>(() => value ?? defaultTourStay());
  const [partyOpen, setPartyOpen] = useState(false);
  const [submitting, startTransition] = useTransition();
  const partyRef = useRef<HTMLDivElement>(null);

  /**
   * The URL is the source of truth. Adjusted during render rather than in an
   * effect, and compared by content because the parent builds a fresh object
   * on every server render.
   */
  const valueKey = value ? tourStayQueryString(value) : "";
  const [syncedKey, setSyncedKey] = useState(valueKey);

  if (valueKey !== syncedKey) {
    setSyncedKey(valueKey);
    if (value) setStay(value);
  }

  useEffect(() => {
    if (!partyOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!partyRef.current?.contains(event.target as Node)) setPartyOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPartyOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [partyOpen]);

  const children = stay.childAges;

  const setChildCount = (count: number) =>
    setStay((current) => ({
      ...current,
      // A new child defaults to 8: old enough not to be an infant, young enough
      // to sit inside every tour's child band. A starting point to correct,
      // never a value anything is priced on.
      childAges:
        count > current.childAges.length
          ? [...current.childAges, 8]
          : current.childAges.slice(0, count),
    }));

  const setChildAge = (index: number, age: number) =>
    setStay((current) => {
      const ages = [...current.childAges];
      ages[index] = age;

      return { ...current, childAges: ages };
    });

  const submit = () => {
    if (!isValidTourStay(stay)) return;

    setPartyOpen(false);
    // A transition rather than a flag: the search lands on this same route, so
    // the form stays mounted and a flag set here was never cleared — the button
    // stayed disabled after the first search. `submitting` ends once the new
    // page has rendered.
    startTransition(() => router.push(path(`${action}${tourStayQueryString(stay)}`)));
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

  const partyLabel = [
    plural(locale, stay.adults, t.units.adult),
    children.length > 0 ? plural(locale, children.length, t.units.child) : null,
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
      {/* `minmax(0, …)` tracks and an auto-width button: the label is a
          sentence in Georgian, and a fixed-width button clipped it. */}
      <div className="grid grid-cols-1 divide-y divide-line border border-line bg-surface shadow-lift md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] md:divide-x md:divide-y-0">
        <label className={field}>
          <span className={label}>
            <CalendarDays size={13} aria-hidden />
            {t.tours.search.date}
          </span>
          <input
            type="date"
            required
            value={stay.date}
            min={todayISO()}
            onChange={(event) => setStay((current) => ({ ...current, date: event.target.value }))}
            className={dateControl}
          />
        </label>

        <div className={cn(field, "relative")} ref={partyRef}>
          <span className={label}>
            <Users size={13} aria-hidden />
            {t.tours.search.travellers}
          </span>
          <button
            type="button"
            onClick={() => setPartyOpen((open) => !open)}
            aria-expanded={partyOpen}
            className={cn(control, "truncate text-start")}
          >
            {partyLabel}
          </button>

          {partyOpen && (
            <div className="absolute end-0 start-0 top-full z-30 mt-px max-h-[22rem] overflow-y-auto border border-line bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between py-2">
                <span className="type-body-sm">{t.tours.search.adults}</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={fill(t.a11y.fewer, { item: t.tours.search.adults.toLowerCase() })}
                    disabled={stay.adults <= 1}
                    onClick={() => setStay((s) => ({ ...s, adults: s.adults - 1 }))}
                    className={stepper}
                  >
                    <Minus size={14} aria-hidden />
                  </button>
                  <span className="type-body-sm w-8 text-center tabular-nums">{stay.adults}</span>
                  <button
                    type="button"
                    aria-label={fill(t.a11y.more, { item: t.tours.search.adults.toLowerCase() })}
                    disabled={stay.adults >= 60}
                    onClick={() => setStay((s) => ({ ...s, adults: s.adults + 1 }))}
                    className={stepper}
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                </span>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="type-body-sm">{t.tours.search.children}</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={fill(t.booking.search.removeChild, { number: children.length })}
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
                    disabled={children.length >= 20}
                    onClick={() => setChildCount(children.length + 1)}
                    className={stepper}
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                </span>
              </div>

              {children.length > 0 && (
                <div className="mt-2 border-t border-line pt-3">
                  <p className="type-caption text-muted">
                    {t.booking.search.ageHint}
                    {typeof minAge === "number" && minAge > 0 && (
                      <> {fill(t.tours.search.minAge, { age: minAge })}.</>
                    )}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {children.map((age, index) => (
                      // Positional: "child 2" is an ordinal, not an id.
                      <label key={index} className="block">
                        <span className="type-caption block text-muted">
                          {fill(t.tours.search.childAge, { number: index + 1 })}
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

              <Button size="sm" fullWidth className="mt-4" onClick={() => setPartyOpen(false)}>
                {t.tours.search.done}
              </Button>
            </div>
          )}
        </div>

        <div className="p-3">
          <Button
            type="submit"
            size="lg"
            fullWidth
            className="h-auto min-h-13 px-4 whitespace-normal md:h-full md:w-auto md:px-5 md:whitespace-nowrap"
            disabled={submitting || !stay.date}
          >
            <Search size={17} aria-hidden />
            {value ? t.tours.search.update : t.tours.search.submit}
          </Button>
        </div>
      </div>
    </form>
  );
}
