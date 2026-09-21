"use client";

import { Building2, Landmark, MapPin, Plane, Search, TrainFront, TreePalm } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { fill } from "@/lib/i18n/fill";
import { useI18n } from "@/lib/i18n/provider";
import { searchTransferPoints } from "@/lib/api/transfers";
import { pointKindOrder } from "@/lib/transfers/vocabulary";
import { cn } from "@/lib/utils";
import type { TransferPoint, TransferPointKind } from "@/types/transfer";

const kindIcons: Record<TransferPointKind, typeof Plane> = {
  AIRPORT: Plane,
  CITY: MapPin,
  RESORT: TreePalm,
  HOTEL: Building2,
  LANDMARK: Landmark,
  STATION: TrainFront,
};

/** `AIRPORT` → `airport`, which is how the dictionary keys its group labels. */
const groupKey = (kind: TransferPointKind) =>
  kind.toLowerCase() as Lowercase<TransferPointKind>;

interface LocationSelectorProps {
  id: string;
  label: string;
  /** The chosen point's slug. */
  value: string;
  onChange: (slug: string) => void;
  placeholder: string;
  /** The opposite end of the journey — never offered as its own destination. */
  excludeId?: string;
  error?: string;
  /**
   * The popular points, rendered before anyone types. Passed in from the page
   * so the first open costs nothing: without them the picker would open empty
   * and then fill in, which reads as a bug rather than as loading.
   */
  suggestions?: TransferPoint[];
  className?: string;
}

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Pick-up / drop-off chooser.
 *
 * A dialog rather than a `<select>`: the list is grouped, searchable and each
 * row carries a second line of context, none of which a native select can do.
 * It runs through the shared `Modal`, so focus trapping, Escape, scroll lock
 * and focus return are the same here as everywhere else — and on a phone it
 * lands as a bottom sheet, which is where a thumb already is.
 *
 * The list is now the live catalogue rather than nineteen hardcoded places, so
 * typing asks the server. The server matches names, regions, IATA codes **and
 * every translation**, which is what makes the picker work for a Russian reader
 * typing "Кутаиси" — something a client-side filter over English fixtures could
 * never do.
 */
