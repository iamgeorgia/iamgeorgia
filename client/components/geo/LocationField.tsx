"use client";

import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useMapsAvailability } from "./GoogleMapsProvider";
import { LocationMap } from "./LocationMap";
import { PlaceSearch, type PlaceSelection } from "./PlaceSearch";
import { Field, NumberInput, hintClass } from "@/components/admin/FormControls";
import { formatCoordinates, geocoderResultToPlaceRef, isPlaced } from "@/lib/geo/place";
import { cn } from "@/lib/utils";
import { EMPTY_LOCATION, type LocationValue } from "@/types/geo";

/**
 * Where something is — the one location input every admin form uses.
 *
 * Search first, because that is how a person knows a place: by its name or
 * its address, not by two numbers. Choosing a suggestion sets the pin, and
 * with it the coordinates the rest of the system reads. The map underneath
 * shows the choice and lets it be refined by dragging; a pin moved that way
 * is reverse-geocoded so the address stays honest. The typed coordinates are
 * still there, folded away, for the cases search cannot reach — a trailhead
 * Google has no name for, a screen with no key configured, an operator who
 * was sent a pair by a supplier.
 *
 * A controlled component, like the fields around it: the caller owns the
 * `LocationValue` and this reports every change, whichever of the three
 * inputs made it. Coordinates typed by hand drop the place, because an
 * address for a pin that has been moved is a lie the panel would print.
 */

export interface LocationChangeMeta {
  /** From a searched place, for an address form to prefill. */
  postalCode?: string | null;
  /** How the value was set, for a form that prefills other fields on a search. */
  source: "search" | "map" | "manual" | "clear";
}

interface LocationFieldProps {
  label: string;
  hint?: React.ReactNode;
  /** The server's message for `latitude`, `longitude` or `place`. */
  error?: string;
  className?: string;
  value: LocationValue;
  onChange: (next: LocationValue, meta: LocationChangeMeta) => void;
  /** Hides the clear control: the record cannot exist without a position. */
  required?: boolean;
  ids?: { search?: string; latitude?: string; longitude?: string };
}

const NO_POSITION =
  "Google knows that place but not exactly where it is. Click the map to put the pin down, or enter the coordinates.";

const NO_ADDRESS = "Placed on the map — no address on file. Search to attach one.";

/** Six decimals is roughly 10 cm; a round-trip should not lengthen the number. */
const fixed = (value: number | null) => (value === null ? "" : value.toFixed(6));

