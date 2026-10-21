"use client";

import type { Hold, Offer, StayQuery } from "@/types/booking";
import type { PackageQuote } from "@/types/package";
import type { TourHold, TourOfferAvailable, TourOption } from "@/types/tour";
import type { PackageSearch } from "@/lib/packages/query";
import type { TourStay } from "@/lib/tours/query";

/**
 * The handoff between choosing something and filling in the guest form.
 *
 * The hold token travels in the URL, so a refresh or a back-button resumes the
 * same hold rather than taking a second one off the same room or seat.
 * Everything the summary panel wants to *show* — the property, the room, the
 * nightly breakdown, the cancellation terms — travels in `sessionStorage`
 * beside it, because an offer token runs to a few thousand characters and has
 * no business in a URL.
 *
 * `sessionStorage` rather than `localStorage` deliberately: a checkout is one
 * tab's business, and two tabs booking two different rooms must not overwrite
 * each other's summary. Losing it is survivable — the confirm call needs only
 * the hold token, so a draft that has gone shows a reduced summary rather than
 * an error.
 *
 * One store per product. A hotel draft and a tour draft are different shapes
 * under different keys, so a traveller with a hotel checkout open in one tab
 * and a tour in another loses neither.
 */

export interface CheckoutDraft {
  /** Also in the URL. Read back to detect a draft belonging to another hold. */
  holdToken: string;
  hold: Hold;
  /** Kept for the nightly breakdown and the terms the guest agreed to. */
  offer: Offer;
  hotelSlug: string;
  hotelName: string;
  stay: StayQuery;
  /**
   * The kosher facility codes this property offers.
   *
   * Carried in the draft rather than re-fetched at checkout: the hotel page has
   * already loaded them, checkout has only a hold token to go on, and a second
   * request for a list that cannot have changed in the ninety seconds since
   * would be a request for nothing.
   *
   * Optional because a draft written before this existed is still a valid
   * draft — an in-flight checkout must not break on deploy.
   */
  requestableCodes?: string[];
  /**
   * Minted once per hold, not per submit.
   *
   * This is what makes a double-clicked confirm button return the first
   * booking instead of taking a second room, and it has to survive the
   * re-render that a failed submit causes — hence storing it rather than
   * generating it at submit time.
   */
  idempotencyKey: string;
}

/** The tour twin: one departure, one option, one party. */
export interface TourCheckoutDraft {
  holdToken: string;
  hold: TourHold;
  offer: TourOfferAvailable;
  option: Pick<TourOption, "id" | "code" | "name" | "kind" | "pricingBasis" | "confirmationMode">;
  tourSlug: string;
  tourTitle: string;
  /** "3 days · 2 nights" as the tour states it, for the summary. */
  durationLabel: string;
  stay: TourStay;
  idempotencyKey: string;
}

/**
 * The order twin: one composite offer covering up to four products.
 *
 * The whole quote is kept rather than a summary of it, because the checkout
 * page has to show every slot's own line — the hotel's board, the vehicle,
 * the departure time, the discount allocated to each — and re-quoting on
 * arrival would risk a different price than the one the buyer clicked.
 *
 * `holdTokens` is keyed by slot index and covers only the slots that hold
 * inventory. It is empty when the buyer went straight to checkout, which is
 * allowed: the orchestrator claims inside its own transaction.
 */
export interface OrderCheckoutDraft {
  /** The composite offer. Also in the URL as `?order=`, truncated to an id. */
  packageToken: string;
  quote: PackageQuote;
  packageSlug: string;
  packageName: string;
  search: PackageSearch;
  holdTokens: Record<string, string>;
  holdExpiresAt: string | null;
  /** The kosher request codes the package attaches to its hotel slot. */
  requestableCodes?: string[];
  idempotencyKey: string;
}

/**
 * The draft as an external store, for `useSyncExternalStore`.
 *
 * `sessionStorage` genuinely is an external store: it exists before React does,
 * it survives a re-render, and another tab can change it. Reading it in an
 * effect and calling `setState` would work, but it costs a cascading render on
 * every mount and gives no honest way to tell "not read yet" from "nothing
 * there" — which is the difference between a skeleton and a wrong message.
 *
 * `ready` carries exactly that distinction: the server snapshot is never ready,
 * so the markup React renders on the server and the markup it hydrates with
 * agree, and the real value arrives on the first client snapshot.
 */
export interface DraftState<T> {
  ready: boolean;
  draft: T | null;
}

type Listener = () => void;

const isBrowser = () => typeof window !== "undefined";

interface DraftStore<T> {
  save: (draft: T) => void;
  clear: () => void;
  snapshot: () => DraftState<T>;
  serverSnapshot: () => DraftState<T>;
  subscribe: (listener: Listener) => () => void;
}

