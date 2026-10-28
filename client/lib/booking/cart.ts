import type { CustomOrderItemInput } from "@/types/order";

/**
 * The cart: several products, kept until they are booked as one order.
 *
 * `localStorage` rather than `sessionStorage`, deliberately: a cart is the
 * opposite of a checkout draft. A traveller adds a hotel today, a tour from
 * another tab tomorrow, and expects both to be there on Thursday — which is
 * also why every tab sees one cart, through the `storage` event.
 *
 * Each item carries two things that must never be confused. The `payload` is
 * exactly what `POST /orders/custom` accepts for that line (the schema is
 * strict, so nothing else may ride in it), and the `display` is a snapshot of
 * what the traveller saw when they added it — title, dates, the price at that
 * moment — so the cart page can render without a round trip, and so a moved
 * price can be shown as "was / now" against the quote. The snapshot is never
 * sent anywhere and never trusted for money: the server re-prices every token.
 *
 * One currency per cart. An order settles in one currency and the server
 * refuses a mixed one (422 `MIXED_CURRENCY`), so the refusal happens here, at
 * the button, where there is something useful to say about it.
 *
 * Versioned, so a shape change can be read as "nothing there" rather than as a
 * crash in a component. Every storage access is guarded: private mode, a full
 * quota and a disabled store all read as an empty cart that cannot be saved.
 */

export const CART_STORAGE_KEY = "iag:cart";
export const CART_VERSION = 1;
/** The server takes 1–20 items per order. */
export const CART_MAX_ITEMS = 20;

export interface CartItemDisplay {
  /** The product: the hotel, the tour, the journey, the package. */
  title: string;
  /** The choice within it: the room and rate, the option, the vehicle. */
  detail?: string | null;
  /** `YYYY-MM-DD`, formatted at render time in the reader's locale. */
  dates?: { from: string; to?: string | null } | null;
  /** The price when added, for the "was / now" line; never sent. */
  priceCents: number;
  currency: string;
  image?: string | null;
  /** Canonical, unprefixed path back to the product page with its dates. */
  href: string;
  /** For a package: what the components are listed under on the cart page. */
  packageName?: string | null;
}

export interface CartItem {
  /** Local only — the server numbers items by position. */
  id: string;
  addedAt: string;
  payload: CustomOrderItemInput;
  display: CartItemDisplay;
}

export interface CartState {
  v: typeof CART_VERSION;
  items: CartItem[];
}

export interface CartSnapshot {
  /** False on the server and until the first client read; see `DraftState`. */
  ready: boolean;
  items: CartItem[];
  /** The one currency every item shares, or null when the cart is empty. */
  currency: string | null;
}

export type AddToCartResult =
  | { ok: true; item: CartItem }
  | { ok: false; reason: "MIXED_CURRENCY"; currency: string }
  | { ok: false; reason: "FULL" }
  | { ok: false; reason: "STORAGE" };

/** The slice of `Storage` the cart needs, so a test can hand in a Map. */
export interface CartStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CartStore {
  add: (item: Omit<CartItem, "id" | "addedAt">) => AddToCartResult;
  remove: (id: string) => void;
  clear: () => void;
  snapshot: () => CartSnapshot;
  serverSnapshot: () => CartSnapshot;
  subscribe: (listener: () => void) => () => void;
}

const EMPTY_ITEMS: CartItem[] = Object.freeze([]) as unknown as CartItem[];

/**
 * Reads a stored cart, or nothing.
 *
 * Anything that is not this version's shape — an older write, a hand edit, a
 * truncated string — is an empty cart. It is not rewritten on read: a newer
 * version's cart, left by a deploy that has since been rolled back, must not
 * be destroyed by the older code merely looking at it.
 */
export function parseCart(raw: string | null): CartItem[] {
  if (!raw) return EMPTY_ITEMS;

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_ITEMS;
  }

  if (!parsed || typeof parsed !== "object") return EMPTY_ITEMS;

  const state = parsed as Partial<CartState>;

  if (state.v !== CART_VERSION || !Array.isArray(state.items)) return EMPTY_ITEMS;

  return state.items.filter(isCartItem);
}

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;

  const item = value as Partial<CartItem>;

  return (
    typeof item.id === "string" &&
    typeof item.addedAt === "string" &&
    !!item.payload &&
    typeof item.payload === "object" &&
    typeof item.payload.type === "string" &&
    !!item.display &&
    typeof item.display === "object" &&
    typeof item.display.currency === "string" &&
    typeof item.display.priceCents === "number"
  );
}