export function LocationField({
  label,
  hint,
  error,
  className,
  value,
  onChange,
  required,
  ids,
}: LocationFieldProps) {
  const availability = useMapsAvailability();
  const geocoding = useMapsLibrary("geocoding");

  const [notice, setNotice] = useState<string | null>(null);

  // The typed pair, as strings the inputs can hold mid-edit. Committed to the
  // caller only when both parse, so "41." on the way to "41.7" changes
  // nothing; re-synced during render whenever the value changes by another
  // route — a search, a drag — so the boxes never show a stale pair.
  const [manual, setManual] = useState({ latitude: fixed(value.latitude), longitude: fixed(value.longitude) });
  const [synced, setSynced] = useState({ latitude: value.latitude, longitude: value.longitude });

  if (synced.latitude !== value.latitude || synced.longitude !== value.longitude) {
    setSynced({ latitude: value.latitude, longitude: value.longitude });
    setManual({ latitude: fixed(value.latitude), longitude: fixed(value.longitude) });
  }

  /**
   * The value as the caller last saw it, for the reverse-geocode reply.
   *
   * A pin can be dragged again before Google answers for where it was, and
   * an address for the first spot must not land on the second. The reply is
   * applied only if the coordinates it describes are still the ones held.
   */
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  const fromSearch = (selection: PlaceSelection) => {
    if (selection.latitude === null || selection.longitude === null) {
      setNotice(NO_POSITION);
      return;
    }

    setNotice(null);
    onChange(
      { latitude: selection.latitude, longitude: selection.longitude, place: selection.place },
      { source: "search", postalCode: selection.postalCode },
    );
  };

  const fromMap = (latitude: number, longitude: number) => {
    setNotice(null);
    onChange({ latitude, longitude, place: null }, { source: "map" });

    if (!geocoding) return;

    new geocoding.Geocoder()
      .geocode({ location: { lat: latitude, lng: longitude } })
      .then(({ results }) => {
        const current = latest.current;
        const first = results[0];
        if (!first || current.latitude !== latitude || current.longitude !== longitude) return;
        onChange({ latitude, longitude, place: geocoderResultToPlaceRef(first) }, { source: "map" });
      })
      .catch((caught: unknown) => {
        // A pin with no address is still a pin. Logged, not shown: the
        // operator asked for a position and got one.
        console.error("Reverse geocoding failed:", caught);
      });
  };

  const clear = () => {
    setNotice(null);
    onChange(EMPTY_LOCATION, { source: "clear" });
  };

  /** Applies the typed pair once both halves say something, or neither does. */
  const commitManual = (next: { latitude: string; longitude: string }) => {
    const latitude = Number.parseFloat(next.latitude);
    const longitude = Number.parseFloat(next.longitude);
    const both = Number.isFinite(latitude) && Number.isFinite(longitude);
    const neither = next.latitude.trim() === "" && next.longitude.trim() === "";

    if (both) {
      if (latitude === value.latitude && longitude === value.longitude) return;
      setNotice(null);
      onChange({ latitude, longitude, place: null }, { source: "manual" });
    } else if (neither && !required && isPlaced(value)) {
      clear();
    }
  };

  const halfTyped = (manual.latitude.trim() === "") !== (manual.longitude.trim() === "");
  const placed = isPlaced(value);
  const mapless = availability === "missing-key" || availability === "failed";

  return (
    <Field label={label} hint={hint} error={error} className={className}>
      <div className="space-y-3">
        <PlaceSearch
          id={ids?.search}
          label={`Search for ${label.toLowerCase()}`}
          labelHidden
          value={value.place}
          onSelect={fromSearch}
          onClear={required ? undefined : clear}
        />

        {placed && (
          <div className="flex items-start gap-3 rounded-sm border border-line bg-surface-soft px-3 py-2.5">
            <div className="min-w-0 flex-1">
              {value.place ? (
                <>
                  {value.place.name && (
                    <p className="truncate text-[0.8125rem] font-medium text-ink">{value.place.name}</p>
                  )}
                  {value.place.formattedAddress && value.place.formattedAddress !== value.place.name && (
                    <p className="text-[0.75rem] leading-relaxed text-muted">{value.place.formattedAddress}</p>
                  )}
                </>
              ) : (
                <p className="text-[0.8125rem] text-muted">{NO_ADDRESS}</p>
              )}
              <p className="mt-0.5 font-mono text-[0.6875rem] text-subtle tabular-nums">
                {formatCoordinates(value.latitude, value.longitude, 6)}
              </p>
            </div>
            {!required && (
              <button
                type="button"
                onClick={clear}
                className="flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-[0.75rem] font-medium text-muted transition-colors hover:bg-surface hover:text-ink"
              >
                <X size={12} aria-hidden />
                Clear
              </button>
            )}
          </div>
        )}

        {notice && (
          <p role="status" className="text-[0.75rem] text-warning-text">
            {notice}
          </p>
        )}

        <LocationMap latitude={value.latitude} longitude={value.longitude} onChange={fromMap} />

        <details open={mapless || undefined} className="group rounded-sm border border-line">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[0.75rem] font-medium text-muted select-none hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} className="transition-transform group-open:rotate-90" aria-hidden />
            Enter coordinates by hand
          </summary>
          <div className="border-t border-line px-3 pt-3 pb-3">
            <div className="grid grid-cols-2 gap-3">
              <NumberInput
                id={ids?.latitude}
                label="Latitude"
                step="any"
                min={-90}
                max={90}
                placeholder="41.7151"
                value={manual.latitude}
                onChange={(event) => setManual((current) => ({ ...current, latitude: event.target.value }))}
                onBlur={() => commitManual(manual)}
              />
              <NumberInput
                id={ids?.longitude}
                label="Longitude"
                step="any"
                min={-180}
                max={180}
                placeholder="44.8271"
                value={manual.longitude}
                onChange={(event) => setManual((current) => ({ ...current, longitude: event.target.value }))}
                onBlur={() => commitManual(manual)}
              />
            </div>
            <span className={cn(hintClass, halfTyped && "text-warning-text")}>
              {halfTyped
                ? "Give both coordinates, or clear them both."
                : "For a spot search cannot find. Typing here replaces the address with the pin alone."}
            </span>
          </div>
        </details>
      </div>
    </Field>
  );
}
