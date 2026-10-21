import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CART_MAX_ITEMS,
  CART_STORAGE_KEY,
  CART_VERSION,
  cartCurrencies,
  cartPayloads,
  cartSnapshotTotal,
  createCartStore,
  parseCart,
  type CartItem,
  type CartStorage,
} from "../lib/booking/cart";

/**
 * The cart store against a Map instead of `localStorage`: adding, removing,
 * the one-currency rule, the version gate and the guards around a store that
 * refuses to write. The React hook is a one-liner over these and is not
 * exercised here — the module must stay loadable under plain Node.
 */

const memoryStorage = (): CartStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();

  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
};

const hotel = (currency = "GEL", priceCents = 44000): Omit<CartItem, "id" | "addedAt"> => ({
  payload: { type: "HOTEL_STAY", offerToken: "hotel-offer-token" },
  display: {
    title: "Rooms Hotel Kazbegi",
    detail: "Mountain View · Bed & breakfast",
    dates: { from: "2027-06-04", to: "2027-06-06" },
    priceCents,
    currency,
    href: "/hotels/rooms-kazbegi?checkIn=2027-06-04&checkOut=2027-06-06&adults=2&rooms=1",
  },
});

const tour = (currency = "GEL"): Omit<CartItem, "id" | "addedAt"> => ({
  payload: { type: "TOUR", offerToken: "tour-offer-token" },
  display: {
    title: "Kakheti wine day",
    dates: { from: "2027-06-05" },
    priceCents: 28750,
    currency,
    href: "/tours/kakheti-wine-day?date=2027-06-05&adults=2",
  },
});

describe("cart store", () => {
  it("starts empty and not ready on the server snapshot", () => {
    const store = createCartStore(() => null);

    assert.equal(store.serverSnapshot().ready, false);
    assert.deepEqual(store.serverSnapshot().items, []);
    assert.equal(store.serverSnapshot().currency, null);
  });

  it("adds items, numbers nothing, and keeps the payload apart from the snapshot", () => {
    const storage = memoryStorage();
    const store = createCartStore(() => storage);

    const first = store.add(hotel());
    const second = store.add(tour());

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);

    const { items, ready, currency } = store.snapshot();

    assert.equal(ready, true);
    assert.equal(items.length, 2);
    assert.equal(currency, "GEL");
    assert.notEqual(items[0].id, items[1].id);
    assert.ok(Date.parse(items[0].addedAt) > 0);

    // What travels to the server is the payload alone, in cart order.
    assert.deepEqual(cartPayloads(items), [
      { type: "HOTEL_STAY", offerToken: "hotel-offer-token" },
      { type: "TOUR", offerToken: "tour-offer-token" },
    ]);
    assert.equal(cartSnapshotTotal(items), 44000 + 28750);

    // And what is stored is the versioned envelope.
    const stored = JSON.parse(storage.map.get(CART_STORAGE_KEY) ?? "null") as {
      v: number;
      items: unknown[];
    };
    assert.equal(stored.v, CART_VERSION);
    assert.equal(stored.items.length, 2);
  });

  it("returns the same snapshot object until something is written", () => {
    const storage = memoryStorage();
    const store = createCartStore(() => storage);

    store.add(hotel());
    const a = store.snapshot();
    const b = store.snapshot();

    assert.equal(a, b);
    store.add(tour());
    assert.notEqual(store.snapshot(), a);
  });

  it("removes one item by id and clears the key when the last one goes", () => {
    const storage = memoryStorage();
    const store = createCartStore(() => storage);

    store.add(hotel());
    const added = store.add(tour());
    assert.equal(added.ok, true);
    if (!added.ok) return;

    store.remove(added.item.id);
    assert.equal(store.snapshot().items.length, 1);
    assert.equal(store.snapshot().items[0].payload.type, "HOTEL_STAY");

    store.remove("not-an-id");
    assert.equal(store.snapshot().items.length, 1);

    store.clear();
    assert.equal(store.snapshot().items.length, 0);
    assert.equal(store.snapshot().currency, null);
    assert.equal(storage.map.has(CART_STORAGE_KEY), false);
  });

  it("refuses an item in another currency and says which currency the cart is in", () => {
    const fresh = memoryStorage();
    const store = createCartStore(() => fresh);
    const storage = memoryStorage();
    const guarded = createCartStore(() => storage);

    guarded.add(hotel("GEL"));
    const refused = guarded.add(tour("USD"));

    assert.deepEqual(refused, { ok: false, reason: "MIXED_CURRENCY", currency: "GEL" });
    assert.equal(guarded.snapshot().items.length, 1);

    // An empty cart takes any currency, and the first item sets it.
    const usd = store.add(tour("USD"));
    assert.equal(usd.ok, true);
    assert.equal(store.snapshot().currency, "USD");
    assert.deepEqual(cartCurrencies(store.snapshot().items), ["USD"]);
  });

  it("stops at the server's item limit", () => {
    const storage = memoryStorage();
    const store = createCartStore(() => storage);

    for (let index = 0; index < CART_MAX_ITEMS; index += 1) {
      assert.equal(store.add(tour()).ok, true);
    }

    assert.deepEqual(store.add(tour()), { ok: false, reason: "FULL" });
    assert.equal(store.snapshot().items.length, CART_MAX_ITEMS);
  });

  it("reports a store that will not write, and reads as empty without one", () => {
    const refusing: CartStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };

    assert.deepEqual(createCartStore(() => refusing).add(hotel()), { ok: false, reason: "STORAGE" });

    const throwingOnRead: CartStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const snapshot = createCartStore(() => throwingOnRead).snapshot();

    assert.equal(snapshot.ready, true);
    assert.deepEqual(snapshot.items, []);
    assert.deepEqual(createCartStore(() => null).add(hotel()), { ok: false, reason: "STORAGE" });
  });

  it("notifies subscribers on every write and stops after unsubscribe", () => {
    const storage = memoryStorage();
    const store = createCartStore(() => storage);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    const added = store.add(hotel());
    assert.equal(calls, 1);
    if (added.ok) store.remove(added.item.id);
    assert.equal(calls, 2);

    unsubscribe();
    store.add(tour());
    assert.equal(calls, 2);
  });
});