/** The currency the cart is priced in — that of its first item. */
export const cartCurrency = (items: readonly CartItem[]): string | null =>
  items[0]?.display.currency ?? null;

/** Every currency present, for the guard notice on a cart that disagrees with itself. */
export const cartCurrencies = (items: readonly CartItem[]): string[] => [
  ...new Set(items.map((item) => item.display.currency)),
];

/** What the traveller saw when adding, summed. Never the figure that is charged. */
export const cartSnapshotTotal = (items: readonly CartItem[]): number =>
  items.reduce((sum, item) => sum + item.display.priceCents, 0);

/**
 * The request body's `items`, in cart order.
 *
 * Position is the server's key: a quote line, a hold and a 409 all name an
 * item by its `index` here, so the cart's order must not change between the
 * call and the answer. Only the payload travels — the display snapshot is
 * local, and the strict schema would refuse it anyway.
 */
export const cartPayloads = (items: readonly CartItem[]): CustomOrderItemInput[] =>
  items.map((item) => item.payload);

const newItemId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `cart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * A cart as an external store, for `useSyncExternalStore`.
 *
 * The same pattern as the checkout drafts (see `checkoutSession.ts`): the
 * parse is cached against the raw string so every render gets the same object
 * until the value changes, the server snapshot is frozen and never ready, and
 * same-tab writes notify directly while other tabs arrive via `storage`.
 */
export function createCartStore(storage: () => CartStorage | null): CartStore {
  const listeners = new Set<() => void>();

  const SERVER_STATE: CartSnapshot = Object.freeze({
    ready: false,
    items: EMPTY_ITEMS,
    currency: null,
  });

  let cached: { raw: string | null; state: CartSnapshot } | null = null;

  const readRaw = (): string | null => {
    try {
      return storage()?.getItem(CART_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  };

  const write = (items: CartItem[]): boolean => {
    try {
      const store = storage();
      if (!store) return false;

      if (items.length === 0) store.removeItem(CART_STORAGE_KEY);
      else store.setItem(CART_STORAGE_KEY, JSON.stringify({ v: CART_VERSION, items }));

      return true;
    } catch {
      return false;
    } finally {
      cached = null;
      for (const listener of listeners) listener();
    }
  };

  const snapshot = (): CartSnapshot => {
    const raw = readRaw();

    if (!cached || cached.raw !== raw) {
      const items = parseCart(raw);
      cached = { raw, state: { ready: true, items, currency: cartCurrency(items) } };
    }

    return cached.state;
  };

  return {
    add(input) {
      const items = snapshot().items;
      const currency = cartCurrency(items);

      if (currency && currency !== input.display.currency) {
        return { ok: false, reason: "MIXED_CURRENCY", currency };
      }

      if (items.length >= CART_MAX_ITEMS) return { ok: false, reason: "FULL" };

      const item: CartItem = { ...input, id: newItemId(), addedAt: new Date().toISOString() };

      return write([...items, item]) ? { ok: true, item } : { ok: false, reason: "STORAGE" };
    },
    remove(id) {
      const items = snapshot().items;
      const next = items.filter((item) => item.id !== id);

      if (next.length !== items.length) write(next);
    },
    clear() {
      write([]);
    },
    snapshot,
    serverSnapshot: () => SERVER_STATE,
    subscribe(listener) {
      listeners.add(listener);

      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === CART_STORAGE_KEY) listener();
      };

      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);

      return () => {
        listeners.delete(listener);
        if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
  };
}

const browserStorage = (): CartStorage | null =>
  typeof window === "undefined" ? null : window.localStorage;

const store = createCartStore(browserStorage);

export const addToCart = store.add;
export const removeFromCart = store.remove;
export const clearCart = store.clear;
export const cartSnapshot = store.snapshot;
export const cartServerSnapshot = store.serverSnapshot;
export const subscribeCart = store.subscribe;
