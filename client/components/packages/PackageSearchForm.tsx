"use client";

import { BedDouble, CalendarDays, Minus, Plus, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { todayISO } from "@/lib/booking/stay";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import {
  defaultPackageSearch,
  isValidPackageSearch,
  packageSearchQueryString,
  type PackageSearch,
} from "@/lib/packages/query";
import type { PackagePartyRules } from "@/types/package";
import { cn } from "@/lib/utils";

interface PackageSearchFormProps {
  /** The search already in the URL, if there is one. */
  value: PackageSearch | null;
  /** Canonical path the search lands on — `/packages` or a package page. */
  action: string;
  /** The package's own limits, so the form cannot ask for a party it refuses. */
  party?: PackagePartyRules;
  className?: string;
}

/**
 * A start date and a party — the two things a package price depends on.
 *
 * Submits to a URL rather than lifting state, exactly like the stay and
 * departure forms: every slot on a package page is a server render from these
 * parameters, which is what makes a priced trip shareable and back-safe.
 *
 * The slot choices already in the URL survive a party change untouched. They
 * may stop resolving — a room type that does not sleep three — and the server
 * says so per slot rather than throwing, which is the behaviour a traveller
 * adding a child expects.
 */
export function PackageSearchForm({ value, action, party, className }: PackageSearchFormProps) {
  const router = useRouter();
  const path = useLocalePath();
  const { t, locale } = useI18n();

  const [search, setSearch] = useState<PackageSearch>(() => value ?? defaultPackageSearch());
  const [partyOpen, setPartyOpen] = useState(false);
  const [submitting, startTransition] = useTransition();
  const partyRef = useRef<HTMLDivElement>(null);

  /** The URL is the source of truth; compared by content, not identity. */
  const valueKey = value ? packageSearchQueryString(value) : "";
  const [syncedKey, setSyncedKey] = useState(valueKey);

  if (valueKey !== syncedKey) {
    setSyncedKey(valueKey);
    if (value) setSearch(value);
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

  const children = search.childAges;
  const minAdults = party?.minAdults ?? 1;
  const maxAdults = party?.maxAdults ?? 60;
  const maxChildren = party?.maxChildren ?? 20;

  const setChildCount = (count: number) =>
    setSearch((current) => ({
      ...current,
      // 8 by default: old enough not to be an infant, young enough for every
      // child band. A starting point to correct, never a price.
      childAges:
        count > current.childAges.length
          ? [...current.childAges, 8]
          : current.childAges.slice(0, count),
    }));

  const setChildAge = (index: number, age: number) =>
    setSearch((current) => {
      const ages = [...current.childAges];
      ages[index] = age;

      return { ...current, childAges: ages };
    });

  const submit = () => {
    if (!isValidPackageSearch(search)) return;

    setPartyOpen(false);
    // A transition rather than a flag: the search lands on this same route, so
    // the form stays mounted and a flag set here was never cleared — the button
    // stayed disabled after the first search. `submitting` ends once the new
    // page has rendered.
    startTransition(() => router.push(path(`${action}${packageSearchQueryString(search)}`)));
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
    plural(locale, search.adults, t.units.adult),
    children.length > 0 ? plural(locale, children.length, t.units.child) : null,
    search.rooms > 1 ? plural(locale, search.rooms, t.units.room) : null,
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
            {t.packages.search.startDate}
          </span>
          <input
            type="date"
            required
            value={search.startDate}
            min={todayISO()}
            onChange={(event) =>
              setSearch((current) => ({ ...current, startDate: event.target.value }))
            }
            className={dateControl}
          />
        </label>

        <div className={cn(field, "relative")} ref={partyRef}>
          <span className={label}>
            <Users size={13} aria-hidden />
            {t.packages.search.travellers}
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
            <div className="absolute end-0 start-0 top-full z-30 mt-px max-h-[24rem] overflow-y-auto border border-line bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between py-2">
                <span className="type-body-sm">{t.packages.search.adults}</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={fill(t.a11y.fewer, { item: t.packages.search.adults.toLowerCase() })}
                    disabled={search.adults <= minAdults}
                    onClick={() => setSearch((s) => ({ ...s, adults: s.adults - 1 }))}
                    className={stepper}
                  >
                    <Minus size={14} aria-hidden />
                  </button>
                  <span className="type-body-sm w-8 text-center tabular-nums">{search.adults}</span>
                  <button
                    type="button"
                    aria-label={fill(t.a11y.more, { item: t.packages.search.adults.toLowerCase() })}
                    disabled={search.adults >= maxAdults}
                    onClick={() => setSearch((s) => ({ ...s, adults: s.adults + 1 }))}
                    className={stepper}
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                </span>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="type-body-sm">{t.packages.search.children}</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={fill(t.packages.search.removeChild, { number: children.length })}
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
                    aria-label={t.packages.search.addChild}
                    disabled={children.length >= maxChildren}
                    onClick={() => setChildCount(children.length + 1)}
                    className={stepper}
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                </span>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="type-body-sm flex items-center gap-2">
                  <BedDouble size={14} className="text-muted" aria-hidden />
                  {t.packages.search.rooms}
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={fill(t.a11y.fewer, { item: t.packages.search.rooms.toLowerCase() })}
                    disabled={search.rooms <= 1}
                    onClick={() => setSearch((s) => ({ ...s, rooms: s.rooms - 1 }))}
                    className={stepper}
                  >
                    <Minus size={14} aria-hidden />
                  </button>
                  <span className="type-body-sm w-8 text-center tabular-nums">{search.rooms}</span>
                  <button
                    type="button"
                    aria-label={fill(t.a11y.more, { item: t.packages.search.rooms.toLowerCase() })}
                    disabled={search.rooms >= 9}
                    onClick={() => setSearch((s) => ({ ...s, rooms: s.rooms + 1 }))}
                    className={stepper}
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                </span>
              </div>

              {children.length > 0 && (
                <div className="mt-2 border-t border-line pt-3">
                  <p className="type-caption text-muted">{t.packages.search.ageHint}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {children.map((age, index) => (
                      // Positional: "child 2" is an ordinal, not an id.
                      <label key={index} className="block">
                        <span className="type-caption block text-muted">
                          {fill(t.packages.search.childAge, { number: index + 1 })}
                        </span>
                        <select
                          value={age}
                          onChange={(event) => setChildAge(index, Number(event.target.value))}
                          className="mt-1 h-9 w-full rounded-sm border border-line bg-background px-2 text-sm text-ink focus:border-ink focus:outline-none"
                        >
                          {Array.from({ length: 18 }, (_, value) => value).map((option) => (
                            <option key={option} value={option}>
                              {option} {t.packages.search.childAgeUnit}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <Button size="sm" fullWidth className="mt-4" onClick={() => setPartyOpen(false)}>
                {t.packages.search.done}
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
            disabled={submitting || !search.startDate}
          >
            <Search size={17} aria-hidden />
            {value ? t.packages.search.update : t.packages.search.submit}
          </Button>
        </div>
      </div>
    </form>
  );
}
