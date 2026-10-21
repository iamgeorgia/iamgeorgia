"use client";

import { APILoadingStatus, APIProvider, useApiLoadingStatus } from "@vis.gl/react-google-maps";
import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

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

/**
 * - `missing-key`: no key configured — a setup, not a failure.
 * - `key-rejected`: Google refused the key (`InvalidKeyMapError`, a referrer
 *   not on the key's list, an API not enabled). Reloading will not help;
 *   someone has to fix the key in Google Cloud.
 * - `failed`: the script did not arrive, or the API threw from inside a map.
 */
export type MapsAvailability = "ready" | "loading" | "missing-key" | "key-rejected" | "failed";

const ConfiguredContext = createContext(false);

declare global {
  interface Window {
    /** Google calls this, if defined, when the Maps API fails to authenticate. */
    gm_authFailure?: () => void;
  }
}

/**
 * Whether the API, once loaded, has stopped working — for the life of the page.
 *
 * The Maps script loads once per page and cannot be unloaded, so a key Google
 * rejects leaves `google.maps` in a state where every map and marker call
 * throws from then on, on every screen, until a reload. The loader library
 * does not watch for that (it never defines `gm_authFailure`), so the status
 * it reports stays "loaded" while the map shows Google's own "Oops" overlay.
 *
 * This is the missing signal: a page-wide flag that outlives any one provider
 * — the failure fires once, possibly on a screen the user has already left —
 * and that `useMapsAvailability` folds in, so every picker on the page
 * unmounts its map and falls back to typed coordinates before React is asked
 * to touch a broken marker again.
 */
type Breakage = "key-rejected" | "crashed" | null;

let breakage: Breakage = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getServerBreakage = (): Breakage => null;

/** For code that cannot use the hook — a class error boundary. */
export const getMapsBreakage = () => breakage;

/** Records that the API is unusable on this page. The first report wins. */
export function reportMapsBreakage(kind: Exclude<Breakage, null>) {
  if (breakage) return;
  breakage = kind;
  for (const listener of listeners) listener();
}

let authFailureHooked = false;

function hookAuthFailure() {
  if (authFailureHooked || typeof window === "undefined") return;
  authFailureHooked = true;

  const previous = window.gm_authFailure;
  window.gm_authFailure = () => {
    previous?.();
    reportMapsBreakage("key-rejected");
  };
}

export function GoogleMapsProvider({ children }: { children: React.ReactNode }) {
  const { locale } = useI18n();

  // Before the script can finish loading: effects run child-first, so the
  // loader's effect has already started the download by now, but Google's
  // auth check runs well after the script arrives.
  useEffect(hookAuthFailure, []);

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
 * word it that way. `key-rejected` is Google refusing the key it was given,
 * which only a change in Google Cloud fixes. `failed` is the script not
 * arriving or the API throwing from inside a map, and the pickers say to
 * reload.
 */
export function useMapsAvailability(): MapsAvailability {
  const configured = useContext(ConfiguredContext);
  const status = useApiLoadingStatus();
  const broken = useSyncExternalStore(subscribe, getMapsBreakage, getServerBreakage);

  if (!configured) return "missing-key";
  if (broken === "key-rejected") return "key-rejected";
  if (broken === "crashed") return "failed";

  switch (status) {
    case APILoadingStatus.LOADED:
      return "ready";
    case APILoadingStatus.FAILED:
      return "failed";
    case APILoadingStatus.AUTH_FAILURE:
      return "key-rejected";
    default:
      return "loading";
  }
}