function createDraftStore<T>(key: string): DraftStore<T> {
  const listeners = new Set<Listener>();

  /** Frozen: `useSyncExternalStore` compares snapshots by identity. */
  const SERVER_STATE: DraftState<T> = Object.freeze({ ready: false, draft: null });

  /**
   * The parse is cached against the raw string, because `getSnapshot` is
   * called on every render and must return the same object until the value
   * changes — a fresh `JSON.parse` each time would loop React forever.
   */
  let cached: { raw: string | null; state: DraftState<T> } | null = null;

  const readRaw = (): string | null => {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const notify = () => {
    cached = null;
    for (const listener of listeners) listener();
  };

  return {
    save(draft) {
      if (!isBrowser()) return;

      try {
        window.sessionStorage.setItem(key, JSON.stringify(draft));
        notify();
      } catch {
        // Private-mode quota, or storage switched off. The flow still works
        // from the hold token alone, so this is not worth interrupting anyone
        // over.
      }
    },
    clear() {
      if (!isBrowser()) return;

      try {
        window.sessionStorage.removeItem(key);
        notify();
      } catch {
        /* nothing to clear */
      }
    },
    snapshot() {
      const raw = readRaw();

      if (!cached || cached.raw !== raw) {
        let draft: T | null = null;

        try {
          draft = raw ? (JSON.parse(raw) as T) : null;
        } catch {
          draft = null;
        }

        cached = { raw, state: { ready: true, draft } };
      }

      return cached.state;
    },
    serverSnapshot: () => SERVER_STATE,
    subscribe(listener) {
      listeners.add(listener);
      // Fires for writes made by *other* tabs; same-tab writes notify directly.
      window.addEventListener("storage", listener);

      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", listener);
      };
    },
  };
}

// --- hotels -----------------------------------------------------------------

const hotelStore = createDraftStore<CheckoutDraft>("iag:checkout");

export type CheckoutDraftState = DraftState<CheckoutDraft>;

export const saveCheckoutDraft = hotelStore.save;
export const clearCheckoutDraft = hotelStore.clear;
export const checkoutDraftSnapshot = hotelStore.snapshot;
export const checkoutDraftServerSnapshot = hotelStore.serverSnapshot;
export const subscribeCheckoutDraft = hotelStore.subscribe;

// --- tours ------------------------------------------------------------------

const tourStore = createDraftStore<TourCheckoutDraft>("iag:checkout:tour");

export type TourCheckoutDraftState = DraftState<TourCheckoutDraft>;

export const saveTourCheckoutDraft = tourStore.save;
export const clearTourCheckoutDraft = tourStore.clear;
export const tourCheckoutDraftSnapshot = tourStore.snapshot;
export const tourCheckoutDraftServerSnapshot = tourStore.serverSnapshot;
export const subscribeTourCheckoutDraft = tourStore.subscribe;

// --- orders -----------------------------------------------------------------

const orderStore = createDraftStore<OrderCheckoutDraft>("iag:checkout:order");

export type OrderCheckoutDraftState = DraftState<OrderCheckoutDraft>;

export const saveOrderCheckoutDraft = orderStore.save;
export const clearOrderCheckoutDraft = orderStore.clear;
export const orderCheckoutDraftSnapshot = orderStore.snapshot;
export const orderCheckoutDraftServerSnapshot = orderStore.serverSnapshot;
export const subscribeOrderCheckoutDraft = orderStore.subscribe;

/**
 * The cart twin: the holds taken when the checkout opened.
 *
 * Kept in `sessionStorage` so a refresh resumes the same holds rather than
 * taking a second set — with one room left, the second hold would fail
 * against the first, which is still live for fifteen minutes. `itemIds`
 * says which cart the holds belong to: a cart edited since (an item removed
 * after a 409) no longer matches, and the checkout holds afresh.
 */
export interface CartCheckoutDraft {
  itemIds: string[];
  holds: Record<string, string | Record<string, string>>;
  holdExpiresAt: string | null;
  idempotencyKey: string;
}

const cartStore = createDraftStore<CartCheckoutDraft>("iag:checkout:cart");

export type CartCheckoutDraftState = DraftState<CartCheckoutDraft>;

export const saveCartCheckoutDraft = cartStore.save;
export const clearCartCheckoutDraft = cartStore.clear;
export const cartCheckoutDraftSnapshot = cartStore.snapshot;
export const cartCheckoutDraftServerSnapshot = cartStore.serverSnapshot;
export const subscribeCartCheckoutDraft = cartStore.subscribe;

/**
 * An idempotency key for one confirmation attempt.
 *
 * `randomUUID` needs a secure context; a plain http:// origin on a LAN address
 * has none, and a checkout that throws there would be a poor trade for four
 * lines of fallback.
 */
export function newIdempotencyKey(): string {
  if (isBrowser() && typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
