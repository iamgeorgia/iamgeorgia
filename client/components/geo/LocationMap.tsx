"use client";

import { AdvancedMarker, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { Loader2 } from "lucide-react";
import { Component, useEffect, type ReactNode } from "react";

import {
  MAPS_MAP_ID,
  getMapsBreakage,
  reportMapsBreakage,
  useMapsAvailability,
  type MapsAvailability,
} from "./GoogleMapsProvider";
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

const MESSAGE: Record<Exclude<MapsAvailability, "ready" | "loading">, string> = {
  "missing-key": "No map on this deployment — enter the coordinates below.",
  "key-rejected":
    "Google rejected this site's map key, so there is no map or place search until it is fixed in Google Cloud. Enter the coordinates below.",
  failed: "The map stopped working. Reload the page to try again, or enter the coordinates below.",
};

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

  // The boundary stays mounted whatever is inside it, so that a map being
  // torn down after the API broke — which throws too — is still its problem
  // and not the screen's.
  return (
    <MapBoundary className={className}>
      {availability !== "ready" && availability !== "loading" ? (
        <Notice availability={availability} className={className} />
      ) : availability === "loading" ? (
        <div className={cn(frame, "flex items-center justify-center gap-2 text-[0.8125rem] text-subtle", className)}>
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Loading map…
        </div>
      ) : (
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
      )}
    </MapBoundary>
  );
}

function Notice({
  availability,
  className,
}: {
  availability: Exclude<MapsAvailability, "ready" | "loading">;
  className?: string;
}) {
  return (
    <div
      role={availability === "missing-key" ? undefined : "alert"}
      className={cn(frame, "flex items-center justify-center p-6 text-center text-[0.8125rem] text-muted", className)}
    >
      {MESSAGE[availability]}
    </div>
  );
}

/**
 * Keeps a Maps failure inside the map's frame.
 *
 * Once Google has refused the key, `google.maps` throws from every map and
 * marker call — creating a marker, moving it, and detaching it on unmount
 * alike — and those calls run inside React effects, where a throw climbs to
 * the nearest boundary. Without this one that is the panel's, which replaces
 * the whole screen with "could not load" over a map the form can do without.
 *
 * Catching it also tells the rest of the page: the availability flips to
 * `failed`, every picker unmounts its map, and the search boxes close.
 */
class MapBoundary extends Component<{ children: ReactNode; className?: string }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Google Maps threw inside the location map:", error);
    reportMapsBreakage("crashed");
  }

  render() {
    if (this.state.crashed) {
      // A refused key throws on the way out too; name the cause, not the symptom.
      const availability = getMapsBreakage() === "key-rejected" ? "key-rejected" : "failed";
      return <Notice availability={availability} className={this.props.className} />;
    }
    return this.props.children;
  }
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
