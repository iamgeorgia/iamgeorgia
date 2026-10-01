"use client";

import { AdvancedMarker, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

import { MAPS_MAP_ID, useMapsAvailability } from "./GoogleMapsProvider";
import { GEORGIA_CENTER } from "@/lib/geo/place";
import { cn } from "@/lib/utils";

/**
 * A map with one pin on it.
 *
 * A controlled component: the caller owns the coordinates, this only reports
 * where the pin was put — by clicking the map or dragging the pin. That keeps
 * the search box, the map and the typed coordinates as three views of one
 * value rather than three sources of truth.
 *
 * It exists because a position is not decoration: wherever a transfer route
 * carries no curated fare, the quote is the distance between two of these, so
 * a place that Google put on the wrong side of a river silently reprices
 * every journey through it. Seeing the pin is how that mistake is caught.
 */

const MAP_LOAD_FAILED = "The map could not be loaded. Reload the page to try again.";
const MAP_NOT_CONFIGURED = "No map on this deployment — enter the coordinates below.";

const frame = "isolate h-72 w-full overflow-hidden rounded-sm border border-line bg-surface-soft";

export function LocationMap({
  latitude,
  longitude,
  onChange,
  className,
}: {
  /** Null when nothing is placed — the map then shows the whole of Georgia. */
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number, longitude: number) => void;
  className?: string;
}) {
  const availability = useMapsAvailability();
  const placed = latitude !== null && longitude !== null;

  if (availability === "missing-key" || availability === "failed") {
    return (
      <div
        role={availability === "failed" ? "alert" : undefined}
        className={cn(frame, "flex items-center justify-center p-6 text-center text-[0.8125rem] text-muted", className)}
      >
        {availability === "failed" ? MAP_LOAD_FAILED : MAP_NOT_CONFIGURED}
      </div>
    );
  }

  if (availability === "loading") {
    return (
      <div className={cn(frame, "flex items-center justify-center gap-2 text-[0.8125rem] text-subtle", className)}>
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Loading map…
      </div>
    );
  }

  return (
    <div className={cn(frame, className)}>
      <GoogleMap
        mapId={MAPS_MAP_ID}
        defaultCenter={placed ? { lat: latitude, lng: longitude } : GEORGIA_CENTER}
        defaultZoom={placed ? 14 : 7}
        gestureHandling="cooperative"
        disableDefaultUI
        zoomControl
        clickableIcons={false}
        onClick={(event) => {
          const at = event.detail.latLng;
          if (at) onChange(at.lat, at.lng);
        }}
        className="h-full w-full"
      >
        {placed && (
          <AdvancedMarker
            position={{ lat: latitude, lng: longitude }}
            draggable
            title="Drag to refine the position"
            onDragEnd={(event) => {
              const at = event.latLng;
              if (at) onChange(at.lat(), at.lng());
            }}
          />
        )}
        <FollowPin latitude={latitude} longitude={longitude} />
      </GoogleMap>
    </div>
  );
}

/**
 * Keeps the pin in view.
 *
 * `defaultCenter` only applies on mount; a place chosen from the search box
 * after that can be three hundred kilometres from where the map is looking.
 * Zooms in only when the map is still at country level, so a pin nudged by a
 * few metres does not jump the zoom out from under the operator.
 */
function FollowPin({ latitude, longitude }: { latitude: number | null; longitude: number | null }) {
  const map = useMap();

  useEffect(() => {
    if (!map || latitude === null || longitude === null) return;

    map.panTo({ lat: latitude, lng: longitude });
    if ((map.getZoom() ?? 0) < 12) map.setZoom(14);
  }, [map, latitude, longitude]);

  return null;
}
