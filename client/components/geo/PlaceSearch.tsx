"use client";

import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useMapsAvailability } from "./GoogleMapsProvider";
import { hintClass, labelClass } from "@/components/admin/FormControls";
import { GEORGIA_BOUNDS, postalCodeOf, toPlaceRef } from "@/lib/geo/place";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { PlaceRef } from "@/types/geo";

/**
 * Searching for a place instead of typing its coordinates.
 *
 * Modelled on `EntityPicker` — the same debounce, the same stale-reply guard,
 * the same keyboard handling and ARIA roles — but over Google Places rather
 * than our own catalogue, and with the box itself being the input: what the
 * operator types is the query, and what they choose replaces it.
 *
 * Two things keep the bill sensible. Nothing is asked before the third
 * character, and every search-then-choose cycle runs under one session
 * token, which Google bills as one session rather than one request per
 * keystroke. The token is replaced the moment a place's details are fetched,
 * because a used token bills every later request individually.
 *
 * Typing without choosing sets nothing. A place is a suggestion that was
 * picked, never free text — the caller gets a `PlaceSelection` or it gets
 * nothing, and the box says so if it is left holding a query.
 */

export interface PlaceSelection {
  place: PlaceRef;
  /** Null when Google has the place but not a point for it. It happens. */
  latitude: number | null;
  longitude: number | null;
  postalCode: string | null;
}

export interface PlaceSearchStrings {
  placeholder: string;
  typeMore: string;
  searching: string;
  /** `{term}` is replaced with what was typed. */
  noResults: string;
  failed: string;
  loading: string;
  unavailable: string;
  pickSuggestion: string;
  clear: string;
  poweredBy: string;
}

const DEFAULT_STRINGS: PlaceSearchStrings = {
  placeholder: "Search for an address or place…",
  typeMore: "Keep typing — three letters or more.",
  searching: "Searching…",
  noResults: "No places match “{term}”.",
  failed: "Place search is not answering. Try again in a moment.",
  loading: "Loading place search…",
  unavailable: "Place search is not configured on this deployment.",
  pickSuggestion: "Choose a suggestion to set the location.",
  clear: "Clear",
  poweredBy: "Powered by Google",
};

const MIN_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Only what the normaliser reads, and only Essentials-tier fields. Google bills
 * the details call that closes a session at the highest tier among the fields
 * requested, and `displayName` alone would lift it from Essentials to
 * Enterprise + Atmosphere, about five times the price. The name is taken from
 * the suggestion the user picked instead, which the session already paid for.
 */
const PLACE_FIELDS = ["id", "formattedAddress", "location", "addressComponents", "types"];

/** The bold part of a suggestion ("The Biltmore Hotel Tbilisi"), else its whole text. */
const predictionName = (prediction: google.maps.places.PlacePrediction) =>
  prediction.mainText?.text ?? prediction.text?.text ?? null;

const rowBase = "flex w-full items-start gap-3 px-3 py-2 text-start text-[0.8125rem] transition-colors";

const inputByVariant = {
  admin:
    "h-10 w-full rounded-sm border bg-surface ps-9 pe-9 text-[0.875rem] text-ink transition-colors focus:outline-none disabled:opacity-60",
  site: "h-12 w-full rounded-sm border bg-surface ps-10 pe-10 text-sm text-ink transition-colors focus:outline-none disabled:opacity-60",
};

/** What the box shows for a chosen place when nobody is typing. */
const displayOf = (place: PlaceRef | null) => place?.formattedAddress ?? place?.name ?? "";

interface PlaceSearchProps {
  id?: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  /** The chosen place, or null. Shown in the box until the user types again. */
  value: PlaceRef | null;
  onSelect: (selection: PlaceSelection) => void;
  /** Omit it and the box has no clear button — the choice is replaced, never removed. */
  onClear?: () => void;
  disabled?: boolean;
  required?: boolean;
  /** Announced instead of the asterisk, which reads as punctuation. */
  requiredLabel?: string;
  strings?: Partial<PlaceSearchStrings>;
  /** `admin` sits beside the panel's FormControls; `site` beside the checkout forms. */
  variant?: "admin" | "site";
  /** Keeps the label for screen readers only — when a group label already names the box. */
  labelHidden?: boolean;
  autoComplete?: string;
  /**
   * Google place types to keep, at most five (for example `["lodging", "airport"]`).
   * Omitted, suggestions cover every kind of place.
   */
  includedPrimaryTypes?: string[];
  /** Two-letter region codes to restrict suggestions to. Omitted, results are only biased to Georgia. */
  includedRegionCodes?: string[];
}

