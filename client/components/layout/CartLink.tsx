"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";

import { cartEnabled } from "@/lib/booking/cartFlag";
import { useCart } from "@/lib/booking/useCart";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

interface CartLinkProps {
  /** `light` over photography, `dark` on the solid header. */
  tone: "light" | "dark";
}

/**
 * The bag in the header, with how many things are in it.
 *
 * Absent when the cart is off or empty: a bag with a zero on it is a question
 * the page cannot answer. Absent on the server render too (`ready` is false
 * there), so the markup React hydrates with is the markup it rendered — the
 * icon appears on the first client paint, which is the same frame the count
 * would have been wrong in otherwise.
 *
 * Icon-only, so the accessible name carries the count.
 */
export function CartLink({ tone }: CartLinkProps) {
  const { t, locale } = useI18n();
  const path = useLocalePath();
  const cart = useCart();

  if (!cartEnabled || !cart.ready || cart.items.length === 0) return null;

  const count = cart.items.length;

  return (
    <Link
      href={path("/cart")}
      aria-label={fill(t.orders.cart.openCart, { count: plural(locale, count, t.units.item) })}
      className={cn(
        "relative flex size-10 items-center justify-center rounded-sm transition-colors",
        tone === "light" ? "text-on-dark hover:bg-on-dark/15" : "text-ink hover:bg-surface-soft",
      )}
    >
      <ShoppingBag size={20} aria-hidden />
      <span
        aria-hidden
        className="absolute top-1 end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[0.625rem] leading-none font-semibold tabular-nums text-white"
      >
        {count > 20 ? "20+" : count}
      </span>
    </Link>
  );
}
