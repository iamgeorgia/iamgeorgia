"use client";

import { APILoadingStatus, APIProvider, useApiLoadingStatus } from "@vis.gl/react-google-maps";
import { createContext, useContext } from "react";

import { useI18n } from "@/lib/i18n/provider";

/**
 * Loads the Google Maps JavaScript API for the screens that place things.
 *
 * Mounted by the forms that need it rather than by a layout: the script is
 * a few hundred kilobytes and most admin screens, and every public listing
 * page, have no map on them at all. One provider per screen is the rule — a
 * form with two search boxes wraps both in one provider.
 *
 * The key is public by nature (it ships in the bundle) and safe by
 * restriction, not by secrecy: HTTP-referrer-locked to this site's origins in
 * the Cloud console and limited to the three APIs the picker calls. With no
 * key configured the children still render, and `useMapsAvailability` tells
 * them to fall back to typed coordinates — a deployment without a key loses
 * the search, not the form.
 */

export const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/**
 * Advanced markers need a map id. `DEMO_MAP_ID` is Google's own placeholder
 * for exactly that and is fine until a styled map is wanted.
 */
export const MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

/** Stable across renders: a new array would re-trigger the loader's effect. */
const MAPS_LIBRARIES = ["places", "marker", "geocoding"];

export type MapsAvailability = "ready" | "loading" | "missing-key" | "failed";

const ConfiguredContext = createContext(false);

export function GoogleMapsProvider({ children }: { children: React.ReactNode }) {
  const { locale } = useI18n();

  if (!MAPS_API_KEY) {
    return <ConfiguredContext.Provider value={false}>{children}</ConfiguredContext.Provider>;
  }

  return (
    <ConfiguredContext.Provider value={true}>
      <APIProvider
        apiKey={MAPS_API_KEY}
        libraries={MAPS_LIBRARIES}
        region="GE"
        language={locale}
        onError={(error) => console.error("Google Maps failed to load:", error)}
      >
        {children}
      </APIProvider>
    </ConfiguredContext.Provider>
  );
}

/**
 * Whether a screen can search and show a map right now.
 *
 * `missing-key` is a configuration, not a failure — the local dev setup with
 * no key, or a preview host not yet on the referrer list — and the pickers
 * word it that way. `failed` is the script not arriving or the key being
 * refused, and the pickers say to reload.
 */
export function useMapsAvailability(): MapsAvailability {
  const configured = useContext(ConfiguredContext);
  const status = useApiLoadingStatus();

  if (!configured) return "missing-key";

  switch (status) {
    case APILoadingStatus.LOADED:
      return "ready";
    case APILoadingStatus.FAILED:
    case APILoadingStatus.AUTH_FAILURE:
      return "failed";
    default:
      return "loading";
  }
}