describe("parseCart (versioning)", () => {
  const item = {
    id: "a",
    addedAt: "2026-10-20T08:00:00.000Z",
    payload: { type: "TOUR", offerToken: "t" },
    display: { title: "Tour", priceCents: 100, currency: "GEL", href: "/tours/x" },
  };

  it("reads this version's envelope", () => {
    const items = parseCart(JSON.stringify({ v: CART_VERSION, items: [item] }));

    assert.equal(items.length, 1);
    assert.equal(items[0].id, "a");
  });

  it("treats another version, garbage and a bare array as an empty cart", () => {
    assert.deepEqual(parseCart(JSON.stringify({ v: CART_VERSION + 1, items: [item] })), []);
    assert.deepEqual(parseCart(JSON.stringify({ v: 0, items: [item] })), []);
    assert.deepEqual(parseCart(JSON.stringify([item])), []);
    assert.deepEqual(parseCart("{not json"), []);
    assert.deepEqual(parseCart(""), []);
    assert.deepEqual(parseCart(null), []);
  });

  it("drops a malformed item and keeps the rest", () => {
    const items = parseCart(
      JSON.stringify({ v: CART_VERSION, items: [item, { id: "b" }, null, { ...item, id: "c" }] }),
    );

    assert.deepEqual(
      items.map((entry) => entry.id),
      ["a", "c"],
    );
  });

  it("does not rewrite a newer cart merely by reading it", () => {
    const storage = memoryStorage();
    const newer = JSON.stringify({ v: CART_VERSION + 1, items: [item] });
    storage.setItem(CART_STORAGE_KEY, newer);

    const store = createCartStore(() => storage);
    assert.deepEqual(store.snapshot().items, []);
    assert.equal(storage.map.get(CART_STORAGE_KEY), newer);
  });
});
