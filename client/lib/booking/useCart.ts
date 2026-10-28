"use client";

import { useSyncExternalStore } from "react";

import { cartServerSnapshot, cartSnapshot, subscribeCart, type CartSnapshot } from "./cart";

/**
 * The cart, live.
 *
 * `ready` is false on the server and for the hydrating render, so a page
 * shows a skeleton rather than an empty cart that fills in a frame later —
 * and so the header's count never differs between the server's markup and
 * the client's first paint.
 */
export function useCart(): CartSnapshot {
  return useSyncExternalStore(subscribeCart, cartSnapshot, cartServerSnapshot);
}