export function LocationSelector({
  id,
  label,
  value,
  onChange,
  placeholder,
  excludeId,
  error,
  suggestions = [],
  className,
}: LocationSelectorProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** Only ever the *typed* results. What shows before that is derived. */
  const [results, setResults] = useState<TransferPoint[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * The chosen point, remembered rather than looked up.
   *
   * There is no local catalogue to resolve a slug against any more, and asking
   * the server on every render to redraw one line of text would be absurd. The
   * row that was clicked is kept, and the suggestions cover a value that
   * arrived from the URL.
   */
  const [chosen, setChosen] = useState<TransferPoint | null>(null);
  const selected = chosen?.slug === value ? chosen : (suggestions.find((p) => p.slug === value) ?? null);

  useEffect(() => {
    if (!open) return;
    // The dialog moves focus to its first control; the search field is the one
    // that should have it, so claim it once the panel has mounted.
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  /**
   * Debounced, and guarded against out-of-order replies.
   *
   * Two keystrokes produce two requests, and the second can land first — which
   * would leave the list showing results for a prefix of what was typed. The
   * `stale` flag is what stops that, and it matters more here than the debounce
   * does.
   */
  useEffect(() => {
    if (!open) return;

    const term = query.trim();

    // Nothing typed: the suggestions are already what renders, so there is no
    // request to make and no state to set.
    if (term.length === 0) return;

    let stale = false;

    const timer = setTimeout(async () => {
      // Announced when the request actually starts, not when the key is
      // pressed: a debounce that flashes "searching" between every keystroke
      // is noisier than one that waits.
      setSearching(true);

      try {
        const { data } = await searchTransferPoints(term, locale);
        if (!stale) setResults(data);
      } catch {
        // A failed lookup shows nothing found rather than an error dialog: the
        // traveller's next move is the same either way, which is to retype.
        if (!stale) setResults([]);
      } finally {
        if (!stale) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, open, locale]);

  /** Opening always starts from an empty search rather than the last one. */
  const openPicker = () => {
    setQuery("");
    setResults([]);
    setSearching(false);
    setOpen(true);
  };

  const groups = useMemo(() => {
    const shown = query.trim().length === 0 ? suggestions : results;
    const matches = shown.filter((point) => point.slug !== excludeId);

    return pointKindOrder
      .map((kind) => ({
        kind,
        label: t.transfers.locationPicker.groups[groupKey(kind)],
        items: matches.filter((point) => point.kind === kind),
      }))
      .filter((group) => group.items.length > 0);
  }, [results, suggestions, query, excludeId, t]);

  const select = (point: TransferPoint) => {
    setChosen(point);
    onChange(point.slug);
    setOpen(false);
  };

  return (
    <div className={cn("flex flex-col", className)}>
      <label htmlFor={id} className="type-caption flex items-center gap-1.5 text-muted">
        <MapPin size={13} className="shrink-0" aria-hidden />
        {label}
      </label>

      <button
        id={id}
        type="button"
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          "mt-1 min-h-6 w-full truncate text-start text-sm transition-colors",
          selected || value ? "text-ink" : "text-subtle",
        )}
      >
        {selected ? selected.name : value || placeholder}
      </button>

      {selected && <span className="type-caption truncate text-subtle">{selected.region}</span>}

      {error && (
        <p id={`${id}-error`} role="alert" className="type-caption mt-1 text-error-text">
          {error}
        </p>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={label} size="md">
        <div className="px-6 pb-6">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 start-3.5 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.transfers.locationPicker.searchPlaceholder}
              aria-label={fill(t.transfers.locationPicker.searchLabel, {
                field: label.toLowerCase(),
              })}
              className="h-12 w-full rounded-sm border border-line bg-surface ps-10 pe-3.5 text-sm text-ink transition-colors focus:border-ink focus:outline-none"
            />
          </div>

          {groups.length > 0 ? (
            <div className="mt-5 space-y-6" aria-busy={searching}>
              {groups.map((group) => (
                <section key={group.kind}>
                  <h3 className="type-eyebrow text-muted">{group.label}</h3>
                  <ul className="mt-2.5 -mx-2">
                    {group.items.map((point) => {
                      const Icon = kindIcons[point.kind];
                      const isSelected = point.slug === value;
                      return (
                        <li key={point.id}>
                          <button
                            type="button"
                            onClick={() => select(point)}
                            aria-pressed={isSelected}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-sm px-2 py-2.5 text-start transition-colors",
                              isSelected ? "bg-brand-soft" : "hover:bg-surface-soft",
                            )}
                          >
                            <span
                              className={cn(
                                "flex size-9 shrink-0 items-center justify-center rounded-full",
                                isSelected
                                  ? "bg-brand text-white"
                                  : "bg-surface-soft text-brand-text",
                              )}
                            >
                              <Icon size={16} aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="type-body-sm block truncate font-medium text-ink">
                                {point.name}
                              </span>
                              <span className="type-caption block truncate text-muted">
                                {point.region}
                              </span>
                            </span>
                            {point.code && (
                              <span className="type-caption shrink-0 rounded-sm border border-line px-1.5 py-0.5 font-medium text-muted">
                                {point.code}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <p className="type-body-sm mt-8 text-center text-muted" aria-live="polite">
              {searching
                ? t.transfers.results.searching
                : fill(t.transfers.locationPicker.noResults, { query })}
            </p>
          )}

          <p className="type-caption mt-6 border-t border-line pt-4 text-subtle">
            {t.transfers.locationPicker.note}
          </p>
        </div>
      </Modal>
    </div>
  );
}