export function PlaceSearch({
  id,
  label,
  hint,
  error,
  className,
  value,
  onSelect,
  onClear,
  disabled,
  required,
  requiredLabel,
  strings: overrides,
  variant = "admin",
  labelHidden,
  autoComplete = "off",
  includedPrimaryTypes,
  includedRegionCodes,
}: PlaceSearchProps) {
  const strings = { ...DEFAULT_STRINGS, ...overrides };
  const { locale } = useI18n();
  const availability = useMapsAvailability();
  const places = useMapsLibrary("places");

  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listId = `${controlId}-list`;

  const [term, setTerm] = useState(() => displayOf(value));
  /** True from the first keystroke until a choice or a clear: the box holds a query, not a place. */
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  /** Blurred with a query and no choice: the one state worth a sentence. */
  const [unresolved, setUnresolved] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  // The chosen place is the caller's; when it changes under us — cleared,
  // reverse-geocoded from a dragged pin, loaded into an edit form — the box
  // shows it and stops being a query. Derived during render rather than in
  // an effect, so the old query never paints for a frame first.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setTerm(displayOf(value));
    setDirty(false);
    setUnresolved(false);
  }

  const close = useCallback(() => {
    setOpen(false);
    setActive(0);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  /**
   * Debounced, and guarded against replies landing out of order — two
   * keystrokes make two requests and the second can answer first. Nothing is
   * asked until three characters are in, which is where suggestions start to
   * mean anything and where the bill stops being a keystroke counter.
   */
  useEffect(() => {
    if (!dirty || !places) return;

    const query = term.trim();
    // Below the threshold nothing is asked and nothing is shown: the list
    // is filtered by length at render time, so there is nothing to reset.
    if (query.length < MIN_CHARS) return;

    let stale = false;

    const timer = setTimeout(async () => {
      setLoading(true);
      setFailure(null);
      sessionRef.current ??= new places.AutocompleteSessionToken();

      try {
        const { suggestions: found } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: sessionRef.current,
          locationBias: GEORGIA_BOUNDS,
          language: locale,
          region: "ge",
          ...(includedPrimaryTypes?.length ? { includedPrimaryTypes: includedPrimaryTypes.slice(0, 5) } : {}),
          ...(includedRegionCodes?.length ? { includedRegionCodes } : {}),
        });
        if (stale) return;
        setSuggestions(found.filter((entry) => entry.placePrediction));
        setActive(0);
        setOpen(true);
      } catch (caught) {
        if (stale) return;
        console.error("Place search failed:", caught);
        setSuggestions([]);
        setFailure(strings.failed);
        setOpen(true);
      } finally {
        if (!stale) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // `strings` is rebuilt every render; the message it supplies does not
    // change what is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, term, places, locale]);

  const query = term.trim();
  const longEnough = query.length >= MIN_CHARS;
  // Suggestions belong to the query that fetched them; once the box is
  // back under the threshold they are stale by definition.
  const visible = dirty && longEnough ? suggestions : [];

  const select = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    const prediction = suggestion.placePrediction;
    if (!prediction || !places) return;

    setResolving(true);
    setFailure(null);

    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: PLACE_FIELDS });
      // The details call closes the billing session; the next search starts
      // a new one. Reusing this token would bill every request separately.
      sessionRef.current = null;

      onSelect({
        place: toPlaceRef(place, predictionName(prediction)),
        latitude: place.location?.lat() ?? null,
        longitude: place.location?.lng() ?? null,
        postalCode: postalCodeOf(place.addressComponents),
      });
      setDirty(false);
      setUnresolved(false);
      close();
    } catch (caught) {
      console.error("Place details failed:", caught);
      setFailure(strings.failed);
    } finally {
      setResolving(false);
    }
  };

  const clear = () => {
    setTerm("");
    setDirty(false);
    setUnresolved(false);
    setSuggestions([]);
    close();
    onClear?.();
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      if (open) {
        event.stopPropagation();
        close();
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (visible.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActive((current) => {
        const next = current + (event.key === "ArrowDown" ? 1 : -1);
        return (next + visible.length) % visible.length;
      });
      return;
    }

    if (event.key === "Enter" && open) {
      // The form must not submit on a choice: the box is inside one.
      event.preventDefault();
      const option = visible[active];
      if (option) void select(option);
    }
  };

  const unavailable = availability === "missing-key" || availability === "failed";
  const inputDisabled = disabled || unavailable || availability === "loading";
  const placeholder =
    availability === "missing-key"
      ? strings.unavailable
      : availability === "failed"
        ? strings.failed
        : availability === "loading"
          ? strings.loading
          : strings.placeholder;

  const showClear = Boolean(onClear) && (value !== null || term.length > 0) && !inputDisabled;

  const input = (
    <div ref={rootRef} className="relative">
      <div className="relative">
        {value && !dirty ? (
          <MapPin
            size={variant === "site" ? 16 : 14}
            className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-brand-text"
            aria-hidden
          />
        ) : (
          <Search
            size={variant === "site" ? 16 : 14}
            className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle"
            aria-hidden
          />
        )}
        <input
          ref={inputRef}
          id={controlId}
          type="text"
          role="combobox"
          autoComplete={autoComplete}
          spellCheck={false}
          value={term}
          disabled={inputDisabled}
          placeholder={placeholder}
          onChange={(event) => {
            setTerm(event.target.value);
            setDirty(true);
            setUnresolved(false);
          }}
          onFocus={() => {
            if (dirty && visible.length > 0) setOpen(true);
          }}
          onBlur={() => {
            // Left holding a query: say so, once, under the box. The chosen
            // place (if any) is unchanged — the caller never saw the query.
            if (dirty && query.length > 0) setUnresolved(true);
          }}
          onKeyDown={onKeyDown}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && visible[active] ? `${listId}-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={unresolved ? `${controlId}-unresolved` : undefined}
          className={cn(
            inputByVariant[variant],
            error ? "border-error" : open ? "border-ink" : "border-line focus:border-ink",
          )}
        />
        {(loading || resolving) && (
          <Loader2
            size={14}
            className="pointer-events-none absolute top-1/2 end-3 -translate-y-1/2 animate-spin text-muted"
            aria-hidden
          />
        )}
        {showClear && !loading && !resolving && (
          <button
            type="button"
            onClick={clear}
            aria-label={strings.clear}
            className="absolute top-1/2 end-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted hover:bg-surface-soft hover:text-ink"
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-64 overflow-hidden rounded-sm border border-line bg-surface shadow-lg">
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {visible.map((suggestion, index) => {
              const prediction = suggestion.placePrediction!;
              const main = prediction.mainText?.text ?? prediction.text.text;
              const secondary = prediction.secondaryText?.text ?? null;

              return (
                <li key={prediction.placeId} id={`${listId}-${index}`} role="option" aria-selected={index === active}>
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={resolving}
                    onPointerEnter={() => setActive(index)}
                    // `onPointerDown` rather than `onClick`: the input blurs
                    // on mousedown, and the blur must not close the list
                    // before the click lands.
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => void select(suggestion)}
                    className={cn(rowBase, index === active ? "bg-surface-soft" : "bg-transparent", "text-ink")}
                  >
                    <MapPin size={14} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{main}</span>
                      {secondary && <span className="block truncate text-[0.75rem] text-muted">{secondary}</span>}
                    </span>
                  </button>
                </li>
              );
            })}

            {visible.length === 0 && (
              <li className="px-3 py-4 text-center text-[0.75rem] text-muted" aria-live="polite" role="status">
                {loading
                  ? strings.searching
                  : (failure ??
                    (query.length < MIN_CHARS ? strings.typeMore : strings.noResults.replace("{term}", query)))}
              </li>
            )}
          </ul>
          {/* Required by Google's terms wherever suggestions are shown off a Google map. */}
          <p className="border-t border-line px-3 py-1.5 text-end text-[0.6875rem] text-subtle">{strings.poweredBy}</p>
        </div>
      )}

      {unresolved && (
        <p id={`${controlId}-unresolved`} className="mt-1.5 text-[0.75rem] text-warning-text">
          {strings.pickSuggestion}
        </p>
      )}
    </div>
  );

  if (variant === "site") {
    return (
      <div className={className}>
        <label htmlFor={controlId} className={cn("type-caption mb-1.5 block text-muted", labelHidden && "sr-only")}>
          {label}
          {required && (
            <>
              {" "}
              <span aria-hidden>*</span>
              {requiredLabel && <span className="sr-only">{requiredLabel}</span>}
            </>
          )}
        </label>
        {input}
        {hint && !error && <p className="type-caption mt-1.5 text-subtle">{hint}</p>}
        {error && (
          <p role="alert" className="type-caption mt-1.5 text-error-text">
            {error}
          </p>
        )}
      </div>
    );
  }

  // The same shape `Field` renders, spelled out so the label can be hidden.
  return (
    <div className={className}>
      <label htmlFor={controlId} className={cn(labelClass, labelHidden && "sr-only")}>
        {label}
      </label>
      <div className={labelHidden ? undefined : "mt-1.5"}>{input}</div>
      {hint && <span className={hintClass}>{hint}</span>}
      {error && (
        <p role="alert" className="mt-1.5 text-[0.75rem] text-error-text">
          {error}
        </p>
      )}
    </div>
  );
}
