import { useSyncExternalStore } from "react";

/**
 * Where the Quick Start card remembers what the reader has done.
 *
 * There is no preferences table on the server, so the only home for "I have
 * dismissed this" and "step three is done" is the browser. That makes the
 * memory per browser rather than per person — acceptable for a first-visit
 * card, and the reason the un-dismissable copy on the help hub exists.
 *
 * Read through `useSyncExternalStore` so the first client render agrees with
 * the server: the server snapshot says "dismissed, nothing done", the browser
 * then reads the truth and re-renders once. No state set inside an effect,
 * no hydration mismatch. Every storage access is guarded — a private window
 * or blocked site data throws, and then the card simply comes back next
 * visit, exactly as the public site's cookie notice behaves.
 */

const STORAGE_KEY = "iag_admin_quickstart";

export interface QuickStartState {
  dismissedAt: string | null;
  done: string[];
}

const EMPTY: QuickStartState = { dismissedAt: null, done: [] };

/** What the server, and the first client paint, assume: nothing to show. */
const HIDDEN: QuickStartState = { dismissedAt: "server", done: [] };

const listeners = new Set<() => void>();

// Cached so `getSnapshot` returns the same object while nothing has changed —
// `useSyncExternalStore` compares by identity and would loop on a fresh
// object every call.
let cached: QuickStartState | null = null;

const read = (): QuickStartState => {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return (cached = EMPTY);
    const parsed = JSON.parse(raw) as Partial<QuickStartState>;
    return (cached = {
      dismissedAt: typeof parsed.dismissedAt === "string" ? parsed.dismissedAt : null,
      done: Array.isArray(parsed.done) ? parsed.done.filter((id) => typeof id === "string") : [],
    });
  } catch {
    return (cached = EMPTY);
  }
};

const write = (next: QuickStartState) => {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the card returns next visit, which is fine.
  }
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useQuickStartState(): QuickStartState {
  return useSyncExternalStore(subscribe, read, () => HIDDEN);
}

export const quickStartStore = {
  dismiss: () => write({ ...read(), dismissedAt: new Date().toISOString() }),
  restore: () => write({ ...read(), dismissedAt: null }),
  setDone: (id: string, done: boolean) => {
    const current = read();
    const next = done
      ? current.done.includes(id)
        ? current.done
        : [...current.done, id]
      : current.done.filter((item) => item !== id);
    write({ ...current, done: next });
  },
};
